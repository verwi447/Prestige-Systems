import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Headphones,
  Info,
  Mail,
  MapPin,
  Minus,
  MonitorCog,
  Package,
  Paperclip,
  Phone,
  Plus,
  Search,
  Trash2,
  UploadCloud
} from "lucide-react";
import { client as clientAPI } from "../api";
import AppState from "../components/AppState";
import { getStoredUser, hasClientPermission } from "../lib/permissions";
import { apiOrigin } from "../lib/runtimeConfig";
import "./NewTicket.css";

const steps = [
  { id: 1, title: "Wybor typu" },
  { id: 2, title: "Szczegoly" },
  { id: 3, title: "Podsumowanie" }
];

const typeLabels = {
  SYSTEM_FAILURE: "Awaria systemu",
  HARDWARE_FAILURE: "Awaria sprzetu",
  ORDER: "Zamowienie"
};

const typeDescriptions = {
  SYSTEM_FAILURE: "Problem z dzialaniem aplikacji, konfiguracji, dostepem lub systemem.",
  HARDWARE_FAILURE: "Problem z urzadzeniem, czytnikiem, kontrolerem, zamkiem lub innym sprzetem.",
  ORDER: "Wybierz artykuly z katalogu i okresl ilosci."
};

const priorityOptions = [
  { value: "LOW", label: "Niski", description: "Nie blokuje pracy", tone: "low" },
  { value: "NORMAL", label: "Normalny", description: "Wymaga obslugi", tone: "normal" },
  { value: "HIGH", label: "Wysoki", description: "Utrudnia prace", tone: "high" },
  { value: "CRITICAL", label: "Krytyczny", description: "Calkowicie blokuje prace", tone: "critical" }
];

const priorityLabels = Object.fromEntries(priorityOptions.map((item) => [item.value, item.label]));
const API_ORIGIN = apiOrigin;

