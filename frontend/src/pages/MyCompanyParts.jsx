import { Link } from "react-router-dom";
import {
  Building2,
  CheckCircle2,
  Edit3,
  FileText,
  Image as ImageIcon,
  KeyRound,
  MoreVertical,
  Upload,
  Users,
  Wrench,
  X
} from "lucide-react";
import { apiOrigin } from "../lib/runtimeConfig";

const API_ORIGIN = apiOrigin;

export const MAX_SITE_IMAGE_SIZE = 5 * 1024 * 1024;
export const SITE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const tabs = [
  { id: "overview", label: "Przegląd" },
  { id: "data", label: "Dane firmy" },
  { id: "employees", label: "Pracownicy" },
  { id: "sites", label: "Obiekty" },
  { id: "documents", label: "Dane do dokumentów" },
  { id: "activity", label: "Aktywność" }
];

export const emptyCompanyForm = { email: "", phone: "", address: "", postalCode: "", city: "", contactPersonName: "" };
export const emptyEmployeeForm = { id: null, firstName: "", lastName: "", email: "", phone: "", password: "", isActive: true, permissions: [] };
export const emptySiteForm = {
  id: null,
  name: "",
  address: "",
  postalCode: "",
  city: "",
  country: "Polska",
  description: "",
  isActive: true,
  imageFile: null,
  imagePreview: "",
  existingImageUrl: "",
  removeImage: false
};

export const permissionOptions = [
  { key: "CREATE_TICKET", title: "Tworzenie zgłoszeń", description: "Może tworzyć nowe zgłoszenia serwisowe." },
  { key: "VIEW_TICKETS", title: "Podgląd zgłoszeń", description: "Może przeglądać zgłoszenia swojej firmy." },
  { key: "COMMENT_TICKET", title: "Komentowanie zgłoszeń", description: "Może dodawać komentarze do zgłoszeń." },
  { key: "VIEW_OFFERS", title: "Podgląd ofert", description: "Może przeglądać oferty firmy." },
  { key: "ACCEPT_OFFERS", title: "Akceptacja ofert", description: "Może akceptować lub odrzucać oferty." },
  { key: "VIEW_CATALOG", title: "Podgląd katalogu", description: "Może przeglądać katalog produktów." },
  { key: "MANAGE_SITES", title: "Zarządzanie obiektami", description: "Może zarządzać obiektami firmy." }
];

export const formatDate = (value) => value ? new Date(value).toLocaleDateString("pl-PL") : "-";
export const formatDateTime = (value) => value ? new Date(value).toLocaleString("pl-PL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
}) : "-";

export const formatLastLogin = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Dzisiaj, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Wczoraj, ${time}`;
  return date.toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const plural = (count, one, few, many) => {
  if (count === 1) return one;
  const last = count % 10;
  const lastTwo = count % 100;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few;
  return many;
};

export const publicUrl = (url) => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url}`;
};

export const initials = (firstName, lastName, fallback = "U") => {
  const source = [firstName, lastName].filter(Boolean).join(" ") || fallback;
  return source.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "U";
};

export const roleLabel = (role) => role === "CLIENT_OWNER" ? "Właściciel konta" : "Pracownik";
export const siteActive = (site) => site.isActive !== false && !/^nie/i.test(site.status || "");
export const legacyEmployeeUiEnabled = false;

