import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Copy,
  Download,
  Edit3,
  Eye,
  FileText,
  MoreVertical,
  Plus,
  Search,
  Send,
  Trash2
} from "lucide-react";
import { offers as offersAPI } from "../api.js";
import AppState from "../components/AppState";
import ConfirmationModal from "../components/ConfirmationModal";
import { getRequestErrorMessage, showSuccess } from "../lib/feedback";
import "./AdminOffers.css";

const statusOptions = [
  { value: "ALL", label: "Wszystkie" },
  { value: "SZKIC", label: "Szkic" },
  { value: "WYSŁANA", label: "Wysłana" },
  { value: "DO AKCEPTACJI", label: "Do akceptacji" },
  { value: "ZAAKCEPTOWANA", label: "Zaakceptowana" },
  { value: "ODRZUCONA", label: "Odrzucona" },
  { value: "W REALIZACJI", label: "W realizacji" },
  { value: "ZAKOŃCZONA", label: "Zakończona" }
];

const statusMeta = {
  SZKIC: { label: "Szkic", className: "draft" },
  "WYSŁANA": { label: "Wysłana", className: "sent" },
  "DO AKCEPTACJI": { label: "Do akceptacji", className: "approval" },
  ZAAKCEPTOWANA: { label: "Zaakceptowana", className: "accepted" },
  ODRZUCONA: { label: "Odrzucona", className: "rejected" },
  "W REALIZACJI": { label: "W realizacji", className: "progress" },
  "ZAKOŃCZONA": { label: "Zakończona", className: "closed" }
};

const money = (value, currency = "PLN") =>
  `${Number(value || 0).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === "PLN" ? "zł" : currency}`;

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("pl-PL");
};

const offerDate = (offer) => offer.issue_date || offer.created_at || offer.updated_at;
const customerName = (offer) => offer.client_company_name || offer.company_name || offer.customer_name || "-";
const ownerName = (offer) => offer.salesperson || offer.prepared_by_name || offer.creator_name || "Nie przypisano";

function StatusBadge({ status }) {
  const meta = statusMeta[status] || { label: status || "Brak statusu", className: "neutral" };
  return <span className={`admin-offer-status ${meta.className}`}>{meta.label}</span>;
}

function StatCard({ title, value, hint, tone, icon: Icon }) {
  return (
    <article className="admin-offer-stat">
      <span className={`admin-offer-stat-icon ${tone}`}><Icon size={22} /></span>
      <div>
        <strong>{value}</strong>
        <p>{title}</p>
        <small>{hint}</small>
      </div>
    </article>
  );
}

