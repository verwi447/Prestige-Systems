import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  HelpCircle,
  Search,
  SlidersHorizontal,
  XCircle
} from "lucide-react";
import { client as clientAPI } from "../api.js";
import AppState from "../components/AppState";
import { getRequestErrorMessage } from "../lib/feedback";
import "./MyOffers.css";

const statusOptions = [
  { value: "ALL", label: "Wszystkie" },
  { value: "DO AKCEPTACJI", label: "Do akceptacji" },
  { value: "WYSĹANA", label: "Wysłana" },
  { value: "ZAAKCEPTOWANA", label: "Zaakceptowane" },
  { value: "ODRZUCONA", label: "Odrzucone" },
  { value: "W REALIZACJI", label: "W realizacji" },
  { value: "ZAKOĹCZONA", label: "Zakończone" }
];

const statusMeta = {
  "WYSĹANA": { label: "Wysłana", className: "sent" },
  "WYSŁANA": { label: "Wysłana", className: "sent" },
  SENT: { label: "Wysłana", className: "sent" },
  "DO AKCEPTACJI": { label: "Do akceptacji", className: "approval" },
  TO_ACCEPTANCE: { label: "Do akceptacji", className: "approval" },
  ZAAKCEPTOWANA: { label: "Zaakceptowana", className: "accepted" },
  ACCEPTED: { label: "Zaakceptowana", className: "accepted" },
  ODRZUCONA: { label: "Odrzucona", className: "rejected" },
  REJECTED: { label: "Odrzucona", className: "rejected" },
  "W REALIZACJI": { label: "W realizacji", className: "progress" },
  IN_PROGRESS: { label: "W realizacji", className: "progress" },
  "ZAKOĹCZONA": { label: "Zakończona", className: "closed" },
  "ZAKOŃCZONA": { label: "Zakończona", className: "closed" },
  COMPLETED: { label: "Zakończona", className: "closed" }
};

const decisionStatuses = new Set(["DO AKCEPTACJI", "WYSĹANA", "WYSŁANA", "TO_ACCEPTANCE", "SENT"]);

const formatMoney = (value, currency = "PLN") => {
  const number = Number(value || 0);
  return `${number.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === "PLN" ? "zł" : currency}`;
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("pl-PL");
};

const getOfferDate = (offer) => offer.issueDate || offer.issue_date || offer.createdAt || offer.created_at || offer.updatedAt || offer.updated_at;
const getOfferNumber = (offer) => offer.number || offer.offer_number || `PS/${offer.id}`;
const getOfferTitle = (offer) => offer.title || "Oferta handlowa";
const getOfferValue = (offer) => offer.totalNet ?? offer.total_net ?? offer.total_price ?? 0;
const getOfferCurrency = (offer) => offer.currency || "PLN";

function StatusBadge({ status }) {
  const meta = statusMeta[status] || { label: status || "Brak statusu", className: "neutral" };
  return <span className={`client-offer-status ${meta.className}`}>{meta.label}</span>;
}

function StatCard({ icon: Icon, tone, title, value, description }) {
  return (
    <article className="client-offer-stat">
      <span className={`client-offer-stat-icon ${tone}`}><Icon size={24} /></span>
      <div>
        <strong>{value}</strong>
        <p>{title}</p>
        <small>{description}</small>
      </div>
    </article>
  );
}

