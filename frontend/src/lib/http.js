import axios from "axios";
import { getRequestErrorMessage, setServerConnection, showFeedback } from "./feedback";
import { apiOrigin } from "./runtimeConfig";

const clearSession = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
};

export const api = axios.create({
  baseURL: apiOrigin,
  timeout: 20_000
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token && token !== "undefined") {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    setServerConnection(true);
    return response;
  },
  (error) => {
    if (error.response) setServerConnection(true);
    else if (error.code !== "ERR_CANCELED") setServerConnection(false);

    if (error.response?.status === 401 && window.location.pathname !== "/login") {
      clearSession();
      window.location.assign("/login");
    } else if (error.code !== "ERR_CANCELED" && !error.config?.skipGlobalFeedback) {
      showFeedback({
        message: getRequestErrorMessage(error),
        type: error.response?.status === 403 ? "warning" : "error"
      });
    }

    return Promise.reject(error);
  }
);

const createObjectUrl = (blob) => window.URL.createObjectURL(blob);
const releaseObjectUrlLater = (url) => {
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
};

export const protectedFiles = {
  get: (url) => api.get(url, { responseType: "blob" }),
  open: async (url) => {
    const preview = window.open("", "_blank", "noopener,noreferrer");
    try {
      const response = await api.get(url, { responseType: "blob" });
      const objectUrl = createObjectUrl(response.data);
      if (preview) preview.location.href = objectUrl;
      else window.open(objectUrl, "_blank", "noopener,noreferrer");
      releaseObjectUrlLater(objectUrl);
    } catch (error) {
      preview?.close();
      throw error;
    }
  },
  download: async (url, fileName = "zalacznik") => {
    const response = await api.get(url, { responseType: "blob" });
    const objectUrl = createObjectUrl(response.data);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    releaseObjectUrlLater(objectUrl);
  }
};
