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

async function fetchKnowledgeEntries(category) {
  const result = await db.query(
    `SELECT title, content, solution, category FROM ai_knowledge_base
     ORDER BY (category = $1) DESC, updated_at DESC
     LIMIT $2`,
    [category || "", MAX_KNOWLEDGE_ENTRIES]
  );
  return result.rows;
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

function buildPrompt(ticket, knowledgeEntries, similarTickets, hasImages, autoSend, hasKnowledgeFiles) {
  const typeLabel = ticket.type === "HARDWARE_FAILURE"
    ? "awaria sprzetu (szlaban parkingowy lub kamera ANPR)"
    : "awaria systemu / problem z dzialaniem uslugi";

  const knowledge = knowledgeEntries
    .map((row, index) => `Wpis ${index + 1} - [${row.category}] ${row.title}:\n${row.content}${row.solution ? `\nRozwiazanie:\n${row.solution}` : ""}`)
    .join("\n\n");

  const examples = similarTickets
    .map((row, index) => `Przyklad ${index + 1}:\nZgloszenie: "${row.subject}. ${row.description || ""}"\nRozwiazanie admina: "${row.resolution}"`)
    .join("\n\n");

  const attachmentsNote = [hasImages && "zdjecia zgloszenia", hasKnowledgeFiles && "pliki z bazy wiedzy (instrukcje, schematy)"].filter(Boolean).join(" oraz ");

  return [
    "Jestes asystentem technicznym firmy instalujacej i serwisujacej szlabany parkingowe oraz kamery ANPR.",
    "Dostales nowe zgloszenie serwisowe od klienta. Przeanalizuj opis" + (attachmentsNote ? ` i dolaczone ${attachmentsNote}` : "") + " i napisz krotka, konkretna wstepna diagnoze PO POLSKU.",
    hasImages ? "Jesli na zdjeciu zgloszenia widac uszkodzenie, wskaz KONKRETNIE ktore elementy wygladaja na uszkodzone (np. ramie szlabanu, fotokomorka, obudowa, kamera, uszczelka)." : "",
    hasKnowledgeFiles ? "Dolaczone zostaly rowniez pliki z wewnetrznej bazy wiedzy (np. instrukcja serwisowa, schemat, zdjecie referencyjne) dla pasujacego urzadzenia - wykorzystaj je jako dodatkowe, wiarygodne zrodlo przy stawianiu diagnozy." : "",
    "Jesli opis sugeruje typowy przypadek (np. pojazd nie wjechal na petle indukcyjna, brak zasilania, awaria czujnika, zablokowany wjazd), zaproponuj najbardziej prawdopodobna przyczyne i, jesli to bezpieczne, prosty krok do samodzielnego sprawdzenia.",
    "Odpowiadaj rzeczowo, 2-5 zdan, bez wstepow typu 'Oczywiscie' czy 'Na podstawie zdjecia widze'.",
    autoSend
      ? "Ta wiadomosc zostanie wyslana BEZPOSREDNIO do klienta jako pierwsza odpowiedz na czacie pomocy technicznej - napisz ja wprost do klienta (mozesz uzyc 'Pana/Pani urzadzenie' itp.), cieplo i pomocnie, i zakoncz pytaniem czy podana wskazowka pomogla albo informacja ze klient moze odpisac jesli problem sie utrzymuje."
      : "To jest TYLKO sugestia dla admina - nie jest jeszcze widoczna dla klienta, wiec nie pisz 'Szanowny Kliencie' ani formalnych powitan.",
    knowledge ? `Ponizej znajduje sie WEWNETRZNA BAZA WIEDZY firmy o konkretnych urzadzeniach (np. terminal wjazdowy, terminal wyjazdowy, terminal wyjazdowy z terminalem platniczym, szlaban, kamera) i procedurach napraw, wpisana recznie przez administratorow. Kazdy wpis ma etykiete urzadzenia w nawiasach kwadratowych. Traktuj pasujace wpisy jako NAJBARDZIEJ WIARYGODNE zrodlo - jesli urzadzenie lub objaw ze zgloszenia pasuje do ktoregos wpisu, oprzyj diagnoze na nim zamiast na ogolnych domyslach. Wpisy dla innych urzadzen ignoruj:\n\n${knowledge}` : "",
    examples ? `Oto podobne wczesniej rozwiazane zgloszenia - trzymaj sie podobnego stylu i sposobu rozwiazywania, jesli pasuja do obecnego przypadku:\n\n${examples}` : "",
    `Typ zgloszenia: ${typeLabel}`,
    ticket.category ? `Urzadzenie wskazane przez klienta: ${ticket.category}` : "",
    `Temat: ${ticket.subject}`,
    `Opis klienta: ${ticket.description || "(brak opisu)"}`
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
    console.error("Gemini zwrocil obcieta odpowiedz (MAX_TOKENS) - zwieksz MAX_OUTPUT_TOKENS.");
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
    const [ticketImages, similarTickets, knowledgeEntries, knowledgeFiles] = await Promise.all([
      fetchTicketImages(ticketId),
      fetchSimilarResolvedTickets(ticket),
      fetchKnowledgeEntries(ticket.category),
      fetchKnowledgeFiles(ticket.category)
    ]);

    const images = [...ticketImages, ...knowledgeFiles];
    const prompt = buildPrompt(ticket, knowledgeEntries, similarTickets, ticketImages.length > 0, autoSend, knowledgeFiles.length > 0);
    const suggestion = await callGemini(prompt, images);
    if (!suggestion) return;

    await saveSuggestionComment(ticketId, suggestion);
  } catch (error) {
    console.error(`Analiza AI zgloszenia #${ticketId} nie powiodla sie:`, error.message, error.cause || "");
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

const DEFAULT_ESCALATION_MESSAGE = "Dziekuje za informacje. Przekazuje zgloszenie do naszego zespolu serwisowego - ktos sie z Panstwem skontaktuje.";

async function escalateToAdmin(ticket, closingMessage) {
  await postAiCommentAsPublic(ticket.id, closingMessage || DEFAULT_ESCALATION_MESSAGE);
  await markConversationEnded(ticket.id, "AI_ESCALATED_TO_ADMIN");
  await notifyAdmins({
    category: "TICKETS",
    type: "AI_ESCALATION",
    priority: "WARNING",
    title: "Asystent AI potrzebuje pomocy administratora",
    message: `Zgloszenie #${ticket.id}: rozmowa z klientem nie rozwiazala problemu.`,
    entityType: "ticket",
    entityId: ticket.id,
    link: `/tickets/${ticket.id}`
  }).catch(() => {});
}

function buildConversationPrompt(ticket, knowledgeEntries, conversation, hasNewImages, hasKnowledgeFiles) {
  const typeLabel = ticket.type === "HARDWARE_FAILURE"
    ? "awaria sprzetu (szlaban parkingowy lub kamera ANPR)"
    : "awaria systemu / problem z dzialaniem uslugi";

  const knowledge = knowledgeEntries
    .map((row, index) => `Wpis ${index + 1} - [${row.category}] ${row.title}:\n${row.content}${row.solution ? `\nRozwiazanie:\n${row.solution}` : ""}`)
    .join("\n\n");

  const history = conversation.map((entry) => `${entry.role}: ${entry.content}`).join("\n");

  return [
    "Jestes asystentem AI prowadzacym czat pomocy technicznej dla klienta firmy instalujacej i serwisujacej szlabany parkingowe oraz kamery ANPR.",
    "Ponizej masz pelna historie rozmowy w tym zgloszeniu (od najstarszej do najnowszej wiadomosci). Odpowiedz na OSTATNIA wiadomosc klienta.",
    hasNewImages ? "Klient dolaczyl do swojej ostatniej wiadomosci nowe zdjecie (dolaczone do tego zapytania) - przeanalizuj je i uwzglednij w odpowiedzi." : "",
    hasKnowledgeFiles ? "Dolaczone zostaly rowniez pliki z wewnetrznej bazy wiedzy (np. instrukcja, schemat) dla pasujacego urzadzenia - wykorzystaj je jako dodatkowe, wiarygodne zrodlo." : "",
    "Zasady:",
    "- Jesli klient napisal, ze problem zostal rozwiazany albo juz dziala - podziekuj i cieplo zakoncz rozmowe.",
    "- Jesli masz kolejny sensowny, bezpieczny krok do zaproponowania (pasujacy do opisu, niewymagajacy otwierania obudowy ani ingerencji mechanicznej) - zaproponuj go.",
    "- Jesli wyczerpales rozsadne pomysly, sprawa jest powazna/niebezpieczna (uszkodzenie mechaniczne, iskrzenie, dym) albo klient pisze ze nadal nie dziala mimo wczesniejszych prob - PRZEKAZ sprawe do zespolu serwisowego zamiast dalej zgadywac.",
    "Odpowiadaj PO POLSKU, krotko (maks. 3-4 zdania), przyjaznie i bezposrednio do klienta.",
    "WAZNE - odpowiedz w DOKLADNIE takim formacie: pierwsza linia to status, potem pusta linia, potem sama tresc wiadomosci do klienta (bez powtarzania statusu w tresci):",
    "STATUS: CONTINUE\n(tresc wiadomosci z kolejna propozycja)",
    "albo",
    "STATUS: RESOLVED\n(tresc wiadomosci - podziekowanie i zamkniecie)",
    "albo",
    "STATUS: ESCALATE\n(tresc wiadomosci - informacja ze sprawa trafia do serwisu)",
    knowledge ? `Wewnetrzna baza wiedzy firmy (traktuj pasujace wpisy jako najbardziej wiarygodne, wpisy dla innych urzadzen ignoruj):\n\n${knowledge}` : "",
    `Typ zgloszenia: ${typeLabel}`,
    ticket.category ? `Urzadzenie: ${ticket.category}` : "",
    `Temat zgloszenia: ${ticket.subject}`,
    `Poczatkowy opis klienta: ${ticket.description || "(brak)"}`,
    `Historia rozmowy:\n${history}`
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

    const [knowledgeEntries, knowledgeFiles, newImages] = await Promise.all([
      fetchKnowledgeEntries(ticket.category),
      fetchKnowledgeFiles(ticket.category),
      fetchNewTicketImages(ticketId, conversation[lastAiIndex].createdAt)
    ]);
    const images = [...newImages, ...knowledgeFiles];
    const prompt = buildConversationPrompt(ticket, knowledgeEntries, conversation, newImages.length > 0, knowledgeFiles.length > 0);
    const raw = await callGemini(prompt, images);
    if (!raw) return;

    const parsed = parseConversationReply(raw);
    if (!parsed.message) return;

    if (parsed.status === "ESCALATE") {
      await escalateToAdmin(ticket, parsed.message);
      return;
    }

    await postAiCommentAsPublic(ticketId, parsed.message);
    if (parsed.status === "RESOLVED") {
      await markConversationEnded(ticketId, "AI_CONVERSATION_RESOLVED");
    }
  } catch (error) {
    console.error(`Kontynuacja rozmowy AI dla zgloszenia #${ticketId} nie powiodla sie:`, error.message, error.cause || "");
  }
}
