import fs from "fs";
import { CURRENT_SCHEMA_VERSION } from "./migrationPlan.js";

const appInfoPath = new URL("../../app-version.json", import.meta.url);

export function getAppInfo() {
  const appInfo = JSON.parse(fs.readFileSync(appInfoPath, "utf8"));
  return {
    name: String(appInfo.name || "Prestige Systems HUB").trim(),
    version: String(appInfo.version || "1.0.1").trim(),
    schemaVersion: String(appInfo.schemaVersion || CURRENT_SCHEMA_VERSION).trim()
  };
}

const initialAppInfo = getAppInfo();
export const APP_NAME = initialAppInfo.name;
export const APP_VERSION = initialAppInfo.version;
export const APP_SCHEMA_VERSION = initialAppInfo.schemaVersion;

export function createBackupFileName(stamp) {
  const safeVersion = getAppInfo().version.replace(/[^0-9A-Za-z.-]/g, "-");
  return `prestige-systems-hub-v${safeVersion}-${stamp}.zip`;
}
