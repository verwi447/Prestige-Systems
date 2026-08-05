import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { isPermanentAccount } from "../permanentAccount.js";
import { logError } from "../logger.js";

const router = express.Router();

async function requireAdmin(req, res) {
  const user = await db.query("SELECT * FROM users WHERE id=$1", [req.user.id]);
  if (user.rows[0]?.role !== "ADMIN") {
    res.status(403).json({ error: "Brak dostępu" });
    return null;
  }
  return user.rows[0];
}

// Dashboard stats
router.get("/stats", auth, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const totalOffers = await db.query("SELECT COUNT(*) FROM offers");
    const offersByStatus = await db.query(
      "SELECT status, COUNT(*) as count FROM offers GROUP BY status"
    );
    const totalObjects = await db.query("SELECT COUNT(*) FROM objects");
    const totalUsers = await db.query("SELECT COUNT(*) FROM users");

    res.json({
      totalOffers: parseInt(totalOffers.rows[0].count),
      offersByStatus: offersByStatus.rows,
      totalObjects: parseInt(totalObjects.rows[0].count),
      totalUsers: parseInt(totalUsers.rows[0].count)
    });
  } catch (err) {
    logError(err, 'backend');
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

// Get all users (admin only)
router.get("/users", auth, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const users = await db.query(
      `SELECT id, username, role, created_at,
        LOWER(username) = LOWER($1) AS is_permanent
       FROM users
       ORDER BY created_at DESC`,
      ["Verwi"]
    );
    res.json(users.rows);
  } catch (err) {
    logError(err, 'backend');
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

// Create user (admin only)
router.post("/users", auth, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { username, password, role } = req.body;
    const validRoles = ["USER", "ADMIN"];

    if (!username?.trim() || !password?.trim()) {
      return res.status(400).json({ error: "Podaj login i hasło" });
    }
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: "Niepoprawna rola" });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await db.query(
      "INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at",
      [username.trim(), hash, role]
    );

    res.json(user.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Taki użytkownik już istnieje" });
    }
    logError(err, 'backend');
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

// Update user role (admin only)
router.put("/users/:id", auth, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { role } = req.body;
    const validRoles = ["USER", "ADMIN"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: "Niepoprawna rola" });
    }

    const target = await db.query("SELECT id, username FROM users WHERE id=$1", [req.params.id]);
    if (!target.rows[0]) return res.status(404).json({ error: "Użytkownik nie znaleziony" });
    if (isPermanentAccount(target.rows[0].username) && role !== "ADMIN") {
      return res.status(400).json({ error: "Konto Verwi jest stałe i musi pozostać administratorem" });
    }

    const user = await db.query(
      "UPDATE users SET role=$1 WHERE id=$2 RETURNING id, username, role",
      [role, req.params.id]
    );

    res.json(user.rows[0]);
  } catch (err) {
    logError(err, 'backend');
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

// Delete user (admin only)
router.delete("/users/:id", auth, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const target = await db.query("SELECT id, username FROM users WHERE id=$1", [req.params.id]);
    if (!target.rows[0]) return res.status(404).json({ error: "Użytkownik nie znaleziony" });
    if (isPermanentAccount(target.rows[0].username)) {
      return res.status(400).json({ error: "Konta Verwi nie można usunąć" });
    }

    await db.query("DELETE FROM users WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    logError(err, 'backend');
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

// Get all activities
router.get("/activities", auth, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const activities = await db.query(
      `(SELECT 'offer_created' as type, o.created_at as timestamp, u.username, o.title as description
        FROM offers o
        JOIN users u ON o.created_by = u.id)
       UNION ALL
       (SELECT 'comment_added' as type, c.created_at as timestamp, u.username, c.content as description
        FROM comments c
        JOIN users u ON c.author_id = u.id)
       UNION ALL
       (SELECT 'offer_rejected' as type, r.rejected_at as timestamp, u.username, r.reason as description
        FROM rejections r
        JOIN users u ON r.rejected_by = u.id)
       ORDER BY timestamp DESC
       LIMIT 50`
    );
    res.json(activities.rows);
  } catch (err) {
    logError(err, 'backend');
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

export default router;
