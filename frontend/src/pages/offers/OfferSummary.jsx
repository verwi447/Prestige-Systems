import { money } from "./offerUtils";

export default function OfferSummary({ summary, currency }) {
  return (
    <section className="offer-section summary-panel">
      <div className="section-title">
        <div>
          <span>Podsumowanie</span>
          <h2>Automatyczne obliczenia</h2>
        </div>
      </div>
      <div className="summary-lines">
        <div>
          <span>Suma netto</span>
          <strong>{money(summary.net, currency)}</strong>
        </div>
        <div>
          <span>Suma VAT</span>
          <strong>{money(summary.vat, currency)}</strong>
        </div>
        <div className="gross-line">
          <span>Suma brutto</span>
          <strong>{money(summary.gross, currency)}</strong>
        </div>
      </div>
    </section>
  );
}
