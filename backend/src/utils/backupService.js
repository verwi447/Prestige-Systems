import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import archiver from "archiver";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import { notifyAdmins } from "./notifications.js";
import { createBackupFileName, getAppInfo } from "../appInfo.js";
import { writeAuditLog } from "./auditLog.js";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "../..");
const defaultBackupRoot = path.resolve(backendRoot, "system-backups");
const tempRoot = path.resolve(backendRoot, ".backup-temp");
const uploadsRoot = path.resolve(backendRoot, "uploads");

const uuid = () => crypto.randomUUID();
const nowStamp = () => new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

export function normalizeBackupRow(row) {
  if (!row) return null;
  return {
    ...row,
    size_bytes: row.size_bytes == null ? null : Number(row.size_bytes),
    free_space_bytes: row.free_space_bytes == null ? null : Number(row.free_space_bytes)
  };
}

export async function auditBackup({ action, backupJobId = null, userId = null, ipAddress = null, status = "SUCCESS", message = "" }) {
  await db.query(
    `INSERT INTO backup_audit (id, action, backup_job_id, user_id, ip_address, status, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uuid(), action, backupJobId, userId, ipAddress, status, message]
  );
  await writeAuditLog({
    category: "BACKUP",
    action: `BACKUP_${action}`,
    status,
    userId,
    entityType: "backup",
    entityId: backupJobId,
    ipAddress,
    message,
    metadata: { source: "backup_service" }
  }).catch((error) => console.error("Global audit log failed:", error));
}

export async function ensureDefaultBackupData() {
  await ensureDir(defaultBackupRoot);
  const settings = await db.query("SELECT 1 FROM backup_settings WHERE id='default'");
  if (!settings.rows[0]) {
    await db.query("INSERT INTO backup_settings (id) VALUES ('default')");
  }

  const locations = await db.query("SELECT 1 FROM backup_locations LIMIT 1");
  if (!locations.rows[0]) {
    const id = uuid();
    await db.query(
      `INSERT INTO backup_locations (id, name, type, path, is_default, status, free_space_bytes, last_test_at)
       VALUES ($1,'Prestige Local','LOCAL_FOLDER',$2,TRUE,'ONLINE',$3,CURRENT_TIMESTAMP)`,
      [id, defaultBackupRoot, await getFreeSpaceBytes(defaultBackupRoot)]
    );
  }
}

async function getSettings() {
  await ensureDefaultBackupData();
  const result = await db.query("SELECT * FROM backup_settings WHERE id='default'");
  return result.rows[0];
}

export async function getDefaultLocation() {
  await ensureDefaultBackupData();
  const result = await db.query("SELECT * FROM backup_locations WHERE is_default=TRUE ORDER BY created_at DESC LIMIT 1");
  if (result.rows[0]) return result.rows[0];
  const fallback = await db.query("SELECT * FROM backup_locations ORDER BY created_at DESC LIMIT 1");
  return fallback.rows[0];
}

export async function getFreeSpaceBytes(dir) {
  try {
    if (process.platform === "win32") {
      const root = path.parse(path.resolve(dir)).root.replace(/\\$/, "");
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `(Get-PSDrive -Name '${root.replace(":", "")}').Free`
      ]);
      return Number(String(stdout).trim()) || null;
    }
    const { stdout } = await execFileAsync("df", ["-k", dir]);
    const lines = stdout.trim().split(/\r?\n/);
    const parts = lines[1]?.trim().split(/\s+/);
    return parts?.[3] ? Number(parts[3]) * 1024 : null;
  } catch {
    return null;
  }
}

export async function testBackupLocation(location, user) {
  const target = path.resolve(location.path);
  if (target.includes(`${path.sep}public${path.sep}`) || target.startsWith(path.resolve(uploadsRoot))) {
    throw new Error("Nie zapisuj backupów w katalogu publicznym ani uploads.");
  }
  await ensureDir(target);
  const testFile = path.join(target, `.prestige-backup-test-${Date.now()}.tmp`);
  await fsp.writeFile(testFile, "prestige-backup-test");
  const content = await fsp.readFile(testFile, "utf8");
  await fsp.unlink(testFile);
  if (content !== "prestige-backup-test") throw new Error("Test odczytu lokalizacji nie powiódł się.");
  const freeSpace = await getFreeSpaceBytes(target);
  await db.query(
    "UPDATE backup_locations SET status='ONLINE', free_space_bytes=$1, last_test_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$2",
    [freeSpace, location.id]
  );
  await auditBackup({ action: "LOCATION_TEST", userId: user?.id, status: "SUCCESS", message: `Lokalizacja ${location.name} działa poprawnie.` });
  return { ...location, path: target, status: "ONLINE", free_space_bytes: freeSpace, last_test_at: new Date().toISOString() };
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function archiveDirectory(sourceDir, outputFile) {
  await ensureDir(path.dirname(outputFile));
  if (!(await exists(sourceDir))) await ensureDir(sourceDir);
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputFile);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", (warning) => {
      if (warning.code === "ENOENT") return;
      reject(warning);
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
  await assertNonEmptyFile(outputFile, `Archiwum ${path.basename(outputFile)} jest puste.`);
}

async function extractArchive(archiveFile, outputDir) {
  await ensureDir(outputDir);
  await execFileAsync("tar", ["-xf", archiveFile, "-C", outputDir]);
}

async function createDatabaseDump(outputFile) {
  await ensureDir(path.dirname(outputFile));
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    try {
      await execFileAsync("pg_dump", ["--format=custom", "--file", outputFile, databaseUrl], { timeout: 1000 * 60 * 10 });
      await assertNonEmptyFile(outputFile, "Dump bazy danych jest pusty.");
      return { mode: "pg_dump" };
    } catch {
      // Fallback below keeps backup usable on development machines without pg_dump in PATH.
    }
  }

  const tables = await db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
    ORDER BY table_name
  `);
  const dump = {
    mode: "json_export",
    createdAt: new Date().toISOString(),
    tables: {}
  };
  for (const table of tables.rows) {
    const name = table.table_name;
    const rows = await db.query(`SELECT * FROM ${JSON.stringify(name)}`);
    dump.tables[name] = rows.rows;
  }
  await fsp.writeFile(outputFile, JSON.stringify(dump, null, 2));
  await assertNonEmptyFile(outputFile, "Eksport JSON bazy danych jest pusty.");
  return { mode: "json_export" };
}

