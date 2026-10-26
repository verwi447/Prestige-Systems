import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import { postAiCommentAsPublic } from "../routes/tickets.js";
import { notifyAdmins } from "../utils/notifications.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ticketUploadDir = path.join(__dirname, "../../uploads/tickets");
const knowledgeUploadDir = path.join(__dirname, "../../uploads/knowledge");

const GEMINI_MODEL = "gemini-3.6-flash";
const MAX_SIMILAR_TICKETS = 3;
const MAX_KNOWLEDGE_ENTRIES = 20;
const MAX_PHOTOS = 4;
const MAX_KNOWLEDGE_FILES = 3;
const MAX_OUTPUT_TOKENS = 2048;

const extensionMimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

function guessMimeType(fileName) {
  return extensionMimeTypes[path.extname(fileName || "").toLowerCase()] || null;
}

function isInlineableMimeType(mimeType) {
  return Boolean(mimeType) && (mimeType.startsWith("image/") || mimeType === "application/pdf");
}

function loadInlineFiles(rows, directory) {
  const files = [];
  for (const row of rows) {
    const mimeType = row.mime_type || guessMimeType(row.file_name);
    if (!isInlineableMimeType(mimeType)) continue;
    const filePath = path.join(directory, row.file_name);
    if (!fs.existsSync(filePath)) continue;
    files.push({ mimeType, data: fs.readFileSync(filePath).toString("base64") });
  }
  return files;
}

async function fetchTicket(ticketId) {
  const result = await db.query(
    "SELECT id, type, subject, description, object_id, category FROM tickets WHERE id=$1",
    [ticketId]
  );
  return result.rows[0] || null;
}

async function fetchTicketImages(ticketId) {
  const result = await db.query(
    `SELECT file_name, mime_type FROM ticket_photos
     WHERE ticket_id=$1 AND ticket_comment_id IS NULL
     ORDER BY uploaded_at ASC
     LIMIT $2`,
    [ticketId, MAX_PHOTOS]
  );
  return loadInlineFiles(result.rows, ticketUploadDir).filter((file) => file.mimeType.startsWith("image/"));
}

async function fetchNewTicketImages(ticketId, sinceTimestamp) {
  const result = await db.query(
    `SELECT file_name, mime_type FROM ticket_photos
     WHERE ticket_id=$1 AND uploaded_at > $2
     ORDER BY uploaded_at ASC
     LIMIT $3`,
    [ticketId, sinceTimestamp, MAX_PHOTOS]
  );
  return loadInlineFiles(result.rows, ticketUploadDir).filter((file) => file.mimeType.startsWith("image/"));
}

async function fetchObjectEquipment(objectId) {
  if (!objectId) return [];
  const result = await db.query(
    "SELECT category, brand, model, notes FROM object_equipment WHERE object_id=$1 ORDER BY created_at ASC",
    [objectId]
  );
  return result.rows;
}

function formatEquipmentList(equipment) {
  return equipment
    .map((row) => {
      const label = [row.brand, row.model].filter(Boolean).join(" ") || "model nieokreslony";
      return `- [${row.category}] ${label}${row.notes ? ` (${row.notes})` : ""}`;
    })
    .join("\n");
}

async function fetchKnowledgeEntries(category) {
  const result = await db.query(
    `SELECT id, title, content, solution, category FROM ai_knowledge_base
     ORDER BY (category = $1) DESC, updated_at DESC
     LIMIT $2`,
    [category || "", MAX_KNOWLEDGE_ENTRIES]
  );
  return result.rows;
}

// The model is asked to end its reply with a machine-readable line naming
// which knowledge base entry (by id) it actually based the diagnosis on, so
// the app can show admins "this entry was used for tickets X, Y, Z" - this
// strips that line out before the text is saved/shown, and returns the id.
function extractMatchedKnowledgeId(rawText) {
  const match = String(rawText || "").match(/\n?WPIS_BAZY_WIEDZY:\s*(\d+|NONE)\s*$/i);
  if (!match) return { text: String(rawText || "").trim(), knowledgeId: null };
  const knowledgeId = match[1].toUpperCase() === "NONE" ? null : Number(match[1]);
  return { text: rawText.slice(0, match.index).trim(), knowledgeId };
}

