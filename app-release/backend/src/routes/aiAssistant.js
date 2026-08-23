import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";
import { writeAuditLog } from "../utils/auditLog.js";

const router = express.Router();

router.use(auth, loadCurrentUser, requireRole("ADMIN"));

router.get("/settings", async (_req, res) => {
  try {
    const result = await db.query("SELECT * FROM ai_assistant_settings WHERE id='default'");
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Nie udalo sie pobrac ustawien asystenta AI." });
  }
});

router.put("/settings", async (req, res) => {
  const autoSendEnabled = Boolean(req.body.autoSendEnabled);

  try {
    const result = await db.query(
      `UPDATE ai_assistant_settings SET auto_send_enabled=$1, updated_at=CURRENT_TIMESTAMP
       WHERE id='default' RETURNING *`,
      [autoSendEnabled]
    );
    await writeAuditLog({
      category: "SYSTEM",
      action: "AI_ASSISTANT_SETTINGS_CHANGED",
      userId: req.user.id,
      entityType: "ai_assistant_settings",
      entityId: "default",
      message: autoSendEnabled
        ? "Wlaczono automatyczna wysylke sugestii AI do klientow"
        : "Wylaczono automatyczna wysylke sugestii AI do klientow",
      metadata: { autoSendEnabled }
    }).catch((error) => console.error("Global audit log failed:", error));
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Nie udalo sie zapisac ustawien asystenta AI." });
  }
});

export default router;
