import { KeyRound, Search } from "lucide-react";
import BarrierCheckbox from "../components/BarrierCheckbox";
import {
  CompanyInput,
  CompanyModal,
  SiteImageUpload,
  initials,
  legacyEmployeeUiEnabled,
  permissionOptions,
  siteActive
} from "./MyCompanyParts";

export default function MyCompanyModals({
  canManageEmployees,
  canManageSites,
  editCompanyOpen,
  setEditCompanyOpen,
  saveCompany,
  companyForm,
  setCompanyForm,
  employeeOpen,
  setEmployeeOpen,
  employeeForm,
  setEmployeeForm,
  saveEmployee,
  addEmployee,
  togglePermission,
  resetEmployee,
  setResetEmployee,
  temporaryPassword,
  resetEmployeePassword,
  assignEmployee,
  setAssignEmployee,
  saveEmployeeSites,
  employeeSiteQuery,
  setEmployeeSiteQuery,
  employeeSites,
  setEmployeeSites,
  siteOpen,
  setSiteOpen,
  siteForm,
  setSiteForm,
  saveSite,
  siteImageError,
  setSiteImage,
  removeSiteImage,
  assignSite,
  setAssignSite,
  saveAssignedUsers,
  employees,
  assignedUserIds,
  setAssignedUserIds
}) {
  return (
    <>
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
    </>
  );
}
