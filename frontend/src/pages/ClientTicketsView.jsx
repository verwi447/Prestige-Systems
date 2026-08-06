import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Cpu,
  Headphones,
  Monitor,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  ShoppingCart
} from "lucide-react";
import { client as clientAPI, objects as objectsAPI, tickets as ticketsAPI } from "../api";
import { hasClientPermission } from "../lib/permissions";
import { formatDateParts, normalizeLegacyStatus, normalizeLegacyType, statusLabels, typeLabels, TicketBadge } from "../lib/ticketFormatting.jsx";
import "./MyTickets.css";

const typeIcons = {
  SYSTEM_FAILURE: Monitor,
  HARDWARE_FAILURE: Cpu,
  ORDER: ShoppingCart
};

function TicketStat({ icon: Icon, tone, value, title, subtitle }) {
  return (
    <article className="ticket-stat-card">
      <span className={`ticket-stat-icon ${tone}`}><Icon size={24} /></span>
      <div>
        <strong>{value}</strong>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </article>
  );
}

function TicketType({ type }) {
  const Icon = typeIcons[type] || ClipboardList;
  return (
    <span className={`ticket-type type-${type || "OTHER"}`}>
      <Icon size={17} />
      {typeLabels[type] || type || "-"}
    </span>
  );
}

function DateCell({ value }) {
  const parts = formatDateParts(value);
  return (
    <span className="ticket-date-cell">
      <strong>{parts.date}</strong>
      <small>{parts.time}</small>
    </span>
  );
}

