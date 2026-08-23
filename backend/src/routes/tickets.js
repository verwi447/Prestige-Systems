import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { normalizeRole } from "../middleware/access.js";
import { createNotification, notifyAdmins } from "../utils/notifications.js";

const router = express.Router();

const uploadDir = "uploads/tickets/";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${randomUUID()}${extension}`);
  }
});
const ticketAttachmentMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
const ticketAttachmentExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf", ".doc", ".docx"]);
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    if (!ticketAttachmentMimeTypes.has(file.mimetype) || !ticketAttachmentExtensions.has(extension)) {
      return cb(new Error("Zalacznik musi byc plikiem JPG, PNG, WEBP, PDF, DOC albo DOCX."));
    }
    cb(null, true);
  }
});

function handleCommentAttachments(req, res, next) {
  upload.array("attachments", 10)(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      removeUploadedFiles(req.files || []);
      return res.status(400).json({ error: "Zalacznik moze miec maksymalnie 20 MB." });
    }
    if (error) {
      removeUploadedFiles(req.files || []);
      return res.status(400).json({ error: error.message || "Nie udalo sie dodac zalacznika." });
    }
    next();
  });
}

const statusAliases = {
  NOWE: "NEW",
  PRZYJETE: "ACCEPTED",
  PRZYJETE_DO_REALIZACJI: "ACCEPTED",
  W_REALIZACJI: "IN_PROGRESS",
  OCZEKUJE_NA_KLIENTA: "WAITING_FOR_CLIENT",
  OCZEKUJE_NA_CZESCI: "WAITING_FOR_PARTS",
  ODRZUCONE: "REJECTED",
  ZAKONCZONE: "COMPLETED",
  ANULOWANE: "CANCELLED"
};
const ticketStatuses = new Set(["NEW", "ACCEPTED", "IN_PROGRESS", "WAITING_FOR_CLIENT", "WAITING_FOR_PARTS", "REJECTED", "COMPLETED", "CANCELLED"]);
const priorityAliases = { NISKI: "LOW", NORMALNY: "NORMAL", WYSOKI: "HIGH", KRYTYCZNY: "CRITICAL" };
const ticketPriorities = new Set(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
const serviceTicketTypes = new Set(["SYSTEM_FAILURE", "HARDWARE_FAILURE"]);
const terminalTicketStatuses = new Set(["REJECTED", "COMPLETED", "CANCELLED"]);

const normalizeTicketStatus = (status) => {
  const raw = String(status || "").toUpperCase();
  if (ticketStatuses.has(raw)) return raw;
  if (statusAliases[raw]) return statusAliases[raw];
  if (raw.includes("REALIZ")) return "IN_PROGRESS";
  if (raw.includes("KLIENT")) return "WAITING_FOR_CLIENT";
  if (raw.includes("CZES") || raw.includes("PART")) return "WAITING_FOR_PARTS";
  if (raw.includes("ODRZ") || raw.includes("REJECT")) return "REJECTED";
  if (raw.includes("ZAKO") || raw.includes("CLOSE") || raw.includes("COMPLETE")) return "COMPLETED";
  if (raw.includes("ANUL") || raw.includes("CANCEL")) return "CANCELLED";
  if (raw.includes("PRZY") || raw.includes("ACCEPT")) return "ACCEPTED";
  return "NEW";
};

const normalizeTicketPriority = (priority) => {
  const raw = String(priority || "").toUpperCase();
  if (ticketPriorities.has(raw)) return raw;
  if (priorityAliases[raw]) return priorityAliases[raw];
  if (raw.includes("KRYT") || raw.includes("CRIT")) return "CRITICAL";
  if (raw.includes("WYS") || raw.includes("HIGH")) return "HIGH";
  if (raw.includes("NIS") || raw.includes("LOW")) return "LOW";
  return "NORMAL";
};

const normalizeTicketType = (type) => {
  if (["SYSTEM_FAILURE", "HARDWARE_FAILURE", "ORDER"].includes(type)) return type;
  const value = String(type || "").toUpperCase();
  if (value.includes("ZAM")) return "ORDER";
  if (value.includes("SPRZ") || value.includes("HARDWARE")) return "HARDWARE_FAILURE";
  return "SYSTEM_FAILURE";
};

function requireAdmin(req, res, next) {
  if (normalizeRole(req.user?.role) !== "ADMIN") return res.status(403).json({ error: "Brak dostepu do tej operacji." });
  next();
}

async function addHistory(client, ticketId, userId, action, oldValue = null, newValue = null, metadata = {}) {
  await client.query(
    `INSERT INTO ticket_history (ticket_id, user_id, action, old_value, new_value, metadata)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [ticketId, userId || null, action, oldValue, newValue, JSON.stringify(metadata || {})]
  );
}

async function auditTicket(_client, _action, _userId, _ticketId, _metadata = {}) {
  // TODO: wire to a global audit log when the app exposes a shared audit table.
}

async function generateTicketNumber() {
  const year = new Date().getFullYear();
  const result = await db.query("SELECT COUNT(*) FROM tickets WHERE EXTRACT(YEAR FROM created_at) = $1", [year]);
  return `ZG/${year}/${String(parseInt(result.rows[0].count, 10) + 1).padStart(3, "0")}`;
}

function authorName(row) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || row.username || "-";
}

