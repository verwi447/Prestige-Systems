import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, Filter, History, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { auditLog } from "../api";
import "./AuditLog.css";

const categoryOptions = [
  ["", "Wszystkie kategorie"],
  ["TICKET", "Zgłoszenia"],
  ["ORDER", "Zamówienia"],
  ["OFFER", "Oferty"],
  ["USER", "Użytkownicy"],
  ["COMPANY", "Firmy"],
  ["BACKUP", "Backup"],
  ["SYSTEM", "System"]
];

const actionLabels = {
  TICKET_UPDATED: "Zaktualizowano zgłoszenie",
  TICKET_STATUS_CHANGED: "Zmieniono status zgłoszenia",
  TICKET_PRIORITY_CHANGED: "Zmieniono priorytet zgłoszenia",
  TICKET_ASSIGNED: "Przypisano opiekuna",
  TICKET_CLOSED: "Zamknięto zgłoszenie",
  TICKET_COMMENT_ADDED: "Dodano komentarz",
  TICKET_INTERNAL_NOTE_ADDED: "Dodano notatkę wewnętrzną",
  TICKET_ATTACHMENT_ADDED: "Dodano załącznik",
  TICKET_ATTACHMENT_DELETED: "Usunięto załącznik",
  TICKET_OFFER_LINKED: "Powiązano ofertę",
  ORDER_STATUS_CHANGED: "Zmieniono status zamówienia",
  ORDER_ASSIGNED: "Przypisano opiekuna zamówienia",
  ORDER_COMMENT_ADDED: "Dodano komentarz do zamówienia",
  ORDER_PRIORITY_CHANGED: "Zmieniono priorytet zamówienia",
  OFFER_CREATED: "Utworzono ofertę",
  OFFER_UPDATED: "Zaktualizowano ofertę",
  OFFER_DRAFT_SAVED: "Zapisano szkic oferty",
  OFFER_STATUS_CHANGED: "Zmieniono status oferty",
  OFFER_EMAIL_SENT: "Wysłano ofertę e-mailem",
  OFFER_DELETED: "Usunięto ofertę",
  OFFER_ACCEPTED_BY_CLIENT: "Klient zaakceptował ofertę",
  OFFER_REJECTED_BY_CLIENT: "Klient odrzucił ofertę",
  OFFER_COMMENT_ADDED_BY_CLIENT: "Klient dodał komentarz do oferty",
  USER_PERMISSIONS_UPDATED: "Zmieniono uprawnienia pracownika",
  COMPANY_CREATED: "Dodano firmę",
  COMPANY_UPDATED: "Zaktualizowano firmę"
};

const categoryLabels = Object.fromEntries(categoryOptions.filter(([value]) => value));
const emptyFilters = { query: "", category: "", userId: "", dateFrom: "", dateTo: "" };
const formatDate = (value) => value ? new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";
const authorName = (item) => [item.first_name, item.last_name].filter(Boolean).join(" ") || item.email || item.username || "System";
const actionLabel = (item) => actionLabels[item.action] || item.action.replace(/^BACKUP_/, "Backup: ").replaceAll("_", " ");

function CategoryBadge({ category }) {
  return <span className={`audit-category audit-category-${String(category || "system").toLowerCase()}`}>{categoryLabels[category] || category || "System"}</span>;
}