async function recordKnowledgeMatch(ticketId, knowledgeId, knowledgeEntries) {
  if (!knowledgeId || !knowledgeEntries.some((entry) => entry.id === knowledgeId)) return;
  try {
    await db.query(
      `INSERT INTO ai_knowledge_matches (knowledge_base_id, ticket_id)
       VALUES ($1,$2)
       ON CONFLICT (knowledge_base_id, ticket_id) DO UPDATE SET matched_at=CURRENT_TIMESTAMP`,
      [knowledgeId, ticketId]
    );
  } catch (error) {
    console.error("Failed to record knowledge base match:", error);
  }
}

function matchInstructionLine(knowledgeEntries) {
  if (!knowledgeEntries.length) return "";
  return "Na samym końcu odpowiedzi, w NOWEJ linii, napisz dokładnie: WPIS_BAZY_WIEDZY: <numer ID wpisu z nawiasu [ID:...] powyżej, na którym oparłeś diagnozę> - albo WPIS_BAZY_WIEDZY: NONE, jeśli żaden wpis nie pasował. Ta linia jest tylko do wewnętrznego użytku systemu i zostanie usunięta przed pokazaniem odpowiedzi.";
}

async function fetchKnowledgeFiles(category) {
  const result = await db.query(
    `SELECT f.file_name, f.mime_type
     FROM ai_knowledge_base_files f
     JOIN ai_knowledge_base kb ON kb.id = f.knowledge_base_id
     WHERE kb.category = $1
     ORDER BY kb.updated_at DESC, f.uploaded_at ASC
     LIMIT $2`,
    [category || "", MAX_KNOWLEDGE_FILES]
  );
  return loadInlineFiles(result.rows, knowledgeUploadDir);
}

async function fetchSimilarResolvedTickets(ticket) {
  const result = await db.query(
    `SELECT t.id, t.subject, t.description,
            (SELECT tc.content FROM ticket_comments tc
             WHERE tc.ticket_id=t.id AND tc.is_internal=FALSE
             ORDER BY tc.created_at DESC LIMIT 1) AS resolution
     FROM tickets t
     WHERE t.type=$1 AND t.status='COMPLETED' AND t.id<>$2
     ORDER BY (t.object_id IS NOT DISTINCT FROM $3) DESC, t.closed_at DESC NULLS LAST
     LIMIT $4`,
    [ticket.type, ticket.id, ticket.object_id, MAX_SIMILAR_TICKETS]
  );
  return result.rows.filter((row) => row.resolution);
}

