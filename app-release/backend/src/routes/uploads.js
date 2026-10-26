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

// Usuwa wylacznie plik lezacy w katalogu logo i tylko wtedy, gdy nie jest to
// plik wlasnie wgrany - sciezka pochodzi z bazy, wiec nie moze wyprowadzic
// kasowania poza uploads/company.
export function removeSupersededLogo(previousLogoUrl, currentFileName) {
  const previousName = path.basename(String(previousLogoUrl || ""));
  if (!previousName || previousName === currentFileName) return;
  if (!String(previousLogoUrl).startsWith("/uploads/company/")) return;

  const previousPath = path.join(companyUploadDir, previousName);
  if (path.dirname(previousPath) !== companyUploadDir) return;

  fs.rm(previousPath, { force: true }, (error) => {
    if (error) console.error("Failed to remove superseded company logo:", error);
  });
}

router.use(auth, loadCurrentUser, requireRole("ADMIN"));

router.post("/company-logo", (req, res) => {
  upload.single("logo")(req, res, async (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Logo może mieć maksymalnie 5 MB." });
    }
    if (error) return res.status(400).json({ error: error.message || "Nie udało się wysłać logo." });
    if (!req.file) return res.status(400).json({ error: "Wybierz plik logo." });

    try {
      const logoUrl = `/uploads/company/${req.file.filename}`;
      let existing = await db.query("SELECT id, logo_url FROM own_company ORDER BY id ASC LIMIT 1");
      if (!existing.rows[0]) {
        existing = await db.query("INSERT INTO own_company (name) VALUES ($1) RETURNING id, logo_url", ["Prestige Systems"]);
      }
      const previousLogoUrl = existing.rows[0].logo_url;
      await db.query("UPDATE own_company SET logo_url=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2", [logoUrl, existing.rows[0].id]);

      // Podmiana logo tylko przestawiala wskaznik w bazie, wiec katalog
      // uploads/company rosl o kazdy wgrany wczesniej plik bez konca.
      // Sprzatanie po udanym UPDATE: osierocony plik jest mniejszym problemem
      // niz logo usuniete przy nieudanym zapisie.
      removeSupersededLogo(previousLogoUrl, req.file.filename);

      res.json({ logoUrl });
    } catch (dbError) {
      console.error("Failed to save company logo:", dbError);
      res.status(500).json({ error: "Wewnętrzny błąd serwera." });
    }
  });
});

export default router;
