import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronRight, Columns3, FileText, LayoutList, MapPin, Users, Wrench } from "lucide-react";
import { companies } from "../api";
import AppState from "../components/AppState";
import { getRequestErrorMessage, showFeedback, showSuccess } from "../lib/feedback";
import CompanyFormModal from "./companies/CompanyFormModal";
import { createCompanyFormData } from "./companies/companyFormData";
import "./Companies.css";

const COMPANY_VIEW_STORAGE_KEY = "prestige-companies-view";

const getSavedCompanyView = () => {
  try {
    return window.localStorage.getItem(COMPANY_VIEW_STORAGE_KEY) === "kanban" ? "kanban" : "list";
  } catch {
    return "list";
  }
};

export default function Companies() {
  const navigate = useNavigate();
  const [companyList, setCompanyList] = useState([]);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState(getSavedCompanyView);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(createCompanyFormData());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadCompanies = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await companies.getAll();
      setCompanyList(response.data || []);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, "Nie udalo sie pobrac firm."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  const filteredCompanies = useMemo(() => {
    const phrase = query.trim().toLowerCase();
    if (!phrase) return companyList;
    return companyList.filter((company) =>
      [company.name, company.nip, company.city, company.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(phrase))
    );
  }, [companyList, query]);

  const kanbanColumns = useMemo(() => {
    const columns = [
      {
        id: "active",
        label: "Aktywne",
        companies: filteredCompanies.filter((company) => company.is_active !== false)
      },
      {
        id: "inactive",
        label: "Nieaktywne",
        companies: filteredCompanies.filter((company) => company.is_active === false)
      }
    ];
    const hasInactiveCompanies = companyList.some((company) => company.is_active === false);
    return hasInactiveCompanies ? columns : columns.filter((column) => column.id !== "inactive");
  }, [filteredCompanies, companyList]);

  const changeViewMode = (nextViewMode) => {
    setViewMode(nextViewMode);
    try {
      window.localStorage.setItem(COMPANY_VIEW_STORAGE_KEY, nextViewMode);
    } catch {
      // The selected view remains active for the current session.
    }
  };

  const openCreateForm = () => {
    setFormData(createCompanyFormData());
    setShowForm(true);
  };

  const saveCompany = async () => {
    if (!formData.name.trim()) {
      showFeedback({ message: "Wpisz nazwe firmy przed zapisem.", type: "warning" });
      return;
    }
    try {
      const response = await companies.create(formData);
      setShowForm(false);
      setFormData(createCompanyFormData());
      await loadCompanies();
      showSuccess("Firma zostala dodana.");
      navigate(`/companies/${response.data.id}`);
    } catch (requestError) {
      setMessage(getRequestErrorMessage(requestError, "Nie udalo sie utworzyc firmy."));
    }
  };

  return (
    <div className="page companies-page">
      <div className="companies-list-header">
        <div className="companies-list-heading">
          <h1>Firmy klientów</h1>
        </div>
        <div className="companies-list-tools">
          <input
            type="search"
            aria-label="Szukaj firm"
            placeholder="Szukaj po nazwie, NIP, mieście lub e-mailu"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="company-view-switcher" role="group" aria-label="Widok firm">
            <button
              className={viewMode === "list" ? "company-view-button active" : "company-view-button"}
              type="button"
              aria-label="Widok listy"
              aria-pressed={viewMode === "list"}
              title="Widok listy"
              onClick={() => changeViewMode("list")}
            >
              <LayoutList size={18} aria-hidden="true" />
              <span>Lista</span>
            </button>
            <button
              className={viewMode === "kanban" ? "company-view-button active" : "company-view-button"}
              type="button"
              aria-label="Widok Kanban"
              aria-pressed={viewMode === "kanban"}
              title="Widok Kanban"
              onClick={() => changeViewMode("kanban")}
            >
              <Columns3 size={18} aria-hidden="true" />
              <span>Kanban</span>
            </button>
          </div>
          <button className="btn btn-success" onClick={openCreateForm}>Nowa firma</button>
        </div>
      </div>

      {message && <div className="settings-message">{message}</div>}

      {loading || error ? (
        <div className="companies-table-card">
          {loading ? <AppState variant="loading" compact title="Ladowanie firm" description="Pobieramy aktualna liste klientow." /> : (
          <AppState variant="error" compact description={error} actionLabel="Sprobuj ponownie" onAction={loadCompanies} />
          )}
        </div>
      ) : viewMode === "list" ? (
        <div className="companies-table-card">
          <table className="companies-list-table">
          <thead>
            <tr>
              <th>Nazwa firmy</th>
              <th>NIP</th>
              <th>Miasto</th>
              <th>Pracownicy</th>
              <th>Obiekty</th>
              <th>Oferty</th>
              <th>Zgłoszenia</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredCompanies.map((company) => (
              <tr
                key={company.id}
                className="company-list-row"
                onClick={() => navigate(`/companies/${company.id}`)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(`/companies/${company.id}`);
                  }
                }}
              >
                <td>
                  <strong>{company.name}</strong>
                  {company.email && <span>{company.email}</span>}
                </td>
                <td>{company.nip || "-"}</td>
                <td>{company.city || "-"}</td>
                  <td>{company.employee_count ?? 0}</td>
                  <td>{company.site_count ?? 0}</td>
                  <td>{company.offer_count ?? 0}</td>
                  <td>{company.ticket_count ?? 0}</td>
                <td>
                  <span className={company.is_active === false ? "status-pill inactive" : "status-pill"}>
                    {company.is_active === false ? "Nieaktywna" : "Aktywna"}
                  </span>
                </td>
              </tr>
            ))}
            {filteredCompanies.length === 0 && (
              <tr>
                <td colSpan="8">Brak firm pasujących do wyszukiwania.</td>
              </tr>
            )}
          </tbody>
          </table>
        </div>
      ) : (
        <section className="companies-kanban-board" aria-label="Firmy klientow w widoku Kanban">
          {kanbanColumns.map((column) => (
            <section className={`company-kanban-column ${column.id}`} key={column.id}>
              <header className="company-kanban-column-header">
                <div>
                  <span>{column.label}</span>
                  <small>{column.companies.length} firm</small>
                </div>
                <strong>{column.companies.length}</strong>
              </header>
              <div className="company-kanban-stack">
                {column.companies.map((company) => (
                  <article
                    className="company-kanban-card"
                    key={company.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/companies/${company.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(`/companies/${company.id}`);
                      }
                    }}
                  >
                    <header className="company-kanban-card-header">
                      <span className="company-kanban-icon"><Building2 size={20} aria-hidden="true" /></span>
                      <div>
                        <h2>{company.name}</h2>
                        <span className="company-kanban-location"><MapPin size={14} aria-hidden="true" />{company.city || "Brak miasta"}</span>
                      </div>
                      <span className={company.is_active === false ? "status-pill inactive" : "status-pill"}>
                        {company.is_active === false ? "Nieaktywna" : "Aktywna"}
                      </span>
                    </header>
                    <p className="company-kanban-contact">{company.email || "Brak adresu e-mail"}</p>
                    <dl className="company-kanban-stats">
                      <div><dt><Users size={16} aria-hidden="true" />Pracownicy</dt><dd>{company.employee_count ?? 0}</dd></div>
                      <div><dt><Building2 size={16} aria-hidden="true" />Obiekty</dt><dd>{company.site_count ?? 0}</dd></div>
                      <div><dt><FileText size={16} aria-hidden="true" />Oferty</dt><dd>{company.offer_count ?? 0}</dd></div>
                      <div><dt><Wrench size={16} aria-hidden="true" />Zgloszenia</dt><dd>{company.ticket_count ?? 0}</dd></div>
                    </dl>
                    <footer className="company-kanban-card-footer">
                      <span>NIP: {company.nip || "Brak"}</span>
                      <ChevronRight size={18} aria-hidden="true" />
                    </footer>
                  </article>
                ))}
                {column.companies.length === 0 && <div className="company-kanban-empty">Brak firm w tej grupie.</div>}
              </div>
            </section>
          ))}
          {filteredCompanies.length === 0 && <div className="company-kanban-no-results">Brak firm pasujacych do wyszukiwania.</div>}
        </section>
      )}

      {showForm && (
        <CompanyFormModal
          formData={formData}
          editingCompany={null}
          onChange={setFormData}
          onClose={() => setShowForm(false)}
          onSubmit={saveCompany}
        />
      )}
    </div>
  );
}
