import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleUserRound,
  Clock3,
  Download,
  Eye,
  FileClock,
  FileText,
  Flag,
  History,
  LockKeyhole,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserCog,
  Users,
  X
} from "lucide-react";
import { client as clientAPI, protectedFiles, tickets as ticketsAPI } from "../api";
import BarrierIcon from "../components/BarrierIcon";
import BarrierCheckbox from "../components/BarrierCheckbox";
import "./TicketDetail.css";

const statusOptions = [
  ["NEW", "Nowe"],
  ["ACCEPTED", "Przyjete"],
  ["IN_PROGRESS", "W realizacji"],
  ["WAITING_FOR_CLIENT", "Oczekuje na klienta"],
  ["WAITING_FOR_PARTS", "Oczekuje na czesci"],
  ["REJECTED", "Odrzucone"],
  ["COMPLETED", "Zakonczone"],
  ["CANCELLED", "Anulowane"]
];

const priorityOptions = [
  ["LOW", "Niski"],
  ["NORMAL", "Normalny"],
  ["HIGH", "Wysoki"],
  ["CRITICAL", "Krytyczny"]
];

const statusLabels = Object.fromEntries(statusOptions);
const priorityLabels = Object.fromEntries(priorityOptions);

const tabs = [
  { key: "details", label: "Dane zgloszenia", icon: FileText },
  { key: "comments", label: "Komentarze", icon: MessageSquare, countKey: "comments" },
  { key: "history", label: "Historia", icon: History },
  { key: "offers", label: "Powiazane oferty", icon: BriefcaseBusiness, countKey: "offers" }
];

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

