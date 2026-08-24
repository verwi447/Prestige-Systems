import express from "express";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import multer from "multer";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { canAccessSite, getEffectivePermissions, loadCurrentUser, requireAnyPermission, requireClient, requireClientOwner, requirePermission } from "../middleware/access.js";
import { notifyAdmins } from "../utils/notifications.js";
import { markOfferLifecycle, synchronizeLinkedOrderStatus } from "../services/orderOfferWorkflow.js";
import { analyzeTicketWithAi, continueAiConversation } from "../services/aiAssistant.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { autoAsyncRoutes } from "../utils/autoAsyncRoutes.js";

const router = express.Router();
autoAsyncRoutes(router);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const siteUploadDir = path.join(__dirname, "../../uploads/sites");
const ticketUploadDir = path.join(__dirname, "../../uploads/tickets");
fs.mkdirSync(siteUploadDir, { recursive: true });
fs.mkdirSync(ticketUploadDir, { recursive: true });

const siteImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const siteImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const ticketAttachmentMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
const ticketAttachmentExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf", ".doc", ".docx"]);

const siteImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, siteUploadDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname || "").toLowerCase();
      cb(null, `${randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    if (!siteImageMimeTypes.has(file.mimetype) || !siteImageExtensions.has(extension)) {
      return cb(new Error("Zdjęcie obiektu musi być plikiem JPG, PNG albo WEBP."));
    }
    cb(null, true);
  }
});

const ticketAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ticketUploadDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname || "").toLowerCase();
      cb(null, `${randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    if (!ticketAttachmentMimeTypes.has(file.mimetype) || !ticketAttachmentExtensions.has(extension)) {
      return cb(new Error("Zalacznik musi byc plikiem JPG, PNG, WEBP, PDF, DOC albo DOCX."));
    }
    cb(null, true);
  }
});

router.use(auth, loadCurrentUser, requireClient);

const clientRoles = ["CLIENT_OWNER", "CLIENT_EMPLOYEE"];
const employeePermissions = new Set([
  "CREATE_TICKET",
  "VIEW_TICKETS",
  "COMMENT_TICKET",
  "VIEW_OFFERS",
  "ACCEPT_OFFERS",
  "VIEW_CATALOG",
  "MANAGE_SITES"
]);
const offerAcceptanceStatuses = ["WYSŁANA", "WYSĹANA", "DO AKCEPTACJI"];
const closedTicketStatuses = ["ZAKOŃCZONE", "ZAKOĹCZONE", "ZAKONCZONE", "ZAMKNIĘTE", "ZAMKNIÄTE", "ZAMKNIETE", "ANULOWANE"];

const hiddenClientOfferStatuses = ["SZKIC", "DRAFT"];
const clientOfferStatusesForDecision = ["WYSĹANA", "WYSÄąÂANA", "WYSŁANA", "DO AKCEPTACJI", "TO_ACCEPTANCE", "SENT"];

closedTicketStatuses.push("REJECTED", "COMPLETED", "CANCELLED");

const ticketTypes = new Set(["SYSTEM_FAILURE", "HARDWARE_FAILURE", "ORDER"]);
const ticketStatuses = new Set(["NEW", "ACCEPTED", "IN_PROGRESS", "WAITING_FOR_CLIENT", "WAITING_FOR_PARTS", "REJECTED", "COMPLETED", "CANCELLED"]);
const ticketPriorities = new Set(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
const serviceTicketTypes = new Set(["SYSTEM_FAILURE", "HARDWARE_FAILURE"]);
const terminalTicketStatuses = new Set(["REJECTED", "COMPLETED", "CANCELLED"]);

const companyIdFromUser = (req) => Number(req.currentUser.company_id);
const isClientEmployee = (req) => req.currentUser?.role === "CLIENT_EMPLOYEE";

function employeeSiteAccessSql(req, siteColumn, params) {
  if (!isClientEmployee(req)) return "";
  params.push(req.currentUser.id);
  return ` AND EXISTS (
    SELECT 1 FROM user_site_access usa
    WHERE usa.site_id=${siteColumn} AND usa.user_id=$${params.length}
  )`;
}

async function canAccessClientSite(req, siteId) {
  return !isClientEmployee(req) || canAccessSite(req.currentUser, siteId);
}

const normalizeOffer = (offer) => ({
  id: offer.id,
  number: offer.offer_number,
  title: offer.title,
  status: offer.status,
  validUntil: offer.valid_until,
  totalNet: Number(offer.total_price || 0),
  totalGross: Number(offer.gross_total || offer.total_price || 0),
  createdAt: offer.created_at,
  updatedAt: offer.updated_at,
  site: offer.object_id ? { id: offer.object_id, name: offer.object_name } : null
});

const normalizeTicket = (ticket) => ({
  id: ticket.id,
  number: ticket.ticket_number,
  ticket_number: ticket.ticket_number,
  type: ticket.type,
  title: ticket.subject,
  subject: ticket.subject,
  description: ticket.description,
  siteId: ticket.object_id,
  siteName: ticket.object_name,
  siteAddress: [ticket.object_address, ticket.object_city].filter(Boolean).join(", "),
  status: normalizeLegacyStatus(ticket.status),
  priority: ticket.priority || "NORMAL",
  blocksWork: Boolean(ticket.blocks_work),
  contactName: ticket.contact_name,
  contactPhone: ticket.contact_phone,
  lastActivityAt: ticket.updated_at || ticket.created_at,
  createdAt: ticket.created_at,
  created_at: ticket.created_at,
  updated_at: ticket.updated_at || ticket.created_at,
  attachmentsCount: Number(ticket.attachments_count || 0),
  itemsCount: Number(ticket.items_count || 0),
  items: ticket.items || []
});

const normalizeSite = (site) => ({
  id: site.id,
  name: site.name,
  address: site.address,
  postalCode: site.postal_code,
  city: site.city,
  country: site.country,
  description: site.description,
  imageUrl: site.image_url,
  status: site.status || (site.is_active === false ? "Nieaktywny" : "Aktywny"),
  isActive: site.is_active !== false,
  openTicketsCount: Number(site.open_tickets_count || 0)
});

function handleSiteUpload(req, res, next) {
  siteImageUpload.single("image")(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Zdjęcie obiektu może mieć maksymalnie 5 MB." });
    }
    if (error) return res.status(400).json({ error: error.message || "Nie udało się wysłać zdjęcia obiektu." });
    next();
  });
}

function handleTicketAttachments(req, res, next) {
  ticketAttachmentUpload.array("attachments", 10)(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Zalacznik moze miec maksymalnie 20 MB." });
    }
    if (error) return res.status(400).json({ error: error.message || "Nie udalo sie wyslac zalacznika." });
    next();
  });
}

function removeUploadedFile(file) {
  if (!file?.path) return;
  fs.unlink(file.path, () => {});
}

async function getEmployeeDashboard(req, companyId, permissions) {
  const userId = req.currentUser.id;
  const canViewTickets = permissions.has("VIEW_TICKETS");
  const canViewOffers = permissions.has("VIEW_OFFERS");
  const siteScope = (column) => `EXISTS (
    SELECT 1 FROM user_site_access usa
    WHERE usa.site_id=${column} AND usa.user_id=$2
  )`;
  const noRows = Promise.resolve({ rows: [] });
  const zeroCount = Promise.resolve({ rows: [{ count: 0 }] });

  const [company, sites, offersCount, offersToAcceptCount, openTicketsCount, recentTickets, offersToAccept, offerActivity, ticketActivity] = await Promise.all([
    db.query(
      `SELECT id, name, nip, regon, address, postal_code, city, country, email, phone,
              is_active, description, contact_person, created_at, updated_at
       FROM companies
       WHERE id=$1 AND COALESCE(is_own_company, FALSE)=FALSE`,
      [companyId]
    ),
    db.query(
      `SELECT o.id, o.name, o.address, o.postal_code, o.city, o.country, o.description, o.image_url,
              o.status, o.is_active,
              (SELECT COUNT(*)::int
               FROM tickets t
               JOIN customers c ON c.id=t.customer_id
               WHERE t.object_id=o.id
                 AND c.company_id=$1
                 AND COALESCE(t.status, '') <> ALL($3::text[])) AS open_tickets_count
       FROM objects o
       WHERE o.company_id=$1 AND ${siteScope("o.id")}
       ORDER BY o.created_at DESC
       LIMIT 4`,
      [companyId, userId, closedTicketStatuses]
    ),
    canViewOffers
      ? db.query(
        `SELECT COUNT(*)::int AS count
         FROM offers o
         JOIN customers c ON c.id=o.customer_id
         WHERE c.company_id=$1 AND ${siteScope("o.object_id")}`,
        [companyId, userId]
      )
      : zeroCount,
    canViewOffers
      ? db.query(
        `SELECT COUNT(*)::int AS count
         FROM offers o
         JOIN customers c ON c.id=o.customer_id
         WHERE c.company_id=$1 AND ${siteScope("o.object_id")} AND o.status = ANY($3::text[])`,
        [companyId, userId, offerAcceptanceStatuses]
      )
      : zeroCount,
    canViewTickets
      ? db.query(
        `SELECT COUNT(*)::int AS count
         FROM tickets t
         JOIN customers c ON c.id=t.customer_id
         WHERE c.company_id=$1
           AND ${siteScope("t.object_id")}
           AND t.type IN ('SYSTEM_FAILURE','HARDWARE_FAILURE')
           AND COALESCE(t.status, '') <> ALL($3::text[])`,
        [companyId, userId, closedTicketStatuses]
      )
      : zeroCount,
    canViewTickets
      ? db.query(
        `SELECT t.id, t.ticket_number, t.type, t.subject, t.status, t.priority, t.blocks_work,
                t.created_at, COALESCE(t.updated_at, t.created_at) AS updated_at,
                o.name AS object_name, o.address AS object_address, o.city AS object_city
         FROM tickets t
         JOIN customers c ON c.id=t.customer_id
         LEFT JOIN objects o ON o.id=t.object_id
         WHERE c.company_id=$1
           AND ${siteScope("t.object_id")}
           AND t.type IN ('SYSTEM_FAILURE','HARDWARE_FAILURE')
         ORDER BY COALESCE(t.updated_at, t.created_at) DESC
         LIMIT 5`,
        [companyId, userId]
      )
      : noRows,
    canViewOffers
      ? db.query(
        `SELECT o.id, o.offer_number, o.title, o.status, o.valid_until, o.total_price,
                o.created_at, o.updated_at, obj.id AS object_id, obj.name AS object_name,
                COALESCE((SELECT SUM(oi.gross_total) FROM offer_items oi WHERE oi.offer_id=o.id), o.total_price) AS gross_total
         FROM offers o
         JOIN customers c ON c.id=o.customer_id
         LEFT JOIN objects obj ON obj.id=o.object_id
         WHERE c.company_id=$1
           AND ${siteScope("o.object_id")}
           AND o.status = ANY($3::text[])
         ORDER BY COALESCE(o.valid_until, o.created_at) ASC
         LIMIT 3`,
        [companyId, userId, offerAcceptanceStatuses]
      )
      : noRows,
    canViewOffers
      ? db.query(
        `SELECT 'offer' AS type, o.id, o.offer_number AS number, o.title, o.updated_at, o.created_at, o.status
         FROM offers o
         JOIN customers c ON c.id=o.customer_id
         WHERE c.company_id=$1 AND ${siteScope("o.object_id")}
         ORDER BY COALESCE(o.updated_at, o.created_at) DESC
         LIMIT 3`,
        [companyId, userId]
      )
      : noRows,
    canViewTickets
      ? db.query(
        `SELECT 'ticket' AS type, t.id, t.ticket_number AS number, t.subject AS title, t.updated_at, t.created_at, t.status
         FROM tickets t
         JOIN customers c ON c.id=t.customer_id
         WHERE c.company_id=$1
           AND ${siteScope("t.object_id")}
           AND t.type IN ('SYSTEM_FAILURE','HARDWARE_FAILURE')
         ORDER BY COALESCE(t.updated_at, t.created_at) DESC
         LIMIT 3`,
        [companyId, userId]
      )
      : noRows
  ]);

  const recentActivity = [...offerActivity.rows, ...ticketActivity.rows]
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
    .slice(0, 3)
    .map((item) => ({
      type: item.type,
      id: item.id,
      number: item.number,
      title: item.type === "offer"
        ? `Oferta ${item.number || item.id} czeka na Twoja akceptacje.`
        : `Zgloszenie ${item.number || item.id} ma status ${item.status || "nowe"}.`,
      timestamp: item.updated_at || item.created_at
    }));

  return {
    company: company.rows[0] || null,
    user: {
      id: req.currentUser.id,
      firstName: req.currentUser.first_name,
      lastName: req.currentUser.last_name,
      email: req.currentUser.email,
      role: req.currentUser.role
    },
    stats: {
      sitesCount: sites.rows.length,
      employeesCount: 0,
      offersCount: offersCount.rows[0]?.count || 0,
      offersToAcceptCount: offersToAcceptCount.rows[0]?.count || 0,
      openTicketsCount: openTicketsCount.rows[0]?.count || 0
    },
    recentTickets: recentTickets.rows.map(normalizeTicket),
    offersToAccept: offersToAccept.rows.map(normalizeOffer),
    sites: sites.rows.map(normalizeSite),
    recentActivity
  };
}