const imageSrc = (url) => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url}`;
};

const money = (value) =>
  `${Number(value || 0).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zl`;

const fileSize = (size) => {
  if (!size) return "0 KB";
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
  return `${(size / 1024).toFixed(0)} KB`;
};

function Stepper({ activeStep, orderFlow = false }) {
  const visibleSteps = orderFlow ? steps.slice(1) : steps;
  return (
    <nav className="ticket-wizard-steps" aria-label="Kroki zgloszenia">
      {visibleSteps.map((step) => (
        <span key={step.id} className={`${activeStep === step.id ? "active" : ""} ${activeStep > step.id ? "done" : ""}`}>
          <b>{activeStep > step.id ? <Check size={15} /> : orderFlow ? step.id - 1 : step.id}</b>
          {step.title}
        </span>
      ))}
    </nav>
  );
}

function ChoiceCard({ icon: Icon, title, description, selected, onClick }) {
  return (
    <button type="button" className={selected ? "ticket-choice-card selected" : "ticket-choice-card"} onClick={onClick}>
      <span><Icon size={26} /></span>
      <strong>{title}</strong>
      <small>{description}</small>
    </button>
  );
}

function Field({ label, children, error, className = "", required = false }) {
  return (
    <label className={`ticket-field ${className}`}>
      <span>{label}{required && <b>*</b>}</span>
      {children}
      {error && <em>{error}</em>}
    </label>
  );
}

function SectionTitle({ number, title }) {
  return (
    <h2 className="ticket-section-title">
      <b>{number}</b>
      {title}
    </h2>
  );
}

function PriorityCard({ option, selected, onClick }) {
  return (
    <button type="button" className={`ticket-priority-card ${option.tone} ${selected ? "selected" : ""}`} onClick={onClick}>
      <span />
      <strong>{option.label}</strong>
      <small>{option.description}</small>
    </button>
  );
}

export default function NewTicket({ mode = "ticket" }) {
  const navigate = useNavigate();
  const user = getStoredUser();
  const orderFlow = mode === "order";
  const canViewCatalog = hasClientPermission(user, "VIEW_CATALOG");
  const firstStep = orderFlow ? 2 : 1;
  const [activeStep, setActiveStep] = useState(firstStep);
  const [sites, setSites] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState({});
  const [fileError, setFileError] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({
    group: orderFlow ? "order" : "",
    type: orderFlow ? "ORDER" : "",
    siteId: "",
    title: orderFlow ? "Zamowienie artykulow" : "",
    description: "",
    priority: "NORMAL",
    blocksWork: false,
    contactName: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "",
    contactPhone: user?.phone || "",
    items: []
  });

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [sitesRes, catalogRes] = await Promise.all([
          clientAPI.companySites(),
          canViewCatalog ? clientAPI.catalog() : Promise.resolve({ data: [] })
        ]);
        if (!mounted) return;
        setSites(Array.isArray(sitesRes.data) ? sitesRes.data : []);
        setCatalog(Array.isArray(catalogRes.data) ? catalogRes.data : []);
      } catch (err) {
        if (mounted) setError(err.response?.status === 403 ? "Brak dostepu do tworzenia zgloszen." : "Nie udalo sie pobrac danych kreatora.");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [canViewCatalog]);

  const selectedSite = sites.find((site) => String(site.id) === String(form.siteId));
  const selectedSiteAddress = selectedSite ? [selectedSite.address, selectedSite.postalCode || selectedSite.postal_code, selectedSite.city].filter(Boolean).join(", ") : "";
  const isOrder = form.type === "ORDER";
  const isFailure = form.type === "SYSTEM_FAILURE" || form.type === "HARDWARE_FAILURE";
  const urgent = ["HIGH", "CRITICAL"].includes(form.priority) || form.blocksWork;

  const categories = useMemo(() => {
    const names = catalog.map((product) => product.category?.name || product.category_name).filter(Boolean);
    return ["Wszystkie", ...Array.from(new Set(names))];
  }, [catalog]);

  const filteredCatalog = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    return catalog.filter((product) => {
      const productCategory = product.category?.name || product.category_name || "Inne";
      if (category !== "all" && category !== "Wszystkie" && productCategory !== category) return false;
      if (!query) return true;
      return [product.name, product.code, product.producer, product.description, productCategory].join(" ").toLowerCase().includes(query);
    });
  }, [catalog, catalogQuery, category]);

  const orderTotal = form.items.reduce((sum, item) => {
    if (!item.showPriceToClient) return sum;
    return sum + Number(item.sale_price ?? item.salePrice ?? 0) * Number(item.quantity || 1);
  }, 0);
  const allPricesVisible = form.items.length > 0 && form.items.every((item) => item.showPriceToClient);

  const chooseFailureType = (type) => {
    setForm((current) => ({
      ...current,
      group: "failure",
      type,
      title: "",
      priority: type === "SYSTEM_FAILURE" ? "HIGH" : "NORMAL"
    }));
  };

  const validateStep = (step = activeStep) => {
    const nextErrors = {};
    if (step === 1 && !form.type) nextErrors.type = "Wybierz typ zgloszenia.";
    if (step === 2) {
      if (!form.siteId) nextErrors.siteId = "Wybierz obiekt.";
      if (!form.title.trim()) nextErrors.title = "Podaj tytul.";
      if (isFailure && !form.description.trim()) nextErrors.description = "Opisz problem.";
      if (!form.priority) nextErrors.priority = "Wybierz priorytet.";
      if (isOrder && form.items.length === 0) nextErrors.items = "Dodaj minimum jeden artykul.";
      if (isOrder && form.items.some((item) => Number(item.quantity || 0) < 1)) nextErrors.items = "Ilosc kazdego artykulu musi wynosic minimum 1.";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const goNext = () => {
    if (!validateStep()) return;
    setActiveStep((step) => Math.min(3, step + 1));
  };

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".pdf", ".doc", ".docx"];
    const valid = [];
    const rejected = [];
    incoming.forEach((file) => {
      const lower = file.name.toLowerCase();
      const okType = allowed.some((ext) => lower.endsWith(ext));
      const okSize = file.size <= 20 * 1024 * 1024;
      if (okType && okSize) valid.push(file);
      else rejected.push(file);
    });
    setFileError(rejected.length ? "Niektore pliki maja niedozwolony format albo przekraczaja 20 MB." : "");
    if (valid.length) setFiles((current) => [...current, ...valid]);
  };

  const addProduct = (product) => {
    setForm((current) => {
      const existing = current.items.find((item) => Number(item.id) === Number(product.id));
      if (existing) {
        return { ...current, items: current.items.map((item) => Number(item.id) === Number(product.id) ? { ...item, quantity: Number(item.quantity || 1) + 1 } : item) };
      }
      return { ...current, items: [...current.items, { ...product, quantity: 1 }] };
    });
  };

  const updateQuantity = (productId, quantity) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => Number(item.id) === Number(productId) ? { ...item, quantity: Math.max(1, Number(quantity || 1)) } : item)
    }));
  };

  const submit = async () => {
    if (!validateStep(2)) {
      setActiveStep(2);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        type: form.type,
        siteId: Number(form.siteId),
        title: form.title,
        description: form.description,
        priority: form.priority,
        blocksWork: form.blocksWork,
        contactName: form.contactName,
        contactPhone: form.contactPhone,
        items: isOrder ? form.items.map((item) => ({ productId: item.id, quantity: Number(item.quantity || 1) })) : undefined
      };
      const created = await clientAPI.createTicket(payload);
      if (files.length && created.data?.id) {
        await clientAPI.uploadTicketAttachments(created.data.id, files);
      }
      window.dispatchEvent(new CustomEvent("app-toast", { detail: { message: isOrder ? "Zamowienie zostalo utworzone." : "Zgloszenie zostalo utworzone." } }));
      navigate(orderFlow ? "/client/orders" : "/client/tickets");
    } catch (err) {
      setError(err.response?.data?.error || "Nie udalo sie utworzyc zgloszenia.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="page ticket-wizard-page"><AppState variant="loading" title="Ladowanie kreatora" description="Przygotowujemy dane firmy, obiekty i katalog produktow." /></div>;
  }

  return (
    <div className="page ticket-wizard-page">
      <header className="ticket-wizard-header">
        <button type="button" onClick={() => navigate(orderFlow ? "/client/orders" : "/client/tickets")}><ChevronLeft size={17} /> {orderFlow ? "Wroc do zamowien" : "Wroc do zgloszen"}</button>
        <div>
          <h1>{orderFlow ? "Nowe zamowienie" : "Nowe zgloszenie"}</h1>
          <p>{orderFlow ? "Wybierz artykuly z katalogu i zloz zamowienie dla swojej firmy." : "Zglos awarie systemu lub sprzetu do serwisu."}</p>
        </div>
      </header>

      <Stepper activeStep={activeStep} orderFlow={orderFlow} />
      {error && <div className="ticket-wizard-error">{error}</div>}

      <main className="ticket-wizard-layout">
        <section className="ticket-wizard-card">
          {!orderFlow && activeStep === 1 && (
            <div className="ticket-step-panel">
              <h2>Wybierz rodzaj awarii</h2>
              <div className="ticket-choice-grid">
                <ChoiceCard icon={AlertTriangle} title="Awaria" description="Zglos problem techniczny z systemem lub sprzetem." selected={form.group === "failure"} onClick={() => setForm((current) => ({ ...current, group: "failure", type: "" }))} />
              </div>
              {form.group === "failure" && (
                <div className="ticket-subtype-grid">
                  <ChoiceCard icon={MonitorCog} title="Awaria systemu" description="Problem z dzialaniem systemu, aplikacji, konfiguracji lub dostepem." selected={form.type === "SYSTEM_FAILURE"} onClick={() => chooseFailureType("SYSTEM_FAILURE")} />
                  <ChoiceCard icon={Cpu} title="Awaria sprzetu" description="Problem z urzadzeniem, czytnikiem, kontrolerem, zamkiem lub innym sprzetem." selected={form.type === "HARDWARE_FAILURE"} onClick={() => chooseFailureType("HARDWARE_FAILURE")} />
                </div>
              )}
              {errors.type && <p className="ticket-inline-error">{errors.type}</p>}
            </div>
          )}

          {activeStep === 2 && (
            <div className="ticket-step-panel">
              <div className={`ticket-type-hero ${isOrder ? "order" : "failure"}`}>
                {isOrder ? <Package size={34} /> : form.type === "HARDWARE_FAILURE" ? <Cpu size={34} /> : <MonitorCog size={34} />}
                <div>
                  <h2>{typeLabels[form.type]}</h2>
                  <p>{typeDescriptions[form.type]}</p>
                  {!isOrder && <span>Priorytet domyslny: {form.type === "SYSTEM_FAILURE" ? "Wysoki" : "Normalny"}</span>}
                </div>
              </div>

              {isFailure && (
                <>
                  <SectionTitle number="1" title="Dane zgloszenia" />
                  <div className="ticket-form-grid">
                    <Field label="Obiekt" error={errors.siteId} required>
                      <select value={form.siteId} onChange={(event) => setForm({ ...form, siteId: event.target.value })} disabled={!sites.length}>
                        <option value="">{sites.length ? "Wybierz obiekt" : "Brak dostepnych obiektow"}</option>
                        {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                      </select>
                      {!sites.length && <em>Brak dostepnych obiektow. Skontaktuj sie z administratorem.</em>}
                      {selectedSite && <div className="ticket-site-hint"><MapPin size={16} /> {selectedSiteAddress || selectedSite.name}</div>}
                    </Field>
                    <Field label="Tytul zgloszenia" error={errors.title} required>
                      <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Np. Nie dziala rejestracja czasu pracy" />
                    </Field>
                  </div>

                  <SectionTitle number="2" title="Opis problemu" />
                  <Field label="Opis" error={errors.description} required>
                    <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={6} placeholder="Opisz problem, kiedy wystepuje i czego dotyczy." />
                    <small>Im dokladniejszy opis, tym szybciej serwis bedzie mogl zareagowac.</small>
                  </Field>

                  <SectionTitle number="3" title="Priorytet i wplyw na prace" />
                  <div className="ticket-priority-grid">
                    {priorityOptions.map((option) => <PriorityCard key={option.value} option={option} selected={form.priority === option.value} onClick={() => setForm({ ...form, priority: option.value })} />)}
                  </div>
                  {errors.priority && <p className="ticket-inline-error">{errors.priority}</p>}
                  <div className={form.blocksWork ? "ticket-block-card active" : "ticket-block-card"}>
                    <span><Info size={22} /></span>
                    <div>
                      <strong>Czy sprawa blokuje prace?</strong>
                      <small>Zaznacz, jesli problem uniemozliwia normalne korzystanie z systemu lub obiektu.</small>
                    </div>
                    {form.blocksWork && <em>Blokuje prace</em>}
                    <button type="button" className={form.blocksWork ? "ticket-switch on" : "ticket-switch"} onClick={() => setForm({ ...form, blocksWork: !form.blocksWork })} aria-label="Czy sprawa blokuje prace"><i /></button>
                  </div>

                  <SectionTitle number="4" title="Kontakt" />
                  <div className="ticket-form-grid">
                    <Field label="Osoba kontaktowa" required>
                      <input value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} />
                    </Field>
                    <Field label="Telefon kontaktowy" required>
                      <input value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} />
                    </Field>
                  </div>

                  <SectionTitle number="5" title="Zalaczniki" />
                  <p className="ticket-section-note">Dodaj zdjecia, zrzuty ekranu lub dokumenty, ktore pomoga w rozwiazaniu zgloszenia.</p>
                  <label className="ticket-upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
                    <UploadCloud size={30} />
                    <strong>Przeciagnij pliki tutaj lub kliknij, aby wybrac</strong>
                    <span>JPG, JPEG, PNG, WEBP, PDF, DOC, DOCX. Maksymalnie 20 MB na plik.</span>
                    <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx" onChange={(event) => addFiles(event.target.files)} />
                  </label>
                  {fileError && <p className="ticket-inline-error">{fileError}</p>}
                  <div className="ticket-files-list">
                    {files.map((file, index) => (
                      <div key={`${file.name}-${index}`}>
                        <Paperclip size={16} />
                        <span>{file.name}<small>{fileSize(file.size)}</small></span>
                        <button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {isOrder && (
                <>
                  <SectionTitle number="1" title="Dane zamowienia" />
                  <div className="ticket-form-grid">
                    <Field label="Obiekt" error={errors.siteId} required>
                      <select value={form.siteId} onChange={(event) => setForm({ ...form, siteId: event.target.value })} disabled={!sites.length}>
                        <option value="">{sites.length ? "Wybierz obiekt" : "Brak dostepnych obiektow"}</option>
                        {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                      </select>
                      {selectedSite && <div className="ticket-site-hint"><MapPin size={16} /> {selectedSiteAddress || selectedSite.name}</div>}
                    </Field>
                    <Field label="Tytul zamowienia" error={errors.title} required>
                      <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
                    </Field>
                    <Field label="Uwagi do zamowienia" className="full">
                      <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} placeholder="Dodaj uwagi do zamowienia." />
                    </Field>
                  </div>

                  <SectionTitle number="2" title="Artykuly" />
                  <div className="ticket-catalog-toolbar">
                    <label><Search size={17} /><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Szukaj artykulu po nazwie, kodzie lub producencie..." /></label>
                    <select value={category} onChange={(event) => setCategory(event.target.value)}>
                      {categories.map((item) => <option key={item} value={item === "Wszystkie" ? "all" : item}>{item}</option>)}
                    </select>
                  </div>
                  <div className="ticket-catalog-grid">
                    {filteredCatalog.map((product) => {
                      const src = imageSrc(product.image_url || product.imageUrl);
                      const categoryName = product.category?.name || product.category_name || "Inne";
                      return (
                        <article key={product.id} className="ticket-product-card">
                          {src ? <img src={src} alt={product.name} /> : <span className="ticket-product-placeholder"><Package size={24} /></span>}
                          <div>
                            <strong>{product.name}</strong>
                            <small>{[product.code, categoryName].filter(Boolean).join(" | ")}</small>
                            <p>{product.description || "Brak opisu produktu."}</p>
                            <b>{product.showPriceToClient ? money(product.sale_price ?? product.salePrice) : "Cena dostepna po potwierdzeniu"}</b>
                          </div>
                          <button type="button" onClick={() => addProduct(product)}><Plus size={16} /> Dodaj</button>
                        </article>
                      );
                    })}
                  </div>
                  <h3 className="ticket-selected-title">Wybrane artykuly</h3>
                  {errors.items && <p className="ticket-inline-error">{errors.items}</p>}
                  <div className="ticket-selected-table">
                    {form.items.map((item) => (
                      <div key={item.id}>
                        <strong>{item.name}</strong>
                        <span>{item.code || "-"}</span>
                        <div className="ticket-quantity">
                          <button type="button" onClick={() => updateQuantity(item.id, Number(item.quantity || 1) - 1)}><Minus size={14} /></button>
                          <input type="number" min="1" value={item.quantity} onChange={(event) => updateQuantity(item.id, event.target.value)} />
                          <button type="button" onClick={() => updateQuantity(item.id, Number(item.quantity || 1) + 1)}><Plus size={14} /></button>
                        </div>
                        <span>{item.unit || "szt."}</span>
                        <span>{item.showPriceToClient ? money(item.sale_price ?? item.salePrice) : "-"}</span>
                        <span>{item.showPriceToClient ? money(Number(item.sale_price ?? item.salePrice ?? 0) * Number(item.quantity || 1)) : "-"}</span>
                        <button type="button" onClick={() => setForm((current) => ({ ...current, items: current.items.filter((product) => product.id !== item.id) }))}><Trash2 size={16} /></button>
                      </div>
                    ))}
                  </div>

                  <SectionTitle number="3" title="Kontakt" />
                  <div className="ticket-form-grid">
                    <Field label="Osoba kontaktowa" required>
                      <input value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} />
                    </Field>
                    <Field label="Telefon kontaktowy" required>
                      <input value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} />
                    </Field>
                  </div>
                </>
              )}
            </div>
          )}

          {activeStep === 3 && (
            <div className="ticket-step-panel">
              <h2>Podsumowanie</h2>
              <div className="ticket-summary-list">
                <p><span>Typ zgloszenia</span><strong>{typeLabels[form.type]}</strong></p>
                <p><span>Obiekt</span><strong>{selectedSite?.name || "-"}</strong></p>
                <p><span>Tytul</span><strong>{form.title}</strong></p>
                {isFailure && <p><span>Priorytet</span><strong>{priorityLabels[form.priority]}</strong></p>}
                {isFailure && <p><span>Blokuje prace</span><strong>{form.blocksWork ? "Tak" : "Nie"}</strong></p>}
                <p><span>Osoba kontaktowa</span><strong>{form.contactName || "-"}</strong></p>
                <p><span>Telefon</span><strong>{form.contactPhone || "-"}</strong></p>
                {isOrder ? (
                  <>
                    <p><span>Wybrane artykuly</span><strong>{form.items.length}</strong></p>
                    {allPricesVisible && <p><span>Suma netto</span><strong>{money(orderTotal)}</strong></p>}
                    <div className="ticket-summary-note">Zamowienie zostanie przekazane do weryfikacji przez Prestige Systems.</div>
                  </>
                ) : (
                  <>
                    <p><span>Liczba zalacznikow</span><strong>{files.length}</strong></p>
                    <div className="ticket-summary-description">{form.description}</div>
                  </>
                )}
              </div>
            </div>
          )}

          <footer className="ticket-wizard-actions">
            <button type="button" disabled={activeStep === firstStep || saving} onClick={() => setActiveStep((step) => Math.max(firstStep, step - 1))}><ChevronLeft size={16} /> Wstecz</button>
            {activeStep < 3 ? (
              <button type="button" className="primary" onClick={goNext}>Dalej <ChevronRight size={16} /></button>
            ) : (
              <button type="button" className="primary" disabled={saving} onClick={submit}>{saving ? "Wysylanie..." : isOrder ? "Zloz zamowienie" : "Wyslij zgloszenie"}</button>
            )}
          </footer>
        </section>

        <aside className="ticket-wizard-side">
          <article className="ticket-side-summary">
            <h3>{isOrder ? "Podsumowanie zamowienia" : "Podsumowanie zgloszenia"}</h3>
            <p><span>Typ zgloszenia</span><strong>{form.type ? typeLabels[form.type] : "-"}</strong></p>
            <p><span>Obiekt</span><strong>{selectedSite?.name || "-"}</strong></p>
            {selectedSiteAddress && <small className="ticket-side-address">{selectedSiteAddress}</small>}
            {isOrder ? (
              <>
                <p><span>Liczba artykulow</span><strong>{form.items.length}</strong></p>
                {allPricesVisible && <p><span>Suma</span><strong>{money(orderTotal)}</strong></p>}
              </>
            ) : (
              <>
                <p><span>Priorytet</span><strong>{priorityLabels[form.priority]}</strong></p>
                <p><span>Blokuje prace</span><strong>{form.blocksWork ? "Tak" : "Nie"}</strong></p>
                <p><span>Zalaczniki</span><strong>{files.length}</strong></p>
                {urgent && <div className="ticket-urgent-note"><AlertTriangle size={18} /> Zgloszenie zostanie oznaczone jako wymagajace szybszej reakcji.</div>}
              </>
            )}
          </article>
          <article className="ticket-help-card">
            <span><Headphones size={24} /></span>
            <h3>Pomoc</h3>
            <p>W pilnych sprawach skontaktuj sie z naszym serwisem.</p>
            <a href="tel:+48221234567"><Phone size={15} /> +48 22 123 45 67</a>
            <a href="mailto:serwis@prestige-systems.pl"><Mail size={15} /> serwis@prestige-systems.pl</a>
          </article>
        </aside>
      </main>
    </div>
  );
}