function attachmentUrl(_fileName, attachmentId) {
  return `/api/files/ticket-attachments/${attachmentId}`;
}

function removeUploadedFiles(files = []) {
  for (const file of files) {
    if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
  }
}

function toBoolean(value) {
  return value === true || value === "true" || value === "1";
}

async function getTicketPayload(ticketId, user) {
  const isAdmin = normalizeRole(user.role) === "ADMIN";
  const params = [ticketId];
  let accessSql = "";
  if (!isAdmin) {
    params.push(user.id);
    accessSql = `
      AND EXISTS (
        SELECT 1
        FROM customers access_customer
        LEFT JOIN customers me ON me.user_id=$2
        WHERE access_customer.id=t.customer_id
          AND (
            access_customer.user_id=$2
            OR (me.company_id IS NOT NULL AND access_customer.company_id=me.company_id)
          )
      )`;
  }

  const ticket = await db.query(
    `SELECT t.id, t.ticket_number, t.type, t.subject, t.description, t.object_id, t.customer_id,
            COALESCE(t.status, 'NEW') AS status,
            COALESCE(t.priority, 'NORMAL') AS priority,
            COALESCE(t.blocks_work, FALSE) AS blocks_work,
            t.contact_name, t.contact_phone, t.category, COALESCE(t.source, 'Portal klienta') AS source,
            t.sla_due_at, t.closed_at, t.created_at, COALESCE(t.updated_at, t.created_at) AS updated_at,
            o.name AS object_name, o.address AS object_address, o.postal_code AS object_postal_code,
            o.city AS object_city, o.image_url AS object_image_url,
            c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
            co.id AS company_id, co.name AS company_name,
            co.address AS company_address, co.postal_code AS company_postal_code, co.city AS company_city,
            creator.id AS created_by_id, creator.first_name AS created_by_first_name, creator.last_name AS created_by_last_name,
            creator.email AS created_by_email, creator.phone AS created_by_phone,
            assignee.id AS assigned_to_id, assignee.first_name AS assigned_first_name, assignee.last_name AS assigned_last_name,
            assignee.email AS assigned_email, assignee.phone AS assigned_phone
     FROM tickets t
     LEFT JOIN objects o ON o.id=t.object_id
     LEFT JOIN customers c ON c.id=t.customer_id
     LEFT JOIN companies co ON co.id=c.company_id
     LEFT JOIN users creator ON creator.id=t.created_by
     LEFT JOIN users assignee ON assignee.id=t.assigned_to_id
     WHERE t.id=$1 ${accessSql}`,
    params
  );

  const row = ticket.rows[0];
  if (!row) return null;

  const commentFilter = isAdmin ? "" : "AND COALESCE(tc.is_internal, FALSE)=FALSE";
  const [items, attachments, comments, history, offers] = await Promise.all([
    db.query("SELECT * FROM ticket_items WHERE ticket_id=$1 ORDER BY id", [ticketId]),
    db.query(
      `SELECT tp.id, tp.ticket_comment_id, tp.file_name, COALESCE(tp.original_name, tp.file_name) AS original_name,
              COALESCE(tp.mime_type, '') AS mime_type, tp.file_size, COALESCE(tp.visibility, 'PUBLIC') AS visibility,
              tp.uploaded_at, u.id AS author_id, u.role AS author_role, u.first_name, u.last_name, u.email
       FROM ticket_photos tp
       LEFT JOIN users u ON u.id=tp.uploaded_by
       WHERE tp.ticket_id=$1 ${isAdmin ? "" : "AND COALESCE(tp.visibility, 'PUBLIC')='PUBLIC'"}
       ORDER BY tp.uploaded_at DESC`,
      [ticketId]
    ),
    db.query(
      `SELECT tc.id, tc.content, COALESCE(tc.is_internal, FALSE) AS is_internal,
              COALESCE(tc.is_ai_generated, FALSE) AS is_ai_generated, tc.created_at,
              u.id AS author_id, u.role AS author_role, u.first_name, u.last_name, u.email
       FROM ticket_comments tc
       LEFT JOIN users u ON u.id=tc.author_id
       WHERE tc.ticket_id=$1 ${commentFilter}
       ORDER BY tc.created_at ASC`,
      [ticketId]
    ),
    db.query(
      `SELECT th.*, u.first_name, u.last_name, u.email, u.role AS author_role
       FROM ticket_history th
       LEFT JOIN users u ON u.id=th.user_id
       WHERE th.ticket_id=$1
       ORDER BY th.created_at ASC`,
      [ticketId]
    ),
    db.query(
      `SELECT id, offer_number, title, status, total_price, created_at
       FROM offers
       WHERE ticket_id=$1
       ORDER BY created_at DESC`,
      [ticketId]
    )
  ]);

  const normalizedComments = comments.rows.map((comment) => ({
    id: comment.id,
    content: comment.content,
    body: comment.content,
    isInternal: Boolean(comment.is_internal),
    isAiGenerated: Boolean(comment.is_ai_generated),
    createdAt: comment.created_at,
    authorId: comment.author_id,
    authorRole: comment.is_ai_generated ? "AI" : comment.author_role,
    authorName: comment.is_ai_generated ? "Prestige Systems" : authorName(comment)
  }));

  const normalizedAttachments = attachments.rows.map((file) => ({
    id: file.id,
    commentId: file.ticket_comment_id,
    ticket_comment_id: file.ticket_comment_id,
    fileName: file.file_name,
    file_name: file.file_name,
    originalName: file.original_name,
    original_name: file.original_name,
    mimeType: file.mime_type,
    mime_type: file.mime_type,
    sizeBytes: file.file_size,
    file_size: file.file_size,
    visibility: file.visibility,
    uploadedAt: file.uploaded_at,
    uploaded_at: file.uploaded_at,
    authorName: authorName(file),
    authorRole: file.author_role,
    url: attachmentUrl(file.file_name, file.id)
  }));

  const fallbackHistory = [
    { id: "created", action: "TICKET_CREATED", label: "Utworzono zgloszenie", createdAt: row.created_at, authorName: authorName({ first_name: row.created_by_first_name, last_name: row.created_by_last_name, email: row.created_by_email }) },
    ...normalizedComments.map((comment) => ({
      id: `comment-${comment.id}`,
      action: comment.isInternal ? "TICKET_INTERNAL_NOTE_ADDED" : "TICKET_COMMENT_ADDED",
      label: comment.isInternal ? "Dodano notatke wewnetrzna" : "Dodano komentarz publiczny",
      createdAt: comment.createdAt,
      authorName: comment.authorName
    })),
    ...normalizedAttachments.map((file) => ({
      id: `attachment-${file.id}`,
      action: "TICKET_ATTACHMENT_ADDED",
      label: `Dodano zalacznik ${file.originalName || file.fileName}`,
      createdAt: file.uploadedAt,
      authorName: file.authorName
    }))
  ];

  const normalizedHistory = history.rows.length
    ? history.rows.map((entry) => ({
        id: entry.id,
        action: entry.action,
        oldValue: entry.old_value,
        newValue: entry.new_value,
        metadata: entry.metadata || {},
        label: entry.metadata?.label || historyLabel(entry),
        createdAt: entry.created_at,
        authorName: authorName(entry),
        authorRole: entry.author_role
      }))
    : fallbackHistory.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return {
    id: row.id,
    number: row.ticket_number,
    ticket_number: row.ticket_number,
    type: normalizeTicketType(row.type),
    title: row.subject,
    subject: row.subject,
    description: row.description,
    status: normalizeTicketStatus(row.status),
    priority: normalizeTicketPriority(row.priority),
    blocksWork: Boolean(row.blocks_work),
    category: row.category || (normalizeTicketType(row.type) === "HARDWARE_FAILURE" ? "Awaria urzadzenia" : "Zgloszenie serwisowe"),
    source: row.source || "Portal klienta",
    slaDueAt: row.sla_due_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    created_at: row.created_at,
    lastActivityAt: row.updated_at || row.created_at,
    updated_at: row.updated_at || row.created_at,
    companyId: row.company_id,
    companyName: row.company_name || row.customer_name,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    siteId: row.object_id,
    siteName: row.object_name,
    siteAddress: [row.object_address, row.object_city].filter(Boolean).join(", "),
    site: {
      id: row.object_id,
      name: row.object_name,
      address: row.object_address,
      postalCode: row.object_postal_code,
      city: row.object_city,
      imageUrl: row.object_image_url
    },
    reportedBy: {
      id: row.created_by_id,
      name: authorName({ first_name: row.created_by_first_name, last_name: row.created_by_last_name, email: row.created_by_email }),
      email: row.created_by_email,
      phone: row.created_by_phone || row.contact_phone
    },
    createdByName: authorName({ first_name: row.created_by_first_name, last_name: row.created_by_last_name, email: row.created_by_email }),
    contactName: row.contact_name || authorName({ first_name: row.created_by_first_name, last_name: row.created_by_last_name, email: row.created_by_email }),
    contactEmail: row.created_by_email,
    contactPhone: row.contact_phone || row.created_by_phone,
    assignedToId: row.assigned_to_id,
    assignedToName: [row.assigned_first_name, row.assigned_last_name].filter(Boolean).join(" ") || null,
    assignedToEmail: row.assigned_email,
    assignedToPhone: row.assigned_phone,
    assignedTo: row.assigned_to_id
      ? { id: row.assigned_to_id, name: [row.assigned_first_name, row.assigned_last_name].filter(Boolean).join(" ") || row.assigned_email, email: row.assigned_email, phone: row.assigned_phone }
      : null,
    items: items.rows,
    attachments: normalizedAttachments,
    comments: normalizedComments,
    history: normalizedHistory,
    offers: offers.rows.map((offer) => ({
      id: offer.id,
      number: offer.offer_number,
      offer_number: offer.offer_number,
      title: offer.title,
      status: offer.status,
      totalPrice: offer.total_price,
      createdAt: offer.created_at
    }))
  };
}