export default function AuditLog() {
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const limit = 20;

  const loadAudit = useCallback(async ({ currentPage, nextFilters, refresh = false }) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await auditLog.getAll({ page: currentPage, limit, ...nextFilters });
      setItems(response.data.items || []);
      setTotal(Number(response.data.total || 0));
      setPage(Number(response.data.page || currentPage));
    } catch (requestError) {
      setError(requestError.response?.data?.error || "Nie udało się pobrać dziennika audytu.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAudit({ currentPage: 1, nextFilters: emptyFilters });
    auditLog.getUsers().then((response) => setUsers(response.data || [])).catch(() => setUsers([]));
  }, [loadAudit]);

  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const applyFilters = () => loadAudit({ currentPage: 1, nextFilters: filters });
  const clearFilters = () => {
    setFilters(emptyFilters);
    loadAudit({ currentPage: 1, nextFilters: emptyFilters });
  };
  const activeFiltersCount = Object.entries(filters).filter(([key, value]) => key === "query" ? Boolean(value.trim()) : Boolean(value)).length;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="page audit-log-page">
      <header className="audit-log-header">
        <div>
          <div className="audit-log-breadcrumb">Ustawienia <span>›</span> Audit Log</div>
          <h1>Dziennik audytu</h1>
          <p>Historia istotnych działań w systemie.</p>
        </div>
        <button type="button" className="audit-log-refresh" onClick={() => loadAudit({ currentPage: page, nextFilters: filters, refresh: true })} disabled={refreshing}>
          <RefreshCw className={refreshing ? "spinning" : ""} aria-hidden="true" />
          {refreshing ? "Odświeżanie..." : "Odśwież"}
        </button>
      </header>

      <section className="audit-log-summary">
        <span><ShieldCheck aria-hidden="true" /></span>
        <div><strong>{total}</strong><small>zarejestrowanych zdarzeń</small></div>
        <p>Wpisy tworzą się automatycznie przy zmianach zgłoszeń, zamówień, ofert, uprawnień, firm i backupów.</p>
      </section>

      <section className="audit-log-panel">
        <div className="audit-filter-toolbar">
          <button type="button" className={filtersOpen ? "audit-filters-toggle active" : "audit-filters-toggle"} onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} aria-controls="audit-filters-panel">
            <Filter aria-hidden="true" />
            {filtersOpen ? "Ukryj filtry" : "Filtry"}
            {activeFiltersCount > 0 && <strong>{activeFiltersCount}</strong>}
          </button>
        </div>

        {filtersOpen && <div id="audit-filters-panel" className="audit-log-filters">
          <label className="audit-search"><span>Szukaj</span><span className="audit-search-control"><Search aria-hidden="true" /><input value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} onKeyDown={(event) => event.key === "Enter" && applyFilters()} placeholder="Akcja, komunikat lub ID..." autoFocus /></span></label>
          <label><span>Kategoria</span><select value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}>{categoryOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>Użytkownik</span><select value={filters.userId} onChange={(event) => updateFilter("userId", event.target.value)}><option value="">Wszyscy</option>{users.map((user) => <option value={user.id} key={user.id}>{[user.first_name, user.last_name].filter(Boolean).join(" ") || user.email || user.username}</option>)}</select></label>
          <label><span>Od</span><input type="date" value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} /></label>
          <label><span>Do</span><input type="date" value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} /></label>
          <div className="audit-filter-actions"><span aria-hidden="true" /><div className="audit-filter-buttons"><button type="button" className="audit-filter-button" onClick={applyFilters}><Search aria-hidden="true" />Szukaj</button><button type="button" className="audit-clear-button" onClick={clearFilters}>Wyczyść</button></div></div>
        </div>}

        {error && <div className="audit-log-error" role="alert">{error}</div>}

        <div className="audit-log-table-shell">
          <table className="audit-log-table">
            <thead><tr><th>Data</th><th>Kategoria</th><th>Akcja</th><th>Użytkownik</th><th>Rekord</th><th>Szczegóły</th></tr></thead>
            <tbody>
              {items.map((item) => <tr key={item.id}>
                <td><time><Clock3 aria-hidden="true" />{formatDate(item.created_at)}</time></td>
                <td><CategoryBadge category={item.category} /></td>
                <td className="audit-action">{actionLabel(item)}</td>
                <td>{authorName(item)}</td>
                <td>{item.entity_type && item.entity_id ? `${item.entity_type} #${item.entity_id}` : "-"}</td>
                <td className="audit-message">{item.message || "-"}</td>
              </tr>)}
              {!loading && !items.length && <tr><td colSpan="6"><div className="audit-empty"><History aria-hidden="true" />Brak zdarzeń dla wybranych filtrów.</div></td></tr>}
              {loading && <tr><td colSpan="6"><div className="audit-empty">Ładowanie wpisów...</div></td></tr>}
            </tbody>
          </table>
        </div>

        <footer className="audit-log-footer">
          <span>Wyświetlanie {total ? (page - 1) * limit + 1 : 0}-{Math.min(page * limit, total)} z {total} wpisów</span>
          <div><button type="button" aria-label="Poprzednia strona" disabled={page === 1} onClick={() => loadAudit({ currentPage: page - 1, nextFilters: filters })}><ChevronLeft /></button><strong>{page}</strong><button type="button" aria-label="Następna strona" disabled={page >= totalPages} onClick={() => loadAudit({ currentPage: page + 1, nextFilters: filters })}><ChevronRight /></button></div>
        </footer>
      </section>
    </div>
  );
}