async function restoreJsonDatabaseDump(databasePath) {
  const parsed = JSON.parse(await fsp.readFile(databasePath, "utf8"));
  const tableEntries = Object.entries(parsed.tables || {});
  if (!tableEntries.length) throw new Error("Backup JSON nie zawiera tabel.");

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`TRUNCATE ${tableEntries.map(([table]) => quoteIdentifier(table)).join(", ")} RESTART IDENTITY CASCADE`);
    await client.query("SET session_replication_role = replica");

    for (const [table, rows] of tableEntries) {
      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.length) continue;
        const values = columns.map((column) => row[column]);
        const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
        await client.query(
          `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${placeholders})`,
          values
        );
      }
    }

    for (const [table, rows] of tableEntries) {
      if (!rows.some((row) => Object.prototype.hasOwnProperty.call(row, "id"))) continue;
      const sequence = await client.query("SELECT pg_get_serial_sequence($1, 'id') AS name", [`public.${table}`]);
      const sequenceName = sequence.rows[0]?.name;
      if (!sequenceName) continue;
      await client.query(
        `SELECT setval($1::regclass, GREATEST(COALESCE(MAX(${quoteIdentifier("id")}), 0), 1), COALESCE(MAX(${quoteIdentifier("id")}), 0) > 0) FROM ${quoteIdentifier(table)}`,
        [sequenceName]
      );
    }

    await client.query("SET session_replication_role = origin");
    await client.query("COMMIT");
    return { mode: "json_export" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    await client.query("SET session_replication_role = origin").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

async function testJsonDatabaseDump(databasePath) {
  const parsed = JSON.parse(await fsp.readFile(databasePath, "utf8"));
  const tableEntries = Object.entries(parsed.tables || {});
  const requiredTables = ["users", "companies", "products", "offers"];
  if (!tableEntries.length) throw new Error("Backup JSON nie zawiera tabel.");
  for (const table of requiredTables) {
    if (!parsed.tables?.[table]) throw new Error(`Brak tabeli w dumpie testowym: ${table}`);
  }

  const client = await db.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;

    const schema = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema='public'
    `);
    const columnsByTable = new Map();
    for (const row of schema.rows) {
      if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, new Set());
      columnsByTable.get(row.table_name).add(row.column_name);
    }

    const temporaryTables = [];
    let rowCount = 0;
    for (const [index, [table, rows]] of tableEntries.entries()) {
      const validColumns = columnsByTable.get(table);
      if (!validColumns) throw new Error(`Tabela z backupu nie istnieje w biezacej bazie: ${table}`);
      if (!Array.isArray(rows)) throw new Error(`Nieprawidlowe dane tabeli w backupie: ${table}`);

      const tempTable = `restore_test_${index}`;
      await client.query(
        `CREATE TEMP TABLE ${quoteIdentifier(tempTable)} (LIKE public.${quoteIdentifier(table)} INCLUDING DEFAULTS) ON COMMIT DROP`
      );

      for (const row of rows) {
        const columns = Object.keys(row);
        if (columns.some((column) => !validColumns.has(column))) {
          throw new Error(`Backup zawiera nieznana kolumne w tabeli ${table}`);
        }
        if (!columns.length) continue;
        const values = columns.map((column) => row[column]);
        const placeholders = values.map((_, valueIndex) => `$${valueIndex + 1}`).join(", ");
        await client.query(
          `INSERT INTO ${quoteIdentifier(tempTable)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${placeholders})`,
          values
        );
      }

      temporaryTables.push({ name: tempTable, expectedRows: rows.length });
      rowCount += rows.length;
    }

    for (const temporaryTable of temporaryTables) {
      const count = await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(temporaryTable.name)}`);
      if (count.rows[0].count !== temporaryTable.expectedRows) {
        throw new Error(`Nieprawidlowa liczba rekordow po tescie odtworzenia: ${temporaryTable.name}`);
      }
    }

    await client.query("ROLLBACK");
    transactionOpen = false;
    return { mode: "json_temp_restore", tableCount: tableEntries.length, rowCount };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