function historyLabel(entry) {
  const labels = {
    TICKET_CREATED: "Utworzono zgloszenie",
    TICKET_STATUS_CHANGED: `Status zmieniono z ${entry.old_value || "-"} na ${entry.new_value || "-"}`,
    TICKET_PRIORITY_CHANGED: `Priorytet zmieniono z ${entry.old_value || "-"} na ${entry.new_value || "-"}`,
    TICKET_ASSIGNED: "Zmieniono przypisanie",
    TICKET_COMMENT_ADDED: "Dodano komentarz publiczny",
    TICKET_INTERNAL_NOTE_ADDED: "Dodano notatke wewnetrzna",
    TICKET_ATTACHMENT_ADDED: "Dodano zalacznik",
    TICKET_ATTACHMENT_DELETED: "Usunieto zalacznik",
    TICKET_CLOSED: "Zamknieto zgloszenie",
    TICKET_OFFER_CREATED: "Utworzono szkic oferty"
  };
  return labels[entry.action] || entry.action;
}

router.post("/", auth, upload.array("photos", 10), async (req, res) => {
  const { type, object_id, subject, description } = req.body;
  if (!type || !object_id || !subject) return res.status(400).json({ error: "Typ, obiekt i temat zgloszenia sa wymagane." });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const customerRes = await client.query("SELECT id, company_id FROM customers WHERE user_id=$1", [req.user.id]);
    if (!customerRes.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Tylko klienci moga tworzyc zgloszenia." });
    }

    const customerCompanyId = customerRes.rows[0].company_id;
    if (!customerCompanyId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Twoje konto nie jest przypisane do zadnej firmy." });
    }
    const siteRes = await client.query("SELECT id FROM objects WHERE id=$1 AND company_id=$2", [object_id, customerCompanyId]);
    if (!siteRes.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Wybrany obiekt nie istnieje albo nie nalezy do Twojej firmy." });
    }

    const ticketNumber = await generateTicketNumber();
    const ticket = await client.query(
      `INSERT INTO tickets (ticket_number, type, object_id, subject, description, customer_id, created_by, status, priority, source, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'NEW',$8,'Portal klienta',CURRENT_TIMESTAMP)
       RETURNING *`,
      [ticketNumber, normalizeTicketType(type), object_id, subject, description, customerRes.rows[0].id, req.user.id, normalizeTicketPriority(req.body.priority)]
    );

    await addHistory(client, ticket.rows[0].id, req.user.id, "TICKET_CREATED", null, ticketNumber);

    for (const photo of req.files || []) {
      await client.query(
        `INSERT INTO ticket_photos (ticket_id, file_name, original_name, file_path, file_size, mime_type, uploaded_by, visibility)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'PUBLIC')`,
        [ticket.rows[0].id, photo.filename, photo.originalname, photo.path, photo.size, photo.mimetype, req.user.id]
      );
      await addHistory(client, ticket.rows[0].id, req.user.id, "TICKET_ATTACHMENT_ADDED", null, photo.originalname);
    }

    await client.query("COMMIT");
    const isOrder = ticket.rows[0].type === "ORDER";
    await notifyAdmins({ category: "TICKETS", type: isOrder ? "ORDER_CREATED" : "TICKET_CREATED", priority: "INFO", title: isOrder ? "Nowe zamowienie" : "Nowe zgloszenie", message: `${ticketNumber}: ${subject}`, entityType: "ticket", entityId: ticket.rows[0].id, link: isOrder ? "/orders" : `/tickets/${ticket.rows[0].id}` });
    res.status(201).json(ticket.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Blad przy tworzeniu zgloszenia:", err);
    res.status(500).json({ error: "Blad serwera przy tworzeniu zgloszenia." });
  } finally {
    client.release();
  }
});

