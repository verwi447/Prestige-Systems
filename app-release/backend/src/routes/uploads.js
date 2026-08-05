import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

const companyUploadDir = path.join(__dirname, "../../uploads/company");
fs.mkdirSync(companyUploadDir, { recursive: true });

const allowedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp"
]);

const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, companyUploadDir),
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const hasAllowedType = !file.mimetype || allowedMimeTypes.has(file.mimetype) || file.mimetype.startsWith("image/");
    if (!allowedExtensions.has(extension) || !hasAllowedType) {
      return cb(new Error("Logo musi być plikiem PNG, JPG, SVG albo WEBP."));
    }
    cb(null, true);
  }
});

router.use(auth, loadCurrentUser, requireRole("ADMIN"));

router.post("/company-logo", (req, res) => {
  upload.single("logo")(req, res, async (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Logo może mieć maksymalnie 5 MB." });
    }
    if (error) return res.status(400).json({ error: error.message || "Nie udało się wysłać logo." });
    if (!req.file) return res.status(400).json({ error: "Wybierz plik logo." });

    const logoUrl = `/uploads/company/${req.file.filename}`;
    let existing = await db.query("SELECT id FROM own_company ORDER BY id ASC LIMIT 1");
    if (!existing.rows[0]) {
      existing = await db.query("INSERT INTO own_company (name) VALUES ($1) RETURNING id", ["Prestige Systems"]);
    }
    await db.query("UPDATE own_company SET logo_url=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2", [logoUrl, existing.rows[0].id]);

    res.json({ logoUrl });
  });
});

export default router;
