import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";
import {
  auditBackup,
  createBackupJob,
  deleteBackup,
  ensureDefaultBackupData,
  getDefaultLocation,
  importBackupFile,
  normalizeBackupRow,
  restoreBackup,
  runIntegrityCheck,
  runTestRestore,
  startBackupScheduler,
  testBackupLocation,
  verifyAdminPassword
} from "../utils/backupService.js";

import { autoAsyncRoutes } from "../utils/autoAsyncRoutes.js";

const router = express.Router();
autoAsyncRoutes(router);
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempImportDir = path.resolve(__dirname, "../../.backup-imports");

await fs.mkdir(tempImportDir, { recursive: true });
startBackupScheduler();

const upload = multer({
  dest: tempImportDir,
  limits: { fileSize: 100 * 1024 * 1024 * 1024 }
});

router.use(auth, loadCurrentUser, requireRole("ADMIN"));

const ipOf = (req) => req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || null;

async function findJob(id) {
  const result = await db.query("SELECT * FROM backup_jobs WHERE id=$1", [id]);
  return result.rows[0] || null;
}

async function pickWindowsFolder() {
  const script = `
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Wybierz folder na backupy'
    $dialog.ShowNewFolderButton = $true
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      Write-Output $dialog.SelectedPath
    }
  `;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: false,
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024
    });
    return stdout.trim();
  } catch (error) {
    const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
    throw new Error(detail || "Nie udało się otworzyć okna wyboru folderu.");
  }
}

