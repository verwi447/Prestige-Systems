import test from "node:test";
import assert from "node:assert/strict";
import { getMigrationStatusFromRows, runVersionedMigrations } from "../src/migrationRunner.js";

function createDatabase(appliedRows = []) {
  const rows = [...appliedRows];
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (sql.includes("FROM schema_migrations")) return { rows: [...rows] };
      if (sql.includes("INSERT INTO schema_migrations")) {
        rows.push({
          id: params[0],
          checksum: params[1],
          description: params[2],
          app_version: params[3],
          execution_ms: params[4],
          applied_at: new Date("2026-08-05T10:00:00.000Z")
        });
      }
      return { rows: [] };
    },
    release() {}
  };

  return { database: { connect: async () => client }, rows, calls };
}

function migration(id, up, checksum = `${id}-checksum`) {
  return { id, checksum, description: `Migration ${id}`, up };
}

test("versioned migrations apply only missing steps and record their version", async () => {
  const { database, rows } = createDatabase([
    { id: "001", checksum: "001-checksum", applied_at: new Date("2026-08-04T10:00:00.000Z") }
  ]);
  const executed = [];
  const migrations = [
    migration("001", async () => executed.push("001")),
    migration("002", async () => executed.push("002"))
  ];

  const result = await runVersionedMigrations({ migrations, appVersion: "1.0.0", database });

  assert.deepEqual(executed, ["002"]);
  assert.deepEqual(result.appliedNow, ["002"]);
  assert.equal(result.isCurrent, true);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].app_version, "1.0.0");
});

test("failed transactional migration is not recorded", async () => {
  const { database, rows } = createDatabase();
  const migrations = [migration("001", async () => { throw new Error("migration failed"); })];

  await assert.rejects(
    runVersionedMigrations({ migrations, appVersion: "1.0.0", database }),
    /migration failed/
  );
  assert.equal(rows.length, 0);
});

test("migration status detects a changed migration checksum", () => {
  const migrations = [migration("001", async () => {})];
  const status = getMigrationStatusFromRows(migrations, [{
    id: "001",
    checksum: "old-checksum",
    applied_at: new Date("2026-08-04T10:00:00.000Z")
  }]);

  assert.equal(status.isCurrent, false);
  assert.deepEqual(status.checksumMismatches.map((item) => item.id), ["001"]);
});
