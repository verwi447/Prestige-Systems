import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Building2,
  CheckCircle2,
  CircleAlert,
  ChevronRight,
  ClipboardList,
  FileText,
  Plus,
  Users,
  Wrench
} from "lucide-react";
import { client as clientAPI, dashboard as dashboardAPI } from "../api.js";
import AppState from "../components/AppState";
import DashboardGrid from "../components/DashboardGrid";
import { hasClientPermission, isClientOwner } from "../lib/permissions";
import { apiOrigin } from "../lib/runtimeConfig";
import "./Dashboard.css";

const API_ORIGIN = apiOrigin;

const money = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN"
});

const formatDate = (value) => {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pl-PL");
};

const formatDateTime = (value) => {
  if (!value) return "-";
  return new Date(value).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const publicUrl = (url) => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url}`;
};

const statusClass = (status = "") =>
  status
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const offerStatusLabels = {
  SZKIC: "Szkic",
  "WYS\u0141ANA": "Wys\u0142ana",
  "DO AKCEPTACJI": "Do akceptacji",
  ZAAKCEPTOWANA: "Zaakceptowana",
  ODRZUCONA: "Odrzucona",
  "W REALIZACJI": "W realizacji",
  "ZAKO\u0143CZONA": "Zako\u0144czona"
};

const ticketStatusLabels = {
  NEW: "Nowe",
  ACCEPTED: "Przyj\u0119te",
  IN_PROGRESS: "W realizacji",
  WAITING_FOR_CLIENT: "Oczekuje na klienta",
  WAITING_FOR_PARTS: "Oczekuje na cz\u0119\u015bci",
  REJECTED: "Odrzucone",
  COMPLETED: "Zako\u0144czone",
  CANCELLED: "Anulowane"
};

const ticketPriorityLabels = {
  LOW: "Niski",
  NORMAL: "Normalny",
  HIGH: "Wysoki",
  CRITICAL: "Krytyczny"
};

const statCards = [
  { key: "companies", label: "Firmy klientów", icon: "building", link: "/companies", linkText: "Zobacz wszystkie" },
  { key: "offersThisMonth", label: "Oferty w tym miesiącu", icon: "document", link: "/offers", linkText: "Zobacz wszystkie" },
  { key: "openTickets", label: "Otwarte zgłoszenia", icon: "ticket", link: "/tickets", linkText: "Zobacz wszystkie" },
  { key: "products", label: "Produkty w katalogu", icon: "catalog", link: "/products", linkText: "Zobacz katalog" },
  { key: "offersToSend", label: "Oferty do wysłania", icon: "send", link: "/offers", linkText: "Zobacz wszystkie" }
];

const quickActions = [
  { label: "Dodaj firmę", to: "/companies", icon: "building" },
  { label: "Nowa oferta", to: "/offers/new", icon: "document" },
  { label: "Nowe zgłoszenie", to: "/tickets/new", icon: "ticket" },
  { label: "Dodaj produkt", to: "/products", icon: "catalog" }
];

const iconPaths = {
  building: (
    <>
      <path d="M4.5 20V5.5h9V20" />
      <path d="M13.5 9H20v11" />
      <path d="M7.5 8h3M7.5 11.5h3M7.5 15h3M16.5 12h1M16.5 15h1" />
    </>
  ),
  catalog: (
    <>
      <path d="M5 7.5 12 4l7 3.5-7 3.5z" />
      <path d="M5 11.5 12 15l7-3.5" />
      <path d="M5 15.5 12 19l7-3.5" />
    </>
  ),
  document: (
    <>
      <path d="M6 3.5h8l4 4V20.5H6z" />
      <path d="M14 3.5v4h4M8.5 11h7M8.5 14.5h7M8.5 18h4" />
    </>
  ),
  ticket: (
    <>
      <path d="M4 8.5 15.5 4l4.5 11.5L8.5 20z" />
      <path d="M9 8.5h.01M11 13.5h.01M13 17.5h.01" />
    </>
  ),
  send: (
    <>
      <path d="M20.5 3.5 10.8 21l-1.9-7.9-7.4-3.6z" />
      <path d="m8.9 13.1 5-4.3" />
    </>
  )
};

function AdminIcon({ name }) {
  return (
    <span className={`admin-ui-icon ${name}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">{iconPaths[name]}</svg>
    </span>
  );
}

