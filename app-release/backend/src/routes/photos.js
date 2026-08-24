import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({
  dest: path.join(__dirname, "../../uploads"),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Niepoprawny format pliku"));
    }
  }
});

import { autoAsyncRoutes } from "../utils/autoAsyncRoutes.js";

const router = express.Router();
autoAsyncRoutes(router);
router.use(auth, loadCurrentUser, requireRole("ADMIN"));

// Get photos for offer
router.get("/offer/:offer_id", auth, async (req, res) => {
  try {
    const photos = await db.query(
      `SELECT p.*, u.username FROM photos p
       JOIN users u ON p.uploaded_by = u.id
       WHERE p.offer_id=$1
       ORDER BY p.uploaded_at DESC`,
      [req.params.offer_id]
    );
    res.json(photos.rows.map((photo) => ({
      ...photo,
      file_path: `/api/files/offer-attachments/${photo.id}`,
      url: `/api/files/offer-attachments/${photo.id}`
    })));
  } catch (err) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

// Upload photo
router.post("/upload", auth, upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Brak pliku" });

    const { offer_id } = req.body;
    const extensionByMime = {
      "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp",
      "application/pdf": ".pdf", "application/msword": ".doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
      "application/vnd.ms-excel": ".xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx"
    };
    const fileName = `${randomUUID()}${extensionByMime[req.file.mimetype] || ""}`;
    const filePath = `/uploads/${fileName}`;

    // Rename uploaded file
    fs.renameSync(req.file.path, path.join(__dirname, `../../uploads/${fileName}`));

    const photo = await db.query(
      `INSERT INTO photos (offer_id, file_name, file_path, file_size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [offer_id, fileName, filePath, req.file.size, req.user.id]
    );
    res.json({
      ...photo.rows[0],
      file_path: `/api/files/offer-attachments/${photo.rows[0].id}`,
      url: `/api/files/offer-attachments/${photo.rows[0].id}`
    });
  } catch (err) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

// Delete photo
router.delete("/:id", auth, async (req, res) => {
  try {
    const photo = await db.query("SELECT file_path FROM photos WHERE id=$1", [req.params.id]);
    if (!photo.rows[0]) return res.status(404).json({ error: "Zdjęcie nie znalezione" });

    // Delete file
    const filePath = path.join(__dirname, `../../${photo.rows[0].file_path}`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await db.query("DELETE FROM photos WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

export default router;
