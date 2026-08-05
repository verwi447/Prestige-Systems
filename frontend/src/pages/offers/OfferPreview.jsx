import { useState } from "react";
import { calculateItem, money } from "./offerUtils";
import offerLogoLight from "../../assets/offer-logo-light.png";

const formatDate = (date) => (date ? new Date(date).toLocaleDateString("pl-PL") : "");
const splitNotes = (value) => String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

export default function OfferPreview({ offer, summary, ownCompany, preparedBy }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const clientName = offer.client.company_name || "Wybierz klienta";
  const contactName = offer.client.contact_person || "";
  const issuePlace = ownCompany?.city || offer.client.city || "Warszawa";
  const offerNumber = offer.offer_number || "Numer zostanie nadany";
  const validityText = offer.validity_days ? `${offer.validity_days} dni` : offer.valid_until ? `do ${formatDate(offer.valid_until)}` : "-";

  const ownCompanyLogo = ownCompany?.logoUrl || ownCompany?.logo_url || "";
  const ownCompanyLines = [
    ownCompany?.nip ? `NIP: ${ownCompany.nip}` : "",
    [ownCompany?.address, ownCompany?.postal_code, ownCompany?.city].filter(Boolean).join(" "),
    [ownCompany?.phone ? `tel.: ${ownCompany.phone}` : "", ownCompany?.email || ""].filter(Boolean).join(" | ")
  ].filter(Boolean);

  const preparedName = preparedBy?.name || offer.prepared_by_name || "";
  const preparedPhone = preparedBy?.phone || offer.prepared_by_phone || "";
  const preparedEmail = preparedBy?.email || offer.prepared_by_email || "";
  const customNotes = [...splitNotes(offer.remarks), ...splitNotes(offer.additional_info)];

  const handleShellClick = (event) => {
    if (isExpanded) {
      if (event.target === event.currentTarget) setIsExpanded(false);
      return;
    }
    setIsExpanded(true);
  };

  const handleShellKeyDown = (event) => {
    if (isExpanded || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    setIsExpanded(true);
  };

  return (
    <aside
      className={isExpanded ? "offer-preview-shell expanded" : "offer-preview-shell"}
      onClick={handleShellClick}
      onKeyDown={handleShellKeyDown}
      role={isExpanded ? "presentation" : "button"}
      tabIndex={isExpanded ? -1 : 0}
      aria-label="Otwórz podgląd PDF"
    >
      <div className="preview-toolbar">
        <span>Podgląd PDF</span>
      </div>

      {isExpanded && (
        <button
          className="paper-preview-close"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setIsExpanded(false);
          }}
          aria-label="Zamknij podgląd"
        >
          ×
        </button>
      )}

      <article
        className="offer-paper"
        id="offer-preview-document"
        onClick={(event) => {
          event.stopPropagation();
          if (!isExpanded) setIsExpanded(true);
        }}
      >
        <header className="paper-header">
          <div className="paper-brand">
            <img src={offerLogoLight} alt="Prestige Systems HUB" />
          </div>
          <div className="paper-date">{[issuePlace, formatDate(offer.issue_date)].filter(Boolean).join(", ")}</div>
        </header>

        <section className="paper-title">
          <h1>OFERTA HANDLOWA</h1>
          <p>{offer.title || "Nazwa oferty"}</p>
        </section>

        <section className="paper-offer-number">
          <span className="paper-icon" aria-hidden="true">▤</span>
          <div>
            <span>Numer oferty</span>
            <strong>{offerNumber}</strong>
          </div>
        </section>

        <section className="paper-client">
          <div className="paper-client-main">
            <strong>OFERTA DLA:</strong>
            <h2>{clientName}</h2>
            {contactName && <b>{contactName}</b>}
            {offer.client.address && <span>{offer.client.address}</span>}
          </div>
          <div className="paper-client-contact">
            {offer.client.email && <span><b>@</b>{offer.client.email}</span>}
            {offer.client.phone && <span><b>tel.</b>{offer.client.phone}</span>}
            {offer.client.nip && <span><b>NIP:</b>{offer.client.nip}</span>}
          </div>
        </section>

        <h3 className="paper-section-heading">POZYCJE OFERTY</h3>
        <table className="paper-table">
          <thead>
            <tr>
              <th>LP</th>
              <th>Numer artykułu</th>
              <th>Opis</th>
              <th>Cena w PLN</th>
              <th>Ilość</th>
              <th>Wartość netto</th>
            </tr>
          </thead>
          <tbody>
            {offer.items.map((item, index) => {
              const calculated = calculateItem(item);
              return (
                <tr key={`${item.name}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{item.code || item.sku || "-"}</td>
                  <td><strong>{item.name || item.title || "-"}</strong></td>
                  <td>{money(item.unit_price, offer.currency).replace(` ${offer.currency}`, "")}</td>
                  <td>{item.quantity || 0}</td>
                  <td>{money(calculated.net, offer.currency).replace(` ${offer.currency}`, "")}</td>
                </tr>
              );
            })}
            {offer.items.length === 0 && (
              <tr>
                <td colSpan="6" className="paper-empty">
                  Brak pozycji w ofercie
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="paper-total-strip">
          <span>WARTOŚĆ OFERTY NETTO</span>
          <strong>{money(summary.net, offer.currency)}</strong>
        </div>

        <div className="paper-in-words">Słownie: {summary.net > 0 ? money(summary.net, offer.currency) : "zero"}</div>

        <section className="paper-terms">
          <h3>WARUNKI OFERTY</h3>
          <div className="paper-terms-table">
            <span>Forma płatności:</span>
            <b>{offer.payment_terms || "-"}</b>
            <span>Termin realizacji:</span>
            <b>{offer.realization_time || "Do ustalenia"}</b>
            <span>Ważność oferty:</span>
            <b>{validityText}</b>
            <p>Do wartości oferty zostanie naliczony podatek VAT.</p>
          </div>
          {customNotes.length > 0 && (
            <div className="paper-notes">
              {customNotes.map((note) => (
                <span key={note}>{note}</span>
              ))}
            </div>
          )}
        </section>

        <footer className="paper-footer">
          <div className="paper-own-company">
            {ownCompanyLogo && <img src={ownCompanyLogo} alt="Logo firmy" />}
            <div className="paper-own-company-data">
              <strong>{ownCompany?.name || "Nazwa firmy"}</strong>
              {ownCompanyLines.length > 0 ? (
                ownCompanyLines.map((line) => <span key={line}>{line}</span>)
              ) : (
                <span>Uzupełnij dane naszej firmy w ustawieniach.</span>
              )}
            </div>
          </div>
          <div className="paper-prepared-by">
            <span>Ofertę przygotował</span>
            <b>{preparedName || "..."}</b>
            <span>tel.: {preparedPhone || "..."}</span>
            <span>e-mail: {preparedEmail || "..."}</span>
          </div>
        </footer>
      </article>
    </aside>
  );
}
