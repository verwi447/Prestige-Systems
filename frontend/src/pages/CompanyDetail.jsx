import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { companies } from "../api";
import AppState from "../components/AppState";
import ConfirmationModal from "../components/ConfirmationModal";
import { getRequestErrorMessage, showFeedback, showSuccess } from "../lib/feedback";
import CompanyContractsTab from "./companies/CompanyContractsTab";
import CompanyDataTab from "./companies/CompanyDataTab";
import CompanyFormModal from "./companies/CompanyFormModal";
import { createCompanyFormData } from "./companies/companyFormData";
import CompanyTicketsTab from "./companies/CompanyTicketsTab";
import "./Companies.css";

const CompanyEmployeesTab = lazy(() => import("./companies/CompanyEmployeesTab"));
const CompanySitesTab = lazy(() => import("./companies/CompanySitesTab"));
const CompanyOffersTab = lazy(() => import("./companies/CompanyOffersTab"));

const tabs = [
  { id: "data", label: "Dane firmy" },
  { id: "employees", label: "Pracownicy" },
  { id: "sites", label: "Obiekty" },
  { id: "offers", label: "Oferty" },
  { id: "tickets", label: "Zgłoszenia" },
  { id: "contracts", label: "Umowy" }
];

export default function CompanyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [company, setCompany] = useState(null);
  const [activeTab, setActiveTab] = useState("data");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(createCompanyFormData());
  const [companyToDelete, setCompanyToDelete] = useState(null);

  const companyId = useMemo(() => Number(id), [id]);

  const loadCompany = useCallback(async () => {
    const response = await companies.getById(companyId);
    setCompany(response.data);
    setFormData(createCompanyFormData(response.data));
  }, [companyId]);

  useEffect(() => {
    setLoading(true);
    loadCompany()
      .catch((error) => setMessage(getRequestErrorMessage(error, "Nie udalo sie pobrac firmy.")))
      .finally(() => setLoading(false));
  }, [loadCompany]);

  const saveCompany = async () => {
    if (!formData.name.trim()) {
      showFeedback({ message: "Wpisz nazwe firmy przed zapisem.", type: "warning" });
      return;
    }
    try {
      await companies.update(companyId, formData);
      setShowForm(false);
      await loadCompany();
      setMessage("");
      showSuccess("Dane firmy zostaly zapisane.");
    } catch (error) {
      setMessage(getRequestErrorMessage(error, "Nie udalo sie zapisac firmy."));
    }
  };

  const deleteCompany = async () => {
    try {
      await companies.delete(companyId);
      showSuccess("Firma zostala usunieta.");
      navigate("/companies");
    } catch (error) {
      setMessage(getRequestErrorMessage(error, "Nie udalo sie usunac firmy."));
    } finally {
      setCompanyToDelete(null);
    }
  };

  if (loading) return <div className="page company-detail-page"><AppState variant="loading" title="Ladowanie firmy" description="Pobieramy dane klienta i jego zasoby." /></div>;
  if (!company) return <div className="page company-detail-page"><AppState variant="error" title="Nie znaleziono firmy" description={message || "Firma nie istnieje albo nie masz do niej dostepu."} actionLabel="Wroc do firm" onAction={() => navigate("/companies")} /></div>;

  return (
    <div className="page company-detail-page">
      <nav className="company-breadcrumb">
        <Link to="/companies">Firmy</Link>
        <span>&gt;</span>
        <strong>{company.name}</strong>
      </nav>

      {message && <div className="settings-message">{message}</div>}

      <header className="company-detail-header">
        <div>
          <span className="page-kicker">Firma klienta</span>
          <h1>{company.name}</h1>
          <div className="company-header-meta">
            <span>NIP: {company.nip || "-"}</span>
            <span className={company.is_active === false ? "status-pill inactive" : "status-pill"}>
              {company.is_active === false ? "Nieaktywna" : "Aktywna"}
            </span>
          </div>
        </div>
        <div className="company-header-actions">
          <button className="btn btn-secondary" onClick={() => setShowForm(true)}>Edytuj</button>
          <button className="btn btn-delete" onClick={() => setCompanyToDelete(company)}>Usuń</button>
        </div>
      </header>

      <div className="company-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "data" && <CompanyDataTab company={company} />}
      {activeTab === "tickets" && <CompanyTicketsTab companyId={companyId} />}
      {activeTab === "contracts" && <CompanyContractsTab />}
      {(activeTab === "employees" || activeTab === "sites" || activeTab === "offers") && (
        <Suspense fallback={<AppState variant="loading" title="Ladowanie zakladki" description="Pobieramy dane." />}>
          {activeTab === "employees" && <CompanyEmployeesTab companyId={companyId} />}
          {activeTab === "sites" && <CompanySitesTab companyId={companyId} />}
          {activeTab === "offers" && <CompanyOffersTab companyId={companyId} onChangeTab={setActiveTab} />}
        </Suspense>
      )}

      {showForm && (
        <CompanyFormModal
          formData={formData}
          editingCompany={company}
          onChange={setFormData}
          onClose={() => setShowForm(false)}
          onSubmit={saveCompany}
        />
      )}

      <ConfirmationModal
        isOpen={!!companyToDelete}
        onClose={() => setCompanyToDelete(null)}
        onConfirm={deleteCompany}
        title="Usuń firmę"
        confirmText="Usuń"
      >
        <p>Czy na pewno chcesz usunąć firmę <strong>{companyToDelete?.name}</strong>?</p>
      </ConfirmationModal>
    </div>
  );
}