export default function ClientTicketsView({ scope = "tickets", user }) {
  const navigate = useNavigate();
  const isAdmin = false;
  const isOrders = scope === "orders";
  const canCreate = hasClientPermission(user, "CREATE_TICKET") && (!isOrders || hasClientPermission(user, "VIEW_CATALOG"));
  const [tickets, setTickets] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ query: "", status: "all", type: "all", site: "all" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [ticketsRes, sitesRes] = await Promise.all([
          isAdmin ? ticketsAPI.getAll() : clientAPI.tickets(scope),
          isAdmin ? objectsAPI.getAll() : clientAPI.companySites()
        ]);
        if (!mounted) return;
        const normalizedTickets = (Array.isArray(ticketsRes.data) ? ticketsRes.data : []).map((ticket) => ({
          ...ticket,
          number: ticket.number || ticket.ticket_number,
          title: ticket.title || ticket.subject,
          siteId: ticket.siteId || ticket.object_id,
          siteName: ticket.siteName || ticket.object_name,
          status: normalizeLegacyStatus(ticket.status),
          type: normalizeLegacyType(ticket.type),
          priority: ticket.priority || "NORMAL",
          createdAt: ticket.createdAt || ticket.created_at,
          lastActivityAt: ticket.lastActivityAt || ticket.updated_at || ticket.created_at
        }));
        const normalizedSites = (Array.isArray(sitesRes.data) ? sitesRes.data : []).map((site) => ({
          ...site,
          name: site.name || site.object_name
        }));
        setTickets(normalizedTickets);
        setSites(normalizedSites);
      } catch (err) {
        if (!mounted) return;
        setError(err.response?.status === 403 ? "Brak dostepu do zgloszen." : "Nie udalo sie pobrac zgloszen.");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [isAdmin, scope]);

  const stats = useMemo(() => ({
    all: tickets.length,
    open: tickets.filter((ticket) => !["REJECTED", "COMPLETED", "CANCELLED"].includes(ticket.status)).length,
    inProgress: tickets.filter((ticket) => ticket.status === "IN_PROGRESS").length,
    completed: tickets.filter((ticket) => ticket.status === "COMPLETED").length
  }), [tickets]);

  const filteredTickets = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const haystack = [ticket.number, ticket.ticket_number, ticket.title, ticket.subject, ticket.siteName, ticket.siteAddress].join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (filters.status !== "all" && ticket.status !== filters.status) return false;
      if (filters.type !== "all" && ticket.type !== filters.type) return false;
      if (filters.site !== "all" && String(ticket.siteId) !== String(filters.site)) return false;
      return true;
    });
  }, [filters, tickets]);

  const pageCount = Math.max(1, Math.ceil(filteredTickets.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedTickets = filteredTickets.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const rangeStart = filteredTickets.length ? (currentPage - 1) * pageSize + 1 : 0;
  const rangeEnd = Math.min(currentPage * pageSize, filteredTickets.length);

  useEffect(() => {
    setPage(1);
  }, [filters, pageSize]);

  const clearFilters = () => setFilters({ query: "", status: "all", type: "all", site: "all" });
  const activeFiltersCount = Object.entries(filters).filter(([key, value]) => key === "query" ? Boolean(value.trim()) : value !== "all").length;
  const ticketPath = (ticketId) => (isAdmin ? `/tickets/${ticketId}` : isOrders ? `/client/orders/${ticketId}` : `/client/tickets/${ticketId}`);
  const entityLabel = isOrders ? "zamówień" : "zgłoszeń";
  const createPath = isOrders ? "/client/orders/new" : "/client/tickets/new";

  return (
    <div className="page client-tickets-page">
      <header className="tickets-page-header">
        <div>
          <h1>{isOrders ? "Zamówienia" : isAdmin ? "Zgloszenia" : "Moje zgloszenia"}</h1>
          <p>{isOrders ? "Przeglądaj zamówienia produktów dla swojej firmy." : isAdmin ? "Przegladaj zgloszenia serwisowe wszystkich klientow." : "Śledź awarie i zgłoszenia serwisowe swojej firmy."}</p>
        </div>
        {!isAdmin && canCreate && <Link className="tickets-primary-button" to={createPath}><Plus size={18} /> {isOrders ? "Nowe zamówienie" : "Nowe zgloszenie"}</Link>}
      </header>

      <section className="ticket-stats-grid">
        <TicketStat icon={ClipboardList} tone="blue" value={stats.all} title={isOrders ? "Wszystkie zamówienia" : "Wszystkie zgloszenia"} subtitle={isOrders ? "Łącznie zamówień" : "Lacznie zgloszen"} />
        <TicketStat icon={Headphones} tone="green" value={stats.open} title={isOrders ? "Aktywne" : "Otwarte"} subtitle={isOrders ? "W toku obsługi" : "Niezakonczone zgloszenia"} />
        <TicketStat icon={RefreshCcw} tone="orange" value={stats.inProgress} title="W realizacji" subtitle="Aktualnie realizowane" />
        <TicketStat icon={Archive} tone="purple" value={stats.completed} title={isOrders ? "Zrealizowane" : "Zakonczone"} subtitle={isOrders ? "Zakończone zamówienia" : "Zamkniete zgloszenia"} />
      </section>

      <div className="tickets-search-toolbar">
        <button type="button" className={filtersOpen ? "tickets-search-toggle active" : "tickets-search-toggle"} onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}>
          <Search size={18} /> {filtersOpen ? "Ukryj filtry" : "Wyszukaj"}
          {activeFiltersCount > 0 && <strong>{activeFiltersCount}</strong>}
        </button>
      </div>

      {filtersOpen && (
        <section className="tickets-filter-card">
          <label className="tickets-search">
            <Search size={18} />
            <input value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Szukaj po numerze, tytule lub obiekcie..." autoFocus />
          </label>
          <label><span>Status</span><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="all">Wszystkie</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          {!isOrders && <label><span>Typ</span><select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
            <option value="all">Wszystkie</option>
            {Object.entries(typeLabels).filter(([value]) => value !== "ORDER").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>}
          <label><span>Obiekt</span><select value={filters.site} onChange={(event) => setFilters({ ...filters, site: event.target.value })}>
            <option value="all">Wszystkie obiekty</option>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select></label>
          <button type="button" onClick={clearFilters}><RotateCcw size={16} /> Wyczysc filtry</button>
        </section>
      )}

      <section className="tickets-table-card">
        {loading ? (
          <div className="tickets-state"><RefreshCcw size={28} /><h3>Ladowanie zgloszen...</h3></div>
        ) : error ? (
          <div className="tickets-state error"><h3>{error}</h3><button type="button" onClick={() => window.location.reload()}>Sprobuj ponownie</button></div>
        ) : filteredTickets.length ? (
          <>
            <div className="tickets-table-scroll">
              <table className="tickets-table">
                <thead>
                  <tr>
                    <th>Numer</th>
                    {!isOrders && <th>Typ</th>}
                    <th>Tytul</th>
                    <th>Obiekt</th>
                    <th>Status</th>
                    <th>Priorytet</th>
                    <th>Data utworzenia</th>
                    <th>Ostatnia aktywnosc</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTickets.map((ticket) => (
                    <tr key={ticket.id} onClick={() => navigate(ticketPath(ticket.id))}>
                      <td><strong className="ticket-number">{ticket.number || ticket.ticket_number}</strong><small>#{ticket.id}</small></td>
                      {!isOrders && <td><TicketType type={ticket.type} /></td>}
                      <td className="ticket-title-cell">{ticket.title || ticket.subject}</td>
                      <td><strong>{ticket.siteName || "-"}</strong><small>{ticket.siteAddress || ""}</small></td>
                      <td><TicketBadge kind="status" value={ticket.status} /></td>
                      <td><TicketBadge kind="priority" value={ticket.priority || "NORMAL"} /></td>
                      <td><DateCell value={ticket.createdAt || ticket.created_at} /></td>
                      <td><DateCell value={ticket.lastActivityAt || ticket.updated_at} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="tickets-pagination">
              <span>Wyswietlanie {rangeStart}-{rangeEnd} z {filteredTickets.length} {entityLabel}</span>
              <div>
                <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /></button>
                <strong>{currentPage}</strong>
                {pageCount > 1 && <button type="button" onClick={() => setPage(Math.min(pageCount, currentPage + 1))}>{Math.min(pageCount, currentPage + 1)}</button>}
                <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight size={16} /></button>
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                  <option value={10}>10 / strone</option>
                  <option value={20}>20 / strone</option>
                  <option value={50}>50 / strone</option>
                </select>
              </div>
            </footer>
          </>
        ) : (
          <div className="tickets-empty-state">
            <ClipboardList size={42} />
            <h3>{isOrders ? "Brak zamówień" : "Brak zgloszen"}</h3>
            <p>{isOrders ? "Utwórz pierwsze zamówienie z dostępnych produktów." : "Utwórz pierwsze zgłoszenie, aby skontaktować się z serwisem."}</p>
            {canCreate && <Link className="tickets-primary-button" to={createPath}><Plus size={18} /> {isOrders ? "Nowe zamówienie" : "Nowe zgloszenie"}</Link>}
          </div>
        )}
      </section>

    </div>
  );
}
