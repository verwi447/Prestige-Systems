import dotenv from "dotenv";

dotenv.config();

// Konfiguracja jest walidowana raz, przy starcie procesu. Serwis, ktory wstaje
// z brakujacym sekretem, przechodzi walidacje wdrozenia (/app-version.json
// odpowiada 200), a dopiero uzytkownik odkrywa, ze nie da sie zalogowac -
// dlatego brak wymaganej zmiennej musi przerwac start, nie pierwsze zadanie.
export class ConfigError extends Error {}

function required(name, { minLength = 1, validate } = {}) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new ConfigError(`Brak wymaganej zmiennej srodowiskowej ${name}.`);
  if (value.length < minLength) {
    throw new ConfigError(`${name} musi miec co najmniej ${minLength} znakow.`);
  }
  const problem = validate?.(value);
  if (problem) throw new ConfigError(`${name}: ${problem}`);
  return value;
}

function optional(name, fallback = "") {
  const value = String(process.env[name] ?? "").trim();
  return value || fallback;
}

function positiveInteger(name, fallback) {
  const raw = optional(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} musi byc liczba calkowita wieksza od zera.`);
  }
  return parsed;
}

// Klucz AES-256-GCM musi miec dokladnie 32 BAJTY. Walidacja dlugosci stringa
// przepuszczala klucz z polskimi znakami, ktory po zakodowaniu w UTF-8 jest
// dluzszy - blad wychodzil dopiero przy pierwszym zapisie hasla SMTP.
export function validateEncryptionKey(value) {
  const bytes = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "utf8");
  if (bytes.length !== 32) {
    return `klucz musi miec 32 bajty (otrzymano ${bytes.length}). Zalecane: 64 znaki hex.`;
  }
  return null;
}

export function loadConfig() {
  const nodeEnv = optional("NODE_ENV", "development").toLowerCase();
  const port = positiveInteger("PORT", 5000);
  const host = optional("HOST") || (nodeEnv === "production" ? "127.0.0.1" : null);

  return {
    nodeEnv,
    isProduction: nodeEnv === "production",
    port,
    host,
    databaseUrl: required("DATABASE_URL"),
    jwtSecret: required("JWT_SECRET", { minLength: 32 }),
    emailEncryptionKey: required("EMAIL_ENCRYPTION_KEY", { validate: validateEncryptionKey }),
    publicBaseUrl: optional("PUBLIC_BASE_URL"),
    isHttpsPublicUrl: optional("PUBLIC_BASE_URL").toLowerCase().startsWith("https://"),
    trustProxy: optional("TRUST_PROXY", host === "127.0.0.1" ? "loopback" : "false"),
    dbPoolMax: positiveInteger("DB_POOL_MAX", 15),
    geoAllowedCountries: optional("GEO_ALLOWED_COUNTRIES")
      .split(",").map((code) => code.trim().toUpperCase()).filter(Boolean),
    allowedOrigins: new Set(
      optional(
        "ALLOWED_ORIGINS",
        `http://localhost:${port},http://127.0.0.1:${port},http://localhost:5173,http://127.0.0.1:5173`
      ).split(",").map((origin) => origin.trim()).filter(Boolean)
    )
  };
}

let cached = null;

export function getConfig() {
  if (!cached) cached = loadConfig();
  return cached;
}
