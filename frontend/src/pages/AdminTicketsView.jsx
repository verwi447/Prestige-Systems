import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  LayoutGrid,
  ListFilter,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Timer,
  UserCircle
} from "lucide-react";
import { tickets as ticketsAPI } from "../api";
import { showFeedback } from "../lib/feedback";
import { formatDateParts, normalizeLegacyStatus, priorityLabels, statusLabels, TicketBadge } from "../lib/ticketFormatting.jsx";
import "./MyTickets.css";

const adminTabs = [
  { id: "all", label: "Wszystkie" },
  { id: "new", label: "Nowe" },
  { id: "mine", label: "Moje" },
  { id: "unassigned", label: "Nieprzypisane" },
  { id: "completed", label: "Zakończone" }
];

const statusFilterLabels = {
  all: "Wszystkie",
  NEW: "Nowe",
  ACCEPTED: "Przyjęte",
  IN_PROGRESS: "W realizacji",
  WAITING_FOR_CLIENT: "Oczekuje na klienta",
  WAITING_FOR_PARTS: "Oczekuje na części",
  REJECTED: "Odrzucone",
  COMPLETED: "Zakończone",
  CANCELLED: "Anulowane"
};

const priorityFilterLabels = {
  all: "Wszystkie",
  LOW: "Niski",
  NORMAL: "Normalny",
  HIGH: "Wysoki",
  CRITICAL: "Krytyczny"
};

const minutesAgo = (value) => {
  const date = new Date(value || Date.now());
  const diff = Math.max(1, Math.floor((Date.now() - date.getTime()) / 60000));
  if (diff < 60) return `${diff} min temu`;
  if (diff < 1440) return `${Math.floor(diff / 60)} godz. temu`;
  return `${Math.floor(diff / 1440)} dni temu`;
};

const normalizeAdminTicket = (ticket, index = 0) => {
  const status = normalizeLegacyStatus(ticket.status);
  const priority = ticket.priority || (index % 5 === 0 ? "CRITICAL" : index % 3 === 0 ? "HIGH" : "NORMAL");
  const assignee = ticket.assigned_first_name
    ? {
        id: ticket.assigned_to_id,
        name: [ticket.assigned_first_name, ticket.assigned_last_name].filter(Boolean).join(" "),
        email: ticket.assigned_email,
        phone: ticket.assigned_phone
      }
    : null;
  const companyName = ticket.company_name || ticket.customer_name || (index % 2 ? "Green Park Sp. z o.o." : "NovaTest Solutions");
  const reporterName = [ticket.created_by_first_name, ticket.created_by_last_name].filter(Boolean).join(" ") || ticket.contact_name || "Adam Kowalski";
  return {
    ...ticket,
    number: ticket.number || ticket.ticket_number || `ZG/2026/${String(ticket.id || index + 1).padStart(3, "0")}`,
    title: ticket.title || ticket.subject || "Zgłoszenie serwisowe",
    companyName,
    siteName: ticket.siteName || ticket.object_name || "Parking Główny",
    siteAddress: [ticket.object_address, ticket.object_city].filter(Boolean).join(", "),
    status,
    priority,
    createdAt: ticket.createdAt || ticket.created_at,
    lastActivityAt: ticket.lastActivityAt || ticket.updated_at || ticket.last_comment_at || ticket.created_at,
    reporterName,
    reporterEmail: ticket.created_by_email || ticket.customer_email || "adam.kowalski@novatest.pl",
    reporterPhone: ticket.created_by_phone || ticket.contact_phone || ticket.customer_phone || "+48 500 000 000",
    assignee
  };
};

function AdminStatCard({ icon: Icon, tone, title, value, change }) {
  return (
    <article className={`admin-ticket-stat tone-${tone}`}>
      <span className={`admin-ticket-stat-icon ${tone}`}><Icon size={24} /></span>
      <div>
        <p>{title}</p>
        <strong>{value}</strong>
        <small>{change}</small>
      </div>
    </article>
  );
}