export default function MyOffers() {
  const navigate = useNavigate();
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [activeTab, setActiveTab] = useState("overview");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const loadOffers = useCallback(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    clientAPI.offers()
      .then((response) => {
        if (mounted) setOffers(response.data || []);
      })
      .catch((err) => {
        if (mounted) setError(getRequestErrorMessage(err, "Nie udalo sie pobrac ofert."));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => loadOffers(), [loadOffers]);

  useEffect(() => {
    setPage(1);
  }, [query, status, dateFrom, dateTo, pageSize]);

  const stats = useMemo(() => {
    const count = (statuses) => offers.filter((offer) => statuses.includes(offer.status)).length;
    return {
      total: offers.length,
      decision: offers.filter((offer) => decisionStatuses.has(offer.status)).length,
      accepted: count(["ZAAKCEPTOWANA", "ACCEPTED"]),
      rejected: count(["ODRZUCONA", "REJECTED"])
    };
  }, [offers]);

  const attentionOffers = useMemo(() => {
    return offers
      .filter((offer) => decisionStatuses.has(offer.status))
      .sort((a, b) => new Date(a.validUntil || a.valid_until || 0) - new Date(b.validUntil || b.valid_until || 0))
      .slice(0, 3);
  }, [offers]);

  const filteredOffers = useMemo(() => {
    const search = query.trim().toLowerCase();
    return offers.filter((offer) => {
      const haystack = [getOfferNumber(offer), getOfferTitle(offer), offer.object_name, offer.site?.name].filter(Boolean).join(" ").toLowerCase();
      if (search && !haystack.includes(search)) return false;
      if (status !== "ALL" && offer.status !== status) return false;

      const time = getOfferDate(offer) ? new Date(getOfferDate(offer)).getTime() : null;
      if (dateFrom && (!time || time < new Date(dateFrom).setHours(0, 0, 0, 0))) return false;
      if (dateTo && (!time || time > new Date(dateTo).setHours(23, 59, 59, 999))) return false;
      return true;
    });
  }, [dateFrom, dateTo, offers, query, status]);

  const pageCount = Math.max(1, Math.ceil(filteredOffers.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleOffers = filteredOffers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const resultStart = filteredOffers.length ? (currentPage - 1) * pageSize + 1 : 0;
  const resultEnd = Math.min(currentPage * pageSize, filteredOffers.length);
  const activeFilterCount = [query.trim(), status !== "ALL", dateFrom, dateTo].filter(Boolean).length;

  const clearFilters = () => {
    setQuery("");
    setStatus("ALL");
    setDateFrom("");
    setDateTo("");
  };

  const offerPath = (offerId) => `/client/offers/${offerId}`;

  if (loading) return <div className="page client-offers-page"><div className="client-offers-card"><AppState title="Ladowanie ofert" description="Pobieramy aktualne oferty dla Twojej firmy." /></div></div>;
  if (error) return <div className="page client-offers-page"><div className="client-offers-card"><AppState variant="error" description={error} actionLabel="Sprobuj ponownie" onAction={loadOffers} /></div></div>;

  return (
    <div className="page client-offers-page">
      <header className="client-offers-header">
        <div>
          <h1>Oferty</h1>
          <p>Przeglądaj i zarządzaj ofertami handlowymi dla Twojej firmy.</p>
        </div>
      </header>

      <nav className="client-offer-tabs" aria-label="Widoki ofert">
        <button type="button" className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>
          Przegląd ofert
        </button>
        <button type="button" className={activeTab === "list" ? "active" : ""} onClick={() => setActiveTab("list")}>
          Lista ofert
        </button>
      </nav>

      <section className="client-offer-stats">
        <StatCard icon={FileText} tone="blue" title="Wszystkie oferty" value={stats.total} description="Wszystkie oferty" />
        <StatCard icon={AlertCircle} tone="purple" title="Do akceptacji" value={stats.decision} description="Oczekują na Twoją decyzję" />
        <StatCard icon={CheckCircle2} tone="green" title="Zaakceptowane" value={stats.accepted} description="Zaakceptowane oferty" />
        <StatCard icon={XCircle} tone="red" title="Odrzucone" value={stats.rejected} description="Odrzucone oferty" />
      </section>

      {activeTab === "overview" && (
        <section className="client-offers-overview client-offers-card">
          <div className="client-attention-list">
            <h2>Wymagają uwagi</h2>
            {attentionOffers.map((offer) => (
              <article key={offer.id} className="client-attention-row">
                <span />
                <div>
                  <strong>{getOfferNumber(offer)}</strong>
                  <small>{getOfferTitle(offer)}</small>
                </div>
                <div>
                  <small>Termin odpowiedzi</small>
                  <strong>{formatDate(offer.validUntil || offer.valid_until)}</strong>
                </div>
                <div>
                  <small>Wartość netto</small>
                  <strong>{formatMoney(getOfferValue(offer), getOfferCurrency(offer))}</strong>
                </div>
                <button type="button" onClick={() => navigate(offerPath(offer.id))}>Zobacz ofertę</button>
              </article>
            ))}
            {!attentionOffers.length && <p className="client-empty-line">Brak ofert wymagających decyzji.</p>}
          </div>
        </section>
      )}

      <div className="client-offers-search-toolbar">
        <button type="button" className={filtersOpen ? "client-search-toggle active" : "client-search-toggle"} onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}>
          <Search size={18} /> {filtersOpen ? "Ukryj filtry" : "Wyszukaj"}
          {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
        </button>
      </div>

      {filtersOpen && (
        <section className="client-offers-filters client-offers-card">
          <label className="client-offer-search">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj po numerze, nazwie oferty lub temacie..." autoFocus />
          </label>
          <label>
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Data od</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            <span>Data do</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <button type="button" className="client-clear-button" onClick={clearFilters}>Wyczyść</button>
        </section>
      )}

      <div className="client-offers-content">
        <section className="client-offers-table-card client-offers-card">
          <h2>Lista ofert</h2>
          {offers.length === 0 ? (
            <AppState title="Brak ofert" description="Oferty przygotowane dla Twojej firmy beda widoczne tutaj." />
          ) : (
            <>
              <div className="client-offers-table-wrap">
                <table className="client-offers-table">
                  <thead>
                    <tr>
                      <th>Numer</th>
                      <th>Temat</th>
                      <th>Data</th>
                      <th>Wartość netto</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOffers.map((offer) => (
                      <tr key={offer.id} onClick={() => navigate(offerPath(offer.id))}>
                        <td><strong>{getOfferNumber(offer)}</strong></td>
                        <td>{getOfferTitle(offer)}</td>
                        <td>{formatDate(getOfferDate(offer))}</td>
                        <td>{formatMoney(getOfferValue(offer), getOfferCurrency(offer))}</td>
                        <td><StatusBadge status={offer.status} /></td>
                      </tr>
                    ))}
                    {!visibleOffers.length && (
                      <tr><td colSpan="5" className="client-empty-line">Brak ofert spełniających wybrane filtry.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <footer className="client-offers-pagination">
                <span>Pozycje {resultStart}-{resultEnd} z {filteredOffers.length}</span>
                <div>
                  <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /></button>
                  {Array.from({ length: Math.min(pageCount, 3) }, (_, index) => index + 1).map((pageNumber) => (
                    <button type="button" key={pageNumber} className={currentPage === pageNumber ? "active" : ""} onClick={() => setPage(pageNumber)}>{pageNumber}</button>
                  ))}
                  <button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight size={16} /></button>
                </div>
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="Liczba ofert na stronie">
                  {[5, 10, 25].map((size) => <option key={size} value={size}>{size} / stronę</option>)}
                </select>
              </footer>
            </>
          )}
        </section>

        <aside className="client-offers-help client-offers-card">
          <span><HelpCircle size={22} /></span>
          <h2>Jak działają oferty?</h2>
          <p>Tutaj możesz przeglądać wszystkie oferty handlowe przygotowane dla Twojej firmy.</p>
          <ul>
            <li><CheckCircle2 size={18} /> Oferty oczekujące znajdziesz w sekcji „Wymagają uwagi”.</li>
            <li><CheckCircle2 size={18} /> Przejrzyj szczegóły oferty, a następnie ją zaakceptuj lub odrzuć.</li>
            <li><SlidersHorizontal size={18} /> Śledź status realizacji każdej oferty w czasie rzeczywistym.</li>
          </ul>
          <button type="button">Dowiedz się więcej</button>
        </aside>
      </div>
    </div>
  );
}
