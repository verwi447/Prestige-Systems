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

const knowledgeCategories = new Set(["GENERAL", "HARDWARE_FAILURE", "SYSTEM_FAILURE"]);

router.get("/knowledge", async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT kb.id, kb.title, kb.content, kb.category, kb.created_at, kb.updated_at,
              u.first_name, u.last_name, u.email
       FROM ai_knowledge_base kb
       LEFT JOIN users u ON u.id=kb.created_by
       ORDER BY kb.updated_at DESC`
    );
    res.json(result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      authorName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || "-"
    })));
  } catch (error) {
    res.status(500).json({ error: "Nie udalo sie pobrac bazy wiedzy." });
  }
});

router.post("/knowledge", async (req, res) => {
  const title = String(req.body.title || "").trim();
  const content = String(req.body.content || "").trim();
  const category = knowledgeCategories.has(req.body.category) ? req.body.category : "GENERAL";

  if (!title || !content) return res.status(400).json({ error: "Tytul i tresc sa wymagane." });

  try {
    const result = await db.query(
      `INSERT INTO ai_knowledge_base (title, content, category, created_by)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [title, content, category, req.user.id]
    );
    await writeAuditLog({
      category: "SYSTEM",
      action: "AI_KNOWLEDGE_BASE_ENTRY_ADDED",
      userId: req.user.id,
      entityType: "ai_knowledge_base",
      entityId: result.rows[0].id,
      message: `Dodano wpis do bazy wiedzy AI: ${title}`
    }).catch((error) => console.error("Global audit log failed:", error));
    res.status(201).json({ id: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ error: "Nie udalo sie dodac wpisu do bazy wiedzy." });
  }
});

router.put("/knowledge/:id", async (req, res) => {
  const title = String(req.body.title || "").trim();
  const content = String(req.body.content || "").trim();
  const category = knowledgeCategories.has(req.body.category) ? req.body.category : "GENERAL";

  if (!title || !content) return res.status(400).json({ error: "Tytul i tresc sa wymagane." });

  try {
    const result = await db.query(
      `UPDATE ai_knowledge_base SET title=$1, content=$2, category=$3, updated_at=CURRENT_TIMESTAMP
       WHERE id=$4 RETURNING id`,
      [title, content, category, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Wpis nie istnieje." });
    await writeAuditLog({
      category: "SYSTEM",
      action: "AI_KNOWLEDGE_BASE_ENTRY_UPDATED",
      userId: req.user.id,
      entityType: "ai_knowledge_base",
      entityId: req.params.id,
      message: `Zaktualizowano wpis w bazie wiedzy AI: ${title}`
    }).catch((error) => console.error("Global audit log failed:", error));
    res.json({ id: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ error: "Nie udalo sie zapisac wpisu bazy wiedzy." });
  }
});

router.delete("/knowledge/:id", async (req, res) => {
  try {
    const result = await db.query("DELETE FROM ai_knowledge_base WHERE id=$1 RETURNING title", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Wpis nie istnieje." });
    await writeAuditLog({
      category: "SYSTEM",
      action: "AI_KNOWLEDGE_BASE_ENTRY_DELETED",
      userId: req.user.id,
      entityType: "ai_knowledge_base",
      entityId: req.params.id,
      message: `Usunieto wpis z bazy wiedzy AI: ${result.rows[0].title}`
    }).catch((error) => console.error("Global audit log failed:", error));
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: "Nie udalo sie usunac wpisu bazy wiedzy." });
  }
});

export default router;
