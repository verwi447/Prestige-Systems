import { useCallback, useEffect, useMemo, useState } from "react";
import { companies, users as usersAPI } from "../../api";
import ConfirmationModal from "../../components/ConfirmationModal";
import BarrierCheckbox from "../../components/BarrierCheckbox";

const PERMISSION_DEFS = [
  {
    key: "CREATE_TICKET",
    icon: "doc",
    name: "Tworzenie zgłoszeń",
    description: "Pozwala zgłaszać awarie oraz prośby o wycenę."
  },
  {
    key: "VIEW_TICKETS",
    icon: "eye",
    name: "Podgląd zgłoszeń",
    description: "Pozwala przeglądać wszystkie zgłoszenia firmy."
  },
  {
    key: "COMMENT_TICKET",
    icon: "chat",
    name: "Komentowanie zgłoszeń",
    description: "Pozwala odpowiadać w zgłoszeniach."
  },
  {
    key: "VIEW_OFFERS",
    icon: "tag",
    name: "Podgląd ofert",
    description: "Pozwala przeglądać oferty handlowe."
  },
  {
    key: "ACCEPT_OFFERS",
    icon: "check",
    name: "Akceptacja ofert",
    description: "Pozwala zaakceptować lub odrzucić ofertę."
  },
  {
    key: "VIEW_CATALOG",
    icon: "book",
    name: "Podgląd katalogu",
    description: "Pozwala przeglądać katalog produktów."
  },
  {
    key: "MANAGE_SITES",
    icon: "building",
    name: "Zarządzanie obiektami",
    description: "Pozwala dodawać i edytować obiekty firmy."
  }
];

const emptyEmployee = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  role: "CLIENT_EMPLOYEE",
  password: "",
  isActive: true,
  permissions: PERMISSION_DEFS.map((permission) => ({ permissionKey: permission.key, enabled: true }))
};

const pageSize = 6;

function EmployeeIcon({ type }) {
  const paths = {
    edit: (
      <>
        <path d="M4 20h4.2L19.1 9.1a2.4 2.4 0 0 0-3.4-3.4L4.8 16.6z" />
        <path d="m14.4 7 2.6 2.6" />
      </>
    ),
    more: <path d="M12 7h.01M12 12h.01M12 17h.01" />,
    plus: <path d="M12 5v14M5 12h14" />,
    doc: (
      <>
        <path d="M7 3.5h7l3 3V20H7z" />
        <path d="M14 3.5V7h3M9 11h6M9 15h5" />
      </>
    ),
    eye: (
      <>
        <path d="M3.5 12s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    chat: (
      <>
        <path d="M5 6h14v9H9l-4 4z" />
        <path d="M9 10h6M9 13h4" />
      </>
    ),
    tag: (
      <>
        <path d="M4 11.5 11.5 4H20v8.5L12.5 20z" />
        <path d="M16 8h.01" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12.2 2.2 2.2 4.8-5" />
      </>
    ),
    book: (
      <>
        <path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
        <path d="M8 4v13a3 3 0 0 0 3 3" />
      </>
    ),
    building: (
      <>
        <path d="M5 20V5h9v15M14 9h5v11M8 8h3M8 12h3M8 16h3M16 13h1" />
      </>
    )
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[type]}
    </svg>
  );
}

const employeeInitials = (employee) => {
  const source = [employee.first_name, employee.last_name].filter(Boolean).join(" ") || employee.email || "Pracownik";
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "P";
};

const roleLabel = (role) => (role === "CLIENT_OWNER" ? "Właściciel" : "Pracownik");