async function testPostgresDump(databasePath) {
  await execFileAsync("pg_restore", ["--list", databasePath], {
    timeout: 1000 * 60 * 10,
    maxBuffer: 20 * 1024 * 1024
  });
  return { mode: "pg_restore_list" };
}

async function restoreDatabaseDump(databasePath) {
  const content = await fsp.readFile(databasePath, "utf8").catch(() => "");
  if (content.trim().startsWith("{")) {
    return restoreJsonDatabaseDump(databasePath);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Brak DATABASE_URL do przywrócenia backupu.");

  await execFileAsync(
    "pg_restore",
    ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", databaseUrl, databasePath],
    { timeout: 1000 * 60 * 10 }
  );
  return { mode: "pg_restore" };
}

async function writeConfig(outputFile, settings) {
  await ensureDir(path.dirname(outputFile));
  const appInfo = getAppInfo();
  const maskedEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL/i.test(key)) maskedEnv[key] = value ? "***MASKED***" : "";
  }
  await fsp.writeFile(
    outputFile,
    JSON.stringify(
      {
        app: appInfo.name,
        version: appInfo.version,
        nodeEnv: process.env.NODE_ENV || "development",
        settings: {
          includeDatabase: settings.include_database,
          includeUploads: settings.include_uploads,
          includePdf: settings.include_pdf,
          includeConfig: settings.include_config
        },
        maskedEnv
      },
      null,
      2
    )
  );
  await assertNonEmptyFile(outputFile, "Plik konfiguracji backupu jest pusty.");
}

