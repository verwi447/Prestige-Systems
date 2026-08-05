import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";
import { encryptText } from "../utils/emailCrypto.js";
import { createTransporter, isValidEmail, sendEmail } from "../services/emailService.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const emailUploadDir = path.join(__dirname, "../../uploads/email");
fs.mkdirSync(emailUploadDir, { recursive: true });

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, emailUploadDir),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || "").toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const allowed = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp"]);
    if (!allowed.has(extension) || !String(file.mimetype || "").startsWith("image/")) {
      return cb(new Error("Wybierz obraz PNG, JPG, SVG albo WEBP."));
    }
    cb(null, true);
  }
});

router.use(auth, loadCurrentUser, requireRole("ADMIN"));

const safeSettings = (settings) => {
  if (!settings) return null;
  const { smtp_password_enc, ...safe } = settings;
  return { ...safe, hasPassword: Boolean(smtp_password_enc) };
};

router.get("/settings", async (_req, res) => {
  const result = await db.query("SELECT * FROM email_settings ORDER BY updated_at DESC LIMIT 1");
  res.json(safeSettings(result.rows[0]));
});

router.get("/footer", async (_req, res) => {
  const result = await db.query("SELECT * FROM email_footer_settings WHERE id='default'");
  res.json(result.rows[0] || null);
});

router.put("/footer", async (req, res) => {
  const { footerEnabled = true, footerHtml = "", footerLogoUrl = "" } = req.body;
  const result = await db.query(
    `INSERT INTO email_footer_settings (id, footer_enabled, footer_html, footer_logo_url, updated_at)
     VALUES ('default', $1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (id)
     DO UPDATE SET footer_enabled=$1, footer_html=$2, footer_logo_url=$3, updated_at=CURRENT_TIMESTAMP
     RETURNING *`,
    [Boolean(footerEnabled), footerHtml, footerLogoUrl]
  );
  res.json(result.rows[0]);
});

