import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, normalizeRole, requireRole } from "../middleware/access.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createNotification } from "../utils/notifications.js";

const router = express.Router();

router.use(auth, loadCurrentUser);

export const EVENT_KINDS = ["VISIT", "INSPECTION", "INSTALLATION", "OTHER"];
export const EVENT_STATUSES = ["PLANNED", "DONE", "CANCELLED"];

const isAdmin = (req) => normalizeRole(req.currentUser?.role) === "ADMIN";

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

function parseDate(value, { required = false, field = "data" } = {}) {
  if (value == null || value === "") {
    if (required) throw Object.assign(new Error(`Pole "${field}" jest wymagane.`), { status: 400 });
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error(`Pole "${field}" ma nieprawidłowy format daty.`), { status: 400 });
  }
  return date;
}

function sanitizeText(value, { max, field, required = false }) {
  const text = String(value ?? "").trim();
  if (!text) {
    if (required) throw Object.assign(new Error(`Pole "${field}" jest wymagane.`), { status: 400 });
    return null;
  }
  if (text.length > max) {
    throw Object.assign(new Error(`Pole "${field}" może mieć najwyżej ${max} znaków.`), { status: 400 });
  }
  return text;
}

function formatWhen(event) {
  const date = new Date(event.starts_at);
  const day = date.toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" });
  if (event.all_day) return day;
  const time = date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

async function notifyCompanyUsers(companyId, notification) {
  if (!companyId) return;
  const recipients = await db.query(
    "SELECT id FROM users WHERE company_id=$1 AND COALESCE(is_active, TRUE)=TRUE",
    [companyId]
  );
  await Promise.all(recipients.rows.map((row) => createNotification({ ...notification, userId: row.id })));
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
      params.push(Number(req.query.companyId));
      where.push(`e.company_id = $${params.length}`);
    }

    const from = parseDate(req.query.from, { field: "from" });
    const to = parseDate(req.query.to, { field: "to" });
    if (from) {
      params.push(from);
      where.push(`e.starts_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`e.starts_at < $${params.length}`);
    }

    const result = await db.query(
      `${eventSelect} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY e.starts_at ASC`,
      params
    );
    res.json(result.rows);
  })
);

router.get(
  "/events/:id",
  asyncHandler(async (req, res) => {
    const result = await db.query(`${eventSelect} WHERE e.id=$1`, [Number(req.params.id)]);
    const event = result.rows[0];
    if (!event) return res.status(404).json({ error: "Nie znaleziono wydarzenia." });
    if (!isAdmin(req) && event.company_id !== req.currentUser?.company_id) {
      return res.status(404).json({ error: "Nie znaleziono wydarzenia." });
    }
    res.json(event);
  })
);

router.post(
  "/events",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const title = sanitizeText(req.body.title, { max: 120, field: "Tytuł", required: true });
    const description = sanitizeText(req.body.description, { max: 500, field: "Opis" });
    const startsAt = parseDate(req.body.startsAt, { required: true, field: "Data rozpoczęcia" });
    const endsAt = parseDate(req.body.endsAt, { field: "Data zakończenia" });
    if (endsAt && endsAt < startsAt) {
      return res.status(400).json({ error: "Data zakończenia nie może być wcześniejsza niż rozpoczęcia." });
    }

    const kind = EVENT_KINDS.includes(req.body.kind) ? req.body.kind : "VISIT";
    const status = EVENT_STATUSES.includes(req.body.status) ? req.body.status : "PLANNED";
    const companyId = req.body.companyId ? Number(req.body.companyId) : null;
    const objectId = req.body.objectId ? Number(req.body.objectId) : null;
    const assignedToId = req.body.assignedToId ? Number(req.body.assignedToId) : null;

    if (companyId) {
      const company = await db.query("SELECT 1 FROM companies WHERE id=$1", [companyId]);
      if (!company.rows[0]) return res.status(400).json({ error: "Wskazana firma nie istnieje." });
    }
    if (objectId) {
      const object = await db.query("SELECT company_id FROM objects WHERE id=$1", [objectId]);
      if (!object.rows[0]) return res.status(400).json({ error: "Wskazany obiekt nie istnieje." });
      if (companyId && object.rows[0].company_id !== companyId) {
        return res.status(400).json({ error: "Obiekt należy do innej firmy." });
      }
    }

    const result = await db.query(
      `INSERT INTO calendar_events
         (company_id, object_id, ticket_id, title, description, starts_at, ends_at, all_day, kind, status, assigned_to_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        companyId,
        objectId,
        req.body.ticketId ? Number(req.body.ticketId) : null,
        title,
        description,
        startsAt,
        endsAt,
        Boolean(req.body.allDay),
        kind,
        status,
        assignedToId,
        req.currentUser.id
      ]
    );

    const created = await db.query(`${eventSelect} WHERE e.id=$1`, [result.rows[0].id]);
    const event = created.rows[0];

    await notifyCompanyUsers(event.company_id, {
      category: "CALENDAR",
      type: "CALENDAR_EVENT_CREATED",
      priority: "INFO",
      title: "Nowy termin w kalendarzu",
      message: `${event.title} — ${formatWhen(event)}.`,
      entityType: "calendar_event",
      entityId: event.id,
      link: "/client/calendar"
    });

    res.status(201).json(event);
  })
);