const normalizeTicketType = (type) => (ticketTypes.has(type) ? type : null);

const normalizeTicketPriority = (priority, type) => {
  if (ticketPriorities.has(priority)) return priority;
  if (type === "SYSTEM_FAILURE") return "HIGH";
  return "NORMAL";
};

const normalizeLegacyStatus = (status) => {
  if (ticketStatuses.has(status)) return status;
  const value = String(status || "").toUpperCase();
  if (value.includes("TRAKCIE") || value.includes("REALIZ")) return "IN_PROGRESS";
  if (value.includes("ODRZ") || value.includes("REJECT")) return "REJECTED";
  if (value.includes("ZAKO") || value.includes("ZAMK")) return "COMPLETED";
  if (value.includes("ANUL")) return "CANCELLED";
  if (value.includes("PRZY")) return "ACCEPTED";
  return "NEW";
};

const generateClientTicketNumber = async (client) => {
  const year = new Date().getFullYear();
  // Scoped to this transaction so two concurrent submissions can't both COUNT
  // the same rows before either commits; the lock releases on commit/rollback.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`ticket_number_${year}`]);
  const count = await client.query("SELECT COUNT(*)::int AS count FROM tickets WHERE EXTRACT(YEAR FROM created_at)=$1", [year]);
  return `ZS/${year}/${String((count.rows[0]?.count || 0) + 1).padStart(5, "0")}`;
};

const getClientCustomerId = async (client, req, companyId) => {
  const customer = await client.query("SELECT id FROM customers WHERE user_id=$1 AND company_id=$2 LIMIT 1", [req.currentUser.id, companyId]);
  if (customer.rows[0]) return customer.rows[0].id;
  const fallback = await client.query("SELECT id FROM customers WHERE company_id=$1 ORDER BY id LIMIT 1", [companyId]);
  return fallback.rows[0]?.id || null;
};

function safeRemovePublicUpload(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith("/uploads/sites/")) return;
  const filename = path.basename(publicUrl);
  const absolutePath = path.join(siteUploadDir, filename);
  if (!absolutePath.startsWith(siteUploadDir)) return;
  fs.unlink(absolutePath, () => {});
}

function sanitizeEmployeePermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  return [...new Set(permissions.map(String).filter((permission) => employeePermissions.has(permission)))];
}

function normalizeIntArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(Number).filter(Boolean);
  if (typeof value === "string") {
    return value.replace(/[{}]/g, "").split(",").map(Number).filter(Boolean);
  }
  return [];
}

async function writeEmployeePermissions(client, userId, permissions) {
  await client.query("DELETE FROM user_permissions WHERE user_id=$1", [userId]);
  for (const permission of sanitizeEmployeePermissions(permissions)) {
    await client.query(
      "INSERT INTO user_permissions (user_id, permission_key, enabled) VALUES ($1,$2,TRUE) ON CONFLICT (user_id, permission_key) DO UPDATE SET enabled=TRUE",
      [userId, permission]
    );
  }
}

function generateTemporaryPassword() {
  return `${randomUUID().replace(/-/g, "").slice(0, 10)}Aa1!`;
}

const normalizeEmployee = (employee) => ({
  id: employee.id,
  role: employee.role,
  firstName: employee.first_name,
  lastName: employee.last_name,
  email: employee.email,
  phone: employee.phone,
  isActive: employee.is_active !== false,
  createdAt: employee.created_at,
  lastLoginAt: employee.last_login_at,
  permissions: employee.permissions || [],
  assignedSiteCount: Number(employee.assigned_site_count || 0),
  assignedSiteIds: normalizeIntArray(employee.assigned_site_ids)
});

const normalizeCompany = (company) => ({
  id: company.id,
  name: company.name,
  nip: company.nip,
  regon: company.regon,
  email: company.email,
  phone: company.phone,
  address: company.address,
  postalCode: company.postal_code,
  city: company.city,
  country: company.country,
  isActive: company.is_active !== false,
  status: company.is_active === false ? "Nieaktywna" : "Aktywna",
  description: company.description,
  contactPersonName: company.contact_person_name || company.contact_person,
  contactPersonEmail: company.contact_person_email || company.email,
  contactPersonPhone: company.contact_person_phone || company.phone,
  createdAt: company.created_at,
  updatedAt: company.updated_at
});

async function clientCustomerIds(companyId) {
  const result = await db.query("SELECT id FROM customers WHERE company_id=$1", [companyId]);
  return result.rows.map((row) => row.id);
}

function customerScopeSql(customerIds, nextParamIndex = 1) {
  return customerIds.length ? `= ANY($${nextParamIndex}::int[])` : "= -1";
}

router.get("/me", async (req, res) => {
  const companyId = companyIdFromUser(req);
  const company = await db.query(
    `SELECT id, name
     FROM companies
     WHERE id=$1 AND COALESCE(is_own_company, FALSE)=FALSE`,
    [companyId]
  );

  res.json({
    company: company.rows[0] || null,
    user: {
      id: req.currentUser.id,
      firstName: req.currentUser.first_name,
      lastName: req.currentUser.last_name,
      email: req.currentUser.email,
      role: req.currentUser.role
    }
  });
});

