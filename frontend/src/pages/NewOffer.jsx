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
import PdfExporter from "./offers/PdfExporter";
import { buildOfferPayload, calculateSummary, createEmptyOffer, emptyItem, mapOfferFromApi, normalizeCustomer } from "./offers/offerUtils";
import { ClientStep, CatalogStep, DocumentParamsStep, OfferDataStep, ProductsStep, steps, SummaryStep } from "./NewOfferSteps";
import "./NewOffer.css";

const UNSAVED_OFFER_MESSAGE = "Masz niezapisane zmiany w ofercie. Jeśli opuścisz kreator, zmiany mogą zostać utracone.";

const offerDraftSnapshot = (offer) => JSON.stringify(buildOfferPayload(offer, offer.status));

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