router.put("/settings", async (req, res) => {
  const {
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser,
    smtpPassword,
    fromEmail,
    fromName,
    replyToEmail,
    isActive = true,
    footerEnabled = true,
    footerHtml = null,
    footerLogoUrl = null
  } = req.body;
  if (!smtpHost?.trim() || !smtpPort || !fromEmail?.trim()) {
    return res.status(400).json({ error: "Host SMTP, port i e-mail nadawcy są wymagane." });
  }
  if (!isValidEmail(fromEmail)) return res.status(400).json({ error: "Podaj poprawny e-mail nadawcy." });
  if (replyToEmail && !isValidEmail(replyToEmail)) return res.status(400).json({ error: "Podaj poprawny e-mail reply-to." });

  const existing = await db.query("SELECT * FROM email_settings ORDER BY updated_at DESC LIMIT 1");
  const current = existing.rows[0];
  const passwordSql = smtpPassword ? ", smtp_password_enc=$13" : "";
  const passwordParams = smtpPassword ? [encryptText(smtpPassword)] : [];

  let result;
  if (current) {
    result = await db.query(
      `UPDATE email_settings SET
        smtp_host=$1, smtp_port=$2, smtp_secure=$3, smtp_user=$4, from_email=$5,
        from_name=$6, reply_to_email=$7, is_active=$8, footer_enabled=$10,
        footer_html=$11, footer_logo_url=$12, updated_at=CURRENT_TIMESTAMP
        ${passwordSql}
       WHERE id=$9
       RETURNING *`,
      [
        smtpHost.trim(),
        Number(smtpPort),
        Boolean(smtpSecure),
        smtpUser?.trim() || null,
        fromEmail.trim(),
        fromName?.trim() || null,
        replyToEmail?.trim() || null,
        Boolean(isActive),
        current.id,
        Boolean(footerEnabled),
        footerHtml,
        footerLogoUrl,
        ...passwordParams
      ]
    );
  } else {
    result = await db.query(
      `INSERT INTO email_settings (
        id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_enc,
        from_email, from_name, reply_to_email, is_active, footer_enabled, footer_html, footer_logo_url
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        crypto.randomUUID(),
        smtpHost.trim(),
        Number(smtpPort),
        Boolean(smtpSecure),
        smtpUser?.trim() || null,
        smtpPassword ? encryptText(smtpPassword) : null,
        fromEmail.trim(),
        fromName?.trim() || null,
        replyToEmail?.trim() || null,
        Boolean(isActive),
        Boolean(footerEnabled),
        footerHtml,
        footerLogoUrl
      ]
    );
  }

  res.json(safeSettings(result.rows[0]));
});

router.post("/footer-logo", (req, res) => {
  imageUpload.single("logo")(req, res, async (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Logo może mieć maksymalnie 5 MB." });
    }
    if (error) return res.status(400).json({ error: error.message || "Nie udało się wysłać logo." });
    if (!req.file) return res.status(400).json({ error: "Wybierz plik logo." });

    const logoUrl = `/uploads/email/${req.file.filename}`;
    res.json({ logoUrl });
  });
});

router.post("/test-connection", async (_req, res) => {
  const settings = (await db.query("SELECT * FROM email_settings ORDER BY updated_at DESC LIMIT 1")).rows[0];
  if (!settings) return res.status(400).json({ error: "SMTP nie jest skonfigurowany." });

  try {
    const transporter = await createTransporter();
    await transporter.verify();
    await db.query(
      "UPDATE email_settings SET last_test_status='SUCCESS', last_test_message='Połączenie poprawne', last_test_at=CURRENT_TIMESTAMP WHERE id=$1",
      [settings.id]
    );
    res.json({ status: "SUCCESS", message: "Połączenie poprawne" });
  } catch (error) {
    await db.query(
      "UPDATE email_settings SET last_test_status='FAILED', last_test_message=$1, last_test_at=CURRENT_TIMESTAMP WHERE id=$2",
      [error.message, settings.id]
    );
    res.status(400).json({ status: "FAILED", error: error.message });
  }
});

router.post("/test-send", async (req, res) => {
  const { to, subject, html } = req.body;
  try {
    const log = await sendEmail({
      to,
      subject,
      html,
      text: String(html || "").replace(/<[^>]*>?/gm, ""),
      templateKey: "TEST_EMAIL",
      entityType: "SYSTEM",
      createdById: req.currentUser.id
    });
    res.json({ message: "Testowy e-mail został wysłany.", log });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/templates", async (_req, res) => {
  const result = await db.query("SELECT * FROM email_templates ORDER BY created_at DESC");
  res.json(result.rows);
});

router.post("/templates", async (req, res) => {
  const { key, name, subject, bodyHtml, bodyText, variables } = req.body;
  if (!key || !name || !subject || !bodyHtml) return res.status(400).json({ error: "Klucz, nazwa, temat i HTML są wymagane." });
  const result = await db.query(
    `INSERT INTO email_templates (id, key, name, subject, body_html, body_text, variables)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [crypto.randomUUID(), key, name, subject, bodyHtml, bodyText || null, variables || {}]
  );
  res.status(201).json(result.rows[0]);
});

router.put("/templates/:id", async (req, res) => {
  const { name, subject, bodyHtml, bodyText, variables, isActive = true } = req.body;
  const result = await db.query(
    `UPDATE email_templates SET name=$1, subject=$2, body_html=$3, body_text=$4, variables=$5, is_active=$6, updated_at=CURRENT_TIMESTAMP
     WHERE id=$7 RETURNING *`,
    [name, subject, bodyHtml, bodyText || null, variables || {}, Boolean(isActive), req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Szablon nie istnieje." });
  res.json(result.rows[0]);
});

router.delete("/templates/:id", async (req, res) => {
  const result = await db.query("UPDATE email_templates SET is_active=FALSE, updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *", [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: "Szablon nie istnieje." });
  res.json(result.rows[0]);
});

router.get("/logs", async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const where = [];
  const params = [];
  if (req.query.status) { params.push(req.query.status); where.push(`status=$${params.length}`); }
  if (req.query.templateKey) { params.push(req.query.templateKey); where.push(`template_key=$${params.length}`); }
  if (req.query.entityType) { params.push(req.query.entityType); where.push(`entity_type=$${params.length}`); }
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    where.push(`(to_email ILIKE $${params.length} OR subject ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await db.query(`SELECT COUNT(*)::int AS total FROM email_logs ${whereSql}`, params);
  params.push(limit, (page - 1) * limit);
  const items = await db.query(
    `SELECT * FROM email_logs ${whereSql} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ items: items.rows, total: count.rows[0]?.total || 0, page, limit });
});

router.get("/logs/:id", async (req, res) => {
  const result = await db.query("SELECT * FROM email_logs WHERE id=$1", [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: "Log e-mail nie istnieje." });
  res.json(result.rows[0]);
});

export default router;
