import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  companies as companiesAPI,
  adminOrders as adminOrdersAPI,
  customers as customersAPI,
  offers as offersAPI,
  products as productsAPI,
  templates as templatesAPI,
  admins as adminsAPI
} from "../api";
import ConfirmationModal from "../components/ConfirmationModal";
import OfferPreview from "./offers/OfferPreview";
import OfferSummary from "./offers/OfferSummary";
import PdfExporter from "./offers/PdfExporter";
import ProductTable from "./offers/ProductTable";
import {
  buildOfferPayload,
  calculateItem,
  calculateSummary,
  createEmptyOffer,
  emptyItem,
  mapOfferFromApi,
  money,
  normalizeCustomer
} from "./offers/offerUtils";
import { apiOrigin } from "../lib/runtimeConfig";
import "./NewOffer.css";

const API_ORIGIN = apiOrigin;
const UNSAVED_OFFER_MESSAGE = "Masz niezapisane zmiany w ofercie. Jeśli opuścisz kreator, zmiany mogą zostać utracone.";

const steps = [
  { id: 1, title: "Wybór klienta" },
  { id: 2, title: "Dane oferty" },
  { id: 3, title: "Parametry dokumentu" },
  { id: 4, title: "Dodaj z bazy" },
  { id: 5, title: "Produkty" },
  { id: 6, title: "Podsumowanie" }
];

const combineAddress = (client) =>
  [client.address, [client.postal_code, client.city].filter(Boolean).join(" "), client.country].filter(Boolean).join(", ");

const offerDraftSnapshot = (offer) => JSON.stringify(buildOfferPayload(offer, offer.status));