router.get("/", auth, requireAdmin, async (req, res) => {
  try {
    const role = normalizeRole(req.user.role);
    const params = [];
    let whereSql = "WHERE t.type <> 'ORDER'";
    if (role !== "ADMIN") {
      const customerRes = await db.query("SELECT id, company_id FROM customers WHERE user_id=$1", [req.user.id]);
      if (!customerRes.rows[0]) return res.json([]);
      const customer = customerRes.rows[0];
      if (customer.company_id) {
        const companyCustomers = await db.query("SELECT id FROM customers WHERE company_id=$1", [customer.company_id]);
        params.push(companyCustomers.rows.map((row) => row.id));
        whereSql = "WHERE t.type <> 'ORDER' AND t.customer_id = ANY($1::int[])";
      } else {
        params.push(customer.id);
        whereSql = "WHERE t.type <> 'ORDER' AND t.customer_id=$1";
      }
    }

    const result = await db.query(
      `SELECT t.*, o.name AS object_name, o.address AS object_address, o.city AS object_city,
              c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
              co.name AS company_name,
              creator.first_name AS created_by_first_name, creator.last_name AS created_by_last_name,
              assignee.first_name AS assigned_first_name, assignee.last_name AS assigned_last_name, assignee.email AS assigned_email,
              (SELECT COUNT(*)::int FROM ticket_comments tc WHERE tc.ticket_id=t.id) AS comment_count,
              (SELECT COUNT(*)::int FROM ticket_photos tp WHERE tp.ticket_id=t.id) AS attachment_count
       FROM tickets t
       LEFT JOIN objects o ON t.object_id=o.id
       LEFT JOIN customers c ON c.id=t.customer_id
       LEFT JOIN companies co ON co.id=c.company_id
       LEFT JOIN users creator ON creator.id=t.created_by
       LEFT JOIN users assignee ON assignee.id=t.assigned_to_id
       ${whereSql}
       ORDER BY COALESCE(t.updated_at, t.created_at) DESC`,
      params
    );
    res.json(result.rows.map((row) => ({ ...row, status: normalizeTicketStatus(row.status), priority: normalizeTicketPriority(row.priority) })));
  } catch (err) {
    console.error("Blad przy pobieraniu zgloszen:", err);
    res.status(500).json({ error: "Blad serwera przy pobieraniu zgloszen." });
  }
});

