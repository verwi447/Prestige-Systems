import { useEffect, useMemo, useState } from "react";
import { Copy, Grid2X2, List, Pencil, Settings2, Trash2 } from "lucide-react";
import { products as productsAPI } from "../api.js";
import AppState from "../components/AppState.jsx";
import ConfirmationModal from "../components/ConfirmationModal.jsx";
import ProductFormModal from "../components/ProductFormModal.jsx";
import { getRequestErrorMessage, showSuccess } from "../lib/feedback";
import { apiOrigin } from "../lib/runtimeConfig";
import "./Products.css";

const API_ORIGIN = apiOrigin;
const allCategory = {
  id: "all",
  slug: "all",
  name: "Wszystkie",
  description: "Pełny katalog produktów dostępnych w systemie."
};

const emptyProduct = {
  name: "",
  category_id: "",
  image_url: "",
  description: "",
  code: "",
  unit: "szt.",
  catalog_price: "",
  sale_price: "",
  vat_rate: "23",
  visible_for_clients: false,
  show_price_to_client: false,
  active: true
};

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

const normalizeProduct = (product = {}) => ({
  ...emptyProduct,
  ...product,
  category_id: product.category_id || product.categoryId || product.category?.id || "",
  image_url: product.image_url || product.imageUrl || "",
  catalog_price: product.catalog_price ?? product.catalogPrice ?? "",
  sale_price: product.sale_price ?? product.salePrice ?? "",
  vat_rate: product.vat_rate ?? product.vatRate ?? "23",
  visible_for_clients: Boolean(product.visible_for_clients ?? product.visibleForClients),
  show_price_to_client: Boolean(product.show_price_to_client ?? product.showPriceToClient),
  active: product.active !== false
});

