import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser } from "../middleware/access.js";
import { emitToUser } from "../realtime.js";
import { NOTIFICATION_CATEGORIES } from "../utils/notifications.js";

import { autoAsyncRoutes } from "../utils/autoAsyncRoutes.js";

const router = express.Router();
autoAsyncRoutes(router);
const DEFAULT_LIMIT = 20;

router.use(auth, loadCurrentUser);

const clampLimit = (value) => Math.min(Math.max(Number(value) || DEFAULT_LIMIT, 1), DEFAULT_LIMIT);
const parseOffset = (value) => Math.max(Number(value) || 0, 0);
const CLIENT_NOTIFICATION_CATEGORIES = ["OFFERS", "TICKETS"];

function notificationScope(user, userParam = 1, companyParam = 2) {
  if (user.role === "ADMIN") return { sql: `user_id=$${userParam}`, params: [user.id] };
  return {
    sql: `user_id=$${userParam}
      AND category IN ('OFFERS', 'TICKETS')
      AND entity_id ~ '^[0-9]+$'
      AND (
        (category='OFFERS' AND EXISTS (
          SELECT 1 FROM offers scoped_offer
          JOIN customers scoped_customer ON scoped_customer.id=scoped_offer.customer_id
          WHERE scoped_offer.id=CASE WHEN entity_id ~ '^[0-9]+$' THEN entity_id::int END AND scoped_customer.company_id=$${companyParam}
        ))
        OR
        (category='TICKETS' AND EXISTS (
          SELECT 1 FROM tickets scoped_ticket
          JOIN customers scoped_customer ON scoped_customer.id=scoped_ticket.customer_id
          WHERE scoped_ticket.id=CASE WHEN entity_id ~ '^[0-9]+$' THEN entity_id::int END AND scoped_customer.company_id=$${companyParam}
        ))
      )`,
    params: [user.id, user.company_id]
  };
}

const allowedCategories = (user) => user.role === "ADMIN" ? NOTIFICATION_CATEGORIES : CLIENT_NOTIFICATION_CATEGORIES;

async function ensureUserPreferences(user) {
  await Promise.all(
    allowedCategories(user).map((category) =>
      db.query(
        `INSERT INTO notification_preferences (user_id, category)
         VALUES ($1,$2)
         ON CONFLICT (user_id, category) DO NOTHING`,
        [user.id, category]
      )
    )
  );
}

router.get("/", async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const scope = notificationScope(req.currentUser);
    const params = [...scope.params];
    const where = [scope.sql];

    if (req.query.category && req.query.category !== "ALL") {
      params.push(String(req.query.category).toUpperCase());
      where.push(`category=$${params.length}`);
    }
    if (String(req.query.unreadOnly) === "true") {
      where.push("is_read=FALSE");
    }

    params.push(limit, offset);
    const result = await db.query(
      `SELECT *
       FROM notifications
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.get("/unread-count", async (req, res) => {
  try {
    const scope = notificationScope(req.currentUser);
    const result = await db.query(
      `SELECT
        COUNT(*) FILTER (WHERE is_read=FALSE)::int AS total_unread,
        COUNT(*) FILTER (WHERE is_read=FALSE AND priority='CRITICAL')::int AS critical_unread
       FROM notifications
       WHERE ${scope.sql}`,
      scope.params
    );

    res.json({
      totalUnread: result.rows[0]?.total_unread || 0,
      criticalUnread: result.rows[0]?.critical_unread || 0
    });
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.put("/:id/read", async (req, res) => {
  try {
    const scope = notificationScope(req.currentUser, 2, 3);
    const result = await db.query(
      `UPDATE notifications
       SET is_read=TRUE, read_at=COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE id=$1 AND ${scope.sql}
       RETURNING *`,
      [req.params.id, ...scope.params]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Powiadomienie nie istnieje." });
    emitToUser(req.currentUser.id, "notification:read", result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.put("/read-all", async (req, res) => {
  try {
    const scope = notificationScope(req.currentUser);
    await db.query(
      `UPDATE notifications
       SET is_read=TRUE, read_at=COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE ${scope.sql} AND is_read=FALSE`,
      scope.params
    );
    emitToUser(req.currentUser.id, "notification:readAll", { userId: req.currentUser.id });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const scope = notificationScope(req.currentUser, 2, 3);
    const result = await db.query(
      `DELETE FROM notifications WHERE id=$1 AND ${scope.sql} RETURNING id`,
      [req.params.id, ...scope.params]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Powiadomienie nie istnieje." });
    emitToUser(req.currentUser.id, "notification:deleted", { id: req.params.id });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.get("/preferences", async (req, res) => {
  try {
    await ensureUserPreferences(req.currentUser);
    const categories = allowedCategories(req.currentUser);
    const result = await db.query(
      `SELECT *
       FROM notification_preferences
       WHERE user_id=$1 AND category=ANY($2::text[])
       ORDER BY category`,
      [req.currentUser.id, categories]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.put("/preferences", async (req, res) => {
  try {
    const preferences = Array.isArray(req.body.preferences) ? req.body.preferences : [];
    await ensureUserPreferences(req.currentUser);
    const categories = allowedCategories(req.currentUser);

    for (const preference of preferences) {
      const category = String(preference.category || "").toUpperCase();
      if (!categories.includes(category)) continue;
      await db.query(
        `UPDATE notification_preferences
         SET in_app_enabled=$1, email_enabled=$2, push_enabled=$3, sound_enabled=$4, updated_at=CURRENT_TIMESTAMP
         WHERE user_id=$5 AND category=$6`,
        [
          preference.in_app_enabled !== false,
          preference.email_enabled === true,
          preference.push_enabled === true,
          preference.sound_enabled !== false,
          req.currentUser.id,
          category
        ]
      );
    }

    const result = await db.query(
      "SELECT * FROM notification_preferences WHERE user_id=$1 AND category=ANY($2::text[]) ORDER BY category",
      [req.currentUser.id, categories]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

export default router;
