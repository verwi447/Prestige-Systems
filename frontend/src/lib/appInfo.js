export const APP_VERSION = import.meta.env.VITE_APP_VERSION || "1.0.1";

export function formatAppVersion(version = APP_VERSION) {
  return String(version).replace(/\.0$/, "");
}
