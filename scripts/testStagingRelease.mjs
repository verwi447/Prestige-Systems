import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const sourceRelease = path.join(projectRoot, "app-release");
const testContainer = path.join(projectRoot, ".release-test");
const testRoot = path.join(testContainer, `run-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
const installRoot = path.join(testRoot, "install");
const updateRelease = path.join(testRoot, "release-update");
const port = 5101;
let initialVersion = null;
let stagingVersion = null;
let schemaVersion = null;
const payloadPaths = [
  "app-version.json",
  "VERSION.txt",
  "RELEASE_MANIFEST.json",
  "INSTALL.md",
  "backend/package.json",
  "backend/package-lock.json",
  "backend/.env.example",
  "backend/src",
  "backend/scripts",
  "backend/service",
  "backend/assets",
  "frontend/dist",
  "service"
];

let serverProcess = null;
let stagingDatabaseUrl = null;

function run(command, args, { cwd, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(output.trim());
      reject(new Error(`${command} ${args.join(" ")} zakonczyl sie kodem ${code}.\n${output.slice(-3000)}`));
    });
  });
}

function runNpm(args, options) {
  if (process.platform !== "win32") return run("npm", args, options);
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return run(process.execPath, [npmCli, ...args], options);
}

async function copyPayload(sourceRoot, targetRoot) {
  for (const relativePath of payloadPaths) {
    const source = path.join(sourceRoot, relativePath);
    const target = path.join(targetRoot, relativePath);
    const stat = await fs.stat(source).catch(() => null);
    if (!stat) throw new Error(`Brak pliku wydania: ${relativePath}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, { recursive: stat.isDirectory(), force: true });
  }
}

function setEnvValue(content, key, value) {
  const expression = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  return expression.test(content) ? content.replace(expression, line) : `${content.trimEnd()}\n${line}\n`;
}

async function configureStagingEnvironment() {
  const sourceEnvPath = path.join(projectRoot, "backend", ".env");
  let envContent = await fs.readFile(sourceEnvPath, "utf8").catch(() => {
    throw new Error("Brak backend/.env. Test wydania wymaga lokalnej konfiguracji bazy danych.");
  });
  const databaseLine = envContent.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (!databaseLine) throw new Error("Brak DATABASE_URL w backend/.env.");

  const databaseUrl = new URL(databaseLine);
  const databaseName = `prestige_stage_${Date.now()}_${crypto.randomUUID().slice(0, 6).replace(/-/g, "")}`;
  databaseUrl.pathname = `/${databaseName}`;
  stagingDatabaseUrl = databaseUrl.toString();

  envContent = setEnvValue(envContent, "DATABASE_URL", stagingDatabaseUrl);
  envContent = setEnvValue(envContent, "PORT", String(port));
  envContent = setEnvValue(envContent, "NODE_ENV", "test");
  envContent = setEnvValue(envContent, "ALLOWED_ORIGINS", `http://localhost:${port},http://127.0.0.1:${port}`);
  await fs.writeFile(path.join(installRoot, "backend", ".env"), envContent, "utf8");
}

async function updateReleaseVersion() {
  const appVersionPath = path.join(updateRelease, "app-version.json");
  const manifestPath = path.join(updateRelease, "RELEASE_MANIFEST.json");
  const appVersion = JSON.parse(await fs.readFile(appVersionPath, "utf8"));
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  appVersion.version = stagingVersion;
  manifest.version = stagingVersion;
  await fs.writeFile(appVersionPath, `${JSON.stringify(appVersion, null, 2)}\n`, "utf8");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(updateRelease, "VERSION.txt"), `${stagingVersion}\n`, "utf8");
}

async function waitForVersion(expectedVersion, expectedSchemaVersion) {
  const deadline = Date.now() + 45_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}/app-version.json`, { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 200 && payload.version === expectedVersion && payload.schemaVersion === expectedSchemaVersion) {
        const health = await fetch(`http://localhost:${port}/healthz`, { cache: "no-store" });
        const healthPayload = await health.json();
        if (health.status === 200 && healthPayload.status === "ok") return;
      }
      lastError = new Error(`Otrzymano wersje ${payload.version || "brak"} i schemat ${payload.schemaVersion || "brak"}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Aplikacja testowa nie uruchomila wersji ${expectedVersion} i schematu ${expectedSchemaVersion}: ${lastError?.message || "brak odpowiedzi"}`);
}