function ProductImage({ product, className = "" }) {
  const src = imageSrc(product.image_url || product.imageUrl);

  if (!src) {
    return (
      <div className={`article-image-placeholder ${className}`}>
        <span>{(product.name || "A").slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }

  return <img className={`article-image ${className}`} src={src} alt={product.name} loading="lazy" />;
}

function Badge({ value, positiveText = "TAK", negativeText = "NIE" }) {
  return (
    <span className={value ? "article-badge yes" : "article-badge no"}>
      {value ? positiveText : negativeText}
    </span>
  );
}

const actionIcons = {
  edit: Pencil,
  delete: Trash2,
  copy: Copy,
  gear: Settings2
};

function ActionIcon({ name }) {
  const Icon = actionIcons[name];
  return Icon ? <Icon aria-hidden="true" /> : null;
}

const viewIcons = {
  table: List,
  cards: Grid2X2
};

function ViewIcon({ name }) {
  const Icon = viewIcons[name];
  return Icon ? <Icon aria-hidden="true" /> : null;
}

export default function Products() {
  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  }, []);
  const isAdmin = user?.role === "ADMIN";

  const [categories, setCategories] = useState([]);
  const [productList, setProductList] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [priceFilter, setPriceFilter] = useState("all");
  const [viewMode, setViewMode] = useState(isAdmin ? "table" : "cards");
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [productToDelete, setProductToDelete] = useState(null);
  const [categoryToDelete, setCategoryToDelete] = useState(null);
  const [showCategoryTools, setShowCategoryTools] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: "", description: "" });
  const [formData, setFormData] = useState(emptyProduct);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [savingImage, setSavingImage] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);

  const categoryList = useMemo(() => [allCategory, ...categories], [categories]);
  const currentCategory = categoryList.find((category) => category.slug === selectedCategory) || allCategory;

  const loadCatalog = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [categoriesResponse, productsResponse] = await Promise.all([
        productsAPI.getCategories(),
        productsAPI.getAll()
      ]);
      setCategories(categoriesResponse.data || []);
      setProductList((productsResponse.data || []).map(normalizeProduct));
    } catch (error) {
      setLoadError(getRequestErrorMessage(error, "Nie udalo sie pobrac katalogu."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  const categoryCounts = useMemo(() => {
    const counts = { all: productList.length };
    productList.forEach((product) => {
      const slug = product.category?.slug || product.category_slug || "inne";
      counts[slug] = (counts[slug] || 0) + 1;
    });
    return counts;
  }, [productList]);

  const filteredProducts = useMemo(() => {
    const phrase = query.trim().toLowerCase();
    return productList.filter((product) => {
      const categorySlug = product.category?.slug || product.category_slug;
      if (selectedCategory !== "all" && categorySlug !== selectedCategory) return false;
      if (phrase) {
        const haystack = [product.name, product.code, product.description, product.category?.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(phrase)) return false;
      }
      if (isAdmin && activeFilter !== "all" && String(product.active) !== activeFilter) return false;
      if (isAdmin && clientFilter !== "all" && String(product.visible_for_clients) !== clientFilter) return false;
      if (isAdmin && priceFilter !== "all" && String(product.show_price_to_client) !== priceFilter) return false;
      return true;
    });
  }, [activeFilter, clientFilter, isAdmin, priceFilter, productList, query, selectedCategory]);

  const openCreateForm = () => {
    const selected = categories.find((category) => category.slug === selectedCategory);
    setEditingProduct(null);
    setFormData({ ...emptyProduct, category_id: selected?.id || categories[0]?.id || "" });
    setShowForm(true);
    setMessage("");
  };

  const openEditForm = (product) => {
    setEditingProduct(product);
    setFormData(normalizeProduct(product));
    setShowForm(true);
    setMessage("");
  };

  const validateForm = () => {
    if (!formData.name.trim()) return "Nazwa jest wymagana.";
    if (!formData.category_id) return "Kategoria jest wymagana.";
    const salePrice = Number(String(formData.sale_price || 0).replace(",", "."));
    const catalogPrice = Number(String(formData.catalog_price || 0).replace(",", "."));
    const vatRate = Number(String(formData.vat_rate || 0).replace(",", "."));
    if (!Number.isFinite(salePrice)) return "Cena sprzedaży musi być liczbą.";
    if (!Number.isFinite(catalogPrice)) return "Cena katalogowa musi być liczbą.";
    if (!Number.isFinite(vatRate)) return "VAT musi być liczbą.";
    if (formData.code?.trim()) {
      const duplicateCode = productList.some((product) =>
        product.code?.trim().toLowerCase() === formData.code.trim().toLowerCase() &&
        Number(product.id) !== Number(editingProduct?.id)
      );
      if (duplicateCode) return "Produkt z takim kodem już istnieje.";
    }
    return "";
  };

  const numberInput = (value, fallback = 0) => {
    const number = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(number) ? number : fallback;
  };

  const productPayload = () => ({
    name: formData.name,
    category_id: Number(formData.category_id),
    image_url: formData.image_url || null,
    description: formData.description || null,
    code: formData.code || null,
    unit: formData.unit || "szt.",
    catalog_price: numberInput(formData.catalog_price, 0),
    sale_price: numberInput(formData.sale_price, 0),
    vat_rate: numberInput(formData.vat_rate, 23),
    visible_for_clients: Boolean(formData.visible_for_clients),
    show_price_to_client: Boolean(formData.show_price_to_client),
    active: Boolean(formData.active)
  });

  const saveProduct = async () => {
    const validationMessage = validateForm();
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    setSavingProduct(true);
    try {
      if (editingProduct) {
        await productsAPI.update(editingProduct.id, productPayload());
      } else {
        await productsAPI.create(productPayload());
      }
      setShowForm(false);
      setEditingProduct(null);
      setFormData(emptyProduct);
      await loadCatalog();
      setMessage(editingProduct ? "Produkt został zapisany." : "Produkt został dodany.");
      showSuccess(editingProduct ? "Produkt zostal zapisany." : "Produkt zostal dodany.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać produktu.");
    } finally {
      setSavingProduct(false);
    }
  };

  const uploadImage = async (file) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      setMessage("Obsługiwane formaty zdjęć: JPG, PNG, WEBP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage("Maksymalny rozmiar zdjęcia to 5 MB.");
      return;
    }

    try {
      setSavingImage(true);
      const response = await productsAPI.uploadImage(file);
      setFormData((current) => ({ ...current, image_url: response.data.imageUrl }));
      setMessage("");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się wgrać zdjęcia.");
    } finally {
      setSavingImage(false);
    }
  };

  const duplicateProduct = async (product) => {
    try {
      await productsAPI.duplicate(product.id);
      await loadCatalog();
      setMessage("Produkt został zduplikowany.");
      showSuccess("Produkt zostal zduplikowany.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zduplikować produktu.");
    }
  };

  const deleteProduct = async () => {
    if (!productToDelete) return;

    try {
      await productsAPI.delete(productToDelete.id);
      await loadCatalog();
      setMessage("Produkt został usunięty.");
      showSuccess("Produkt zostal usuniety.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się usunąć produktu.");
    } finally {
      setProductToDelete(null);
    }
  };

  const saveCategory = async () => {
    if (!categoryForm.name.trim()) {
      setMessage("Nazwa kategorii jest wymagana.");
      return;
    }

    try {
      const response = await productsAPI.createCategory(categoryForm);
      setCategoryForm({ name: "", description: "" });
      await loadCatalog();
      setSelectedCategory(response.data.slug);
      setMessage("Kategoria została dodana.");
      showSuccess("Kategoria zostala dodana.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się dodać kategorii.");
    }
  };

  const deleteCategory = async () => {
    if (!categoryToDelete || categoryToDelete.slug === "all") return;

    try {
      await productsAPI.deleteCategory(categoryToDelete.id);
      if (selectedCategory === categoryToDelete.slug) setSelectedCategory("all");
      await loadCatalog();
      setMessage("Kategoria została usunięta.");
      showSuccess("Kategoria zostala usunieta.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się usunąć kategorii.");
    } finally {
      setCategoryToDelete(null);
    }
  };

  const clearFilters = () => {
    setQuery("");
    setActiveFilter("all");
    setClientFilter("all");
    setPriceFilter("all");
  };

  if (loading) {
    return <div className={isAdmin ? "page article-catalog-page" : "page article-catalog-page client-catalog-page"}><AppState variant="loading" title="Ladowanie katalogu" description="Pobieramy produkty i kategorie." /></div>;
  }

  if (loadError) {
    return <div className={isAdmin ? "page article-catalog-page" : "page article-catalog-page client-catalog-page"}><AppState variant="error" title="Nie udalo sie pobrac katalogu" description={loadError} actionLabel="Sprobuj ponownie" onAction={loadCatalog} /></div>;
  }

  return (
    <div className={isAdmin ? "page article-catalog-page" : "page article-catalog-page client-catalog-page"}>
      <aside className="article-category-panel">
        <div className="article-category-heading">
          <div>
            <span>Katalog</span>
            <strong>Kategorie</strong>
          </div>
          {isAdmin && (
            <button
              type="button"
              className={showCategoryTools ? "category-settings-button active" : "category-settings-button"}
              onClick={() => setShowCategoryTools((value) => !value)}
              title="Zarzadzaj kategoriami"
              aria-label="Zarzadzaj kategoriami"
            >
              <ActionIcon name="gear" />
            </button>
          )}
        </div>
        {isAdmin && showCategoryTools && (
          <div className="category-tools">
            <input
              value={categoryForm.name}
              onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Nowa kategoria"
            />
            <textarea
              rows="2"
              value={categoryForm.description}
              onChange={(event) => setCategoryForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Opis kategorii"
            />
            <button type="button" className="category-add-button" onClick={saveCategory}>
              Dodaj kategorię
            </button>
          </div>
        )}
        <nav>
          {categoryList.map((category) => (
            <div className="category-row" key={category.slug}>
              <button
                type="button"
                className={selectedCategory === category.slug ? "active" : ""}
                onClick={() => setSelectedCategory(category.slug)}
              >
                <span>{category.name}</span>
                <em>{categoryCounts[category.slug] || 0}</em>
              </button>
              {isAdmin && showCategoryTools && category.slug !== "all" && (
                <button
                  type="button"
                  className="category-delete-button"
                  onClick={() => setCategoryToDelete(category)}
                  title="Usuń kategorię"
                  aria-label={`Usuń kategorię ${category.name}`}
                >
                  <ActionIcon name="delete" />
                </button>
              )}
            </div>
          ))}
        </nav>
      </aside>

      <main className="article-catalog-main">
        <header className="article-catalog-header">
          <div>
            <span>{isAdmin ? "Centralny katalog produktów" : "Katalog produktów"}</span>
            <h1>{currentCategory.name}</h1>
            <p>{currentCategory.description}</p>
          </div>
          {isAdmin && (
            <button className="btn btn-success" onClick={openCreateForm}>
              + Nowy produkt
            </button>
          )}
        </header>

        {message && <div className="settings-message">{message}</div>}

        <section className="article-toolbar">
          <input
            type="search"
            placeholder="Szukaj po nazwie, kodzie lub opisie"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {isAdmin && (
            <>
              <select value={priceFilter} onChange={(event) => setPriceFilter(event.target.value)}>
                <option value="all">Widoczność cen: wszystkie</option>
                <option value="true">Cena widoczna</option>
                <option value="false">Cena ukryta</option>
              </select>
              <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
                <option value="all">Klient: wszystkie</option>
                <option value="true">Widoczny dla klientów</option>
                <option value="false">Ukryty dla klientów</option>
              </select>
              <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}>
                <option value="all">Status: wszystkie</option>
                <option value="true">Aktywne</option>
                <option value="false">Nieaktywne</option>
              </select>
              <button className="ghost-button" type="button" onClick={clearFilters}>Wyczyść</button>
            </>
          )}
          <div className="article-view-toggle" aria-label="Tryb widoku">
            <button
              className={viewMode === "table" ? "active" : ""}
              type="button"
              onClick={() => setViewMode("table")}
              title="Tabela"
              aria-label="Widok tabeli"
            >
              <ViewIcon name="table" />
            </button>
            <button
              className={viewMode === "cards" ? "active" : ""}
              type="button"
              onClick={() => setViewMode("cards")}
              title="Kafelki"
              aria-label="Widok kafelków"
            >
              <ViewIcon name="cards" />
            </button>
          </div>
        </section>

        {isAdmin && viewMode === "table" ? (
          <section className="article-table-shell">
            <table className="article-table">
              <colgroup>
                <col className="article-col-image" />
                <col className="article-col-name" />
                <col className="article-col-code" />
                <col className="article-col-unit" />
                <col className="article-col-price" />
                <col className="article-col-price" />
                <col className="article-col-vat" />
                <col className="article-col-flag" />
                <col className="article-col-flag" />
                <col className="article-col-flag" />
                <col className="article-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Zdjęcie</th>
                  <th>Nazwa</th>
                  <th>Kod</th>
                  <th>JM</th>
                  <th>Cena katalogowa</th>
                  <th>Cena sprzedaży</th>
                  <th>VAT</th>
                  <th>Widoczny</th>
                  <th>Cena dla klienta</th>
                  <th>Aktywny</th>
                  <th>Akcje</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr key={product.id}>
                    <td><ProductImage product={product} className="table-image" /></td>
                    <td>
                      <strong>{product.name}</strong>
                      <span>{product.category?.name || product.category_name || "-"}</span>
                    </td>
                    <td>{product.code || "-"}</td>
                    <td>{product.unit || "-"}</td>
                    <td>{money(product.catalog_price)}</td>
                    <td>{money(product.sale_price)}</td>
                    <td>{Number(product.vat_rate ?? 23).toFixed(0)}%</td>
                    <td><Badge value={product.visible_for_clients} /></td>
                    <td><Badge value={product.show_price_to_client} positiveText="TAK" negativeText="NIE" /></td>
                    <td><Badge value={product.active} /></td>
                    <td>
                      <div className="article-actions">
                        <button className="icon-button edit" onClick={() => openEditForm(product)} title="Edytuj" aria-label="Edytuj produkt">
                          <ActionIcon name="edit" />
                        </button>
                        <button className="icon-button copy" onClick={() => duplicateProduct(product)} title="Duplikuj" aria-label="Duplikuj produkt">
                          <ActionIcon name="copy" />
                        </button>
                        <button className="icon-button delete" onClick={() => setProductToDelete(product)} title="Usuń" aria-label="Usuń produkt">
                          <ActionIcon name="delete" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan="11" className="empty-state">Brak produktów dla wybranych filtrów.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        ) : (
          <section className="article-card-grid">
            {filteredProducts.map((product, index) => {
              const showSalePrice = isAdmin || product.show_price_to_client;

              return (
                <article
                  className={isAdmin ? "article-card editable" : "article-card"}
                  key={product.id}
                  style={{ "--catalog-index": Math.min(index, 8) }}
                  onClick={isAdmin ? () => openEditForm(product) : undefined}
                  role={isAdmin ? "button" : undefined}
                  tabIndex={isAdmin ? 0 : undefined}
                  onKeyDown={isAdmin ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openEditForm(product);
                    }
                  } : undefined}
                >
                  <ProductImage product={product} />
                  <div className="article-card-body">
                    <span>{product.category?.name || product.category_name || "Katalog"}</span>
                    <h3>{product.name}</h3>
                    <p>{product.description || "Brak opisu produktu."}</p>
                    <div className="article-card-details">
                      {showSalePrice && (
                        <div className="article-card-price-box">
                          <small>Cena</small>
                          <strong>{money(product.sale_price ?? product.salePrice ?? 0)}</strong>
                        </div>
                      )}
                      {isAdmin && (
                        <div className="article-card-price-box muted">
                          <small>Katalog</small>
                          <strong>{money(product.catalog_price ?? product.catalogPrice ?? 0)}</strong>
                        </div>
                      )}
                      <div>
                        <small>Kod</small>
                        <strong>{product.code || "-"}</strong>
                      </div>
                      <div>
                        <small>JM</small>
                        <strong>{product.unit || "-"}</strong>
                      </div>
                      {isAdmin && (
                        <div>
                          <small>VAT</small>
                          <strong>{Number(product.vat_rate ?? 23).toFixed(0)}%</strong>
                        </div>
                      )}
                      {isAdmin && (
                        <div>
                          <small>Status</small>
                          <strong>{product.active === false ? "Nieaktywny" : "Aktywny"}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="article-card-actions" onClick={(event) => event.stopPropagation()}>
                      <button className="icon-button edit" onClick={() => openEditForm(product)} title="Edytuj" aria-label="Edytuj produkt">
                        <ActionIcon name="edit" />
                      </button>
                      <button className="icon-button copy" onClick={() => duplicateProduct(product)} title="Duplikuj" aria-label="Duplikuj produkt">
                        <ActionIcon name="copy" />
                      </button>
                      <button className="icon-button delete" onClick={() => setProductToDelete(product)} title="Usuń" aria-label="Usuń produkt">
                        <ActionIcon name="delete" />
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
            {filteredProducts.length === 0 && <div className="empty-state">Brak produktów dla wybranej kategorii.</div>}
          </section>
        )}
      </main>

      {showForm && (
        <ProductFormModal
          categories={categories}
          formData={formData}
          editingProduct={editingProduct}
          savingImage={savingImage}
          savingProduct={savingProduct}
          message={message}
          onChange={setFormData}
          onClose={() => setShowForm(false)}
          onSubmit={saveProduct}
          onUpload={uploadImage}
        />
      )}

      <ConfirmationModal
        isOpen={!!productToDelete}
        onClose={() => setProductToDelete(null)}
        onConfirm={deleteProduct}
        title="Usuń produkt"
        confirmText="Usuń"
      >
        <p>Czy na pewno chcesz usunąć produkt <strong>{productToDelete?.name}</strong>?</p>
      </ConfirmationModal>

      <ConfirmationModal
        isOpen={!!categoryToDelete}
        onClose={() => setCategoryToDelete(null)}
        onConfirm={deleteCategory}
        title="Usuń kategorię"
        confirmText="Usuń"
      >
        <p>Czy na pewno chcesz usunąć kategorię <strong>{categoryToDelete?.name}</strong>?</p>
        <p style={{ fontSize: "0.9em", color: "#6b7280" }}>
          Produkty z tej kategorii zostaną przeniesione do kategorii Inne.
        </p>
      </ConfirmationModal>
    </div>
  );
}

