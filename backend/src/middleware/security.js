import rateLimit from "express-rate-limit";

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);

export function containsUnsafeValue(value, depth = 0) {
  if (depth > 12) return true;
  if (typeof value === "string") return value.includes("\0") || value.length > 200_000;
  if (Array.isArray(value)) return value.length > 5000 || value.some((entry) => containsUnsafeValue(entry, depth + 1));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, entry]) => forbiddenKeys.has(key) || containsUnsafeValue(entry, depth + 1));
}

export function requestGuard(req, res, next) {
  if (containsUnsafeValue(req.body) || containsUnsafeValue(req.query) || containsUnsafeValue(req.params)) {
    return res.status(400).json({ error: "Nieprawidłowe dane żądania." });
  }
  next();
}

const rateLimitResponse = (_req, res) => res.status(429).json({ error: "Zbyt wiele żądań. Spróbuj ponownie później." });

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: rateLimitResponse
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: rateLimitResponse
});

export function notFoundApi(req, res, next) {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Endpoint nie istnieje." });
  next();
}

export function safeErrorHandler(err, _req, res, _next) {
  console.error("Unhandled request error:", err);
  if (res.headersSent) return;
  if (Number(err?.status) === 403) return res.status(403).json({ error: "Niedozwolone zrodlo zadania." });
  res.status(500).json({ error: "Wewnętrzny błąd serwera." });
}
