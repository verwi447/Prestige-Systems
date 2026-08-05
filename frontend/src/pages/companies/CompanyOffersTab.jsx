import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { companies, offers as offersAPI } from "../../api";
import ConfirmationModal from "../../components/ConfirmationModal";

const pageSize = 8;

const statusConfig = {
  "ZAAKCEPTOWANA": { label: "Zaakceptowana", className: "accepted" },
  "DO AKCEPTACJI": { label: "Do akceptacji", className: "pending" },
  "W REALIZACJI": { label: "W realizacji", className: "progress" },
  "SZKIC": { label: "Szkic", className: "draft" },
  "ODRZUCONA": { label: "Odrzucona", className: "rejected" },
  "WYSŁANA": { label: "Wysłana", className: "progress" },
  "ZAKOŃCZONA": { label: "Zakończona", className: "accepted" }
};

function OfferIcon({ type }) {
  const paths = {
    search: <path d="m20 20-4.2-4.2M10.8 17a6.2 6.2 0 1 1 0-12.4 6.2 6.2 0 0 1 0 12.4z" />,
    doc: (
      <>
        <path d="M7 3.5h7l3 3V20H7z" />
        <path d="M14 3.5V7h3M9 11h6M9 15h5" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12.2 2.2 2.2 4.8-5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </>
    ),
    edit: (
      <>
        <path d="M4 20h4.2L19.1 9.1a2.4 2.4 0 0 0-3.4-3.4L4.8 16.6z" />
        <path d="m14.4 7 2.6 2.6" />
      </>
    ),
    x: <path d="M6 6l12 12M18 6 6 18" />,
    wallet: (
      <>
        <path d="M4 7.5h15v11H4z" />
        <path d="M4 9.5 17 5v2.5M15.5 13h.01" />
      </>
    ),
    eye: (
      <>
        <path d="M3.5 12s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    pdf: (
      <>
        <path d="M7 3.5h7l3 3V20H7z" />
        <path d="M14 3.5V7h3M9 12h6M9 15h4" />
      </>
    ),
    copy: (
      <>
        <path d="M8 8h10v12H8z" />
        <path d="M6 16H4V4h10v2" />
      </>
    ),
    trash: (
      <>
        <path d="M5 7h14M10 11v5M14 11v5M8 7l1-3h6l1 3M7 7l1 13h8l1-13" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    filter: (
      <>
        <path d="M4 6h16M7 12h10M10 18h4" />
        <circle cx="5" cy="6" r="1" />
        <circle cx="18" cy="12" r="1" />
        <circle cx="9" cy="18" r="1" />
      </>
    )
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[type]}
    </svg>
  );
}

