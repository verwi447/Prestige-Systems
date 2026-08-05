import { useCallback, useEffect, useMemo, useState } from "react";
import { companies } from "../../api";
import ConfirmationModal from "../../components/ConfirmationModal";
import { apiOrigin } from "../../lib/runtimeConfig";

const API_ORIGIN = apiOrigin;

const emptySite = {
  name: "",
  address: "",
  city: "",
  postal_code: "",
  country: "Polska",
  description: "",
  isActive: true
};

const pageSize = 5;

function SiteIcon({ type }) {
  const paths = {
    search: <path d="m20 20-4.2-4.2M10.8 17a6.2 6.2 0 1 1 0-12.4 6.2 6.2 0 0 1 0 12.4z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    eye: (
      <>
        <path d="M3.5 12s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    edit: (
      <>
        <path d="M4 20h4.2L19.1 9.1a2.4 2.4 0 0 0-3.4-3.4L4.8 16.6z" />
        <path d="m14.4 7 2.6 2.6" />
      </>
    ),
    building: (
      <>
        <path d="M4 21V5.5L12 3l8 2.5V21" />
        <path d="M8 8h1M15 8h1M8 12h1M15 12h1M10 21v-4h4v4" />
      </>
    ),
    ticket: (
      <>
        <path d="M5 4h14v5a2 2 0 0 0 0 4v5H5v-5a2 2 0 0 0 0-4z" />
        <path d="M12 7v2M12 12v2M12 17v.01" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M10 11v5M14 11v5M9 7V4h6v3M6 7l1 13h10l1-13" />
      </>
    ),
    users: (
      <>
        <path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
        <path d="M3.5 20c.6-3.8 2.3-5.7 5-5.7s4.4 1.9 5 5.7" />
        <path d="M16 11a3 3 0 1 0 0-6" />
        <path d="M15.2 14.2c2.2.4 3.6 2.3 4.1 5.8" />
      </>
    )
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[type]}
    </svg>
  );
}

const formatDate = (date) => (date ? new Date(date).toLocaleDateString("pl-PL") : "-");

const initials = (employee) => {
  const source = [employee.first_name, employee.last_name].filter(Boolean).join(" ") || employee.email || "P";
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "P";
};

const roleLabel = (role) => (role === "CLIENT_OWNER" ? "Właściciel" : "Pracownik");