export default function AdminOffers() {
  const navigate = useNavigate();
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [owner, setOwner] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadOffers = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await offersAPI.getAll();
      setOffers(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      setError(getRequestErrorMessage(err, "Nie udalo sie pobrac ofert."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOffers();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query, status, owner, dateFrom, dateTo, pageSize]);

  const owners = useMemo(() => [...new Set(offers.map(ownerName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pl")), [offers]);

  const stats = useMemo(() => {
    const count = (statuses) => offers.filter((offer) => statuses.includes(offer.status)).length;
    return {
      all: offers.length,
      drafts: count(["SZKIC"]),
      sent: count(["WYSŁANA", "DO AKCEPTACJI"]),
      accepted: count(["ZAAKCEPTOWANA"]),
      rejected: count(["ODRZUCONA"])
    };
  }, [offers]);

  const filteredOffers = useMemo(() => {
    const search = query.trim().toLowerCase();
    return offers.filter((offer) => {
      const haystack = [offer.offer_number, offer.title, customerName(offer), ownerName(offer)].filter(Boolean).join(" ").toLowerCase();
      if (search && !haystack.includes(search)) return false;
      if (status !== "ALL" && offer.status !== status) return false;
      if (owner !== "ALL" && ownerName(offer) !== owner) return false;
      const time = offerDate(offer) ? new Date(offerDate(offer)).getTime() : null;
      if (dateFrom && (!time || time < new Date(dateFrom).setHours(0, 0, 0, 0))) return false;
      if (dateTo && (!time || time > new Date(dateTo).setHours(23, 59, 59, 999))) return false;
      return true;
    });
  }, [dateFrom, dateTo, offers, owner, query, status]);

  const pageCount = Math.max(1, Math.ceil(filteredOffers.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleOffers = filteredOffers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const resultStart = filteredOffers.length ? (currentPage - 1) * pageSize + 1 : 0;
  const resultEnd = Math.min(currentPage * pageSize, filteredOffers.length);

  const clearFilters = () => {
    setQuery("");
    setStatus("ALL");
    setOwner("ALL");
    setDateFrom("");
    setDateTo("");
  };

  const activeFilterCount = [query.trim(), status !== "ALL", owner !== "ALL", dateFrom, dateTo].filter(Boolean).length;

  const downloadPdf = async (offer) => {
    const response = await offersAPI.getPDF(offer.id);
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement("a");
    link.href = url;
    link.download = `oferta_${String(offer.offer_number || offer.id).replace(/\//g, "_")}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const duplicateOffer = async (offer) => {
    const source = await offersAPI.getById(offer.id);
    const copy = {
      ...source.data,
      id: undefined,
      offer_number: "",
      title: `${source.data.title || offer.title || "Oferta"} (kopia)`,
      status: "SZKIC"
    };
    const created = await offersAPI.create(copy);
    navigate(`/offers/edit/${created.data.id}`);
  };

  const deleteOffer = async (offer) => {
    await offersAPI.delete(offer.id);
    setOffers((current) => current.filter((item) => item.id !== offer.id));
    setOpenMenuId(null);
    showSuccess("Oferta zostala usunieta.");
  };

  const confirmDeleteOffer = async () => {
    const offer = deleteTarget;
    setDeleteTarget(null);
    if (offer) await deleteOffer(offer);
  };

  if (loading) return <div className="page admin-offers-page"><div className="admin-offers-card"><AppState variant="loading" title="Ladowanie ofert" description="Pobieramy aktualne dane handlowe." /></div></div>;
  if (error) return <div className="page admin-offers-page"><div className="admin-offers-card"><AppState variant="error" description={error} actionLabel="Sprobuj ponownie" onAction={loadOffers} /></div></div>;

  return (
    <div className="page admin-offers-page">
      <header className="admin-offers-header">
        <div>
          <h1>Oferty</h1>
          <p>Zarządzaj ofertami handlowymi, szkicami, wysyłką i akceptacją klientów.</p>
        </div>
        <button type="button" className="admin-offers-primary" onClick={() => navigate("/offers/new")}>
          <Plus size={18} /> Nowa oferta
        </button>
      </header>

      <section className="admin-offer-stats">
        <StatCard icon={FileText} tone="blue" title="Wszystkie oferty" value={stats.all} hint="Cała baza ofert" />
        <StatCard icon={Edit3} tone="orange" title="Szkice" value={stats.drafts} hint="W przygotowaniu" />
        <StatCard icon={Send} tone="purple" title="Wysłane" value={stats.sent} hint="Czekają na klienta" />
        <StatCard icon={Eye} tone="green" title="Zaakceptowane" value={stats.accepted} hint="Potwierdzone" />
        <StatCard icon={Trash2} tone="red" title="Odrzucone" value={stats.rejected} hint="Odrzucone przez klienta" />
      </section>

      <div className="admin-offers-search-toolbar">
        <button type="button" className={filtersOpen ? "admin-offers-filter-toggle active" : "admin-offers-filter-toggle"} onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} aria-controls="admin-offers-filters">
          <Search size={18} /> {filtersOpen ? "Ukryj filtry" : "Wyszukaj"}
          {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
        </button>
      </div>

      {filtersOpen && (
      <section id="admin-offers-filters" className="admin-offers-filters admin-offers-card">
        <label className="admin-offer-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj po numerze, temacie, kliencie lub opiekunie..." autoFocus /></label>
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Opiekun</span><select value={owner} onChange={(event) => setOwner(event.target.value)}><option value="ALL">Wszyscy</option>{owners.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label><span>Data od</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label><span>Data do</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        <button type="button" onClick={clearFilters}>Wyczyść</button>
      </section>
      )}

      <section className="admin-offers-table-card admin-offers-card">
        <div className="admin-offers-table-wrap">
          <table className="admin-offers-table">
            <thead>
              <tr>
                <th>Numer</th>
                <th>Temat</th>
                <th>Klient</th>
                <th>Opiekun</th>
                <th>Data</th>
                <th>Wartość netto</th>
                <th>Status</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {visibleOffers.map((offer) => (
                <tr key={offer.id} onClick={() => navigate(`/offers/${offer.id}`)}>
                  <td><strong>{offer.offer_number || `OF/${offer.id}`}</strong><small>{formatDate(offer.created_at)}</small></td>
                  <td>{offer.title || "-"}</td>
                  <td>{customerName(offer)}</td>
                  <td>{ownerName(offer)}</td>
                  <td>{formatDate(offerDate(offer))}</td>
                  <td>{money(offer.total_price ?? offer.totalNet, offer.currency)}</td>
                  <td><StatusBadge status={offer.status} /></td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <div className="admin-offer-actions">
                      <button type="button" onClick={() => navigate(`/offers/${offer.id}`)}><Eye size={16} /> Zobacz</button>
                      <button type="button" onClick={() => setOpenMenuId(openMenuId === offer.id ? null : offer.id)} aria-label="Menu akcji"><MoreVertical size={16} /></button>
                      {openMenuId === offer.id && (
                        <div className="admin-offer-menu">
                          <button type="button" onClick={() => navigate(`/offers/edit/${offer.id}`)}><Edit3 size={15} /> Edytuj</button>
                          <button type="button" onClick={() => downloadPdf(offer)}><Download size={15} /> Pobierz PDF</button>
                          <button type="button" onClick={() => duplicateOffer(offer)}><Copy size={15} /> Duplikuj</button>
                          <button type="button" className="danger" onClick={() => { setDeleteTarget(offer); setOpenMenuId(null); }}><Trash2 size={15} /> Usuń</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!visibleOffers.length && <tr><td colSpan="8" className="admin-empty">Brak ofert spełniających wybrane filtry.</td></tr>}
            </tbody>
          </table>
        </div>
        <footer className="admin-offers-pagination">
          <span>Wyświetlanie {resultStart}-{resultEnd} z {filteredOffers.length} ofert</span>
          <div>
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>
            <strong>{currentPage}</strong>
            <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              <option value={10}>10 / stronę</option>
              <option value={25}>25 / stronę</option>
              <option value={50}>50 / stronę</option>
            </select>
          </div>
        </footer>
      </section>

      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteOffer}
        title="Usuń ofertę"
        confirmText="Usuń"
      >
        <p>Usunąć ofertę <strong>{deleteTarget?.offer_number || deleteTarget?.id}</strong>? Tej operacji nie można cofnąć.</p>
      </ConfirmationModal>
    </div>
  );
}