function buildPrompt(ticket, knowledgeEntries, similarTickets, hasImages, autoSend, hasKnowledgeFiles, equipment = []) {
  const typeLabel = ticket.type === "HARDWARE_FAILURE"
    ? "awaria sprzętu (szlaban parkingowy lub kamera ANPR)"
    : "awaria systemu / problem z działaniem usługi";

  const equipmentList = formatEquipmentList(equipment);

  const knowledge = knowledgeEntries
    .map((row, index) => `Wpis ${index + 1} [ID:${row.id}] - [${row.category}] ${row.title}:\n${row.content}${row.solution ? `\nRozwiazanie:\n${row.solution}` : ""}`)
    .join("\n\n");

  const examples = similarTickets
    .map((row, index) => `Przyklad ${index + 1}:\nZgloszenie: "${row.subject}. ${row.description || ""}"\nRozwiazanie admina: "${row.resolution}"`)
    .join("\n\n");

  const attachmentsNote = [hasImages && "zdjęcia zgłoszenia", hasKnowledgeFiles && "pliki z bazy wiedzy (instrukcje, schematy)"].filter(Boolean).join(" oraz ");

  return [
    "Jesteś asystentem technicznym firmy instalującej i serwisującej szlabany parkingowe oraz kamery ANPR.",
    "Dostałeś nowe zgłoszenie serwisowe od klienta. Przeanalizuj opis" + (attachmentsNote ? ` i dołączone ${attachmentsNote}` : "") + " i napisz krótką, konkretną wstępną diagnozę PO POLSKU.",
    hasImages ? "Jeśli na zdjęciu zgłoszenia widać uszkodzenie, wskaż KONKRETNIE, które elementy wyglądają na uszkodzone (np. ramie szlabanu, fotokomórka, obudowa, kamera, uszczelka)." : "",
    hasKnowledgeFiles ? "Dołączone zostały również pliki z wewnętrznej bazy wiedzy (np. instrukcja serwisowa, schemat, zdjęcie referencyjne) dla pasującego urządzenia - wykorzystaj je jako dodatkowe, wiarygodne źródło przy stawianiu diagnozy." : "",
    "Jeśli opis sugeruje typowy przypadek (np. pojazd nie wjechał na pętlę indukcyjną, brak zasilania, awaria czujnika, zablokowany wjazd), zaproponuj najbardziej prawdopodobną przyczynę i, jeśli to bezpieczne, prosty krok do samodzielnego sprawdzenia.",
    "Odpowiadaj rzeczowo, 2-5 zdań, bez wstępów typu 'Oczywiście' czy 'Na podstawie zdjęcia widzę'.",
    autoSend
      ? "Ta wiadomość zostanie wysłana BEZPOŚREDNIO do klienta jako pierwsza odpowiedź na czacie pomocy technicznej - napisz ją wprost do klienta (możesz użyć 'Pana/Pani urządzenie' itp.), ciepło i pomocnie, i zakończ pytaniem czy podana wskazówka pomogła albo informacją, że klient może odpisać jeśli problem się utrzymuje."
      : "To jest TYLKO sugestia dla admina - nie jest jeszcze widoczna dla klienta, więc nie pisz 'Szanowny Kliencie' ani formalnych powitań.",
    equipmentList ? `WAŻNE: różne obiekty klienta mają zainstalowany sprzęt od różnych producentów, więc NIE zakładaj domyślnego modelu. Na TYM KONKRETNYM obiekcie, którego dotyczy zgłoszenie, zainstalowany jest następujący sprzęt - dopasuj diagnozę do tych faktycznych marek/modeli zamiast do ogólnego typu urządzenia:\n\n${equipmentList}` : "",
    knowledge ? `Poniżej znajduje się WEWNĘTRZNA BAZA WIEDZY firmy o konkretnych urządzeniach (np. terminal wjazdowy, terminal wyjazdowy, terminal wyjazdowy z terminalem płatniczym, szlaban, kamera) i procedurach napraw, wpisana ręcznie przez administratorów. Każdy wpis ma etykietę urządzenia w nawiasach kwadratowych. Traktuj pasujące wpisy jako NAJBARDZIEJ WIARYGODNE źródło - jeśli urządzenie lub objaw ze zgłoszenia pasuje do któregoś wpisu (zwłaszcza jeśli marka/model zgadza się ze sprzętem obiektu powyżej), oprzyj diagnozę na nim zamiast na ogólnych domysłach. Wpisy dla innych urządzeń ignoruj:\n\n${knowledge}` : "",
    examples ? `Oto podobne wcześniej rozwiązane zgłoszenia - trzymaj się podobnego stylu i sposobu rozwiązywania, jeśli pasują do obecnego przypadku:\n\n${examples}` : "",
    `Typ zgłoszenia: ${typeLabel}`,
    ticket.category ? `Urządzenie wskazane przez klienta: ${ticket.category}` : "",
    `Temat: ${ticket.subject}`,
    `Opis klienta: ${ticket.description || "(brak opisu)"}`,
    matchInstructionLine(knowledgeEntries)
  ].filter(Boolean).join("\n\n");
}

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 3_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestGeminiOnce(promptText, images) {
  const apiKey = process.env.GEMINI_API_KEY;
  const parts = [{ text: promptText }, ...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } }))];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.4 }
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`Gemini API error ${response.status}: ${body.slice(0, 300)}`);
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }

  const data = await response.json();
  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason === "MAX_TOKENS") {
    console.error("Gemini zwrócił obciętą odpowiedź (MAX_TOKENS) - zwiększ MAX_OUTPUT_TOKENS.");
  }

  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n")
    .trim();
  return text || null;
}

