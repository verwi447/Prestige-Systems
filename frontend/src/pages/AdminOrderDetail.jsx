import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Building2, CalendarDays, CheckCircle2, CircleUserRound, ClipboardList,
  FileText, History, Link2, MapPin, MessageSquare, MoreHorizontal, PackageCheck,
  Plus, RefreshCcw, Send, ShoppingCart, UserRound, Users, X
} from "lucide-react";
import { adminOrders as ordersAPI } from "../api";
import AppState from "../components/AppState";
import { getRequestErrorMessage, showSuccess } from "../lib/feedback";
import "./AdminOrders.css";
import "./AdminOrderDetail.css";

const statusLabels = {
  NEW: "Nowe", ACCEPTED: "Przyjęte", IN_PROGRESS: "W realizacji",
  WAITING_FOR_CLIENT: "Oczekuje na klienta", WAITING_FOR_PARTS: "Oczekuje na towar",
  REJECTED: "Odrzucone", COMPLETED: "Zrealizowane", CANCELLED: "Anulowane"
};
const priorityLabels = { LOW: "Niski", NORMAL: "Normalny", HIGH: "Wysoki", CRITICAL: "Krytyczny" };
const offerStatusLabels = {
  SZKIC: "Szkic",
  "DO AKCEPTACJI": "Oczekuje na klienta",
  "WYSŁANA": "Wysłana",
  "W REALIZACJI": "W realizacji",
  ZAAKCEPTOWANA: "Zaakceptowana",
  ODRZUCONA: "Odrzucona",
  ZAKOŃCZONA: "Zakończona"
};
const money = (value) => `${Number(value || 0).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const date = (value) => value ? new Date(value).toLocaleString("pl-PL") : "-";
const adminName = (admin) => [admin?.first_name, admin?.last_name].filter(Boolean).join(" ") || admin?.email || "-";

export default function AdminOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedAdminId, setSelectedAdminId] = useState("");
  const [activeTab, setActiveTab] = useState(() => (
    new URLSearchParams(window.location.search).get("tab") === "offer" ? "offer" : "data"
  ));
  const [comment, setComment] = useState("");

  const currentUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [orderResponse, adminsResponse] = await Promise.all([ordersAPI.getById(id), ordersAPI.getAssignees()]);
      setOrder(orderResponse.data);
      setAdmins(adminsResponse.data || []);
      setSelectedAdminId(orderResponse.data.assigned_to_id || "");
    } catch (err) {
      setError(getRequestErrorMessage(err, "Nie udalo sie pobrac zamowienia."));
    } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => (order?.items || []).reduce((sum, item) => {
    const net = Number(item.total_net || 0);
    const vat = net * Number(item.vat_rate || 0) / 100;
    return { net: sum.net + net, vat: sum.vat + vat, gross: sum.gross + net + vat };
  }, { net: 0, vat: 0, gross: 0 }), [order]);

  const mutate = async (request, successMessage = "Zmiany w zamowieniu zostaly zapisane.") => {
    setSaving(true); setError("");
    try { await request(); await load(); showSuccess(successMessage); return true; }
    catch (err) { setError(getRequestErrorMessage(err, "Operacja nie powiodla sie.")); return false; }
    finally { setSaving(false); }
  };
  const assign = async (adminId = selectedAdminId) => {
    if (!adminId) return setError("Wybierz administratora.");
    if (await mutate(() => ordersAPI.assign(id, adminId), "Opiekun zamowienia zostal przypisany.")) setAssignOpen(false);
  };
  const addComment = async () => {
    const content = comment.trim();
    if (!content) return setError("Wpisz treść komentarza.");
    if (await mutate(() => ordersAPI.addComment(id, content), "Komentarz zostal dodany.")) setComment("");
  };

  if (loading && !order) return <div className="page admin-order-detail"><AppState variant="loading" title="Ladowanie zamowienia" description="Pobieramy dane klienta, pozycje i historie." /></div>;
  if (!order) return <div className="page admin-order-detail"><AppState variant="error" title="Nie znaleziono zamowienia" description={error || "Zamowienie nie istnieje albo nie masz do niego dostepu."} actionLabel="Wroc do zamowien" onAction={() => navigate("/orders")} /></div>;

  const assignee = admins.find((admin) => Number(admin.id) === Number(order.assigned_to_id));
  const linkedOffers = order.offers || [];
  const primaryOffer = linkedOffers[0] || null;
  const primaryOfferIsDraft = primaryOffer?.status === "SZKIC";
  const primaryOfferLabel = primaryOfferIsDraft ? "Dokończ ofertę" : "Zobacz ofertę";
  const openPrimaryOffer = () => navigate(primaryOffer
    ? primaryOfferIsDraft ? `/offers/edit/${primaryOffer.id}` : `/offers/${primaryOffer.id}`
    : `/offers/new?orderId=${id}`);
  const tabs = [
    ["data", "Dane zamówienia", ClipboardList], ["items", "Pozycje zamówienia", ShoppingCart, order.items?.length || 0],
    ["offer", "Oferta", FileText, linkedOffers.length],
    ["comments", "Komentarze", MessageSquare, order.comments?.length || 0],
    ["history", "Historia", History, order.history_count || 0]
  ];

  return <div className="page admin-order-detail">
    <header className="admin-order-detail-header">
      <div>
        <Link to="/orders"><ArrowLeft size={17} /> Wróć do zamówień</Link>
        <div className="admin-order-title-line"><h1>{order.order_number}</h1><span className={`order-badge status ${order.status}`}>{statusLabels[order.status]}</span><span className={`order-badge priority ${order.priority}`}>{priorityLabels[order.priority] || order.priority}</span></div>
        <p>{order.subject}</p>
      </div>
      <div className="admin-order-header-actions">
        <button type="button"><MoreHorizontal size={18} /> Więcej</button>
        <button type="button" onClick={() => setAssignOpen(true)}><Users size={18} /> Przypisz</button>
        <button type="button" className="primary" onClick={openPrimaryOffer}>{primaryOffer ? <FileText size={18} /> : <Plus size={18} />} {primaryOffer ? primaryOfferLabel : "Utwórz ofertę"}</button>
      </div>
    </header>
    {error && <div className="admin-orders-error">{error}</div>}

    <section className="admin-order-identity-bar">
      <Identity icon={Building2} label="Firma" value={order.company_name || order.customer_name} />
      <Identity icon={MapPin} label="Obiekt" value={order.object_name} detail={[order.object_address, order.object_postal_code, order.object_city].filter(Boolean).join(", ")} />
      <Identity icon={UserRound} label="Kontakt" value={order.contact_name || [order.creator_first_name, order.creator_last_name].filter(Boolean).join(" ")} detail={order.customer_email || order.creator_email} />
      <Identity icon={CalendarDays} label="Data złożenia" value={date(order.created_at)} />
    </section>

    <div className="admin-order-detail-layout">
      <main className="admin-order-detail-main">
        <nav className="admin-order-tabs">{tabs.map(([key, label, Icon, count]) => <button type="button" key={key} className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key)}><Icon size={17} /> {label}{count !== undefined && <span>{count}</span>}</button>)}</nav>

        {activeTab === "data" && <>
          <div className="admin-order-data-grid">
            <section><h2>Informacje o zamówieniu</h2><Info label="Numer zamówienia" value={order.order_number} /><Info label="Status" value={statusLabels[order.status]} /><Info label="Priorytet" value={priorityLabels[order.priority]} /><Info label="Źródło" value="Katalog produktów" /><Info label="Data złożenia" value={date(order.created_at)} /><Info label="Ostatnia aktywność" value={date(order.updated_at)} /></section>
            <div className="admin-order-data-stack"><section><h2>Wiadomość od klienta</h2><p>{order.description || "Brak dodatkowej wiadomości."}</p></section><section><h2>Dane kontaktowe</h2><Info label="Zgłaszający" value={order.contact_name || adminName({ first_name: order.creator_first_name, last_name: order.creator_last_name })} /><Info label="E-mail" value={order.customer_email || order.creator_email} /><Info label="Telefon" value={order.contact_phone || order.customer_phone || "-"} /></section></div>
          </div>
          <section className="admin-order-total-band"><h2>Podsumowanie zamówienia</h2><div><Total icon={ShoppingCart} label="Liczba pozycji" value={order.items?.length || 0} /><Total icon={CircleUserRound} label="Wartość netto" value={money(totals.net)} /><Total icon={FileText} label="VAT" value={money(totals.vat)} /><Total icon={PackageCheck} label="Wartość brutto" value={money(totals.gross)} /></div></section>
        </>}

        {activeTab === "items" && <ItemsTable items={order.items || []} />}
        {activeTab === "offer" && <OrderOffers offers={linkedOffers} onCreate={() => navigate(`/offers/new?orderId=${id}`)} onOpen={(offer) => navigate(offer.status === "SZKIC" ? `/offers/edit/${offer.id}` : `/offers/${offer.id}`)} />}
        {activeTab === "comments" && <section className="admin-order-comments"><h2>Komentarze ({order.comments?.length || 0})</h2><div className="admin-order-comment-form"><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Napisz komentarz dla klienta..." maxLength={5000} rows={3} /><div><small>{comment.length}/5000</small><button type="button" disabled={saving || !comment.trim()} onClick={addComment}><Send size={16} /> Dodaj komentarz</button></div></div><div className="admin-order-comment-list">{(order.comments || []).map((entry) => <article key={entry.id}><i>{adminName(entry).split(" ").map((part) => part[0]).slice(0, 2).join("")}</i><div><header><strong>{adminName(entry)}</strong><time>{date(entry.created_at)}</time></header><p>{entry.content}</p></div></article>)}{!order.comments?.length && <p className="admin-order-no-comments">Brak komentarzy.</p>}</div></section>}
        {activeTab === "history" && <section className="admin-order-placeholder"><h2>Historia</h2><p>Ta sekcja zostanie dopracowana w kolejnym kroku.</p></section>}
      </main>

      <aside className="admin-order-side">
        <section><h2><RefreshCcw size={16} /> Status i opiekun</h2><label>Status<select value={order.status} disabled={saving} onChange={(event) => mutate(() => ordersAPI.changeStatus(id, event.target.value), "Status zamowienia zostal zapisany.")}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Priorytet<select value={order.priority || "NORMAL"} disabled={saving} onChange={(event) => mutate(() => ordersAPI.changePriority(id, event.target.value), "Priorytet zamowienia zostal zapisany.")}>{Object.entries(priorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><div className="admin-order-owner"><span>Opiekun</span><div><i>{adminName(assignee).split(" ").map((part) => part[0]).slice(0, 2).join("")}</i><strong>{adminName(assignee)}</strong><button type="button" onClick={() => setAssignOpen(true)}>Zmień</button></div></div></section>
        <section className="admin-order-side-summary"><h2>Podsumowanie</h2><Info label="Liczba pozycji" value={order.items?.length || 0} /><Info label="Wartość netto" value={money(totals.net)} /><Info label="VAT" value={money(totals.vat)} /><Info label="Wartość brutto" value={money(totals.gross)} /></section>
        <section className="admin-order-quick"><h2>Szybkie akcje</h2><button type="button" onClick={openPrimaryOffer}><Link2 size={16} /> {primaryOffer ? primaryOfferLabel : "Utwórz ofertę"}</button><button type="button" onClick={() => setActiveTab("comments")}><MessageSquare size={16} /> Dodaj komentarz</button><button type="button" onClick={() => assign(currentUser?.id)}><CircleUserRound size={16} /> Przypisz do mnie</button><button type="button" className="success" onClick={() => mutate(() => ordersAPI.changeStatus(id, "COMPLETED"), "Zamowienie oznaczono jako zrealizowane.")}><CheckCircle2 size={16} /> Oznacz jako zrealizowane</button></section>
      </aside>
    </div>

    {assignOpen && <div className="admin-order-modal-backdrop"><section className="admin-order-modal"><header><h2>Przypisz opiekuna</h2><button type="button" onClick={() => setAssignOpen(false)}><X size={18} /></button></header><label>Administrator<select value={selectedAdminId} onChange={(event) => setSelectedAdminId(event.target.value)}><option value="">Wybierz administratora</option>{admins.map((admin) => <option value={admin.id} key={admin.id}>{adminName(admin)}</option>)}</select></label><footer><button type="button" onClick={() => setAssignOpen(false)}>Anuluj</button><button type="button" className="primary" disabled={saving || !selectedAdminId} onClick={() => assign()}>Przypisz</button></footer></section></div>}
  </div>;
}

function Identity({ icon: Icon, label, value, detail }) { return <div><Icon size={20} /><span><small>{label}</small><strong>{value || "-"}</strong>{detail && <em>{detail}</em>}</span></div>; }
function Info({ label, value }) { return <div className="admin-order-info"><span>{label}</span><strong>{value || "-"}</strong></div>; }
function Total({ icon: Icon, label, value }) { return <div><Icon size={20} /><span>{label}<strong>{value}</strong></span></div>; }
function ItemsTable({ items }) { return <section className="admin-order-items-view"><h2>Pozycje zamówienia</h2><div><table><thead><tr><th>Produkt</th><th>Kod</th><th>Ilość</th><th>Cena netto</th><th>VAT</th><th>Wartość netto</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.code || "-"}</td><td>{Number(item.quantity).toLocaleString("pl-PL")} {item.unit || "szt."}</td><td>{money(item.price_net)}</td><td>{Number(item.vat_rate || 0)}%</td><td><strong>{money(item.total_net)}</strong></td></tr>)}</tbody></table></div></section>; }

function OrderOffers({ offers, onCreate, onOpen }) {
  if (!offers.length) {
    return <section className="admin-order-offer-empty"><FileText size={28} /><h2>Brak oferty dla zamówienia</h2><p>Utwórz ofertę z uzupełnionymi danymi klienta i pozycjami zamówienia.</p><button type="button" onClick={onCreate}><Plus size={17} /> Utwórz ofertę</button></section>;
  }

  return <section className="admin-order-offers-view">
    <header><div><h2>Oferta dla zamówienia</h2><p>Oferta jest powiązana z tym zamówieniem i widoczna dla klienta po publikacji.</p></div></header>
    <div className="admin-order-offer-list">{offers.map((offer) => {
      const isSent = Boolean(offer.client_sent_at) || !["SZKIC"].includes(offer.status);
      const isAccepted = offer.status === "ZAAKCEPTOWANA";
      return <article key={offer.id}>
        <div className="admin-order-offer-heading"><span><FileText size={20} /></span><div><strong>{offer.offer_number || `Oferta #${offer.id}`}</strong><p>{offer.title || "Oferta handlowa"}</p></div><em className={`offer-${String(offer.status || "").toLowerCase().replaceAll(" ", "-")}`}>{offerStatusLabels[offer.status] || offer.status}</em></div>
        <div className="admin-order-offer-metrics"><Info label="Liczba pozycji" value={offer.items_count || 0} /><Info label="Wartość netto" value={money(offer.total_net)} /><Info label="VAT" value={money(offer.vat_total)} /><Info label="Wartość brutto" value={money(offer.total_gross)} /></div>
        <div className="admin-order-offer-flow"><span className="done"><CheckCircle2 size={16} /><b>Utworzona</b><small>{date(offer.created_at)}</small></span><span className={isSent ? "done" : ""}><Send size={16} /><b>Wysłana do klienta</b><small>{isSent ? date(offer.client_sent_at || offer.updated_at) : "Oczekuje"}</small></span><span className={isAccepted ? "done" : ""}><CheckCircle2 size={16} /><b>Zaakceptowana</b><small>{isAccepted ? date(offer.accepted_at || offer.updated_at) : "Oczekuje"}</small></span></div>
        <footer><button type="button" onClick={() => onOpen(offer)}>{offer.status === "SZKIC" ? "Dokończ ofertę" : "Otwórz ofertę"}</button></footer>
      </article>;
    })}</div>
  </section>;
}