export function Field({ label, value, note }) {
  return (
    <div className="company-field">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

export function StatCard({ icon: Icon, tone, value, title, subtitle }) {
  return (
    <article className="company-stat-card">
      <span className={`company-stat-icon ${tone}`}><Icon size={27} /></span>
      <div>
        <strong>{value ?? 0}</strong>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </article>
  );
}

export function SiteImage({ site, large = false }) {
  if (site?.imageUrl) {
    return <img className={large ? "site-card-image large" : "site-card-image"} src={publicUrl(site.imageUrl)} alt={site.name || "Zdjęcie obiektu"} />;
  }
  return (
    <div className={large ? "site-image-placeholder large" : "site-image-placeholder"}>
      <Building2 size={large ? 42 : 28} />
    </div>
  );
}

export function SiteMiniCard({ site }) {
  return (
    <article className="company-site-card">
      <SiteImage site={site} />
      <h3>{site.name}</h3>
      <p>{site.address || "Adres nieuzupełniony"}</p>
      <p>{[site.postalCode, site.city].filter(Boolean).join(" ") || "-"}</p>
      <span><CheckCircle2 size={12} /> {siteActive(site) ? "Aktywny" : "Nieaktywny"}</span>
      <small>Otwarte zgłoszenia: {site.openTicketsCount ?? 0}</small>
      <small><Users size={12} /> {site.assignedEmployeeCount ?? 0} pracowników</small>
    </article>
  );
}

export function SiteManagementCard({ site, onEdit, onAssign, canManageSites, canManageEmployees, canViewTickets }) {
  return (
    <article className="site-management-card">
      <div className="site-card-top">
        <SiteImage site={site} large />
        <div className="site-card-content">
          <div className="site-card-title-row">
            <h3>{site.name}</h3>
            <button className="company-icon-button" type="button" aria-label="Akcje"><MoreVertical size={18} /></button>
          </div>
          <p>{site.address || "-"}</p>
          <p>{[site.postalCode, site.city].filter(Boolean).join(" ") || "-"}</p>
          <span className={siteActive(site) ? "site-status active" : "site-status inactive"}>{siteActive(site) ? "Aktywny" : "Nieaktywny"}</span>
        </div>
      </div>
      <div className="site-card-metrics">
        <div><Users size={18} /><strong>{site.assignedEmployeeCount ?? 0}</strong><span>Pracowników</span></div>
        <div><Wrench size={18} /><strong>{site.openTicketsCount ?? 0}</strong><span>Otwarte zgłoszenia</span></div>
      </div>
      <div className={`site-card-actions ${canManageSites ? "can-manage-sites" : ""} ${canManageEmployees ? "can-manage-employees" : ""} ${canViewTickets ? "can-view-tickets" : ""}`}>
        <button type="button" onClick={() => onEdit(site)}><Edit3 size={15} /> Edytuj</button>
        <button type="button" onClick={() => onAssign(site)}><Users size={15} /> Przypisz pracowników</button>
        <Link to={`/client/tickets?siteId=${site.id}`}><Wrench size={15} /> Zobacz zgłoszenia</Link>
      </div>
    </article>
  );
}

export function EmployeeRow({ employee, compact = false, onToggle }) {
  const active = employee.isActive !== false;
  return (
    <div className={compact ? "company-employee-item compact" : "company-employee-item"}>
      <span className="company-avatar">{initials(employee.firstName, employee.lastName, employee.email)}</span>
      <div className="company-employee-main">
        <strong>{[employee.firstName, employee.lastName].filter(Boolean).join(" ") || employee.email}</strong>
        <small>{employee.email || "-"}</small>
      </div>
      <span className="company-role-badge">{roleLabel(employee.role)}</span>
      <span className={active ? "company-active-dot" : "company-inactive-dot"}>{active ? "Aktywny" : "Nieaktywny"}</span>
      {compact ? (
        <button className="company-icon-button" type="button" aria-label="Akcje"><MoreVertical size={18} /></button>
      ) : (
        <div className="company-row-actions">
          <button type="button">Edytuj</button>
          {employee.role === "CLIENT_EMPLOYEE" && <button type="button" onClick={() => onToggle?.(employee)}>{active ? "Dezaktywuj" : "Aktywuj"}</button>}
          <button type="button">Resetuj hasło</button>
          <button type="button">Przypisz do obiektów</button>
        </div>
      )}
    </div>
  );
}

export function EmployeeTableRow({ employee, actionMenuId, setActionMenuId, onEdit, onReset, onAssign, onToggle }) {
  const active = employee.isActive !== false;
  const fullName = [employee.firstName, employee.lastName].filter(Boolean).join(" ") || employee.email;
  const siteCount = Number(employee.assignedSiteCount || employee.assignedSiteIds?.length || 0);
  const permissionCount = employee.role === "CLIENT_OWNER" ? permissionOptions.length : Number(employee.permissions?.length || 0);
  const canManage = employee.role === "CLIENT_EMPLOYEE";

  return (
    <tr>
      <td>
        <div className="employee-person-cell">
          <span className="company-avatar">{initials(employee.firstName, employee.lastName, employee.email)}</span>
          <div>
            <strong>{fullName}</strong>
            <small>{roleLabel(employee.role)}</small>
          </div>
        </div>
      </td>
      <td>{employee.email || "-"}</td>
      <td>{employee.phone || "Nie podano"}</td>
      <td><span className="company-role-badge">{roleLabel(employee.role)}</span></td>
      <td><span className={active ? "company-active-dot" : "company-inactive-dot"}>{active ? "Aktywny" : "Nieaktywny"}</span></td>
      <td>{siteCount ? `${siteCount} ${plural(siteCount, "obiekt", "obiekty", "obiektów")}` : "Brak przypisań"}</td>
      <td>{permissionCount ? `${permissionCount} ${plural(permissionCount, "uprawnienie", "uprawnienia", "uprawnień")}` : "Brak uprawnień"}</td>
      <td>{formatLastLogin(employee.lastLoginAt)}</td>
      <td className="employee-actions-cell">
        <button
          className="company-icon-button"
          type="button"
          aria-label="Akcje pracownika"
          onClick={() => setActionMenuId(actionMenuId === employee.id ? null : employee.id)}
        >
          <MoreVertical size={18} />
        </button>
        {actionMenuId === employee.id && (
          <div className="employee-action-menu">
            <button type="button" disabled={!canManage} onClick={() => onEdit(employee)}><Edit3 size={15} /> Edytuj</button>
            <button type="button" disabled={!canManage} onClick={() => onReset(employee)}><KeyRound size={15} /> Resetuj hasło</button>
            <button type="button" onClick={() => onAssign(employee)}><Building2 size={15} /> Przypisz do obiektów</button>
            <button type="button" disabled={!canManage} onClick={() => onToggle(employee)}>{active ? "Dezaktywuj" : "Aktywuj"}</button>
          </div>
        )}
      </td>
    </tr>
  );
}

export function SiteImageUpload({ form, error, setFile, removeImage }) {
  const preview = form.imagePreview || publicUrl(form.existingImageUrl);
  return (
    <div className="site-image-upload">
      <div className="site-upload-preview">
        {preview ? <img src={preview} alt="Podgląd zdjęcia obiektu" /> : <><ImageIcon size={34} /><span>Brak zdjęcia</span></>}
      </div>
      <div className="site-upload-controls">
        <strong>Zdjęcie obiektu</strong>
        <p>JPG, PNG lub WEBP, maksymalnie 5 MB.</p>
        <label>
          <Upload size={16} />
          Wybierz zdjęcie
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </label>
        {preview && <button type="button" onClick={removeImage}><X size={16} /> Usuń zdjęcie</button>}
        {error && <small>{error}</small>}
      </div>
    </div>
  );
}

export function ActivityList({ items }) {
  if (!items?.length) return <p className="company-empty">Brak ostatniej aktywności.</p>;
  return (
    <div className="company-activity-list">
      {items.map((item) => (
        <article key={`${item.type}-${item.id}-${item.timestamp}`}>
          <span className={`activity-dot ${item.type || "default"}`}>
            {item.type === "offer" ? <FileText size={15} /> : item.type === "ticket" ? <Wrench size={15} /> : <Users size={15} />}
          </span>
          <p>{item.title}</p>
          <time>{formatDateTime(item.timestamp)}</time>
        </article>
      ))}
    </div>
  );
}

export function CompanyInput({ label, value, onChange, type = "text" }) {
  return (
    <label className="company-form-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function CompanyModal({ title, children, onClose, onSave, wide = false, saveLabel = "Zapisz" }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <section className={wide ? "company-modal wide" : "company-modal"} onClick={(event) => event.stopPropagation()}>
        <header><h2>{title}</h2></header>
        <div className="company-modal-body">{children}</div>
        <footer>
          <button className="company-secondary-button" type="button" onClick={onClose}>Anuluj</button>
          <button className="company-primary-button" type="button" onClick={onSave}>{saveLabel}</button>
        </footer>
      </section>
    </div>
  );
}
