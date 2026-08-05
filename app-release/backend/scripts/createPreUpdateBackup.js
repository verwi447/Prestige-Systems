import dotenv from "dotenv";

dotenv.config();

const timeoutMs = Math.max(60_000, Number(process.env.PRE_UPDATE_BACKUP_TIMEOUT_MS || 15 * 60_000));
const pollIntervalMs = 1_000;

const { db } = await import("../src/db.js");
const { createBackupJob, runIntegrityCheck, runTestRestore } = await import("../src/utils/backupService.js");

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForBackup(jobId) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await db.query("SELECT * FROM backup_jobs WHERE id=$1", [jobId]);
    const job = result.rows[0];
    if (!job) throw new Error("Nie znaleziono zadania backupu przed aktualizacja.");
    if (job.status === "COMPLETED") return job;
    if (job.status === "FAILED") throw new Error(job.error_message || "Backup przed aktualizacja nie powiodl sie.");
    await sleep(pollIntervalMs);
  }

  throw new Error("Przekroczono czas oczekiwania na backup przed aktualizacja.");
}

try {
  const user = { username: "system-update", email: "system-update@localhost" };
  const created = await createBackupJob({ type: "SAFETY", user, ipAddress: "127.0.0.1" });
  const backup = await waitForBackup(created.id);
  const integrity = await runIntegrityCheck(backup, user, "127.0.0.1");
  const refreshed = (await db.query("SELECT * FROM backup_jobs WHERE id=$1", [backup.id])).rows[0];
  const restore = await runTestRestore(refreshed, user, "127.0.0.1");

  console.log(JSON.stringify({
    ok: true,
    id: backup.id,
    fileName: backup.file_name,
    integrity: integrity.status,
    testRestore: restore.status,
    restoreMode: restore.mode || null
  }));
} catch (error) {
  console.error(error.message || "Nie udalo sie przygotowac backupu przed aktualizacja.");
  process.exitCode = 1;
} finally {
  await db.end();
}