async function assertNonEmptyFile(filePath, message) {
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat?.size) throw new Error(message);
}

async function createMetadata({ jobId, type, user, settings, files, sizeBytes = 0, status = "COMPLETED", dumpMode }) {
  const appInfo = getAppInfo();
  return {
    id: jobId,
    createdAt: new Date().toISOString(),
    type,
    createdBy: user?.email || user?.username || "system",
    database: "postgresql",
    databaseDumpMode: dumpMode,
    appVersion: appInfo.version,
    sizeBytes,
    status,
    databaseHash: files.databaseHash || null,
    uploadsHash: files.uploadsHash || null,
    pdfHash: files.pdfHash || null,
    configHash: files.configHash || null,
    backupHash: files.backupHash || null,
    includes: {
      database: settings.include_database,
      uploads: settings.include_uploads,
      pdf: settings.include_pdf,
      config: settings.include_config
    }
  };
}

export async function createBackupJob({ type = "MANUAL", user = null, ipAddress = null } = {}) {
  await ensureDefaultBackupData();
  const settings = await getSettings();
  const location = await getDefaultLocation();
  if (!location) throw new Error("Brak lokalizacji backupu.");

  const jobId = uuid();
  await db.query(
    `INSERT INTO backup_jobs (id, type, status, integrity_status, test_restore_status, location_id, created_by_id)
     VALUES ($1,$2,'RUNNING','NOT_CHECKED','NOT_TESTED',$3,$4)`,
    [jobId, type, location.id, user?.id || null]
  );

  runBackup(jobId, { type, user, ipAddress, settings, location }).catch((error) => {
    console.error("Backup job failed:", error);
  });

  const created = await db.query("SELECT * FROM backup_jobs WHERE id=$1", [jobId]);
  return normalizeBackupRow(created.rows[0]);
}

async function runBackup(jobId, { type, user, ipAddress, settings, location }) {
  const stamp = nowStamp();
  const locationPath = path.resolve(location.path);
  const backupFileName = createBackupFileName(stamp);
  const workDir = path.join(locationPath, path.basename(backupFileName, ".zip"));
  const stagingDir = path.join(workDir, "staging");
  const databaseDir = path.join(stagingDir, "database");
  const filesDir = path.join(stagingDir, "files");
  const configDir = path.join(stagingDir, "config");
  const backupZip = path.join(workDir, backupFileName);
  const files = {};

  try {
    await ensureDir(databaseDir);
    await ensureDir(filesDir);
    await ensureDir(configDir);

    let dumpMode = "skipped";
    if (settings.include_database) {
      const databaseFile = path.join(databaseDir, "database.dump");
      const dump = await createDatabaseDump(databaseFile);
      dumpMode = dump.mode;
      files.databaseHash = await sha256(databaseFile);
    }

    if (settings.include_uploads) {
      const uploadsZip = path.join(filesDir, "uploads.zip");
      await archiveDirectory(uploadsRoot, uploadsZip);
      files.uploadsHash = await sha256(uploadsZip);
    }

    if (settings.include_pdf) {
      const pdfSource = path.join(backendRoot, "pdf");
      const pdfZip = path.join(filesDir, "pdf.zip");
      await archiveDirectory(pdfSource, pdfZip);
      files.pdfHash = await sha256(pdfZip);
    }

    if (settings.include_config) {
      const configFile = path.join(configDir, "config.json");
      await writeConfig(configFile, settings);
      files.configHash = await sha256(configFile);
    }

    let metadata = await createMetadata({ jobId, type, user, settings, files, dumpMode });
    await fsp.writeFile(path.join(stagingDir, "metadata.json"), JSON.stringify(metadata, null, 2));
    await archiveDirectory(stagingDir, backupZip);
    const stat = await fsp.stat(backupZip);
    files.backupHash = await sha256(backupZip);
    metadata = await createMetadata({ jobId, type, user, settings, files, sizeBytes: stat.size, dumpMode });

    await db.query(
      `UPDATE backup_jobs
       SET status='COMPLETED', integrity_status='VERIFIED', file_path=$1, file_name=$2, size_bytes=$3, metadata=$4, completed_at=CURRENT_TIMESTAMP
       WHERE id=$5`,
      [backupZip, backupFileName, stat.size, metadata, jobId]
    );
    await fsp.rm(stagingDir, { recursive: true, force: true });
    await auditBackup({ action: "CREATE", backupJobId: jobId, userId: user?.id, ipAddress, status: "SUCCESS", message: "Backup został utworzony." });
    await notifyAdmins({
      category: "BACKUP",
      type: "BACKUP_COMPLETED",
      priority: "SUCCESS",
      title: "Backup zakończony",
      message: `Backup ${backupFileName} został utworzony poprawnie.`,
      entityType: "backup",
      entityId: jobId,
      link: "/settings/backups"
    });
    await enforceRetention(settings.retention_count);
  } catch (error) {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => null);
    await db.query(
      `UPDATE backup_jobs
       SET status='FAILED', integrity_status='FAILED', error_message=$1, completed_at=CURRENT_TIMESTAMP
       WHERE id=$2`,
      [error.message, jobId]
    );
    await auditBackup({ action: "CREATE", backupJobId: jobId, userId: user?.id, ipAddress, status: "FAILED", message: error.message });
    await notifyAdmins({
      category: "BACKUP",
      type: "BACKUP_FAILED",
      priority: "CRITICAL",
      title: "Backup nie powiódł się",
      message: error.message,
      entityType: "backup",
      entityId: jobId,
      link: "/settings/backups"
    });
  }
}