router.get("/assignees/admins", auth, requireAdmin, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, first_name, last_name, email, phone, is_active
       FROM users
       WHERE role='ADMIN' AND is_active IS DISTINCT FROM FALSE
       ORDER BY last_name, first_name, email`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Nie udalo sie pobrac administratorow." });
  }
});

router.get("/:id", auth, requireAdmin, async (req, res) => {
  try {
    const ticket = await getTicketPayload(req.params.id, req.user);
    if (!ticket) return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
    res.json(ticket);
  } catch (err) {
    console.error("Blad przy pobieraniu szczegolow zgloszenia:", err);
    res.status(500).json({ error: "Blad serwera przy pobieraniu szczegolow zgloszenia." });
  }
});

router.put("/:id", auth, requireAdmin, async (req, res) => {
  const fields = {
    subject: req.body.title ?? req.body.subject,
    description: req.body.description,
    category: req.body.category,
    source: req.body.source,
    sla_due_at: req.body.slaDueAt ?? req.body.sla_due_at
  };
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!entries.length) return res.status(400).json({ error: "Brak danych do aktualizacji." });
  const setSql = entries.map(([key], index) => `${key}=$${index + 1}`).join(", ");
  const values = entries.map(([, value]) => value || null);
  values.push(req.params.id);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`UPDATE tickets SET ${setSql}, updated_at=CURRENT_TIMESTAMP WHERE id=$${values.length} RETURNING id`, values);
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zgloszenie nie istnieje." });
    }
    await addHistory(client, req.params.id, req.user.id, "TICKET_UPDATED", null, null, { fields: entries.map(([key]) => key) });
    await auditTicket(client, "TICKET_UPDATED", req.user.id, req.params.id);
    await client.query("COMMIT");
    res.json(await getTicketPayload(req.params.id, req.user));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Nie udalo sie zaktualizowac zgloszenia." });
  } finally {
    client.release();
  }
});

router.post("/:id/change-status", auth, requireAdmin, async (req, res) => {
  const status = normalizeTicketStatus(req.body.status);
  if (!ticketStatuses.has(status)) return res.status(400).json({ error: "Nieprawidlowy status zgloszenia." });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT status, customer_id, ticket_number, subject FROM tickets WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zgloszenie nie istnieje." });
    }
    await client.query(
      `UPDATE tickets
       SET status=$1,
           assigned_to_id=CASE WHEN $1='NEW' THEN NULL ELSE assigned_to_id END,
           updated_at=CURRENT_TIMESTAMP,
           closed_at=CASE WHEN $1='COMPLETED' THEN COALESCE(closed_at, CURRENT_TIMESTAMP) ELSE closed_at END
       WHERE id=$2`,
      [status, req.params.id]
    );
    await addHistory(client, req.params.id, req.user.id, "TICKET_STATUS_CHANGED", normalizeTicketStatus(current.rows[0].status), status, { comment: req.body.comment || null });
    if (req.body.publicComment && req.body.comment) {
      await client.query("INSERT INTO ticket_comments (ticket_id, author_id, content, is_internal) VALUES ($1,$2,$3,FALSE)", [req.params.id, req.user.id, req.body.comment]);
    }
    await auditTicket(client, "TICKET_STATUS_CHANGED", req.user.id, req.params.id, { status });
    await client.query("COMMIT");
    if (req.body.notifyClient) await notifyTicketCustomer(current.rows[0], "TICKET_STATUS_CHANGED", "Status zgloszenia zostal zmieniony");
    res.json(await getTicketPayload(req.params.id, req.user));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Nie udalo sie zmienic statusu zgloszenia." });
  } finally {
    client.release();
  }
});

router.post("/bulk-change-status", auth, requireAdmin, async (req, res) => {
  const status = normalizeTicketStatus(req.body.status);
  if (!ticketStatuses.has(status)) return res.status(400).json({ error: "Nieprawidlowy status zgloszenia." });
  const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(Number).filter(Number.isInteger))] : [];
  if (!ids.length) return res.status(400).json({ error: "Brak wybranych zgloszen." });

  const updated = [];
  const failed = [];

  for (const id of ids) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query("SELECT status, customer_id, ticket_number, subject FROM tickets WHERE id=$1 FOR UPDATE", [id]);
      if (!current.rows[0]) {
        await client.query("ROLLBACK");
        failed.push({ id, error: "Zgloszenie nie istnieje." });
        continue;
      }
      await client.query(
        `UPDATE tickets
         SET status=$1,
             assigned_to_id=CASE WHEN $1='NEW' THEN NULL ELSE assigned_to_id END,
             updated_at=CURRENT_TIMESTAMP,
             closed_at=CASE WHEN $1='COMPLETED' THEN COALESCE(closed_at, CURRENT_TIMESTAMP) ELSE closed_at END
         WHERE id=$2`,
        [status, id]
      );
      await addHistory(client, id, req.user.id, "TICKET_STATUS_CHANGED", normalizeTicketStatus(current.rows[0].status), status, { bulk: true });
      await auditTicket(client, "TICKET_STATUS_CHANGED", req.user.id, id, { status });
      await client.query("COMMIT");
      updated.push(id);
    } catch (err) {
      await client.query("ROLLBACK");
      failed.push({ id, error: "Nie udalo sie zmienic statusu." });
    } finally {
      client.release();
    }
  }

  res.json({ updated, failed });
});

router.post("/:id/change-priority", auth, requireAdmin, async (req, res) => {
  const priority = normalizeTicketPriority(req.body.priority);
  if (!ticketPriorities.has(priority)) return res.status(400).json({ error: "Nieprawidlowy priorytet zgloszenia." });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT priority FROM tickets WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zgloszenie nie istnieje." });
    }
    await client.query("UPDATE tickets SET priority=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2", [priority, req.params.id]);
    await addHistory(client, req.params.id, req.user.id, "TICKET_PRIORITY_CHANGED", normalizeTicketPriority(current.rows[0].priority), priority);
    await auditTicket(client, "TICKET_PRIORITY_CHANGED", req.user.id, req.params.id, { priority });
    await client.query("COMMIT");
    res.json(await getTicketPayload(req.params.id, req.user));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Nie udalo sie zmienic priorytetu zgloszenia." });
  } finally {
    client.release();
  }
});

router.post("/:id/assign", auth, requireAdmin, async (req, res) => {
  const adminId = req.body.adminId === null || req.body.adminId === "" ? null : Number(req.body.adminId);
  if (adminId !== null && !Number.isInteger(adminId)) return res.status(400).json({ error: "Nieprawidlowy administrator." });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (adminId !== null) {
      const admin = await client.query("SELECT id FROM users WHERE id=$1 AND role='ADMIN' AND is_active IS DISTINCT FROM FALSE", [adminId]);
      if (!admin.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Zgloszenie mozna przypisac tylko do aktywnego administratora." });
      }
    }
    const current = await client.query("SELECT assigned_to_id, status, type FROM tickets WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zgloszenie nie istnieje." });
    }
    const currentStatus = normalizeTicketStatus(current.rows[0].status);
    const nextStatus = adminId !== null && serviceTicketTypes.has(current.rows[0].type) && !terminalTicketStatuses.has(currentStatus)
      ? "IN_PROGRESS"
      : current.rows[0].status;
    const statusChanged = currentStatus !== normalizeTicketStatus(nextStatus);
    await client.query(
      `UPDATE tickets
       SET assigned_to_id=$1,
           status=$2,
           updated_at=CURRENT_TIMESTAMP
       WHERE id=$3`,
      [adminId, nextStatus, req.params.id]
    );
    await addHistory(client, req.params.id, req.user.id, "TICKET_ASSIGNED", current.rows[0].assigned_to_id, adminId);
    if (statusChanged) {
      await addHistory(client, req.params.id, req.user.id, "TICKET_STATUS_CHANGED", currentStatus, normalizeTicketStatus(nextStatus), { automatic: true, trigger: "ASSIGNEE_SET" });
    }
    await auditTicket(client, "TICKET_ASSIGNED", req.user.id, req.params.id, { adminId, status: normalizeTicketStatus(nextStatus) });
    await client.query("COMMIT");
    res.json(await getTicketPayload(req.params.id, req.user));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Nie udalo sie przypisac zgloszenia." });
  } finally {
    client.release();
  }
});

router.post("/:id/close", auth, requireAdmin, async (req, res) => {
  const summary = String(req.body.summary || "").trim();
  if (!summary) return res.status(400).json({ error: "Podsumowanie rozwiazania jest wymagane." });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const ticket = await client.query("SELECT id, customer_id, ticket_number, subject FROM tickets WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!ticket.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zgloszenie nie istnieje." });
    }
    await client.query("UPDATE tickets SET status='COMPLETED', closed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1", [req.params.id]);
    await client.query("INSERT INTO ticket_comments (ticket_id, author_id, content, is_internal) VALUES ($1,$2,$3,FALSE)", [req.params.id, req.user.id, summary]);
    await addHistory(client, req.params.id, req.user.id, "TICKET_CLOSED", null, "COMPLETED", { summary });
    await auditTicket(client, "TICKET_CLOSED", req.user.id, req.params.id);
    await client.query("COMMIT");
    if (req.body.notifyClient) await notifyTicketCustomer(ticket.rows[0], "TICKET_CLOSED", "Zgloszenie zostalo zakonczone");
    res.json(await getTicketPayload(req.params.id, req.user));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Nie udalo sie zamknac zgloszenia." });
  } finally {
    client.release();
  }
});

router.get("/:id/comments", auth, requireAdmin, async (req, res) => {
  const ticket = await getTicketPayload(req.params.id, req.user);
  if (!ticket) return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
  res.json(ticket.comments);
});

router.post("/:id/comments", auth, requireAdmin, handleCommentAttachments, async (req, res) => {
  const content = String(req.body.content ?? req.body.body ?? "").trim();
  const files = req.files || [];
  const isInternal = toBoolean(req.body.isInternal ?? req.body.is_internal);
  const isAdmin = normalizeRole(req.user.role) === "ADMIN";
  if (!content && !files.length) return res.status(400).json({ error: "Dodaj tresc komentarza albo zalacznik." });
  if (isInternal && !isAdmin) return res.status(403).json({ error: "Tylko administrator moze dodac notatke wewnetrzna." });

  const existing = await getTicketPayload(req.params.id, req.user);
  if (!existing) {
    removeUploadedFiles(files);
    return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT type, status FROM tickets WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
    }
    const currentStatus = normalizeTicketStatus(current.rows[0].status);
    const nextStatus = !isInternal && serviceTicketTypes.has(current.rows[0].type) && !terminalTicketStatuses.has(currentStatus)
      ? "WAITING_FOR_CLIENT"
      : current.rows[0].status;
    const statusChanged = currentStatus !== normalizeTicketStatus(nextStatus);
    const comment = await client.query(
      `INSERT INTO ticket_comments (ticket_id, author_id, content, is_internal)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [req.params.id, req.user.id, content || "Dodano zalacznik.", isInternal]
    );
    const visibility = isInternal ? "INTERNAL" : "PUBLIC";
    for (const file of files) {
      await client.query(
        `INSERT INTO ticket_photos (ticket_id, ticket_comment_id, file_name, original_name, file_path, file_size, mime_type, uploaded_by, visibility)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.params.id, comment.rows[0].id, file.filename, file.originalname, file.path, file.size, file.mimetype, req.user.id, visibility]
      );
      await addHistory(client, req.params.id, req.user.id, "TICKET_ATTACHMENT_ADDED", null, file.originalname, { visibility, commentId: comment.rows[0].id });
    }
    await client.query("UPDATE tickets SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2", [nextStatus, req.params.id]);
    await addHistory(client, req.params.id, req.user.id, isInternal ? "TICKET_INTERNAL_NOTE_ADDED" : "TICKET_COMMENT_ADDED", null, null);
    if (statusChanged) {
      await addHistory(client, req.params.id, req.user.id, "TICKET_STATUS_CHANGED", currentStatus, normalizeTicketStatus(nextStatus), { automatic: true, trigger: "ADMIN_COMMENT" });
    }
    await auditTicket(client, isInternal ? "TICKET_INTERNAL_NOTE_ADDED" : "TICKET_COMMENT_ADDED", req.user.id, req.params.id);
    await client.query("COMMIT");
    if (!isInternal && isAdmin) await notifyTicketCustomer(existing, "TICKET_COMMENT_ADDED", "Dodano komentarz do zgloszenia");
    res.status(201).json(await getTicketPayload(req.params.id, req.user));
  } catch (err) {
    await client.query("ROLLBACK");
    removeUploadedFiles(files);
    res.status(500).json({ error: "Nie udalo sie dodac komentarza." });
  } finally {
    client.release();
  }
});

export async function postAiCommentAsPublic(ticketId, content) {
  const existing = await getTicketPayload(ticketId, { id: null, role: "ADMIN" });
  if (!existing) return false;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT type, status FROM tickets WHERE id=$1 FOR UPDATE", [ticketId]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }
    const currentStatus = normalizeTicketStatus(current.rows[0].status);
    const nextStatus = serviceTicketTypes.has(current.rows[0].type) && !terminalTicketStatuses.has(currentStatus)
      ? "WAITING_FOR_CLIENT"
      : current.rows[0].status;
    const statusChanged = currentStatus !== normalizeTicketStatus(nextStatus);

    await client.query(
      `INSERT INTO ticket_comments (ticket_id, author_id, content, is_internal, is_ai_generated)
       VALUES ($1,NULL,$2,FALSE,TRUE)`,
      [ticketId, content]
    );
    await client.query("UPDATE tickets SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2", [nextStatus, ticketId]);
    await addHistory(client, ticketId, null, "TICKET_COMMENT_ADDED", null, null, { source: "AI" });
    if (statusChanged) {
      await addHistory(client, ticketId, null, "TICKET_STATUS_CHANGED", currentStatus, normalizeTicketStatus(nextStatus), { automatic: true, trigger: "AI_COMMENT" });
    }
    await client.query("COMMIT");
    await notifyTicketCustomer(existing, "TICKET_COMMENT_ADDED", "Dodano komentarz do zgloszenia");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    return false;
  } finally {
    client.release();
  }
}

router.get("/:id/attachments", auth, requireAdmin, async (req, res) => {
  const ticket = await getTicketPayload(req.params.id, req.user);
  if (!ticket) return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
  res.json(ticket.attachments);
});

router.post("/:id/attachments", auth, requireAdmin, upload.array("attachments", 10), async (req, res) => {
  const isAdmin = normalizeRole(req.user.role) === "ADMIN";
  const ticket = await getTicketPayload(req.params.id, req.user);
  if (!ticket) {
    (req.files || []).forEach((file) => fs.existsSync(file.path) && fs.unlinkSync(file.path));
    return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
  }
  const visibility = isAdmin && req.body.visibility === "INTERNAL" ? "INTERNAL" : "PUBLIC";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const file of req.files || []) {
      await client.query(
        `INSERT INTO ticket_photos (ticket_id, file_name, original_name, file_path, file_size, mime_type, uploaded_by, visibility)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.params.id, file.filename, file.originalname, file.path, file.size, file.mimetype, req.user.id, visibility]
      );
      await addHistory(client, req.params.id, req.user.id, "TICKET_ATTACHMENT_ADDED", null, file.originalname, { visibility });
    }
    await client.query("UPDATE tickets SET updated_at=CURRENT_TIMESTAMP WHERE id=$1", [req.params.id]);
    await auditTicket(client, "TICKET_ATTACHMENT_ADDED", req.user.id, req.params.id);
    await client.query("COMMIT");
    res.status(201).json(await getTicketPayload(req.params.id, req.user));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Nie udalo sie dodac zalacznika." });
  } finally {
    client.release();
  }
});

