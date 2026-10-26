import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { denyAccountant, loadCurrentUser, normalizeRole, requireRole } from "../middleware/access.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createNotification } from "../utils/notifications.js";
import { emitToUser } from "../realtime.js";

const router = express.Router();

router.use(auth, loadCurrentUser, denyAccountant);

export const EVENT_KINDS = ["VISIT", "INSPECTION", "INSTALLATION", "OTHER"];
export const EVENT_STATUSES = ["PLANNED", "DONE", "CANCELLED"];

const MAX_EVENTS_PER_RESPONSE = 1000;
const DEFAULT_RANGE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

const isAdmin = (req) => normalizeRole(req.currentUser?.role) === "ADMIN";

// company_id bywa zwracane przez pg jako number albo string (zaleznie od typu
// kolumny), a porownanie !== na surowych wartosciach cicho przepuszczaloby
// wydarzenia innej firmy. Jedna funkcja, jedna regula.
export const sameCompany = (left, right) =>
  left != null && right != null && Number(left) === Number(right);

// Jak sameCompany, ale dwa puste odwolania (np. termin wewnetrzny przed i po
// edycji) sa rowne - inaczej kazda edycja terminu bez firmy wygladala na zmiane.
const sameNullableId = (left, right) => (left == null && right == null) || sameCompany(left, right);

const sameInstant = (left, right) =>
  (left == null && right == null) ||
  (left != null && right != null && new Date(left).getTime() === new Date(right).getTime());

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, expose: true });
}

export function parseId(value, field = "Identyfikator") {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > Number.MAX_SAFE_INTEGER) {
    throw badRequest(`${field} musi być dodatnią liczbą całkowitą.`);
  }
  return parsed;
}

function parseOptionalId(value, field) {
  if (value == null || value === "") return null;
  return parseId(value, field);
}

export function parseDate(value, { required = false, field = "data" } = {}) {
  if (value == null || value === "") {
    if (required) throw badRequest(`Pole "${field}" jest wymagane.`);
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badRequest(`Pole "${field}" ma nieprawidłowy format daty.`);
  }
  return date;
}

function sanitizeText(value, { max, field, required = false }) {
  const text = String(value ?? "").trim();
  if (!text) {
    if (required) throw badRequest(`Pole "${field}" jest wymagane.`);
    return null;
  }
  if (text.length > max) {
    throw badRequest(`Pole "${field}" może mieć najwyżej ${max} znaków.`);
  }
  return text;
}

const eventSelect = `
  SELECT e.id, e.company_id, e.object_id, e.ticket_id, e.title, e.description,
         e.starts_at, e.ends_at, e.all_day, e.kind, e.status, e.assigned_to_id,
         e.created_at, e.updated_at,
         c.name AS company_name,
         o.name AS object_name,
         TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS assigned_to_name
  FROM calendar_events e
  LEFT JOIN companies c ON c.id = e.company_id
  LEFT JOIN objects o ON o.id = e.object_id
  LEFT JOIN users u ON u.id = e.assigned_to_id
`;

