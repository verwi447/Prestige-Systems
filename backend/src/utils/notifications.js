import crypto from "crypto";
import { db } from "../db.js";
import { emitToUser } from "../realtime.js";

export const NOTIFICATION_CATEGORIES = ["OFFERS", "TICKETS", "BACKUP", "SYSTEM", "COMPANIES"];
export const NOTIFICATION_PRIORITIES = ["INFO", "SUCCESS", "WARNING", "CRITICAL"];

const normalizeCategory = (category) => (NOTIFICATION_CATEGORIES.includes(category) ? category : "SYSTEM");
const normalizePriority = (priority) => (NOTIFICATION_PRIORITIES.includes(priority) ? priority : "INFO");

export function buildBackupSuccessSummary(existingTitle = "", latestMessage = "") {
  const countMatch = String(existingTitle).match(/\((\d+)\)\s*$/);
  const previousCount = Number(countMatch?.[1]) || 1;
  const count = Math.max(2, previousCount + 1);

  return {
    title: `Backup zakończony (${count})`,
    message: `Utworzono dzisiaj ${count} kopie zapasowe. Ostatnia: ${latestMessage || "kopia zapasowa jest gotowa."}`
  };
}

const canAggregateBackupSuccess = (category, type, priority) => (
  category === "BACKUP" && type === "BACKUP_COMPLETED" && priority === "SUCCESS"
);

export async function createNotification({
  userId,
  category = "SYSTEM",
  type = "SYSTEM_WARNING",
  priority = "INFO",
  title,
  message,
  entityType = null,
  entityId = null,
  link = null
}) {
  if (!userId || !title || !message) return null;

  const normalizedCategory = normalizeCategory(category);
  const recipient = await db.query("SELECT role, company_id FROM users WHERE id=$1 AND COALESCE(is_active, TRUE)=TRUE", [userId]);
  const recipientUser = recipient.rows[0];
  if (!recipientUser) return null;

  if (recipientUser.role !== "ADMIN") {
    if (!["OFFERS", "TICKETS"].includes(normalizedCategory) || !entityId || !recipientUser.company_id) return null;
    const ownership = normalizedCategory === "OFFERS"
      ? await db.query(
          `SELECT 1 FROM offers o JOIN customers c ON c.id=o.customer_id
           WHERE o.id=$1 AND c.company_id=$2`,
          [entityId, recipientUser.company_id]
        )
      : await db.query(
          `SELECT 1 FROM tickets t JOIN customers c ON c.id=t.customer_id
           WHERE t.id=$1 AND c.company_id=$2`,
          [entityId, recipientUser.company_id]
        );
    if (!ownership.rows[0]) return null;
  }

  const preference = await db.query(
    "SELECT in_app_enabled FROM notification_preferences WHERE user_id=$1 AND category=$2",
    [userId, normalizedCategory]
  );

  if (preference.rows[0]?.in_app_enabled === false) return null;

  const normalizedPriority = normalizePriority(priority);
  if (canAggregateBackupSuccess(normalizedCategory, type, normalizedPriority)) {
    const existing = await db.query(
      `SELECT id, title
       FROM notifications
       WHERE user_id=$1
         AND category=$2
         AND type=$3
         AND is_read=FALSE
         AND created_at >= date_trunc('day', CURRENT_TIMESTAMP)
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, normalizedCategory, type]
    );

    if (existing.rows[0]) {
      const summary = buildBackupSuccessSummary(existing.rows[0].title, message);
      const updated = await db.query(
        `UPDATE notifications
         SET title=$1, message=$2, created_at=CURRENT_TIMESTAMP
         WHERE id=$3
         RETURNING *`,
        [summary.title, summary.message, existing.rows[0].id]
      );
      const notification = updated.rows[0];
      emitToUser(userId, "notification:updated", notification);
      return notification;
    }
  }

  const result = await db.query(
    `INSERT INTO notifications (
      id, user_id, category, type, priority, title, message, entity_type, entity_id, link
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      crypto.randomUUID(),
      userId,
      normalizedCategory,
      type,
      normalizedPriority,
      title,
      message,
      entityType,
      entityId == null ? null : String(entityId),
      link
    ]
  );

  const notification = result.rows[0];
  emitToUser(userId, "notification:new", notification);
  return notification;
}

export async function notifyAdmins(notification) {
  const admins = await db.query("SELECT id FROM users WHERE role='ADMIN' AND COALESCE(is_active, TRUE)=TRUE");
  await Promise.all(admins.rows.map((admin) => createNotification({ ...notification, userId: admin.id })));
}
