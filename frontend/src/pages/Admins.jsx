import { useEffect, useMemo, useState } from "react";
import { admins as adminsAPI } from "../api";
import ConfirmationModal from "../components/ConfirmationModal";
import "./Settings.css";

const emptyAdmin = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  password: "",
  isActive: true
};

const formatDateTime = (value) => {
  if (!value) return "Nigdy";
  return new Date(value).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const initials = (admin) => {
  const parts = [admin.first_name, admin.last_name].filter(Boolean);
  const source = parts.length ? parts.join(" ") : admin.email || "Admin";
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "A";
};

function AdminIcon({ type }) {
  const paths = {
    users: (
      <>
        <path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
        <path d="M3.5 20c.6-3.8 2.3-5.7 5-5.7s4.4 1.9 5 5.7" />
        <path d="M16 11a3 3 0 1 0 0-6" />
        <path d="M15.2 14.2c2.2.4 3.6 2.3 4.1 5.8" />
      </>
    ),
    shield: (
      <path d="M12 3.5 5.5 6v5.2c0 4.1 2.6 7.6 6.5 9.3 3.9-1.7 6.5-5.2 6.5-9.3V6z" />
    ),
    inactive: (
      <>
        <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
        <path d="M3.5 20c.6-3.8 2.4-5.7 5.5-5.7 1 0 1.9.2 2.6.6" />
        <path d="M15 15l5 5M20 15l-5 5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7.5V12l3.2 2" />
      </>
    ),
    search: <path d="m20 20-4.2-4.2M10.8 17a6.2 6.2 0 1 1 0-12.4 6.2 6.2 0 0 1 0 12.4z" />,
    edit: (
      <>
        <path d="M4 20h4.2L19.1 9.1a2.4 2.4 0 0 0-3.4-3.4L4.8 16.6z" />
        <path d="m14.4 7 2.6 2.6" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16" />
        <path d="M10 11v6M14 11v6" />
        <path d="M6 7l1 13h10l1-13" />
        <path d="M9 7V4h6v3" />
      </>
    )
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[type]}
    </svg>
  );
}

