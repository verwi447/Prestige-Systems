import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";
import { getAppInfo } from "../appInfo.js";
import { getMigrationStatus } from "../migrate.js";
import { ensureDefaultBackupData, getDefaultLocation, getFreeSpaceBytes } from "../utils/backupService.js";
import { getNetworkSettings, updateNetworkSettings } from "../utils/networkSettings.js";
import { writeAuditLog } from "../utils/auditLog.js";

import { autoAsyncRoutes } from "../utils/autoAsyncRoutes.js";

const router = express.Router();
autoAsyncRoutes(router);

router.use(auth, loadCurrentUser, requireRole("ADMIN"));

router.get("/network", async (_req, res) => {
  try {
    return res.json(await getNetworkSettings());
  } catch (error) {
    console.error("Failed to load network settings:", error);
    return res.status(500).json({ error: "Nie udalo sie pobrac konfiguracji sieci." });
  }
});

router.put("/network", async (req, res) => {
  try {
    const settings = await updateNetworkSettings(req.body);
    await writeAuditLog({
      category: "SYSTEM",
      action: "NETWORK_SETTINGS_UPDATED",
      userId: req.currentUser.id,
      entityType: "network_settings",
      entityId: "server",
      ipAddress: req.ip,
      message: "Zmieniono konfiguracje sieci aplikacji.",
      metadata: {
        accessMode: settings.configured.accessMode,
        host: settings.configured.host,
        port: settings.configured.port,
        publicBaseUrl: settings.configured.publicBaseUrl,
        allowedOrigins: settings.configured.allowedOrigins
      }
    }).catch((error) => console.error("Global audit log failed:", error));
    return res.json({ ...settings, restartRequired: true, message: "Konfiguracja sieci zostala zapisana. Uruchom ponownie usluge, aby zastosowac zmiany." });
  } catch (error) {
    const message = error?.message || "Nie udalo sie zapisac konfiguracji sieci.";
    return res.status(/wymagany|poprawnym|niedozwolone|maksymalnie|liczba|Wybierz/.test(message) ? 400 : 500).json({ error: message });
  }
});

router.get("/status", async (_req, res) => {
  const appInfo = getAppInfo();
  const generatedAt = new Date().toISOString();
  const databaseStartedAt = Date.now();

  try {
    await db.query("SELECT 1");
    const databaseResponseMs = Date.now() - databaseStartedAt;

    await ensureDefaultBackupData();
    const [settingsResult, latestBackupResult, emailResult, location, migration] = await Promise.all([
      db.query("SELECT enabled, frequency, time_of_day, retention_count FROM backup_settings WHERE id='default'"),
      db.query(
        `SELECT file_name, status, integrity_status, test_restore_status, completed_at, size_bytes, metadata
         FROM backup_jobs
         ORDER BY created_at DESC
         LIMIT 1`
      ),
      db.query(
        `SELECT smtp_host, from_email, is_active, last_test_status, last_test_at
         FROM email_settings
         ORDER BY updated_at DESC
         LIMIT 1`
      ),
      getDefaultLocation(),
      getMigrationStatus()
    ]);

    const latestBackup = latestBackupResult.rows[0] || null;
    const email = emailResult.rows[0] || null;
    const freeSpaceBytes = location?.path ? await getFreeSpaceBytes(location.path) : null;
    const metadata = latestBackup?.metadata || {};

    return res.json({
      generatedAt,
      application: {
        name: appInfo.name,
        version: appInfo.version,
        schemaVersion: appInfo.schemaVersion,
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime())
      },
      database: {
        status: "ONLINE",
        responseMs: databaseResponseMs
      },
      migration: {
        expectedVersion: migration.expectedVersion,
        appliedVersion: migration.appliedVersion,
        pendingCount: migration.pendingCount,
        isCurrent: migration.isCurrent,
        appliedAt: migration.migrations.at(-1)?.appliedAt || null
      },
      backup: {
        enabled: settingsResult.rows[0]?.enabled !== false,
        frequency: settingsResult.rows[0]?.frequency || "DAILY",
        timeOfDay: settingsResult.rows[0]?.time_of_day || null,
        retentionCount: Number(settingsResult.rows[0]?.retention_count || 0),
        locationName: location?.name || null,
        locationStatus: location?.status || "UNKNOWN",
        freeSpaceBytes,
        latest: latestBackup && {
          fileName: latestBackup.file_name,
          status: latestBackup.status,
          integrityStatus: latestBackup.integrity_status,
          testRestoreStatus: latestBackup.test_restore_status,
          completedAt: latestBackup.completed_at,
          sizeBytes: Number(latestBackup.size_bytes || 0),
          appVersion: metadata.appVersion || null
        }
      },
      email: {
        configured: Boolean(email?.smtp_host && email?.from_email),
        enabled: email?.is_active === true,
        lastTestStatus: email?.last_test_status || null,
        lastTestAt: email?.last_test_at || null
      }
    });
  } catch (error) {
    console.error("Failed to collect system status:", error);
    return res.status(500).json({ error: "Nie udało się pobrać stanu systemu." });
  }
});

export default router;