router.get("/", async (_req, res) => {
  try {
    await ensureDefaultBackupData();
    const result = await db.query(`
      SELECT bj.*, bl.name AS location_name, u.first_name, u.last_name, u.email, u.username
      FROM backup_jobs bj
      LEFT JOIN backup_locations bl ON bl.id=bj.location_id
      LEFT JOIN users u ON u.id=bj.created_by_id
      ORDER BY bj.created_at DESC
    `);
    res.json(result.rows.map(normalizeBackupRow));
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.post("/create", async (req, res) => {
  try {
    const job = await createBackupJob({ type: "MANUAL", user: req.currentUser, ipAddress: ipOf(req) });
    res.status(202).json(job);
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.get("/settings", async (_req, res) => {
  try {
    await ensureDefaultBackupData();
    const result = await db.query("SELECT * FROM backup_settings WHERE id='default'");
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Nie udało się pobrać ustawień backupu." });
  }
});

router.put("/settings", async (req, res) => {
  const {
    enabled,
    frequency,
    timeOfDay,
    retentionCount,
    includeDatabase,
    includeUploads,
    includePdf,
    includeConfig,
    encryptionEnabled
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE backup_settings SET
        enabled=$1,
        frequency=$2,
        time_of_day=$3,
        retention_count=$4,
        include_database=$5,
        include_uploads=$6,
        include_pdf=$7,
        include_config=$8,
        encryption_enabled=$9,
        updated_at=CURRENT_TIMESTAMP
       WHERE id='default'
       RETURNING *`,
      [
        Boolean(enabled),
        frequency || "DAILY",
        timeOfDay || "02:30",
        Number(retentionCount) || 10,
        includeDatabase !== false,
        includeUploads !== false,
        includePdf !== false,
        includeConfig !== false,
        encryptionEnabled !== false
      ]
    );
    await auditBackup({ action: "SETTINGS_UPDATE", userId: req.currentUser.id, ipAddress: ipOf(req), status: "SUCCESS", message: "Zapisano ustawienia backupu." });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.get("/locations", async (_req, res) => {
  try {
    await ensureDefaultBackupData();
    const result = await db.query("SELECT * FROM backup_locations ORDER BY is_default DESC, created_at DESC");
    res.json(result.rows.map(normalizeBackupRow));
  } catch (error) {
    res.status(500).json({ error: "Nie udało się pobrać lokalizacji." });
  }
});

router.post("/locations", async (req, res) => {
  const { name, type = "LOCAL_FOLDER", path: locationPath, isDefault = false } = req.body;
  if (!name?.trim() || !locationPath?.trim()) return res.status(400).json({ error: "Nazwa i ścieżka są wymagane." });
  try {
    const id = cryptoRandomId();
    if (isDefault) await db.query("UPDATE backup_locations SET is_default=FALSE");
    const result = await db.query(
      `INSERT INTO backup_locations (id, name, type, path, is_default, status)
       VALUES ($1,$2,$3,$4,$5,'OFFLINE')
       RETURNING *`,
      [id, name.trim(), type, locationPath.trim(), Boolean(isDefault)]
    );
    const tested = await testBackupLocation(result.rows[0], req.currentUser);
    res.status(201).json(normalizeBackupRow(tested));
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.post("/locations/pick-folder", async (_req, res) => {
  try {
    if (process.platform !== "win32") return res.status(400).json({ error: "Wybór folderu jest dostępny tylko na Windows." });
    const selectedPath = await pickWindowsFolder();
    if (!selectedPath) return res.json({ path: "", cancelled: true });
    res.json({ path: selectedPath });
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.put("/locations/:id", async (req, res) => {
  const { name, type = "LOCAL_FOLDER", path: locationPath, isDefault = false } = req.body;
  try {
    if (isDefault) await db.query("UPDATE backup_locations SET is_default=FALSE WHERE id<>$1", [req.params.id]);
    const result = await db.query(
      `UPDATE backup_locations SET name=$1, type=$2, path=$3, is_default=$4, updated_at=CURRENT_TIMESTAMP
       WHERE id=$5 RETURNING *`,
      [name, type, locationPath, Boolean(isDefault), req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Lokalizacja nie istnieje." });
    res.json(normalizeBackupRow(result.rows[0]));
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.delete("/locations/:id", async (req, res) => {
  try {
    const current = await getDefaultLocation();
    if (current?.id === req.params.id) return res.status(400).json({ error: "Nie można usunąć domyślnej lokalizacji." });
    await db.query("DELETE FROM backup_locations WHERE id=$1", [req.params.id]);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.post("/locations/:id/test", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM backup_locations WHERE id=$1", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Lokalizacja nie istnieje." });
    const tested = await testBackupLocation(result.rows[0], req.currentUser);
    res.json(normalizeBackupRow(tested));
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.post("/import", upload.single("backup"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Plik backupu jest wymagany." });
  const extension = req.file.originalname?.toLowerCase() || "";
  if (!extension.endsWith(".backup") && !extension.endsWith(".zip") && !extension.endsWith(".tar.gz")) {
    await fs.rm(req.file.path, { force: true });
    return res.status(400).json({ error: "Obsługiwane formaty: .backup, .zip, .tar.gz." });
  }
  try {
    const job = await importBackupFile(req.file, {
      user: req.currentUser,
      ipAddress: ipOf(req),
      runIntegrity: req.body.integrity !== "false",
      runTest: req.body.testRestore === "true"
    });
    res.status(201).json(job);
  } catch (error) {
    await fs.rm(req.file.path, { force: true }).catch(() => null);
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.post("/:id/integrity", async (req, res) => {
  try {
    const job = await findJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Backup nie istnieje." });
    res.json(await runIntegrityCheck(job, req.currentUser, ipOf(req)));
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.post("/:id/test-restore", async (req, res) => {
  try {
    const job = await findJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Backup nie istnieje." });
    res.json(await runTestRestore(job, req.currentUser, ipOf(req)));
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.get("/:id/download", async (req, res) => {
  try {
    const job = await findJob(req.params.id);
    if (!job?.file_path) return res.status(404).json({ error: "Plik backupu nie istnieje." });
    await auditBackup({ action: "DOWNLOAD", backupJobId: job.id, userId: req.currentUser.id, ipAddress: ipOf(req), status: "SUCCESS", message: "Pobrano backup." });
    res.download(job.file_path, job.file_name || `backup-${job.id}.zip`);
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.post("/:id/restore", async (req, res) => {
  const { confirmation, password } = req.body;
  if (confirmation !== "PRZYWRÓĆ BACKUP") return res.status(400).json({ error: "Nieprawidłowa fraza potwierdzająca." });
  if (!(await verifyAdminPassword(req.currentUser.id, password))) return res.status(403).json({ error: "Nieprawidłowe hasło administratora." });
  try {
    const job = await findJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Backup nie istnieje." });
    res.json(await restoreBackup(job, { user: req.currentUser, ipAddress: ipOf(req), forced: false }));
  } catch (error) {
    await auditBackup({ action: "RESTORE", backupJobId: req.params.id, userId: req.currentUser.id, ipAddress: ipOf(req), status: "FAILED", message: error.message });
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.post("/:id/force-restore", async (req, res) => {
  const { confirmation, password, riskAccepted } = req.body;
  if (confirmation !== "WYMUSZ PRZYWRÓCENIE") return res.status(400).json({ error: "Nieprawidłowa fraza potwierdzająca." });
  if (!riskAccepted) return res.status(400).json({ error: "Musisz potwierdzić ryzyko wymuszonego przywracania." });
  if (!(await verifyAdminPassword(req.currentUser.id, password))) return res.status(403).json({ error: "Nieprawidłowe hasło administratora." });
  try {
    const job = await findJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Backup nie istnieje." });
    res.json(await restoreBackup(job, { user: req.currentUser, ipAddress: ipOf(req), forced: true }));
  } catch (error) {
    await auditBackup({ action: "FORCE_RESTORE", backupJobId: req.params.id, userId: req.currentUser.id, ipAddress: ipOf(req), status: "FAILED", message: error.message });
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const job = await findJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Backup nie istnieje." });
    await deleteBackup(job, req.currentUser, ipOf(req));
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

async function sendAuditLog(_req, res) {
  try {
    const result = await db.query(`
      SELECT ba.*, bj.file_name, bj.type AS backup_type, u.first_name, u.last_name, u.email, u.username
      FROM backup_audit ba
      LEFT JOIN backup_jobs bj ON bj.id=ba.backup_job_id
      LEFT JOIN users u ON u.id=ba.user_id
      ORDER BY ba.created_at DESC
      LIMIT 250
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Nie udało się pobrać Audit Log." });
  }
}

router.get("/audit", sendAuditLog);
router.get("/audit/log", sendAuditLog);

function cryptoRandomId() {
  return crypto.randomUUID();
}

export default router;
