import { useMemo, useRef, useState } from "react";
import OfferSummary from "./offers/OfferSummary";
import ProductTable from "./offers/ProductTable";
import { money, normalizeCustomer } from "./offers/offerUtils";

export const steps = [
  { id: 1, title: "Wybór klienta" },
  { id: 2, title: "Dane oferty" },
  { id: 3, title: "Parametry dokumentu" },
  { id: 4, title: "Dodaj z bazy" },
  { id: 5, title: "Produkty" },
  { id: 6, title: "Podsumowanie" }
];

const combineAddress = (client) =>
  [client.address, [client.postal_code, client.city].filter(Boolean).join(" "), client.country].filter(Boolean).join(", ");

function Field({ label, error, children, full = false }) {
  return (
    <label className={full ? "full" : ""}>
      {label}
      {children}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

export function StepShell({ step, children, className = "" }) {
  return (
    <section className={`offer-section wizard-step-card ${className}`}>
      <div className="section-title">
        <div>
          <span>Krok {step.id} z 6</span>
          <h2>{step.title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

export function ClientStep({ customers, selectedId, client, onSelect, onClientChange, errors }) {
  const [query, setQuery] = useState("");

  const filteredCustomers = useMemo(() => {
    const value = query.trim().toLowerCase();
    const source = value ? customers : customers.slice(0, 8);
    return source
      .filter((customer) =>
        [customer.company_name, customer.name, customer.nip, customer.email, customer.phone]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(value)
      )
      .slice(0, 12);
  }, [customers, query]);

  const handleSelect = (customer) => {
    onSelect(customer.id, normalizeCustomer(customer));
    setQuery(customer.company_name || customer.name || "");
  };

  return (
    <StepShell step={steps[0]}>
      <div className="search-field">
        <label>Wyszukaj firmę</label>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nazwa, NIP, e-mail lub telefon" />
        <div className="suggestion-list">
          {filteredCustomers.map((customer) => (
            <button
              type="button"
              key={customer.id}
              className={String(selectedId) === String(customer.id) ? "suggestion active" : "suggestion"}
              onClick={() => handleSelect(customer)}
            >
              <strong>{customer.company_name || customer.name}</strong>
              <span>{[customer.nip, customer.email, customer.phone].filter(Boolean).join(" | ")}</span>
            </button>
          ))}
          {filteredCustomers.length === 0 && <div className="empty-hint">Brak wyników dla podanego filtra.</div>}
        </div>
      </div>

      <div className="form-grid two">
        <Field label="Nazwa firmy" error={errors.company_name}>
          <input
            value={client.company_name}
            onChange={(event) => onClientChange("company_name", event.target.value)}
            className={errors.company_name ? "invalid" : ""}
          />
        </Field>
        <Field label="NIP">
          <input value={client.nip} onChange={(event) => onClientChange("nip", event.target.value)} />
        </Field>
        <Field label="Adres" full>
          <input value={client.address} onChange={(event) => onClientChange("address", event.target.value)} />
        </Field>
        <Field label="Osoba kontaktowa">
          <input value={client.contact_person} onChange={(event) => onClientChange("contact_person", event.target.value)} />
        </Field>
        <Field label="Telefon">
          <input value={client.phone} onChange={(event) => onClientChange("phone", event.target.value)} />
        </Field>
        <Field label="E-mail" error={errors.client_email} full>
          <input
            type="email"
            value={client.email}
            onChange={(event) => onClientChange("email", event.target.value)}
            className={errors.client_email ? "invalid" : ""}
          />
        </Field>
      </div>
      <p className="muted-note">Dane klienta są kopiowane tylko do tej oferty. Edycja tutaj nie zmieni kartoteki firmy.</p>
    </StepShell>
  );
}

export function OfferDataStep({ offer, onChange, users, errors }) {
  const update = (field, value) => onChange({ ...offer, [field]: value });

  return (
    <StepShell step={steps[1]}>
      <div className="form-grid two">
        <Field label="Nazwa oferty" error={errors.title}>
          <input value={offer.title} onChange={(event) => update("title", event.target.value)} className={errors.title ? "invalid" : ""} />
        </Field>
        <Field label="Numer oferty">
          <input value={offer.offer_number || ""} onChange={(event) => update("offer_number", event.target.value)} placeholder="Nadany automatycznie przy zapisie" />
        </Field>
        <Field label="Data wystawienia" error={errors.issue_date}>
          <input type="date" value={offer.issue_date} onChange={(event) => update("issue_date", event.target.value)} className={errors.issue_date ? "invalid" : ""} />
        </Field>
        <Field label="Data ważności" error={errors.valid_until}>
          <input type="date" value={offer.valid_until} onChange={(event) => update("valid_until", event.target.value)} className={errors.valid_until ? "invalid" : ""} />
        </Field>
        <Field label="Waluta">
          <select value={offer.currency} onChange={(event) => update("currency", event.target.value)}>
            <option value="PLN">PLN</option>
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
          </select>
        </Field>
        <Field label="Język">
          <select value={offer.language || "pl"} onChange={(event) => update("language", event.target.value)}>
            <option value="pl">Polski</option>
            <option value="en">Angielski</option>
            <option value="de">Niemiecki</option>
          </select>
        </Field>
        <Field label="Opiekun oferty">
          <select value={offer.salesperson || ""} onChange={(event) => update("salesperson", event.target.value)}>
            <option value="">Wybierz opiekuna</option>
            {users.map((user) => {
              const name = [user.first_name || user.firstName, user.last_name || user.lastName].filter(Boolean).join(" ") || user.username || user.email;
              return (
                <option key={user.id || name} value={name}>
                  {name}
                </option>
              );
            })}
            {offer.salesperson && !users.some((user) => [user.first_name, user.last_name].filter(Boolean).join(" ") === offer.salesperson) && (
              <option value={offer.salesperson}>{offer.salesperson}</option>
            )}
          </select>
        </Field>
        <Field label="Miejsce dostawy">
          <input value={offer.delivery_place || ""} onChange={(event) => update("delivery_place", event.target.value)} />
        </Field>
        <Field label="Dodatkowe informacje wewnętrzne" full>
          <textarea rows="4" value={offer.internal_notes || ""} onChange={(event) => update("internal_notes", event.target.value)} />
        </Field>
      </div>
    </StepShell>
  );
}

export function DocumentParamsStep({ offer, onChange, templates, errors }) {
  const update = (field, value) => onChange({ ...offer, [field]: value });
  const updateValidityDays = (value) => {
    const days = Number(value || 0);
    const issue = offer.issue_date ? new Date(offer.issue_date) : new Date();
    if (Number.isFinite(days) && days >= 0) {
      issue.setDate(issue.getDate() + days);
      updateMany({ validity_days: value, valid_until: issue.toISOString().slice(0, 10) });
      return;
    }
    update("validity_days", value);
  };
  const updateMany = (patch) => onChange({ ...offer, ...patch });

  return (
    <StepShell step={steps[2]}>
      <div className="form-grid two">
        <Field label="Szablon oferty">
          <select value={offer.template_id || ""} onChange={(event) => update("template_id", event.target.value)}>
            <option value="">Domyślny szablon</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name || template.title || `Szablon ${template.id}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sposób dostawy">
          <input value={offer.delivery_method} onChange={(event) => update("delivery_method", event.target.value)} />
        </Field>
        <Field label="Termin płatności">
          <input type="number" min="0" value={offer.payment_due_days} onChange={(event) => update("payment_due_days", event.target.value)} />
        </Field>
        <Field label="Sposób płatności">
          <select value={offer.payment_terms || "Przelew"} onChange={(event) => update("payment_terms", event.target.value)}>
            <option value="Przelew">Przelew</option>
            <option value="Gotówka">Gotówka</option>
            <option value="Karta">Karta</option>
          </select>
        </Field>
        <Field label="Ważność oferty w dniach">
          <input type="number" min="0" value={offer.validity_days || 30} onChange={(event) => updateValidityDays(event.target.value)} />
        </Field>
        <Field label="Przewidywany termin realizacji">
          <input value={offer.realization_time} onChange={(event) => update("realization_time", event.target.value)} />
        </Field>
        <Field label="Uwagi widoczne dla klienta" error={errors.remarks} full>
          <textarea rows="4" value={offer.remarks} onChange={(event) => update("remarks", event.target.value)} />
        </Field>
        <Field label="Dodatkowe informacje niewidoczne dla klienta" full>
          <textarea rows="4" value={offer.additional_info} onChange={(event) => update("additional_info", event.target.value)} />
        </Field>
      </div>
    </StepShell>
  );
}

export function ProductsStep({ offer, summary, onItemsChange, onRemove, onMove, onAddManual, onImportCsv, errors }) {
  const fileRef = useRef(null);

  return (
    <StepShell step={steps[4]}>
      <div className="table-actions">
        <button type="button" className="secondary-button" onClick={onAddManual}>
          Dodaj ręczną pozycję
        </button>
        <button type="button" className="ghost-button" onClick={() => fileRef.current?.click()}>
          Import CSV
        </button>
        <input ref={fileRef} className="hidden-file" type="file" accept=".csv,text/csv" onChange={onImportCsv} />
      </div>
      <ProductTable
        items={offer.items}
        currency={offer.currency}
        onChange={onItemsChange}
        onRemove={onRemove}
        onMove={onMove}
        errors={errors}
      />
      <OfferSummary summary={summary} currency={offer.currency} />
    </StepShell>
  );
}

export function SummaryStep({ offer, summary, onSaveDraft, onFinalize, saving }) {
  return (
    <StepShell step={steps[5]}>
      <div className="summary-review-grid">
        <section>
          <h3>Dane klienta</h3>
          <p><strong>{offer.client.company_name || "-"}</strong></p>
          <p>{combineAddress(offer.client) || "-"}</p>
          <p>{[offer.client.contact_person, offer.client.phone, offer.client.email].filter(Boolean).join(" | ") || "-"}</p>
        </section>
        <section>
          <h3>Dane oferty</h3>
          <p>{offer.title || "-"}</p>
          <p>{offer.offer_number || "Numer zostanie nadany przy zapisie"}</p>
          <p>{offer.issue_date || "-"} / ważna do {offer.valid_until || "-"}</p>
        </section>
        <section>
          <h3>Parametry dokumentu</h3>
          <p>{offer.payment_terms || "-"}, termin {offer.payment_due_days || 0} dni</p>
          <p>Dostawa: {offer.delivery_method || "-"}</p>
          <p>Waluta: {offer.currency}</p>
        </section>
        <section>
          <h3>Podsumowanie finansowe</h3>
          <p>Netto: <strong>{money(summary.net, offer.currency)}</strong></p>
          <p>VAT: <strong>{money(summary.vat, offer.currency)}</strong></p>
          <p>Brutto: <strong>{money(summary.gross, offer.currency)}</strong></p>
        </section>
      </div>
      <div className="review-items">
        <h3>Lista produktów</h3>
        {offer.items.length === 0 ? (
          <div className="empty-hint">Nie dodano pozycji.</div>
        ) : (
          offer.items.map((item, index) => (
            <div className="review-item" key={`${item.product_id || item.name}-${index}`}>
              <span>{index + 1}. {item.name || "Pozycja"}</span>
              <strong>{money(Number(item.quantity || 0) * Number(item.unit_price || 0), offer.currency)}</strong>
            </div>
          ))
        )}
      </div>
      <div className="summary-actions">
        <button type="button" className="secondary-button" disabled={saving} onClick={onSaveDraft}>
          Zapisz jako szkic
        </button>
        <button type="button" className="primary-button" disabled={saving} onClick={onFinalize}>
          Zapisz i zakończ
        </button>
      </div>
    </StepShell>
  );
}