router.delete("/:id/attachments/:attachmentId", auth, requireAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const file = await client.query("DELETE FROM ticket_photos WHERE id=$1 AND ticket_id=$2 RETURNING *", [req.params.attachmentId, req.params.id]);
    if (!file.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zalacznik nie istnieje." });
    }
    const physicalPath = file.rows[0].file_path || path.join(uploadDir, file.rows[0].file_name);
    if (physicalPath && fs.existsSync(physicalPath)) fs.unlinkSync(physicalPath);
    await addHistory(client, req.params.id, req.user.id, "TICKET_ATTACHMENT_DELETED", file.rows[0].file_name, null);
    await auditTicket(client, "TICKET_ATTACHMENT_DELETED", req.user.id, req.params.id);
    await client.query("COMMIT");
    res.json(await getTicketPayload(req.params.id, req.user));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Nie udalo sie usunac zalacznika." });
  } finally {
    client.release();
  }
});

router.get("/:id/history", auth, requireAdmin, async (req, res) => {
  const ticket = await getTicketPayload(req.params.id, req.user);
  if (!ticket) return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
  res.json(ticket.history);
});

router.get("/:id/offers", auth, requireAdmin, async (req, res) => {
  const ticket = await getTicketPayload(req.params.id, req.user);
  if (!ticket) return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
  res.json(ticket.offers);
});