async function startServer(expectedVersion) {
  const backendDir = path.join(installRoot, "backend");
  const serverEnv = { ...process.env, PORT: String(port), NODE_ENV: "test" };
  serverProcess = spawn(process.execPath, ["src/index.js"], {
    cwd: backendDir,
    env: serverEnv,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  serverProcess.stdout.on("data", (chunk) => { output += chunk; });
  serverProcess.stderr.on("data", (chunk) => { output += chunk; });
  serverProcess.on("exit", (code) => {
    if (code !== 0 && output) process.stderr.write(output.slice(-3000));
  });
  await waitForVersion(expectedVersion, schemaVersion);
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  const current = serverProcess;
  serverProcess = null;
  current.kill();
  await new Promise((resolve) => current.once("exit", resolve));
}

async function assertDatabaseReady() {
  const backendDir = path.join(installRoot, "backend");
  const script = `
    import pg from "pg";
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const result = await client.query("SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema='public'");
    await client.end();
    if (result.rows[0].count < 4) process.exit(2);
  `;
  await run(process.execPath, ["--input-type=module", "-e", script], { cwd: backendDir, env: { ...process.env, DATABASE_URL: stagingDatabaseUrl } });
}

async function assertMigrationsCurrent() {
  const output = await run(process.execPath, ["scripts/migrationStatus.js"], { cwd: path.join(installRoot, "backend") });
  const status = JSON.parse(output);
  if (!status.isCurrent || status.pendingCount !== 0 || status.appliedVersion !== schemaVersion) {
    throw new Error("Migracje w wydaniu testowym nie osiagnely oczekiwanego stanu.");
  }
}

async function dropStagingDatabase() {
  if (!stagingDatabaseUrl) return;
  const backendDir = path.join(installRoot, "backend");
  const script = `
    import pg from "pg";
    const source = new URL(process.env.DATABASE_URL);
    const databaseName = decodeURIComponent(source.pathname.slice(1));
    source.pathname = databaseName === "postgres" ? "/template1" : "/postgres";
    const client = new pg.Client({ connectionString: source.toString() });
    await client.connect();
    await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()", [databaseName]);
    await client.query('DROP DATABASE IF EXISTS "' + databaseName.replace(/"/g, '""') + '"');
    await client.end();
  `;
  await run(process.execPath, ["--input-type=module", "-e", script], { cwd: backendDir, env: { ...process.env, DATABASE_URL: stagingDatabaseUrl } }).catch(() => null);
}

try {
  await fs.stat(sourceRelease);
  const sourceAppInfo = JSON.parse(await fs.readFile(path.join(sourceRelease, "app-version.json"), "utf8"));
  initialVersion = String(sourceAppInfo.version || "");
  schemaVersion = String(sourceAppInfo.schemaVersion || "");
  if (!initialVersion) throw new Error("Wydanie testowe nie ma numeru wersji.");
  if (!schemaVersion) throw new Error("Wydanie testowe nie ma wersji schematu bazy.");
  stagingVersion = `${initialVersion}-staging`;
  await fs.mkdir(testRoot, { recursive: true });
  await copyPayload(sourceRelease, installRoot);
  await configureStagingEnvironment();
  await runNpm(["ci", "--omit=dev"], { cwd: path.join(installRoot, "backend") });
  await runNpm(["run", "db:setup"], { cwd: path.join(installRoot, "backend") });
  await assertDatabaseReady();
  await assertMigrationsCurrent();

  await startServer(initialVersion);
  await stopServer();

  await run(process.execPath, ["scripts/createPreUpdateBackup.js"], { cwd: path.join(installRoot, "backend") });
  const envBeforeUpdate = await fs.readFile(path.join(installRoot, "backend", ".env"), "utf8");
  const markerPath = path.join(installRoot, "backend", "uploads", "release-test-marker.txt");
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  await fs.writeFile(markerPath, "preserve-runtime-data", "utf8");

  await fs.cp(sourceRelease, updateRelease, { recursive: true, force: true });
  await updateReleaseVersion();
  await copyPayload(updateRelease, installRoot);
  await runNpm(["ci", "--omit=dev"], { cwd: path.join(installRoot, "backend") });
  await runNpm(["run", "db:migrate"], { cwd: path.join(installRoot, "backend") });

  const envAfterUpdate = await fs.readFile(path.join(installRoot, "backend", ".env"), "utf8");
  const markerAfterUpdate = await fs.readFile(markerPath, "utf8");
  if (envBeforeUpdate !== envAfterUpdate || markerAfterUpdate !== "preserve-runtime-data") {
    throw new Error("Aktualizacja testowa zmienila pliki runtime, ktore powinny zostac zachowane.");
  }

  await startServer(stagingVersion);
  await assertDatabaseReady();
  await assertMigrationsCurrent();
  await stopServer();

  console.log(JSON.stringify({ ok: true, initialVersion, updatedVersion: stagingVersion, port }));
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await stopServer().catch(() => null);
  await dropStagingDatabase();
  await fs.rm(testRoot, { recursive: true, force: true });
  const remainingRuns = await fs.readdir(testContainer).catch(() => []);
  if (remainingRuns.length === 0) await fs.rmdir(testContainer).catch(() => null);
}
