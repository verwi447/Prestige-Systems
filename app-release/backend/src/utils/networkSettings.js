import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");
const LOCAL_HOST = "127.0.0.1";
const LAN_HOST = "0.0.0.0";
const DEFAULT_PORT = 5000;

const valueFromEnv = (values, key, fallback = "") => String(values[key] ?? fallback).trim();

const parseEnv = (content) => {
  const values = Object.create(null);
  for (const line of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return values;
};

const readEnv = async () => {
  try {
    return { content: await fs.readFile(envPath, "utf8"), exists: true };
  } catch (error) {
    if (error.code === "ENOENT") return { content: "", exists: false };
    throw error;
  }
};

const writeEnvValues = async (updates) => {
  const { content } = await readEnv();
  const hasBom = content.startsWith("\uFEFF");
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const remaining = new Map(Object.entries(updates));
  const nextLines = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*)=/);
    if (!match || !remaining.has(match[2])) return line;
    const value = remaining.get(match[2]);
    remaining.delete(match[2]);
    return `${match[1]}${match[2]}${match[3]}=${value}`;
  });

  for (const [key, value] of remaining) nextLines.push(`${key}=${value}`);
  const output = `${hasBom ? "\uFEFF" : ""}${nextLines.join("\r\n").replace(/\r?\n*$/, "\r\n")}`;
  await fs.writeFile(envPath, output, "utf8");
};

const lanInterfaces = () => Object.entries(os.networkInterfaces())
  .flatMap(([name, entries]) => (entries || [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254."))
    .map((entry) => ({ name, address: entry.address, netmask: entry.netmask })));

const normalizePort = (value) => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Port musi byc liczba od 1024 do 65535.");
  }
  return port;
};

const normalizeUrl = (value, label, required = false) => {
  const source = String(value || "").trim();
  if (!source) {
    if (required) throw new Error(`${label} jest wymagany.`);
    return "";
  }
  if (/\r|\n/.test(source)) throw new Error(`${label} zawiera niedozwolone znaki.`);

  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error(`${label} musi byc poprawnym adresem HTTP lub HTTPS.`);
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new Error(`${label} musi byc adresem HTTP lub HTTPS bez dodatkowej sciezki.`);
  }
  return parsed.origin;
};

const normalizeOrigins = (value) => {
  const rawOrigins = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  if (rawOrigins.length > 20) throw new Error("Mozesz dodac maksymalnie 20 dozwolonych zrodel.");
  return [...new Set(rawOrigins.map((origin) => String(origin).trim()).filter(Boolean)
    .map((origin) => normalizeUrl(origin, "Dozwolone zrodlo")))];
};

const defaultHost = (nodeEnv) => String(nodeEnv || "development").toLowerCase() === "production" ? LOCAL_HOST : "";

const buildConfig = (values) => {
  const nodeEnv = valueFromEnv(values, "NODE_ENV", process.env.NODE_ENV || "development");
  const host = valueFromEnv(values, "HOST", defaultHost(nodeEnv)) || LOCAL_HOST;
  const port = Number(valueFromEnv(values, "PORT", process.env.PORT || DEFAULT_PORT)) || DEFAULT_PORT;
  const publicBaseUrl = valueFromEnv(values, "PUBLIC_BASE_URL");
  const allowedOrigins = normalizeOrigins(valueFromEnv(values, "ALLOWED_ORIGINS"));
  return {
    accessMode: host === LAN_HOST ? "LAN" : "LOCAL",
    host: host === LAN_HOST ? LAN_HOST : LOCAL_HOST,
    port,
    publicBaseUrl,
    allowedOrigins
  };
};

const buildRuntime = () => ({
  host: String(process.env.HOST || defaultHost(process.env.NODE_ENV) || LOCAL_HOST),
  port: Number(process.env.PORT || DEFAULT_PORT),
  publicBaseUrl: String(process.env.PUBLIC_BASE_URL || "").trim(),
  allowedOrigins: normalizeOrigins(process.env.ALLOWED_ORIGINS || "")
});

const buildUrls = (config, interfaces) => {
  const localUrls = [`http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`];
  const lanUrls = interfaces.map((item) => `http://${item.address}:${config.port}`);
  return { localUrls, lanUrls, primaryUrl: config.publicBaseUrl || (config.accessMode === "LAN" ? lanUrls[0] || "" : localUrls[0]) };
};

export async function getNetworkSettings() {
  const { content } = await readEnv();
  const configured = buildConfig(parseEnv(content));
  const runtime = buildRuntime();
  const interfaces = lanInterfaces();
  const runtimeChanged = configured.host !== runtime.host
    || configured.port !== runtime.port
    || configured.publicBaseUrl !== runtime.publicBaseUrl
    || configured.allowedOrigins.join(",") !== runtime.allowedOrigins.join(",");

  return {
    configured,
    runtime: { ...runtime, accessMode: runtime.host === LAN_HOST ? "LAN" : "LOCAL" },
    interfaces,
    urls: buildUrls(configured, interfaces),
    restartRequired: runtimeChanged
  };
}

export async function updateNetworkSettings(input = {}) {
  const accessMode = input.accessMode === "LAN" ? "LAN" : input.accessMode === "LOCAL" ? "LOCAL" : null;
  if (!accessMode) throw new Error("Wybierz tryb dostepu lokalny lub LAN.");

  const port = normalizePort(input.port);
  const publicBaseUrl = normalizeUrl(input.publicBaseUrl, "Adres aplikacji", accessMode === "LAN");
  const allowedOrigins = normalizeOrigins(input.allowedOrigins);
  const systemOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  if (publicBaseUrl) systemOrigins.push(publicBaseUrl);
  const origins = [...new Set([...systemOrigins, ...allowedOrigins])];

  await writeEnvValues({
    HOST: accessMode === "LAN" ? LAN_HOST : LOCAL_HOST,
    PORT: String(port),
    TRUST_PROXY: "false",
    PUBLIC_BASE_URL: publicBaseUrl,
    ALLOWED_ORIGINS: origins.join(",")
  });

  return getNetworkSettings();
}