const siteAddress = (site) => [site.address, site.postal_code, site.city].filter(Boolean).join(", ") || "-";
const publicUrl = (url) => (!url || /^https?:\/\//i.test(url) ? url || "" : `${API_ORIGIN}${url}`);
const siteImageUrl = (site) => site?.imageUrl || site?.image_url || "";

function SitePhoto({ site, className = "site-card-image" }) {
  const imageUrl = siteImageUrl(site);
  if (imageUrl) return <img className={className} src={publicUrl(imageUrl)} alt={site.name || "Zdjęcie obiektu"} />;
  return (
    <div className={`${className} site-card-image-placeholder`} aria-label="Brak zdjęcia obiektu">
      <SiteIcon type="building" />
      <span>Brak zdjęcia</span>
    </div>
  );
}

export default function CompanySitesTab({ companyId }) {
  const [sites, setSites] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [selectedSite, setSelectedSite] = useState(null);
  const [activeDetailTab, setActiveDetailTab] = useState("data");
  const [form, setForm] = useState(emptySite);
  const [editingSite, setEditingSite] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [siteQuery, setSiteQuery] = useState("");
  const [siteStatusFilter, setSiteStatusFilter] = useState("all");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeRoleFilter, setEmployeeRoleFilter] = useState("all");
  const [assignedUserIds, setAssignedUserIds] = useState([]);
  const [sitePage, setSitePage] = useState(1);
  const [savingSite, setSavingSite] = useState(false);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [siteToDelete, setSiteToDelete] = useState(null);

  const loadData = useCallback(async () => {
    const [sitesResponse, employeesResponse, ticketsResponse] = await Promise.all([
      companies.getSites(companyId),
      companies.getUsers(companyId),
      companies.getTickets(companyId)
    ]);
    const loadedSites = sitesResponse.data || [];
    setSites(loadedSites);
    setEmployees(employeesResponse.data || []);
    setTickets(ticketsResponse.data || []);
    setSelectedSite((current) => {
      if (current) return loadedSites.find((site) => Number(site.id) === Number(current.id)) || loadedSites[0] || null;
      return loadedSites[0] || null;
    });
  }, [companyId]);

  useEffect(() => {
    loadData().catch((error) => setMessage(error.response?.data?.error || "Nie udało się pobrać obiektów."));
  }, [loadData]);

  useEffect(() => {
    setSitePage(1);
  }, [siteQuery, siteStatusFilter]);

  const selectedSiteId = selectedSite?.id;

  useEffect(() => {
    if (!selectedSiteId) {
      setAssignedUserIds([]);
      return;
    }
    companies
      .getSiteUsers(selectedSiteId)
      .then((response) => setAssignedUserIds((response.data || []).map((employee) => Number(employee.id))))
      .catch(() => setAssignedUserIds([]));
  }, [selectedSiteId]);

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const openCreate = () => {
    setEditingSite(null);
    setForm(emptySite);
    setShowForm(true);
    setMessage("");
  };

  const openEdit = (site) => {
    setEditingSite(site);
    setForm({
      name: site.name || "",
      address: site.address || "",
      city: site.city || "",
      postal_code: site.postal_code || "",
      country: "Polska",
      description: site.description || "",
      isActive: site.is_active !== false
    });
    setShowForm(true);
    setMessage("");
  };

  const filteredSites = useMemo(() => {
    const phrase = siteQuery.trim().toLowerCase();
    return sites.filter((site) => {
      const active = site.is_active !== false;
      if (siteStatusFilter === "active" && !active) return false;
      if (siteStatusFilter === "inactive" && active) return false;
      if (!phrase) return true;
      return [site.name, site.address, site.city, site.postal_code, site.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(phrase);
    });
  }, [sites, siteQuery, siteStatusFilter]);

  const siteTotalPages = Math.max(1, Math.ceil(filteredSites.length / pageSize));
  const visibleSites = filteredSites.slice((sitePage - 1) * pageSize, sitePage * pageSize);
  const siteColumns = useMemo(
    () => [
      {
        id: "active",
        title: "Aktywne obiekty",
        sites: visibleSites.filter((site) => site.is_active !== false)
      },
      {
        id: "inactive",
        title: "Nieaktywne obiekty",
        sites: visibleSites.filter((site) => site.is_active === false)
      }
    ].filter((column) => siteStatusFilter === "all" || column.id === siteStatusFilter),
    [visibleSites, siteStatusFilter]
  );

  const filteredEmployees = useMemo(() => {
    const phrase = employeeQuery.trim().toLowerCase();
    return employees.filter((employee) => {
      if (employeeRoleFilter !== "all" && employee.role !== employeeRoleFilter) return false;
      if (!phrase) return true;
      return [employee.first_name, employee.last_name, employee.email, employee.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(phrase);
    });
  }, [employees, employeeQuery, employeeRoleFilter]);

  const selectedTickets = useMemo(
    () => tickets.filter((ticket) => Number(ticket.object_id) === Number(selectedSite?.id)),
    [tickets, selectedSite?.id]
  );

  const selectSite = (site) => {
    setSelectedSite(site);
    setActiveDetailTab("data");
  };

  const ticketCount = (siteId) => tickets.filter((ticket) => Number(ticket.object_id) === Number(siteId)).length;

  const saveSite = async () => {
    if (!form.name.trim()) {
      setMessage("Nazwa obiektu jest wymagana.");
      return;
    }

    setSavingSite(true);
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address.trim(),
        postal_code: form.postal_code.trim(),
        city: form.city.trim(),
        description: form.description.trim(),
        isActive: form.isActive
      };
      let saved;
      if (editingSite) {
        saved = await companies.updateSite(editingSite.id, payload);
      } else {
        saved = await companies.createSite(companyId, payload);
      }
      await loadData();
      setSelectedSite(saved.data);
      setShowForm(false);
      setEditingSite(null);
      setForm(emptySite);
      setMessage("Obiekt został zapisany.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać obiektu.");
    } finally {
      setSavingSite(false);
    }
  };

  const toggleEmployee = (employeeId) => {
    setAssignedUserIds((current) =>
      current.includes(employeeId) ? current.filter((id) => id !== employeeId) : [...current, employeeId]
    );
  };

  const saveAssignments = async () => {
    if (!selectedSite) return;
    setSavingAssignments(true);
    try {
      const response = await companies.updateSiteUsers(selectedSite.id, assignedUserIds);
      setAssignedUserIds((response.data || []).map((employee) => Number(employee.id)));
      await loadData();
      setMessage("Pracownicy zostali przypisani.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać przypisań pracowników.");
    } finally {
      setSavingAssignments(false);
    }
  };

  const deleteSite = async () => {
    if (!siteToDelete) return;
    try {
      await companies.deleteSite(siteToDelete.id);
      await loadData();
      setMessage("Obiekt został usunięty.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się usunąć obiektu.");
    } finally {
      setSiteToDelete(null);
    }
  };

  return (
    <section className="company-tab-panel sites-panel">
      {message && <div className="settings-message">{message}</div>}

      <div className="sites-management-layout">
        <section className="sites-list-card">
          <div className="sites-card-header">
            <div>
              <h3>Obiekty firmy</h3>
              <p>Zarządzaj obiektami należącymi do tej firmy.</p>
            </div>
            <button className="btn btn-success sites-add-button" type="button" onClick={openCreate}>
              <SiteIcon type="plus" />
              Dodaj obiekt
            </button>
          </div>

          <div className="sites-toolbar">
            <label className="sites-search">
              <SiteIcon type="search" />
              <input value={siteQuery} onChange={(event) => setSiteQuery(event.target.value)} placeholder="Szukaj obiektu..." />
            </label>
            <select value={siteStatusFilter} onChange={(event) => setSiteStatusFilter(event.target.value)}>
              <option value="all">Status: Wszystkie</option>
              <option value="active">Aktywny</option>
              <option value="inactive">Nieaktywny</option>
            </select>
          </div>

          <div className="site-kanban-board">
            {siteColumns.map((column) => (
              <section className="site-kanban-column" key={column.id}>
                <header className="site-kanban-column-header">
                  <h4>{column.title}</h4>
                  <span>{column.sites.length}</span>
                </header>

                <div className="site-kanban-stack">
                  {column.sites.map((site) => {
                    const active = site.is_active !== false;
                    const selected = Number(selectedSite?.id) === Number(site.id);
                    return (
                      <article
                        key={site.id}
                        className={selected ? "site-kanban-card selected" : "site-kanban-card"}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectSite(site)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectSite(site);
                          }
                        }}
                      >
                        <SitePhoto site={site} />
                        <div className="site-kanban-card-body">
                          <div className="site-kanban-card-title">
                            <h5>{site.name || "Bez nazwy"}</h5>
                            <span className={active ? "site-status-badge active" : "site-status-badge inactive"}>
                              {active ? "Aktywny" : "Nieaktywny"}
                            </span>
                          </div>
                          <p>{siteAddress(site)}</p>
                          <div className="site-kanban-meta">
                            <span><SiteIcon type="users" />{site.assigned_employee_count ?? 0} pracowników</span>
                            <span><SiteIcon type="ticket" />{ticketCount(site.id)} zgłoszeń</span>
                          </div>
                        </div>
                        <footer className="site-kanban-actions" onClick={(event) => event.stopPropagation()}>
                          <button className="site-card-action" type="button" onClick={() => selectSite(site)}>
                            <SiteIcon type="eye" />Szczegóły
                          </button>
                          <button className="site-card-action" type="button" onClick={() => openEdit(site)}>
                            <SiteIcon type="edit" />Edytuj
                          </button>
                          <button className="site-card-action danger" type="button" onClick={() => setSiteToDelete(site)} title="Usuń obiekt">
                            <SiteIcon type="trash" />
                          </button>
                        </footer>
                      </article>
                    );
                  })}
                  {column.sites.length === 0 && <div className="site-kanban-empty">Brak obiektów w tej kolumnie.</div>}
                </div>
              </section>
            ))}
            {visibleSites.length === 0 && <div className="site-kanban-empty full">Brak obiektów dla wybranych filtrów.</div>}
          </div>

          <div className="sites-pagination">
            <span>Wyświetlanie {filteredSites.length ? (sitePage - 1) * pageSize + 1 : 0}-{Math.min(sitePage * pageSize, filteredSites.length)} z {filteredSites.length} obiektów</span>
            <div>
              <button type="button" disabled={sitePage <= 1} onClick={() => setSitePage((current) => Math.max(1, current - 1))}>‹</button>
              <strong>{sitePage}</strong>
              <button type="button" disabled={sitePage >= siteTotalPages} onClick={() => setSitePage((current) => Math.min(siteTotalPages, current + 1))}>›</button>
            </div>
          </div>
        </section>

        <aside className="site-detail-card">
          {selectedSite ? (
            <>
              <div className="site-detail-header">
                <div className="site-detail-identity">
                  <SitePhoto site={selectedSite} className="site-detail-image" />
                  <div>
                    <h3>{selectedSite.name}</h3>
                    <p>{siteAddress(selectedSite)}</p>
                  </div>
                </div>
                <button className="btn btn-secondary" type="button" onClick={() => openEdit(selectedSite)}>
                  <SiteIcon type="edit" />
                  Edytuj obiekt
                </button>
              </div>

              <div className="site-detail-tabs">
                {[
                  ["data", "Dane obiektu"],
                  ["employees", "Pracownicy"],
                  ["tickets", "Zgłoszenia"]
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={activeDetailTab === id ? "active" : ""}
                    onClick={() => setActiveDetailTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {activeDetailTab === "data" && (
                <div className="site-data-grid">
                  <div><span>Nazwa</span><strong>{selectedSite.name || "-"}</strong></div>
                  <div><span>Adres</span><strong>{selectedSite.address || "-"}</strong></div>
                  <div><span>Kod pocztowy</span><strong>{selectedSite.postal_code || "-"}</strong></div>
                  <div><span>Miasto</span><strong>{selectedSite.city || "-"}</strong></div>
                  <div><span>Kraj</span><strong>Polska</strong></div>
                  <div><span>Status</span><strong>{selectedSite.is_active === false ? "Nieaktywny" : "Aktywny"}</strong></div>
                  <div className="wide"><span>Opis</span><strong>{selectedSite.description || "Brak opisu."}</strong></div>
                  <button className="btn btn-secondary" type="button" onClick={() => openEdit(selectedSite)}>Edytuj</button>
                </div>
              )}

              {activeDetailTab === "employees" && (
                <div className="site-employees-panel">
                  <div>
                    <h4>Przypisani pracownicy</h4>
                    <p>Wybierz pracowników, którzy mają dostęp do tego obiektu.</p>
                  </div>
                  <div className="site-employees-toolbar">
                    <label className="sites-search">
                      <SiteIcon type="search" />
                      <input value={employeeQuery} onChange={(event) => setEmployeeQuery(event.target.value)} placeholder="Szukaj pracownika..." />
                    </label>
                    <select value={employeeRoleFilter} onChange={(event) => setEmployeeRoleFilter(event.target.value)}>
                      <option value="all">Rola: Wszystkie</option>
                      <option value="CLIENT_OWNER">Właściciel</option>
                      <option value="CLIENT_EMPLOYEE">Pracownik</option>
                    </select>
                  </div>

                  <div className="site-employees-list">
                    {filteredEmployees.map((employee) => {
                      const checked = assignedUserIds.includes(Number(employee.id));
                      const active = employee.is_active !== false;
                      return (
                        <label key={employee.id} className={checked ? "site-employee-row checked" : "site-employee-row"}>
                          <input type="checkbox" checked={checked} onChange={() => toggleEmployee(Number(employee.id))} />
                          <span className="employee-avatar">{initials(employee)}</span>
                          <span>
                            <strong>{[employee.first_name, employee.last_name].filter(Boolean).join(" ") || employee.email}</strong>
                            <small>{employee.email || "-"}</small>
                          </span>
                          <span className={employee.role === "CLIENT_OWNER" ? "employee-role-badge owner" : "employee-role-badge"}>{roleLabel(employee.role)}</span>
                          <span className={active ? "employee-status-badge active" : "employee-status-badge inactive"}>{active ? "Aktywny" : "Nieaktywny"}</span>
                        </label>
                      );
                    })}
                    {filteredEmployees.length === 0 && <div className="site-empty-state">Brak pracowników dla wybranych filtrów.</div>}
                  </div>

                  <div className="site-assignment-footer">
                    <span>Przypisano {assignedUserIds.length} z {employees.length} pracowników</span>
                    <button className="btn btn-success" type="button" onClick={saveAssignments} disabled={savingAssignments}>
                      {savingAssignments ? "Zapisywanie..." : "Zapisz przypisania"}
                    </button>
                  </div>
                </div>
              )}

              {activeDetailTab === "tickets" && (
                <div className="site-tickets-panel">
                  <table className="site-tickets-table">
                    <thead>
                      <tr>
                        <th>Numer</th>
                        <th>Temat</th>
                        <th>Priorytet</th>
                        <th>Status</th>
                        <th>Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTickets.map((ticket) => (
                        <tr key={ticket.id}>
                          <td>{ticket.ticket_number || "-"}</td>
                          <td>{ticket.subject || ticket.type || "-"}</td>
                          <td>Normalny</td>
                          <td><span className="site-status-badge inactive">{ticket.status || "-"}</span></td>
                          <td>{formatDate(ticket.created_at)}</td>
                        </tr>
                      ))}
                      {selectedTickets.length === 0 && (
                        <tr>
                          <td colSpan="5" className="sites-empty-row">Pusty obiekt — brak zgłoszeń.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="site-empty-state">Wybierz obiekt z listy albo dodaj pierwszy obiekt firmy.</div>
          )}
        </aside>
      </div>

      {showForm && (
        <div className="modal-overlay company-modal-overlay" onClick={() => !savingSite && setShowForm(false)}>
          <div className="company-modal site-modal" onClick={(event) => event.stopPropagation()}>
            <div className="company-modal-header">
              <h3>{editingSite ? "Edytuj obiekt" : "Dodaj obiekt"}</h3>
              <button className="company-modal-close" type="button" onClick={() => !savingSite && setShowForm(false)}>×</button>
            </div>
            <div className="site-modal-form">
              <label><span>Nazwa obiektu <b>*</b></span><input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Wprowadź nazwę obiektu" /></label>
              <label><span>Adres</span><input value={form.address} onChange={(event) => updateField("address", event.target.value)} placeholder="Wprowadź adres" /></label>
              <label><span>Kod pocztowy</span><input value={form.postal_code} onChange={(event) => updateField("postal_code", event.target.value)} placeholder="00-000" /></label>
              <label><span>Miasto</span><input value={form.city} onChange={(event) => updateField("city", event.target.value)} placeholder="Wprowadź miasto" /></label>
              <label><span>Kraj</span><input value={form.country} onChange={(event) => updateField("country", event.target.value)} placeholder="Polska" /></label>
              <label className="full"><span>Opis</span><textarea rows="3" value={form.description} onChange={(event) => updateField("description", event.target.value)} placeholder="Wprowadź opis obiektu" /></label>
              <label className="company-checkbox full">
                <input type="checkbox" checked={form.isActive} onChange={(event) => updateField("isActive", event.target.checked)} />
                <span>
                  Aktywny
                  <small>Obiekt będzie widoczny i dostępny w systemie.</small>
                </span>
              </label>
            </div>
            <div className="company-modal-actions">
              <button className="btn btn-cancel" type="button" onClick={() => setShowForm(false)} disabled={savingSite}>Anuluj</button>
              <button className="btn btn-success" type="button" onClick={saveSite} disabled={savingSite}>
                {savingSite ? "Zapisywanie..." : "Zapisz obiekt"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!siteToDelete}
        onClose={() => setSiteToDelete(null)}
        onConfirm={deleteSite}
        title="Usuń obiekt"
        confirmText="Usuń"
      >
        <p>Czy na pewno usunąć obiekt <strong>{siteToDelete?.name}</strong>?</p>
      </ConfirmationModal>
    </section>
  );
}
