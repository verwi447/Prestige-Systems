import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Edit3,
  FileText,
  Info,
  KeyRound,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRoundPlus,
  Users,
  UserX,
  Wrench
} from "lucide-react";
import { client as clientAPI } from "../api";
import AppState from "../components/AppState";
import BarrierCheckbox from "../components/BarrierCheckbox";
import { getRequestErrorMessage, showSuccess } from "../lib/feedback";
import { getStoredUser, hasClientPermission, isClientOwner } from "../lib/permissions";
import {
  ActivityList,
  CompanyInput,
  CompanyModal,
  EmployeeRow,
  EmployeeTableRow,
  Field,
  MAX_SITE_IMAGE_SIZE,
  SITE_IMAGE_TYPES,
  SiteImageUpload,
  SiteManagementCard,
  SiteMiniCard,
  StatCard,
  emptyCompanyForm,
  emptyEmployeeForm,
  emptySiteForm,
  formatDate,
  initials,
  legacyEmployeeUiEnabled,
  permissionOptions,
  siteActive,
  tabs
} from "./MyCompanyParts";
import "./MyCompany.css";

export default function MyCompany() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = getStoredUser();
  const canManageEmployees = isClientOwner(currentUser);
  const canManageSites = hasClientPermission(currentUser, "MANAGE_SITES");
  const canViewTickets = hasClientPermission(currentUser, "VIEW_TICKETS");
  const requestedTab = searchParams.get("tab") || "overview";
  const activeTab = !canManageEmployees && requestedTab === "employees" ? "overview" : requestedTab;
  const [summary, setSummary] = useState(null);
  const [company, setCompany] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [sites, setSites] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [siteFilters, setSiteFilters] = useState({ query: "", status: "all", city: "all" });
  const [employeeFilters, setEmployeeFilters] = useState({ query: "", role: "all", status: "all", site: "all" });
  const [employeePage, setEmployeePage] = useState(1);
  const [employeePageSize, setEmployeePageSize] = useState(10);
  const [employeeActionMenuId, setEmployeeActionMenuId] = useState(null);
  const [editCompanyOpen, setEditCompanyOpen] = useState(false);
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [resetEmployee, setResetEmployee] = useState(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [assignEmployee, setAssignEmployee] = useState(null);
  const [employeeSites, setEmployeeSites] = useState([]);
  const [employeeSiteQuery, setEmployeeSiteQuery] = useState("");
  const [siteOpen, setSiteOpen] = useState(false);
  const [assignSite, setAssignSite] = useState(null);
  const [assignedUserIds, setAssignedUserIds] = useState([]);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm);
  const [siteForm, setSiteForm] = useState(emptySiteForm);
  const [siteImageError, setSiteImageError] = useState("");

  const setTab = (tab) => {
    if (tab === "employees" && !canManageEmployees) return;
    setSearchParams({ tab });
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setMessage("");
    try {
      const [summaryRes, companyRes, employeesRes, sitesRes, activityRes] = await Promise.all([
        clientAPI.companySummary(),
        clientAPI.company(),
        canManageEmployees ? clientAPI.companyEmployees() : Promise.resolve({ data: [] }),
        clientAPI.companySites(),
        clientAPI.companyActivity()
      ]);
      setSummary(summaryRes.data);
      setCompany(companyRes.data);
      setEmployees(employeesRes.data || []);
      setSites(sitesRes.data || []);
      setActivity(activityRes.data || []);
    } catch (error) {
      setLoadError(getRequestErrorMessage(error, "Nie udalo sie pobrac danych firmy."));
    } finally {
      setLoading(false);
    }
  }, [canManageEmployees]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (canManageEmployees && searchParams.get("action") === "new") {
      setEmployeeOpen(true);
      setSearchParams({ tab: "employees" });
    }
  }, [canManageEmployees, searchParams, setSearchParams]);

  useEffect(() => () => {
    if (siteForm.imagePreview?.startsWith("blob:")) URL.revokeObjectURL(siteForm.imagePreview);
  }, [siteForm.imagePreview]);

  const stats = summary?.stats || {};
  const mainContact = summary?.mainContact || employees.find((item) => item.role === "CLIENT_OWNER") || employees[0];
  const overviewActivity = useMemo(() => (summary?.recentActivity?.length ? summary.recentActivity : activity).slice(0, 4), [summary, activity]);

  const cityOptions = useMemo(() => [...new Set(sites.map((site) => site.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pl")), [sites]);
  const filteredSites = useMemo(() => {
    const query = siteFilters.query.trim().toLowerCase();
    return sites.filter((site) => {
      const matchesQuery = !query || [site.name, site.address, site.city].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesStatus = siteFilters.status === "all" || (siteFilters.status === "active" ? siteActive(site) : !siteActive(site));
      const matchesCity = siteFilters.city === "all" || site.city === siteFilters.city;
      return matchesQuery && matchesStatus && matchesCity;
    });
  }, [sites, siteFilters]);

  const siteStats = useMemo(() => ({
    all: sites.length,
    active: sites.filter(siteActive).length,
    openTickets: sites.reduce((sum, site) => sum + Number(site.openTicketsCount || 0), 0),
    assignedEmployees: sites.reduce((sum, site) => sum + Number(site.assignedEmployeeCount || 0), 0)
  }), [sites]);

  const employeeStats = useMemo(() => ({
    all: employees.length,
    active: employees.filter((employee) => employee.isActive !== false).length,
    inactive: employees.filter((employee) => employee.isActive === false).length,
    assigned: employees.filter((employee) => Number(employee.assignedSiteCount || employee.assignedSiteIds?.length || 0) > 0).length
  }), [employees]);

  const filteredEmployees = useMemo(() => {
    const query = employeeFilters.query.trim().toLowerCase();
    return employees.filter((employee) => {
      const haystack = [employee.firstName, employee.lastName, employee.email, employee.phone].join(" ").toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesRole = employeeFilters.role === "all" || employee.role === employeeFilters.role;
      const matchesStatus = employeeFilters.status === "all" || (employeeFilters.status === "active" ? employee.isActive !== false : employee.isActive === false);
      const matchesSite = employeeFilters.site === "all" || (employee.assignedSiteIds || []).map(Number).includes(Number(employeeFilters.site));
      return matchesQuery && matchesRole && matchesStatus && matchesSite;
    });
  }, [employees, employeeFilters]);

  const employeePageCount = Math.max(1, Math.ceil(filteredEmployees.length / employeePageSize));
  const currentEmployeePage = Math.min(employeePage, employeePageCount);
  const pagedEmployees = filteredEmployees.slice((currentEmployeePage - 1) * employeePageSize, currentEmployeePage * employeePageSize);
  const employeeRangeStart = filteredEmployees.length ? (currentEmployeePage - 1) * employeePageSize + 1 : 0;
  const employeeRangeEnd = Math.min(currentEmployeePage * employeePageSize, filteredEmployees.length);

  useEffect(() => {
    setEmployeePage(1);
  }, [employeeFilters, employeePageSize]);

  const openEditCompany = () => {
    if (!canManageEmployees) return;
    const source = company || {};
    setCompanyForm({
      email: source.email || "",
      phone: source.phone || "",
      address: source.address || "",
      postalCode: source.postalCode || "",
      city: source.city || "",
      contactPersonName: source.contactPersonName || ""
    });
    setEditCompanyOpen(true);
  };

  const openNewEmployee = () => {
    if (!canManageEmployees) return;
    setEmployeeForm(emptyEmployeeForm);
    setEmployeeActionMenuId(null);
    setEmployeeOpen(true);
  };

  const openEditEmployee = (employee) => {
    if (!canManageEmployees || employee.role !== "CLIENT_EMPLOYEE") return;
    setEmployeeForm({
      id: employee.id,
      firstName: employee.firstName || "",
      lastName: employee.lastName || "",
      email: employee.email || "",
      phone: employee.phone || "",
      password: "",
      isActive: employee.isActive !== false,
      permissions: employee.permissions || []
    });
    setEmployeeActionMenuId(null);
    setEmployeeOpen(true);
  };

  const togglePermission = (permissionKey) => {
    setEmployeeForm((current) => ({
      ...current,
      permissions: current.permissions.includes(permissionKey)
        ? current.permissions.filter((permission) => permission !== permissionKey)
        : [...current.permissions, permissionKey]
    }));
  };

  const openNewSite = () => {
    if (!canManageSites) return;
    setSiteImageError("");
    setSiteForm(emptySiteForm);
    setSiteOpen(true);
  };

  const openEditSite = (site) => {
    if (!canManageSites) return;
    setSiteImageError("");
    setSiteForm({
      id: site.id,
      name: site.name || "",
      address: site.address || "",
      postalCode: site.postalCode || "",
      city: site.city || "",
      country: site.country || "Polska",
      description: site.description || "",
      isActive: siteActive(site),
      imageFile: null,
      imagePreview: "",
      existingImageUrl: site.imageUrl || "",
      removeImage: false
    });
    setSiteOpen(true);
  };

  const validateSiteImage = (file) => {
    if (!file) return "";
    if (!SITE_IMAGE_TYPES.has(file.type)) return "Zdjęcie musi być plikiem JPG, PNG albo WEBP.";
    if (file.size > MAX_SITE_IMAGE_SIZE) return "Zdjęcie może mieć maksymalnie 5 MB.";
    return "";
  };

  const setSiteImage = (file) => {
    const error = validateSiteImage(file);
    setSiteImageError(error);
    if (error) return;
    if (siteForm.imagePreview?.startsWith("blob:")) URL.revokeObjectURL(siteForm.imagePreview);
    setSiteForm({ ...siteForm, imageFile: file, imagePreview: file ? URL.createObjectURL(file) : "", removeImage: false });
  };

  const removeSiteImage = () => {
    if (siteForm.imagePreview?.startsWith("blob:")) URL.revokeObjectURL(siteForm.imagePreview);
    setSiteImageError("");
    setSiteForm({ ...siteForm, imageFile: null, imagePreview: "", existingImageUrl: "", removeImage: true });
  };

  const siteFormData = () => {
    const data = new FormData();
    data.append("name", siteForm.name);
    data.append("address", siteForm.address);
    data.append("postalCode", siteForm.postalCode);
    data.append("city", siteForm.city);
    data.append("country", siteForm.country || "Polska");
    data.append("description", siteForm.description || "");
    data.append("isActive", String(siteForm.isActive));
    data.append("removeImage", String(siteForm.removeImage));
    if (siteForm.imageFile) data.append("image", siteForm.imageFile);
    return data;
  };

  const saveCompany = async () => {
    if (!canManageEmployees) return;
    try {
      await clientAPI.updateCompany(companyForm);
      setEditCompanyOpen(false);
      await loadData();
      showSuccess("Dane firmy zostaly zapisane.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać danych firmy.");
    }
  };

  const addEmployee = async () => {
    try {
      await clientAPI.createCompanyEmployee(employeeForm);
      setEmployeeForm(emptyEmployeeForm);
      setEmployeeOpen(false);
      setTab("employees");
      await loadData();
      showSuccess("Pracownik zostal dodany.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się dodać pracownika.");
    }
  };

  const saveEmployee = async () => {
    if (!canManageEmployees) return;
    if (!employeeForm.firstName.trim() || !employeeForm.lastName.trim() || !employeeForm.email.trim()) {
      setMessage("Imię, nazwisko i e-mail są wymagane.");
      return;
    }
    if (!employeeForm.id && employeeForm.password.trim().length < 8) {
      setMessage("Hasło musi mieć minimum 8 znaków.");
      return;
    }

    const payload = {
      firstName: employeeForm.firstName,
      lastName: employeeForm.lastName,
      email: employeeForm.email,
      phone: employeeForm.phone,
      isActive: employeeForm.isActive,
      permissions: employeeForm.permissions
    };
    if (!employeeForm.id) payload.password = employeeForm.password;

    try {
      if (employeeForm.id) await clientAPI.updateCompanyEmployee(employeeForm.id, payload);
      else await clientAPI.createCompanyEmployee(payload);
      setEmployeeForm(emptyEmployeeForm);
      setEmployeeOpen(false);
      setTab("employees");
      await loadData();
      showSuccess(employeeForm.id ? "Dane pracownika zostaly zapisane." : "Pracownik zostal dodany.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać pracownika.");
    }
  };

  const openResetEmployee = (employee) => {
    if (!canManageEmployees || employee.role !== "CLIENT_EMPLOYEE") return;
    setTemporaryPassword("");
    setResetEmployee(employee);
    setEmployeeActionMenuId(null);
  };

  const resetEmployeePassword = async () => {
    try {
      const response = await clientAPI.resetCompanyEmployeePassword(resetEmployee.id);
      setTemporaryPassword(response.data?.temporaryPassword || "");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zresetować hasła.");
      setResetEmployee(null);
    }
  };

  const openAssignEmployee = async (employee) => {
    if (!canManageEmployees) return;
    setEmployeeActionMenuId(null);
    setAssignEmployee(employee);
    setEmployeeSiteQuery("");
    try {
      const response = await clientAPI.companyEmployeeSites(employee.id);
      setEmployeeSites(response.data || []);
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się pobrać przypisań pracownika.");
      setAssignEmployee(null);
    }
  };

  const saveEmployeeSites = async () => {
    if (!canManageEmployees) return;
    const siteIds = employeeSites.filter((site) => site.assigned).map((site) => site.id);
    try {
      await clientAPI.updateCompanyEmployeeSites(assignEmployee.id, siteIds);
      setAssignEmployee(null);
      setEmployeeSites([]);
      await loadData();
      showSuccess("Przypisania obiektow zostaly zapisane.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać przypisań.");
    }
  };

  const saveSite = async () => {
    if (!canManageSites) return;
    if (!siteForm.name.trim() || !siteForm.address.trim() || !siteForm.city.trim()) {
      setSiteImageError("Nazwa, adres i miasto są wymagane.");
      return;
    }
    if (siteImageError) return;
    try {
      if (siteForm.id) await clientAPI.updateCompanySite(siteForm.id, siteFormData());
      else await clientAPI.createCompanySite(siteFormData());
      setSiteForm(emptySiteForm);
      setSiteOpen(false);
      setTab("sites");
      setMessage("Obiekt został zapisany.");
      await loadData();
      showSuccess(siteForm.id ? "Obiekt zostal zapisany." : "Obiekt zostal dodany.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać obiektu.");
    }
  };

  const toggleEmployee = async (employee) => {
    if (!canManageEmployees) return;
    await clientAPI.updateCompanyEmployeeStatus(employee.id, { isActive: !employee.isActive });
    await loadData();
  };

  const openAssignUsers = async (site) => {
    if (!canManageEmployees) return;
    setAssignSite(site);
    const response = await clientAPI.companySiteUsers(site.id);
    setAssignedUserIds((response.data || []).map((employee) => employee.id));
  };

  const saveAssignedUsers = async () => {
    if (!canManageEmployees) return;
    await clientAPI.updateCompanySiteUsers(assignSite.id, assignedUserIds);
    setAssignSite(null);
    await loadData();
  };

  if (loading) return <div className="page my-company-page"><AppState variant="loading" title="Ladowanie firmy" description="Pobieramy dane firmy, pracownikow i obiekty." /></div>;

  if (!company) {
    return (
      <div className="page my-company-page">
        <AppState
          variant={loadError ? "error" : "empty"}
          title={loadError ? "Nie udalo sie pobrac firmy" : "Brak przypisanej firmy"}
          description={loadError || "Nie jestes przypisany do zadnej firmy. Skontaktuj sie z wlascicielem konta."}
          actionLabel={loadError ? "Sprobuj ponownie" : undefined}
          onAction={loadError ? loadData : undefined}
        />
      </div>
    );
  }

  return (
    <div className="page my-company-page">
      <header className="company-page-header">
        <div>
          <h1>{activeTab === "sites" ? "Obiekty" : activeTab === "employees" ? "Pracownicy" : "Moja firma"}</h1>
          <p>{activeTab === "sites" ? "Zarządzaj lokalizacjami swojej firmy, przypisaniami pracowników i zgłoszeniami serwisowymi." : "Zarządzaj danymi swojej firmy, pracownikami, obiektami oraz ustawieniami konta."}</p>
        </div>
        <div className="company-header-actions">
          {activeTab === "sites" && canManageSites ? (
            <button className="company-primary-button" type="button" onClick={openNewSite}><Plus size={18} /> Dodaj obiekt</button>
          ) : activeTab === "employees" && canManageEmployees ? (
            <button className="company-primary-button" type="button" onClick={openNewEmployee}><Plus size={18} /> Dodaj pracownika</button>
          ) : canManageEmployees ? (
            <>
              <button className="company-secondary-button" type="button" onClick={openEditCompany}><Edit3 size={17} /> Edytuj dane firmy</button>
              <button className="company-primary-button" type="button" onClick={openNewEmployee}><Plus size={18} /> Dodaj pracownika</button>
            </>
          ) : null}
        </div>
      </header>

      {message && <div className="settings-message">{message}</div>}

      {activeTab === "sites" ? (
        <section className="company-stats-grid">
          <StatCard icon={Users} tone="green" value={siteStats.all} title="Wszystkie obiekty" subtitle="Wszystkie lokalizacje firmy" />
          <StatCard icon={ShieldCheck} tone="green" value={siteStats.active} title="Aktywne" subtitle="Aktywne lokalizacje" />
          <StatCard icon={Wrench} tone="orange" value={siteStats.openTickets} title="Otwarte zgłoszenia" subtitle="Wymagają uwagi" />
          <StatCard icon={Users} tone="blue" value={siteStats.assignedEmployees} title="Przypisani pracownicy" subtitle="Łącznie we wszystkich obiektach" />
        </section>
      ) : activeTab === "employees" ? (
        <section className="company-stats-grid">
          <StatCard icon={Users} tone="green" value={employeeStats.all} title="Wszyscy pracownicy" subtitle="Łącznie w firmie" />
          <StatCard icon={CheckCircle2} tone="green" value={employeeStats.active} title="Aktywni" subtitle="Aktywni użytkownicy" />
          <StatCard icon={UserX} tone="orange" value={employeeStats.inactive} title="Nieaktywni" subtitle="Nieaktywni użytkownicy" />
          <StatCard icon={Building2} tone="blue" value={employeeStats.assigned} title="Przypisani do obiektów" subtitle="Mają dostęp do lokalizacji" />
        </section>
      ) : (
        <section className="company-stats-grid">
          <StatCard icon={Users} tone="green" value={stats.employeesCount ?? employees.length} title="Pracowników" subtitle="Aktywni użytkownicy" />
          <StatCard icon={Building2} tone="blue" value={stats.sitesCount ?? sites.length} title="Obiektów" subtitle="Przypisane lokalizacje" />
          <StatCard icon={ClipboardList} tone="orange" value={stats.openTicketsCount ?? 0} title="Otwarte zgłoszenia" subtitle="Wymagają uwagi" />
          <StatCard icon={FileText} tone="red" value={stats.offersCount ?? 0} title="Ofert" subtitle={`Do akceptacji: ${stats.offersToAcceptCount ?? 0}`} />
        </section>
      )}

      <nav className="company-tabs" aria-label="Zakładki firmy">
        {tabs.filter((tab) => tab.id !== "employees" || canManageEmployees).map((tab) => (
          <button key={tab.id} className={activeTab === tab.id ? "active" : ""} type="button" onClick={() => setTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && (
        <div className="company-overview-grid">
          <section className="company-panel-card wide">
            <div className="company-section-header"><h2>Podstawowe informacje</h2></div>
            <div className="company-info-grid">
              <Field label="Nazwa firmy" value={company.name} />
              <Field label="Adres" value={company.address} />
              <Field label="NIP" value={company.nip} />
              <Field label="Kod pocztowy" value={company.postalCode} />
              <Field label="REGON" value={company.regon} />
              <Field label="Miasto" value={company.city} />
              <Field label="E-mail" value={company.email} />
              <Field label="Kraj" value={company.country} />
              <Field label="Telefon" value={company.phone} />
              <Field label="Osoba kontaktowa" value={company.contactPersonName || [mainContact?.firstName, mainContact?.lastName].filter(Boolean).join(" ")} />
            </div>
            <button className="company-small-button" type="button" onClick={() => setTab("data")}>Zobacz pełne dane</button>
          </section>

          <section className="company-panel-card">
            <div className="company-section-header">
              <h2>Status firmy</h2>
              <span className="company-status-badge">{company.status || "Aktywna"}</span>
            </div>
            <div className="company-status-list">
              <Field label="Data utworzenia konta" value={formatDate(company.createdAt)} />
              <Field label="Liczba pracowników" value={stats.employeesCount ?? employees.length} />
              <Field label="Liczba obiektów" value={stats.sitesCount ?? sites.length} />
              <div className="company-contact-card">
                <span className="company-avatar">{initials(mainContact?.firstName, mainContact?.lastName, mainContact?.email)}</span>
                <div>
                  <strong>{[mainContact?.firstName, mainContact?.lastName].filter(Boolean).join(" ") || "-"}</strong>
                  <small>{mainContact?.email || "-"}</small>
                  <small>{mainContact?.phone || "-"}</small>
                </div>
              </div>
            </div>
          </section>

          <section className="company-panel-card wide">
            <div className="company-section-header">
              <h2>Ostatnie obiekty</h2>
              <button type="button" onClick={() => setTab("sites")}>Zobacz wszystkie</button>
            </div>
            <div className="company-sites-grid">
              {(summary?.recentSites || sites).slice(0, 4).map((site) => <SiteMiniCard key={site.id} site={site} />)}
              {!sites.length && <p className="company-empty">Brak obiektów.</p>}
            </div>
          </section>

          {canManageEmployees && <section className="company-panel-card">
            <div className="company-section-header">
              <h2>Ostatni pracownicy</h2>
              <button type="button" onClick={() => setTab("employees")}>Zobacz wszystkich</button>
            </div>
            <div className="company-employees-list">
              {(summary?.recentEmployees || employees).slice(0, 4).map((employee) => <EmployeeRow key={employee.id} employee={employee} compact />)}
              {!employees.length && <p className="company-empty">Brak pracowników.</p>}
            </div>
          </section>}

          <section className="company-panel-card full">
            <div className="company-section-header">
              <h2>Ostatnia aktywność</h2>
              <button type="button" onClick={() => setTab("activity")}>Zobacz całą aktywność</button>
            </div>
            <ActivityList items={overviewActivity} />
          </section>
        </div>
      )}

      {activeTab === "data" && (
        <section className="company-panel-card full">
          <div className="company-section-header"><h2>Dane firmy</h2></div>
          <div className="company-data-grid">
            <Field label="Nazwa firmy" value={company.name} />
            <Field label="NIP" value={company.nip} note="Zmiana tych danych wymaga kontaktu z administratorem." />
            <Field label="REGON" value={company.regon} note="Zmiana tych danych wymaga kontaktu z administratorem." />
            <Field label="E-mail" value={company.email} />
            <Field label="Telefon" value={company.phone} />
            <Field label="Adres" value={company.address} />
            <Field label="Kod pocztowy" value={company.postalCode} />
            <Field label="Miasto" value={company.city} />
            <Field label="Kraj" value={company.country} />
            <Field label="Status" value={company.status} />
            <Field label="Data utworzenia" value={formatDate(company.createdAt)} />
            <Field label="Data ostatniej aktualizacji" value={formatDate(company.updatedAt)} />
          </div>
        </section>
      )}

      {activeTab === "employees" && (
        <section className="employees-tab-panel">
          <div className="employees-filter-card">
            <label className="employees-search">
              <Search size={18} />
              <input value={employeeFilters.query} onChange={(event) => setEmployeeFilters({ ...employeeFilters, query: event.target.value })} placeholder="Szukaj po imieniu, nazwisku, e-mailu lub telefonie..." />
            </label>
            <label><span>Rola</span><select value={employeeFilters.role} onChange={(event) => setEmployeeFilters({ ...employeeFilters, role: event.target.value })}><option value="all">Wszystkie</option><option value="CLIENT_OWNER">Właściciel konta</option><option value="CLIENT_EMPLOYEE">Pracownik</option></select></label>
            <label><span>Status</span><select value={employeeFilters.status} onChange={(event) => setEmployeeFilters({ ...employeeFilters, status: event.target.value })}><option value="all">Wszystkie</option><option value="active">Aktywni</option><option value="inactive">Nieaktywni</option></select></label>
            <label><span>Obiekt</span><select value={employeeFilters.site} onChange={(event) => setEmployeeFilters({ ...employeeFilters, site: event.target.value })}><option value="all">Wszystkie obiekty</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
            <button type="button" onClick={() => setEmployeeFilters({ query: "", role: "all", status: "all", site: "all" })}><RotateCcw size={16} /> Wyczyść filtry</button>
          </div>

          <div className="employees-table-card">
            {filteredEmployees.length ? (
              <>
                <div className="employees-table-scroll">
                  <table className="employees-table">
                    <colgroup>
                      <col className="employee-col-person" />
                      <col className="employee-col-email" />
                      <col className="employee-col-phone" />
                      <col className="employee-col-role" />
                      <col className="employee-col-status" />
                      <col className="employee-col-sites" />
                      <col className="employee-col-permissions" />
                      <col className="employee-col-login" />
                      <col className="employee-col-actions" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Pracownik</th><th>E-mail</th><th>Telefon</th><th>Rola</th><th>Status</th><th>Obiekty</th><th>Uprawnienia</th><th>Ostatnie logowanie</th><th>Akcje</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedEmployees.map((employee) => (
                        <EmployeeTableRow key={employee.id} employee={employee} actionMenuId={employeeActionMenuId} setActionMenuId={setEmployeeActionMenuId} onEdit={openEditEmployee} onReset={openResetEmployee} onAssign={openAssignEmployee} onToggle={toggleEmployee} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <footer className="employees-pagination">
                  <span>Wyświetlanie {employeeRangeStart}-{employeeRangeEnd} z {filteredEmployees.length} pracowników</span>
                  <div>
                    <button type="button" disabled={currentEmployeePage <= 1} onClick={() => setEmployeePage((page) => Math.max(1, page - 1))}><ChevronLeft size={16} /></button>
                    <strong>{currentEmployeePage}</strong>
                    {employeePageCount > 1 && <button type="button" onClick={() => setEmployeePage(2)}>2</button>}
                    <button type="button" disabled={currentEmployeePage >= employeePageCount} onClick={() => setEmployeePage((page) => Math.min(employeePageCount, page + 1))}><ChevronRight size={16} /></button>
                    <select value={employeePageSize} onChange={(event) => setEmployeePageSize(Number(event.target.value))}><option value={10}>10 / stronę</option><option value={20}>20 / stronę</option><option value={50}>50 / stronę</option></select>
                  </div>
                </footer>
              </>
            ) : (
              <div className="employee-empty-state">
                <Users size={42} />
                <h3>Brak pracowników</h3>
                <p>Dodaj pierwszego pracownika, aby umożliwić mu dostęp do ofert, zgłoszeń i obiektów.</p>
                <button className="company-primary-button" type="button" onClick={openNewEmployee}><Plus size={17} /> Dodaj pracownika</button>
              </div>
            )}
          </div>

          <div className="employee-info-card">
            <span><Info size={18} /></span>
            <div><h3>Role i uprawnienia</h3><p>Tylko właściciel konta może zarządzać pracownikami i uprawnieniami. Pracownicy mają dostęp tylko do przypisanych obiektów i funkcji zgodnie z nadanymi uprawnieniami.</p></div>
            <button type="button">Dowiedz się więcej</button>
          </div>
        </section>
      )}

      {legacyEmployeeUiEnabled && activeTab === "employees" && (
        <section className="company-panel-card full">
          <div className="company-section-header">
            <h2>Pracownicy</h2>
            <button type="button" onClick={() => setEmployeeOpen(true)}><UserRoundPlus size={16} /> Dodaj pracownika</button>
          </div>
          <div className="company-table-like">
            {employees.map((employee) => <EmployeeRow key={employee.id} employee={employee} onToggle={toggleEmployee} />)}
            {!employees.length && <p className="company-empty">Brak pracowników.</p>}
          </div>
        </section>
      )}

      {activeTab === "sites" && (
        <section className="sites-tab-panel">
          <div className="sites-filter-card">
            <label className="sites-search"><Search size={18} /><input value={siteFilters.query} onChange={(event) => setSiteFilters({ ...siteFilters, query: event.target.value })} placeholder="Szukaj po nazwie, adresie lub mieście..." /></label>
            <label><span>Status</span><select value={siteFilters.status} onChange={(event) => setSiteFilters({ ...siteFilters, status: event.target.value })}><option value="all">Wszystkie</option><option value="active">Aktywne</option><option value="inactive">Nieaktywne</option></select></label>
            <label><span>Miasto</span><select value={siteFilters.city} onChange={(event) => setSiteFilters({ ...siteFilters, city: event.target.value })}><option value="all">Wszystkie</option>{cityOptions.map((city) => <option key={city} value={city}>{city}</option>)}</select></label>
            <button type="button" onClick={() => setSiteFilters({ query: "", status: "all", city: "all" })}><RotateCcw size={16} /> Wyczyść filtry</button>
          </div>

          <div className={`sites-card-grid ${canManageSites ? "" : "read-only"}`}>
            {filteredSites.map((site) => <SiteManagementCard key={site.id} site={site} onEdit={openEditSite} onAssign={openAssignUsers} canManageSites={canManageSites} canManageEmployees={canManageEmployees} canViewTickets={canViewTickets} />)}
            <article className="site-add-card">
              <span><Building2 size={38} /><Plus size={18} /></span>
              <h3>Dodaj nowy obiekt</h3>
              <p>Rozpocznij zarządzanie nową lokalizacją swojej firmy.</p>
              <button className="company-primary-button" type="button" onClick={openNewSite}><Plus size={17} /> Dodaj obiekt</button>
            </article>
          </div>

          {!sites.length && (
            <div className={`sites-empty-state ${canManageSites ? "" : "read-only"}`}>
              <Building2 size={42} />
              <h3>Brak obiektów</h3>
              <p>Dodaj pierwszy obiekt, aby przypisywać pracowników i tworzyć zgłoszenia serwisowe.</p>
              <button className="company-primary-button" type="button" onClick={openNewSite}><Plus size={17} /> Dodaj obiekt</button>
            </div>
          )}

          <footer className="sites-pagination">
            <div><button type="button" disabled>‹</button><strong>1</strong><button type="button" disabled>›</button></div>
            <span>Wyświetlanie {filteredSites.length ? `1-${filteredSites.length}` : "0"} z {sites.length} obiektów</span>
          </footer>
        </section>
      )}

      {activeTab === "documents" && (
        <section className="company-panel-card full">
          <div className="company-section-header"><h2>Dane do dokumentów</h2></div>
          <div className="company-data-grid">
            <Field label="Nazwa do dokumentów" value={company.name} />
            <Field label="NIP" value={company.nip} />
            <Field label="Adres rozliczeniowy" value={[company.address, company.postalCode, company.city].filter(Boolean).join(", ")} />
            <Field label="E-mail do korespondencji" value={company.email} />
            <Field label="Osoba kontaktowa" value={company.contactPersonName || [mainContact?.firstName, mainContact?.lastName].filter(Boolean).join(" ")} />
            <Field label="Telefon kontaktowy" value={company.phone || mainContact?.phone} />
          </div>
        </section>
      )}

      {activeTab === "activity" && (
        <section className="company-panel-card full">
          <div className="company-section-header"><h2>Aktywność</h2></div>
          <ActivityList items={activity} />
        </section>
      )}

      {canManageEmployees && editCompanyOpen && (
        <CompanyModal title="Edytuj dane firmy" onClose={() => setEditCompanyOpen(false)} onSave={saveCompany}>
          <CompanyInput label="E-mail" value={companyForm.email} onChange={(email) => setCompanyForm({ ...companyForm, email })} />
          <CompanyInput label="Telefon" value={companyForm.phone} onChange={(phone) => setCompanyForm({ ...companyForm, phone })} />
          <CompanyInput label="Adres" value={companyForm.address} onChange={(address) => setCompanyForm({ ...companyForm, address })} />
          <CompanyInput label="Kod pocztowy" value={companyForm.postalCode} onChange={(postalCode) => setCompanyForm({ ...companyForm, postalCode })} />
          <CompanyInput label="Miasto" value={companyForm.city} onChange={(city) => setCompanyForm({ ...companyForm, city })} />
          <CompanyInput label="Osoba kontaktowa" value={companyForm.contactPersonName} onChange={(contactPersonName) => setCompanyForm({ ...companyForm, contactPersonName })} />
        </CompanyModal>
      )}

      {canManageEmployees && employeeOpen && (
        <CompanyModal
          title={employeeForm.id ? "Edytuj pracownika" : "Dodaj pracownika"}
          onClose={() => setEmployeeOpen(false)}
          onSave={saveEmployee}
          wide
          saveLabel={employeeForm.id ? "Zapisz zmiany" : "Dodaj pracownika"}
        >
          <div className="employee-modal-column">
            <h3>Dane pracownika</h3>
            <CompanyInput label="Imię" value={employeeForm.firstName} onChange={(firstName) => setEmployeeForm({ ...employeeForm, firstName })} />
            <CompanyInput label="Nazwisko" value={employeeForm.lastName} onChange={(lastName) => setEmployeeForm({ ...employeeForm, lastName })} />
            <CompanyInput label="E-mail" value={employeeForm.email} onChange={(email) => setEmployeeForm({ ...employeeForm, email })} />
            <CompanyInput label="Telefon" value={employeeForm.phone} onChange={(phone) => setEmployeeForm({ ...employeeForm, phone })} />
            {!employeeForm.id && <CompanyInput label="Hasło" type="password" value={employeeForm.password} onChange={(password) => setEmployeeForm({ ...employeeForm, password })} />}
            <BarrierCheckbox className="site-active-toggle" checked={employeeForm.isActive} onChange={(value) => setEmployeeForm({ ...employeeForm, isActive: value })} label="Aktywny" />
          </div>
          <div className="employee-modal-column">
            <h3>Uprawnienia</h3>
            <div className="permission-grid">
              {permissionOptions.map((permission) => (
                <label key={permission.key} className={employeeForm.permissions.includes(permission.key) ? "permission-card checked" : "permission-card"}>
                  <input type="checkbox" checked={employeeForm.permissions.includes(permission.key)} onChange={() => togglePermission(permission.key)} />
                  <span>
                    <strong>{permission.title}</strong>
                    <small>{permission.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </CompanyModal>
      )}

      {legacyEmployeeUiEnabled && employeeOpen && (
        <CompanyModal title="Dodaj pracownika" onClose={() => setEmployeeOpen(false)} onSave={addEmployee}>
          <CompanyInput label="Imię" value={employeeForm.firstName} onChange={(firstName) => setEmployeeForm({ ...employeeForm, firstName })} />
          <CompanyInput label="Nazwisko" value={employeeForm.lastName} onChange={(lastName) => setEmployeeForm({ ...employeeForm, lastName })} />
          <CompanyInput label="E-mail" value={employeeForm.email} onChange={(email) => setEmployeeForm({ ...employeeForm, email })} />
          <CompanyInput label="Telefon" value={employeeForm.phone} onChange={(phone) => setEmployeeForm({ ...employeeForm, phone })} />
          <CompanyInput label="Hasło" type="password" value={employeeForm.password} onChange={(password) => setEmployeeForm({ ...employeeForm, password })} />
        </CompanyModal>
      )}

      {canManageEmployees && resetEmployee && (
        <CompanyModal title="Resetuj hasło" onClose={() => setResetEmployee(null)} onSave={temporaryPassword ? () => setResetEmployee(null) : resetEmployeePassword} saveLabel={temporaryPassword ? "Zamknij" : "Resetuj hasło"}>
          <div className="reset-password-content">
            <span className="reset-password-icon"><KeyRound size={22} /></span>
            <p>Czy chcesz zresetować hasło pracownika <strong>{[resetEmployee.firstName, resetEmployee.lastName].filter(Boolean).join(" ") || resetEmployee.email}</strong>?</p>
            {temporaryPassword && <div className="temporary-password-box"><small>Hasło tymczasowe</small><strong>{temporaryPassword}</strong></div>}
          </div>
        </CompanyModal>
      )}

      {canManageEmployees && assignEmployee && (
        <CompanyModal title="Przypisz pracownika do obiektów" onClose={() => setAssignEmployee(null)} onSave={saveEmployeeSites} wide saveLabel="Zapisz przypisania">
          <div className="assign-employee-header">
            <span className="company-avatar">{initials(assignEmployee.firstName, assignEmployee.lastName, assignEmployee.email)}</span>
            <div><strong>{[assignEmployee.firstName, assignEmployee.lastName].filter(Boolean).join(" ") || assignEmployee.email}</strong><small>{assignEmployee.email}</small></div>
          </div>
          <label className="employees-search assign-search"><Search size={18} /><input value={employeeSiteQuery} onChange={(event) => setEmployeeSiteQuery(event.target.value)} placeholder="Szukaj obiektu..." /></label>
          <div className="assign-sites-counter">Przypisano {employeeSites.filter((site) => site.assigned).length} z {employeeSites.length} obiektów</div>
          <div className="assign-sites-list">
            {employeeSites
              .filter((site) => !employeeSiteQuery.trim() || [site.name, site.address, site.city].join(" ").toLowerCase().includes(employeeSiteQuery.trim().toLowerCase()))
              .map((site) => (
                <label key={site.id}>
                  <input type="checkbox" checked={Boolean(site.assigned)} onChange={(event) => setEmployeeSites((current) => current.map((item) => item.id === site.id ? { ...item, assigned: event.target.checked } : item))} />
                  <span><strong>{site.name}</strong><small>{[site.address, site.city].filter(Boolean).join(", ") || "-"}</small></span>
                  <em>{siteActive(site) ? "Aktywny" : "Nieaktywny"}</em>
                </label>
              ))}
          </div>
        </CompanyModal>
      )}

      {canManageSites && siteOpen && (
        <CompanyModal title={siteForm.id ? "Edytuj obiekt" : "Dodaj obiekt"} onClose={() => setSiteOpen(false)} onSave={saveSite} wide saveLabel="Zapisz obiekt">
          <SiteImageUpload form={siteForm} error={siteImageError} setFile={setSiteImage} removeImage={removeSiteImage} />
          <CompanyInput label="Nazwa obiektu" value={siteForm.name} onChange={(name) => setSiteForm({ ...siteForm, name })} />
          <CompanyInput label="Adres" value={siteForm.address} onChange={(address) => setSiteForm({ ...siteForm, address })} />
          <CompanyInput label="Kod pocztowy" value={siteForm.postalCode} onChange={(postalCode) => setSiteForm({ ...siteForm, postalCode })} />
          <CompanyInput label="Miasto" value={siteForm.city} onChange={(city) => setSiteForm({ ...siteForm, city })} />
          <CompanyInput label="Kraj" value={siteForm.country} onChange={(country) => setSiteForm({ ...siteForm, country })} />
          <label className="company-form-field full"><span>Opis</span><textarea value={siteForm.description} onChange={(event) => setSiteForm({ ...siteForm, description: event.target.value })} rows="3" /></label>
          <BarrierCheckbox className="site-active-toggle" checked={siteForm.isActive} onChange={(value) => setSiteForm({ ...siteForm, isActive: value })} label="Aktywny" />
        </CompanyModal>
      )}

      {canManageEmployees && assignSite && (
        <CompanyModal title={`Przypisz pracowników: ${assignSite.name}`} onClose={() => setAssignSite(null)} onSave={saveAssignedUsers}>
          <div className="assign-users-list">
            {employees.map((employee) => (
              <label key={employee.id}>
                <input type="checkbox" checked={assignedUserIds.includes(employee.id)} onChange={(event) => {
                  setAssignedUserIds((current) => event.target.checked ? [...current, employee.id] : current.filter((id) => id !== employee.id));
                }} />
                <span>{[employee.firstName, employee.lastName].filter(Boolean).join(" ") || employee.email}</span>
              </label>
            ))}
          </div>
        </CompanyModal>
      )}
    </div>
  );
}
