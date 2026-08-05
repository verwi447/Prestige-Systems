const fieldRows = [
  ["Nazwa", "name"],
  ["NIP", "nip"],
  ["REGON", "regon"],
  ["Adres", "address"],
  ["Kod pocztowy", "postal_code"],
  ["Miasto", "city"],
  ["Kraj", "country"],
  ["Telefon", "phone"],
  ["E-mail", "email"]
];

export default function CompanyDataTab({ company }) {
  return (
    <section className="company-tab-panel">
      <div className="company-fields-grid">
        {fieldRows.map(([label, field]) => (
          <div key={field} className={field === "address" ? "wide" : ""}>
            <span>{label}</span>
            <strong>{company?.[field] || "-"}</strong>
          </div>
        ))}
        <div>
          <span>Status aktywności</span>
          <strong>{company?.is_active === false ? "Nieaktywna" : "Aktywna"}</strong>
        </div>
      </div>
    </section>
  );
}
