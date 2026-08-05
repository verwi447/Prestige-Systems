import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const appInfo = JSON.parse(readFileSync(new URL("../app-version.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appInfo.version)
  }
});
