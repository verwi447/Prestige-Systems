import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Headphones,
  Mail,
  MessageSquare,
  Package,
  Phone,
  Send,
  User,
  XCircle
} from "lucide-react";
import { client as clientAPI, offers as offersAPI, protectedFiles } from "../api";
import AppState from "../components/AppState";
import "./OfferDetail.css";

const statusMeta = {
  "WYSŁANA": { label: "Wysłana", className: "sent" },
  SENT: { label: "Wysłana", className: "sent" },
  "DO AKCEPTACJI": { label: "Do akceptacji", className: "approval" },
  TO_ACCEPTANCE: { label: "Do akceptacji", className: "approval" },
  ZAAKCEPTOWANA: { label: "Zaakceptowana", className: "accepted" },
  ACCEPTED: { label: "Zaakceptowana", className: "accepted" },
  ODRZUCONA: { label: "Odrzucona", className: "rejected" },
  REJECTED: { label: "Odrzucona", className: "rejected" },
  "W REALIZACJI": { label: "W realizacji", className: "progress" },
  IN_PROGRESS: { label: "W realizacji", className: "progress" },
  "ZAKOŃCZONA": { label: "Zakończona", className: "closed" },
  COMPLETED: { label: "Zakończona", className: "closed" }
};

const decisionStatuses = new Set(["DO AKCEPTACJI", "WYSŁANA", "TO_ACCEPTANCE", "SENT"]);

const formatMoney = (value, currency = "PLN") =>
  `${Number(value || 0).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === "PLN" ? "zł" : currency}`;

const formatDate = (value, withTime = false) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {})
  });
};

const daysLeft = (value) => {
  if (!value) return null;
  const end = new Date(value).setHours(23, 59, 59, 999);
  const diff = Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24));
  return Number.isFinite(diff) ? diff : null;
};

const initials = (name = "") =>
  name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "PS";

const calculateItem = (item) => {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unit_price || item.price_net || 0);
  const vatRate = Number(item.vat_rate ?? 23);
  const net = Number(item.net_total ?? item.total ?? quantity * unitPrice);
  const vat = Number(item.vat_value ?? net * (vatRate / 100));
  const gross = Number(item.gross_total ?? net + vat);
  return { quantity, unitPrice, vatRate, net, vat, gross };
};

function StatusBadge({ status }) {
  const meta = statusMeta[status] || { label: status || "Brak statusu", className: "neutral" };
  return <span className={`client-offer-detail-status ${meta.className}`}>{meta.label}</span>;
}

function DetailCard({ title, icon: Icon, children, className = "" }) {
  return (
    <section className={`client-offer-detail-card ${className}`}>
      {title && <h2>{Icon && <Icon size={20} />} {title}</h2>}
      {children}
    </section>
  );
}

function DetailRow({ label, value, children, className = "" }) {
  return (
    <div className={`client-offer-detail-row ${className}`.trim()}>
      <span>{label}</span>
      <strong>{children || value || "Nie określono"}</strong>
    </div>
  );
}

