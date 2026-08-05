export const FEEDBACK_EVENT = "app-feedback";
export const CONNECTION_EVENT = "app-connection";

const networkErrorCodes = new Set(["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT"]);

export function getRequestErrorMessage(error, fallback = "Operacja nie powiodla sie.") {
  const status = error?.response?.status;
  const apiMessage = error?.response?.data?.error;

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "Brak polaczenia z internetem. Sprawdz siec i sprobuj ponownie.";
  }

  if (!status || networkErrorCodes.has(error?.code)) {
    return "Nie mozna polaczyc sie z serwerem. Sprobuj ponownie za chwile.";
  }

  if (status === 403) {
    return apiMessage || "Nie masz uprawnien do wykonania tej operacji.";
  }

  if (status === 404) {
    return apiMessage || "Nie znaleziono danych lub nie masz do nich dostepu.";
  }

  if (status >= 500) {
    return "Serwer napotkal problem. Sprobuj ponownie za chwile.";
  }

  return apiMessage || fallback;
}

export function showFeedback({ message, type = "success", duration } = {}) {
  if (!message || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FEEDBACK_EVENT, { detail: { message, type, duration } }));
}

export function setServerConnection(available) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONNECTION_EVENT, { detail: { available: Boolean(available) } }));
}

export const showSuccess = (message) => showFeedback({ message, type: "success" });
