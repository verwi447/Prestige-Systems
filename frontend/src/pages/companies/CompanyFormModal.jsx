export default function CompanyFormModal({ formData, editingCompany, onChange, onClose, onSubmit }) {
  const update = (field, value) => onChange({ ...formData, [field]: value });
  const title = editingCompany ? "Edytuj firmę" : "Dodaj firmę";
  const submitLabel = editingCompany ? "Zapisz zmiany" : "Dodaj firmę";

  return (
    <div className="modal-overlay company-modal-overlay" onClick={onClose}>
      <div className="company-modal" onClick={(event) => event.stopPropagation()}>
        <header className="company-modal-header">
          <h3>{title}</h3>
          <button type="button" className="company-modal-close" onClick={onClose} aria-label="Zamknij">
            ×
          </button>
        </header>

        <div className="company-form-grid">
          <label>
            <span>Nazwa firmy <b>*</b></span>
            <input placeholder="Wprowadź nazwę firmy" value={formData.name} onChange={(event) => update("name", event.target.value)} />
          </label>
          <label>
            <span>NIP <b>*</b></span>
            <input placeholder="Wprowadź NIP" value={formData.nip || ""} onChange={(event) => update("nip", event.target.value)} />
          </label>
          <label>
            <span>REGON</span>
            <input placeholder="Wprowadź REGON" value={formData.regon || ""} onChange={(event) => update("regon", event.target.value)} />
          </label>
          <label>
            <span>Telefon <b>*</b></span>
            <input placeholder="Wprowadź numer telefonu" value={formData.phone || ""} onChange={(event) => update("phone", event.target.value)} />
          </label>
          <label>
            <span>E-mail <b>*</b></span>
            <input placeholder="Wprowadź adres e-mail" type="email" value={formData.email || ""} onChange={(event) => update("email", event.target.value)} />
          </label>
          <label>
            <span>Kraj <b>*</b></span>
            <select value={formData.country || "Polska"} onChange={(event) => update("country", event.target.value)}>
              <option value="Polska">Polska</option>
              <option value="Niemcy">Niemcy</option>
              <option value="Czechy">Czechy</option>
              <option value="Słowacja">Słowacja</option>
              <option value="Inny">Inny</option>
            </select>
          </label>
          <label className="full">
            <span>Adres <b>*</b></span>
            <input placeholder="Wprowadź adres" value={formData.address || ""} onChange={(event) => update("address", event.target.value)} />
          </label>
          <label>
            <span>Kod pocztowy <b>*</b></span>
            <input placeholder="Wprowadź kod pocztowy" value={formData.postal_code || ""} onChange={(event) => update("postal_code", event.target.value)} />
          </label>
          <label>
            <span>Miasto <b>*</b></span>
            <input placeholder="Wprowadź miasto" value={formData.city || ""} onChange={(event) => update("city", event.target.value)} />
          </label>
          <label className="company-checkbox full">
            <input type="checkbox" checked={formData.is_active !== false} onChange={(event) => update("is_active", event.target.checked)} />
            <span>
              Firma aktywna
              <small>Nieaktywne firmy nie będą widoczne na liście wyboru.</small>
            </span>
          </label>
        </div>

        <footer className="company-modal-actions">
          <button type="button" className="btn btn-cancel" onClick={onClose}>
            Anuluj
          </button>
          <button type="button" className="btn btn-success" onClick={onSubmit}>
            {submitLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
