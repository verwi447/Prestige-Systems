import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Client } = pg;

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function databaseNameFromUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!name) throw new Error("DATABASE_URL nie zawiera nazwy bazy danych.");
  return { name, parsed };
}

function maintenanceUrl(parsed, targetDatabase) {
  const maintenance = new URL(parsed.toString());
  maintenance.pathname = `/${targetDatabase === "postgres" ? "template1" : "postgres"}`;
  return maintenance.toString();
}

async function ensureDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Brak DATABASE_URL w pliku .env albo zmiennych srodowiskowych.");
  }

  const { name, parsed } = databaseNameFromUrl(databaseUrl);
  const adminClient = new Client({ connectionString: maintenanceUrl(parsed, name) });

  await adminClient.connect();
  try {
    const existing = await adminClient.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]);
    if (existing.rowCount === 0) {
      await adminClient.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
      console.log(`Utworzono baze danych: ${name}`);
    } else {
      console.log(`Baza danych juz istnieje: ${name}`);
    }
  } finally {
    await adminClient.end();
  }
}

async function runMigrations() {
  const { migrate } = await import("../src/migrate.js");
  await migrate();
}

async function main() {
  console.log("Prestige Systems HUB - konfiguracja bazy danych");
  await ensureDatabase();
  await runMigrations();
  console.log("Baza danych jest gotowa do uruchomienia aplikacji.");
}

main().catch((error) => {
  console.error("Nie udalo sie przygotowac bazy danych:");
  console.error(error.message);
  process.exit(1);
});
