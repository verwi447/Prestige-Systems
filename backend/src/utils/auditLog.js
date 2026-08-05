import crypto from "crypto";
import { db } from "../db.js";

export const AUDIT_CATEGORIES = ["TICKET", "ORDER", "OFFER", "USER", "COMPANY", "BACKUP", "SYSTEM"];

function normalizeCategory(category) {
  return AUDIT_CATEGORIES.includes(category) ? category : "SYSTEM";
}

export async function writeAuditLog({
  client = db,
  category = "SYSTEM",
  action,
  status = "SUCCESS",
  userId = null,
  companyId = null,
  entityType = null,
  entityId = null,
  ipAddress = null,
  message = null,
  metadata = {}
}) {
  if (!action) return null;

  const result = await client.query(
    `INSERT INTO system_audit_log (
      id, category, action, status, user_id, company_id, entity_type, entity_id, ip_address, message, metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    RETURNING *`,
    [
      crypto.randomUUID(),
      normalizeCategory(category),
      String(action).slice(0, 120),
      String(status || "SUCCESS").slice(0, 32),
      userId || null,
      companyId || null,
      entityType ? String(entityType).slice(0, 80) : null,
      entityId == null ? null : String(entityId).slice(0, 120),
      ipAddress ? String(ipAddress).slice(0, 120) : null,
      message ? String(message).slice(0, 2000) : null,
      JSON.stringify(metadata && typeof metadata === "object" ? metadata : {})
    ]
  );

  return result.rows[0];
}
