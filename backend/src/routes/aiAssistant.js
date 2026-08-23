import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";
import { writeAuditLog } from "../utils/auditLog.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const knowledgeUploadDir = path.join(__dirname, "../../uploads/knowledge");
fs.mkdirSync(knowledgeUploadDir, { recursive: true });

const knowledgeFileMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const knowledgeFileExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);
const knowledgeFileUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, knowledgeUploadDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname || "").toLowerCase();
      cb(null, `${randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    if (!knowledgeFileMimeTypes.has(file.mimetype) || !knowledgeFileExtensions.has(extension)) {
      return cb(new Error("Plik musi byc w formacie JPG, PNG, WEBP albo PDF - to jedyne formaty, ktore asystent AI potrafi odczytac."));
    }
    cb(null, true);
  }
});

function removeUploadedFiles(files) {
  (files || []).forEach((file) => fs.unlink(file.path, () => {}));
}

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

function normalizeCategory(value) {
  const trimmed = String(value || "").trim().slice(0, 80);
  return trimmed || "Ogólne";
}

function knowledgeFileRow(row) {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    uploadedAt: row.uploaded_at
  };
}

router.get("/knowledge", async (_req, res) => {
  try {
    const [entries, files] = await Promise.all([
      db.query(
        `SELECT kb.id, kb.title, kb.content, kb.solution, kb.category, kb.created_at, kb.updated_at,
                u.first_name, u.last_name, u.email
         FROM ai_knowledge_base kb
         LEFT JOIN users u ON u.id=kb.created_by
         ORDER BY kb.updated_at DESC`
      ),
      db.query(`SELECT id, knowledge_base_id, original_name, mime_type, file_size, uploaded_at FROM ai_knowledge_base_files ORDER BY uploaded_at ASC`)
    ]);
    const filesByEntry = new Map();
    for (const row of files.rows) {
      const list = filesByEntry.get(row.knowledge_base_id) || [];
      list.push(knowledgeFileRow(row));
      filesByEntry.set(row.knowledge_base_id, list);
    }
    res.json(entries.rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      solution: row.solution,
      category: row.category,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      authorName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || "-",
      files: filesByEntry.get(row.id) || []
    })));
  } catch (error) {
    res.status(500).json({ error: "Nie udalo sie pobrac bazy wiedzy." });
  }
});

router.post("/knowledge", async (req, res) => {
  const title = String(req.body.title || "").trim();
  const content = String(req.body.content || "").trim();
  const solution = String(req.body.solution || "").trim() || null;
  const category = normalizeCategory(req.body.category);

  if (!title || !content) return res.status(400).json({ error: "Tytul i tresc sa wymagane." });

  try {
    const result = await db.query(
      `INSERT INTO ai_knowledge_base (title, content, solution, category, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [title, content, solution, category, req.user.id]
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
  const solution = String(req.body.solution || "").trim() || null;
  const category = normalizeCategory(req.body.category);

  if (!title || !content) return res.status(400).json({ error: "Tytul i tresc sa wymagane." });

  try {
    const result = await db.query(
      `UPDATE ai_knowledge_base SET title=$1, content=$2, solution=$3, category=$4, updated_at=CURRENT_TIMESTAMP
       WHERE id=$5 RETURNING id`,
      [title, content, solution, category, req.params.id]
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
    const files = await db.query("SELECT file_name FROM ai_knowledge_base_files WHERE knowledge_base_id=$1", [req.params.id]);
    const result = await db.query("DELETE FROM ai_knowledge_base WHERE id=$1 RETURNING title", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Wpis nie istnieje." });
    files.rows.forEach((row) => fs.unlink(path.join(knowledgeUploadDir, row.file_name), () => {}));
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

router.post("/knowledge/:id/files", knowledgeFileUpload.array("files", 5), async (req, res) => {
  try {
    const entry = await db.query("SELECT id, title FROM ai_knowledge_base WHERE id=$1", [req.params.id]);
    if (!entry.rows[0]) {
      removeUploadedFiles(req.files);
      return res.status(404).json({ error: "Wpis nie istnieje." });
    }

    const saved = [];
    for (const file of req.files || []) {
      const result = await db.query(
        `INSERT INTO ai_knowledge_base_files (knowledge_base_id, file_name, original_name, mime_type, file_size)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, knowledge_base_id, original_name, mime_type, file_size, uploaded_at`,
        [req.params.id, file.filename, file.originalname, file.mimetype, file.size]
      );
      saved.push(knowledgeFileRow(result.rows[0]));
    }
    await writeAuditLog({
      category: "SYSTEM",
      action: "AI_KNOWLEDGE_BASE_FILE_ADDED",
      userId: req.user.id,
      entityType: "ai_knowledge_base",
      entityId: req.params.id,
      message: `Dodano ${saved.length} plik(i) do wpisu bazy wiedzy AI: ${entry.rows[0].title}`
    }).catch((error) => console.error("Global audit log failed:", error));
    res.status(201).json(saved);
  } catch (error) {
    removeUploadedFiles(req.files);
    res.status(500).json({ error: "Nie udalo sie dodac plikow." });
  }
});

router.delete("/knowledge/:id/files/:fileId", async (req, res) => {
  try {
    const result = await db.query(
      "DELETE FROM ai_knowledge_base_files WHERE id=$1 AND knowledge_base_id=$2 RETURNING file_name",
      [req.params.fileId, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Plik nie istnieje." });
    fs.unlink(path.join(knowledgeUploadDir, result.rows[0].file_name), () => {});
    await writeAuditLog({
      category: "SYSTEM",
      action: "AI_KNOWLEDGE_BASE_FILE_DELETED",
      userId: req.user.id,
      entityType: "ai_knowledge_base",
      entityId: req.params.id,
      message: "Usunieto plik ze wpisu bazy wiedzy AI"
    }).catch((error) => console.error("Global audit log failed:", error));
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: "Nie udalo sie usunac pliku." });
  }
});

router.get("/knowledge/:id/files/:fileId", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT file_name, original_name, mime_type FROM ai_knowledge_base_files WHERE id=$1 AND knowledge_base_id=$2",
      [req.params.fileId, req.params.id]
    );
    const file = result.rows[0];
    if (!file) return res.status(404).json({ error: "Plik nie istnieje." });
    const fullPath = path.resolve(knowledgeUploadDir, path.basename(file.file_name));
    if (!fullPath.startsWith(path.resolve(knowledgeUploadDir) + path.sep) || !fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "Plik nie istnieje." });
    }
    if (file.mime_type) res.type(file.mime_type);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(file.original_name || file.file_name).replace(/[\r\n"]/g, "_")}"`);
    res.sendFile(fullPath);
  } catch (error) {
    res.status(500).json({ error: "Nie udalo sie pobrac pliku." });
  }
});

function equipmentRow(row) {
  return { id: row.id, name: row.name, isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at };
}

router.get("/equipment", async (_req, res) => {
  try {
    const result = await db.query("SELECT id, name, is_active, created_at, updated_at FROM ai_equipment_types ORDER BY name");
    res.json(result.rows.map(equipmentRow));
  } catch (error) {
    res.status(500).json({ error: "Nie udalo sie pobrac listy urzadzen." });
  }
});

router.post("/equipment", async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "Podaj nazwe urzadzenia." });

  try {
    const result = await db.query(
      "INSERT INTO ai_equipment_types (name) VALUES ($1) RETURNING id, name, is_active, created_at, updated_at",
      [name]
    );
    await writeAuditLog({
      category: "SYSTEM",
      action: "AI_EQUIPMENT_TYPE_ADDED",
      userId: req.user.id,
      entityType: "ai_equipment_types",
      entityId: result.rows[0].id,
      message: `Dodano urzadzenie: ${name}`
    }).catch((error) => console.error("Global audit log failed:", error));
    res.status(201).json(equipmentRow(result.rows[0]));
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Urzadzenie o tej nazwie juz istnieje." });
    res.status(500).json({ error: "Nie udalo sie dodac urzadzenia." });
  }
});

router.put("/equipment/:id", async (req, res) => {
  const hasName = req.body.name !== undefined;
  const name = hasName ? String(req.body.name || "").trim().slice(0, 80) : null;
  const hasActive = req.body.isActive !== undefined;
  const isActive = hasActive ? Boolean(req.body.isActive) : null;

  if (hasName && !name) return res.status(400).json({ error: "Podaj nazwe urzadzenia." });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT name FROM ai_equipment_types WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Urzadzenie nie istnieje." });
    }

    const nextName = hasName ? name : current.rows[0].name;
    const result = await client.query(
      `UPDATE ai_equipment_types SET name=$1, is_active=COALESCE($2, is_active), updated_at=CURRENT_TIMESTAMP
       WHERE id=$3 RETURNING id, name, is_active, created_at, updated_at`,
      [nextName, hasActive ? isActive : null, req.params.id]
    );

    if (hasName && nextName !== current.rows[0].name) {
      await client.query("UPDATE ai_knowledge_base SET category=$1 WHERE category=$2", [nextName, current.rows[0].name]);
      await client.query("UPDATE tickets SET category=$1 WHERE category=$2", [nextName, current.rows[0].name]);
    }

    await client.query("COMMIT");
    await writeAuditLog({
      category: "SYSTEM",
      action: "AI_EQUIPMENT_TYPE_UPDATED",
      userId: req.user.id,
      entityType: "ai_equipment_types",
      entityId: req.params.id,
      message: `Zaktualizowano urzadzenie: ${nextName}`,
      metadata: { previousName: current.rows[0].name, name: nextName, isActive }
    }).catch((error) => console.error("Global audit log failed:", error));

    res.json(equipmentRow(result.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "Urzadzenie o tej nazwie juz istnieje." });
    res.status(500).json({ error: "Nie udalo sie zapisac urzadzenia." });
  } finally {
    client.release();
  }
});

export default router;
