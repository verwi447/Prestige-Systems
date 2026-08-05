import { calculateItem, money } from "./offerUtils";

export default function ProductTable({ items, currency, onChange, onRemove, onMove, errors = {} }) {
  const updateItem = (index, field, value) => {
    const nextItems = items.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item));
    onChange(nextItems);
  };

  return (
    <section className="offer-section product-table-section">
      <div className="section-title">
        <div>
          <span>Pozycje</span>
          <h2>Tabela produktów</h2>
        </div>
      </div>

      {errors.items && <div className="form-alert">{errors.items}</div>}

      <div className="offer-items-table">
        <div className="table-head">LP</div>
        <div className="table-head">Nazwa</div>
        <div className="table-head">Kod</div>
        <div className="table-head">Ilość</div>
        <div className="table-head">JM</div>
        <div className="table-head">Cena netto</div>
        <div className="table-head">Netto</div>
        <div className="table-head">VAT</div>
        <div className="table-head">Brutto</div>
        <div className="table-head">Akcje</div>

        {items.map((item, index) => {
          const calculated = calculateItem(item);
          return (
            <div className="table-row" key={`${item.product_id || item.name}-${index}`}>
              <div className="lp-cell">{index + 1}</div>
              <div className="wide-cell">
                <input value={item.name} onChange={(event) => updateItem(index, "name", event.target.value)} />
              </div>
              <div>
                <input value={item.code} onChange={(event) => updateItem(index, "code", event.target.value)} />
              </div>
              <div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.quantity}
                  onChange={(event) => updateItem(index, "quantity", event.target.value)}
                />
              </div>
              <div>
                <input value={item.unit} onChange={(event) => updateItem(index, "unit", event.target.value)} />
              </div>
              <div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unit_price}
                  onChange={(event) => updateItem(index, "unit_price", event.target.value)}
                />
              </div>
              <div className="money-cell">{money(calculated.net, currency)}</div>
              <div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.vat_rate}
                  onChange={(event) => updateItem(index, "vat_rate", event.target.value)}
                />
              </div>
              <div className="money-cell strong">{money(calculated.gross, currency)}</div>
              <div className="row-actions">
                <button type="button" title="Przesuń wyżej" onClick={() => onMove(index, -1)} disabled={index === 0}>
                  ↑
                </button>
                <button
                  type="button"
                  title="Przesuń niżej"
                  onClick={() => onMove(index, 1)}
                  disabled={index === items.length - 1}
                >
                  ↓
                </button>
                <button type="button" title="Usuń" className="danger-icon" onClick={() => onRemove(index)}>
                  ×
                </button>
              </div>
            </div>
          );
        })}

        {items.length === 0 && <div className="empty-table">Dodaj produkt z bazy, aby rozpocząć kalkulację.</div>}
      </div>
    </section>
  );
}
