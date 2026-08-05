import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";
import { createNotification } from "../utils/notifications.js";

const router = express.Router();
const ORDER_STATUSES = new Set(["NEW", "ACCEPTED", "IN_PROGRESS", "WAITING_FOR_CLIENT", "WAITING_FOR_PARTS", "REJECTED", "COMPLETED", "CANCELLED"]);

router.use(auth, loadCurrentUser, requireRole("ADMIN"));

router.get("/assignees", async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, first_name, last_name, email, phone
       FROM users
       WHERE role='ADMIN' AND COALESCE(is_active, TRUE)=TRUE
       ORDER BY last_name, first_name, email`
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Nie udało się pobrać administratorów." });
  }
});

router.get("/", async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT t.id, t.ticket_number AS order_number, t.subject, t.description, t.status, t.priority,
              t.contact_name, t.contact_phone, t.created_at, COALESCE(t.updated_at, t.created_at) AS updated_at,
              c.id AS customer_id, c.name AS customer_name, c.email AS customer_email,
              co.id AS company_id, co.name AS company_name,
              o.id AS object_id, o.name AS object_name, o.address AS object_address, o.city AS object_city,
              creator.first_name AS creator_first_name, creator.last_name AS creator_last_name, creator.email AS creator_email,
              COUNT(ti.id)::int AS items_count,
              COALESCE(SUM(ti.total_net), 0)::numeric AS total_net
       FROM tickets t
       LEFT JOIN customers c ON c.id=t.customer_id
       LEFT JOIN companies co ON co.id=c.company_id
       LEFT JOIN objects o ON o.id=t.object_id
       LEFT JOIN users creator ON creator.id=t.created_by
       LEFT JOIN ticket_items ti ON ti.ticket_id=t.id
       WHERE t.type='ORDER'
       GROUP BY t.id, c.id, co.id, o.id, creator.id
       ORDER BY COALESCE(t.updated_at, t.created_at) DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Nie udało się pobrać zamówień." });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const order = await db.query(
      `SELECT t.*, t.ticket_number AS order_number,
              c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
              co.id AS company_id, co.name AS company_name,
              o.name AS object_name, o.address AS object_address, o.postal_code AS object_postal_code, o.city AS object_city,
              creator.first_name AS creator_first_name, creator.last_name AS creator_last_name, creator.email AS creator_email,
              assignee.id AS assigned_to_id, assignee.first_name AS assigned_first_name,
              assignee.last_name AS assigned_last_name, assignee.email AS assigned_email,
              (SELECT COUNT(*)::int FROM ticket_comments tc WHERE tc.ticket_id=t.id) AS comments_count,
              (SELECT COUNT(*)::int FROM ticket_photos tp WHERE tp.ticket_id=t.id) AS attachments_count,
              (SELECT COUNT(*)::int FROM ticket_history th WHERE th.ticket_id=t.id) AS history_count
       FROM tickets t
       LEFT JOIN customers c ON c.id=t.customer_id
       LEFT JOIN companies co ON co.id=c.company_id
       LEFT JOIN objects o ON o.id=t.object_id
       LEFT JOIN users creator ON creator.id=t.created_by
       LEFT JOIN users assignee ON assignee.id=t.assigned_to_id
       WHERE t.id=$1 AND t.type='ORDER'`,
      [req.params.id]
    );
    if (!order.rows[0]) return res.status(404).json({ error: "Zamówienie nie istnieje." });

    const [items, comments, offers] = await Promise.all([
      db.query(
      `SELECT id, product_id, name, code, producer, unit, quantity, price_net, vat_rate, total_net
       FROM ticket_items WHERE ticket_id=$1 ORDER BY id`,
      [req.params.id]
      ),
      db.query(
        `SELECT tc.id, tc.content, tc.created_at, u.id AS author_id, u.first_name, u.last_name, u.email, u.role
         FROM ticket_comments tc
         LEFT JOIN users u ON u.id=tc.author_id
         WHERE tc.ticket_id=$1 AND COALESCE(tc.is_internal, FALSE)=FALSE
         ORDER BY tc.created_at ASC`,
        [req.params.id]
      ),
      db.query(
        `SELECT o.id, o.offer_number, o.title, o.status, o.currency, o.issue_date, o.valid_until,
                o.created_at, o.updated_at, o.client_sent_at, o.accepted_at,
                COUNT(oi.id)::int AS items_count,
                COALESCE(SUM(oi.net_total), o.total_price, 0)::numeric AS total_net,
                COALESCE(SUM(oi.vat_value), 0)::numeric AS vat_total,
                COALESCE(SUM(oi.gross_total), o.total_price, 0)::numeric AS total_gross
         FROM offers o
         LEFT JOIN offer_items oi ON oi.offer_id=o.id
         WHERE o.ticket_id=$1
         GROUP BY o.id
         ORDER BY COALESCE(o.updated_at, o.created_at) DESC`,
        [req.params.id]
      )
    ]);
    res.json({ ...order.rows[0], items: items.rows, comments: comments.rows, offers: offers.rows });
  } catch (err) {
    res.status(500).json({ error: "Nie udało się pobrać zamówienia." });
  }
});

router.post("/:id/comments", async (req, res) => {
  const content = String(req.body.content || "").trim();
  if (!content) return res.status(400).json({ error: "Wpisz treść komentarza." });
  if (content.length > 5000) return res.status(400).json({ error: "Komentarz może mieć maksymalnie 5000 znaków." });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query(
      `SELECT t.id, t.ticket_number, u.id AS customer_user_id
       FROM tickets t
       LEFT JOIN customers c ON c.id=t.customer_id
       LEFT JOIN users u ON u.id=c.user_id
       WHERE t.id=$1 AND t.type='ORDER'`,
      [req.params.id]
    );
    if (!order.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zamówienie nie istnieje." });
    }
    const comment = await client.query(
      `INSERT INTO ticket_comments (ticket_id, author_id, content, is_internal)
       VALUES ($1,$2,$3,FALSE) RETURNING *`,
      [req.params.id, req.currentUser.id, content]
    );
    await client.query(
      `INSERT INTO ticket_history (ticket_id, user_id, action, old_value, new_value, metadata)
       VALUES ($1,$2,'ORDER_COMMENT_ADDED',NULL,$3,'{}'::jsonb)`,
      [req.params.id, req.currentUser.id, content]
    );
    await client.query("UPDATE tickets SET updated_at=CURRENT_TIMESTAMP WHERE id=$1", [req.params.id]);
    await client.query("COMMIT");

    if (order.rows[0].customer_user_id) {
      await createNotification({
        userId: order.rows[0].customer_user_id,
        category: "TICKETS",
        type: "ORDER_COMMENT_ADDED",
        priority: "INFO",
        title: "Nowy komentarz do zamówienia",
        message: `${order.rows[0].ticket_number}: ${content.slice(0, 160)}`,
        entityType: "ticket",
        entityId: order.rows[0].id,
        link: `/client/tickets/${order.rows[0].id}`
      });
    }
    res.status(201).json(comment.rows[0]);
  } catch {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Nie udało się dodać komentarza." });
  } finally {
    client.release();
  }
});

router.patch("/:id/assign", async (req, res) => {
  const adminId = Number(req.body.adminId);
  if (!adminId) return res.status(400).json({ error: "Wybierz administratora." });
  try {
    const admin = await db.query(
      "SELECT id FROM users WHERE id=$1 AND role='ADMIN' AND COALESCE(is_active, TRUE)=TRUE",
      [adminId]
    );
    if (!admin.rows[0]) return res.status(400).json({ error: "Wybrany opiekun nie jest aktywnym administratorem." });
    const result = await db.query(
      `UPDATE tickets SET assigned_to_id=$1, updated_at=CURRENT_TIMESTAMP
       WHERE id=$2 AND type='ORDER' RETURNING *`,
      [adminId, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Zamówienie nie istnieje." });
    await db.query(
      `INSERT INTO ticket_history (ticket_id, user_id, action, old_value, new_value, metadata)
       VALUES ($1,$2,'ORDER_ASSIGNED',NULL,$3,'{}'::jsonb)`,
      [req.params.id, req.currentUser.id, String(adminId)]
    );
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Nie udało się przypisać opiekuna." });
  }
});

router.patch("/:id/priority", async (req, res) => {
  const priority = String(req.body.priority || "").toUpperCase();
  if (!["LOW", "NORMAL", "HIGH", "CRITICAL"].includes(priority)) return res.status(400).json({ error: "Nieprawidłowy priorytet." });
  try {
    const current = await db.query("SELECT priority FROM tickets WHERE id=$1 AND type='ORDER'", [req.params.id]);
    if (!current.rows[0]) return res.status(404).json({ error: "Zamówienie nie istnieje." });
    const result = await db.query(
      "UPDATE tickets SET priority=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND type='ORDER' RETURNING *",
      [priority, req.params.id]
    );
    await db.query(
      `INSERT INTO ticket_history (ticket_id, user_id, action, old_value, new_value, metadata)
       VALUES ($1,$2,'ORDER_PRIORITY_CHANGED',$3,$4,'{}'::jsonb)`,
      [req.params.id, req.currentUser.id, current.rows[0].priority, priority]
    );
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Nie udało się zmienić priorytetu." });
  }
});

router.patch("/:id/status", async (req, res) => {
  const status = String(req.body.status || "").toUpperCase();
  if (!ORDER_STATUSES.has(status)) return res.status(400).json({ error: "Nieprawidłowy status zamówienia." });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT t.id, t.ticket_number, t.status, t.customer_id, u.id AS customer_user_id
       FROM tickets t
       LEFT JOIN customers c ON c.id=t.customer_id
       LEFT JOIN users u ON u.id=c.user_id
       WHERE t.id=$1 AND t.type='ORDER' FOR UPDATE OF t`,
      [req.params.id]
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Zamówienie nie istnieje." });
    }

    const updated = await client.query(
      `UPDATE tickets SET status=$1, updated_at=CURRENT_TIMESTAMP,
              closed_at=CASE WHEN $1 IN ('COMPLETED','CANCELLED') THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    );
    await client.query(
      `INSERT INTO ticket_history (ticket_id, user_id, action, old_value, new_value, metadata)
       VALUES ($1,$2,'ORDER_STATUS_CHANGED',$3,$4,'{}'::jsonb)`,
      [req.params.id, req.currentUser.id, current.rows[0].status, status]
    );
    await client.query("COMMIT");

    if (current.rows[0].customer_user_id) {
      await createNotification({
        userId: current.rows[0].customer_user_id,
        category: "TICKETS",
        type: "ORDER_STATUS_CHANGED",
        priority: status === "CANCELLED" ? "WARNING" : status === "COMPLETED" ? "SUCCESS" : "INFO",
        title: "Zmiana statusu zamówienia",
        message: `${current.rows[0].ticket_number}: ${status}`,
        entityType: "ticket",
        entityId: current.rows[0].id,
        link: `/client/tickets/${current.rows[0].id}`
      });
    }
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Nie udało się zmienić statusu zamówienia." });
  } finally {
    client.release();
  }
});

export default router;
