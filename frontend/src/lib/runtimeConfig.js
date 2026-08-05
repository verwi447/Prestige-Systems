const configuredApiOrigin = String(import.meta.env.VITE_API_URL || "").trim().replace(/\/$/, "");

const currentOrigin = () => {
  if (typeof window === "undefined") return "http://localhost:5000";
  return window.location.port === "5173" ? "http://localhost:5000" : window.location.origin;
};

export const apiOrigin = configuredApiOrigin || currentOrigin();