export default function CompanyEmployeesTab({ companyId }) {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState(emptyEmployee);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);

  const loadEmployees = useCallback(async () => {
    const response = await companies.getUsers(companyId);
    setEmployees(response.data || []);
  }, [companyId]);

  useEffect(() => {
    loadEmployees().catch((error) => setMessage(error.response?.data?.error || "Nie udało się pobrać pracowników."));
  }, [loadEmployees]);

  useEffect(() => {
    setPage(1);
  }, [query, roleFilter, statusFilter]);

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const openCreate = () => {
    setEditing(null);
    setForm(emptyEmployee);
    setShowForm(true);
    setOpenMenuId(null);
    setMessage("");
  };

  const openEdit = (employee) => {
    setEditing(employee);
    setForm({
      ...emptyEmployee,
      firstName: employee.first_name || "",
      lastName: employee.last_name || "",
      email: employee.email || "",
      phone: employee.phone || "",
      role: employee.role || "CLIENT_EMPLOYEE",
      password: "",
      isActive: employee.is_active !== false
    });
    setShowForm(true);
    setOpenMenuId(null);
    setMessage("");
  };

  const filteredEmployees = useMemo(() => {
    const phrase = query.trim().toLowerCase();
    return employees.filter((employee) => {
      const active = employee.is_active !== false;
      if (roleFilter !== "all" && employee.role !== roleFilter) return false;
      if (statusFilter === "active" && !active) return false;
      if (statusFilter === "inactive" && active) return false;
      if (!phrase) return true;
      return [employee.first_name, employee.last_name, employee.email, employee.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(phrase);
    });
  }, [employees, query, roleFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / pageSize));
  const visibleEmployees = filteredEmployees.slice((page - 1) * pageSize, page * pageSize);

  const permissionCount = (employee) => {
    if (employee.role === "CLIENT_OWNER") return `${PERMISSION_DEFS.length}/${PERMISSION_DEFS.length}`;
    if (Array.isArray(employee.permissions)) {
      const enabled = employee.permissions.filter((permission) => permission.enabled !== false).length;
      return `${enabled}/${PERMISSION_DEFS.length}`;
    }
    return `0/${PERMISSION_DEFS.length}`;
  };

  const validateForm = () => {
    if (!form.firstName.trim()) return "Imię jest wymagane.";
    if (!form.lastName.trim()) return "Nazwisko jest wymagane.";
    if (!form.email.trim()) return "Email jest wymagany.";
    const duplicateEmail = employees.some((employee) =>
      employee.email?.toLowerCase() === form.email.trim().toLowerCase() && Number(employee.id) !== Number(editing?.id)
    );
    if (duplicateEmail) return "Pracownik z takim adresem e-mail już istnieje.";
    if (!editing && !form.password.trim()) return "Hasło jest wymagane przy tworzeniu pracownika.";
    return "";
  };

  const saveEmployee = async () => {
    const validation = validateForm();
    if (validation) {
      setMessage(validation);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim()
      };
      let saved;
      if (editing) {
        saved = await companies.updateUser(companyId, editing.id, payload);
      } else {
        saved = await companies.createUser(companyId, payload);
      }
      if (payload.role === "CLIENT_EMPLOYEE") {
        await usersAPI.updatePermissions(saved.data.id, payload.permissions);
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyEmployee);
      await loadEmployees();
      setMessage(editing ? "Dane zostały zapisane." : "Pracownik został dodany.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać pracownika.");
    } finally {
      setSaving(false);
    }
  };

  const changeActive = async (employee, isActive) => {
    setOpenMenuId(null);
    try {
      await companies.updateUser(companyId, employee.id, {
        firstName: employee.first_name || "",
        lastName: employee.last_name || "",
        email: employee.email || "",
        phone: employee.phone || "",
        role: employee.role || "CLIENT_EMPLOYEE",
        password: "",
        isActive
      });
      await loadEmployees();
      setMessage(isActive ? "Pracownik został aktywowany." : "Pracownik został dezaktywowany.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zmienić statusu pracownika.");
    }
  };

  const deleteEmployee = async () => {
    if (!employeeToDelete) return;
    try {
      await companies.deleteUser(companyId, employeeToDelete.id);
      await loadEmployees();
      setMessage("Pracownik został usunięty.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się usunąć pracownika.");
    } finally {
      setEmployeeToDelete(null);
    }
  };

  const togglePermission = (permissionKey) => {
    setForm((current) => ({
      ...current,
      permissions: current.permissions.map((permission) =>
        permission.permissionKey === permissionKey ? { ...permission, enabled: !permission.enabled } : permission
      )
    }));
  };

  return (
    <section className="company-tab-panel employees-panel">
      <div className="tab-panel-header employees-header">
        <div>
          <h3>Pracownicy firmy</h3>
          <p>Zarządzaj pracownikami i ich uprawnieniami.</p>
        </div>
        <button className="btn btn-success employees-add-button" onClick={openCreate}>
          <EmployeeIcon type="plus" />
          Dodaj pracownika
        </button>
      </div>

      {message && <div className="settings-message">{message}</div>}

      <div className="employees-toolbar">
        <label className="employees-search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj pracownika..." />
        </label>
        <label>
          <span>Rola</span>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="all">Wszystkie</option>
            <option value="CLIENT_OWNER">Właściciel</option>
            <option value="CLIENT_EMPLOYEE">Pracownik</option>
          </select>
        </label>
        <label>
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Wszystkie</option>
            <option value="active">Aktywny</option>
            <option value="inactive">Nieaktywny</option>
          </select>
        </label>
      </div>

      <div className="employees-table-shell">
        <table className="employees-table">
          <thead>
            <tr>
              <th>Imię i nazwisko</th>
              <th>Rola</th>
              <th>E-mail</th>
              <th>Telefon</th>
              <th>Status</th>
              <th>Uprawnienia</th>
              <th>Akcje</th>
            </tr>
          </thead>
          <tbody>
            {visibleEmployees.map((employee) => {
              const active = employee.is_active !== false;
              return (
                <tr key={employee.id}>
                  <td>
                    <div className="employee-person">
                      <span className="employee-avatar">{employeeInitials(employee)}</span>
                      <div>
                        <strong>{[employee.first_name, employee.last_name].filter(Boolean).join(" ") || "-"}</strong>
                        <small>{employee.email || "-"}</small>
                      </div>
                    </div>
                  </td>
                  <td><span className={employee.role === "CLIENT_OWNER" ? "employee-role-badge owner" : "employee-role-badge"}>{roleLabel(employee.role)}</span></td>
                  <td>{employee.email || "-"}</td>
                  <td>{employee.phone || "-"}</td>
                  <td><span className={active ? "employee-status-badge active" : "employee-status-badge inactive"}>{active ? "Aktywny" : "Nieaktywny"}</span></td>
                  <td><strong className="employee-permission-count">{permissionCount(employee)}</strong></td>
                  <td>
                    <div className="employee-actions">
                      <button className="employee-edit-button" type="button" onClick={() => openEdit(employee)}>
                        <EmployeeIcon type="edit" />
                        Edytuj
                      </button>
                      <div className="employee-menu">
                        <button
                          className="employee-menu-button"
                          type="button"
                          aria-label="Więcej opcji"
                          onClick={() => setOpenMenuId(openMenuId === employee.id ? null : employee.id)}
                        >
                          <EmployeeIcon type="more" />
                        </button>
                        {openMenuId === employee.id && (
                          <div className="employee-menu-popover">
                            <button type="button" onClick={() => openEdit(employee)}>Resetuj hasło</button>
                            {active ? (
                              <button type="button" onClick={() => changeActive(employee, false)}>Dezaktywuj</button>
                            ) : (
                              <button type="button" onClick={() => changeActive(employee, true)}>Aktywuj</button>
                            )}
                            <button
                              type="button"
                              className="danger"
                              onClick={() => {
                                setEmployeeToDelete(employee);
                                setOpenMenuId(null);
                              }}
                            >
                              Usuń
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visibleEmployees.length === 0 && (
              <tr>
                <td colSpan="7" className="employees-empty-row">Brak pracowników dla wybranych filtrów.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="employees-pagination">
        <span>Wyświetlanie {filteredEmployees.length ? (page - 1) * pageSize + 1 : 0}-{Math.min(page * pageSize, filteredEmployees.length)} z {filteredEmployees.length} pracowników</span>
        <div>
          <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</button>
          <strong>{page}</strong>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>›</button>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay company-modal-overlay" onClick={() => !saving && setShowForm(false)}>
          <div className="company-modal employee-modal" onClick={(event) => event.stopPropagation()}>
            <div className="company-modal-header">
              <h3>{editing ? "Edytuj pracownika" : "Dodaj pracownika"}</h3>
              <button className="company-modal-close" type="button" onClick={() => !saving && setShowForm(false)}>×</button>
            </div>

            <div className="employee-modal-body">
              <section className="employee-modal-section">
                <h4>Dane podstawowe</h4>
                <div className="employee-form-grid">
                  <label><span>Imię <b>*</b></span><input value={form.firstName} onChange={(event) => updateField("firstName", event.target.value)} placeholder="Wprowadź imię" /></label>
                  <label><span>Nazwisko <b>*</b></span><input value={form.lastName} onChange={(event) => updateField("lastName", event.target.value)} placeholder="Wprowadź nazwisko" /></label>
                  <label><span>E-mail <b>*</b></span><input type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} placeholder="Wprowadź adres e-mail" /></label>
                  <label><span>Telefon</span><input value={form.phone} onChange={(event) => updateField("phone", event.target.value)} placeholder="Wprowadź numer telefonu" /></label>
                  <label><span>Rola <b>*</b></span>
                    <select value={form.role} onChange={(event) => updateField("role", event.target.value)}>
                      <option value="CLIENT_OWNER">Właściciel</option>
                      <option value="CLIENT_EMPLOYEE">Pracownik</option>
                    </select>
                  </label>
                  <label><span>{editing ? "Nowe hasło" : "Hasło"} {!editing && <b>*</b>}</span><input type="password" value={form.password} onChange={(event) => updateField("password", event.target.value)} placeholder={editing ? "Zostaw puste bez zmian" : "Wprowadź hasło"} /></label>
                </div>
                <BarrierCheckbox
                  className="employee-active-check"
                  checked={form.isActive}
                  onChange={(value) => updateField("isActive", value)}
                  label="Aktywny"
                  description="Pracownik będzie mógł logować się do systemu."
                />
              </section>

              <section className="employee-modal-section employee-permissions-section">
                <h4>Uprawnienia</h4>
                <p>Zaznacz uprawnienia, które będzie posiadać pracownik.</p>
                <div className="employee-permissions-grid">
                  {PERMISSION_DEFS.map((permission) => {
                    const checked = form.permissions.some((item) => item.permissionKey === permission.key && item.enabled !== false);
                    return (
                      <label key={permission.key} className={checked ? "permission-tile checked" : "permission-tile"}>
                        <input type="checkbox" checked={checked} onChange={() => togglePermission(permission.key)} />
                        <span className="permission-icon"><EmployeeIcon type={permission.icon} /></span>
                        <span>
                          <strong>{permission.name}</strong>
                          <small>{permission.description}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="company-modal-actions">
              <button className="btn btn-cancel" type="button" onClick={() => setShowForm(false)} disabled={saving}>Anuluj</button>
              <button className="btn btn-success" type="button" onClick={saveEmployee} disabled={saving}>
                {saving ? "Zapisywanie..." : "Zapisz pracownika"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!employeeToDelete}
        onClose={() => setEmployeeToDelete(null)}
        onConfirm={deleteEmployee}
        title="Usuń pracownika"
        confirmText="Usuń"
      >
        <p>Czy na pewno usunąć pracownika <strong>{employeeToDelete?.email}</strong>?</p>
      </ConfirmationModal>
    </section>
  );
}
