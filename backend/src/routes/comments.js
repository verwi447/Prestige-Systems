import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";

const router = express.Router();
router.use(auth, loadCurrentUser, requireRole("ADMIN"));

// Get comments for offer
router.get("/offer/:offer_id", auth, async (req, res) => {
  try {
    const comments = await db.query(
      `SELECT c.*, u.username FROM comments c
       JOIN users u ON c.author_id = u.id
       WHERE c.offer_id=$1
       ORDER BY c.created_at DESC`,
      [req.params.offer_id]
    );
    res.json(comments.rows);
  } catch (err) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

// Add comment
router.post("/", auth, async (req, res) => {
  try {
    const { offer_id, content, is_internal = false } = req.body;
    const comment = await db.query(
      `INSERT INTO comments (offer_id, author_id, content, is_internal)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [offer_id, req.user.id, content, Boolean(is_internal)]
    );
    res.json(comment.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

// Delete comment
router.delete("/:id", auth, async (req, res) => {
  try {
    const comment = await db.query("DELETE FROM comments WHERE id=$1 RETURNING *", [req.params.id]);
    if (!comment.rows[0]) return res.status(404).json({ error: "Komentarz nie znaleziony" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

export default router;
