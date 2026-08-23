export const statusLabels = {
  NEW: "Nowe",
  ACCEPTED: "Przyjete",
  IN_PROGRESS: "W realizacji",
  WAITING_FOR_CLIENT: "Oczekuje na klienta",
  WAITING_FOR_PARTS: "Oczekuje na czesci",
  REJECTED: "Odrzucone",
  COMPLETED: "Zakonczone",
  CANCELLED: "Anulowane"
};

export const typeLabels = {
  SYSTEM_FAILURE: "Awaria systemu",
  HARDWARE_FAILURE: "Awaria sprzetu",
  ORDER: "Zamowienie"
};

export const priorityLabels = {
  LOW: "Niski",
  NORMAL: "Normalny",
  HIGH: "Wysoki",
  CRITICAL: "Krytyczny"
};

export const aiConversationLabels = {
  ACTIVE: "AI rozmawia z klientem",
  ESCALATED: "Wymaga Twojej uwagi",
  RESOLVED: "AI rozwiazalo"
};

export const normalizeLegacyStatus = (status) => {
  if (statusLabels[status]) return status;
  const value = String(status || "").toUpperCase();
  if (value.includes("TRAKCIE") || value.includes("REALIZ")) return "IN_PROGRESS";
  if (value.includes("ODRZ") || value.includes("REJECT")) return "REJECTED";
  if (value.includes("ZAKO") || value.includes("ZAMK")) return "COMPLETED";
  if (value.includes("ANUL")) return "CANCELLED";
  if (value.includes("PRZY")) return "ACCEPTED";
  return "NEW";
};

export const normalizeLegacyType = (type) => {
  if (typeLabels[type]) return type;
  const value = String(type || "").toUpperCase();
  if (value.includes("ZAM")) return "ORDER";
  if (value.includes("SPRZ")) return "HARDWARE_FAILURE";
  return "SYSTEM_FAILURE";
};

export const formatDateParts = (value) => {
  if (!value) return { date: "-", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "-", time: "" };
  return {
    date: date.toLocaleDateString("pl-PL"),
    time: date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })
  };
};

export function TicketBadge({ value, kind }) {
  if (kind === "ai") {
    if (!value || !aiConversationLabels[value]) return null;
    return <span className={`ticket-badge ai-${value}`}>{aiConversationLabels[value]}</span>;
  }
  return <span className={`ticket-badge ${kind}-${value}`}>{kind === "status" ? statusLabels[value] || value : priorityLabels[value] || value}</span>;
}
