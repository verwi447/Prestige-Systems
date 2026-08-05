import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Client } = pg;

function readArg(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : "";
}

const username = readArg("username") || process.env.ADMIN_USERNAME || "Verwi";
const password = readArg("password") || process.env.ADMIN_PASSWORD;
const email = readArg("email") || process.env.ADMIN_EMAIL || username;
const firstName = readArg("firstName") || process.env.ADMIN_FIRST_NAME || "Admin";
const lastName = readArg("lastName") || process.env.ADMIN_LAST_NAME || "";

if (!process.env.DATABASE_URL) {
  console.error("Brak DATABASE_URL w pliku .env.");
  process.exit(1);
}

if (!password) {
  console.error("Podaj haslo admina: npm run admin:create -- --password=TwojeHaslo");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  const passwordHash = await bcrypt.hash(password, 10);

  const result = await client.query(
    `INSERT INTO users (username, email, first_name, last_name, password_hash, role, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'ADMIN', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (username)
     DO UPDATE SET
       email=EXCLUDED.email,
       first_name=EXCLUDED.first_name,
       last_name=EXCLUDED.last_name,
       password_hash=EXCLUDED.password_hash,
       role='ADMIN',
       is_active=TRUE,
       updated_at=CURRENT_TIMESTAMP
     RETURNING id, username, email, role`,
    [username, email, firstName, lastName, passwordHash]
  );

  const admin = result.rows[0];
  console.log(`Konto admina gotowe: ${admin.username} (${admin.email}), ID ${admin.id}`);
} catch (error) {
  console.error("Nie udalo sie utworzyc konta admina:");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
