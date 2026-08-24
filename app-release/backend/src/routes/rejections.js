import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";

import { autoAsyncRoutes } from "../utils/autoAsyncRoutes.js";

const router = express.Router();
autoAsyncRoutes(router);
router.use(auth, loadCurrentUser, requireRole("ADMIN"));

// Get rejections for offer
router.get("/offer/:offer_id", auth, async (req, res) => {
  try {
    const rejections = await db.query(
      `SELECT r.*, u.username FROM rejections r
       JOIN users u ON r.rejected_by = u.id
       WHERE r.offer_id=$1
       ORDER BY r.rejected_at DESC`,
      [req.params.offer_id]
    );
    res.json(rejections.rows);
  } catch (err) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

// Reject offer
router.post("/", auth, async (req, res) => {
  try {
    const { offer_id, reason } = req.body;
    
    // Update offer status
    await db.query(
      "UPDATE offers SET status='ODRZUCONA' WHERE id=$1",
      [offer_id]
    );

    // Create rejection record
    const rejection = await db.query(
      `INSERT INTO rejections (offer_id, reason, rejected_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [offer_id, reason, req.user.id]
    );
    res.json(rejection.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

export default router;