const getProductImageUrl = (url) => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url}`;
};

const getProductKey = (item = {}) => String(item.product_id || item.productId || item.id || item.code || item.name || "");

const getProductCategoryName = (product = {}) => product.category_name || product.category?.name || product.category || "Bez kategorii";

const getProductPrice = (product = {}) => Number(product.unit_price ?? product.priceNet ?? product.sale_price ?? product.salePrice ?? product.catalog_price ?? 0);

const buildCatalogSnapshot = (product = {}, quantity = 1) => {
  const productId = product.product_id || product.productId || product.id || "";
  const priceNet = getProductPrice(product);
  const vatRate = Number(product.vat_rate ?? product.vatRate ?? 23);
  const snapshot = {
    product_id: productId,
    productId,
    name: product.name || "",
    code: product.code || product.sku || "",
    category: getProductCategoryName(product),
    category_id: product.category_id || product.categoryId || product.category?.id || "",
    image_url: product.image_url || product.imageUrl || "",
    unit: product.unit || "szt.",
    quantity,
    unit_price: priceNet,
    priceNet,
    vat_rate: vatRate,
    vatRate,
    description: product.description || ""
  };
  const calculated = calculateItem(snapshot);
  return { ...snapshot, totalNet: calculated.net };
};

function CatalogProductImage({ item, className = "" }) {
  const src = getProductImageUrl(item.image_url || item.imageUrl);

  if (!src) {
    return (
      <div className={`catalog-thumb-placeholder ${className}`}>
        <span>{(item.name || "P").slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }

  return <img className={`catalog-thumb-image ${className}`} src={src} alt={item.name || "Produkt"} />;
}

function Field({ label, error, children, full = false }) {
  return (
    <label className={full ? "full" : ""}>
      {label}
      {children}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

function StepShell({ step, children, className = "" }) {
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

function ClientStep({ customers, selectedId, client, onSelect, onClientChange, errors }) {
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

function OfferDataStep({ offer, onChange, users, errors }) {
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

function DocumentParamsStep({ offer, onChange, templates, errors }) {
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

function CatalogStep({ products, categories, items, onItemsChange }) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [lastAddedKey, setLastAddedKey] = useState("");

  useEffect(() => {
    if (!lastAddedKey) return undefined;
    const timeout = window.setTimeout(() => setLastAddedKey(""), 900);
    return () => window.clearTimeout(timeout);
  }, [lastAddedKey]);

  const recentProducts = useMemo(() => {
    return [...products]
      .filter((product) => product.active !== false)
      .sort((first, second) => {
        const firstDate = new Date(first.last_used_at || first.updated_at || first.created_at || 0).getTime();
        const secondDate = new Date(second.last_used_at || second.updated_at || second.created_at || 0).getTime();
        return secondDate - firstDate;
      })
      .slice(0, 8);
  }, [products]);

  const filteredProducts = useMemo(() => {
    const value = query.trim().toLowerCase();
    const source = activeTab === "recent" ? recentProducts : products;
    return source
      .filter((product) => product.active !== false)
      .filter((product) => category === "all" || String(product.category_id || product.category?.id) === String(category))
      .filter((product) =>
        [product.name, product.code, product.description, product.category_name, product.category?.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(value)
      )
      .slice(0, 16);
  }, [activeTab, category, products, query, recentProducts]);

  const selectedByKey = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      const key = getProductKey(item);
      if (key) map.set(key, item);
    });
    return map;
  }, [items]);

  const selectedTotal = useMemo(() => items.reduce((total, item) => total + calculateItem(item).net, 0), [items]);

  const updateItemQuantity = (index, quantity) => {
    const nextQuantity = Math.max(1, Number(quantity || 1));
    const nextItems = items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const nextItem = { ...item, quantity: nextQuantity };
      return { ...nextItem, totalNet: calculateItem(nextItem).net };
    });
    onItemsChange(nextItems);
  };

  const addProduct = (product) => {
    const key = getProductKey(product);
    const existingIndex = items.findIndex((item) => getProductKey(item) === key);

    if (existingIndex >= 0) {
      updateItemQuantity(existingIndex, Number(items[existingIndex].quantity || 1) + 1);
    } else {
      onItemsChange([...items, buildCatalogSnapshot(product)]);
    }

    setLastAddedKey(key);
  };

  const removeItem = (index) => {
    onItemsChange(items.filter((_, itemIndex) => itemIndex !== index));
  };

  const clearFilters = () => {
    setQuery("");
    setCategory("all");
  };

  return (
    <StepShell step={steps[3]}>
      <p className="catalog-step-description">Wybierz produkty z katalogu i dodaj je do oferty.</p>

      <div className="catalog-filters">
        <label className="catalog-search">
          <span>Szukaj produktu</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nazwa, kod lub opis" />
        </label>
        <label>
          <span>Kategoria</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">Wszystkie kategorie</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ghost-button catalog-clear-button" onClick={clearFilters}>
          Wyczyść filtry
        </button>
      </div>

      <div className="catalog-tabs" role="tablist" aria-label="Widok produktów">
        <button type="button" className={activeTab === "all" ? "active" : ""} onClick={() => setActiveTab("all")}>
          Wszystkie produkty
        </button>
        <button type="button" className={activeTab === "recent" ? "active" : ""} onClick={() => setActiveTab("recent")}>
          Ostatnio używane
        </button>
      </div>

      <div className="catalog-picker-layout">
        <section className="catalog-products-panel" aria-label="Lista produktów">
          <div className="catalog-panel-header">
            <h3>{activeTab === "recent" ? "Ostatnio używane" : "Wszystkie produkty"}</h3>
            <span>{filteredProducts.length} wyników</span>
          </div>
          <div className="catalog-product-list">
            {filteredProducts.map((product) => (
              <article
                className={`catalog-product-row ${selectedByKey.has(getProductKey(product)) ? "is-selected" : ""} ${
                  lastAddedKey === getProductKey(product) ? "just-added" : ""
                }`}
                key={product.id || product.code}
              >
                <CatalogProductImage item={product} />
                <div className="catalog-product-main">
                  <div className="catalog-product-title">
                    <strong>{product.name}</strong>
                    {selectedByKey.has(getProductKey(product)) && <span className="catalog-added-badge">Dodano</span>}
                  </div>
                  <p>{product.description || "Brak opisu produktu."}</p>
                  <div className="catalog-product-meta">
                    <span>Kod: {product.code || "-"}</span>
                    <span>{getProductCategoryName(product)}</span>
                    <span className={product.active === false ? "availability-badge unavailable" : "availability-badge available"}>
                      {product.active === false ? "Niedostępny" : "Dostępny"}
                    </span>
                  </div>
                </div>
                <div className="catalog-product-side">
                  <strong>{money(getProductPrice(product), "PLN")}</strong>
                  <span>netto</span>
                  <button type="button" className="catalog-add-button" onClick={() => addProduct(product)} aria-label={`Dodaj ${product.name}`}>
                    +
                  </button>
                </div>
              </article>
            ))}
            {filteredProducts.length === 0 && <div className="catalog-empty-state">Brak produktów dla podanych filtrów.</div>}
          </div>
        </section>

        <aside className="selected-products-panel" aria-label="Wybrane produkty">
          <div className="selected-products-header">
            <div>
              <h3>Wybrane produkty</h3>
              <span>{items.length} pozycji</span>
            </div>
            <button type="button" className="danger-link" onClick={() => onItemsChange([])} disabled={items.length === 0}>
              Wyczyść wszystko
            </button>
          </div>

          <div className="selected-product-list">
            {items.map((item, index) => {
              const calculated = calculateItem(item);
              return (
                <article className="selected-product-row" key={`${getProductKey(item)}-${index}`}>
                  <CatalogProductImage item={item} className="compact" />
                  <div className="selected-product-main">
                    <strong>{item.name || "Produkt"}</strong>
                    <span>{[item.code, item.category].filter(Boolean).join(" | ") || "Bez kodu"}</span>
                    <div className="quantity-control" aria-label={`Ilość produktu ${item.name}`}>
                      <button type="button" onClick={() => updateItemQuantity(index, Number(item.quantity || 1) - 1)}>
                        -
                      </button>
                      <input value={item.quantity || 1} onChange={(event) => updateItemQuantity(index, event.target.value)} inputMode="numeric" />
                      <button type="button" onClick={() => updateItemQuantity(index, Number(item.quantity || 1) + 1)}>
                        +
                      </button>
                    </div>
                  </div>
                  <div className="selected-product-side">
                    <strong>{money(calculated.net, "PLN")}</strong>
                    <span>netto</span>
                    <button type="button" className="remove-selected-button" onClick={() => removeItem(index)} aria-label={`Usuń ${item.name}`}>
                      Usuń
                    </button>
                  </div>
                </article>
              );
            })}
            {items.length === 0 && <div className="selected-empty-state">Nie wybrano jeszcze produktów</div>}
          </div>

          <div className="selected-summary">
            <span>Liczba pozycji</span>
            <strong>{items.length}</strong>
            <span>Łączna wartość netto</span>
            <strong>{money(selectedTotal, "PLN")}</strong>
          </div>
        </aside>
      </div>
    </StepShell>
  );
}

function ProductsStep({ offer, summary, onItemsChange, onRemove, onMove, onAddManual, onImportCsv, errors }) {
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

function SummaryStep({ offer, summary, onSaveDraft, onFinalize, saving }) {
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

export default function NewOffer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = Boolean(id);
  const sourceOrderId = useMemo(() => new URLSearchParams(window.location.search).get("orderId"), []);

  const [activeStep, setActiveStep] = useState(1);
  const [maxReachedStep, setMaxReachedStep] = useState(1);
  const [offer, setOffer] = useState(createEmptyOffer);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [users, setUsers] = useState([]);
  const [ownCompany, setOwnCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState({});
  const [previewVersion, setPreviewVersion] = useState(0);
  const lastSavedSnapshotRef = useRef("");
  const allowNavigationRef = useRef(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);

  const summary = useMemo(() => calculateSummary(offer.items), [offer.items]);
  const currentSnapshot = useMemo(() => offerDraftSnapshot(offer), [offer]);
  const hasUnsavedChanges = !loading && !saving && lastSavedSnapshotRef.current && currentSnapshot !== lastSavedSnapshotRef.current;
  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  }, []);
  const adminContact = useMemo(() => {
    const creatorName = [offer.creator_first_name, offer.creator_last_name].filter(Boolean).join(" ");
    const currentUserName = [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ");

    return {
      name: creatorName || offer.creator_name || offer.salesperson || currentUserName || currentUser.username || "",
      phone: offer.creator_phone || currentUser.phone || "",
      email: offer.creator_email || currentUser.email || ""
    };
  }, [currentUser, offer]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [customersResponse, productsResponse, categoriesResponse, templatesResponse, usersResponse, ownCompanyResponse] =
          await Promise.all([
            customersAPI.getAll(),
            productsAPI.getAll(),
            productsAPI.getCategories().catch(() => ({ data: [] })),
            templatesAPI.getAll().catch(() => ({ data: [] })),
            adminsAPI.getAll(),
            companiesAPI.getOwnCompany().catch(() => ({ data: null }))
          ]);

        const loadedCustomers = customersResponse.data || [];
        setCustomers(loadedCustomers);
        setProducts(productsResponse.data || []);
        setCategories(categoriesResponse.data || []);
        setTemplates(templatesResponse.data || []);
        setUsers(usersResponse.data || []);
        setOwnCompany(ownCompanyResponse.data || null);

        if (isEditing) {
          const offerResponse = await offersAPI.getById(id);
          const mapped = mapOfferFromApi(offerResponse.data);
          const loadedOffer = {
            ...mapped,
            language: mapped.language || "pl",
            validity_days: mapped.validity_days || 30,
            delivery_place: mapped.delivery_place || "",
            internal_notes: mapped.internal_notes || ""
          };
          setOffer(loadedOffer);
          lastSavedSnapshotRef.current = offerDraftSnapshot(loadedOffer);
        } else if (sourceOrderId) {
          const orderResponse = await adminOrdersAPI.getById(sourceOrderId);
          const order = orderResponse.data;
          const matchedCustomer = loadedCustomers.find((customer) => Number(customer.id) === Number(order.customer_id));
          const client = {
            ...normalizeCustomer(matchedCustomer || {}),
            company_name: order.company_name || order.customer_name || matchedCustomer?.company_name || matchedCustomer?.name || "",
            address: order.object_address || matchedCustomer?.address || "",
            postal_code: order.object_postal_code || matchedCustomer?.postal_code || "",
            city: order.object_city || matchedCustomer?.city || "",
            contact_person: order.contact_name || [order.creator_first_name, order.creator_last_name].filter(Boolean).join(" ") || matchedCustomer?.contact_person || "",
            phone: order.contact_phone || order.customer_phone || matchedCustomer?.phone || "",
            email: order.customer_email || order.creator_email || matchedCustomer?.email || ""
          };
          const prefilled = {
            ...createEmptyOffer(),
            title: `Oferta do ${order.order_number}`,
            description: order.description || order.subject || "",
            customer_id: order.customer_id || "",
            object_id: order.object_id || "",
            ticket_id: order.id,
            client,
            delivery_place: [order.object_name, order.object_address, order.object_city].filter(Boolean).join(", "),
            additional_info: `Oferta przygotowana na podstawie zamówienia ${order.order_number}.`,
            items: (order.items || []).map((item) => ({
              ...emptyItem,
              product_id: item.product_id || "",
              name: item.name || "",
              code: item.code || "",
              unit: item.unit || "szt.",
              quantity: Number(item.quantity || 1),
              unit_price: Number(item.price_net || 0),
              vat_rate: Number(item.vat_rate ?? 23),
              description: item.producer ? `Producent: ${item.producer}` : ""
            }))
          };
          setOffer(prefilled);
          setMaxReachedStep(6);
          setMessage(`Uzupełniono dane i produkty z zamówienia ${order.order_number}.`);
          lastSavedSnapshotRef.current = offerDraftSnapshot(prefilled);
        } else {
          lastSavedSnapshotRef.current = offerDraftSnapshot(createEmptyOffer());
        }
      } catch (error) {
        setMessage(error.response?.data?.error || "Nie udało się załadować danych kreatora.");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id, isEditing, sourceOrderId]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = UNSAVED_OFFER_MESSAGE;
      return UNSAVED_OFFER_MESSAGE;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const handleNavigationClick = (event) => {
      if (!hasUnsavedChanges || allowNavigationRef.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      const link = target?.closest?.("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;

      const nextUrl = new URL(link.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      if (nextUrl.href === currentUrl.href) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      setPendingNavigation(nextUrl.pathname + nextUrl.search + nextUrl.hash);
    };

    document.addEventListener("click", handleNavigationClick, true);
    return () => document.removeEventListener("click", handleNavigationClick, true);
  }, [hasUnsavedChanges]);

  const confirmPendingNavigation = () => {
    const destination = pendingNavigation;
    setPendingNavigation(null);
    if (!destination) return;
    allowNavigationRef.current = true;
    navigate(destination);
    window.setTimeout(() => {
      allowNavigationRef.current = false;
    }, 0);
  };

  const validateStep = (stepId = activeStep) => {
    const nextErrors = {};

    if (stepId === 1) {
      if (!offer.client.company_name.trim()) nextErrors.company_name = "Wybierz lub wpisz klienta.";
      if (offer.client.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(offer.client.email)) nextErrors.client_email = "Podaj poprawny e-mail.";
    }

    if (stepId === 2) {
      if (!offer.title.trim()) nextErrors.title = "Podaj nazwę oferty.";
      if (!offer.issue_date) nextErrors.issue_date = "Podaj datę wystawienia.";
      if (!offer.valid_until) nextErrors.valid_until = "Podaj datę ważności.";
    }

    if (stepId === 5 || stepId === 6) {
      if (offer.items.length === 0) nextErrors.items = "Dodaj co najmniej jedną pozycję.";
      if (offer.items.some((item) => !String(item.name || "").trim())) nextErrors.items = "Każda pozycja musi mieć nazwę.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const goNext = () => {
    if (!validateStep(activeStep)) return;
    const nextStep = Math.min(activeStep + 1, steps.length);
    setActiveStep(nextStep);
    setMaxReachedStep((current) => Math.max(current, nextStep));
    setMessage("");
  };

  const goBack = () => {
    setErrors({});
    setActiveStep((current) => Math.max(1, current - 1));
  };

  const goToStep = (stepId) => {
    if (stepId <= maxReachedStep) {
      setErrors({});
      setActiveStep(stepId);
    }
  };

  const handleSelectCustomer = (customerId, clientData) => {
    setOffer((current) => ({
      ...current,
      customer_id: customerId || "",
      client: clientData || { ...current.client }
    }));
  };

  const handleClientChange = (field, value) => {
    setOffer((current) => ({
      ...current,
      client: { ...current.client, [field]: value }
    }));
  };

  const handleMoveItem = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= offer.items.length) return;
    const nextItems = [...offer.items];
    const [moved] = nextItems.splice(index, 1);
    nextItems.splice(targetIndex, 0, moved);
    setOffer((current) => ({ ...current, items: nextItems }));
  };

  const handleAddManualItem = () => {
    setOffer((current) => ({
      ...current,
      items: [...current.items, { ...emptyItem, name: "Pozycja ręczna", unit: "szt." }]
    }));
  };

  const handleImportCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
    const imported = rows.slice(rows[0]?.toLowerCase().includes("nazwa") ? 1 : 0).map((row) => {
      const [name, quantity, unit, unitPrice, vatRate, code, description] = row.split(";").map((cell) => cell?.trim() || "");
      return {
        ...emptyItem,
        name,
        quantity: Number(quantity || 1),
        unit: unit || "szt.",
        unit_price: Number(String(unitPrice || 0).replace(",", ".")),
        vat_rate: Number(String(vatRate || 23).replace(",", ".")),
        code,
        description
      };
    }).filter((item) => item.name);

    setOffer((current) => ({ ...current, items: [...current.items, ...imported] }));
    setMessage(imported.length ? `Zaimportowano ${imported.length} pozycji z CSV.` : "Nie znaleziono pozycji w pliku CSV.");
    event.target.value = "";
  };

  const saveOffer = async (status = offer.status, skipValidation = false) => {
    if (!skipValidation && !validateStep(6)) return null;
    setSaving(true);
    setMessage("");

    try {
      const payload = buildOfferPayload(offer, status);
      const response = isEditing
        ? status === "SZKIC"
          ? await offersAPI.saveDraft(id, payload)
          : await offersAPI.update(id, payload)
        : await offersAPI.create(payload);
      const savedOffer = response.data;
      const nextOffer = {
        ...offer,
        id: savedOffer.id,
        offer_number: savedOffer.offer_number || offer.offer_number,
        status: savedOffer.status || status
      };
      setOffer((current) => ({
        ...current,
        id: nextOffer.id,
        offer_number: nextOffer.offer_number,
        status: nextOffer.status
      }));
      lastSavedSnapshotRef.current = offerDraftSnapshot(nextOffer);
      const finalMessage = savedOffer.delivery?.emailSent
        ? `Oferta została opublikowana i wysłana na ${savedOffer.delivery.emailRecipient}.`
        : savedOffer.delivery?.portalPublished
          ? "Oferta została opublikowana w portalu klienta. Wysyłka e-mail nie była możliwa."
          : "Oferta została zapisana jako finalna.";
      setMessage(status === "SZKIC" ? "Szkic został zapisany." : finalMessage);
      if (!isEditing && savedOffer.id && status === "SZKIC") {
        navigate(`/offers/edit/${savedOffer.id}`, { replace: true });
      }
      return savedOffer;
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać oferty.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleFinalize = async () => {
    if (!validateStep(6)) return;
    const saved = await saveOffer("DO AKCEPTACJI", true);
    if (saved?.id) {
      const linkedOrderId = sourceOrderId || saved.ticket_id || offer.ticket_id;
      navigate(linkedOrderId ? `/orders/${linkedOrderId}?tab=offer` : `/offers/${saved.id}`);
    }
  };

  const handleExportPdf = async () => {
    const saved = isEditing ? { id } : await saveOffer("SZKIC", true);
    if (!saved?.id && !id) return;

    try {
      const response = await offersAPI.getPDF(saved.id || id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `oferta-${(offer.offer_number || saved.id || id).toString().replace(/\//g, "_")}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się wyeksportować PDF.");
    }
  };

  if (loading) {
    return <div className="page">Ładowanie kreatora ofert...</div>;
  }

  return (
    <div className={`page offer-builder-page step-${activeStep}`}>
      <div className="offer-builder-header">
        <div>
          <span>{isEditing ? "Edycja oferty" : "Nowa oferta"}</span>
          <h1>Kreator ofert handlowych</h1>
        </div>
        <button type="button" className="secondary-button" disabled={saving} onClick={() => saveOffer("SZKIC", true)}>
          Zapisz szkic
        </button>
      </div>

      {message && <div className="builder-message">{message}</div>}

      <div className="offer-builder-layout">
        <main className="offer-form-column">
          <nav className="wizard-progress" aria-label="Kroki kreatora">
            {steps.map((step) => {
              const isActive = step.id === activeStep;
              const isDone = step.id < activeStep || (step.id < maxReachedStep && step.id !== activeStep);
              return (
                <button
                  key={step.id}
                  type="button"
                  className={`${isActive ? "active" : ""} ${isDone ? "done" : ""}`}
                  onClick={() => goToStep(step.id)}
                  disabled={step.id > maxReachedStep}
                >
                  <span>{isDone ? "✓" : step.id}</span>
                  <strong>{step.title}</strong>
                </button>
              );
            })}
          </nav>

          {activeStep === 1 && (
            <ClientStep
              customers={customers}
              selectedId={offer.customer_id}
              client={offer.client}
              onSelect={handleSelectCustomer}
              onClientChange={handleClientChange}
              errors={errors}
            />
          )}
          {activeStep === 2 && <OfferDataStep offer={offer} onChange={setOffer} users={users} errors={errors} />}
          {activeStep === 3 && <DocumentParamsStep offer={offer} onChange={setOffer} templates={templates} errors={errors} />}
          {activeStep === 4 && (
            <CatalogStep
              products={products}
              categories={categories}
              items={offer.items}
              onItemsChange={(items) => setOffer((current) => ({ ...current, items }))}
            />
          )}
          {activeStep === 5 && (
            <ProductsStep
              offer={offer}
              summary={summary}
              onItemsChange={(items) => setOffer((current) => ({ ...current, items }))}
              onRemove={(index) => setOffer((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}
              onMove={handleMoveItem}
              onAddManual={handleAddManualItem}
              onImportCsv={handleImportCsv}
              errors={errors}
            />
          )}
          {activeStep === 6 && (
            <SummaryStep
              offer={offer}
              summary={summary}
              saving={saving}
              onSaveDraft={() => saveOffer("SZKIC", true)}
              onFinalize={handleFinalize}
            />
          )}

          <div className="wizard-actions">
            <button type="button" className="ghost-button" onClick={goBack} disabled={activeStep === 1 || saving}>
              Wstecz
            </button>
            {activeStep < steps.length ? (
              <button type="button" className="primary-button" onClick={goNext} disabled={saving}>
                Dalej
              </button>
            ) : (
              <PdfExporter disabled={saving} onExport={handleExportPdf} />
            )}
          </div>
        </main>

        <aside className="preview-column">
          <div className="pdf-refresh-row">
            <strong>Podgląd PDF</strong>
            <button type="button" className="ghost-button" onClick={() => setPreviewVersion((value) => value + 1)}>
              Odśwież PDF
            </button>
          </div>
          <OfferPreview
            key={previewVersion}
            offer={offer}
            summary={summary}
            ownCompany={ownCompany}
            preparedBy={adminContact}
          />
        </aside>
      </div>

      <ConfirmationModal
        isOpen={!!pendingNavigation}
        onClose={() => setPendingNavigation(null)}
        onConfirm={confirmPendingNavigation}
        title="Niezapisane zmiany"
        confirmText="Opuść stronę"
        confirmVariant="delete"
      >
        <p>{UNSAVED_OFFER_MESSAGE}</p>
      </ConfirmationModal>
    </div>
  );
}
