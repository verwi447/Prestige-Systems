import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

// AES-256 potrzebuje 32 BAJTOW, a nie 32 znakow: klucz zapisany w UTF-8
// z polskimi znakami przechodzil poprzednia walidacje i wysadzal dopiero
// createCipheriv przy pierwszym zapisie hasla SMTP. Klucz w hex (64 znaki)
// jest preferowany, wariant UTF-8 zostaje dla zgodnosci z juz wdrozonymi
// instalacjami.
function getKey() {
  const key = String(process.env.EMAIL_ENCRYPTION_KEY || "").trim();
  if (!key) throw new Error("EMAIL_ENCRYPTION_KEY is missing");
  const buffer = /^[0-9a-fA-F]{64}$/.test(key) ? Buffer.from(key, "hex") : Buffer.from(key, "utf8");
  if (buffer.length !== 32) {
    throw new Error(`EMAIL_ENCRYPTION_KEY must be 32 bytes (got ${buffer.length}); use 64 hex characters`);
  }
  return buffer;
}

export function encryptText(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptText(payload) {
  if (!payload) return null;
  const [ivHex, authTagHex, encryptedHex] = payload.split(":");
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}