async function callGemini(promptText, images) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await requestGeminiOnce(promptText, images);
    } catch (error) {
      lastError = error;
      const retryable = error.retryable !== false;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

async function isAutoSendEnabled() {
  const result = await db.query("SELECT auto_send_enabled FROM ai_assistant_settings WHERE id='default'");
  return Boolean(result.rows[0]?.auto_send_enabled);
}

async function saveSuggestionComment(ticketId, content) {
  if (await isAutoSendEnabled()) {
    const sent = await postAiCommentAsPublic(ticketId, content);
    if (sent) return;
  }

  await db.query(
    `INSERT INTO ticket_comments (ticket_id, author_id, content, is_internal, is_ai_generated)
     VALUES ($1,NULL,$2,TRUE,TRUE)`,
    [ticketId, content]
  );
}

const analyzableTypes = new Set(["SYSTEM_FAILURE", "HARDWARE_FAILURE"]);

export async function analyzeTicketWithAi(ticketId) {
  try {
    if (!process.env.GEMINI_API_KEY) return;

    const ticket = await fetchTicket(ticketId);
    if (!ticket || !analyzableTypes.has(ticket.type)) return;

    const autoSend = await isAutoSendEnabled();
    const [ticketImages, similarTickets, knowledgeEntries, knowledgeFiles, equipment] = await Promise.all([
      fetchTicketImages(ticketId),
      fetchSimilarResolvedTickets(ticket),
      fetchKnowledgeEntries(ticket.category),
      fetchKnowledgeFiles(ticket.category),
      fetchObjectEquipment(ticket.object_id)
    ]);

    const images = [...ticketImages, ...knowledgeFiles];
    const prompt = buildPrompt(ticket, knowledgeEntries, similarTickets, ticketImages.length > 0, autoSend, knowledgeFiles.length > 0, equipment);
    const raw = await callGemini(prompt, images);
    if (!raw) return;

    const { text: suggestion, knowledgeId } = extractMatchedKnowledgeId(raw);
    if (!suggestion) return;

    await saveSuggestionComment(ticketId, suggestion);
    await recordKnowledgeMatch(ticketId, knowledgeId, knowledgeEntries);
  } catch (error) {
    console.error(`Analiza AI zgłoszenia #${ticketId} nie powiodła się:`, error.message, error.cause || "");
  }
}

const MAX_AI_CONVERSATION_TURNS = 3;
const conversationEndedActions = ["AI_ESCALATED_TO_ADMIN", "AI_CONVERSATION_RESOLVED"];

async function hasConversationEnded(ticketId) {
  const result = await db.query(
    `SELECT 1 FROM ticket_history WHERE ticket_id=$1 AND action = ANY($2::text[]) LIMIT 1`,
    [ticketId, conversationEndedActions]
  );
  return result.rowCount > 0;
}

async function countAiPublicReplies(ticketId) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count FROM ticket_comments WHERE ticket_id=$1 AND is_ai_generated=TRUE AND is_internal=FALSE`,
    [ticketId]
  );
  return result.rows[0]?.count || 0;
}

async function fetchPublicConversation(ticketId) {
  const result = await db.query(
    `SELECT tc.content, tc.is_ai_generated, tc.created_at, u.role
     FROM ticket_comments tc
     LEFT JOIN users u ON u.id = tc.author_id
     WHERE tc.ticket_id=$1 AND tc.is_internal=FALSE
     ORDER BY tc.created_at ASC`,
    [ticketId]
  );
  return result.rows.map((row) => ({
    role: row.is_ai_generated ? "Asystent AI" : row.role === "ADMIN" ? "Administrator" : "Klient",
    content: row.content,
    createdAt: row.created_at
  }));
}

async function markConversationEnded(ticketId, action) {
  await db.query(
    `INSERT INTO ticket_history (ticket_id, user_id, action, metadata) VALUES ($1, NULL, $2, $3::jsonb)`,
    [ticketId, action, JSON.stringify({ automatic: true, source: "ai_assistant" })]
  );
}

const DEFAULT_ESCALATION_MESSAGE = "Dziękuję za informacje. Przekazuję zgłoszenie do naszego zespołu serwisowego - ktoś się z Państwem skontaktuje.";

async function escalateToAdmin(ticket, closingMessage) {
  await postAiCommentAsPublic(ticket.id, closingMessage || DEFAULT_ESCALATION_MESSAGE);
  await markConversationEnded(ticket.id, "AI_ESCALATED_TO_ADMIN");
  await notifyAdmins({
    category: "TICKETS",
    type: "AI_ESCALATION",
    priority: "WARNING",
    title: "Asystent AI potrzebuje pomocy administratora",
    message: `Zgłoszenie #${ticket.id}: rozmowa z klientem nie rozwiązała problemu.`,
    entityType: "ticket",
    entityId: ticket.id,
    link: `/tickets/${ticket.id}`
  }).catch(() => {});
}