function formatWhen(event) {
  const date = new Date(event.starts_at);
  const day = date.toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" });
  if (event.all_day) return day;
  const time = date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

// Powiadomienia powstaja w tej samej transakcji co zmiana wydarzenia, ale
// zdarzenia socketowe sa zbierane i wysylane dopiero po COMMIT - inaczej
// rollback zostawialby klienta z powiadomieniem o czyms, czego nie ma w bazie.
function createNotificationQueue(client) {
  const pending = [];

  return {
    async notifyCompanyUsers(companyId, notification) {
      if (!companyId) return;
      const recipients = await client.query(
        "SELECT id FROM users WHERE company_id=$1 AND COALESCE(is_active, TRUE)=TRUE",
        [companyId]
      );
      for (const row of recipients.rows) {
        const created = await createNotification(
          { ...notification, userId: row.id },
          { executor: client, emit: false }
        );
        if (created) pending.push({ userId: row.id, notification: created });
      }
    },
    flush() {
      for (const { userId, notification } of pending) {
        emitToUser(userId, "notification:new", notification);
      }
      pending.length = 0;
    }
  };
}

async function assertReferencesExist(client, { companyId, objectId, assignedToId }) {
  if (companyId) {
    const company = await client.query("SELECT 1 FROM companies WHERE id=$1", [companyId]);
    if (!company.rows[0]) throw badRequest("Wskazana firma nie istnieje.");
  }
  if (objectId) {
    const object = await client.query("SELECT company_id FROM objects WHERE id=$1", [objectId]);
    if (!object.rows[0]) throw badRequest("Wskazany obiekt nie istnieje.");
    if (companyId && !sameCompany(object.rows[0].company_id, companyId)) {
      throw badRequest("Obiekt należy do innej firmy.");
    }
  }
  // Wczesniej nieistniejacy wykonawca przechodzil walidacje i wysadzal
  // zapytanie bledem klucza obcego, czyli 500 zamiast 400.
  if (assignedToId) {
    const assignee = await client.query(
      "SELECT 1 FROM users WHERE id=$1 AND role='ADMIN' AND COALESCE(is_active, TRUE)=TRUE",
      [assignedToId]
    );
    if (!assignee.rows[0]) {
      throw badRequest("Wskazany wykonawca nie istnieje albo nie jest aktywnym administratorem.");
    }
  }
}

export function readEventPayload(req, existing = null) {
  const startsAt = parseDate(req.body.startsAt, { required: true, field: "Data rozpoczęcia" });
  const endsAt = parseDate(req.body.endsAt, { field: "Data zakończenia" });
  if (endsAt && endsAt < startsAt) {
    throw badRequest("Data zakończenia nie może być wcześniejsza niż rozpoczęcia.");
  }

  return {
    title: sanitizeText(req.body.title, { max: 120, field: "Tytuł", required: true }),
    description: sanitizeText(req.body.description, { max: 500, field: "Opis" }),
    startsAt,
    endsAt,
    allDay: Boolean(req.body.allDay),
    kind: EVENT_KINDS.includes(req.body.kind) ? req.body.kind : (existing?.kind ?? "VISIT"),
    status: EVENT_STATUSES.includes(req.body.status) ? req.body.status : (existing?.status ?? "PLANNED"),
    companyId: parseOptionalId(req.body.companyId, "Identyfikator firmy"),
    objectId: parseOptionalId(req.body.objectId, "Identyfikator obiektu"),
    assignedToId: parseOptionalId(req.body.assignedToId, "Identyfikator wykonawcy"),
    ticketId: parseOptionalId(req.body.ticketId, "Identyfikator zgłoszenia")
  };
}

export function readCancelReason(body) {
  return sanitizeText(body?.reason, { max: 300, field: "Powód odwołania" });
}

/**
 * Co klient powinien uslyszec o edycji terminu w obrebie tej samej firmy:
 * null gdy nic sie nie zmienilo, inaczej rodzaj komunikatu.
 */
export function describeEventChange(existing, payload) {
  const rescheduled = !sameInstant(existing.starts_at, payload.startsAt);
  const changed =
    rescheduled ||
    !sameInstant(existing.ends_at, payload.endsAt) ||
    Boolean(existing.all_day) !== payload.allDay ||
    (existing.title ?? null) !== payload.title ||
    (existing.description ?? null) !== payload.description ||
    existing.kind !== payload.kind ||
    existing.status !== payload.status ||
    !sameNullableId(existing.object_id, payload.objectId);

  if (!changed) return null;
  if (payload.status === "CANCELLED" && existing.status !== "CANCELLED") return "CANCELLED";
  if (payload.status === "DONE" && existing.status !== "DONE") return "COMPLETED";
  if (rescheduled) return "RESCHEDULED";
  return "UPDATED";
}

function changeNotification(change, event) {
  const when = formatWhen(event);
  const base = { category: "CALENDAR", entityType: "calendar_event", entityId: event.id, link: "/client/calendar" };
  if (change === "CANCELLED") {
    return { ...base, type: "CALENDAR_EVENT_CANCELLED", priority: "WARNING", title: "Odwołano termin", message: `${event.title} — ${when} został odwołany.` };
  }
  if (change === "COMPLETED") {
    return { ...base, type: "CALENDAR_EVENT_UPDATED", priority: "SUCCESS", title: "Wizyta zrealizowana", message: `${event.title} (${when}) została zrealizowana.` };
  }
  if (change === "RESCHEDULED") {
    return { ...base, type: "CALENDAR_EVENT_UPDATED", priority: "WARNING", title: "Zmieniono termin wizyty", message: `${event.title} — nowy termin: ${when}.` };
  }
  return { ...base, type: "CALENDAR_EVENT_UPDATED", priority: "INFO", title: "Zaktualizowano termin", message: `${event.title} — ${when}.` };
}

// Clients only ever see their own company's events; admins see everything.
router.get(
  "/events",
  asyncHandler(async (req, res) => {
    const params = [];
    const where = [];

    if (!isAdmin(req)) {
      const companyId = req.currentUser?.company_id;
      if (!companyId) return res.json([]);
      params.push(companyId);
      where.push(`e.company_id = $${params.length}`);
    } else if (req.query.companyId) {
      params.push(parseId(req.query.companyId, "Identyfikator firmy"));
      where.push(`e.company_id = $${params.length}`);
    }

    // Bez zakresu zapytanie zwracalo cala tabele. Domyslne okno i twardy LIMIT
    // utrzymuja staly rozmiar odpowiedzi niezaleznie od wieku instalacji.
    const from = parseDate(req.query.from, { field: "from" })
      ?? new Date(Date.now() - DEFAULT_RANGE_DAYS * DAY_MS);
    const to = parseDate(req.query.to, { field: "to" })
      ?? new Date(Date.now() + DEFAULT_RANGE_DAYS * DAY_MS);

    params.push(from);
    where.push(`e.starts_at >= $${params.length}`);
    params.push(to);
    where.push(`e.starts_at < $${params.length}`);
    params.push(MAX_EVENTS_PER_RESPONSE);

    const result = await db.query(
      `${eventSelect} WHERE ${where.join(" AND ")} ORDER BY e.starts_at ASC LIMIT $${params.length}`,
      params
    );
    res.json(result.rows);
  })
);

router.get(
  "/events/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id, "Identyfikator wydarzenia");
    const result = await db.query(`${eventSelect} WHERE e.id=$1`, [id]);
    const event = result.rows[0];
    if (!event) return res.status(404).json({ error: "Nie znaleziono wydarzenia." });
    if (!isAdmin(req) && !sameCompany(event.company_id, req.currentUser?.company_id)) {
      return res.status(404).json({ error: "Nie znaleziono wydarzenia." });
    }
    res.json(event);
  })
);