function StatusBadge({ value, type }) {
  const labels = type === "ticket" ? ticketStatusLabels : offerStatusLabels;
  const label = labels[value] || value || "-";
  return <span className={`admin-status ${statusClass(value)}`}>{label}</span>;
}

function AdminTable({ title, link, columns, children, emptyText, embedded = false }) {
  const table = (
    <div className="admin-table-shell">
      <table className="admin-table">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {children || (
            <tr>
              <td colSpan={columns.length} className="admin-empty">{emptyText}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  if (embedded) {
    return (
      <div className="admin-widget-table">
        {link && (
          <div className="admin-widget-link-row">
            <Link to={link}>Zobacz wszystkie <span aria-hidden="true">→</span></Link>
          </div>
        )}
        {table}
      </div>
    );
  }

  return (
    <section className="admin-panel-card">
      <div className="admin-section-header">
        <h2>{title}</h2>
        {link && <Link to={link}>Zobacz wszystkie <span aria-hidden="true">→</span></Link>}
      </div>
      {table}
    </section>
  );
}

function AdminAttentionPanel({ items = [], embedded = false }) {
  const icons = {
    ticket: Wrench,
    order: ClipboardList,
    offer: FileText
  };

  const summaryText = items.length
    ? `Pozostalo ${items.length} ${items.length === 1 ? "zadanie wymagajace" : "zadan wymagajacych"} dalszej pracy.`
    : "Wszystkie bieżące sprawy mają opiekuna.";

  const body = items.length ? (
    <div className="admin-attention-list">
      {items.map((item) => {
        const Icon = icons[item.kind] || CircleAlert;
        return (
          <Link className={`admin-attention-item tone-${item.tone || "info"}`} to={item.link} key={item.id}>
            <span className="admin-attention-icon"><Icon size={19} /></span>
            <span className="admin-attention-copy">
              <strong>{item.title}</strong>
              <span>{item.description}</span>
              <small>{item.companyName}{item.createdAt ? ` · ${formatDate(item.createdAt)}` : ""}</small>
            </span>
            <ChevronRight className="admin-attention-arrow" size={18} aria-hidden="true" />
          </Link>
        );
      })}
    </div>
  ) : (
    <div className="admin-attention-empty">Brak spraw wymagających przypisania lub wysłania oferty.</div>
  );

  if (embedded) {
    return (
      <div className="admin-widget-attention">
        <div className="admin-widget-attention-top">
          <p>{summaryText}</p>
          <Link to="/tickets">Przejdź do zgłoszeń</Link>
        </div>
        {body}
      </div>
    );
  }

  return (
    <section className="admin-panel-card admin-attention-panel" aria-labelledby="admin-attention-title">
      <div className="admin-section-header admin-attention-header">
        <div>
          <h2 id="admin-attention-title">Wymaga Twojej uwagi</h2>
          <p>{summaryText}</p>
        </div>
        <Link to="/tickets">Przejdź do zgłoszeń</Link>
      </div>
      {body}
    </section>
  );
}

function AdminDashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState({
    stats: {},
    recentOffers: [],
    recentTickets: [],
    recentCompanies: [],
    actionItems: []
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    dashboardAPI.getAdminSummary()
      .then((response) => setSummary(response.data || {
        stats: {},
        recentOffers: [],
        recentTickets: [],
        recentCompanies: [],
        actionItems: []
      }))
      .catch((error) => setMessage(error.response?.data?.error || "Nie udało się pobrać danych dashboardu."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page admin-dashboard-page"><AppState variant="loading" title="Ladowanie dashboardu" description="Pobieramy najnowsze dane operacyjne." /></div>;

  const widgets = [
    {
      id: "stats",
      title: "Statystyki",
      defaultLayout: { x: 0, y: 0, w: 12, h: 4, minW: 6, minH: 3 },
      content: (
        <div className="admin-stats-grid embedded">
          {statCards.map((card) => (
            <Link className="admin-stat-card" to={card.link} key={card.key}>
              <AdminIcon name={card.icon} />
              <div>
                <strong>{summary.stats?.[card.key] ?? 0}</strong>
                <span>{card.label}</span>
              </div>
              <small>{card.linkText} <span aria-hidden="true">→</span></small>
            </Link>
          ))}
        </div>
      )
    },
    {
      id: "attention",
      title: "Wymaga Twojej uwagi",
      defaultLayout: { x: 0, y: 4, w: 12, h: 4, minW: 6, minH: 3 },
      content: <AdminAttentionPanel items={summary.actionItems} embedded />
    },
    {
      id: "recentOffers",
      title: "Ostatnie oferty",
      defaultLayout: { x: 0, y: 8, w: 6, h: 7, minW: 4, minH: 4 },
      content: (
        <AdminTable
          embedded
          title="Ostatnie oferty"
          link="/offers"
          columns={["Numer oferty", "Firma", "Wartość netto", "Data utworzenia", "Status"]}
          emptyText="Brak ofert."
        >
          {summary.recentOffers?.length > 0 && summary.recentOffers.map((offer) => (
            <tr key={offer.id} onClick={() => navigate(`/offers/${offer.id}`)}>
              <td>{offer.offer_number || "-"}</td>
              <td>{offer.company_name || "-"}</td>
              <td>{money.format(Number(offer.total_price || 0))}</td>
              <td>{formatDate(offer.created_at)}</td>
              <td><StatusBadge value={offer.status} type="offer" /></td>
            </tr>
          ))}
        </AdminTable>
      )
    },
    {
      id: "recentTickets",
      title: "Ostatnie zgłoszenia",
      defaultLayout: { x: 6, y: 8, w: 6, h: 7, minW: 4, minH: 4 },
      content: (
        <AdminTable
          embedded
          title="Ostatnie zgłoszenia"
          link="/tickets"
          columns={["Numer", "Firma", "Obiekt", "Status"]}
          emptyText="Brak zgłoszeń."
        >
          {summary.recentTickets?.length > 0 && summary.recentTickets.map((ticket) => (
            <tr
              key={ticket.id}
              role="link"
              tabIndex={0}
              onClick={() => navigate(`/tickets/${ticket.id}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigate(`/tickets/${ticket.id}`);
                }
              }}
            >
              <td>{ticket.ticket_number || "-"}</td>
              <td>{ticket.company_name || "-"}</td>
              <td>{ticket.object_name || "-"}</td>
              <td><StatusBadge value={ticket.status} type="ticket" /></td>
            </tr>
          ))}
        </AdminTable>
      )
    },
    {
      id: "recentCompanies",
      title: "Ostatnio dodane firmy",
      defaultLayout: { x: 0, y: 15, w: 8, h: 6, minW: 6, minH: 4 },
      content: (
        <AdminTable
          embedded
          title="Ostatnio dodane firmy"
          link="/companies"
          columns={["Nazwa firmy", "NIP", "Miasto", "Email", "Data dodania"]}
          emptyText="Brak firm."
        >
          {summary.recentCompanies?.length > 0 && summary.recentCompanies.map((company) => (
            <tr key={company.id} onClick={() => navigate(`/companies/${company.id}`)}>
              <td>{company.name}</td>
              <td>{company.nip || "-"}</td>
              <td>{company.city || "-"}</td>
              <td>{company.email || "-"}</td>
              <td>{formatDate(company.created_at)}</td>
            </tr>
          ))}
        </AdminTable>
      )
    },
    {
      id: "quickActions",
      title: "Szybkie akcje",
      defaultLayout: { x: 8, y: 15, w: 4, h: 6, minW: 3, minH: 3 },
      content: (
        <div className="quick-actions-list">
          {quickActions.map((action) => (
            <Link to={action.to} key={action.label} className="quick-action">
              <AdminIcon name={action.icon} />
              <span>{action.label}</span>
              <strong aria-hidden="true">→</strong>
            </Link>
          ))}
        </div>
      )
    }
  ];

  return (
    <div className="page admin-dashboard-page">
      <div className="admin-dashboard-title">
        <div>
          <span>Centrum zarządzania</span>
          <h1>Dashboard</h1>
        </div>
      </div>

      {message && <div className="settings-message">{message}</div>}

      <DashboardGrid storageKey="ps-hub-admin-dashboard-layout" widgets={widgets} />
    </div>
  );
}

const clientStatConfig = [
  { key: "sitesCount", title: "Moje obiekty", subtitle: "Wszystkie aktywne", tone: "green", icon: Building2 },
  { key: "employeesCount", title: "Pracowników", subtitle: "Aktywni użytkownicy", tone: "blue", icon: Users },
  { key: "offersCount", title: "Oferty", subtitleKey: "offersToAcceptCount", tone: "orange", icon: FileText },
  { key: "openTicketsCount", title: "Otwarte zgłoszenia", subtitle: "Wymagają uwagi", tone: "red", icon: Wrench }
];

const clientQuickActions = [
  { title: "Nowe zgłoszenie", desc: "Zgłoś awarię lub potrzebę", to: "/client/tickets/new", tone: "green", icon: Plus, permission: "CREATE_TICKET" },
  { title: "Dodaj pracownika", desc: "Zaproś nowego użytkownika", to: "/client/employees/new", tone: "blue", icon: Users, ownerOnly: true },
  { title: "Zobacz oferty", desc: "Przeglądaj i akceptuj", to: "/client/offers", tone: "orange", icon: FileText, permission: "VIEW_OFFERS" },
  { title: "Katalog produktów", desc: "Zobacz dostępne produkty", to: "/client/catalog", tone: "purple", icon: BookOpen, permission: "VIEW_CATALOG" }
];

function ClientDashboard({ user }) {
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    clientAPI.dashboard()
      .then((response) => setDashboardData(response.data))
      .catch((error) => setMessage(error.response?.data?.error || "Nie udało się pobrać danych panelu klienta."))
      .finally(() => setLoading(false));
  }, []);

  const firstName = dashboardData?.user?.firstName || user?.firstName || user?.first_name || user?.username || "Jan";
  const stats = dashboardData?.stats || {};
  const recentTickets = dashboardData?.recentTickets || [];
  const offersToAccept = dashboardData?.offersToAccept || [];
  const sites = dashboardData?.sites || [];
  const recentActivity = dashboardData?.recentActivity || [];
  const canViewTickets = hasClientPermission(user, "VIEW_TICKETS");
  const canViewOffers = hasClientPermission(user, "VIEW_OFFERS");

  if (loading) return <div className="page client-dashboard-page"><AppState variant="loading" title="Ladowanie panelu firmy" description="Pobieramy najwazniejsze informacje o Twojej firmie." /></div>;

  return (
    <div className="page client-dashboard-page">
      <div className="client-welcome">
        <h1>Witaj, {firstName}!</h1>
        <p>Poniżej znajdziesz najważniejsze informacje o Twojej firmie.</p>
      </div>

      {message && <div className="settings-message">{message}</div>}

      <section className="client-stats-row" aria-label="Statystyki firmy">
        {clientStatConfig.filter((item) => (
          (item.key !== "openTicketsCount" || canViewTickets)
          && (item.key !== "offersCount" || canViewOffers)
        )).map((item) => {
          const Icon = item.icon;
          const subtitle = item.subtitleKey ? `Do akceptacji: ${stats[item.subtitleKey] ?? 0}` : item.subtitle;
          return (
            <article className="client-stat-card" key={item.key}>
              <span className={`client-stat-icon ${item.tone}`}><Icon size={28} /></span>
              <div>
                <strong>{stats[item.key] ?? 0}</strong>
                <h2>{item.title}</h2>
                <p>{subtitle}</p>
              </div>
            </article>
          );
        })}
      </section>

      <div className="client-dashboard-grid">
        <section className="client-panel-card wide" style={{ display: canViewTickets ? undefined : "none" }}>
          <div className="client-section-header">
            <h2>Ostatnie zgłoszenia</h2>
            <Link to="/client/tickets">Zobacz wszystkie</Link>
          </div>
          <div className="client-table-shell">
            <table className="client-table tickets-table">
              <thead>
                <tr>
                  <th>Numer</th>
                  <th>Tytuł</th>
                  <th>Obiekt</th>
                  <th>Status</th>
                  <th>Priorytet</th>
                  <th>Ostatnia aktywność</th>
                </tr>
              </thead>
              <tbody>
                {recentTickets.length ? recentTickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>{ticket.number || "-"}</td>
                    <td>{ticket.title || "-"}</td>
                    <td>{ticket.siteName || "-"}</td>
                    <td><span className={`client-badge status-${statusClass(ticket.status || "NEW")}`}>{ticketStatusLabels[ticket.status] || ticket.status || "Nowe"}</span></td>
                    <td><span className={`client-badge priority-${statusClass(ticket.priority || "NORMAL")}`}>{ticketPriorityLabels[ticket.priority] || ticket.priority || "Normalny"}</span></td>
                    <td>{formatDateTime(ticket.lastActivityAt)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan="6" className="client-empty">Brak zgłoszeń.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="client-panel-card" style={{ display: canViewOffers ? undefined : "none" }}>
          <div className="client-section-header">
            <h2>Oferty do akceptacji</h2>
            <Link to="/client/offers">Zobacz wszystkie</Link>
          </div>
          <div className="client-table-shell compact">
            <table className="client-table offers-table">
              <thead>
                <tr>
                  <th>Numer</th>
                  <th>Tytuł</th>
                  <th>Ważna do</th>
                  <th>Wartość netto</th>
                </tr>
              </thead>
              <tbody>
                {offersToAccept.length ? offersToAccept.map((offer) => (
                  <tr key={offer.id}>
                    <td>{offer.number || "-"}</td>
                    <td>{offer.title || "-"}</td>
                    <td className="danger-date">{formatDate(offer.validUntil)}</td>
                    <td>{money.format(Number(offer.totalNet || 0))}</td>
                  </tr>
                )) : (
                  <tr><td colSpan="4" className="client-empty">Brak ofert do akceptacji.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Link className="client-outline-button" to="/client/offers">
            <ClipboardList size={16} />
            Zobacz wszystkie oferty
          </Link>
        </section>

        <section className="client-panel-card wide">
          <div className="client-section-header">
            <h2>Moje obiekty</h2>
            <Link to="/client/sites">Zobacz wszystkie</Link>
          </div>
          <div className="client-sites-grid">
            {sites.length ? sites.map((site) => (
              <article className="client-site-card" key={site.id}>
                {site.imageUrl ? (
                  <img className="site-image" src={publicUrl(site.imageUrl)} alt={site.name || "Zdjęcie obiektu"} />
                ) : (
                  <div className="site-image site-image-placeholder">
                    <Building2 size={28} />
                  </div>
                )}
                <h3>{site.name}</h3>
                <p>{site.address || "Adres nieuzupełniony"}</p>
                <p>{[site.postalCode, site.city].filter(Boolean).join(" ") || "-"}</p>
                <span><CheckCircle2 size={12} /> {site.status || "Aktywny"}</span>
                <small>Otwarte zgłoszenia: {site.openTicketsCount ?? 0}</small>
              </article>
            )) : (
              <div className="client-empty site-empty">Brak obiektów dla Twojej firmy.</div>
            )}
          </div>
        </section>

        <section className="client-panel-card">
          <div className="client-section-header">
            <h2>Szybkie akcje</h2>
          </div>
          <div className="client-actions-grid">
            {clientQuickActions.filter((action) => (
              (!action.ownerOnly || isClientOwner(user))
              && (!action.permission || hasClientPermission(user, action.permission))
            )).map((action) => {
              const Icon = action.icon;
              return (
                <Link className="client-action-card" to={action.to} key={action.title}>
                  <span className={`client-action-icon ${action.tone}`}><Icon size={22} /></span>
                  <span>
                    <strong>{action.title}</strong>
                    <small>{action.desc}</small>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="client-panel-card wide">
          <div className="client-section-header">
            <h2>Ostatnia aktywność</h2>
          </div>
          <div className="client-activity-list">
            {recentActivity.length ? recentActivity.map((activity) => (
              <article key={`${activity.type}-${activity.id}`}>
                <span className={`activity-icon ${activity.type === "offer" ? "orange" : "red"}`}>
                  {activity.type === "offer" ? <FileText size={16} /> : <Wrench size={16} />}
                </span>
                <p>{activity.title}</p>
                <time>{formatDateTime(activity.timestamp)}</time>
              </article>
            )) : (
              <div className="client-empty">Brak ostatniej aktywności.</div>
            )}
          </div>
        </section>

        <section className="client-panel-card info-card">
          <div className="client-section-header">
            <h2>Informacje</h2>
          </div>
          <div className="client-info-empty">Dodatkowe informacje będą widoczne tutaj.</div>
        </section>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    if (!storedUser) return;
    try {
      setUser(JSON.parse(storedUser));
    } catch (error) {
      console.error("Błąd odczytu danych użytkownika.", error);
    }
  }, []);

  if (!user) return <div className="page">Ładowanie...</div>;
  return user.role === "ADMIN" ? <AdminDashboard /> : <ClientDashboard user={user} />;
}