router.get("/dashboard", async (req, res) => {
  try {
    const companyId = companyIdFromUser(req);
    const permissions = await getEffectivePermissions(req.currentUser);
    if (isClientEmployee(req)) {
      return res.json(await getEmployeeDashboard(req, companyId, permissions));
    }
    const canViewTickets = permissions.has("VIEW_TICKETS");
    const canViewOffers = permissions.has("VIEW_OFFERS");
    const customerIds = await clientCustomerIds(companyId);
    const customerIdsOrEmpty = customerIds.length ? customerIds : [-1];

    const [
      company,
      sitesCount,
      employeesCount,
      offersCount,
      offersToAcceptCount,
      openTicketsCount,
      recentTickets,
      offersToAccept,
      sites,
      offerActivity,
      ticketActivity
    ] = await Promise.all([
      db.query(
        `SELECT id, name
         FROM companies
         WHERE id=$1 AND COALESCE(is_own_company, FALSE)=FALSE`,
        [companyId]
      ),
      db.query("SELECT COUNT(*)::int AS count FROM objects WHERE company_id=$1", [companyId]),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM users
         WHERE company_id=$1 AND role = ANY($2::text[])`,
        [companyId, clientRoles]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM offers o
         JOIN customers c ON c.id=o.customer_id
         WHERE c.company_id=$1`,
        [companyId]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM offers o
         JOIN customers c ON c.id=o.customer_id
         WHERE c.company_id=$1 AND o.status = ANY($2::text[])`,
        [companyId, offerAcceptanceStatuses]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM tickets t
         JOIN customers c ON c.id=t.customer_id
         WHERE c.company_id=$1
           AND t.type IN ('SYSTEM_FAILURE','HARDWARE_FAILURE')
           AND COALESCE(t.status, '') <> ALL($2::text[])`,
        [companyId, closedTicketStatuses]
      ),
      db.query(
        `SELECT t.id, t.ticket_number, t.subject, t.status, t.created_at, t.created_at AS updated_at,
                NULL::text AS priority, o.name AS object_name
         FROM tickets t
         JOIN customers c ON c.id=t.customer_id
         LEFT JOIN objects o ON o.id=t.object_id
         WHERE c.company_id=$1 AND t.type IN ('SYSTEM_FAILURE','HARDWARE_FAILURE')
         ORDER BY t.created_at DESC
         LIMIT 5`,
        [companyId]
      ),
      db.query(
        `SELECT o.id, o.offer_number, o.title, o.status, o.valid_until, o.total_price,
                o.created_at, o.updated_at, obj.id AS object_id, obj.name AS object_name,
                COALESCE((SELECT SUM(oi.gross_total) FROM offer_items oi WHERE oi.offer_id=o.id), o.total_price) AS gross_total
         FROM offers o
         JOIN customers c ON c.id=o.customer_id
         LEFT JOIN objects obj ON obj.id=o.object_id
         WHERE c.company_id=$1 AND o.status = ANY($2::text[])
         ORDER BY COALESCE(o.valid_until, o.created_at) ASC
         LIMIT 3`,
        [companyId, offerAcceptanceStatuses]
      ),
      db.query(
        `SELECT o.id, o.name, o.address, o.postal_code, o.city, o.country, o.description, o.image_url,
                o.status, o.is_active,
                (
                  SELECT COUNT(*)::int
                  FROM tickets t
                  JOIN customers c ON c.id=t.customer_id
                  WHERE t.object_id=o.id
                    AND c.company_id=$1
                    AND COALESCE(t.status, '') <> ALL($2::text[])
                ) AS open_tickets_count
         FROM objects o
         WHERE o.company_id=$1
         ORDER BY o.created_at DESC
         LIMIT 4`,
        [companyId, closedTicketStatuses]
      ),
      db.query(
        `SELECT 'offer' AS type, id, offer_number AS number, title, updated_at, created_at, status
         FROM offers
         WHERE customer_id ${customerScopeSql(customerIdsOrEmpty)}
         ORDER BY COALESCE(updated_at, created_at) DESC
         LIMIT 3`,
        [customerIdsOrEmpty]
      ),
      db.query(
        `SELECT 'ticket' AS type, id, ticket_number AS number, subject AS title, created_at, status
         FROM tickets
         WHERE customer_id ${customerScopeSql(customerIdsOrEmpty)}
           AND type IN ('SYSTEM_FAILURE','HARDWARE_FAILURE')
         ORDER BY created_at DESC
         LIMIT 3`,
        [customerIdsOrEmpty]
      )
    ]);

    const recentActivity = [...offerActivity.rows, ...ticketActivity.rows]
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
      .slice(0, 3)
      .map((item) => ({
        type: item.type,
        id: item.id,
        number: item.number,
        title: item.type === "offer" ? `Oferta ${item.number || item.id} czeka na Twoją akceptację.` : `Zgłoszenie ${item.number || item.id} ma status ${item.status || "nowe"}.`,
        timestamp: item.updated_at || item.created_at
      }));

    res.json({
      company: company.rows[0] || null,
      user: {
        id: req.currentUser.id,
        firstName: req.currentUser.first_name,
        lastName: req.currentUser.last_name,
        email: req.currentUser.email,
        role: req.currentUser.role
      },
      stats: {
        sitesCount: sitesCount.rows[0]?.count || 0,
        employeesCount: employeesCount.rows[0]?.count || 0,
        offersCount: canViewOffers ? offersCount.rows[0]?.count || 0 : 0,
        offersToAcceptCount: canViewOffers ? offersToAcceptCount.rows[0]?.count || 0 : 0,
        openTicketsCount: canViewTickets ? openTicketsCount.rows[0]?.count || 0 : 0
      },
      recentTickets: canViewTickets ? recentTickets.rows.map(normalizeTicket) : [],
      offersToAccept: canViewOffers ? offersToAccept.rows.map(normalizeOffer) : [],
      sites: sites.rows.map(normalizeSite),
      recentActivity: recentActivity.filter((item) => (
        (item.type !== "ticket" || canViewTickets)
        && (item.type !== "offer" || canViewOffers)
      ))
    });
  } catch (err) {
    console.error("Błąd przy pobieraniu dashboardu klienta:", err);
    res.status(500).json({ error: "Błąd serwera." });
  }
});