router.post(
  "/events",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const payload = readEventPayload(req);
    const client = await db.connect();
    const queue = createNotificationQueue(client);

    try {
      await client.query("BEGIN");
      await assertReferencesExist(client, payload);

      const inserted = await client.query(
        `INSERT INTO calendar_events
           (company_id, object_id, ticket_id, title, description, starts_at, ends_at,
            all_day, kind, status, assigned_to_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          payload.companyId,
          payload.objectId,
          payload.ticketId,
          payload.title,
          payload.description,
          payload.startsAt,
          payload.endsAt,
          payload.allDay,
          payload.kind,
          payload.status,
          payload.assignedToId,
          req.currentUser.id
        ]
      );

      const created = await client.query(`${eventSelect} WHERE e.id=$1`, [inserted.rows[0].id]);
      const event = created.rows[0];

      // W jednej transakcji z INSERT-em: wczesniej blad przy zapisie
      // powiadomien zwracal 500, choc wydarzenie juz istnialo, wiec ponowna
      // proba tworzyla duplikat.
      await queue.notifyCompanyUsers(event.company_id, {
        category: "CALENDAR",
        type: "CALENDAR_EVENT_CREATED",
        priority: "INFO",
        title: "Nowy termin w kalendarzu",
        message: `${event.title} — ${formatWhen(event)}.`,
        entityType: "calendar_event",
        entityId: event.id,
        link: "/client/calendar"
      });

      await client.query("COMMIT");
      queue.flush();
      res.status(201).json(event);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

router.put(
  "/events/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id, "Identyfikator wydarzenia");
    const client = await db.connect();
    const queue = createNotificationQueue(client);

    try {
      await client.query("BEGIN");
      const existingResult = await client.query(
        "SELECT * FROM calendar_events WHERE id=$1 FOR UPDATE",
        [id]
      );
      const existing = existingResult.rows[0];
      if (!existing) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Nie znaleziono wydarzenia." });
      }

      const payload = readEventPayload(req, existing);
      await assertReferencesExist(client, payload);

      // Domyslnie powiadamiamy; admin moze to wylaczyc przy drobnej poprawce.
      const notifyClient = req.body.notifyClient !== false;
      const companyChanged = !sameNullableId(existing.company_id, payload.companyId);

      // Poprzednia firma musi zostac powiadomiona PRZED UPDATE-em: createNotification
      // sprawdza wlasnosc odczytujac wiersz w tej samej transakcji, a po zmianie
      // company_id ta kontrola po cichu odrzucala powiadomienie.
      if (notifyClient && companyChanged && existing.company_id) {
        await queue.notifyCompanyUsers(existing.company_id, changeNotification("CANCELLED", existing));
      }

      await client.query(
        `UPDATE calendar_events
         SET company_id=$1, object_id=$2, title=$3, description=$4, starts_at=$5, ends_at=$6,
             all_day=$7, kind=$8, status=$9, assigned_to_id=$10, updated_at=CURRENT_TIMESTAMP
         WHERE id=$11`,
        [
          payload.companyId,
          payload.objectId,
          payload.title,
          payload.description,
          payload.startsAt,
          payload.endsAt,
          payload.allDay,
          payload.kind,
          payload.status,
          payload.assignedToId,
          id
        ]
      );

      const updatedResult = await client.query(`${eventSelect} WHERE e.id=$1`, [id]);
      const event = updatedResult.rows[0];

      if (notifyClient && event.company_id) {
        if (companyChanged) {
          // Dla nowej firmy to po prostu nowy termin.
          await queue.notifyCompanyUsers(event.company_id, {
            category: "CALENDAR",
            type: "CALENDAR_EVENT_CREATED",
            priority: "INFO",
            title: "Nowy termin w kalendarzu",
            message: `${event.title} — ${formatWhen(event)}.`,
            entityType: "calendar_event",
            entityId: event.id,
            link: "/client/calendar"
          });
        } else {
          const change = describeEventChange(existing, payload);
          if (change) await queue.notifyCompanyUsers(event.company_id, changeNotification(change, event));
        }
      }

      await client.query("COMMIT");
      queue.flush();
      res.json(event);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

router.delete(
  "/events/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id, "Identyfikator wydarzenia");
    const reason = readCancelReason(req.body);
    const client = await db.connect();
    const queue = createNotificationQueue(client);

    try {
      await client.query("BEGIN");
      const existing = await client.query(`${eventSelect} WHERE e.id=$1`, [id]);
      const event = existing.rows[0];
      if (!event) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Nie znaleziono wydarzenia." });
      }

      // Notify before deleting: createNotification verifies that a client owns the
      // event by reading the row, so after the DELETE the check would fail and the
      // cancellation notice would be dropped without a trace.
      const notice = changeNotification("CANCELLED", event);
      await queue.notifyCompanyUsers(event.company_id, {
        ...notice,
        message: reason ? `${notice.message} Powód: ${reason}` : notice.message
      });

      await client.query("DELETE FROM calendar_events WHERE id=$1", [id]);

      await client.query("COMMIT");
      queue.flush();
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

export default router;