const formatSize = (value) => {
  const size = Number(value || 0);
  if (!size) return "-";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const formatMoney = (value) =>
  `${Number(value || 0).toLocaleString("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} zl netto`;

const initials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "PS";

const isImage = (file = {}) => {
  const name = file.originalName || file.original_name || file.fileName || file.file_name || "";
  return String(file.mimeType || file.mime_type || "").startsWith("image/") || /\.(jpg|jpeg|png|webp)$/i.test(name);
};

const extensionOf = (file = {}) => {
  const name = file.originalName || file.original_name || file.fileName || file.file_name || "";
  return name.split(".").pop()?.toUpperCase() || "PLIK";
};

function DetailField({ label, value, children }) {
  return (
    <div className="ticket-admin-field">
      <span>{label}</span>
      <strong>{children || value || "-"}</strong>
    </div>
  );
}

function Avatar({ name, tone = "admin", online = false }) {
  return (
    <span className={`ticket-admin-avatar ${tone}`}>
      {initials(name)}
      {online && <i />}
    </span>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="ticket-admin-modal-backdrop" role="dialog" aria-modal="true">
      <div className="ticket-admin-modal">
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Zamknij">
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const commentRef = useRef(null);
  const fileInputRef = useRef(null);
  const menuRef = useRef(null);
  const [ticket, setTicket] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [availableOffers, setAvailableOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState("comments");
  const [commentText, setCommentText] = useState("");
  const [commentFiles, setCommentFiles] = useState([]);
  const [internalNote, setInternalNote] = useState(false);
  const [modal, setModal] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusForm, setStatusForm] = useState({ status: "IN_PROGRESS", comment: "", publicComment: false, notifyClient: true });
  const [assignForm, setAssignForm] = useState({ adminId: "" });
  const [closeForm, setCloseForm] = useState({ summary: "", notifyClient: true, addHistory: true });
  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [editForm, setEditForm] = useState({ title: "", description: "", category: "", source: "" });
  const [adminSearch, setAdminSearch] = useState("");

  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }, []);
  const isAdmin = user?.role === "ADMIN";

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  };

  const loadTicket = useCallback(async () => {
    const response = isAdmin ? await ticketsAPI.getById(id) : await clientAPI.ticket(id);
    setTicket(response.data);
    setStatusForm((prev) => ({ ...prev, status: response.data.status || "NEW" }));
    setAssignForm({ adminId: response.data.assignedToId || "" });
  }, [id, isAdmin]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    loadTicket()
      .catch((err) => {
        if (mounted) setError(err.response?.data?.error || "Nie udalo sie pobrac zgloszenia.");
      })
      .finally(() => mounted && setLoading(false));

    if (isAdmin) {
      ticketsAPI.getAssignableAdmins().then((response) => mounted && setAdmins(response.data || [])).catch(() => {});
    }

    return () => {
      mounted = false;
    };
  }, [isAdmin, loadTicket]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const runAction = async (fn, successMessage) => {
    setSaving(true);
    try {
      const response = await fn();
      if (response?.data?.number || response?.data?.ticket_number) setTicket(response.data);
      else await loadTicket();
      setModal(null);
      showToast(successMessage);
    } catch (err) {
      showToast(err.response?.data?.error || "Operacja nie powiodla sie.", "error");
    } finally {
      setSaving(false);
    }
  };

  const submitComment = () => {
    const content = commentText.trim();
    if (!content && !commentFiles.length) {
      showToast("Wpisz tresc komentarza albo dodaj zalacznik.", "error");
      return;
    }
    const apiCall = isAdmin
      ? ticketsAPI.addComment(id, { content, isInternal: internalNote, attachments: commentFiles })
      : clientAPI.addTicketComment(id, content);
    runAction(() => apiCall, internalNote ? "Dodano notatke wewnetrzna." : "Dodano komentarz.").then(() => {
      setCommentText("");
      setCommentFiles([]);
      setInternalNote(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  };

  const selectCommentFiles = (files) => {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    setCommentFiles((current) => [...current, ...selected].slice(0, 10));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeCommentFile = (index) => {
    setCommentFiles((current) => current.filter((_file, fileIndex) => fileIndex !== index));
  };

  const openCommentAttachmentPicker = () => {
    setActiveTab("comments");
    window.setTimeout(() => fileInputRef.current?.click(), 80);
  };

  const quickComment = (asNote = false) => {
    setActiveTab("comments");
    setInternalNote(asNote);
    window.setTimeout(() => commentRef.current?.focus(), 80);
  };

  const prefillAiSuggestion = (comment) => {
    setActiveTab("comments");
    setInternalNote(false);
    setCommentText(comment.content || comment.body || "");
    window.setTimeout(() => commentRef.current?.focus(), 80);
  };

  const createOfferDraft = async () => {
    if (!isAdmin) return;
    await runAction(() => ticketsAPI.createOfferDraft(id), "Przygotowano szkic oferty.");
    navigate(`/offers/new?ticketId=${id}`);
  };

  const openAssignModal = () => {
    setAdminSearch("");
    setModal("assign");
  };

  const openEditModal = () => {
    setEditForm({
      title: ticket.title || ticket.subject || "",
      description: ticket.description || "",
      category: ticket.category || "",
      source: ticket.source || ""
    });
    setMenuOpen(false);
    setModal("edit");
  };

  const openExistingOfferModal = async () => {
    setModal("linkOffer");
    setSelectedOfferId("");
    try {
      const response = await ticketsAPI.getAvailableOffers(id);
      setAvailableOffers(response.data || []);
    } catch (err) {
      setAvailableOffers([]);
      showToast(err.response?.data?.error || "Nie udalo sie pobrac ofert.", "error");
    }
  };

  if (loading) {
    return (
      <div className="page ticket-admin-page">
        <div className="ticket-admin-skeleton hero" />
        <div className="ticket-admin-skeleton body" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page ticket-admin-page">
        <div className="ticket-admin-error">{error}</div>
      </div>
    );
  }

  if (!ticket) return null;

  const comments = ticket.comments || [];
  const attachments = ticket.attachments || [];
  const history = ticket.history || [];
  const offers = ticket.offers || [];
  const assigneeName = ticket.assignedTo?.name || ticket.assignedToName || "Nie przypisano";
  const companyName = ticket.companyName || ticket.customerName || "NovaTest Solutions";
  const siteName = ticket.site?.name || ticket.siteName || "Parking Glowny";
  const status = ticket.status || "NEW";
  const priority = ticket.priority || "NORMAL";
  const commentAttachmentId = (file) => Number(file.commentId ?? file.ticket_comment_id ?? 0);
  const unlinkedAttachments = attachments.filter((file) => !commentAttachmentId(file));
  const isCommentsTab = activeTab === "comments";

  return (
    <div className="page ticket-admin-page">
      {toast && <div className={`ticket-admin-toast ${toast.type}`}>{toast.message}</div>}

      <div className="ticket-admin-breadcrumb">
        <Link to={isAdmin ? "/tickets" : "/client/tickets"}><ArrowLeft size={17} /></Link>
        <Link to={isAdmin ? "/tickets" : "/client/tickets"}>Zgloszenia</Link>
        <span>/</span>
        <strong>{ticket.number || ticket.ticket_number}</strong>
      </div>

      <header className="ticket-admin-hero">
        <div>
          <div className="ticket-admin-title-row">
            <h1>{ticket.number || ticket.ticket_number}</h1>
            <span className={`ticket-admin-badge priority ${priority}`}>{priorityLabels[priority] || priority}</span>
            {!isCommentsTab && <span className={`ticket-admin-badge status ${status}`}>{statusLabels[status] || status}</span>}
          </div>
          <h2>{ticket.title || ticket.subject}</h2>
          <p>{companyName} <span>•</span> {siteName}</p>
          <div className="ticket-admin-meta">
            <span><CalendarDays size={15} /> Utworzone: {formatDate(ticket.createdAt || ticket.created_at)}</span>
            <span><Clock3 size={15} /> Ostatnia aktywnosc: {formatDate(ticket.lastActivityAt || ticket.updated_at)}</span>
          </div>
        </div>

        <div className="ticket-admin-actions">
          {isAdmin && (
            <>
              {!isCommentsTab && <button type="button" className="ticket-admin-button ghost" onClick={() => setModal("status")}>
                <UserCog size={17} /> Zmien status <ChevronDown size={15} />
              </button>}
              <button type="button" className="ticket-admin-button ghost" onClick={openAssignModal}>
                <Users size={17} /> Przypisz osobe
              </button>
              <button type="button" className="ticket-admin-button primary" onClick={() => setModal("offer")}>
                <Plus size={18} /> Utworz oferte
              </button>
            </>
          )}
          <div className="ticket-admin-menu-wrap" ref={menuRef}>
            <button type="button" className="ticket-admin-icon-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Wiecej akcji">
              <MoreHorizontal size={19} />
            </button>
            {menuOpen && (
              <div className="ticket-admin-menu">
                <button type="button" onClick={openEditModal}>Edytuj zgloszenie</button>
                <button type="button" onClick={() => setModal("priority")}>Zmien priorytet</button>
                <button type="button" onClick={() => runAction(() => ticketsAPI.assignAdmin(id, user.id), "Zgloszenie przypisane do Ciebie.")}>Przypisz do mnie</button>
                <button type="button" onClick={() => quickComment(true)}>Dodaj notatke wewnetrzna</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className={`ticket-admin-operation-bar ${isCommentsTab ? "comments-active" : ""}`}>
        {!isCommentsTab && <div>
          <span className="blue"><Bell size={24} /></span>
          <div><small>Status</small><strong className="blue-text">{statusLabels[status] || status}</strong></div>
        </div>}
        <div className={`ticket-admin-priority-summary ${priority}`}>
          <span><Flag size={24} /></span>
          <div><small>Priorytet</small><strong>{priorityLabels[priority] || priority}</strong></div>
        </div>
        <div>
          <Avatar name={assigneeName} online />
          <div><small>Przypisany</small><strong>{assigneeName}</strong></div>
        </div>
      </section>

      <div className="ticket-admin-layout">
        <main className="ticket-admin-main">
          <section className="ticket-admin-tabs-card">
            <nav className="ticket-admin-tabs">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const count = tab.countKey ? (ticket[tab.countKey] || []).length : null;
                return (
                  <button type="button" key={tab.key} className={activeTab === tab.key ? "active" : ""} onClick={() => setActiveTab(tab.key)}>
                    <Icon size={18} /> {tab.label}
                    {count ? <span>{count}</span> : null}
                  </button>
                );
              })}
            </nav>

            {activeTab === "details" && (
              <div className="ticket-admin-tab-body">
                <article className="ticket-admin-panel">
                  <h3>Opis problemu</h3>
                  <p className="ticket-admin-description">{ticket.description || "Brak opisu problemu."}</p>
                </article>
                <div className="ticket-admin-two-cols">
                  <article className="ticket-admin-panel">
                    <h3>Dane techniczne / kategoria</h3>
                    <DetailField label="Kategoria" value={ticket.category || "Awaria urzadzenia"} />
                    <DetailField label="Zrodlo" value={ticket.source || "Portal klienta"} />
                    <DetailField label="Numer zgloszenia" value={ticket.number || ticket.ticket_number} />
                    <DetailField label="Data utworzenia" value={formatDate(ticket.createdAt || ticket.created_at)} />
                    <DetailField label="Ostatnia aktywnosc" value={formatDate(ticket.lastActivityAt || ticket.updated_at)} />
                  </article>
                  <article className="ticket-admin-panel">
                    <h3>Przypisanie / realizacja</h3>
                    <DetailField label="Przypisany pracownik" value={assigneeName} />
                    <DetailField label="Dzial" value="Serwis Techniczny" />
                    <DetailField label="Rola" value="Serwisant" />
                    {isAdmin && (
                      <div className="ticket-admin-inline-actions">
                        <button type="button" onClick={openAssignModal}>Zmien przypisanie</button>
                        <button type="button" onClick={() => runAction(() => ticketsAPI.assignAdmin(id, user.id), "Zgloszenie przypisane do Ciebie.")}>Przypisz do mnie</button>
                      </div>
                    )}
                  </article>
                </div>
              </div>
            )}

            {activeTab === "comments" && (
              <div className="ticket-admin-tab-body">
                <div className={`ticket-admin-composer ${internalNote ? "is-internal" : ""}`}>
                  <textarea
                    ref={commentRef}
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    placeholder={internalNote ? "Dodaj notatke dla zespolu..." : "Dodaj komentarz dla klienta..."}
                    aria-label={internalNote ? "Tresc notatki wewnetrznej" : "Tresc komentarza"}
                    maxLength={5000}
                    rows={4}
                  />
                  <div className="ticket-admin-composer-row">
                    <div className="ticket-admin-composer-tools">
                      {isAdmin && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={internalNote}
                          className={`ticket-admin-internal-note ${internalNote ? "active" : ""}`}
                          onClick={() => setInternalNote(!internalNote)}
                        >
                          <BarrierIcon checked={internalNote} />
                          <LockKeyhole size={17} aria-hidden="true" />
                          <span>
                            <strong>Notatka wewnetrzna</strong>
                            <small>Widoczna tylko dla administratorow</small>
                          </span>
                        </button>
                      )}
                      <button type="button" className="ticket-admin-attach-button" onClick={openCommentAttachmentPicker} title="Dodaj zalacznik">
                        <Paperclip size={17} /> <span>Dodaj zalacznik</span>
                      </button>
                      <input ref={fileInputRef} type="file" multiple className="ticket-admin-hidden-input" accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx" onChange={(event) => selectCommentFiles(event.target.files)} />
                    </div>
                    <button type="button" className="ticket-admin-button primary" onClick={submitComment} disabled={saving}>
                      <Send size={17} /> Dodaj komentarz
                    </button>
                  </div>
                  {commentFiles.length > 0 && (
                    <div className="ticket-admin-pending-files" aria-label="Wybrane zalaczniki">
                      {commentFiles.map((file, index) => (
                        <span key={`${file.name}-${file.lastModified}-${index}`}>
                          <Paperclip size={14} /> {file.name} <small>{formatSize(file.size)}</small>
                          <button type="button" onClick={() => removeCommentFile(index)} aria-label={`Usun ${file.name}`}><X size={14} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="ticket-admin-comments">
                  {comments.map((comment) => (
                    <article key={comment.id} className={`ticket-admin-comment ${comment.isInternal ? "internal" : ""} ${comment.isAiGenerated ? "ai" : ""}`}>
                      {comment.isAiGenerated
                        ? <span className="ticket-admin-ai-avatar" aria-hidden="true"><Sparkles size={18} /></span>
                        : <Avatar name={comment.authorName} tone={comment.authorRole?.startsWith("CLIENT") ? "client" : "admin"} online={!comment.authorRole?.startsWith("CLIENT")} />}
                      <div>
                        <header>
                          <strong>{comment.authorName}</strong>
                          <span className={comment.isAiGenerated ? "ai" : comment.isInternal ? "note" : ""}>
                            {comment.isAiGenerated ? "Sugestia AI" : comment.isInternal ? "Notatka wewnetrzna" : comment.authorRole?.startsWith("CLIENT") ? "Klient" : "Prestige Systems"}
                          </span>
                          <time>• {formatDate(comment.createdAt || comment.created_at)}</time>
                        </header>
                        <p>{comment.content || comment.body}</p>
                        {isAdmin && comment.isAiGenerated && (
                          <button type="button" className="ticket-admin-ai-send" onClick={() => prefillAiSuggestion(comment)}>
                            <Send size={14} /> Wyslij do klienta
                          </button>
                        )}
                        <CommentAttachments
                          files={attachments.filter((file) => commentAttachmentId(file) === Number(comment.id))}
                          onDelete={(file) => runAction(() => ticketsAPI.deleteAttachment(id, file.id), "Usunieto zalacznik.")}
                          isAdmin={isAdmin}
                        />
                      </div>
                    </article>
                  ))}
                  {unlinkedAttachments.length > 0 && (
                    <section className="ticket-admin-legacy-attachments">
                      <h3>Pozostale zalaczniki</h3>
                      <p>Pliki dodane przed polaczeniem zalacznikow z komentarzami.</p>
                      <CommentAttachments files={unlinkedAttachments} onDelete={(file) => runAction(() => ticketsAPI.deleteAttachment(id, file.id), "Usunieto zalacznik.")} isAdmin={isAdmin} />
                    </section>
                  )}
                  {!comments.length && <div className="ticket-admin-empty">Brak komentarzy. Dodaj pierwszy wpis do zgłoszenia.</div>}
                </div>
              </div>
            )}


            {activeTab === "history" && (
              <div className="ticket-admin-tab-body">
                <div className="ticket-admin-history">
                  {history.map((entry) => (
                    <article key={entry.id}>
                      <time>{formatDate(entry.createdAt || entry.created_at)}</time>
                      <strong>{entry.label || entry.action}</strong>
                      <span>{entry.authorName || "System"}</span>
                    </article>
                  ))}
                  {!history.length && <div className="ticket-admin-empty">Brak historii dla tego zgloszenia.</div>}
                </div>
              </div>
            )}

            {activeTab === "offers" && (
              <div className="ticket-admin-tab-body">
                <div className="ticket-admin-offers-head">
                  <h3>Powiazane oferty</h3>
                  {isAdmin && <div className="ticket-admin-offers-actions">
                    <button type="button" className="ticket-admin-button ghost" onClick={openExistingOfferModal}><BriefcaseBusiness size={18} /> Dodaj istniejaca</button>
                    <button type="button" className="ticket-admin-button primary" onClick={() => setModal("offer")}><Plus size={18} /> Utworz oferte ze zgloszenia</button>
                  </div>}
                </div>
                {offers.length ? (
                  <div className="ticket-admin-offers-grid">
                    {offers.map((offer) => (
                      <article key={offer.id} className="ticket-admin-offer-card">
                        <strong>{offer.number || offer.offer_number}</strong>
                        <h4>{offer.title}</h4>
                        <p>Status: {offer.status}</p>
                        <p>Wartosc: {formatMoney(offer.totalPrice || offer.total_price)}</p>
                        <p>Data: {formatDate(offer.createdAt || offer.created_at, false)}</p>
                        <div>
                          <Link to={`/offers/${offer.id}`}>Otworz oferte</Link>
                          <a href={`/pdf/${offer.id}`} target="_blank" rel="noreferrer">Pobierz PDF</a>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="ticket-admin-empty big">
                    <BriefcaseBusiness size={32} />
                    <strong>Brak powiazanych ofert</strong>
                    <span>Mozesz utworzyc oferte na podstawie tego zgloszenia.</span>
                    {isAdmin && <button type="button" className="secondary" onClick={openExistingOfferModal}>Dodaj istniejaca oferte</button>}
                    {isAdmin && <button type="button" onClick={() => setModal("offer")}>Utworz oferte ze zgloszenia</button>}
                  </div>
                )}
              </div>
            )}
          </section>
        </main>

        <aside className="ticket-admin-side">
          <section className="ticket-admin-side-card">
            {!isCommentsTab && <>
              <SideLabel label="STATUS" />
              <select value={status} onChange={(event) => runAction(() => ticketsAPI.changeStatus(id, { status: event.target.value, notifyClient: true }), "Zmieniono status.")} disabled={!isAdmin}>
                {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </>}
            <SideLabel label="PRIORYTET" />
            <select className={`priority-select ${priority}`} value={priority} onChange={(event) => runAction(() => ticketsAPI.changePriority(id, event.target.value), "Zmieniono priorytet.")} disabled={!isAdmin}>
              {priorityOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>

            <SideLabel label="PRZYPISANY" />
            <div className="ticket-admin-assignee">
              <Avatar name={assigneeName} online />
              <div><strong>{assigneeName}</strong><span>{ticket.assignedTo?.email || ticket.assignedToEmail || "brak e-mail"}</span></div>
              {isAdmin && <button type="button" onClick={openAssignModal}>Zmien</button>}
            </div>

            <SideInfo icon={Building2} label="KLIENT" title={companyName} />
            <SideInfo icon={MapPin} label="OBIEKT" title={siteName} text={[ticket.site?.address, [ticket.site?.postalCode, ticket.site?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")} />
            <SideInfo icon={CircleUserRound} label="ZGLASZAJACY" title={ticket.reportedBy?.name || ticket.contactName} text={`${ticket.reportedBy?.email || ticket.contactEmail || ""}\n${ticket.reportedBy?.phone || ticket.contactPhone || ""}`} />

            <SideLabel label="SZYBKIE AKCJE" />
            <div className="ticket-admin-quick-actions">
              <button type="button" onClick={() => quickComment(false)}><MessageSquare size={18} /> Dodaj komentarz</button>
              <button type="button" onClick={openCommentAttachmentPicker}><Paperclip size={18} /> Dodaj zalacznik</button>
              {isAdmin && <button type="button" onClick={() => setModal("close")}><CheckCircle2 size={18} /> Zamknij zgloszenie</button>}
              {isAdmin && <button type="button" onClick={() => quickComment(true)}><FileClock size={18} /> Dodaj notatke</button>}
            </div>
          </section>
        </aside>
      </div>

      {modal === "status" && (
        <Modal title="Zmien status" onClose={() => setModal(null)}>
          <div className="ticket-admin-form">
            <DetailField label="Aktualny status" value={statusLabels[status]} />
            <label>Nowy status<select value={statusForm.status} onChange={(event) => setStatusForm((prev) => ({ ...prev, status: event.target.value }))}>{statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Komentarz opcjonalny<textarea value={statusForm.comment} onChange={(event) => setStatusForm((prev) => ({ ...prev, comment: event.target.value }))} rows={3} /></label>
            <BarrierCheckbox className="check" checked={statusForm.publicComment} onChange={(value) => setStatusForm((prev) => ({ ...prev, publicComment: value }))} label="Dodaj komentarz publiczny dla klienta" />
            <BarrierCheckbox className="check" checked={statusForm.notifyClient} onChange={(value) => setStatusForm((prev) => ({ ...prev, notifyClient: value }))} label="Wyslij powiadomienie do klienta" />
            <footer><button type="button" onClick={() => setModal(null)}>Anuluj</button><button type="button" onClick={() => runAction(() => ticketsAPI.changeStatus(id, statusForm), "Zmieniono status.")} disabled={saving}>Zmien status</button></footer>
          </div>
        </Modal>
      )}

      {modal === "edit" && (
        <Modal title="Edytuj zgloszenie" onClose={() => setModal(null)}>
          <div className="ticket-admin-form">
            <label>Temat<input type="text" value={editForm.title} onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))} /></label>
            <label>Opis<textarea value={editForm.description} onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))} rows={4} /></label>
            <label>Kategoria<input type="text" value={editForm.category} onChange={(event) => setEditForm((prev) => ({ ...prev, category: event.target.value }))} /></label>
            <label>Zrodlo<input type="text" value={editForm.source} onChange={(event) => setEditForm((prev) => ({ ...prev, source: event.target.value }))} /></label>
            <footer><button type="button" onClick={() => setModal(null)}>Anuluj</button><button type="button" onClick={() => runAction(() => ticketsAPI.update(id, editForm), "Zaktualizowano zgloszenie.")} disabled={saving}>Zapisz zmiany</button></footer>
          </div>
        </Modal>
      )}

      {modal === "priority" && (
        <Modal title="Zmien priorytet" onClose={() => setModal(null)}>
          <div className="ticket-admin-form">
            <label>Priorytet<select value={priority} onChange={(event) => runAction(() => ticketsAPI.changePriority(id, event.target.value), "Zmieniono priorytet.")}>{priorityOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          </div>
        </Modal>
      )}

      {modal === "assign" && (
        <Modal title="Przypisz osobe" onClose={() => setModal(null)}>
          <div className="ticket-admin-form">
            <label>Wyszukaj administratora<div className="ticket-admin-search"><Search size={17} /><input value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} placeholder="Szukaj serwisanta..." /></div></label>
            <div className="ticket-admin-admin-list">
              {admins.filter((admin) => {
                const name = [admin.first_name, admin.last_name].filter(Boolean).join(" ") || admin.email;
                const term = adminSearch.trim().toLowerCase();
                return !term || name.toLowerCase().includes(term) || admin.email?.toLowerCase().includes(term);
              }).map((admin) => {
                const name = [admin.first_name, admin.last_name].filter(Boolean).join(" ") || admin.email;
                return (
                  <button type="button" className={Number(assignForm.adminId) === Number(admin.id) ? "active" : ""} key={admin.id} onClick={() => setAssignForm({ adminId: admin.id })}>
                    <Avatar name={name} online />
                    <span><strong>{name}</strong><small>{admin.email}</small></span>
                  </button>
                );
              })}
            </div>
            <footer><button type="button" onClick={() => setModal(null)}>Anuluj</button><button type="button" onClick={() => runAction(() => ticketsAPI.assignAdmin(id, assignForm.adminId), "Zmieniono przypisanie.")} disabled={saving}>Przypisz</button></footer>
          </div>
        </Modal>
      )}

      {modal === "close" && (
        <Modal title="Zamknij zgloszenie" onClose={() => setModal(null)}>
          <div className="ticket-admin-form">
            <label>Podsumowanie rozwiazania<textarea value={closeForm.summary} onChange={(event) => setCloseForm((prev) => ({ ...prev, summary: event.target.value }))} rows={4} /></label>
            <BarrierCheckbox className="check" checked={closeForm.notifyClient} onChange={(value) => setCloseForm((prev) => ({ ...prev, notifyClient: value }))} label="Wyslij informacje do klienta" />
            <BarrierCheckbox className="check" checked={closeForm.addHistory} onChange={(value) => setCloseForm((prev) => ({ ...prev, addHistory: value }))} label="Dodaj wpis do historii" />
            <footer><button type="button" onClick={() => setModal(null)}>Anuluj</button><button type="button" onClick={() => runAction(() => ticketsAPI.close(id, closeForm), "Zgloszenie zamkniete.")} disabled={saving}>Zamknij zgloszenie</button></footer>
          </div>
        </Modal>
      )}

      {modal === "offer" && (
        <Modal title="Utworz oferte ze zgloszenia" onClose={() => setModal(null)}>
          <div className="ticket-admin-form">
            <p className="ticket-admin-modal-copy">System utworzy szkic oferty na podstawie danych zgloszenia.</p>
            <DetailField label="Firma" value={companyName} />
            <DetailField label="Obiekt" value={siteName} />
            <DetailField label="Osoba kontaktowa" value={ticket.reportedBy?.name || ticket.contactName} />
            <DetailField label="Temat zgloszenia" value={ticket.title || ticket.subject} />
            <footer><button type="button" onClick={() => setModal(null)}>Anuluj</button><button type="button" onClick={createOfferDraft} disabled={saving}>Utworz szkic oferty</button></footer>
          </div>
        </Modal>
      )}

      {modal === "linkOffer" && (
        <Modal title="Dodaj istniejaca oferte" onClose={() => setModal(null)}>
          <div className="ticket-admin-form">
            <p className="ticket-admin-modal-copy">Wybierz niepowiazana oferte firmy {companyName}.</p>
            {availableOffers.length ? (
              <label>Oferta
                <select value={selectedOfferId} onChange={(event) => setSelectedOfferId(event.target.value)}>
                  <option value="">Wybierz oferte</option>
                  {availableOffers.map((offer) => (
                    <option value={offer.id} key={offer.id}>
                      {offer.offer_number} - {offer.title} ({formatMoney(offer.total_price)})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="ticket-admin-empty">Brak dostepnych ofert tej firmy.</div>
            )}
            <footer>
              <button type="button" onClick={() => setModal(null)}>Anuluj</button>
              <button type="button" onClick={() => runAction(() => ticketsAPI.linkOffer(id, selectedOfferId), "Powiazano oferte ze zgloszeniem.")} disabled={saving || !selectedOfferId}>Dodaj oferte</button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SideLabel({ label }) {
  return <h3 className="ticket-admin-side-label">{label}</h3>;
}

function SideInfo({ icon: Icon, label, title, text }) {
  return (
    <div className="ticket-admin-side-info">
      <SideLabel label={label} />
      <div>
        <Icon size={20} />
        <span><strong>{title || "-"}</strong>{text && <em>{text}</em>}</span>
      </div>
    </div>
  );
}

function CommentAttachments({ files, onDelete, isAdmin }) {
  if (!files.length) return null;
  return (
    <section className="ticket-admin-comment-attachments">
      <div className="ticket-admin-attachments-table">
        {files.map((file) => (
          <article key={file.id}>
            <span className="file-preview">
              {isImage(file) ? <ProtectedAttachmentImage file={file} /> : extensionOf(file)}
            </span>
            <div><strong>{file.originalName || file.original_name || file.fileName || file.file_name}</strong><small>{file.mimeType || file.mime_type || extensionOf(file)} · {formatSize(file.sizeBytes || file.file_size)}</small></div>
            <span>{file.authorName || "-"}</span>
            <span>{formatDate(file.uploadedAt || file.uploaded_at, false)}</span>
            <span>{file.visibility === "INTERNAL" ? "Wewnetrzny" : "Publiczny"}</span>
            <div className="file-actions">
              <button type="button" onClick={() => protectedFiles.open(file.url)} aria-label="Podglad"><Eye size={17} /></button>
              <button type="button" onClick={() => protectedFiles.download(file.url, file.originalName || file.fileName)} aria-label="Pobierz"><Download size={17} /></button>
              {isAdmin && <button type="button" className="danger" onClick={() => onDelete(file)} aria-label="Usun"><Trash2 size={17} /></button>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProtectedAttachmentImage({ file }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    protectedFiles.get(file.url).then((response) => {
      objectUrl = window.URL.createObjectURL(response.data);
      if (active) setSrc(objectUrl);
      else window.URL.revokeObjectURL(objectUrl);
    }).catch(() => {});
    return () => {
      active = false;
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [file.url]);

  return src ? <img src={src} alt="" /> : extensionOf(file);
}