const asNumber = (value) => Number(value || 0);
const formatDate = (date) => (date ? new Date(date).toLocaleDateString("pl-PL") : "-");
const formatDateTime = (date) => (date ? new Date(date).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" }) : "-");
const money = (value, currency = "PLN") =>
  `${asNumber(value).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || "PLN"}`;

const normalizeStatus = (status) => String(status || "SZKIC").toUpperCase();
const statusMeta = (status) => statusConfig[normalizeStatus(status)] || { label: status || "Szkic", className: "draft" };

function StatusBadge({ status }) {
  const meta = statusMeta(status);
  return <span className={`offer-status-badge ${meta.className}`}>{meta.label}</span>;
}

const getItemNet = (item) =>
  asNumber(item.net_total ?? item.total_net ?? item.total ?? item.quantity * (item.unit_price ?? item.price_net ?? 0));
const getItemVat = (item) => asNumber(item.vat_value ?? (getItemNet(item) * asNumber(item.vat_rate)) / 100);
const getItemGross = (item) => asNumber(item.gross_total ?? getItemNet(item) + getItemVat(item));

function offerTotals(offer) {
  const items = offer?.items || [];
  if (!items.length) {
    const net = asNumber(offer?.total_price);
    const vat = asNumber(offer?.vat_total);
    return { net, vat, gross: asNumber(offer?.gross_total || net + vat) };
  }
  const net = items.reduce((sum, item) => sum + getItemNet(item), 0);
  const vat = items.reduce((sum, item) => sum + getItemVat(item), 0);
  const gross = items.reduce((sum, item) => sum + getItemGross(item), 0);
  return { net, vat, gross };
}

function productName(item) {
  return item.name || item.title || item.product_name || "Produkt";
}

function productCode(item) {
  return item.code || item.sku || item.product_code || "-";
}

function toOfferCopy(offer) {
  return {
    ...offer,
    id: undefined,
    offer_number: "",
    title: `${offer.title || "Oferta"} (kopia)`,
    status: "SZKIC",
    items: (offer.items || []).map((item) => ({
      product_id: item.product_id,
      productId: item.product_id,
      code: productCode(item),
      title: productName(item),
      name: productName(item),
      description: item.description || "",
      unit: item.unit || "szt.",
      unit_price: item.unit_price ?? item.price_net ?? 0,
      priceNet: item.unit_price ?? item.price_net ?? 0,
      quantity: item.quantity || 1,
      vat_rate: item.vat_rate ?? 23,
      vatRate: item.vat_rate ?? 23
    }))
  };
}

export default function CompanyOffersTab({ companyId, onChangeTab }) {
  const navigate = useNavigate();
  const [offers, setOffers] = useState([]);
  const [sites, setSites] = useState([]);
  const [selectedOfferId, setSelectedOfferId] = useState(null);
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountFilter, setAmountFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState({ key: "created_at", direction: "desc" });
  const [page, setPage] = useState(1);
  const [offerToDelete, setOfferToDelete] = useState(null);
  const [activities, setActivities] = useState([]);
  const [actionLoading, setActionLoading] = useState("");

  const loadOffers = useCallback(async () => {
    setLoading(true);
    try {
      const [offersResponse, sitesResponse] = await Promise.all([
        companies.getOffers(companyId),
        companies.getSites(companyId).catch(() => ({ data: [] }))
      ]);
      const loadedOffers = offersResponse.data || [];
      setOffers(loadedOffers);
      setSites(sitesResponse.data || []);
      setSelectedOfferId((current) => current || loadedOffers[0]?.id || null);
      setMessage("");
    } catch (error) {
      setOffers([]);
      setMessage(error.response?.data?.error || "Nie udało się pobrać ofert.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadOffers();
  }, [loadOffers]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, siteFilter, dateFrom, dateTo, amountFilter]);

  useEffect(() => {
    if (!selectedOfferId) {
      setSelectedOffer(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    offersAPI
      .getById(selectedOfferId)
      .then((response) => {
        if (active) setSelectedOffer(response.data);
      })
      .catch(() => {
        if (active) setSelectedOffer(offers.find((offer) => Number(offer.id) === Number(selectedOfferId)) || null);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedOfferId, offers]);

  const stats = useMemo(() => {
    const total = offers.length;
    const accepted = offers.filter((offer) => normalizeStatus(offer.status) === "ZAAKCEPTOWANA").length;
    const progress = offers.filter((offer) => normalizeStatus(offer.status) === "W REALIZACJI").length;
    const drafts = offers.filter((offer) => normalizeStatus(offer.status) === "SZKIC").length;
    const rejected = offers.filter((offer) => normalizeStatus(offer.status) === "ODRZUCONA").length;
    const totalValue = offers.reduce((sum, offer) => sum + asNumber(offer.total_price), 0);
    return { total, accepted, progress, drafts, rejected, totalValue };
  }, [offers]);

  const filteredOffers = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    const withinAmount = (offer) => {
      const value = asNumber(offer.total_price);
      if (amountFilter === "to1000") return value <= 1000;
      if (amountFilter === "1000to5000") return value > 1000 && value <= 5000;
      if (amountFilter === "over5000") return value > 5000;
      return true;
    };

    const rows = offers.filter((offer) => {
      const searchable = [offer.offer_number, offer.title, offer.object_name, offer.customer_name, offer.client_company_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const dateValue = offer.created_at || offer.issue_date;
      const date = dateValue ? new Date(dateValue) : null;
      const fromOk = !dateFrom || (date && date >= new Date(`${dateFrom}T00:00:00`));
      const toOk = !dateTo || (date && date <= new Date(`${dateTo}T23:59:59`));
      const siteOk = siteFilter === "all" || String(offer.object_id || offer.object_name || "") === siteFilter;
      return (
        (!lowerQuery || searchable.includes(lowerQuery)) &&
        (statusFilter === "all" || normalizeStatus(offer.status) === statusFilter) &&
        siteOk &&
        fromOk &&
        toOk &&
        withinAmount(offer)
      );
    });

    return [...rows].sort((a, b) => {
      const direction = sort.direction === "asc" ? 1 : -1;
      const left = a[sort.key] ?? "";
      const right = b[sort.key] ?? "";
      if (sort.key.includes("date") || sort.key.includes("_at")) {
        return (new Date(left || 0) - new Date(right || 0)) * direction;
      }
      if (sort.key === "total_price") return (asNumber(left) - asNumber(right)) * direction;
      return String(left).localeCompare(String(right), "pl") * direction;
    });
  }, [offers, query, statusFilter, siteFilter, dateFrom, dateTo, amountFilter, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredOffers.length / pageSize));
  const visibleOffers = filteredOffers.slice((page - 1) * pageSize, page * pageSize);
  const currentDetail = selectedOffer || offers.find((offer) => Number(offer.id) === Number(selectedOfferId));
  const detailTotals = offerTotals(currentDetail);
  const averageValue = stats.total ? stats.totalValue / stats.total : 0;
  const acceptanceRate = stats.total ? Math.round((stats.accepted / stats.total) * 100) : 0;
  const latestOffer = offers[0];
  const activeFilterCount = [query, statusFilter !== "all", siteFilter !== "all", dateFrom, dateTo, amountFilter !== "all"].filter(Boolean).length;

  const changeSort = (key) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
  };

  const resetFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setSiteFilter("all");
    setDateFrom("");
    setDateTo("");
    setAmountFilter("all");
  };

  const downloadPdf = async (offer = currentDetail) => {
    if (!offer?.id) return;
    setActionLoading("pdf");
    try {
      const response = await offersAPI.getPDF(offer.id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `oferta_${String(offer.offer_number || offer.id).replace(/\//g, "_")}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
      setActivities((current) => [{ label: "PDF pobrano", offer: offer.offer_number, time: "teraz" }, ...current].slice(0, 5));
      setMessage("PDF został pobrany.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się pobrać PDF.");
    } finally {
      setActionLoading("");
    }
  };

  const duplicateOffer = async () => {
    if (!currentDetail?.id) return;
    setActionLoading("duplicate");
    try {
      const detail = selectedOffer?.items ? selectedOffer : (await offersAPI.getById(currentDetail.id)).data;
      const created = await offersAPI.create(toOfferCopy(detail));
      setActivities((current) => [{ label: "Oferta zduplikowana", offer: currentDetail.offer_number, time: "teraz" }, ...current].slice(0, 5));
      navigate(`/offers/edit/${created.data.id}`);
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zduplikować oferty.");
    } finally {
      setActionLoading("");
    }
  };

  const deleteOffer = async () => {
    if (!offerToDelete?.id) return;
    setActionLoading("delete");
    try {
      await offersAPI.delete(offerToDelete.id);
      setMessage("Oferta została usunięta.");
      setOfferToDelete(null);
      setSelectedOfferId(null);
      await loadOffers();
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się usunąć oferty.");
    } finally {
      setActionLoading("");
    }
  };

  const statCards = [
    { icon: "doc", label: "Wszystkie oferty", value: stats.total, hint: "100% wszystkich ofert" },
    { icon: "check", label: "Zaakceptowane", value: stats.accepted, hint: `${stats.total ? Math.round((stats.accepted / stats.total) * 100) : 0}% wszystkich ofert` },
    { icon: "clock", label: "W realizacji", value: stats.progress, hint: `${stats.total ? Math.round((stats.progress / stats.total) * 100) : 0}% wszystkich ofert` },
    { icon: "edit", label: "Szkice", value: stats.drafts, hint: `${stats.total ? Math.round((stats.drafts / stats.total) * 100) : 0}% wszystkich ofert` },
    { icon: "x", label: "Odrzucone", value: stats.rejected, hint: `${stats.total ? Math.round((stats.rejected / stats.total) * 100) : 0}% wszystkich ofert` },
    { icon: "wallet", label: "Łączna wartość ofert", value: money(stats.totalValue), hint: "Wartość wszystkich ofert" }
  ];

  const activityRows = activities.length
    ? activities
    : [
        latestOffer && { label: "Ostatnia oferta utworzona", offer: latestOffer.offer_number, time: formatDate(latestOffer.created_at || latestOffer.issue_date) },
        stats.accepted > 0 && { label: "Oferta zaakceptowana", offer: offers.find((offer) => normalizeStatus(offer.status) === "ZAAKCEPTOWANA")?.offer_number, time: "ostatnio" },
        stats.progress > 0 && { label: "Oferta w realizacji", offer: offers.find((offer) => normalizeStatus(offer.status) === "W REALIZACJI")?.offer_number, time: "ostatnio" }
      ].filter(Boolean);

  return (
    <section className="company-offers-panel">
      {message && <div className="settings-message">{message}</div>}

      <div className="company-offer-stats">
        {statCards.map((card) => (
          <article className="offer-stat-card" key={card.label}>
            <span className={`offer-stat-icon ${card.icon}`}>
              <OfferIcon type={card.icon} />
            </span>
            <div>
              <p>{card.label}</p>
              <strong>{card.value}</strong>
              <small>{card.hint}</small>
            </div>
          </article>
        ))}
      </div>

      <div className="company-offers-command-bar">
        <div>
          <h3>Lista ofert</h3>
          <p>Wybierz ofertę, aby zobaczyć jej szczegóły i dostępne działania.</p>
        </div>
        <div className="company-offers-command-actions">
          <button
            type="button"
            className={filtersOpen ? "btn btn-secondary offer-filter-toggle active" : "btn btn-secondary offer-filter-toggle"}
            onClick={() => setFiltersOpen((current) => !current)}
            aria-expanded={filtersOpen}
          >
            <OfferIcon type="filter" />
            Filtry
            {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
          </button>
          <button type="button" className="btn btn-success offers-new-button" onClick={() => navigate("/offers/new")}>
            <OfferIcon type="plus" />
            Nowa oferta
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="company-offers-toolbar" aria-label="Filtry ofert">
          <label className="offer-filter-control offer-filter-search">
            <span>Wyszukaj</span>
            <span className="offers-search">
              <OfferIcon type="search" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Numer, temat, klient lub obiekt" />
            </span>
          </label>
          <label className="offer-filter-control">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Wszystkie</option>
              <option value="ZAAKCEPTOWANA">Zaakceptowana</option>
              <option value="DO AKCEPTACJI">Do akceptacji</option>
              <option value="W REALIZACJI">W realizacji</option>
              <option value="SZKIC">Szkic</option>
              <option value="ODRZUCONA">Odrzucona</option>
            </select>
          </label>
          <label className="offer-filter-control">
            <span>Obiekt</span>
            <select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>
              <option value="all">Wszystkie obiekty</option>
              {sites.map((site) => (
                <option key={site.id} value={String(site.id)}>{site.name}</option>
              ))}
              {offers
                .filter((offer) => offer.object_name && !offer.object_id)
                .map((offer) => (
                  <option key={offer.object_name} value={offer.object_name}>{offer.object_name}</option>
                ))}
            </select>
          </label>
          <label className="offer-filter-control offer-filter-dates">
            <span>Okres utworzenia</span>
            <span className="offers-date-range">
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Data od" />
              <b>do</b>
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Data do" />
            </span>
          </label>
          <label className="offer-filter-control">
            <span>Kwota netto</span>
            <select value={amountFilter} onChange={(event) => setAmountFilter(event.target.value)}>
              <option value="all">Wszystkie kwoty</option>
              <option value="to1000">do 1 000 PLN</option>
              <option value="1000to5000">1 000 - 5 000 PLN</option>
              <option value="over5000">powyżej 5 000 PLN</option>
            </select>
          </label>
          <div className="offer-filter-actions">
            <button type="button" className="btn btn-secondary" onClick={resetFilters}>Wyczyść</button>
          </div>
        </div>
      )}

      <div className="company-offers-layout">
        <article className="company-offers-table-card">
          <header className="company-offers-list-header">
            <div>
              <h3>Oferty</h3>
              <p>{filteredOffers.length} z {offers.length} ofert spełnia obecne kryteria.</p>
            </div>
            <span>{visibleOffers.length} na stronie</span>
          </header>
          {loading ? (
            <div className="company-offers-empty">Ładowanie ofert...</div>
          ) : filteredOffers.length === 0 ? (
            <div className="company-offers-empty">Brak ofert spełniających wybrane filtry.</div>
          ) : (
            <>
              <div className="company-offers-table-shell">
                <table className="company-offers-table">
                  <thead>
                    <tr>
                      <th><button type="button" onClick={() => changeSort("offer_number")}>Numer</button></th>
                      <th><button type="button" onClick={() => changeSort("object_name")}>Obiekt</button></th>
                      <th><button type="button" onClick={() => changeSort("status")}>Status</button></th>
                      <th><button type="button" onClick={() => changeSort("total_price")}>Kwota</button></th>
                      <th><button type="button" onClick={() => changeSort("created_at")}>Data utworzenia</button></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOffers.map((offer) => (
                      <tr
                        key={offer.id}
                        className={Number(selectedOfferId) === Number(offer.id) ? "selected" : ""}
                        onClick={() => setSelectedOfferId(offer.id)}
                      >
                        <td><strong>{offer.offer_number || `Oferta ${offer.id}`}</strong></td>
                        <td>{offer.object_name || "-"}</td>
                        <td><StatusBadge status={offer.status} /></td>
                        <td>{money(offer.total_price, offer.currency)}</td>
                        <td>{formatDate(offer.created_at || offer.issue_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <footer className="company-offers-pagination">
                <span>Wyświetlanie {filteredOffers.length ? (page - 1) * pageSize + 1 : 0}-{Math.min(page * pageSize, filteredOffers.length)} z {filteredOffers.length} ofert</span>
                <div>
                  <button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>
                  {Array.from({ length: pageCount }, (_, index) => (
                    <button key={index + 1} type="button" className={page === index + 1 ? "active" : ""} onClick={() => setPage(index + 1)}>
                      {index + 1}
                    </button>
                  )).slice(0, 5)}
                  <button type="button" disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button>
                </div>
              </footer>
            </>
          )}
        </article>

        <aside className="company-offer-detail">
          {!currentDetail ? (
            <div className="company-offers-empty">Wybierz ofertę, aby zobaczyć szczegóły.</div>
          ) : (
            <>
              <header className="offer-detail-card-header">
                <div>
                  <h3>{currentDetail.offer_number || `Oferta ${currentDetail.id}`}</h3>
                  <StatusBadge status={currentDetail.status} />
                </div>
                <button type="button" className="offer-detail-close" onClick={() => setSelectedOfferId(null)} aria-label="Zamknij">×</button>
              </header>

              {detailLoading ? (
                <div className="company-offers-empty compact">Ładowanie szczegółów...</div>
              ) : (
                <>
                  <div className="offer-detail-grid">
                    <div><span>Klient</span><strong>{currentDetail.client_company_name || currentDetail.customer_name || currentDetail.company_name || "-"}</strong></div>
                    <div><span>Data aktualizacji</span><strong>{formatDateTime(currentDetail.updated_at)}</strong></div>
                    <div><span>Obiekt</span><strong>{currentDetail.object_name || "-"}</strong></div>
                    <div><span>Wartość netto</span><strong>{money(detailTotals.net, currentDetail.currency)}</strong></div>
                    <div><span>Przygotował</span><strong>{currentDetail.prepared_by_name || currentDetail.salesperson || currentDetail.creator_name || "-"}</strong></div>
                    <div><span>Wartość brutto</span><strong>{money(detailTotals.gross, currentDetail.currency)}</strong></div>
                    <div><span>Data utworzenia</span><strong>{formatDateTime(currentDetail.created_at || currentDetail.issue_date)}</strong></div>
                    <div><span>Ważna do</span><strong>{formatDate(currentDetail.valid_until)}</strong></div>
                  </div>

                  <section className="offer-products-panel">
                    <h4>Produkty w ofercie ({currentDetail.items?.length || 0})</h4>
                    {(currentDetail.items || []).length ? (
                      <div className="offer-products-table-shell">
                        <table className="offer-products-table">
                          <thead>
                            <tr>
                              <th>Produkt</th>
                              <th>Kod</th>
                              <th>Ilość</th>
                              <th>Cena netto</th>
                              <th>Wartość</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentDetail.items.map((item) => (
                              <tr key={item.id || `${productCode(item)}-${productName(item)}`}>
                                <td>
                                  <div className="offer-product-cell">
                                    <span className="offer-product-thumb">{productName(item).slice(0, 1).toUpperCase()}</span>
                                    <strong>{productName(item)}</strong>
                                  </div>
                                </td>
                                <td>{productCode(item)}</td>
                                <td>{asNumber(item.quantity)} {item.unit || "szt."}</td>
                                <td>{money(item.unit_price ?? item.price_net ?? 0, currentDetail.currency)}</td>
                                <td>{money(getItemNet(item), currentDetail.currency)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="company-offers-empty compact">Brak produktów w tej ofercie.</div>
                    )}

                    <div className="offer-detail-summary">
                      <span>Wartość netto <strong>{money(detailTotals.net, currentDetail.currency)}</strong></span>
                      <span>VAT <strong>{money(detailTotals.vat, currentDetail.currency)}</strong></span>
                      <span className="gross">Wartość brutto <strong>{money(detailTotals.gross, currentDetail.currency)}</strong></span>
                    </div>
                  </section>

                  <footer className="offer-detail-actions">
                    <button type="button" onClick={() => navigate(`/offers/${currentDetail.id}`)}><OfferIcon type="eye" />Podgląd</button>
                    <button type="button" onClick={() => downloadPdf(currentDetail)} disabled={actionLoading === "pdf"}><OfferIcon type="pdf" />Pobierz PDF</button>
                    <button type="button" className="primary" onClick={() => navigate(`/offers/edit/${currentDetail.id}`)}><OfferIcon type="edit" />Edytuj</button>
                    <button type="button" onClick={duplicateOffer} disabled={actionLoading === "duplicate"}><OfferIcon type="copy" />Duplikuj</button>
                    <button type="button" className="danger" onClick={() => setOfferToDelete(currentDetail)}><OfferIcon type="trash" />Usuń</button>
                  </footer>
                </>
              )}
            </>
          )}
        </aside>

        <aside className="company-offers-sidebar">
          <section>
            <h4>Statystyki klienta</h4>
            <dl>
              <div><dt>Ostatnia oferta</dt><dd>{latestOffer ? `${formatDate(latestOffer.created_at || latestOffer.issue_date)} ${latestOffer.offer_number || ""}` : "-"}</dd></div>
              <div><dt>Łączna wartość ofert</dt><dd>{money(stats.totalValue)}</dd></div>
              <div><dt>Średnia wartość oferty</dt><dd>{money(averageValue)}</dd></div>
              <div><dt>Zaakceptowane</dt><dd>{stats.accepted}</dd></div>
              <div><dt>W realizacji</dt><dd>{stats.progress}</dd></div>
              <div><dt>Szkice</dt><dd>{stats.drafts}</dd></div>
              <div><dt>Współczynnik akceptacji</dt><dd className="acceptance">{acceptanceRate}%</dd></div>
            </dl>
          </section>

          <section>
            <h4>Szybkie akcje</h4>
            <button type="button" onClick={() => navigate("/offers/new")}><OfferIcon type="plus" />Nowa oferta</button>
            <button type="button" onClick={() => onChangeTab?.("sites")}><OfferIcon type="plus" />Dodaj obiekt</button>
            <button type="button" onClick={() => onChangeTab?.("employees")}><OfferIcon type="plus" />Dodaj pracownika</button>
            <button type="button" onClick={() => onChangeTab?.("tickets")}><OfferIcon type="eye" />Przejdź do zgłoszeń</button>
          </section>

          <section>
            <h4>Ostatnia aktywność</h4>
            {activityRows.length ? (
              <ul className="offer-activity-list">
                {activityRows.map((activity, index) => (
                  <li key={`${activity.label}-${index}`}>
                    <strong>{activity.label}</strong>
                    <span>{activity.offer || "-"} · {activity.time}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sidebar-empty">Brak aktywności.</p>
            )}
          </section>
        </aside>
      </div>

      <ConfirmationModal
        isOpen={!!offerToDelete}
        onClose={() => setOfferToDelete(null)}
        onConfirm={deleteOffer}
        title="Usuń ofertę"
        confirmText={actionLoading === "delete" ? "Usuwanie..." : "Usuń"}
      >
        <p>Czy na pewno chcesz usunąć ofertę <strong>{offerToDelete?.offer_number || offerToDelete?.id}</strong>?</p>
      </ConfirmationModal>
    </section>
  );
}
