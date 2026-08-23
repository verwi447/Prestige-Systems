import test from "node:test";
import assert from "node:assert/strict";
import { APP_VERSION, createBackupFileName } from "../src/appInfo.js";

test("backup filename contains the current application version", () => {
  const filename = createBackupFileName("2026-07-15-12-30-45");

  assert.equal(APP_VERSION, "1.0.1");
  assert.equal(filename, "prestige-systems-hub-v1.0.1-2026-07-15-12-30-45.zip");
});