export default function OfferDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const commentRef = useRef(null);
  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }, []);
  const isAdmin = currentUser?.role === "ADMIN";
  const [offer, setOffer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [modal, setModal] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [downloading, setDownloading] = useState(false);

  const loadOffer = async () => {
    const response = isAdmin ? await offersAPI.getById(id) : await clientAPI.offer(id);
    setOffer(response.data);
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const request = isAdmin ? offersAPI.getById(id) : clientAPI.offer(id);
    request
      .then((response) => {
        if (mounted) setOffer(response.data);
      })
      .catch((err) => {
        if (mounted) setError(err.response?.status === 404 ? "Oferta nie istnieje albo nie masz do niej dostępu." : "Nie udało się pobrać oferty.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [id, isAdmin]);

  const summary = useMemo(() => {
    return (offer?.items || []).reduce(
      (acc, item) => {
        const calculated = calculateItem(item);
        acc.net += calculated.net;
        acc.vat += calculated.vat;
        acc.gross += calculated.gross;
        return acc;
      },
      { net: 0, vat: 0, gross: 0 }
    );
  }, [offer?.items]);

  const totalNet = offer?.totalNet ?? offer?.total_net ?? summary.net ?? offer?.total_price ?? 0;
  const vatTotal = offer?.vatTotal ?? offer?.vat_total ?? summary.vat ?? 0;
  const totalGross = offer?.totalGross ?? offer?.gross_total ?? summary.gross ?? Number(totalNet) + Number(vatTotal);
  const validDaysLeft = daysLeft(offer?.valid_until);
  const canDecide = !isAdmin && decisionStatuses.has(offer?.status);

  const downloadPdf = async () => {
    if (downloading) return;
    setActionError("");
    setDownloading(true);
    try {
      const response = isAdmin ? await offersAPI.getPDF(id) : await clientAPI.offerPdf(id);
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: "application/pdf" });
      if (!blob.size) throw new Error("Generated PDF is empty.");
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `oferta_${String(offer.offer_number || id).replace(/\//g, "_")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
      setDownloading(false);
    } catch (err) {
      setDownloading(false);
      setActionError(err.response?.data?.error || "Nie udało się pobrać PDF.");
    }
  };

  const acceptOffer = async () => {
    if (isAdmin) return;
    setActionError("");
    try {
      await clientAPI.acceptOffer(id);
      setModal(null);
      await loadOffer();
    } catch (err) {
      setActionError(err.response?.data?.error || "Nie udało się zaakceptować oferty.");
    }
  };

  const rejectOffer = async () => {
    if (isAdmin) return;
    setActionError("");
    try {
      await clientAPI.rejectOffer(id, rejectReason);
      setRejectReason("");
      setModal(null);
      await loadOffer();
    } catch (err) {
      setActionError(err.response?.data?.error || "Nie udało się odrzucić oferty.");
    }
  };

  const addComment = async () => {
    if (isAdmin) return;
    const content = comment.trim();
    setCommentError("");
    if (!content) {
      setCommentError("Wpisz treść komentarza.");
      return;
    }
    setPostingComment(true);
    try {
      await clientAPI.addOfferComment(id, content);
      setComment("");
      await loadOffer();
    } catch (err) {
      setCommentError(err.response?.data?.error || "Nie udało się dodać komentarza.");
    } finally {
      setPostingComment(false);
    }
  };

  if (loading) return <div className="page client-offer-detail-page"><AppState variant="loading" title="Ladowanie oferty" description="Pobieramy pozycje, warunki i dokument PDF." /></div>;
  if (error) return <div className="page client-offer-detail-page"><AppState variant="error" title="Nie mozna otworzyc oferty" description={error} /></div>;
  if (!offer) return null;

  const preparedBy = offer.preparedByName || offer.prepared_by_name || offer.salesperson || "Nie określono";
  const comments = offer.comments || [];
  const attachments = offer.attachments || [];
  const history = offer.history || [];

  return (
    <div className="page client-offer-detail-page">
      <header className="client-offer-detail-header">
        <div>
          <Link to={isAdmin ? "/offers" : "/client/offers"} className="client-offer-back"><ArrowLeft size={18} /> Wróć do ofert</Link>
          <div className="client-offer-title">
            <h1>{offer.offer_number || offer.number || `Oferta ${offer.id}`}</h1>
            <StatusBadge status={offer.status} />
          </div>
          <p>{offer.title || "Oferta handlowa"}</p>
          <div className="client-offer-meta">
            <span>Utworzono: {formatDate(offer.created_at)}</span>
            <span>Ważna do: {formatDate(offer.valid_until)}</span>
          </div>
        </div>
        <div className="client-offer-header-actions">
          {isAdmin && <button type="button" className="primary" onClick={() => navigate(`/offers/edit/${id}`)}><FileText size={18} /> Edytuj ofertę</button>}
          <button type="button" onClick={downloadPdf} disabled={downloading}><Download size={18} /> {downloading ? "Pobieranie..." : "Pobierz PDF"}</button>
          {canDecide && <button type="button" className="success" onClick={() => setModal("accept")}><CheckCircle2 size={18} /> Akceptuj ofertę</button>}
          {canDecide && <button type="button" className="danger" onClick={() => setModal("reject")}><XCircle size={18} /> Odrzuć ofertę</button>}
          {!isAdmin && <button type="button" onClick={() => commentRef.current?.focus()}><MessageSquare size={18} /> Dodaj komentarz</button>}
        </div>
      </header>

      {actionError && <div className="client-offer-alert error"><AlertCircle size={18} /> {actionError}</div>}

      <div className="client-offer-detail-layout">
        <main className="client-offer-detail-main">
          <DetailCard title="Podsumowanie oferty" icon={FileText}>
            <div className="client-offer-summary-grid">
              <DetailRow label="Numer" value={offer.offer_number || offer.number} />
              <DetailRow label="Temat" value={offer.title} />
              <DetailRow label="Status"><StatusBadge status={offer.status} /></DetailRow>
              <DetailRow label="Data utworzenia" value={formatDate(offer.created_at)} />
              <DetailRow label="Ważna do" value={formatDate(offer.valid_until)} />
              <DetailRow label="Obiekt" value={offer.site?.name || offer.object_name} />
              <DetailRow label="Przygotował" value={preparedBy} />
            </div>
          </DetailCard>

          <DetailCard title="Produkty / pozycje oferty" icon={Package}>
            <div className="client-offer-items-wrap">
              <table className="client-offer-items">
                <thead>
                  <tr>
                    <th>LP</th>
                    <th>Kod produktu</th>
                    <th>Nazwa produktu</th>
                    <th>Ilość</th>
                    <th>JM</th>
                    <th>Cena netto</th>
                    <th>VAT</th>
                    <th>Wartość netto</th>
                    <th>Wartość brutto</th>
                  </tr>
                </thead>
                <tbody>
                  {(offer.items || []).map((item, index) => {
                    const calculated = calculateItem(item);
                    return (
                      <tr key={item.id || index}>
                        <td>{item.item_number || index + 1}</td>
                        <td>{item.code || item.sku || "-"}</td>
                        <td className="client-offer-product-name"><strong>{item.title || item.name || "Pozycja"}</strong></td>
                        <td>{calculated.quantity.toLocaleString("pl-PL")}</td>
                        <td>{item.unit || "szt."}</td>
                        <td>{formatMoney(calculated.unitPrice, offer.currency)}</td>
                        <td>{calculated.vatRate}%</td>
                        <td>{formatMoney(calculated.net, offer.currency)}</td>
                        <td>{formatMoney(calculated.gross, offer.currency)}</td>
                      </tr>
                    );
                  })}
                  {(!offer.items || offer.items.length === 0) && <tr><td colSpan="9">Brak pozycji w ofercie.</td></tr>}
                </tbody>
              </table>
            </div>
          </DetailCard>

          <DetailCard title="Warunki oferty" icon={Clock3}>
            <div className="client-offer-summary-grid">
              <DetailRow label="Forma płatności" value={offer.payment_terms} />
              <DetailRow label="Termin realizacji" value={offer.realization_time || offer.delivery_date} />
              <DetailRow label="Ważność oferty" value={offer.valid_until ? `do ${formatDate(offer.valid_until)}` : "Nie określono"} />
              <DetailRow label="Dodatkowe uwagi" value={offer.remarks || offer.additional_info} />
            </div>
          </DetailCard>

          <DetailCard title="PDF / załączniki" icon={Download}>
            <div className="client-offer-pdf-box">
              <FileText size={28} />
              <div>
                <strong>{`oferta_${String(offer.offer_number || id).replace(/\//g, "_")}.pdf`}</strong>
                <span>PDF generowany na żądanie z aktualnego snapshotu oferty.</span>
              </div>
              <button type="button" onClick={downloadPdf} disabled={downloading}><Download size={17} /> {downloading ? "Pobieranie..." : "Pobierz PDF"}</button>
            </div>
            <div className="client-offer-attachments">
              {attachments.map((file) => (
                <button type="button" key={file.id} onClick={() => protectedFiles.open(file.url || file.file_path)}>
                  <FileText size={18} /> {file.file_name}
                </button>
              ))}
              {!attachments.length && <p>PDF oferty nie jest jeszcze dostępny jako zapisany załącznik.</p>}
            </div>
          </DetailCard>

          <DetailCard title="Komentarze" icon={MessageSquare}>
            {!isAdmin && (
              <div className="client-offer-comment-composer">
                <span>{initials(offer.contactName || preparedBy)}</span>
                <div>
                  <textarea ref={commentRef} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Napisz komentarz..." rows={3} />
                  <button type="button" onClick={addComment} disabled={postingComment}><Send size={16} /> {postingComment ? "Dodawanie..." : "Dodaj komentarz"}</button>
                  {commentError && <p className="client-offer-form-error">{commentError}</p>}
                </div>
              </div>
            )}
            <div className="client-offer-comments">
              {comments.map((entry) => {
                const authorName = entry.authorName || [entry.first_name, entry.last_name].filter(Boolean).join(" ") || entry.username || "-";
                return (
                  <article key={entry.id}>
                    <span>{initials(authorName)}</span>
                    <div>
                      <strong>{authorName}</strong>
                      <small>{formatDate(entry.createdAt || entry.created_at, true)}</small>
                      <p>{entry.content}</p>
                    </div>
                  </article>
                );
              })}
              {!comments.length && <p>Brak komentarzy.</p>}
            </div>
          </DetailCard>

          <DetailCard title="Historia" icon={Clock3}>
            <div className="client-offer-history">
              {history.map((entry) => (
                <article key={entry.id || `${entry.label}-${entry.createdAt}`}>
                  <time>{formatDate(entry.createdAt || entry.created_at, true)}</time>
                  <strong>{entry.label}</strong>
                  <span>{entry.authorName || "-"}</span>
                </article>
              ))}
              {!history.length && <p>Historia oferty będzie widoczna tutaj.</p>}
            </div>
          </DetailCard>
        </main>

        <aside className="client-offer-detail-side">
          <DetailCard title="Status oferty">
            <StatusBadge status={offer.status} />
            <DetailRow label="Wymaga akceptacji" value={canDecide ? "Tak" : "Nie"} />
            <DetailRow label="Ważna do" value={formatDate(offer.valid_until)} />
            <DetailRow label="Pozostało" value={validDaysLeft === null ? "Nie określono" : validDaysLeft >= 0 ? `${validDaysLeft} dni` : "Po terminie"} />
            {canDecide && <div className="client-offer-alert"><AlertCircle size={18} /> Ta oferta oczekuje na Twoją decyzję.</div>}
            {canDecide && (
              <div className="client-offer-side-actions">
                <button type="button" className="success" onClick={() => setModal("accept")}>Akceptuj ofertę</button>
                <button type="button" className="danger" onClick={() => setModal("reject")}>Odrzuć ofertę</button>
              </div>
            )}
          </DetailCard>

          <DetailCard title="Dane kontaktowe" icon={User}>
            <DetailRow label="Osoba kontaktowa" value={offer.contactName || offer.customer_name} />
            <DetailRow label="E-mail" value={offer.contactEmail || offer.customer_email} />
            <DetailRow label="Telefon" value={offer.contactPhone || offer.customer_phone} />
            <DetailRow label="Przygotował" value={preparedBy} />
          </DetailCard>

          <DetailCard title="Podsumowanie wartości" className="client-offer-totals-card">
            <DetailRow label="Wartość netto" value={formatMoney(totalNet, offer.currency)} />
            <DetailRow label="VAT" value={formatMoney(vatTotal, offer.currency)} />
            <DetailRow label="Wartość brutto" value={formatMoney(totalGross, offer.currency)} className="client-offer-total-row" />
          </DetailCard>

          {!isAdmin && (
            <section className="client-offer-help-card">
              <span><Headphones size={24} /></span>
              <h2>Pomoc</h2>
              <p>W sprawach dotyczących oferty skontaktuj się z naszym zespołem.</p>
              <a href="tel:+48221234567"><Phone size={18} /> +48 22 123 45 67</a>
              <a href="mailto:serwis@prestige-systems.pl"><Mail size={18} /> serwis@prestige-systems.pl</a>
            </section>
          )}
        </aside>
      </div>

      {modal === "accept" && (
        <div className="client-offer-modal-backdrop">
          <div className="client-offer-modal">
            <h2>Czy na pewno chcesz zaakceptować tę ofertę?</h2>
            <p>Po akceptacji oferta zmieni status na zaakceptowaną.</p>
            <div>
              <button type="button" onClick={() => setModal(null)}>Anuluj</button>
              <button type="button" className="success" onClick={acceptOffer}>Tak, akceptuję</button>
            </div>
          </div>
        </div>
      )}

      {modal === "reject" && (
        <div className="client-offer-modal-backdrop">
          <div className="client-offer-modal">
            <h2>Odrzuć ofertę</h2>
            <p>Możesz dodać powód odrzucenia. Będzie widoczny przy ofercie.</p>
            <textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Powód odrzucenia" rows={4} />
            <div>
              <button type="button" onClick={() => setModal(null)}>Anuluj</button>
              <button type="button" className="danger" onClick={rejectOffer}>Odrzuć ofertę</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