router.put(
  "/events/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existingResult = await db.query("SELECT * FROM calendar_events WHERE id=$1", [id]);
    const existing = existingResult.rows[0];
    if (!existing) return res.status(404).json({ error: "Nie znaleziono wydarzenia." });

    const title = sanitizeText(req.body.title, { max: 120, field: "Tytuł", required: true });
    const description = sanitizeText(req.body.description, { max: 500, field: "Opis" });
    const startsAt = parseDate(req.body.startsAt, { required: true, field: "Data rozpoczęcia" });
    const endsAt = parseDate(req.body.endsAt, { field: "Data zakończenia" });
    if (endsAt && endsAt < startsAt) {
      return res.status(400).json({ error: "Data zakończenia nie może być wcześniejsza niż rozpoczęcia." });
    }

    const kind = EVENT_KINDS.includes(req.body.kind) ? req.body.kind : existing.kind;
    const status = EVENT_STATUSES.includes(req.body.status) ? req.body.status : existing.status;
    const companyId = req.body.companyId ? Number(req.body.companyId) : null;
    const objectId = req.body.objectId ? Number(req.body.objectId) : null;

    if (objectId) {
      const object = await db.query("SELECT company_id FROM objects WHERE id=$1", [objectId]);
      if (!object.rows[0]) return res.status(400).json({ error: "Wskazany obiekt nie istnieje." });
      if (companyId && object.rows[0].company_id !== companyId) {
        return res.status(400).json({ error: "Obiekt należy do innej firmy." });
      }
    }

    await db.query(
      `UPDATE calendar_events
       SET company_id=$1, object_id=$2, title=$3, description=$4, starts_at=$5, ends_at=$6,
           all_day=$7, kind=$8, status=$9, assigned_to_id=$10, updated_at=CURRENT_TIMESTAMP
       WHERE id=$11`,
      [
        companyId,
        objectId,
        title,
        description,
        startsAt,
        endsAt,
        Boolean(req.body.allDay),
        kind,
        status,
        req.body.assignedToId ? Number(req.body.assignedToId) : null,
        id
      ]
    );

    const updatedResult = await db.query(`${eventSelect} WHERE e.id=$1`, [id]);
    const event = updatedResult.rows[0];

    const dateChanged = new Date(existing.starts_at).getTime() !== startsAt.getTime();
    if (dateChanged || existing.company_id !== event.company_id) {
      await notifyCompanyUsers(event.company_id, {
        category: "CALENDAR",
        type: "CALENDAR_EVENT_UPDATED",
        priority: "WARNING",
        title: dateChanged ? "Zmieniono termin wizyty" : "Zaktualizowano termin",
        message: `${event.title} — nowy termin: ${formatWhen(event)}.`,
        entityType: "calendar_event",
        entityId: event.id,
        link: "/client/calendar"
      });
    }

    res.json(event);
  })
);

router.delete(
  "/events/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.query(`${eventSelect} WHERE e.id=$1`, [id]);
    const event = existing.rows[0];
    if (!event) return res.status(404).json({ error: "Nie znaleziono wydarzenia." });

    // Notify before deleting: createNotification verifies that a client owns the
    // event by reading the row, so after the DELETE the check would fail and the
    // cancellation notice would be dropped without a trace.
    await notifyCompanyUsers(event.company_id, {
      category: "CALENDAR",
      type: "CALENDAR_EVENT_CANCELLED",
      priority: "WARNING",
      title: "Odwołano termin",
      message: `${event.title} — ${formatWhen(event)} został odwołany.`,
      entityType: "calendar_event",
      entityId: event.id,
      link: "/client/calendar"
    });

    await db.query("DELETE FROM calendar_events WHERE id=$1", [id]);

    res.json({ success: true });
  })
);

export default router;
