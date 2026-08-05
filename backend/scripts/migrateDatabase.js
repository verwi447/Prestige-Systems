import dotenv from "dotenv";

dotenv.config();

const { db } = await import("../src/db.js");
const { migrate } = await import("../src/migrate.js");

try {
  const result = await migrate();
  console.log(JSON.stringify({
    ok: true,
    schemaVersion: result.appliedVersion,
    appliedNow: result.appliedNow,
    pendingCount: result.pendingCount
  }));
} catch (error) {
  console.error(error.message || "Nie udalo sie wykonac migracji bazy danych.");
  process.exitCode = 1;
} finally {
  await db.end();
}
