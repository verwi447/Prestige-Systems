import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileText,
  MessageSquare,
  MoreVertical,
  Package,
  Paperclip,
  Send,
  ShieldAlert,
  User,
  Wrench
} from "lucide-react";
import { client as clientAPI } from "../api";
import AppState from "../components/AppState";
import { getStoredUser, hasClientPermission } from "../lib/permissions";
import "./ClientTicketDetail.css";

const typeLabels = {
  SYSTEM_FAILURE: "Awaria systemu",
  HARDWARE_FAILURE: "Awaria sprzetu",
  ORDER: "Zamowienie"
};

const statusLabels = {
  NEW: "Nowe",
  ACCEPTED: "Przyjete",
  IN_PROGRESS: "W realizacji",
  WAITING_FOR_CLIENT: "Oczekuje na klienta",
  WAITING_FOR_PARTS: "Oczekuje na czesci",
  REJECTED: "Odrzucone",
  COMPLETED: "Zakonczone",
  CANCELLED: "Anulowane"
};

const priorityLabels = {
  LOW: "Niski",
  NORMAL: "Normalny",
  HIGH: "Wysoki",
  CRITICAL: "Krytyczny"
};

const statusSteps = [
  { key: "NEW", label: "Nowe", icon: FileText },
  { key: "ACCEPTED", label: "Przyjete", icon: Clock3 },
  { key: "IN_PROGRESS", label: "W realizacji", icon: Wrench },
  { key: "WAITING_FOR_CLIENT", label: "Oczekuje na klienta", icon: User },
  { key: "COMPLETED", label: "Zakonczone", icon: CheckCircle2 }
];

const orderStatusSteps = [
  { key: "NEW", label: "Nowe", icon: FileText },
  { key: "ACCEPTED", label: "Przyjete", icon: Clock3 },
  { key: "WAITING_FOR_CLIENT", label: "Oczekuje na klienta", icon: User },
  { key: "IN_PROGRESS", label: "W realizacji", icon: Wrench },
  { key: "COMPLETED", label: "Zakonczone", icon: CheckCircle2 }
];

const allowedAttachmentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
const allowedAttachmentExtensions = new Set(["jpg", "jpeg", "png", "webp", "pdf", "doc", "docx"]);
const maxAttachmentSize = 20 * 1024 * 1024;