export default function AdminTicketsView() {
  const navigate = useNavigate();
  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }, []);
  const currentAdminName = [currentUser?.firstName || currentUser?.first_name, currentUser?.lastName || currentUser?.last_name].filter(Boolean).join(" ") || currentUser?.email || "";
  const [tickets, setTickets] = useState([]);
  const [assignableAdmins, setAssignableAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [viewMode, setViewMode] = useState("list");
  const [selectedId, setSelectedId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkStatus, setBulkStatus] = useState("ACCEPTED");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [selectedTicketDetails, setSelectedTicketDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [filters, setFilters] = useState({
    query: "",
    status: "all",
    priority: "all",
    company: "all",
    site: "all",
    assignee: "all",
    dateFrom: "",
    dateTo: ""
  });

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([ticketsAPI.getAll(), ticketsAPI.getAssignableAdmins()])
      .then(([response, adminsResponse]) => {
        if (!mounted) return;
        const normalized = (Array.isArray(response.data) ? response.data : []).map(normalizeAdminTicket);
        setTickets(normalized);
        setAssignableAdmins((adminsResponse.data || []).map((admin) => ({
          id: admin.id,
          name: [admin.first_name, admin.last_name].filter(Boolean).join(" ") || admin.email,
          email: admin.email,
          phone: admin.phone
        })));
        setSelectedId(null);
      })
      .catch((err) => {
        if (mounted) setError(err.response?.data?.error || "Nie udało się pobrać zgłoszeń.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  const companies = useMemo(() => [...new Set(tickets.map((ticket) => ticket.companyName).filter(Boolean))].sort(), [tickets]);
  const siteOptions = useMemo(() => [...new Set(tickets.map((ticket) => ticket.siteName).filter(Boolean))].sort(), [tickets]);
  const assigneeOptions = useMemo(() => [...new Set(assignableAdmins.map((admin) => admin.name).filter(Boolean))].sort(), [assignableAdmins]);
  const selectedTicket = tickets.find((ticket) => ticket.id === selectedId) || null;

  useEffect(() => {
    let active = true;
    if (!selectedId) {
      setSelectedTicketDetails(null);
      setDetailsLoading(false);
      return () => {
        active = false;
      };
    }

    setDetailsLoading(true);
    setSelectedTicketDetails(null);
    ticketsAPI.getById(selectedId)
      .then((response) => {
        if (active) setSelectedTicketDetails(response.data || null);
      })
      .catch(() => {
        if (active) setSelectedTicketDetails(null);
      })
      .finally(() => {
        if (active) setDetailsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedId, refreshKey]);

  const tabCounts = useMemo(() => ({
    all: tickets.length,
    new: tickets.filter((ticket) => ticket.status === "NEW").length,
    mine: tickets.filter((ticket) => ticket.assignee?.name === currentAdminName || ticket.assignee?.email === currentUser?.email).length,
    unassigned: tickets.filter((ticket) => !ticket.assignee).length,
    completed: tickets.filter((ticket) => ticket.status === "COMPLETED").length
  }), [currentAdminName, currentUser?.email, tickets]);

  const stats = useMemo(() => ({
    newTickets: tabCounts.new,
    inProgress: tickets.filter((ticket) => ticket.status === "IN_PROGRESS").length,
    waitingClient: tickets.filter((ticket) => ticket.status === "WAITING_FOR_CLIENT").length,
    closedToday: tickets.filter((ticket) => ticket.status === "COMPLETED" && new Date(ticket.updated_at || ticket.lastActivityAt).toDateString() === new Date().toDateString()).length
  }), [tabCounts, tickets]);

  const filteredTickets = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (activeTab === "new" && ticket.status !== "NEW") return false;
      if (activeTab === "mine" && ticket.assignee?.name !== currentAdminName && ticket.assignee?.email !== currentUser?.email) return false;
      if (activeTab === "unassigned" && ticket.assignee) return false;
      if (activeTab === "completed" && ticket.status !== "COMPLETED") return false;
      const haystack = [ticket.number, ticket.title, ticket.companyName, ticket.siteName, ticket.reporterName].join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (filters.status !== "all" && ticket.status !== filters.status) return false;
      if (filters.priority !== "all" && ticket.priority !== filters.priority) return false;
      if (filters.company !== "all" && ticket.companyName !== filters.company) return false;
      if (filters.site !== "all" && ticket.siteName !== filters.site) return false;
      if (filters.assignee === "unassigned" && ticket.assignee) return false;
      if (filters.assignee === "mine" && ticket.assignee?.name !== currentAdminName && ticket.assignee?.email !== currentUser?.email) return false;
      if (!["all", "unassigned", "mine"].includes(filters.assignee) && ticket.assignee?.name !== filters.assignee) return false;
      if (filters.dateFrom && new Date(ticket.createdAt) < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && new Date(ticket.createdAt) > new Date(`${filters.dateTo}T23:59:59`)) return false;
      return true;
    });
  }, [activeTab, currentAdminName, currentUser?.email, filters, tickets]);

  const pageCount = Math.max(1, Math.ceil(filteredTickets.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedTickets = filteredTickets.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const rangeStart = filteredTickets.length ? (currentPage - 1) * pageSize + 1 : 0;
  const rangeEnd = Math.min(currentPage * pageSize, filteredTickets.length);

  useEffect(() => {
    setPage(1);
  }, [activeTab, filters, pageSize]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab, filters, page, pageSize, viewMode]);

  const allPagedSelected = pagedTickets.length > 0 && pagedTickets.every((ticket) => selectedIds.has(ticket.id));
  const somePagedSelected = pagedTickets.some((ticket) => selectedIds.has(ticket.id));

  const toggleSelectAll = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPagedSelected) {
        pagedTickets.forEach((ticket) => next.delete(ticket.id));
      } else {
        pagedTickets.forEach((ticket) => next.add(ticket.id));
      }
      return next;
    });
  };

  const toggleSelectOne = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyBulkStatus = async () => {
    if (!selectedIds.size) return;
    setBulkApplying(true);
    try {
      const response = await ticketsAPI.bulkChangeStatus([...selectedIds], bulkStatus);
      const { updated = [], failed = [] } = response.data || {};
      if (updated.length) showFeedback({ message: `Zmieniono status ${updated.length} zgloszen(ia).`, type: "success" });
      if (failed.length) showFeedback({ message: `Nie udalo sie zmienic statusu ${failed.length} zgloszen(ia).`, type: "error" });
      setSelectedIds(new Set());
      setRefreshKey((value) => value + 1);
    } catch (error) {
      showFeedback({ message: error.response?.data?.error || "Nie udalo sie wykonac akcji zbiorczej.", type: "error" });
    } finally {
      setBulkApplying(false);
    }
  };

  const clearFilters = () => setFilters({ query: "", status: "all", priority: "all", company: "all", site: "all", assignee: "all", dateFrom: "", dateTo: "" });
  const activeFiltersCount = Object.entries(filters).filter(([key, value]) => key === "query" ? Boolean(value.trim()) : value !== "all" && value !== "").length;

  const exportFilteredTickets = () => {
    if (!filteredTickets.length) {
      showFeedback({ message: "Brak zgloszen do eksportu.", type: "warning" });
      return;
    }

    const escapeCsvValue = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["Numer", "Temat", "Firma", "Obiekt", "Priorytet", "Status", "Przypisany", "Utworzono", "Ostatnia aktywnosc"],
      ...filteredTickets.map((ticket) => [
        ticket.number,
        ticket.title,
        ticket.companyName,
        ticket.siteName,
        priorityLabels[ticket.priority] || ticket.priority,
        statusLabels[ticket.status] || ticket.status,
        ticket.assignee?.name || "Nieprzypisane",
        `${formatDateParts(ticket.createdAt).date} ${formatDateParts(ticket.createdAt).time}`.trim(),
        minutesAgo(ticket.lastActivityAt)
      ])
    ];
    const csvBody = rows.map((row) => row.map(escapeCsvValue).join(";")).join("\n");
    const blob = new Blob([String.fromCharCode(0xFEFF) + csvBody], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `zgloszenia-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showFeedback({ message: `Wyeksportowano ${filteredTickets.length} zgloszen do pliku CSV.`, type: "success" });
  };

  const changeTicketStatus = async (ticketId, status) => {
    try {
      await ticketsAPI.changeStatus(ticketId, status);
      setRefreshKey((value) => value + 1);
      showFeedback({ message: `Zmieniono status na: ${statusLabels[status] || status}.`, type: "success" });
    } catch (error) {
      showFeedback({ message: error.response?.data?.error || "Nie udalo sie zmienic statusu zgloszenia.", type: "error" });
    }
  };

  const assignTicketAdmin = async (ticketId, adminId) => {
    try {
      await ticketsAPI.assignAdmin(ticketId, adminId || null);
      setRefreshKey((value) => value + 1);
      showFeedback({ message: adminId ? "Zmieniono przypisanego administratora." : "Usunieto przypisanie administratora.", type: "success" });
    } catch (error) {
      showFeedback({ message: error.response?.data?.error || "Nie udalo sie zmienic przypisania.", type: "error" });
    }
  };

  return (
    <div className="page admin-tickets-page">
      <header className="admin-tickets-header">
        <div>
          <h1>Zgłoszenia</h1>
          <p>Zarządzaj zgłoszeniami serwisowymi klientów, przypisuj osoby odpowiedzialne i monitoruj status realizacji.</p>
        </div>
        <div className="admin-ticket-actions">
          <button className="admin-ticket-export" type="button" onClick={exportFilteredTickets}><Download size={17} /> Eksportuj</button>
          <div className="admin-ticket-view-switcher" role="group" aria-label="Zmien widok zgloszen">
            <button className={viewMode === "list" ? "active" : ""} type="button" onClick={() => setViewMode("list")} aria-label="Widok listy" aria-pressed={viewMode === "list"} title="Widok listy"><ListFilter size={17} /></button>
            <button className={viewMode === "kanban" ? "active" : ""} type="button" onClick={() => setViewMode("kanban")} aria-label="Widok kanban" aria-pressed={viewMode === "kanban"} title="Widok kanban"><LayoutGrid size={17} /></button>
          </div>
          <Link className="admin-ticket-primary" to="/tickets/new"><Plus size={18} /> Nowe zgłoszenie</Link>
        </div>
      </header>

      <section className="admin-ticket-stats-grid">
        <AdminStatCard icon={ClipboardList} tone="blue" title="Nowe zgłoszenia" value={stats.newTickets} change="↑ 3 od wczoraj" />
        <AdminStatCard icon={RefreshCcw} tone="navy" title="W realizacji" value={stats.inProgress} change="Bez zmian" />
        <AdminStatCard icon={Timer} tone="orange" title="Oczekuje na klienta" value={stats.waitingClient} change="↓ 1 od wczoraj" />
        <AdminStatCard icon={CheckCircle2} tone="green" title="Zamknięte dzisiaj" value={stats.closedToday} change="↑ 2 od wczoraj" />
      </section>

      <section className="admin-ticket-workspace">
        <div className="admin-ticket-main">
          <nav className="admin-ticket-tabs">
            {adminTabs.map((tab) => (
              <button key={tab.id} className={activeTab === tab.id ? "active" : ""} type="button" onClick={() => setActiveTab(tab.id)}>
                {tab.label} <span>{tabCounts[tab.id] || 0}</span>
              </button>
            ))}
          </nav>

          <div className={filtersOpen ? "admin-ticket-filters open" : "admin-ticket-filters"}>
            <button className="admin-filters-toggle" type="button" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}>
              <Search size={18} />
              <span>Filtry</span>
              {activeFiltersCount > 0 && <strong>{activeFiltersCount}</strong>}
            </button>
            {filtersOpen && (
              <div className="admin-ticket-filter-panel">
            <label>
              <span>Szukaj</span>
              <span className="admin-ticket-search">
                <Search size={18} />
                <input value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Nr, temat, klient" />
              </span>
            </label>
            <label><span>Status</span><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>{Object.entries(statusFilterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Priorytet</span><select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>{Object.entries(priorityFilterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Firma</span><select value={filters.company} onChange={(event) => setFilters({ ...filters, company: event.target.value })}><option value="all">Wszystkie</option>{companies.map((company) => <option key={company} value={company}>{company}</option>)}</select></label>
            <label><span>Obiekt</span><select value={filters.site} onChange={(event) => setFilters({ ...filters, site: event.target.value })}><option value="all">Wszystkie</option>{siteOptions.map((site) => <option key={site} value={site}>{site}</option>)}</select></label>
            <label><span>Przypisany</span><select value={filters.assignee} onChange={(event) => setFilters({ ...filters, assignee: event.target.value })}><option value="all">Wszystkie</option><option value="unassigned">Nieprzypisane</option><option value="mine">Moje</option>{assigneeOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label><span>Data od</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /></label>
            <label><span>Data do</span><input type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label>
            <button type="button" onClick={clearFilters}><RotateCcw size={16} /> Wyczyść filtry</button>
              </div>
            )}
          </div>

          {selectedIds.size > 0 && (
            <div className="bulk-actions-bar">
              <span className="bulk-actions-count">Wybrano {selectedIds.size} zgłoszeń</span>
              <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} disabled={bulkApplying}>
                {Object.entries(statusFilterLabels).filter(([value]) => value !== "all").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <button type="button" className="bulk-actions-apply" onClick={applyBulkStatus} disabled={bulkApplying}>
                {bulkApplying ? "Zapisywanie..." : "Zmień status"}
              </button>
              <button type="button" className="bulk-actions-clear" onClick={() => setSelectedIds(new Set())} disabled={bulkApplying}>Anuluj</button>
            </div>
          )}

          {loading ? (
            <div className="admin-ticket-state"><RefreshCcw size={28} /><h3>Ładowanie zgłoszeń...</h3></div>
          ) : error ? (
            <div className="admin-ticket-state error"><h3>{error}</h3><button type="button" onClick={() => window.location.reload()}>Spróbuj ponownie</button></div>
          ) : viewMode === "kanban" ? (
            <AdminTicketKanban tickets={filteredTickets} onSelect={setSelectedId} onOpen={(ticketId) => navigate(`/tickets/${ticketId}`)} selectedId={selectedId} />
          ) : filteredTickets.length ? (
            <>
              <div className="admin-ticket-table-scroll">
                <table className="admin-ticket-table">
                  <thead><tr><th className="admin-ticket-checkbox-col"><input type="checkbox" checked={allPagedSelected} ref={(el) => { if (el) el.indeterminate = !allPagedSelected && somePagedSelected; }} onChange={toggleSelectAll} aria-label="Zaznacz wszystkie" /></th><th>Numer</th><th>Temat</th><th>Klient / Firma</th><th>Obiekt</th><th>Priorytet</th><th>Status</th><th>Przypisany</th><th>Ostatnia aktywność</th></tr></thead>
                  <tbody>
                    {pagedTickets.map((ticket) => {
                      return (
                        <tr
                          key={ticket.id}
                          className={`${ticket.priority === "CRITICAL" ? "critical " : ""}${selectedId === ticket.id ? "selected" : ""}`.trim()}
                          onClick={() => setSelectedId(ticket.id)}
                          onDoubleClick={() => navigate(`/tickets/${ticket.id}`)}
                          title="Kliknij, aby otworzyć podgląd. Kliknij dwukrotnie, aby otworzyć szczegóły."
                        >
                          <td className="admin-ticket-checkbox-col" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.has(ticket.id)} onChange={() => toggleSelectOne(ticket.id)} aria-label={`Zaznacz zgłoszenie ${ticket.number}`} /></td>
                          <td className="admin-ticket-number-cell"><strong>{ticket.number}</strong><small>{formatDateParts(ticket.createdAt).date} {formatDateParts(ticket.createdAt).time}</small></td>
                          <td className="admin-ticket-title">
                            <div>{ticket.title}</div>
                            {ticket.ai_conversation_status && <TicketBadge kind="ai" value={ticket.ai_conversation_status} />}
                          </td>
                          <td className="admin-ticket-company-cell">{ticket.companyName}</td>
                          <td className="admin-ticket-site-cell">{ticket.siteName}</td>
                          <td><TicketBadge kind="priority" value={ticket.priority} /></td>
                          <td><TicketBadge kind="status" value={ticket.status} /></td>
                          <td>{ticket.assignee ? <span className="admin-assignee"><UserCircle size={18} /> {ticket.assignee.name}</span> : "Nieprzypisane"}</td>
                          <td className="admin-ticket-activity">{minutesAgo(ticket.lastActivityAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <footer className="tickets-pagination">
                <span>Wyświetlanie {rangeStart}-{rangeEnd} z {filteredTickets.length} zgłoszeń</span>
                <div><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /></button><strong>{currentPage}</strong><button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight size={16} /></button><select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={10}>10 / stronie</option><option value={20}>20 / stronie</option><option value={50}>50 / stronie</option></select></div>
              </footer>
            </>
          ) : (
            <div className="admin-ticket-state"><ClipboardList size={38} /><h3>Brak zgłoszeń</h3><p>Nie znaleziono żadnych zgłoszeń dla wybranych filtrów.</p><div><button type="button" onClick={clearFilters}>Wyczyść filtry</button><Link className="admin-ticket-primary" to="/tickets/new">Utwórz zgłoszenie</Link></div></div>
          )}
        </div>
        <AdminTicketPreview
          ticket={selectedTicket}
          details={selectedTicketDetails}
          detailsLoading={detailsLoading}
          admins={assignableAdmins}
          onClose={() => setSelectedId(null)}
          onStatusChange={changeTicketStatus}
          onAssign={assignTicketAdmin}
        />
      </section>
    </div>
  );
}

function AdminTicketKanban({ tickets, onSelect, onOpen, selectedId }) {
  const columns = [
    ["NEW", "Nowe"],
    ["ACCEPTED", "Przyjęte"],
    ["IN_PROGRESS", "W realizacji"],
    ["WAITING_FOR_CLIENT", "Oczekuje na klienta"],
    ["WAITING_FOR_PARTS", "Oczekuje na części"],
    ["COMPLETED", "Zakończone"],
    ["REJECTED", "Odrzucone"],
    ["CANCELLED", "Anulowane"]
  ];
  const visibleColumns = columns
    .map(([status, label]) => ({
      status,
      label,
      tickets: tickets.filter((ticket) => ticket.status === status)
    }))
    .filter((column) => column.tickets.length > 0);

  if (!visibleColumns.length) {
    return (
      <div className="admin-ticket-state admin-kanban-empty">
        <ClipboardList size={38} />
        <h3>Brak zgloszen w tym widoku</h3>
        <p>Zmien filtry albo wybierz inna zakladke, aby zobaczyc zgloszenia.</p>
      </div>
    );
  }

  return (
    <div className="admin-kanban" style={{ "--kanban-columns": visibleColumns.length || 1 }}>
      {visibleColumns.map(({ status, label, tickets: columnTickets }) => (
        <section className={`admin-kanban-column kanban-status-${status}`} key={status}>
          <header><strong>{label}</strong><span>{columnTickets.length}</span></header>
          <div>
            {columnTickets.map((ticket) => {
              return (
                <button key={ticket.id} className={`admin-kanban-card ticket-priority-${ticket.priority || "NORMAL"}${selectedId === ticket.id ? " active" : ""}`} type="button" onClick={() => onSelect(ticket.id)} onDoubleClick={() => onOpen(ticket.id)} title="Kliknij, aby otworzyć podgląd. Kliknij dwukrotnie, aby otworzyć szczegóły.">
                  <strong>{ticket.number}</strong>
                  <span>{ticket.title}</span>
                  <small>{ticket.companyName} · {ticket.siteName}</small>
                  {ticket.ai_conversation_status && <TicketBadge kind="ai" value={ticket.ai_conversation_status} />}
                  <span className="admin-kanban-card-meta"><TicketBadge kind="priority" value={ticket.priority || "NORMAL"} /><small>{minutesAgo(ticket.lastActivityAt)}</small></span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function AdminTicketPreview({ ticket, details, detailsLoading, admins = [], onClose, onStatusChange, onAssign }) {
  if (!ticket) {
    return (
      <aside className="admin-ticket-preview empty">
        <ClipboardList size={34} />
        <h2>Wybierz zgłoszenie</h2>
        <p>Kliknij wiersz w tabeli, aby zobaczyć szczegóły.</p>
      </aside>
    );
  }
  const latestComment = Array.isArray(details?.comments) ? details.comments[details.comments.length - 1] : null;
  return (
    <aside className="admin-ticket-preview">
      <header>
        <div>
          <span className="admin-ticket-preview-eyebrow">Szybki podglad</span>
          <h2>{ticket.number}</h2>
          <span className="admin-ticket-preview-badges"><TicketBadge kind="status" value={ticket.status} /><TicketBadge kind="priority" value={ticket.priority} />{ticket.ai_conversation_status && <TicketBadge kind="ai" value={ticket.ai_conversation_status} />}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Zamknij podglad" title="Zamknij podglad">×</button>
      </header>
      <h3>{ticket.title}</h3>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>
            <select className="admin-preview-select" value={ticket.status} onChange={(event) => onStatusChange?.(ticket.id, event.target.value)}>
              {Object.entries(statusFilterLabels).filter(([value]) => value !== "all").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </dd>
        </div>
        <div><dt>Priorytet</dt><dd><TicketBadge kind="priority" value={ticket.priority} /></dd></div>
        <div><dt>Klient / Firma</dt><dd>{ticket.companyName}</dd></div>
        <div><dt>Obiekt</dt><dd>{ticket.siteName}</dd></div>
        <div><dt>Zgłaszający</dt><dd>{ticket.reporterName}<small>{ticket.reporterEmail}</small><small>{ticket.reporterPhone}</small></dd></div>
        <div>
          <dt>Przypisany</dt>
          <dd>
            <select className="admin-preview-select" value={ticket.assignee?.id || ""} onChange={(event) => onAssign?.(ticket.id, event.target.value)}>
              <option value="">Nieprzypisane</option>
              {admins.map((admin) => <option key={admin.id} value={admin.id}>{admin.name}</option>)}
            </select>
            {ticket.assignee && <><small>{ticket.assignee.email}</small><small>{ticket.assignee.phone}</small></>}
          </dd>
        </div>
        <div><dt>Data utworzenia</dt><dd>{formatDateParts(ticket.createdAt).date} {formatDateParts(ticket.createdAt).time}</dd></div>
        <div><dt>Ostatnia aktywność</dt><dd>{minutesAgo(ticket.lastActivityAt)}</dd></div>
      </dl>
      <Link className="admin-open-ticket" to={`/tickets/${ticket.id}`}>Otwórz pełne zgłoszenie <ArrowRight size={17} /></Link>
      <section className="admin-preview-latest-comment">
        <h4>Ostatni komentarz</h4>
        {detailsLoading ? (
          <p className="admin-preview-comment-state">Ładowanie komentarza...</p>
        ) : latestComment ? (
          <article className={latestComment.isInternal ? "admin-preview-comment internal" : "admin-preview-comment"}>
            <div>
              <strong>{latestComment.authorName || "System"}</strong>
              <span>{minutesAgo(latestComment.createdAt)}{latestComment.isInternal ? " · Notatka wewnętrzna" : ""}</span>
            </div>
            <p>{latestComment.content}</p>
          </article>
        ) : (
          <p className="admin-preview-comment-state">Brak komentarzy.</p>
        )}
      </section>
      <footer>
        <strong>Historia</strong>
        <Link to={`/tickets/${ticket.id}`}>Zobacz pełną historię <ChevronRight size={16} /></Link>
      </footer>
    </aside>
  );
}