export async function enforceRetention(retentionCount = 10) {
  const count = Math.max(1, Number(retentionCount) || 10);
  const oldJobs = await db.query(
    `SELECT id, file_path
     FROM backup_jobs
     WHERE type IN ('MANUAL','SCHEDULED','IMPORTED') AND status='COMPLETED'
     ORDER BY created_at DESC
     OFFSET $1`,
    [count]
  );
  for (const job of oldJobs.rows) {
    await removeBackupFile(job.file_path);
    // Delete after audit so backup_audit can still reference an existing job row.
    await auditBackup({ action: "DELETE", backupJobId: job.id, status: "SUCCESS", message: "Usunięto przez retencję." });
    await db.query("DELETE FROM backup_jobs WHERE id=$1", [job.id]);
  }
}

async function removeBackupFile(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  if (resolved.includes(`${path.sep}uploads${path.sep}`)) throw new Error("Nie można usuwać plików z katalogu uploads.");
  await fsp.rm(path.dirname(resolved), { recursive: true, force: true });
}

export async function deleteBackup(job, user, ipAddress) {
  await removeBackupFile(job.file_path);
  // Delete after audit so backup_audit can still reference an existing job row.
  await auditBackup({ action: "DELETE", backupJobId: job.id, userId: user?.id, ipAddress, status: "SUCCESS", message: "Backup został usunięty." });
  await db.query("DELETE FROM backup_jobs WHERE id=$1", [job.id]);
}