const formatDate = (value, withTime = true) => {
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

const formatMoney = (value) =>
  `${Number(value || 0).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zl`;

const initials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "PS";

const authorRoleLabel = (role) => (String(role || "").startsWith("CLIENT") ? "Klient" : "Prestige Systems");

function DetailRow({ label, value, children }) {
  return (
    <div className="client-ticket-detail-row">
      <span>{label}</span>
      <strong>{children || value || "-"}</strong>
    </div>
  );
}

export default function ClientTicketDetail() {
  const { id } = useParams();
  const fileInputRef = useRef(null);
  const commentRef = useRef(null);
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentError, setCommentError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [uploading, setUploading] = useState(false);

  const currentUser = useMemo(getStoredUser, []);
  const canComment = hasClientPermission(currentUser, "COMMENT_TICKET");
  const canUploadAttachments = hasClientPermission(currentUser, "CREATE_TICKET") || canComment;
  const canViewOffers = hasClientPermission(currentUser, "VIEW_OFFERS");

  const loadTicket = async () => {
    const response = await clientAPI.ticket(id);
    setTicket(response.data);
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    clientAPI.ticket(id)
      .then((response) => {
        if (mounted) setTicket(response.data);
      })
      .catch((err) => {
        if (mounted) {
          setError(err.response?.status === 404 ? "Zgloszenie nie istnieje albo nie masz do niego dostepu." : "Nie udalo sie pobrac zgloszenia.");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [id]);

  const currentStatusSteps = ticket?.type === "ORDER" ? orderStatusSteps : statusSteps;

  const activeStepIndex = useMemo(() => {
    if (["CANCELLED", "REJECTED"].includes(ticket?.status)) return -1;
    const steps = ticket?.type === "ORDER" ? orderStatusSteps : statusSteps;
    return Math.max(0, steps.findIndex((step) => step.key === ticket?.status));
  }, [ticket?.status, ticket?.type]);

  const submitComment = async () => {
    if (!canComment) return;
    const content = commentText.trim();
    setCommentError("");
    if (!content) {
      setCommentError("Wpisz tresc komentarza.");
      return;
    }
    setPostingComment(true);
    try {
      await clientAPI.addTicketComment(id, content);
      setCommentText("");
      await loadTicket();
    } catch (err) {
      setCommentError(err.response?.data?.error || "Nie udalo sie dodac komentarza.");
    } finally {
      setPostingComment(false);
    }
  };

  const uploadFiles = async (fileList) => {
    if (!canUploadAttachments) return;
    const files = Array.from(fileList || []);
    setUploadError("");
    if (!files.length) return;

    const validFiles = files.filter((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase();
      return allowedAttachmentTypes.has(file.type) && allowedAttachmentExtensions.has(extension) && file.size <= maxAttachmentSize;
    });

    if (validFiles.length !== files.length) {
      setUploadError("Dopuszczalne sa pliki JPG, PNG, WEBP, PDF, DOC i DOCX do 20 MB.");
      if (!validFiles.length) return;
    }

    setUploading(true);
    try {
      await clientAPI.uploadTicketAttachments(id, validFiles);
      await loadTicket();
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadError(err.response?.data?.error || "Nie udalo sie dodac zalacznika.");
    } finally {
      setUploading(false);
    }
  };

  const focusComment = () => {
    commentRef.current?.focus();
    commentRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (loading) {
    return (
      <div className="page client-ticket-detail-page">
        <AppState variant="loading" title="Ladowanie zgloszenia" description="Pobieramy szczegoly, komentarze i zalaczniki." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page client-ticket-detail-page">
        <AppState variant="error" title="Nie mozna otworzyc zgloszenia" description={error} />
      </div>
    );
  }

  if (!ticket) return null;

  const attachments = ticket.attachments || [];
  const comments = ticket.comments || [];
  const items = ticket.items || [];
  const offers = ticket.offers || [];
  const latestOffer = offers[0] || null;
  const site = ticket.site || {};
  const isOrder = ticket.type === "ORDER";
  const backPath = isOrder ? "/client/orders" : "/client/tickets";
  const backLabel = isOrder ? "Wroc do zamowien" : "Wroc do zgloszen";

  return (
    <div className="page client-ticket-detail-page">
      <header className="client-ticket-detail-top">
        <div className="client-ticket-detail-heading">
          <Link to={backPath} className="client-ticket-back-link">
            <ArrowLeft size={18} /> {backLabel}
          </Link>
          <div>
            <h1>{ticket.number || ticket.ticket_number}</h1>
            <p>{ticket.title || ticket.subject || "-"}</p>
            <div className="client-ticket-detail-badges">
              <span className={`client-detail-badge type-${ticket.type || "SYSTEM_FAILURE"}`}>{typeLabels[ticket.type] || ticket.type}</span>
              <span className={`client-detail-badge status-${ticket.status || "NEW"}`}>{statusLabels[ticket.status] || ticket.status}</span>
              <span className={`client-detail-badge priority-${ticket.priority || "NORMAL"}`}>{priorityLabels[ticket.priority] || ticket.priority}</span>
            </div>
          </div>
        </div>

        <div className="client-ticket-detail-actions">
          {isOrder && latestOffer && canViewOffers && (
            <Link to={`/client/offers/${latestOffer.id}`} className="client-detail-action-button primary">
              <FileText size={18} /> Przejrzyj oferte
            </Link>
          )}
          {canComment && <button type="button" className="client-detail-action-button" onClick={focusComment}>
            <MessageSquare size={18} /> Dodaj komentarz
          </button>}
          {canUploadAttachments && <button type="button" className="client-detail-action-button" onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={18} /> Dodaj zalacznik
          </button>}
          <button type="button" className="client-detail-icon-button" aria-label="Wiecej akcji">
            <MoreVertical size={18} />
          </button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="client-ticket-hidden-input"
        accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx"
        onChange={(event) => uploadFiles(event.target.files)}
      />
      {uploadError && <p className="client-ticket-form-error client-ticket-global-error">{uploadError}</p>}

      <section className="client-ticket-status-card">
        <h2>{isOrder ? "Status zamowienia" : "Status zgloszenia"}</h2>
        {["CANCELLED", "REJECTED"].includes(ticket.status) ? (
          <div className="client-ticket-cancelled-status">
            <AlertCircle size={20} /> {ticket.status === "REJECTED" ? "Zamówienie zostało odrzucone." : "Zgłoszenie zostało anulowane."}
          </div>
        ) : (
          <div className="client-ticket-status-track">
            {currentStatusSteps.map((step, index) => {
              const Icon = step.icon;
              const isActive = index <= activeStepIndex;
              return (
                <div className={`client-ticket-status-step ${isActive ? "is-active" : ""}`} key={step.key}>
                  <span className="client-ticket-status-icon"><Icon size={20} /></span>
                  <strong>{step.label}</strong>
                  {step.key === ticket.status && <small>{formatDate(ticket.updated_at || ticket.createdAt)}</small>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="client-ticket-detail-layout">
        <main className="client-ticket-detail-main">
          <section className="client-ticket-detail-card">
            <h2><MessageSquare size={20} /> {isOrder ? "Uwagi do zamowienia" : "Opis zgloszenia"}</h2>
            <p className="client-ticket-description">{ticket.description || "Brak opisu."}</p>
          </section>

          {isOrder && (
            <section className="client-ticket-detail-card">
              <h2><Package size={20} /> Pozycje zamowienia</h2>
              {items.length ? (
                <div className="client-ticket-items-table">
                  <div className="client-ticket-items-head">
                    <span>Artykul</span>
                    <span>Kod</span>
                    <span>Ilosc</span>
                    <span>Netto</span>
                  </div>
                  {items.map((item) => (
                    <div className="client-ticket-item-row" key={item.id || `${item.name}-${item.code}`}>
                      <strong>{item.name}</strong>
                      <span>{item.code || "-"}</span>
                      <span>{Number(item.quantity || 0).toLocaleString("pl-PL")} {item.unit || "szt."}</span>
                      <span>{formatMoney(item.total_net)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="client-ticket-empty">Brak pozycji zamowienia.</p>
              )}
            </section>
          )}

              {isOrder && latestOffer && canViewOffers && (
            <section className="client-ticket-detail-card client-order-offer-card">
              <div className="client-order-offer-heading">
                <div>
                  <h2><FileText size={20} /> Oferta do zamowienia</h2>
                  <p>{latestOffer.number || `Oferta #${latestOffer.id}`}</p>
                </div>
                <Link to={`/client/offers/${latestOffer.id}`} className="client-detail-action-button primary compact">
                  Przejrzyj oferte
                </Link>
              </div>
              <div className="client-order-offer-summary">
                <div>
                  <span>Tytul oferty</span>
                  <strong>{latestOffer.title || "Oferta handlowa"}</strong>
                </div>
                <div>
                  <span>Wartosc brutto</span>
                  <strong>{formatMoney(latestOffer.totalGross)}</strong>
                </div>
                <div>
                  <span>Wazna do</span>
                  <strong>{formatDate(latestOffer.validUntil, false)}</strong>
                </div>
              </div>
            </section>
          )}

          <section className="client-ticket-detail-card">
            <h2><MessageSquare size={20} /> Komentarze ({comments.length})</h2>
            {canComment && <div className="client-ticket-comment-composer">
              <span className="client-ticket-avatar">{initials(ticket.createdByName || ticket.contactName || currentUser?.email)}</span>
              <div>
                <textarea
                  ref={commentRef}
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                  placeholder="Napisz komentarz..."
                  rows={3}
                />
                <div className="client-ticket-comment-actions">
                  {canUploadAttachments && <button type="button" className="client-detail-icon-button" onClick={() => fileInputRef.current?.click()} aria-label="Dodaj zalacznik" disabled={uploading}>
                    <Paperclip size={17} />
                  </button>}
                  <button type="button" className="client-detail-action-button primary" onClick={submitComment} disabled={postingComment}>
                    <Send size={16} /> {postingComment ? "Dodawanie..." : "Dodaj komentarz"}
                  </button>
                </div>
                {commentError && <p className="client-ticket-form-error">{commentError}</p>}
              </div>
            </div>}
            <div className="client-ticket-comments-list">
              {comments.map((comment) => (
                <article className="client-ticket-comment" key={comment.id}>
                  <span className="client-ticket-avatar">{initials(comment.authorName)}</span>
                  <div>
                    <header>
                      <strong>{comment.authorName || "-"}</strong>
                      <span>{authorRoleLabel(comment.authorRole)}</span>
                      <time>{formatDate(comment.createdAt || comment.created_at)}</time>
                    </header>
                    <p>{comment.content || comment.body}</p>
                  </div>
                </article>
              ))}
              {!comments.length && <p className="client-ticket-empty">Brak komentarzy.</p>}
            </div>
          </section>
        </main>

        <aside className="client-ticket-detail-side">
          <section className="client-ticket-detail-card">
            <h2>Podsumowanie zgloszenia</h2>
            <DetailRow label="Numer" value={ticket.number || ticket.ticket_number} />
            <DetailRow label="Typ" value={typeLabels[ticket.type] || ticket.type} />
            <DetailRow label="Status">
              <span className={`client-detail-pill status-${ticket.status || "NEW"}`}>{statusLabels[ticket.status] || ticket.status}</span>
            </DetailRow>
            <DetailRow label="Priorytet">
              <span className={`client-detail-dot priority-dot-${ticket.priority || "NORMAL"}`} />
              {priorityLabels[ticket.priority] || ticket.priority}
            </DetailRow>
            <DetailRow label="Obiekt" value={ticket.siteName || site.name || "-"} />
            <DetailRow label="Data utworzenia" value={formatDate(ticket.createdAt || ticket.created_at)} />
            <DetailRow label="Ostatnia aktywnosc" value={formatDate(ticket.lastActivityAt || ticket.updated_at)} />
            <DetailRow label="Zalaczniki" value={attachments.length} />
            <DetailRow label="Komentarze" value={comments.length} />
            {!isOrder && <DetailRow label="Czy blokuje prace?" value={ticket.blocksWork ? "Tak" : "Nie"} />}
            {!isOrder && ticket.blocksWork && (
              <div className="client-ticket-side-alert">
                <ShieldAlert size={18} /> Zgloszenie oznaczone jako wymagajace szybszej reakcji.
              </div>
            )}
          </section>

        </aside>
      </div>
    </div>
  );
}
