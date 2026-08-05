import dotenv from "dotenv";

dotenv.config();

const { db } = await import("../src/db.js");
const { getMigrationStatus } = await import("../src/migrate.js");

try {
  console.log(JSON.stringify(await getMigrationStatus(), null, 2));
} catch (error) {
  console.error(error.message || "Nie udalo sie pobrac statusu migracji.");
  process.exitCode = 1;
} finally {
  await db.end();
}
