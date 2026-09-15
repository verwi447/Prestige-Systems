import geoip from "geoip-lite";

// Private/local addresses never have a GeoIP country - always let them through
// so LAN access (and the app itself calling its own /healthz) never locks out.
function isPrivateOrLocalIp(ip) {
  if (!ip) return true;
  const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (normalized === "::1" || normalized === "127.0.0.1") return true;
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// GEO_ALLOWED_COUNTRIES is a comma-separated list of ISO 3166-1 alpha-2 codes
// (e.g. "PL,IT"). Leaving it unset disables geo-blocking entirely, which is
// the default for local development.
export function geoBlock(req, res, next) {
  const allowedCountries = String(process.env.GEO_ALLOWED_COUNTRIES || "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  if (!allowedCountries.length) return next();

  const ip = req.ip || "";
  if (isPrivateOrLocalIp(ip)) return next();

  const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const geo = geoip.lookup(normalized);
  if (geo && allowedCountries.includes(geo.country)) return next();

  console.warn(`Geo-block: odrzucono polaczenie z ${normalized} (kraj: ${geo?.country || "nieznany"})`);
  return res.status(403).json({ error: "Dostep z Twojej lokalizacji jest niedostepny." });
}