router.get("/:id/available-offers", auth, requireAdmin, async (req, res) => {
  const ticket = await db.query(
    `SELECT t.id, c.company_id
     FROM tickets t
     JOIN customers c ON c.id=t.customer_id
     WHERE t.id=$1`,
    [req.params.id]
  );
  if (!ticket.rows[0]) return res.status(404).json({ error: "Zgloszenie nie istnieje." });

  const offers = await db.query(
    `SELECT o.id, o.offer_number, o.title, o.status, o.total_price, o.created_at
     FROM offers o
     JOIN customers c ON c.id=o.customer_id
     WHERE c.company_id=$1 AND o.ticket_id IS NULL
     ORDER BY o.created_at DESC`,
    [ticket.rows[0].company_id]
  );
  res.json(offers.rows);
});

router.post("/:id/offers/:offerId", auth, requireAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const ticket = await client.query(
      `SELECT t.id, c.company_id
       FROM tickets t
       JOIN customers c ON c.id=t.customer_id
       WHERE t.id=$1 FOR UPDATE OF t`,
      [req.params.id]
    );
    if (!ticket.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zgloszenie nie istnieje." });
    }

    const offer = await client.query(
      `SELECT o.id, o.offer_number, o.ticket_id, c.company_id
       FROM offers o
       JOIN customers c ON c.id=o.customer_id
       WHERE o.id=$1 FOR UPDATE OF o`,
      [req.params.offerId]
    );
    if (!offer.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Oferta nie istnieje." });
    }
    if (Number(offer.rows[0].company_id) !== Number(ticket.rows[0].company_id)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Oferta nalezy do innej firmy." });
    }
    if (offer.rows[0].ticket_id) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Oferta jest juz powiazana ze zgloszeniem." });
    }

    await client.query("UPDATE offers SET ticket_id=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2", [req.params.id, req.params.offerId]);
    await addHistory(client, req.params.id, req.user.id, "TICKET_OFFER_LINKED", null, offer.rows[0].offer_number, { offerId: offer.rows[0].id });
    await auditTicket(client, "TICKET_OFFER_LINKED", req.user.id, req.params.id, { offerId: offer.rows[0].id });
    await client.query("COMMIT");
    res.json(await getTicketPayload(req.params.id, req.user));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Nie udalo sie powiazac oferty." });
  } finally {
    client.release();
  }
});

router.post("/:id/create-offer-draft", auth, requireAdmin, async (req, res) => {
  const ticket = await getTicketPayload(req.params.id, req.user);
  if (!ticket) return res.status(404).json({ error: "Zgloszenie nie istnieje." });
  res.json({ redirectTo: `/offers/new?ticketId=${req.params.id}`, ticket });
});

async function notifyTicketCustomer(ticket, type, title) {
  try {
    const result = await db.query(
      `SELECT u.id
       FROM tickets t
       JOIN customers c ON c.id=t.customer_id
       JOIN users u ON u.id=c.user_id
       WHERE t.id=$1 AND u.id IS NOT NULL`,
      [ticket.id]
    );
    for (const user of result.rows) {
      await createNotification({
        userId: user.id,
        category: "TICKETS",
        type,
        priority: "INFO",
        title,
        message: `${ticket.ticket_number || ticket.number}: ${ticket.subject || ticket.title}`,
        entityType: "ticket",
        entityId: ticket.id,
        link: `/client/tickets/${ticket.id}`
      });
    }
  } catch (err) {
    console.warn("Nie udalo sie wyslac powiadomienia klientowi:", err.message);
  }
}

export default router;