function buildConversationPrompt(ticket, knowledgeEntries, conversation, hasNewImages, hasKnowledgeFiles, equipment = []) {
  const typeLabel = ticket.type === "HARDWARE_FAILURE"
    ? "awaria sprzętu (szlaban parkingowy lub kamera ANPR)"
    : "awaria systemu / problem z działaniem usługi";

  const equipmentList = formatEquipmentList(equipment);

  const knowledge = knowledgeEntries
    .map((row, index) => `Wpis ${index + 1} [ID:${row.id}] - [${row.category}] ${row.title}:\n${row.content}${row.solution ? `\nRozwiazanie:\n${row.solution}` : ""}`)
    .join("\n\n");

  const history = conversation.map((entry) => `${entry.role}: ${entry.content}`).join("\n");

  return [
    "Jesteś asystentem AI prowadzącym czat pomocy technicznej dla klienta firmy instalującej i serwisującej szlabany parkingowe oraz kamery ANPR.",
    "Poniżej masz pełną historię rozmowy w tym zgłoszeniu (od najstarszej do najnowszej wiadomości). Odpowiedz na OSTATNIĄ wiadomość klienta.",
    hasNewImages ? "Klient dołączył do swojej ostatniej wiadomości nowe zdjęcie (dołączone do tego zapytania) - przeanalizuj je i uwzględnij w odpowiedzi." : "",
    hasKnowledgeFiles ? "Dołączone zostały również pliki z wewnętrznej bazy wiedzy (np. instrukcja, schemat) dla pasującego urządzenia - wykorzystaj je jako dodatkowe, wiarygodne źródło." : "",
    "Zasady:",
    "- Jeśli klient napisał, że problem został rozwiązany albo już działa - podziękuj i ciepło zakończ rozmowę.",
    "- Jeśli masz kolejny sensowny, bezpieczny krok do zaproponowania (pasujący do opisu, niewymagający otwierania obudowy ani ingerencji mechanicznej) - zaproponuj go.",
    "- Jeśli wyczerpałeś rozsądne pomysły, sprawa jest poważna/niebezpieczna (uszkodzenie mechaniczne, iskrzenie, dym) albo klient pisze, że nadal nie działa mimo wcześniejszych prób - PRZEKAŻ sprawę do zespołu serwisowego zamiast dalej zgadywać.",
    "Odpowiadaj PO POLSKU, krótko (maks. 3-4 zdania), przyjaźnie i bezpośrednio do klienta.",
    "WAŻNE - odpowiedz w DOKŁADNIE takim formacie: pierwsza linia to status, potem pusta linia, potem sama treść wiadomości do klienta (bez powtarzania statusu w treści):",
    "STATUS: CONTINUE\n(treść wiadomości z kolejna propozycja)",
    "albo",
    "STATUS: RESOLVED\n(treść wiadomości - podziękowanie i zamknięcie)",
    "albo",
    "STATUS: ESCALATE\n(treść wiadomości - informacja, że sprawa trafia do serwisu)",
    equipmentList ? `Na tym konkretnym obiekcie klienta zainstalowany jest następujący sprzęt - dopasuj odpowiedź do tych faktycznych marek/modeli, nie do ogólnego typu urządzenia:\n\n${equipmentList}` : "",
    knowledge ? `Wewnętrzna baza wiedzy firmy (traktuj pasujące wpisy jako najbardziej wiarygodne, wpisy dla innych urządzeń ignoruj):\n\n${knowledge}` : "",
    `Typ zgłoszenia: ${typeLabel}`,
    ticket.category ? `Urządzenie: ${ticket.category}` : "",
    `Temat zgłoszenia: ${ticket.subject}`,
    `Poczatkowy opis klienta: ${ticket.description || "(brak)"}`,
    `Historia rozmowy:\n${history}`,
    matchInstructionLine(knowledgeEntries)
  ].filter(Boolean).join("\n\n");
}

