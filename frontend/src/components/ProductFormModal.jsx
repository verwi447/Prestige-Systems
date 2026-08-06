import { useRef, useState } from "react";
import { Image as ImageIcon, Tag, Upload } from "lucide-react";
import BarrierCheckbox from "./BarrierCheckbox.jsx";
import { apiOrigin } from "../lib/runtimeConfig";

const API_ORIGIN = apiOrigin;

const money = (value) =>
  `${Number(value || 0).toLocaleString("pl-PL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} zł`;

const imageSrc = (url) => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url}`;
};

const productModalIcons = {
  upload: Upload,
  image: ImageIcon,
  tag: Tag
};

function ProductModalIcon({ name }) {
  const Icon = productModalIcons[name];
  return Icon ? <Icon aria-hidden="true" /> : null;
}

export default function ProductFormModal({
  categories,
  formData,
  editingProduct,
  savingImage,
  savingProduct,
  message,
  onChange,
  onClose,
  onSubmit,
  onUpload
}) {
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const update = (field, value) => onChange({ ...formData, [field]: value });
  const saleNet = Number(String(formData.sale_price || 0).replace(",", "."));
  const vatRate = Number(String(formData.vat_rate || 0).replace(",", "."));
  const grossPrice = Number.isFinite(saleNet) && Number.isFinite(vatRate) ? saleNet * (1 + vatRate / 100) : 0;
  const descriptionLength = String(formData.description || "").length;

  const handleFiles = async (files) => {
    const file = files?.[0];
    if (!file) return;
    await onUpload(file);
  };

  return (
    <div className="modal-overlay article-modal-overlay" onClick={() => !savingProduct && onClose()}>
      <div className="modal-content article-modal" onClick={(event) => event.stopPropagation()}>
        <div className="article-modal-header">
          <div>
            <h2>{editingProduct ? "Edytuj produkt" : "Nowy produkt"}</h2>
            <p>{editingProduct ? "Zmień dane produktu w katalogu." : "Dodaj produkt do katalogu."}</p>
          </div>
          <button className="article-modal-close" type="button" onClick={onClose} disabled={savingProduct}>×</button>
        </div>

        <div className={message ? "article-modal-message" : "article-modal-message empty"}>{message}</div>

        <div className="article-form-grid product-edit-layout">
          <aside className="product-edit-left">
            <section className="product-edit-section">
              <h3>Zdjęcie produktu</h3>
              <p>Zdjęcie pomaga klientom lepiej rozpoznać produkt.</p>
              <div
                className={dragOver ? "article-upload active" : "article-upload"}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  handleFiles(event.dataTransfer.files);
                }}
              >
                {formData.image_url ? (
                  <div className="article-upload-preview">
                    <img src={imageSrc(formData.image_url)} alt="Podgląd produktu" />
                  </div>
                ) : (
                  <div className="article-upload-empty">
                    <ProductModalIcon name="image" />
                    <strong>Brak zdjęcia</strong>
                    <span>Dodaj plik JPG, PNG lub WEBP do 5 MB.</span>
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(event) => handleFiles(event.target.files)}
                />
                <div className="article-upload-actions">
                  <button type="button" className="ghost-button" onClick={() => fileRef.current?.click()} disabled={savingImage || savingProduct}>
                    <ProductModalIcon name="upload" />
                    {savingImage ? "Wgrywanie..." : "Zmień zdjęcie"}
                  </button>
                  <button type="button" className="ghost-button danger-text" onClick={() => update("image_url", "")} disabled={!formData.image_url || savingProduct}>
                    Usuń zdjęcie
                  </button>
                </div>
              </div>
            </section>

            <section className="product-edit-section visibility-section">
              <h3>Widoczność produktu</h3>
              <BarrierCheckbox
                className="product-switch"
                checked={formData.active}
                onChange={(value) => update("active", value)}
                label={<strong>Aktywny</strong>}
                description="Produkt jest dostępny w systemie."
              />
              <BarrierCheckbox
                className="product-switch"
                checked={formData.visible_for_clients}
                onChange={(value) => update("visible_for_clients", value)}
                label={<strong>Widoczny dla klientów</strong>}
                description="Produkt będzie widoczny w katalogu klienta."
              />
              <BarrierCheckbox
                className="product-switch"
                checked={formData.show_price_to_client}
                onChange={(value) => update("show_price_to_client", value)}
                label={<strong>Pokaż cenę klientowi</strong>}
                description="Klient zobaczy cenę produktu w katalogu."
              />
              <div className="product-visibility-note">
                Zmiany dotyczące widoczności mogą być widoczne dla klientów z kilkuminutowym opóźnieniem.
              </div>
            </section>
          </aside>

          <section className="article-form-fields product-edit-right">
            <div className="product-edit-section">
              <h3>Dane produktu</h3>
              <div className="product-fields-grid">
                <label>
                  <span>Nazwa produktu <b>*</b></span>
                  <input value={formData.name} onChange={(event) => update("name", event.target.value)} placeholder="Wprowadź nazwę produktu" />
                </label>
                <label>
                  <span>Kategoria <b>*</b></span>
                  <select value={formData.category_id} onChange={(event) => update("category_id", event.target.value)}>
                    <option value="">Wybierz kategorię</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Kod produktu</span>
                  <input value={formData.code} onChange={(event) => update("code", event.target.value)} placeholder="Opcjonalnie" />
                </label>
                <label>
                  <span>Jednostka miary</span>
                  <input value={formData.unit} onChange={(event) => update("unit", event.target.value)} placeholder="szt." />
                </label>
                <label className="full">
                  <span>Opis produktu</span>
                  <textarea rows="4" maxLength="500" value={formData.description || ""} onChange={(event) => update("description", event.target.value)} placeholder="Wprowadź opis produktu" />
                  <em>{descriptionLength} / 500</em>
                </label>
              </div>
            </div>

            <div className="product-edit-section product-price-section">
              <h3>Cena i podatki</h3>
              <div className="product-price-grid">
                <label>
                  <span>Cena katalogowa netto</span>
                  <div className="price-input">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.catalog_price}
                      onChange={(event) => update("catalog_price", event.target.value)}
                      placeholder="0,00"
                    />
                    <strong>zł</strong>
                  </div>
                </label>
                <label>
                  <span>Cena sprzedaży netto</span>
                  <div className="price-input">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.sale_price}
                      onChange={(event) => update("sale_price", event.target.value)}
                      placeholder="0,00"
                    />
                    <strong>zł</strong>
                  </div>
                </label>
                <label>
                  <span>VAT</span>
                  <select value={formData.vat_rate} onChange={(event) => update("vat_rate", event.target.value)}>
                    <option value="23">23%</option>
                    <option value="8">8%</option>
                    <option value="5">5%</option>
                    <option value="0">0%</option>
                  </select>
                </label>
              </div>
              <div className="gross-price-box">
                <ProductModalIcon name="tag" />
                <div>
                  <strong>Cena brutto: {money(grossPrice)}</strong>
                  <span>Cena sprzedaży netto + VAT ({Number.isFinite(vatRate) ? vatRate : 0}%)</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="article-modal-actions">
          <button type="button" className="btn btn-cancel" onClick={onClose} disabled={savingProduct}>Anuluj</button>
          <button type="button" className="btn btn-success" onClick={onSubmit} disabled={savingProduct || savingImage}>
            {savingProduct ? "Zapisywanie..." : editingProduct ? "Zapisz zmiany" : "Dodaj produkt"}
          </button>
        </div>
      </div>
    </div>
  );
}
