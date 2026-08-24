import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { canAccessSite, getEffectivePermissions, normalizeRole } from "../middleware/access.js";

import { autoAsyncRoutes } from "../utils/autoAsyncRoutes.js";

const router = express.Router();
autoAsyncRoutes(router);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsRoot = path.resolve(__dirname, "../../uploads");

router.use(auth);

function safeName(value) {
  return path.basename(String(value || "")).replace(/[\r\n"]/g, "_");
}

function sendStoredFile(res, directory, storedName, originalName, mimeType) {
  const fileName = safeName(storedName);
  if (!fileName || fileName !== storedName) return res.status(404).json({ error: "Plik nie istnieje." });

  const fullPath = path.resolve(uploadsRoot, directory, fileName);
  const allowedRoot = path.resolve(uploadsRoot, directory) + path.sep;
  if (!fullPath.startsWith(allowedRoot) || !fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "Plik nie istnieje." });
  }

  if (mimeType) res.type(mimeType);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `inline; filename="${safeName(originalName || fileName)}"`);
  return res.sendFile(fullPath);
}

router.get("/ticket-attachments/:attachmentId", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT tp.file_name, tp.original_name, tp.mime_type, COALESCE(tp.visibility, 'PUBLIC') AS visibility,
              t.object_id,
              c.company_id
       FROM ticket_photos tp
       JOIN tickets t ON t.id=tp.ticket_id
       LEFT JOIN customers c ON c.id=t.customer_id
       WHERE tp.id=$1`,
      [req.params.attachmentId]
    );
    const file = result.rows[0];
    if (!file) return res.status(404).json({ error: "Plik nie istnieje." });

    const role = normalizeRole(req.user.role);
    const isAdmin = role === "ADMIN";
    const sameCompany = Number(req.user.companyId) === Number(file.company_id);
    const permissions = await getEffectivePermissions(req.user);
    const hasSiteAccess = role !== "CLIENT_EMPLOYEE" || await canAccessSite(req.user, file.object_id);
    if (!isAdmin && (!sameCompany || file.visibility !== "PUBLIC" || !permissions.has("VIEW_TICKETS") || !hasSiteAccess)) {
      return res.status(404).json({ error: "Plik nie istnieje." });
    }

    return sendStoredFile(res, "tickets", file.file_name, file.original_name, file.mime_type);
  } catch (error) {
    console.error("Failed to serve ticket attachment:", error);
    return res.status(500).json({ error: "Wewnetrzny blad serwera." });
  }
});

router.get("/offer-attachments/:attachmentId", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.file_name, o.object_id, c.company_id
       FROM photos p
       JOIN offers o ON o.id=p.offer_id
       LEFT JOIN customers c ON c.id=o.customer_id
       WHERE p.id=$1`,
      [req.params.attachmentId]
    );
    const file = result.rows[0];
    if (!file) return res.status(404).json({ error: "Plik nie istnieje." });

    const role = normalizeRole(req.user.role);
    const isAdmin = role === "ADMIN";
    const permissions = await getEffectivePermissions(req.user);
    const hasSiteAccess = role !== "CLIENT_EMPLOYEE" || await canAccessSite(req.user, file.object_id);
    if (!isAdmin && (Number(req.user.companyId) !== Number(file.company_id) || !permissions.has("VIEW_OFFERS") || !hasSiteAccess)) {
      return res.status(404).json({ error: "Plik nie istnieje." });
    }

    return sendStoredFile(res, "", file.file_name, file.file_name, null);
  } catch (error) {
    console.error("Failed to serve offer attachment:", error);
    return res.status(500).json({ error: "Wewnetrzny blad serwera." });
  }
});

export default router;
