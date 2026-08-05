import nodemailer from "nodemailer";
import crypto from "crypto";
import { db } from "../db.js";
import { decryptText } from "../utils/emailCrypto.js";
import { notifyAdmins } from "../utils/notifications.js";

export function isValidEmail(email = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

export async function getActiveEmailSettings() {
  const result = await db.query(
    "SELECT * FROM email_settings WHERE is_active=TRUE ORDER BY updated_at DESC LIMIT 1"
  );
  if (!result.rows[0]) throw new Error("SMTP nie jest skonfigurowany.");
  return result.rows[0];
}

export async function createTransporter() {
  const settings = await getActiveEmailSettings();
  const password = settings.smtp_password_enc ? decryptText(settings.smtp_password_enc) : undefined;
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: Number(settings.smtp_port),
    secure: settings.smtp_secure === true,
    auth: settings.smtp_user ? { user: settings.smtp_user, pass: password } : undefined
  });
}

function absoluteAssetUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const baseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
  return `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

function appendFooter(html = "", settings = {}) {
  if (!settings.footer_enabled) return html;
  const logo = settings.footer_logo_url
    ? `<p style="margin:0 0 10px;"><img src="${absoluteAssetUrl(settings.footer_logo_url)}" alt="${settings.from_name || "Logo"}" style="max-width:180px;max-height:72px;height:auto;display:block;" /></p>`
    : "";
  const customFooter = settings.footer_html?.trim() || "";
  if (!logo && !customFooter) return html;

  return `${html || ""}
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #dfe7ef;color:#4b5f76;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;">
  ${logo}
  ${customFooter}
</div>`;
}

async function getEmailFooterSettings() {
  const result = await db.query("SELECT * FROM email_footer_settings WHERE id='default'");
  return result.rows[0] || {};
}

export function renderTemplateString(content, variables = {}) {
  if (!content) return "";
  return String(content).replace(/{{(.*?)}}/g, (_, key) => variables[key.trim()] ?? "");
}

export async function renderEmailTemplate(templateKey, variables = {}) {
  const result = await db.query(
    "SELECT * FROM email_templates WHERE key=$1 AND is_active=TRUE LIMIT 1",
    [templateKey]
  );
  const template = result.rows[0];
  if (!template) throw new Error(`Szablon e-mail ${templateKey} nie istnieje albo jest nieaktywny.`);
  return {
    subject: renderTemplateString(template.subject, variables),
    html: renderTemplateString(template.body_html, variables),
    text: renderTemplateString(template.body_text, variables)
  };
}

export async function sendEmail({
  to,
  toName = null,
  cc = null,
  subject,
  html,
  text,
  attachments = [],
  templateKey = null,
  entityType = null,
  entityId = null,
  createdById = null
}) {
  if (!isValidEmail(to)) throw new Error("Podaj poprawny adres e-mail odbiorcy.");
  if (cc) {
    const invalidCc = String(cc)
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter(Boolean)
      .find((value) => !isValidEmail(value));
    if (invalidCc) throw new Error(`Niepoprawny adres DW: ${invalidCc}.`);
  }
  if (!subject?.trim()) throw new Error("Temat wiadomości jest wymagany.");
  if (!html?.trim() && !text?.trim()) throw new Error("Treść wiadomości jest wymagana.");

  const settings = await getActiveEmailSettings();
  const footerSettings = await getEmailFooterSettings().catch(() => settings);
  const htmlWithFooter = appendFooter(html, {
    footer_enabled: footerSettings.footer_enabled,
    footer_html: footerSettings.footer_html,
    footer_logo_url: footerSettings.footer_logo_url,
    from_name: settings.from_name
  });
  const logId = crypto.randomUUID();
  const logResult = await db.query(
    `INSERT INTO email_logs (
      id, template_key, subject, to_email, to_name, from_email, entity_type, entity_id, status, created_by_id
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9)
     RETURNING *`,
    [logId, templateKey, subject, to, toName, settings.from_email, entityType, entityId == null ? null : String(entityId), createdById]
  );

  try {
    const transporter = await createTransporter();
    await transporter.sendMail({
      from: settings.from_name ? `"${settings.from_name}" <${settings.from_email}>` : settings.from_email,
      to: toName ? `"${toName}" <${to}>` : to,
      cc: cc || undefined,
      replyTo: settings.reply_to_email || undefined,
      subject,
      html: htmlWithFooter,
      text,
      attachments
    });

    const updated = await db.query(
      "UPDATE email_logs SET status='SENT', sent_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *",
      [logId]
    );
    return updated.rows[0];
  } catch (error) {
    await db.query(
      "UPDATE email_logs SET status='FAILED', error_message=$1 WHERE id=$2",
      [error.message, logId]
    );
    await notifyAdmins({
      category: "SYSTEM",
      type: "SYSTEM_WARNING",
      priority: "WARNING",
      title: "Błąd wysyłki e-mail",
      message: `${subject}: ${error.message}`,
      entityType: entityType || "email",
      entityId: entityId || logResult.rows[0].id,
      link: "/settings/email"
    }).catch(() => {});
    throw error;
  }
}
