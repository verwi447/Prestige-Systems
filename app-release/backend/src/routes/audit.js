import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";
import { AUDIT_CATEGORIES } from "../utils/auditLog.js";

const router = express.Router();

router.use(auth, loadCurrentUser, requireRole("ADMIN"));

const asInteger = (value, fallback, min, max) => {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) ? Math.min(Math.max(number, min), max) : fallback;
};

router.get("/", async (req, res) => {
  try {
    const page = asInteger(req.query.page, 1, 1, 100000);
    const limit = asInteger(req.query.limit, 30, 1, 100);
    const category = String(req.query.category || "").toUpperCase();
    const userId = asInteger(req.query.userId, null, 1, Number.MAX_SAFE_INTEGER);
    const query = String(req.query.query || "").trim().slice(0, 120);
    const dateFrom = String(req.query.dateFrom || "").trim();
    const dateTo = String(req.query.dateTo || "").trim();
    const params = [];
    const filters = [];

    if (AUDIT_CATEGORIES.includes(category)) {
      params.push(category);
      filters.push(`al.category=$${params.length}`);
    }
    if (userId) {
      params.push(userId);
      filters.push(`al.user_id=$${params.length}`);
    }
    if (query) {
      params.push(`%${query}%`);
      filters.push(`(al.action ILIKE $${params.length} OR al.message ILIKE $${params.length} OR al.entity_id ILIKE $${params.length})`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      params.push(dateFrom);
      filters.push(`al.created_at >= $${params.length}::date`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      params.push(dateTo);
      filters.push(`al.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM system_audit_log al ${where}`, params);
    params.push(limit, (page - 1) * limit);
    const result = await db.query(
      `SELECT al.*, u.first_name, u.last_name, u.email, u.username
       FROM system_audit_log al
       LEFT JOIN users u ON u.id=al.user_id
       ${where}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      items: result.rows,
      page,
      limit,
      total: countResult.rows[0]?.total || 0
    });
  } catch (error) {
    console.error("Failed to load audit log:", error);
    res.status(500).json({ error: "Nie udalo sie pobrac dziennika audytu." });
  }
});

router.get("/users", async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, u.username
       FROM system_audit_log al
       JOIN users u ON u.id=al.user_id
       ORDER BY u.last_name, u.first_name, u.email`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Failed to load audit users:", error);
    res.status(500).json({ error: "Nie udalo sie pobrac uzytkownikow dziennika." });
  }
});

export default router;
