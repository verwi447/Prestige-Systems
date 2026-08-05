import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const releaseDir = path.resolve(projectRoot, "app-release");
const templateDir = path.resolve(projectRoot, "release-template");

const runtimePaths = [
  "app-version.json",
  "backend/package.json",
  "backend/package-lock.json",
  "backend/src",
  "backend/scripts",
  "backend/service",
  "backend/assets",
  "frontend/dist"
];
const excludedRuntimeSegments = new Set(["daemon", "node_modules", "uploads", "system-backups", ".backup-imports", ".backup-temp"]);

function ensureProjectChild(targetPath) {
  const projectPrefix = `${projectRoot}${path.sep}`;
  if (!targetPath.startsWith(projectPrefix)) {
    throw new Error("Docelowy katalog wydania musi znajdowac sie w katalogu projektu.");
  }
}

async function copyRuntimePath(relativePath) {
  const sourcePath = path.resolve(projectRoot, relativePath);
  const targetPath = path.resolve(releaseDir, relativePath);
  const sourceStat = await fs.stat(sourcePath).catch(() => null);

  if (!sourceStat) {
    throw new Error(`Brak wymaganego pliku wydania: ${relativePath}`);
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, {
    recursive: sourceStat.isDirectory(),
    filter: (entryPath) => {
      const segments = path.relative(projectRoot, entryPath).split(path.sep);
      return !segments.some((segment) => excludedRuntimeSegments.has(segment));
    }
  });
}

async function replaceVersionPlaceholder(relativePath, version) {
  const filePath = path.join(releaseDir, relativePath);
  const content = await fs.readFile(filePath, "utf8");
  await fs.writeFile(filePath, content.replaceAll("{{APP_VERSION}}", version), "utf8");
}

async function main() {
  ensureProjectChild(releaseDir);
  const versionInfo = JSON.parse(await fs.readFile(path.join(projectRoot, "app-version.json"), "utf8"));
  const version = String(versionInfo.version || "0.0.0");
  const schemaVersion = String(versionInfo.schemaVersion || "legacy");

  await fs.rm(releaseDir, { recursive: true, force: true });
  await fs.mkdir(releaseDir, { recursive: true });

  for (const runtimePath of runtimePaths) {
    await copyRuntimePath(runtimePath);
  }

  await fs.cp(templateDir, releaseDir, { recursive: true });
  await replaceVersionPlaceholder("INSTALL.md", version);
  await fs.writeFile(path.join(releaseDir, "VERSION.txt"), `${version}\n`, "utf8");
  await fs.writeFile(
    path.join(releaseDir, "RELEASE_MANIFEST.json"),
    `${JSON.stringify({
      application: "Prestige Systems HUB",
      version,
      schemaVersion,
      generatedAt: new Date().toISOString(),
      installRoot: "C:\\PrestigeSystemsHub"
    }, null, 2)}\n`,
    "utf8"
  );

  console.log(`Gotowe wydanie Prestige Systems HUB ${version}: ${releaseDir}`);
}

main().catch((error) => {
  console.error("Nie udalo sie przygotowac wydania:", error.message);
  process.exitCode = 1;
});