router.get("/company/summary", async (req, res) => {
  try {
    const companyId = companyIdFromUser(req);
    if (isClientEmployee(req)) {
      const permissions = await getEffectivePermissions(req.currentUser);
      const dashboard = await getEmployeeDashboard(req, companyId, permissions);
      const owner = await db.query(
        `SELECT id, role, first_name, last_name, email, phone, is_active, created_at
         FROM users
         WHERE company_id=$1 AND role='CLIENT_OWNER'
         ORDER BY created_at ASC
         LIMIT 1`,
        [companyId]
      );
      return res.json({
        company: dashboard.company ? normalizeCompany(dashboard.company) : null,
        stats: dashboard.stats,
        mainContact: owner.rows[0] ? normalizeEmployee(owner.rows[0]) : null,
        recentSites: dashboard.sites.map((site) => ({ ...site, assignedEmployeeCount: 0 })),
        recentEmployees: [],
        recentActivity: dashboard.recentActivity
      });
    }
    const customerIds = await clientCustomerIds(companyId);
    const customerIdsOrEmpty = customerIds.length ? customerIds : [-1];

    const [
      company,
      employees,
      sites,
      openTicketsCount,
      offersCount,
      offersToAcceptCount,
      recentSites,
      recentEmployees,
      offerActivity,
      ticketActivity
    ] = await Promise.all([
      db.query(
        `SELECT id, name, nip, regon, address, postal_code, city, country, email, phone,
                is_active, description, contact_person, created_at, updated_at
         FROM companies
         WHERE id=$1 AND COALESCE(is_own_company, FALSE)=FALSE`,
        [companyId]
      ),
      db.query(
        `SELECT id, role, first_name, last_name, email, phone, is_active, created_at
         FROM users
         WHERE company_id=$1 AND role = ANY($2::text[])
         ORDER BY created_at DESC`,
        [companyId, clientRoles]
      ),
      db.query(
        `SELECT o.id, o.name, o.address, o.postal_code, o.city, o.country, o.description, o.image_url,
                o.status, o.is_active, o.created_at,
                (
                  SELECT COUNT(*)::int
                  FROM tickets t
                  JOIN customers c ON c.id=t.customer_id
                  WHERE t.object_id=o.id
                    AND c.company_id=$1
                    AND COALESCE(t.status, '') <> ALL($2::text[])
                ) AS open_tickets_count,
                (
                  SELECT COUNT(*)::int
                  FROM user_site_access usa
                  WHERE usa.site_id=o.id
                ) AS assigned_employee_count
         FROM objects o
         WHERE o.company_id=$1
         ORDER BY o.created_at DESC`,
        [companyId, closedTicketStatuses]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM tickets t
         JOIN customers c ON c.id=t.customer_id
         WHERE c.company_id=$1 AND COALESCE(t.status, '') <> ALL($2::text[])`,
        [companyId, closedTicketStatuses]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM offers o
         JOIN customers c ON c.id=o.customer_id
         WHERE c.company_id=$1`,
        [companyId]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM offers o
         JOIN customers c ON c.id=o.customer_id
         WHERE c.company_id=$1 AND o.status = ANY($2::text[])`,
        [companyId, offerAcceptanceStatuses]
      ),
      db.query(
        `SELECT o.id, o.name, o.address, o.postal_code, o.city, o.country, o.description, o.image_url,
                o.status, o.is_active,
                (
                  SELECT COUNT(*)::int
                  FROM tickets t
                  JOIN customers c ON c.id=t.customer_id
                  WHERE t.object_id=o.id
                    AND c.company_id=$1
                    AND COALESCE(t.status, '') <> ALL($2::text[])
                ) AS open_tickets_count,
                (
                  SELECT COUNT(*)::int
                  FROM user_site_access usa
                  WHERE usa.site_id=o.id
                ) AS assigned_employee_count
         FROM objects o
         WHERE o.company_id=$1
         ORDER BY o.created_at DESC
         LIMIT 4`,
        [companyId, closedTicketStatuses]
      ),
      db.query(
        `SELECT id, role, first_name, last_name, email, phone, is_active, created_at
         FROM users
         WHERE company_id=$1 AND role = ANY($2::text[])
         ORDER BY created_at DESC
         LIMIT 4`,
        [companyId, clientRoles]
      ),
      db.query(
        `SELECT 'offer' AS type, id, offer_number AS number, title, updated_at, created_at, status
         FROM offers
         WHERE customer_id ${customerScopeSql(customerIdsOrEmpty)}
         ORDER BY COALESCE(updated_at, created_at) DESC
         LIMIT 4`,
        [customerIdsOrEmpty]
      ),
      db.query(
        `SELECT 'ticket' AS type, id, ticket_number AS number, subject AS title, created_at, status
         FROM tickets
         WHERE customer_id ${customerScopeSql(customerIdsOrEmpty)}
         ORDER BY created_at DESC
         LIMIT 4`,
        [customerIdsOrEmpty]
      )
    ]);

    const companyRow = company.rows[0];
    const owner = employees.rows.find((employee) => employee.role === "CLIENT_OWNER") || employees.rows[0] || null;
    const recentActivity = [...offerActivity.rows, ...ticketActivity.rows]
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
      .slice(0, 4)
      .map((item) => ({
        type: item.type,
        id: item.id,
        number: item.number,
        title: item.type === "offer" ? `Oferta ${item.number || item.id} oczekuje na akceptację` : `Zgłoszenie ${item.number || item.id} - ${item.title || item.status || "nowe"}`,
        timestamp: item.updated_at || item.created_at
      }));

    res.json({
      company: companyRow ? normalizeCompany(companyRow) : null,
      stats: {
        employeesCount: employees.rows.filter((employee) => employee.is_active !== false).length,
        sitesCount: sites.rows.length,
        openTicketsCount: openTicketsCount.rows[0]?.count || 0,
        offersCount: offersCount.rows[0]?.count || 0,
        offersToAcceptCount: offersToAcceptCount.rows[0]?.count || 0
      },
      mainContact: owner ? normalizeEmployee(owner) : null,
      recentSites: recentSites.rows.map((site) => ({
        ...normalizeSite(site),
        assignedEmployeeCount: Number(site.assigned_employee_count || 0)
      })),
      recentEmployees: req.currentUser.role === "CLIENT_OWNER" ? recentEmployees.rows.map(normalizeEmployee) : [],
      recentActivity
    });
  } catch (err) {
    console.error("Błąd przy pobieraniu podsumowania firmy klienta:", err);
    res.status(500).json({ error: "Błąd serwera." });
  }
});

router.get("/company", async (req, res) => {
  const companyId = companyIdFromUser(req);
  const result = await db.query(
    `SELECT id, name, nip, regon, address, postal_code, city, country, email, phone,
            is_active, description, contact_person, created_at, updated_at
     FROM companies
     WHERE id=$1 AND COALESCE(is_own_company, FALSE)=FALSE`,
    [companyId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Firma nie znaleziona." });
  res.json(normalizeCompany(result.rows[0]));
});

router.patch("/company", requireClientOwner, async (req, res) => {
  const companyId = companyIdFromUser(req);
  const {
    email,
    phone,
    address,
    postalCode,
    postal_code,
    city,
    contactPersonName,
    contact_person
  } = req.body;

  const result = await db.query(
    `UPDATE companies SET
       email=$1,
       phone=$2,
       address=$3,
       postal_code=$4,
       city=$5,
       contact_person=$6,
       updated_at=CURRENT_TIMESTAMP
     WHERE id=$7 AND COALESCE(is_own_company, FALSE)=FALSE
     RETURNING id, name, nip, regon, address, postal_code, city, country, email, phone,
               is_active, description, contact_person, created_at, updated_at`,
    [
      email || null,
      phone || null,
      address || null,
      postalCode || postal_code || null,
      city || null,
      contactPersonName || contact_person || null,
      companyId
    ]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Firma nie znaleziona." });
  res.json(normalizeCompany(result.rows[0]));
});

router.get("/company/employees", requireClientOwner, async (req, res) => {
  const companyId = companyIdFromUser(req);
  const result = await db.query(
    `SELECT u.id, u.role, u.first_name, u.last_name, u.email, u.phone, u.is_active,
            u.created_at, u.last_login_at,
            COALESCE(array_remove(array_agg(DISTINCT up.permission_key) FILTER (WHERE up.enabled = TRUE), NULL), '{}') AS permissions,
            COUNT(DISTINCT usa.site_id)::int AS assigned_site_count,
            COALESCE(array_remove(array_agg(DISTINCT usa.site_id), NULL), '{}') AS assigned_site_ids
     FROM users u
     LEFT JOIN user_permissions up ON up.user_id=u.id
     LEFT JOIN user_site_access usa ON usa.user_id=u.id
     WHERE u.company_id=$1 AND u.role = ANY($2::text[])
     GROUP BY u.id
     ORDER BY u.last_name, u.first_name`,
    [companyId, clientRoles]
  );
  res.json(result.rows.map(normalizeEmployee));
});

router.post("/company/employees", requireClientOwner, async (req, res) => {
  const companyId = companyIdFromUser(req);
  const { firstName, lastName, email, phone, password, isActive = true, permissions = [] } = req.body;
  if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: "Imie, nazwisko, e-mail i haslo sa wymagane." });
  }
  if (password.trim().length < 8) {
    return res.status(400).json({ error: "Haslo musi miec minimum 8 znakow." });
  }

  const sql = await db.connect();
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await sql.query("BEGIN");
    const result = await sql.query(
      `INSERT INTO users (
        username, email, password, password_hash, company_id, role,
        first_name, last_name, phone, is_active
       )
       VALUES ($1,$1,$2,$2,$3,'CLIENT_EMPLOYEE',$4,$5,$6,$7)
       RETURNING id, role, first_name, last_name, email, phone, is_active, created_at, last_login_at`,
      [email.trim(), passwordHash, companyId, firstName.trim(), lastName.trim(), phone || null, Boolean(isActive)]
    );
    await writeEmployeePermissions(sql, result.rows[0].id, permissions);
    await sql.query("COMMIT");
    result.rows[0].permissions = sanitizeEmployeePermissions(permissions);
    result.rows[0].assigned_site_count = 0;
    result.rows[0].assigned_site_ids = [];
    res.status(201).json(normalizeEmployee(result.rows[0]));
  } catch (err) {
    await sql.query("ROLLBACK");
    if (err.code === "23505") return res.status(400).json({ error: "Uzytkownik z takim e-mailem juz istnieje." });
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  } finally {
    sql.release();
  }
});

router.put("/company/employees/:id", requireClientOwner, async (req, res) => {
  const companyId = companyIdFromUser(req);
  const { firstName, lastName, email, phone, isActive = true, permissions = [] } = req.body;
  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    return res.status(400).json({ error: "Imie, nazwisko i e-mail sa wymagane." });
  }

  const sql = await db.connect();
  try {
    await sql.query("BEGIN");
    const result = await sql.query(
      `UPDATE users SET
         first_name=$1,
         last_name=$2,
         email=$3,
         username=$3,
         phone=$4,
         is_active=$5,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=$6 AND company_id=$7 AND role='CLIENT_EMPLOYEE'
       RETURNING id, role, first_name, last_name, email, phone, is_active, created_at, last_login_at`,
      [firstName.trim(), lastName.trim(), email.trim(), phone || null, Boolean(isActive), req.params.id, companyId]
    );
    if (!result.rows[0]) {
      await sql.query("ROLLBACK");
      return res.status(404).json({ error: "Pracownik nie znaleziony." });
    }
    await writeEmployeePermissions(sql, result.rows[0].id, permissions);
    await sql.query("COMMIT");
    const assigned = await db.query(
      `SELECT COUNT(*)::int AS assigned_site_count,
              COALESCE(array_remove(array_agg(site_id), NULL), '{}') AS assigned_site_ids
       FROM user_site_access WHERE user_id=$1`,
      [result.rows[0].id]
    );
    res.json(normalizeEmployee({
      ...result.rows[0],
      ...assigned.rows[0],
      permissions: sanitizeEmployeePermissions(permissions)
    }));
  } catch (err) {
    await sql.query("ROLLBACK");
    if (err.code === "23505") return res.status(400).json({ error: "Uzytkownik z takim e-mailem juz istnieje." });
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  } finally {
    sql.release();
  }
});

router.patch("/company/employees/:id/status", requireClientOwner, async (req, res) => {
  const companyId = companyIdFromUser(req);
  if (Number(req.params.id) === Number(req.currentUser.id)) {
    return res.status(400).json({ error: "Nie mozesz dezaktywowac wlasnego konta." });
  }
  const result = await db.query(
    `UPDATE users SET is_active=$1, updated_at=CURRENT_TIMESTAMP
     WHERE id=$2 AND company_id=$3 AND role='CLIENT_EMPLOYEE'
     RETURNING id, role, first_name, last_name, email, phone, is_active, created_at, last_login_at`,
    [Boolean(req.body.isActive), req.params.id, companyId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Pracownik nie znaleziony." });
  res.json(normalizeEmployee(result.rows[0]));
});

router.post("/company/employees/:id/reset-password", requireClientOwner, async (req, res) => {
  const companyId = companyIdFromUser(req);
  const employee = await db.query(
    "SELECT id FROM users WHERE id=$1 AND company_id=$2 AND role='CLIENT_EMPLOYEE'",
    [req.params.id, companyId]
  );
  if (!employee.rows[0]) return res.status(404).json({ error: "Pracownik nie znaleziony." });

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  await db.query(
    "UPDATE users SET password=$1, password_hash=$1, password_changed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND company_id=$3 AND role='CLIENT_EMPLOYEE'",
    [passwordHash, req.params.id, companyId]
  );
  res.json({ temporaryPassword });
});

router.get("/company/employees/:id/sites", requireClientOwner, async (req, res) => {
  const companyId = companyIdFromUser(req);
  const employee = await db.query(
    "SELECT id FROM users WHERE id=$1 AND company_id=$2 AND role = ANY($3::text[])",
    [req.params.id, companyId, clientRoles]
  );
  if (!employee.rows[0]) return res.status(404).json({ error: "Pracownik nie istnieje albo nie masz do niego dostepu." });

  const result = await db.query(
    `SELECT o.id, o.name, o.address, o.postal_code, o.city, o.country, o.status, o.is_active,
            EXISTS (
              SELECT 1 FROM user_site_access usa
              WHERE usa.user_id=$2 AND usa.site_id=o.id
            ) AS assigned
     FROM objects o
     WHERE o.company_id=$1
     ORDER BY o.name`,
    [companyId, req.params.id]
  );
  res.json(result.rows.map((site) => ({ ...normalizeSite(site), assigned: Boolean(site.assigned) })));
});

router.put("/company/employees/:id/sites", requireClientOwner, async (req, res) => {
  const companyId = companyIdFromUser(req);
  const employee = await db.query(
    "SELECT id FROM users WHERE id=$1 AND company_id=$2 AND role = ANY($3::text[])",
    [req.params.id, companyId, clientRoles]
  );
  if (!employee.rows[0]) return res.status(404).json({ error: "Pracownik nie istnieje albo nie masz do niego dostepu." });

  const siteIds = Array.isArray(req.body.siteIds) ? [...new Set(req.body.siteIds.map(Number).filter(Boolean))] : [];
  if (siteIds.length) {
    const sites = await db.query(
      "SELECT id FROM objects WHERE company_id=$1 AND id = ANY($2::int[])",
      [companyId, siteIds]
    );
    if (sites.rows.length !== siteIds.length) {
      return res.status(400).json({ error: "Co najmniej jeden obiekt nie nalezy do tej firmy." });
    }
  }

  const sql = await db.connect();
  try {
    await sql.query("BEGIN");
    await sql.query("DELETE FROM user_site_access WHERE user_id=$1", [req.params.id]);
    for (const siteId of siteIds) {
      await sql.query(
        "INSERT INTO user_site_access (site_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [siteId, req.params.id]
      );
    }
    await sql.query("COMMIT");
    res.json({ ok: true, siteIds });
  } catch (err) {
    await sql.query("ROLLBACK");
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  } finally {
    sql.release();
  }
});

router.get("/company/sites", async (req, res) => {
  const companyId = companyIdFromUser(req);
  const params = [companyId, closedTicketStatuses];
  const siteAccess = employeeSiteAccessSql(req, "o.id", params);
  const result = await db.query(
    `SELECT o.id, o.name, o.address, o.postal_code, o.city, o.country, o.description, o.image_url,
            o.status, o.is_active,
            (
              SELECT COUNT(*)::int
              FROM tickets t
              JOIN customers c ON c.id=t.customer_id
              WHERE t.object_id=o.id
                AND c.company_id=$1
                AND COALESCE(t.status, '') <> ALL($2::text[])
            ) AS open_tickets_count,
            (
              SELECT COUNT(*)::int
              FROM user_site_access usa
              WHERE usa.site_id=o.id
            ) AS assigned_employee_count
     FROM objects o
     WHERE o.company_id=$1${siteAccess}
     ORDER BY o.created_at DESC`,
    params
  );
  res.json(result.rows.map((site) => ({ ...normalizeSite(site), assignedEmployeeCount: Number(site.assigned_employee_count || 0) })));
});

router.post("/company/sites", requirePermission("MANAGE_SITES"), handleSiteUpload, async (req, res) => {
  const companyId = companyIdFromUser(req);
  const { name, address, postalCode, postal_code, city, country, description, isActive = true } = req.body;
  if (!name?.trim()) {
    removeUploadedFile(req.file);
    return res.status(400).json({ error: "Nazwa obiektu jest wymagana." });
  }
  if (!address?.trim()) {
    removeUploadedFile(req.file);
    return res.status(400).json({ error: "Adres obiektu jest wymagany." });
  }
  if (!city?.trim()) {
    removeUploadedFile(req.file);
    return res.status(400).json({ error: "Miasto obiektu jest wymagane." });
  }

  const imageUrl = req.file ? `/uploads/sites/${req.file.filename}` : null;

  const result = await db.query(
    `INSERT INTO objects (
       company_id, name, address, postal_code, city, country, description, image_url, is_active, status, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'AKTYWNY',$10)
     RETURNING id, name, address, postal_code, city, country, description, image_url, status, is_active`,
    [
      companyId,
      name.trim(),
      address.trim(),
      postalCode || postal_code || null,
      city.trim(),
      country || "Polska",
      description || null,
      imageUrl,
      String(isActive) === "false" ? false : Boolean(isActive),
      req.currentUser.id
    ]
  );
  res.status(201).json(normalizeSite(result.rows[0]));
});

router.put("/company/sites/:id", requirePermission("MANAGE_SITES"), handleSiteUpload, async (req, res) => {
  const companyId = companyIdFromUser(req);
  const { name, address, postalCode, postal_code, city, country, description, isActive = true, removeImage } = req.body;
  if (!name?.trim()) {
    removeUploadedFile(req.file);
    return res.status(400).json({ error: "Nazwa obiektu jest wymagana." });
  }
  if (!address?.trim()) {
    removeUploadedFile(req.file);
    return res.status(400).json({ error: "Adres obiektu jest wymagany." });
  }
  if (!city?.trim()) {
    removeUploadedFile(req.file);
    return res.status(400).json({ error: "Miasto obiektu jest wymagane." });
  }

  const existing = await db.query("SELECT id, image_url FROM objects WHERE id=$1 AND company_id=$2", [req.params.id, companyId]);
  if (!existing.rows[0]) {
    removeUploadedFile(req.file);
    return res.status(404).json({ error: "Obiekt nie znaleziony." });
  }

  const nextImageUrl = req.file
    ? `/uploads/sites/${req.file.filename}`
    : String(removeImage) === "true"
      ? null
      : existing.rows[0].image_url;

  const result = await db.query(
    `UPDATE objects SET
       name=$1,
       address=$2,
       postal_code=$3,
       city=$4,
       country=$5,
       description=$6,
       image_url=$7,
       is_active=$8,
       updated_at=CURRENT_TIMESTAMP
     WHERE id=$9 AND company_id=$10
     RETURNING id, name, address, postal_code, city, country, description, image_url, status, is_active`,
    [
      name.trim(),
      address.trim(),
      postalCode || postal_code || null,
      city.trim(),
      country || "Polska",
      description || null,
      nextImageUrl,
      String(isActive) === "false" ? false : Boolean(isActive),
      req.params.id,
      companyId
    ]
  );
  if (req.file || String(removeImage) === "true") safeRemovePublicUpload(existing.rows[0].image_url);
  res.json(normalizeSite(result.rows[0]));
});

router.delete("/company/sites/:id", requirePermission("MANAGE_SITES"), async (req, res) => {
  const companyId = companyIdFromUser(req);
  const result = await db.query(
    "UPDATE objects SET is_active=FALSE, updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND company_id=$2 RETURNING id",
    [req.params.id, companyId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Obiekt nie znaleziony." });
  res.json({ ok: true });
});

router.get("/company/sites/:id/users", requireClientOwner, async (req, res) => {
  const companyId = companyIdFromUser(req);
  const site = await db.query("SELECT id FROM objects WHERE id=$1 AND company_id=$2", [req.params.id, companyId]);
  if (!site.rows[0]) return res.status(404).json({ error: "Obiekt nie znaleziony." });
  const result = await db.query(
    `SELECT u.id, u.role, u.first_name, u.last_name, u.email, u.phone, u.is_active, u.created_at
     FROM user_site_access usa
     JOIN users u ON u.id=usa.user_id
     WHERE usa.site_id=$1 AND u.company_id=$2 AND u.role = ANY($3::text[])
     ORDER BY u.last_name, u.first_name`,
    [req.params.id, companyId, clientRoles]
  );
  res.json(result.rows.map(normalizeEmployee));
});

router.put("/company/sites/:id/users", requireClientOwner, async (req, res) => {
  const companyId = companyIdFromUser(req);
  const site = await db.query("SELECT id FROM objects WHERE id=$1 AND company_id=$2", [req.params.id, companyId]);
  if (!site.rows[0]) return res.status(404).json({ error: "Obiekt nie znaleziony." });

  const userIds = Array.isArray(req.body.userIds) ? req.body.userIds.map(Number).filter(Boolean) : [];
  if (userIds.length) {
    const users = await db.query(
      `SELECT id FROM users
       WHERE company_id=$1 AND role = ANY($2::text[]) AND id = ANY($3::int[])`,
      [companyId, clientRoles, userIds]
    );
    if (users.rows.length !== new Set(userIds).size) {
      return res.status(400).json({ error: "Co najmniej jeden pracownik nie należy do tej firmy." });
    }
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM user_site_access WHERE site_id=$1", [req.params.id]);
    for (const userId of [...new Set(userIds)]) {
      await client.query(
        "INSERT INTO user_site_access (site_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [req.params.id, userId]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true, userIds: [...new Set(userIds)] });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  } finally {
    client.release();
  }
});

router.get("/company/activity", async (req, res) => {
  const companyId = companyIdFromUser(req);
  if (isClientEmployee(req)) {
    const permissions = await getEffectivePermissions(req.currentUser);
    const dashboard = await getEmployeeDashboard(req, companyId, permissions);
    return res.json(dashboard.recentActivity);
  }
  const customerIds = await clientCustomerIds(companyId);
  const customerIdsOrEmpty = customerIds.length ? customerIds : [-1];
  const [offers, tickets, employees, sites] = await Promise.all([
    db.query(
      `SELECT 'offer' AS type, id, offer_number AS number, title, updated_at, created_at, status
       FROM offers
       WHERE customer_id ${customerScopeSql(customerIdsOrEmpty)}
       ORDER BY COALESCE(updated_at, created_at) DESC
       LIMIT 8`,
      [customerIdsOrEmpty]
    ),
    db.query(
      `SELECT 'ticket' AS type, id, ticket_number AS number, subject AS title, created_at, status
       FROM tickets
       WHERE customer_id ${customerScopeSql(customerIdsOrEmpty)}
       ORDER BY created_at DESC
       LIMIT 8`,
      [customerIdsOrEmpty]
    ),
    db.query(
      `SELECT 'employee' AS type, id, NULL::text AS number,
              CONCAT_WS(' ', first_name, last_name) AS title, created_at, NULL::text AS status
       FROM users
       WHERE company_id=$1 AND role='CLIENT_EMPLOYEE'
       ORDER BY created_at DESC
       LIMIT 4`,
      [companyId]
    ),
    db.query(
      `SELECT 'site' AS type, id, NULL::text AS number, name AS title, created_at, status
       FROM objects
       WHERE company_id=$1
       ORDER BY created_at DESC
       LIMIT 4`,
      [companyId]
    )
  ]);

  const activity = [...offers.rows, ...tickets.rows, ...employees.rows, ...sites.rows]
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
    .map((item) => ({
      type: item.type,
      id: item.id,
      number: item.number,
      title: item.type === "employee"
        ? `Dodano nowego pracownika: ${item.title}`
        : item.type === "site"
          ? `Dodano obiekt: ${item.title}`
          : item.type === "offer"
            ? `Oferta ${item.number || item.id} oczekuje na akceptację`
            : `Utworzono zgłoszenie ${item.number || item.id} - ${item.title}`,
      timestamp: item.updated_at || item.created_at
    }));

  res.json(activity);
});

router.get("/offers", requirePermission("VIEW_OFFERS"), async (req, res) => {
  const companyId = companyIdFromUser(req);
  const params = [companyId, hiddenClientOfferStatuses];
  const siteAccess = employeeSiteAccessSql(req, "o.object_id", params);
  const result = await db.query(
    `SELECT o.id, o.offer_number, o.title, o.status, o.valid_until, o.total_price,
            o.currency, o.issue_date, o.created_at, o.updated_at,
            obj.id AS object_id, obj.name AS object_name,
            COALESCE((SELECT SUM(oi.net_total) FROM offer_items oi WHERE oi.offer_id=o.id), o.total_price, 0) AS total_net,
            COALESCE((SELECT SUM(oi.vat_value) FROM offer_items oi WHERE oi.offer_id=o.id), 0) AS vat_total,
            COALESCE((SELECT SUM(oi.gross_total) FROM offer_items oi WHERE oi.offer_id=o.id), o.total_price, 0) AS gross_total,
            (SELECT COUNT(*)::int FROM offer_items oi WHERE oi.offer_id=o.id) AS items_count,
            (SELECT COUNT(*)::int FROM photos p WHERE p.offer_id=o.id) AS attachments_count
     FROM offers o
     JOIN customers c ON c.id=o.customer_id
     LEFT JOIN objects obj ON obj.id=o.object_id
     WHERE c.company_id=$1
        AND UPPER(COALESCE(o.status, '')) <> ALL($2::text[])
        ${siteAccess}
     ORDER BY COALESCE(o.updated_at, o.created_at) DESC`,
    params
  );
  res.json(result.rows.map((offer) => ({
    ...normalizeOffer(offer),
    issueDate: offer.issue_date,
    currency: offer.currency || "PLN",
    totalNet: Number(offer.total_net || offer.total_price || 0),
    vatTotal: Number(offer.vat_total || 0),
    totalGross: Number(offer.gross_total || offer.total_price || 0),
    itemsCount: Number(offer.items_count || 0),
    attachmentsCount: Number(offer.attachments_count || 0)
  })));
});

router.get("/offers/:id", requirePermission("VIEW_OFFERS"), async (req, res) => {
  const companyId = companyIdFromUser(req);
  const offer = await db.query(
    `SELECT o.*, obj.name AS object_name, obj.address AS object_address, obj.postal_code AS object_postal_code,
            obj.city AS object_city, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
            u.first_name AS creator_first_name, u.last_name AS creator_last_name, u.email AS creator_email, u.phone AS creator_phone,
            COALESCE((SELECT SUM(oi.net_total) FROM offer_items oi WHERE oi.offer_id=o.id), o.total_price, 0) AS total_net,
            COALESCE((SELECT SUM(oi.vat_value) FROM offer_items oi WHERE oi.offer_id=o.id), 0) AS vat_total,
            COALESCE((SELECT SUM(oi.gross_total) FROM offer_items oi WHERE oi.offer_id=o.id), o.total_price, 0) AS gross_total
     FROM offers o
     JOIN customers c ON c.id=o.customer_id
     LEFT JOIN objects obj ON obj.id=o.object_id
     LEFT JOIN users u ON u.id=o.created_by
     WHERE o.id=$1 AND c.company_id=$2
       AND UPPER(COALESCE(o.status, '')) <> ALL($3::text[])`,
    [req.params.id, companyId, hiddenClientOfferStatuses]
  );

  if (!offer.rows[0]) {
    return res.status(404).json({ error: "Oferta nie istnieje albo nie masz do niej dostępu." });
  }

  if (!await canAccessClientSite(req, offer.rows[0].object_id)) {
    return res.status(404).json({ error: "Oferta nie istnieje albo nie masz do niej dostepu." });
  }

  const [items, attachments, comments] = await Promise.all([
    db.query("SELECT * FROM offer_items WHERE offer_id=$1 ORDER BY item_number ASC", [req.params.id]),
    db.query(
      `SELECT p.id, p.file_name, p.file_path, p.file_size, p.uploaded_at,
              u.first_name, u.last_name, u.email
       FROM photos p
       LEFT JOIN users u ON u.id=p.uploaded_by
       WHERE p.offer_id=$1
       ORDER BY p.uploaded_at DESC`,
      [req.params.id]
    ),
    db.query(
      `SELECT c.id, c.content, c.created_at, u.first_name, u.last_name, u.email, u.role
       FROM comments c
       LEFT JOIN users u ON u.id=c.author_id
       WHERE c.offer_id=$1 AND COALESCE(c.is_internal, FALSE)=FALSE
       ORDER BY c.created_at ASC`,
      [req.params.id]
    )
  ]);

  const data = offer.rows[0];
  const normalizedAttachments = attachments.rows.map((file) => ({
    ...file,
    url: `/api/files/offer-attachments/${file.id}`,
    authorName: [file.first_name, file.last_name].filter(Boolean).join(" ") || file.email || "-"
  }));
  const normalizedComments = comments.rows.map((comment) => ({
    id: comment.id,
    content: comment.content,
    createdAt: comment.created_at,
    authorRole: comment.role,
    authorName: [comment.first_name, comment.last_name].filter(Boolean).join(" ") || comment.email || "-"
  }));
  const creatorName = [data.creator_first_name, data.creator_last_name].filter(Boolean).join(" ");
  const history = [
    { id: "created", label: "Oferta utworzona", createdAt: data.created_at, authorName: creatorName || data.creator_email || "-" },
    data.status && { id: "status", label: `Aktualny status: ${data.status}`, createdAt: data.updated_at || data.created_at, authorName: creatorName || "-" },
    ...normalizedAttachments.map((file) => ({
      id: `attachment-${file.id}`,
      label: `Dodano zalacznik ${file.file_name}`,
      createdAt: file.uploaded_at,
      authorName: file.authorName
    })),
    ...normalizedComments.map((comment) => ({
      id: `comment-${comment.id}`,
      label: "Dodano komentarz",
      createdAt: comment.createdAt,
      authorName: comment.authorName
    }))
  ].filter(Boolean).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

  res.json({
    ...data,
    number: data.offer_number,
    totalNet: Number(data.total_net || data.total_price || 0),
    vatTotal: Number(data.vat_total || 0),
    totalGross: Number(data.gross_total || data.total_price || 0),
    site: data.object_id ? {
      id: data.object_id,
      name: data.object_name,
      address: data.object_address,
      postalCode: data.object_postal_code,
      city: data.object_city
    } : null,
    preparedByName: data.prepared_by_name || data.salesperson || creatorName || data.creator_email || "-",
    preparedByEmail: data.prepared_by_email || data.creator_email,
    preparedByPhone: data.prepared_by_phone || data.creator_phone,
    contactName: data.client_contact_person || data.customer_name,
    contactEmail: data.client_email || data.customer_email,
    contactPhone: data.client_phone || data.customer_phone,
    items: items.rows,
    attachments: normalizedAttachments,
    comments: normalizedComments,
    history
  });
});

router.post("/offers/:id/accept", requirePermission("ACCEPT_OFFERS"), async (req, res) => {
  const companyId = companyIdFromUser(req);
  const sql = await db.connect();
  try {
    await sql.query("BEGIN");
    const offer = await sql.query(
      `SELECT o.id, o.object_id, o.status, o.ticket_id, o.offer_number, o.title, o.client_company_name
       FROM offers o
       JOIN customers c ON c.id=o.customer_id
       WHERE o.id=$1 AND c.company_id=$2
         AND UPPER(COALESCE(o.status, '')) <> ALL($3::text[])
       FOR UPDATE OF o`,
      [req.params.id, companyId, hiddenClientOfferStatuses]
    );

    if (!offer.rows[0]) {
      await sql.query("ROLLBACK");
      return res.status(404).json({ error: "Oferta nie istnieje albo nie masz do niej dostępu." });
    }

    if (!await canAccessClientSite(req, offer.rows[0].object_id)) {
      await sql.query("ROLLBACK");
      return res.status(404).json({ error: "Oferta nie istnieje albo nie masz do niej dostepu." });
    }

    if (!clientOfferStatusesForDecision.includes(offer.rows[0].status)) {
      await sql.query("ROLLBACK");
      return res.status(400).json({ error: "Tej oferty nie można zaakceptować." });
    }

    const updated = await sql.query(
      "UPDATE offers SET status='ZAAKCEPTOWANA', accepted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *",
      [offer.rows[0].id]
    );
    await markOfferLifecycle(sql, offer.rows[0].id, "ZAAKCEPTOWANA");
    const orderTransition = await synchronizeLinkedOrderStatus(sql, {
      ticketId: offer.rows[0].ticket_id,
      offerId: offer.rows[0].id,
      offerNumber: offer.rows[0].offer_number,
      offerStatus: "ZAAKCEPTOWANA",
      actorId: req.currentUser.id
    });
    await sql.query("COMMIT");

    await notifyAdmins({
      category: "OFFERS",
      type: "OFFER_ACCEPTED",
      priority: "SUCCESS",
      title: "Klient zaakceptował ofertę",
      message: `${offer.rows[0].offer_number || `Oferta #${offer.rows[0].id}`}${orderTransition?.ticket_number ? ` · ${orderTransition.ticket_number} w realizacji` : ""}`,
      entityType: "offer",
      entityId: offer.rows[0].id,
      link: `/offers/${offer.rows[0].id}`
    }).catch(() => {});
    await writeAuditLog({
      category: "OFFER",
      action: "OFFER_ACCEPTED_BY_CLIENT",
      userId: req.currentUser.id,
      companyId,
      entityType: "offer",
      entityId: offer.rows[0].id,
      message: `Klient zaakceptowal oferte ${offer.rows[0].offer_number || `#${offer.rows[0].id}`}`,
      metadata: { linkedOrderStatus: orderTransition?.targetStatus || null }
    }).catch((error) => console.error("Global audit log failed:", error));

    res.json({ ...updated.rows[0], linkedOrderStatus: orderTransition?.targetStatus || null });
  } catch (error) {
    await sql.query("ROLLBACK");
    console.error("Failed to accept offer:", error);
    res.status(500).json({ error: "Nie udało się zaakceptować oferty." });
  } finally {
    sql.release();
  }
});

router.post("/offers/:id/reject", requirePermission("ACCEPT_OFFERS"), async (req, res) => {
  const companyId = companyIdFromUser(req);
  const reason = String(req.body.reason || "").trim();
  const sql = await db.connect();
  try {
    await sql.query("BEGIN");
    const offer = await sql.query(
      `SELECT o.id, o.object_id, o.status, o.ticket_id, o.offer_number, o.title
       FROM offers o
       JOIN customers c ON c.id=o.customer_id
       WHERE o.id=$1 AND c.company_id=$2
         AND UPPER(COALESCE(o.status, '')) <> ALL($3::text[])
       FOR UPDATE OF o`,
      [req.params.id, companyId, hiddenClientOfferStatuses]
    );

    if (!offer.rows[0]) {
      await sql.query("ROLLBACK");
      return res.status(404).json({ error: "Oferta nie istnieje albo nie masz do niej dostępu." });
    }

    if (!await canAccessClientSite(req, offer.rows[0].object_id)) {
      await sql.query("ROLLBACK");
      return res.status(404).json({ error: "Oferta nie istnieje albo nie masz do niej dostepu." });
    }

    if (!clientOfferStatusesForDecision.includes(offer.rows[0].status)) {
      await sql.query("ROLLBACK");
      return res.status(400).json({ error: "Tej oferty nie można odrzucić." });
    }

    const updated = await sql.query(
      "UPDATE offers SET status='ODRZUCONA', updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *",
      [offer.rows[0].id]
    );
    if (reason) {
      await sql.query(
        "INSERT INTO rejections (offer_id, reason, rejected_by) VALUES ($1,$2,$3)",
        [offer.rows[0].id, reason, req.currentUser.id]
      );
    }
    const orderTransition = await synchronizeLinkedOrderStatus(sql, {
      ticketId: offer.rows[0].ticket_id,
      offerId: offer.rows[0].id,
      offerNumber: offer.rows[0].offer_number,
      offerStatus: "ODRZUCONA",
      actorId: req.currentUser.id
    });
    await sql.query("COMMIT");

    await notifyAdmins({
      category: "OFFERS",
      type: "OFFER_REJECTED",
      priority: "WARNING",
      title: "Klient odrzucił ofertę",
      message: `${offer.rows[0].offer_number || `Oferta #${offer.rows[0].id}`}${orderTransition?.ticket_number ? ` · ${orderTransition.ticket_number} odrzucone` : ""}`,
      entityType: "offer",
      entityId: offer.rows[0].id,
      link: `/offers/${offer.rows[0].id}`
    }).catch(() => {});
    await writeAuditLog({
      category: "OFFER",
      action: "OFFER_REJECTED_BY_CLIENT",
      userId: req.currentUser.id,
      companyId,
      entityType: "offer",
      entityId: offer.rows[0].id,
      message: `Klient odrzucil oferte ${offer.rows[0].offer_number || `#${offer.rows[0].id}`}`,
      metadata: { linkedOrderStatus: orderTransition?.targetStatus || null, reasonProvided: Boolean(reason) }
    }).catch((error) => console.error("Global audit log failed:", error));

    res.json({ ...updated.rows[0], linkedOrderStatus: orderTransition?.targetStatus || null });
  } catch (error) {
    await sql.query("ROLLBACK");
    console.error("Failed to reject offer:", error);
    res.status(500).json({ error: "Nie udało się odrzucić oferty." });
  } finally {
    sql.release();
  }
});

router.get("/offers/:id/pdf", requirePermission("VIEW_OFFERS"), async (req, res) => {
  const companyId = companyIdFromUser(req);
  const offer = await db.query(
     `SELECT o.id, o.object_id
     FROM offers o
     JOIN customers c ON c.id=o.customer_id
     WHERE o.id=$1 AND c.company_id=$2
       AND UPPER(COALESCE(o.status, '')) <> ALL($3::text[])`,
    [req.params.id, companyId, hiddenClientOfferStatuses]
  );

  if (!offer.rows[0]) {
    return res.status(404).json({ error: "Oferta nie istnieje albo nie masz do niej dostepu." });
  }

  if (!await canAccessClientSite(req, offer.rows[0].object_id)) {
    return res.status(404).json({ error: "Oferta nie istnieje albo nie masz do niej dostepu." });
  }

  res.redirect(`/pdf/${offer.rows[0].id}`);
});

router.post("/offers/:id/comments", requirePermission("VIEW_OFFERS"), async (req, res) => {
  const companyId = companyIdFromUser(req);
  const content = String(req.body.content || "").trim();
  if (!content) return res.status(400).json({ error: "Tresc komentarza jest wymagana." });

  const offer = await db.query(
     `SELECT o.id, o.object_id
     FROM offers o
     JOIN customers c ON c.id=o.customer_id
     WHERE o.id=$1 AND c.company_id=$2
       AND UPPER(COALESCE(o.status, '')) <> ALL($3::text[])`,
    [req.params.id, companyId, hiddenClientOfferStatuses]
  );

  if (!offer.rows[0]) {
    return res.status(404).json({ error: "Oferta nie istnieje albo nie masz do niej dostepu." });
  }

  if (!await canAccessClientSite(req, offer.rows[0].object_id)) {
    return res.status(404).json({ error: "Oferta nie istnieje albo nie masz do niej dostepu." });
  }

  const result = await db.query(
    `INSERT INTO comments (offer_id, author_id, content, is_internal)
     VALUES ($1,$2,$3,FALSE)
     RETURNING id, content, created_at`,
    [offer.rows[0].id, req.currentUser.id, content]
  );
  await db.query("UPDATE offers SET updated_at=CURRENT_TIMESTAMP WHERE id=$1", [offer.rows[0].id]);
  await writeAuditLog({
    category: "OFFER",
    action: "OFFER_COMMENT_ADDED_BY_CLIENT",
    userId: req.currentUser.id,
    companyId,
    entityType: "offer",
    entityId: offer.rows[0].id,
    message: "Klient dodal komentarz do oferty."
  }).catch((error) => console.error("Global audit log failed:", error));

  res.status(201).json({
    id: result.rows[0].id,
    content: result.rows[0].content,
    createdAt: result.rows[0].created_at,
    authorRole: req.currentUser.role,
    authorName: [req.currentUser.first_name, req.currentUser.last_name].filter(Boolean).join(" ") || req.currentUser.email || "-"
  });
});

router.get("/catalog", requirePermission("VIEW_CATALOG"), async (_req, res) => {
  const result = await db.query(
    `SELECT p.id, p.name, p.description, p.sale_price, p.code, p.unit, p.vat_rate, p.image_url,
            p.show_price_to_client, p.active, p.visible_for_clients,
            c.name AS category_name, c.slug AS category_slug
     FROM products p
     LEFT JOIN article_categories c ON c.id=p.category_id
     WHERE p.active=TRUE AND p.visible_for_clients=TRUE
     ORDER BY c.sort_order NULLS LAST, p.name`
  );

  res.json(result.rows.map((product) => ({
    ...product,
    imageUrl: product.image_url,
    salePrice: product.show_price_to_client ? product.sale_price : undefined,
    showPriceToClient: product.show_price_to_client,
    visibleForClients: product.visible_for_clients,
    category: product.category_name ? { name: product.category_name, slug: product.category_slug } : null
  })));
});

router.get("/tickets", requirePermission("VIEW_TICKETS"), async (req, res) => {
  const companyId = companyIdFromUser(req);
  const scope = String(req.query.scope || "all").toLowerCase();
  if (!["all", "tickets", "orders"].includes(scope)) {
    return res.status(400).json({ error: "Nieprawidłowy zakres listy." });
  }
  const typeCondition = scope === "orders"
    ? " AND t.type='ORDER'"
    : scope === "tickets"
      ? " AND t.type IN ('SYSTEM_FAILURE','HARDWARE_FAILURE')"
      : "";
  const params = [companyId];
  const siteAccess = employeeSiteAccessSql(req, "t.object_id", params);
  const result = await db.query(
    `SELECT t.id, t.ticket_number, t.type, t.subject, t.description, t.object_id,
            COALESCE(t.status, 'NEW') AS status,
            COALESCE(t.priority, 'NORMAL') AS priority,
            COALESCE(t.blocks_work, FALSE) AS blocks_work,
            t.contact_name, t.contact_phone,
            t.created_at, COALESCE(t.updated_at, t.created_at) AS updated_at,
            o.name AS object_name, o.address AS object_address, o.city AS object_city,
            (SELECT COUNT(*)::int FROM ticket_photos tp WHERE tp.ticket_id=t.id) AS attachments_count,
            (SELECT COUNT(*)::int FROM ticket_items ti WHERE ti.ticket_id=t.id) AS items_count
     FROM tickets t
     JOIN customers c ON c.id=t.customer_id
     LEFT JOIN objects o ON o.id=t.object_id
     WHERE c.company_id=$1${typeCondition}${siteAccess}
     ORDER BY COALESCE(t.updated_at, t.created_at) DESC`,
    params
  );
  res.json(result.rows.map(normalizeTicket));
});

router.get("/tickets/:id", requirePermission("VIEW_TICKETS"), async (req, res) => {
  const companyId = companyIdFromUser(req);
  const ticket = await db.query(
    `SELECT t.id, t.ticket_number, t.type, t.subject, t.description, t.object_id,
            COALESCE(t.status, 'NEW') AS status,
            COALESCE(t.priority, 'NORMAL') AS priority,
            COALESCE(t.blocks_work, FALSE) AS blocks_work,
            t.contact_name, t.contact_phone,
            t.created_at, COALESCE(t.updated_at, t.created_at) AS updated_at,
            o.name AS object_name, o.address AS object_address, o.postal_code AS object_postal_code,
            o.city AS object_city, o.image_url AS object_image_url,
            creator.first_name AS created_by_first_name, creator.last_name AS created_by_last_name,
            creator.email AS created_by_email, creator.phone AS created_by_phone
     FROM tickets t
     JOIN customers c ON c.id=t.customer_id
     LEFT JOIN objects o ON o.id=t.object_id
     LEFT JOIN users creator ON creator.id=t.created_by
     WHERE t.id=$1 AND c.company_id=$2`,
    [req.params.id, companyId]
  );

  if (!ticket.rows[0]) return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });

  if (!await canAccessClientSite(req, ticket.rows[0].object_id)) {
    return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
  }

  const [items, attachments, comments, offers] = await Promise.all([
    db.query("SELECT * FROM ticket_items WHERE ticket_id=$1 ORDER BY id", [req.params.id]),
    db.query(
     `SELECT tp.id, tp.file_name, tp.file_size, tp.uploaded_at,
             u.first_name, u.last_name, u.email
       FROM ticket_photos tp
       LEFT JOIN users u ON u.id=tp.uploaded_by
       WHERE tp.ticket_id=$1
         AND COALESCE(tp.visibility, 'PUBLIC') = 'PUBLIC'
       ORDER BY tp.uploaded_at DESC`,
      [req.params.id]
    ),
    db.query(
      `SELECT tc.id, tc.content, tc.created_at, COALESCE(tc.is_ai_generated, FALSE) AS is_ai_generated,
              u.id AS author_id, u.role AS author_role, u.first_name, u.last_name, u.email
       FROM ticket_comments tc
       LEFT JOIN users u ON u.id=tc.author_id
       WHERE tc.ticket_id=$1
         AND COALESCE(tc.is_internal, FALSE) = FALSE
       ORDER BY tc.created_at ASC`,
      [req.params.id]
    ),
    db.query(
      `SELECT o.id, o.offer_number, o.title, o.status, o.valid_until, o.total_price,
              o.created_at, o.updated_at, o.object_id, obj.name AS object_name,
              COALESCE((SELECT SUM(oi.gross_total) FROM offer_items oi WHERE oi.offer_id=o.id), o.total_price, 0) AS gross_total
       FROM offers o
       LEFT JOIN objects obj ON obj.id=o.object_id
       WHERE o.ticket_id=$1
         AND UPPER(COALESCE(o.status, '')) <> ALL($2::text[])
       ORDER BY COALESCE(o.updated_at, o.created_at) DESC`,
      [req.params.id, hiddenClientOfferStatuses]
    )
  ]);

  const normalizedAttachments = attachments.rows.map((file) => ({
    ...file,
    authorName: [file.first_name, file.last_name].filter(Boolean).join(" ") || file.email || "-",
    url: `/api/files/ticket-attachments/${file.id}`
  }));
  const normalizedComments = comments.rows.map((comment) => ({
    id: comment.id,
    content: comment.content,
    createdAt: comment.created_at,
    authorId: comment.author_id,
    isAiGenerated: Boolean(comment.is_ai_generated),
    authorRole: comment.is_ai_generated ? "AI" : comment.author_role,
    authorName: comment.is_ai_generated
      ? "Prestige Systems"
      : [comment.first_name, comment.last_name].filter(Boolean).join(" ") || comment.email || "-"
  }));
  const history = [
    {
      id: "created",
      type: "created",
      label: "Zgloszenie utworzone",
      createdAt: ticket.rows[0].created_at,
      authorName: [ticket.rows[0].created_by_first_name, ticket.rows[0].created_by_last_name].filter(Boolean).join(" ") || ticket.rows[0].created_by_email || "-"
    },
    ...normalizedAttachments.map((file) => ({
      id: `attachment-${file.id}`,
      type: "attachment",
      label: `Dodano zalacznik ${file.file_name}`,
      createdAt: file.uploaded_at,
      authorName: file.authorName
    })),
    ...normalizedComments.map((comment) => ({
      id: `comment-${comment.id}`,
      type: "comment",
      label: "Dodano komentarz",
      createdAt: comment.createdAt,
      authorName: comment.authorName
    }))
  ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  res.json({
    ...normalizeTicket(ticket.rows[0]),
    site: {
      id: ticket.rows[0].object_id,
      name: ticket.rows[0].object_name,
      address: ticket.rows[0].object_address,
      postalCode: ticket.rows[0].object_postal_code,
      city: ticket.rows[0].object_city,
      imageUrl: ticket.rows[0].object_image_url
    },
    createdByName: [ticket.rows[0].created_by_first_name, ticket.rows[0].created_by_last_name].filter(Boolean).join(" ") || ticket.rows[0].created_by_email || "-",
    contactEmail: ticket.rows[0].created_by_email,
    items: items.rows,
    offers: offers.rows.map(normalizeOffer),
    attachments: normalizedAttachments,
    comments: normalizedComments,
    history
  });
});

router.get("/ticket-categories", requirePermission("CREATE_TICKET"), async (_req, res) => {
  try {
    const result = await db.query("SELECT name FROM ai_equipment_types WHERE is_active=TRUE ORDER BY name");
    res.json(result.rows.map((row) => row.name));
  } catch (error) {
    res.json(["Ogólne"]);
  }
});

router.post("/tickets", requirePermission("CREATE_TICKET"), async (req, res) => {
  const companyId = companyIdFromUser(req);
  const type = normalizeTicketType(req.body.type);
  const siteId = Number(req.body.siteId ?? req.body.object_id);
  const title = String(req.body.title ?? req.body.subject ?? "").trim();
  const description = String(req.body.description ?? "").trim();
  const category = String(req.body.category ?? "").trim() || null;
  const priority = normalizeTicketPriority(req.body.priority, type);
  const blocksWork = Boolean(req.body.blocksWork ?? req.body.blocks_work);
  const contactName = String(req.body.contactName ?? req.body.contact_name ?? "").trim() || null;
  const contactPhone = String(req.body.contactPhone ?? req.body.contact_phone ?? "").trim() || null;

  if (!type || !siteId || !title || (type !== "ORDER" && !description)) {
    return res.status(400).json({ error: "Typ, obiekt, tytul i opis zgloszenia sa wymagane." });
  }

  const site = await db.query("SELECT id FROM objects WHERE id=$1 AND company_id=$2", [siteId, companyId]);
  if (!site.rows[0]) {
    return res.status(400).json({ error: "Wybrany obiekt nie istnieje albo nie nalezy do Twojej firmy." });
  }
  if (!await canAccessClientSite(req, siteId)) {
    return res.status(403).json({ error: "Brak dostepu do wybranego obiektu." });
  }

  const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (type === "ORDER" && rawItems.length === 0) {
    return res.status(400).json({ error: "Zamowienie musi zawierac minimum jeden artykul." });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const customerId = await getClientCustomerId(client, req, companyId);
    if (!customerId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Firma nie ma profilu klienta wymaganego do utworzenia zgloszenia." });
    }

    const ticketNumber = await generateClientTicketNumber(client);
    const ticket = await client.query(
      `INSERT INTO tickets (
        ticket_number, type, object_id, subject, description, customer_id, created_by, status,
        priority, blocks_work, contact_name, contact_phone, category, updated_at
      )
       VALUES ($1,$2,$3,$4,$5,$6,$7,'NEW',$8,$9,$10,$11,$12,CURRENT_TIMESTAMP)
       RETURNING *`,
      [ticketNumber, type, siteId, title, description || null, customerId, req.currentUser.id, priority, blocksWork, contactName, contactPhone, category]
    );

    if (type === "ORDER") {
      const sanitizedItems = rawItems
        .map((item) => ({ productId: Number(item.productId ?? item.product_id), quantity: Math.max(1, Number(item.quantity || 1)) }))
        .filter((item) => item.productId);
      const productIds = [...new Set(sanitizedItems.map((item) => item.productId))];

      if (productIds.length !== sanitizedItems.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Nieprawidlowe pozycje zamowienia." });
      }

      const products = await client.query(
        `SELECT p.id, p.name, p.code, p.unit, p.sale_price, p.vat_rate, p.show_price_to_client,
                c.name AS producer
         FROM products p
         LEFT JOIN article_categories c ON c.id=p.category_id
         WHERE p.id = ANY($1::int[]) AND p.active=TRUE AND p.visible_for_clients=TRUE`,
        [productIds]
      );

      if (products.rows.length !== productIds.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Niektore artykuly sa niedostepne." });
      }

      const productMap = new Map(products.rows.map((product) => [Number(product.id), product]));
      for (const item of sanitizedItems) {
        const product = productMap.get(item.productId);
        const priceNet = Number(product.sale_price || 0);
        const vatRate = Number(product.vat_rate || 23);
        const totalNet = priceNet * item.quantity;
        await client.query(
          `INSERT INTO ticket_items (ticket_id, product_id, name, code, producer, unit, quantity, price_net, vat_rate, total_net)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [ticket.rows[0].id, product.id, product.name, product.code, product.producer, product.unit || "szt.", item.quantity, priceNet, vatRate, totalNet]
        );
      }
    }

    await client.query(
      `INSERT INTO ticket_history (ticket_id, user_id, action, old_value, new_value, metadata)
       VALUES ($1,$2,'TICKET_CREATED',NULL,$3,$4::jsonb)`,
      [ticket.rows[0].id, req.currentUser.id, ticketNumber, JSON.stringify({ source: "Portal klienta" })]
    );
    await client.query("COMMIT");
    await notifyAdmins({
      category: "TICKETS",
      type: type === "ORDER" ? "ORDER_CREATED" : "TICKET_CREATED",
      priority: priority === "CRITICAL" ? "CRITICAL" : "INFO",
      title: type === "ORDER" ? "Nowe zamowienie" : "Nowe zgloszenie",
      message: `${ticketNumber}: ${title}`,
      entityType: "ticket",
      entityId: ticket.rows[0].id,
      link: type === "ORDER" ? "/orders" : "/tickets"
    });
    res.status(201).json(normalizeTicket(ticket.rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Blad serwera przy tworzeniu zgloszenia." });
  } finally {
    client.release();
  }
});

router.post("/tickets/:id/attachments", requireAnyPermission("CREATE_TICKET", "COMMENT_TICKET"), handleTicketAttachments, async (req, res) => {
  const companyId = companyIdFromUser(req);
  const ticket = await db.query(
     `SELECT t.id, t.object_id
     FROM tickets t
     JOIN customers c ON c.id=t.customer_id
     WHERE t.id=$1 AND c.company_id=$2
     FOR UPDATE OF t`,
    [req.params.id, companyId]
  );

  if (!ticket.rows[0]) {
    (req.files || []).forEach(removeUploadedFile);
    return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
  }
  if (!await canAccessClientSite(req, ticket.rows[0].object_id)) {
    (req.files || []).forEach(removeUploadedFile);
    return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
  }

  const saved = [];
  for (const file of req.files || []) {
    const result = await db.query(
      `INSERT INTO ticket_photos (ticket_id, file_name, original_name, file_path, file_size, mime_type, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, file_name, file_size, uploaded_at`,
      [ticket.rows[0].id, file.filename, file.originalname, `/uploads/tickets/${file.filename}`, file.size, file.mimetype, req.currentUser.id]
    );
    saved.push({ ...result.rows[0], url: `/api/files/ticket-attachments/${result.rows[0].id}` });
  }

  res.status(201).json(saved);
});

router.post("/tickets/:id/ai-analysis", requirePermission("CREATE_TICKET"), async (req, res) => {
  const companyId = companyIdFromUser(req);
  const ticket = await db.query(
    `SELECT t.id
     FROM tickets t
     JOIN customers c ON c.id=t.customer_id
     WHERE t.id=$1 AND c.company_id=$2`,
    [req.params.id, companyId]
  );

  if (!ticket.rows[0]) {
    return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
  }

  analyzeTicketWithAi(ticket.rows[0].id);
  res.status(202).json({ queued: true });
});

router.post("/tickets/:id/comments", requirePermission("COMMENT_TICKET"), async (req, res) => {
  const companyId = companyIdFromUser(req);
  const content = String(req.body.content || "").trim();
  if (!content) return res.status(400).json({ error: "Tresc komentarza jest wymagana." });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const ticket = await client.query(
    `SELECT t.id, t.object_id, t.type, t.status
     FROM tickets t
     JOIN customers c ON c.id=t.customer_id
     WHERE t.id=$1 AND c.company_id=$2`,
    [req.params.id, companyId]
  );

    if (!ticket.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
    }
    if (!await canAccessClientSite(req, ticket.rows[0].object_id)) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zgloszenie nie istnieje albo nie masz do niego dostepu." });
    }

    const currentStatus = normalizeLegacyStatus(ticket.rows[0].status);
    const nextStatus = serviceTicketTypes.has(ticket.rows[0].type) && !terminalTicketStatuses.has(currentStatus)
      ? "IN_PROGRESS"
      : ticket.rows[0].status;
    const statusChanged = currentStatus !== normalizeLegacyStatus(nextStatus);
    const result = await client.query(
      `INSERT INTO ticket_comments (ticket_id, author_id, content, is_internal)
       VALUES ($1,$2,$3,FALSE)
       RETURNING id, content, created_at`,
      [ticket.rows[0].id, req.currentUser.id, content]
    );
    await client.query("UPDATE tickets SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2", [nextStatus, ticket.rows[0].id]);
    if (statusChanged) {
      await client.query(
        `INSERT INTO ticket_history (ticket_id, user_id, action, old_value, new_value, metadata)
         VALUES ($1,$2,'TICKET_STATUS_CHANGED',$3,$4,$5::jsonb)`,
        [ticket.rows[0].id, req.currentUser.id, currentStatus, normalizeLegacyStatus(nextStatus), JSON.stringify({ automatic: true, trigger: "CLIENT_COMMENT" })]
      );
    }
    await client.query("COMMIT");

    continueAiConversation(ticket.rows[0].id).catch(() => {});

    res.status(201).json({
      id: result.rows[0].id,
      content: result.rows[0].content,
      createdAt: result.rows[0].created_at,
      authorId: req.currentUser.id,
      authorRole: req.currentUser.role,
      authorName: [req.currentUser.first_name, req.currentUser.last_name].filter(Boolean).join(" ") || req.currentUser.email || "-"
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to add client ticket comment:", error);
    res.status(500).json({ error: "Nie udalo sie dodac komentarza." });
  } finally {
    client.release();
  }
});

router.get("/sites", async (req, res) => {
  const companyId = companyIdFromUser(req);
  const params = [companyId, closedTicketStatuses];
  const siteAccess = employeeSiteAccessSql(req, "o.id", params);
  const result = await db.query(
    `SELECT o.id, o.name, o.address, o.postal_code, o.city, o.country, o.description, o.image_url,
            o.status, o.is_active,
            (
              SELECT COUNT(*)::int
              FROM tickets t
              JOIN customers c ON c.id=t.customer_id
              WHERE t.object_id=o.id
                AND c.company_id=$1
                AND COALESCE(t.status, '') <> ALL($2::text[])
            ) AS open_tickets_count
     FROM objects o
     WHERE o.company_id=$1${siteAccess}
     ORDER BY o.created_at DESC`,
    params
  );
  res.json(result.rows.map(normalizeSite));
});

router.get("/employees", requireClientOwner, async (req, res) => {
  const companyId = companyIdFromUser(req);
  const result = await db.query(
    `SELECT id, company_id, role, first_name, last_name, email, phone, is_active, created_at
     FROM users
     WHERE company_id=$1 AND role = ANY($2::text[])
     ORDER BY last_name, first_name`,
    [companyId, clientRoles]
  );
  res.json(result.rows);
});

export default router;