function parseConversationReply(text) {
  const match = text.match(/^STATUS:\s*(CONTINUE|RESOLVED|ESCALATE)\s*\n+([\s\S]*)$/i);
  if (!match) return { status: "CONTINUE", message: text.trim() };
  return { status: match[1].toUpperCase(), message: match[2].trim() };
}

export async function continueAiConversation(ticketId) {
  try {
    if (!process.env.GEMINI_API_KEY) return;

    const ticket = await fetchTicket(ticketId);
    if (!ticket || !analyzableTypes.has(ticket.type)) return;
    if (!await isAutoSendEnabled()) return;
    if (await hasConversationEnded(ticketId)) return;

    const conversation = await fetchPublicConversation(ticketId);
    if (!conversation.length) return;

    const lastEntry = conversation[conversation.length - 1];
    if (lastEntry.role !== "Klient") return;

    const lastAiIndex = conversation.map((entry) => entry.role).lastIndexOf("Asystent AI");
    if (lastAiIndex === -1) return;

    const tookOverByAdmin = conversation.slice(lastAiIndex + 1).some((entry) => entry.role === "Administrator");
    if (tookOverByAdmin) return;

    const aiReplyCount = await countAiPublicReplies(ticketId);
    if (aiReplyCount >= MAX_AI_CONVERSATION_TURNS) {
      await escalateToAdmin(ticket);
      return;
    }

    const [knowledgeEntries, knowledgeFiles, newImages, equipment] = await Promise.all([
      fetchKnowledgeEntries(ticket.category),
      fetchKnowledgeFiles(ticket.category),
      fetchNewTicketImages(ticketId, conversation[lastAiIndex].createdAt),
      fetchObjectEquipment(ticket.object_id)
    ]);
    const images = [...newImages, ...knowledgeFiles];
    const prompt = buildConversationPrompt(ticket, knowledgeEntries, conversation, newImages.length > 0, knowledgeFiles.length > 0, equipment);
    const rawReply = await callGemini(prompt, images);
    if (!rawReply) return;

    const { text: raw, knowledgeId } = extractMatchedKnowledgeId(rawReply);
    const parsed = parseConversationReply(raw);
    if (!parsed.message) return;

    if (parsed.status === "ESCALATE") {
      await escalateToAdmin(ticket, parsed.message);
      await recordKnowledgeMatch(ticketId, knowledgeId, knowledgeEntries);
      return;
    }

    await postAiCommentAsPublic(ticketId, parsed.message);
    await recordKnowledgeMatch(ticketId, knowledgeId, knowledgeEntries);
    if (parsed.status === "RESOLVED") {
      await markConversationEnded(ticketId, "AI_CONVERSATION_RESOLVED");
    }
  } catch (error) {
    console.error(`Kontynuacja rozmowy AI dla zgłoszenia #${ticketId} nie powiodła się:`, error.message, error.cause || "");
  }
}