export async function runIntegrityCheck(job, user, ipAddress) {
  if (!job?.file_path || !(await exists(job.file_path))) throw new Error("Plik backupu nie istnieje.");
  const metadata = job.metadata || {};
  const tempDir = path.join(tempRoot, `integrity-${job.id}-${Date.now()}`);
  try {
    await extractArchive(job.file_path, tempDir);
    const checks = [
      ["databaseHash", path.join(tempDir, "database", "database.dump")],
      ["uploadsHash", path.join(tempDir, "files", "uploads.zip")],
      ["pdfHash", path.join(tempDir, "files", "pdf.zip")],
      ["configHash", path.join(tempDir, "config", "config.json")]
    ];
    for (const [key, file] of checks) {
      if (metadata[key] && (!(await exists(file)) || (await sha256(file)) !== metadata[key])) {
        throw new Error(`Nieprawidłowy hash: ${key}`);
      }
    }
    if (metadata.backupHash && (await sha256(job.file_path)) !== metadata.backupHash) {
      throw new Error("Nieprawidłowy hash archiwum backupu.");
    }
    await db.query("UPDATE backup_jobs SET integrity_status='VERIFIED', error_message=NULL WHERE id=$1", [job.id]);
    await auditBackup({ action: "INTEGRITY_CHECK", backupJobId: job.id, userId: user?.id, ipAddress, status: "SUCCESS", message: "Integrity Check zakończony poprawnie." });
    return { status: "VERIFIED" };
  } catch (error) {
    await db.query("UPDATE backup_jobs SET integrity_status='FAILED', error_message=$1 WHERE id=$2", [error.message, job.id]);
    await auditBackup({ action: "INTEGRITY_CHECK", backupJobId: job.id, userId: user?.id, ipAddress, status: "FAILED", message: error.message });
    await notifyAdmins({
      category: "BACKUP",
      type: "BACKUP_INTEGRITY_FAILED",
      priority: "CRITICAL",
      title: "Błąd integralności backupu",
      message: error.message,
      entityType: "backup",
      entityId: job.id,
      link: "/settings/backups"
    });
    throw error;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

export async function runTestRestore(job, user, ipAddress) {
  if (!job?.file_path || !(await exists(job.file_path))) throw new Error("Plik backupu nie istnieje.");
  const tempDir = path.join(tempRoot, `test-restore-${job.id}-${Date.now()}`);
  try {
    await db.query("UPDATE backup_jobs SET test_restore_status='TESTING' WHERE id=$1", [job.id]);
    await extractArchive(job.file_path, tempDir);
    const metadataPath = path.join(tempDir, "metadata.json");
    const databasePath = path.join(tempDir, "database", "database.dump");
    if (!(await exists(metadataPath))) throw new Error("Brak metadata.json.");
    if (!(await exists(databasePath))) throw new Error("Brak database.dump.");

    const content = await fsp.readFile(databasePath, "utf8").catch(() => "");
    const testResult = content.trim().startsWith("{")
      ? await testJsonDatabaseDump(databasePath)
      : await testPostgresDump(databasePath);

    await db.query("UPDATE backup_jobs SET test_restore_status='VERIFIED', error_message=NULL WHERE id=$1", [job.id]);
    await auditBackup({ action: "TEST_RESTORE", backupJobId: job.id, userId: user?.id, ipAddress, status: "SUCCESS", message: `Test Restore zakonczony poprawnie. Tryb: ${testResult.mode}.` });
    return { status: "VERIFIED", ...testResult };
  } catch (error) {
    await db.query("UPDATE backup_jobs SET test_restore_status='FAILED', error_message=$1 WHERE id=$2", [error.message, job.id]);
    await auditBackup({ action: "TEST_RESTORE", backupJobId: job.id, userId: user?.id, ipAddress, status: "FAILED", message: error.message });
    await notifyAdmins({
      category: "BACKUP",
      type: "BACKUP_TEST_RESTORE_FAILED",
      priority: "CRITICAL",
      title: "Test Restore nie powiódł się",
      message: error.message,
      entityType: "backup",
      entityId: job.id,
      link: "/settings/backups"
    });
    throw error;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

export async function importBackupFile(file, { user, ipAddress, runIntegrity = true, runTest = false }) {
  await ensureDefaultBackupData();
  const location = await getDefaultLocation();
  const jobId = uuid();
  const workDir = path.join(path.resolve(location.path), `import-${nowStamp()}-${jobId.slice(0, 8)}`);
  await ensureDir(workDir);
  const fileName = file.originalname || "imported.backup";
  const target = path.join(workDir, fileName.endsWith(".zip") ? fileName : "backup.zip");
  await fsp.rename(file.path, target);
  const stat = await fsp.stat(target);
  const metadata = { importedFileName: fileName, backupHash: await sha256(target), sizeBytes: stat.size };
  await db.query(
    `INSERT INTO backup_jobs (id, type, status, integrity_status, test_restore_status, file_path, file_name, size_bytes, location_id, created_by_id, metadata, completed_at)
     VALUES ($1,'IMPORTED','COMPLETED','NOT_CHECKED','NOT_TESTED',$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)`,
    [jobId, target, path.basename(target), stat.size, location.id, user?.id || null, metadata]
  );
  await auditBackup({ action: "IMPORT", backupJobId: jobId, userId: user?.id, ipAddress, status: "SUCCESS", message: "Backup został zaimportowany." });
  const job = (await db.query("SELECT * FROM backup_jobs WHERE id=$1", [jobId])).rows[0];
  if (runIntegrity) await runIntegrityCheck(job, user, ipAddress).catch(() => null);
  if (runTest) {
    const refreshed = (await db.query("SELECT * FROM backup_jobs WHERE id=$1", [jobId])).rows[0];
    await runTestRestore(refreshed, user, ipAddress).catch(() => null);
  }
  return normalizeBackupRow((await db.query("SELECT * FROM backup_jobs WHERE id=$1", [jobId])).rows[0]);
}

export async function verifyAdminPassword(userId, password) {
  const bcrypt = await import("bcryptjs");
  const result = await db.query("SELECT password_hash, password FROM users WHERE id=$1 AND role='ADMIN'", [userId]);
  const user = result.rows[0];
  if (!user) return false;
  return bcrypt.default.compare(password || "", user.password_hash || user.password || "");
}

export async function restoreBackup(job, { user, ipAddress, forced = false }) {
  if (!forced && job.integrity_status !== "VERIFIED") throw new Error("Zwykłe przywracanie wymaga zweryfikowanego backupu.");
  if (!job?.file_path || !(await exists(job.file_path))) throw new Error("Plik backupu nie istnieje.");

  const tempDir = path.join(tempRoot, `restore-${job.id}-${Date.now()}`);
  await createBackupJob({ type: forced ? "FORCED_RESTORE" : "SAFETY", user, ipAddress });

  try {
    await extractArchive(job.file_path, tempDir);
    const databasePath = path.join(tempDir, "database", "database.dump");
    if (!(await exists(databasePath))) throw new Error("Backup nie zawiera database.dump.");

    const restored = await restoreDatabaseDump(databasePath);

    await auditBackup({
      action: forced ? "FORCE_RESTORE" : "RESTORE",
      backupJobId: null,
      userId: null,
      ipAddress,
      status: "SUCCESS",
      message: `Backup został przywrócony. Tryb: ${restored.mode}.`
    });

    return { ok: true, mode: restored.mode, message: "Backup został przywrócony do bazy danych." };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

let schedulerStarted = false;
let schedulerRunning = false;

export function startBackupScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const settings = await getSettings();
      if (!settings.enabled) return;
      const [hour, minute] = String(settings.time_of_day || "02:30").split(":");
      const now = new Date();
      if (now.getHours() !== Number(hour) || now.getMinutes() !== Number(minute)) return;

      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const latest = await db.query("SELECT created_at FROM backup_jobs WHERE type='SCHEDULED' ORDER BY created_at DESC LIMIT 1");
      const lastDate = latest.rows[0]?.created_at ? new Date(latest.rows[0].created_at) : null;
      const days = lastDate ? Math.floor((todayStart - new Date(lastDate.setHours(0, 0, 0, 0))) / 86400000) : Infinity;
      const shouldRun =
        settings.frequency === "DAILY" ||
        (settings.frequency === "EVERY_7_DAYS" && days >= 7) ||
        (settings.frequency === "MONTHLY" && (!lastDate || lastDate.getMonth() !== now.getMonth() || lastDate.getFullYear() !== now.getFullYear()));
      if (shouldRun) await createBackupJob({ type: "SCHEDULED", user: { username: "system", email: "system" } });
    } catch (error) {
      console.error("Backup scheduler error:", error);
    } finally {
      schedulerRunning = false;
    }
  }, 60 * 1000);
}