export default function Admins() {
  const [admins, setAdmins] = useState([]);
  const [form, setForm] = useState(emptyAdmin);
  const [editing, setEditing] = useState(null);
  const [adminToDelete, setAdminToDelete] = useState(null);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const currentUser = JSON.parse(localStorage.getItem("user") || "null");

  const loadAdmins = async () => {
    const response = await adminsAPI.getAll();
    setAdmins(response.data || []);
  };

  useEffect(() => {
    loadAdmins().catch((error) => setMessage(error.response?.data?.error || "Nie udało się pobrać administratorów."));
  }, []);

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const resetForm = () => {
    setEditing(null);
    setForm(emptyAdmin);
  };

  const openEdit = (admin) => {
    setEditing(admin);
    setForm({
      firstName: admin.first_name || "",
      lastName: admin.last_name || "",
      email: admin.email || "",
      phone: admin.phone || "",
      password: "",
      isActive: admin.is_active !== false
    });
    setMessage("");
  };

  const stats = useMemo(() => {
    const active = admins.filter((admin) => admin.is_active !== false).length;
    const inactive = admins.length - active;
    const latestLogin = admins
      .map((admin) => admin.last_login_at)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0];
    return { total: admins.length, active, inactive, latestLogin };
  }, [admins]);

  const filteredAdmins = useMemo(() => {
    const phrase = query.trim().toLowerCase();
    return admins.filter((admin) => {
      const isActive = admin.is_active !== false;
      if (statusFilter === "active" && !isActive) return false;
      if (statusFilter === "inactive" && isActive) return false;
      if (!phrase) return true;
      return [admin.first_name, admin.last_name, admin.email, admin.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(phrase);
    });
  }, [admins, query, statusFilter]);

  const validateForm = () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      return "Imię, nazwisko i e-mail są wymagane.";
    }
    if (!editing && form.password.length < 8) return "Hasło musi mieć minimum 8 znaków.";
    if (editing && form.password && form.password.length < 8) return "Nowe hasło musi mieć minimum 8 znaków.";
    return "";
  };

  const saveAdmin = async () => {
    const validation = validateForm();
    if (validation) {
      setMessage(validation);
      return;
    }

    try {
      if (editing) {
        await adminsAPI.update(editing.id, form);
        setMessage("Administrator został zapisany.");
      } else {
        await adminsAPI.create(form);
        setMessage("Administrator został dodany.");
      }
      resetForm();
      await loadAdmins();
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać administratora.");
    }
  };

  const deactivateAdmin = async () => {
    if (!adminToDelete) return;
    try {
      await adminsAPI.delete(adminToDelete.id);
      await loadAdmins();
      setMessage("Administrator zosta? usuni?ty.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się usunąć administratora.");
    } finally {
      setAdminToDelete(null);
    }
  };

  return (
    <div className="page admin-users-page admin-management-page">
      <div className="admin-management-header">
        <div>
          <div className="admin-breadcrumb">Ustawienia <span>›</span> Administratorzy</div>
          <h1>Administratorzy</h1>
          <p>Zarządzaj kontami administratorów i ich dostępem do systemu.</p>
        </div>
        <button className="admin-primary-action" onClick={resetForm}>+ Dodaj administratora</button>
      </div>

      {message && <div className="settings-message">{message}</div>}

      <section className="admin-stats-row">
        <div className="admin-stat-tile green">
          <span><AdminIcon type="users" /></span>
          <strong>{stats.total}</strong>
          <p>Administratorów<br /><em>łącznie w systemie</em></p>
        </div>
        <div className="admin-stat-tile blue">
          <span><AdminIcon type="shield" /></span>
          <strong>{stats.active}</strong>
          <p>Aktywnych<br /><em>administratorów</em></p>
        </div>
        <div className="admin-stat-tile violet">
          <span><AdminIcon type="inactive" /></span>
          <strong>{stats.inactive}</strong>
          <p>Nieaktywnych<br /><em>administratorów</em></p>
        </div>
        <div className="admin-stat-tile amber">
          <span><AdminIcon type="clock" /></span>
          <strong>{stats.latestLogin ? "1" : "0"}</strong>
          <p>Ostatnie logowanie<br /><em>{formatDateTime(stats.latestLogin)}</em></p>
        </div>
      </section>

      <div className="admin-management-grid">
        <section className="admin-list-card">
          <div className="admin-list-toolbar">
            <h2>Lista administratorów</h2>
            <div className="admin-list-controls">
              <label className="admin-search">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Szukaj administratora..."
                />
                <AdminIcon type="search" />
              </label>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">Wszyscy</option>
                <option value="active">Aktywni</option>
                <option value="inactive">Nieaktywni</option>
              </select>
            </div>
          </div>

          <div className="admin-table-shell">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Administrator</th>
                  <th>E-mail</th>
                  <th>Telefon</th>
                  <th>Status</th>
                  <th>Ostatnie logowanie</th>
                  <th>Akcje</th>
                </tr>
              </thead>
              <tbody>
                {filteredAdmins.map((admin) => {
                  const active = admin.is_active !== false;
                  const isCurrent = Number(currentUser?.id) === Number(admin.id);
                  return (
                    <tr key={admin.id}>
                      <td>
                        <div className="admin-person">
                          <span className="admin-avatar">{initials(admin)}</span>
                          <div>
                            <strong>{[admin.first_name, admin.last_name].filter(Boolean).join(" ") || admin.email}</strong>
                            <small>{isCurrent ? "Ty" : "Administrator"}</small>
                          </div>
                        </div>
                      </td>
                      <td>{admin.email || "-"}</td>
                      <td>{admin.phone || "-"}</td>
                      <td><span className={active ? "admin-status-badge active" : "admin-status-badge inactive"}>{active ? "Aktywny" : "Nieaktywny"}</span></td>
                      <td>{formatDateTime(admin.last_login_at)}</td>
                      <td>
                        <div className="admin-row-actions">
                          <button className="admin-action-button admin-icon-action" title="Edytuj" aria-label="Edytuj administratora" onClick={() => openEdit(admin)}><AdminIcon type="edit" /></button>
                          <button className="admin-row-delete admin-icon-action" title="Usuń" aria-label="Usuń administratora" onClick={() => setAdminToDelete(admin)} disabled={isCurrent}><AdminIcon type="trash" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredAdmins.length === 0 && (
                  <tr>
                    <td colSpan="6" className="admin-empty-row">Brak administratorów dla wybranych filtrów.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="admin-list-footer">Wyświetlanie {filteredAdmins.length} z {admins.length} wyników</div>
        </section>

        <aside className="admin-form-card">
          <div className="admin-form-title">
            <span><AdminIcon type="users" /></span>
            <div>
              <h2>{editing ? "Edytuj administratora" : "Dodaj administratora"}</h2>
              <p>{editing ? "Hasło zostaw puste, jeśli ma pozostać bez zmian." : "Utwórz konto z rolą ADMIN."}</p>
            </div>
          </div>

          <div className="admin-form">
            <label>Imię<input value={form.firstName} onChange={(event) => updateField("firstName", event.target.value)} placeholder="Wpisz imię" /></label>
            <label>Nazwisko<input value={form.lastName} onChange={(event) => updateField("lastName", event.target.value)} placeholder="Wpisz nazwisko" /></label>
            <label className="admin-form-wide">E-mail<input type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} placeholder="Wpisz adres e-mail" /></label>
            <label>Telefon <span>(opcjonalnie)</span><input value={form.phone} onChange={(event) => updateField("phone", event.target.value)} placeholder="Wpisz numer telefonu" /></label>
            <label>{editing ? "Nowe hasło" : "Hasło"}<input type="password" value={form.password} onChange={(event) => updateField("password", event.target.value)} placeholder="Minimum 8 znaków" /></label>
            <label className="admin-check-line"><input type="checkbox" checked={form.isActive} onChange={(event) => updateField("isActive", event.target.checked)} />Aktywny</label>
          </div>

          <div className="admin-form-actions">
            {editing && <button className="admin-cancel-button" onClick={resetForm}>Anuluj edycję</button>}
            <button className="admin-submit-button" onClick={saveAdmin}>{editing ? "Zapisz zmiany" : "Dodaj administratora"}</button>
          </div>
        </aside>
      </div>

      <section className="admin-permissions-card">
        <span><AdminIcon type="shield" /></span>
        <div>
          <strong>Uprawnienia administratorów</strong>
          <p>Administratorzy mają pełny dostęp do modułów systemu, użytkowników i ustawień firmy.</p>
        </div>
      </section>

      <ConfirmationModal
        isOpen={!!adminToDelete}
        onClose={() => setAdminToDelete(null)}
        onConfirm={deactivateAdmin}
        title="Usuń administratora"
        confirmText="Usuń"
      >
        <p>Czy na pewno usunąć administratora <strong>{adminToDelete?.email}</strong>?</p>
        <p style={{ fontSize: "0.9em", color: "#6b7280" }}>Konto zostanie usunięte z listy administratorów. Tego działania nie będzie można cofnąć.</p>
      </ConfirmationModal>
    </div>
  );
}
