import { db } from "./db.js";

const MIGRATION_LOCK_KEY = 91820411;
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const LOCK_RETRY_MS = 200;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeMigration(migration) {
  if (!migration?.id || !migration?.checksum || typeof migration.up !== "function") {
    throw new Error("Nieprawidlowa definicja migracji bazy danych.");
  }

  return migration;
}

export function getMigrationStatusFromRows(migrations, rows) {
  const normalizedMigrations = migrations.map(normalizeMigration);
  const appliedById = new Map(rows.map((row) => [row.id, row]));
  const knownMigrationIds = new Set(normalizedMigrations.map((migration) => migration.id));
  const migrationsWithState = normalizedMigrations.map((migration) => {
    const applied = appliedById.get(migration.id) || null;
    return {
      id: migration.id,
      description: migration.description,
      applied: Boolean(applied),
      appliedAt: applied?.applied_at || null,
      appVersion: applied?.app_version || null,
      checksumMatches: !applied || applied.checksum === migration.checksum
    };
  });
  const appliedMigrations = migrationsWithState.filter((migration) => migration.applied);
  const pendingMigrations = migrationsWithState.filter((migration) => !migration.applied);
  const checksumMismatches = migrationsWithState.filter((migration) => migration.applied && !migration.checksumMatches);

  return {
    expectedVersion: normalizedMigrations.at(-1)?.id || null,
    appliedVersion: appliedMigrations.at(-1)?.id || null,
    totalCount: normalizedMigrations.length,
    appliedCount: appliedMigrations.length,
    pendingCount: pendingMigrations.length,
    isCurrent: pendingMigrations.length === 0 && checksumMismatches.length === 0,
    pendingMigrations,
    checksumMismatches,
    unexpectedAppliedIds: rows.filter((row) => !knownMigrationIds.has(row.id)).map((row) => row.id),
    migrations: migrationsWithState
  };
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      description TEXT NOT NULL,
      app_version TEXT NOT NULL,
      execution_ms INTEGER NOT NULL DEFAULT 0,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at
    ON schema_migrations (applied_at DESC);
  `);
}

async function acquireMigrationLock(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [MIGRATION_LOCK_KEY]);
    if (result.rows[0]?.acquired) return true;
    await sleep(LOCK_RETRY_MS);
  } while (Date.now() < deadline);

  throw new Error("Inna instancja aplikacji wykonuje obecnie migracje bazy danych.");
}

async function loadAppliedMigrations(client) {
  const result = await client.query(`
    SELECT id, checksum, description, app_version, execution_ms, applied_at
    FROM schema_migrations
    ORDER BY applied_at ASC, id ASC
  `);
  return result.rows;
}

async function recordMigration(client, migration, appVersion, executionMs) {
  await client.query(
    `INSERT INTO schema_migrations (id, checksum, description, app_version, execution_ms)
     VALUES ($1,$2,$3,$4,$5)`,
    [migration.id, migration.checksum, migration.description, appVersion, executionMs]
  );
}

async function executeMigration(client, migration, appVersion) {
  const startedAt = Date.now();
  const context = { client, query: client.query.bind(client) };

  if (migration.transactional !== false) {
    await client.query("BEGIN");
    try {
      await migration.up(context);
      await recordMigration(client, migration, appVersion, Date.now() - startedAt);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      throw error;
    }
    return;
  }

  await migration.up(context);
  await recordMigration(client, migration, appVersion, Date.now() - startedAt);
}

export async function runVersionedMigrations({ migrations, appVersion, database = db, lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS } = {}) {
  const normalizedMigrations = migrations.map(normalizeMigration);
  const client = await database.connect();
  let lockAcquired = false;

  try {
    lockAcquired = await acquireMigrationLock(client, lockTimeoutMs);
    await ensureMigrationTable(client);

    let appliedRows = await loadAppliedMigrations(client);
    const initialStatus = getMigrationStatusFromRows(normalizedMigrations, appliedRows);
    if (initialStatus.checksumMismatches.length) {
      const ids = initialStatus.checksumMismatches.map((migration) => migration.id).join(", ");
      throw new Error(`Niezgodna historia migracji dla: ${ids}. Nie kontynuowano aktualizacji.`);
    }

    const appliedNow = [];
    const appliedIds = new Set(appliedRows.map((row) => row.id));
    for (const migration of normalizedMigrations) {
      if (appliedIds.has(migration.id)) continue;
      await executeMigration(client, migration, appVersion);
      appliedNow.push(migration.id);
    }

    appliedRows = await loadAppliedMigrations(client);
    return { ...getMigrationStatusFromRows(normalizedMigrations, appliedRows), appliedNow };
  } finally {
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => null);
    }
    client.release();
  }
}

export async function getVersionedMigrationStatus({ migrations, database = db } = {}) {
  const normalizedMigrations = migrations.map(normalizeMigration);
  const client = await database.connect();
  try {
    await ensureMigrationTable(client);
    return getMigrationStatusFromRows(normalizedMigrations, await loadAppliedMigrations(client));
  } finally {
    client.release();
  }
}
