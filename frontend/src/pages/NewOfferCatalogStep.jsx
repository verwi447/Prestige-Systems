import { useEffect, useMemo, useState } from "react";
import { calculateItem, money } from "./offers/offerUtils";
import { StepShell, steps } from "./NewOfferSteps";
import { apiOrigin } from "../lib/runtimeConfig";

const API_ORIGIN = apiOrigin;

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

export default function CatalogStep({ products, categories, items, onItemsChange }) {
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
