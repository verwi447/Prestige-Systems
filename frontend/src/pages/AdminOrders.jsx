import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  PackageOpen,
  RefreshCcw,
  Search,
  ShoppingCart
} from "lucide-react";
import { adminOrders as ordersAPI } from "../api";
import AppState from "../components/AppState";
import { getRequestErrorMessage, showFeedback, showSuccess } from "../lib/feedback";
import "./AdminOrders.css";

const statusLabels = {
  NEW: "Nowe",
  ACCEPTED: "Przyjęte",
  IN_PROGRESS: "W realizacji",
  WAITING_FOR_CLIENT: "Oczekuje na klienta",
  WAITING_FOR_PARTS: "Oczekuje na towar",
  REJECTED: "Odrzucone",
  COMPLETED: "Zrealizowane",
  CANCELLED: "Anulowane"
};

const formatDate = (value) => value ? new Date(value).toLocaleString("pl-PL", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
}) : "-";

const formatMoney = (value) => `${Number(value || 0).toLocaleString("pl-PL", {
  minimumFractionDigits: 2, maximumFractionDigits: 2
})} zł`;

function Stat({ icon: Icon, value, label, tone }) {
  return <article className="admin-order-stat"><span className={tone}><Icon size={23} /></span><div><strong>{value}</strong><small>{label}</small></div></article>;
}

export default function AdminOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [savingId, setSavingId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkStatus, setBulkStatus] = useState("ACCEPTED");
  const [bulkApplying, setBulkApplying] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await ordersAPI.getAll();
      setOrders(response.data || []);
    } catch (err) {
      setError(getRequestErrorMessage(err, "Nie udalo sie pobrac zamowien."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const stats = useMemo(() => ({
    all: orders.length,
    new: orders.filter((order) => order.status === "NEW").length,
    active: orders.filter((order) => ["ACCEPTED", "IN_PROGRESS", "WAITING_FOR_CLIENT", "WAITING_FOR_PARTS"].includes(order.status)).length,
    completed: orders.filter((order) => order.status === "COMPLETED").length,
    value: orders.reduce((sum, order) => sum + Number(order.total_net || 0), 0)
  }), [orders]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (status !== "ALL" && order.status !== status) return false;
      if (!needle) return true;
      return [order.order_number, order.subject, order.company_name, order.object_name, order.customer_name]
        .filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [orders, query, status]);

  const changeStatus = async (orderId, nextStatus) => {
    setSavingId(orderId);
    try {
      const response = await ordersAPI.changeStatus(orderId, nextStatus);
      setOrders((current) => current.map((order) => order.id === orderId ? { ...order, ...response.data } : order));
      showSuccess("Status zamowienia zostal zapisany.");
    } catch (err) {
      setError(getRequestErrorMessage(err, "Nie udalo sie zmienic statusu."));
    } finally {
      setSavingId(null);
    }
  };

  useEffect(() => {
    setSelectedIds(new Set());
  }, [query, status]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((order) => selectedIds.has(order.id));
  const someFilteredSelected = filtered.some((order) => selectedIds.has(order.id));

  const toggleSelectAll = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        filtered.forEach((order) => next.delete(order.id));
      } else {
        filtered.forEach((order) => next.add(order.id));
      }
      return next;
    });
  };

  const toggleSelectOne = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyBulkStatus = async () => {
    if (!selectedIds.size) return;
    setBulkApplying(true);
    try {
      const response = await ordersAPI.bulkChangeStatus([...selectedIds], bulkStatus);
      const { updated = [], failed = [] } = response.data || {};
      if (updated.length) showSuccess(`Zmieniono status ${updated.length} zamowien(ia).`);
      if (failed.length) showFeedback({ message: `Nie udalo sie zmienic statusu ${failed.length} zamowien(ia).`, type: "error" });
      setSelectedIds(new Set());
      await loadOrders();
    } catch (err) {
      showFeedback({ message: getRequestErrorMessage(err, "Nie udalo sie wykonac akcji zbiorczej."), type: "error" });
    } finally {
      setBulkApplying(false);
    }
  };

  const clearFilters = () => {
    setQuery("");
    setStatus("ALL");
  };

  return (
    <div className="page admin-orders-page">
      <header className="admin-orders-header">
        <div><h1>Zamówienia</h1><p>Zamówienia produktów składane przez klientów.</p></div>
        <button type="button" onClick={loadOrders} disabled={loading}><RefreshCcw size={17} /> Odśwież</button>
      </header>

      <section className="admin-orders-stats">
        <Stat icon={ShoppingCart} tone="blue" value={stats.all} label="Wszystkie zamówienia" />
        <Stat icon={PackageOpen} tone="orange" value={stats.new} label="Nowe" />
        <Stat icon={Clock3} tone="purple" value={stats.active} label="W realizacji" />
        <Stat icon={CheckCircle2} tone="green" value={stats.completed} label="Zrealizowane" />
        <Stat icon={CircleDollarSign} tone="navy" value={formatMoney(stats.value)} label="Łączna wartość netto" />
      </section>

      <section className="admin-orders-filters">
        <label className="admin-orders-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Numer, firma, obiekt lub temat..." /></label>
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Wszystkie</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      </section>

      {selectedIds.size > 0 && (
        <section className="bulk-actions-bar">
          <span className="bulk-actions-count">Wybrano {selectedIds.size} zamowien(ia)</span>
          <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} disabled={bulkApplying}>
            {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
          <button type="button" className="bulk-actions-apply" onClick={applyBulkStatus} disabled={bulkApplying}>
            {bulkApplying ? "Zapisywanie..." : "Zmień status"}
          </button>
          <button type="button" className="bulk-actions-clear" onClick={() => setSelectedIds(new Set())} disabled={bulkApplying}>Anuluj</button>
        </section>
      )}

      <section className="admin-orders-table-card">
        {loading ? <AppState title="Ladowanie zamowien" description="Pobieramy biezace dane." /> : error ? (
          <AppState variant="error" description={error} actionLabel="Sprobuj ponownie" onAction={loadOrders} />
        ) : !orders.length ? (
          <AppState title="Brak zamowien" description="Zamowienia zlozone przez klientow pojawia sie tutaj." />
        ) : !filtered.length ? (
          <AppState title="Brak wynikow" description="Zadne zamowienie nie spelnia wybranych filtrow." actionLabel="Wyczysc filtry" onAction={clearFilters} />
        ) : (
          <div className="admin-orders-table-wrap">
            <table className="admin-orders-table">
              <thead><tr><th className="admin-orders-checkbox-col"><input type="checkbox" checked={allFilteredSelected} ref={(el) => { if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected; }} onChange={toggleSelectAll} aria-label="Zaznacz wszystkie" /></th><th>Numer</th><th>Firma / klient</th><th>Obiekt</th><th>Pozycje</th><th>Wartość netto</th><th>Status</th><th>Data złożenia</th></tr></thead>
              <tbody>{filtered.map((order) => (
                <OrderRow key={order.id} order={order} saving={savingId === order.id} selected={selectedIds.has(order.id)} onOpen={() => navigate(`/orders/${order.id}`)} onStatus={changeStatus} onToggleSelect={() => toggleSelectOne(order.id)} />
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function OrderRow({ order, saving, selected, onOpen, onStatus, onToggleSelect }) {
  return (
    <tr className="admin-order-row" onClick={onOpen}>
      <td className="admin-orders-checkbox-col" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Zaznacz zamowienie ${order.order_number}`} /></td>
      <td><strong>{order.order_number}</strong><small>{order.subject}</small></td>
      <td><strong>{order.company_name || order.customer_name || "-"}</strong><small>{order.customer_email || "-"}</small></td>
      <td><strong>{order.object_name || "-"}</strong><small>{[order.object_address, order.object_city].filter(Boolean).join(", ")}</small></td>
      <td>{order.items_count}</td>
      <td><strong>{formatMoney(order.total_net)}</strong></td>
      <td onClick={(event) => event.stopPropagation()}><select className={`admin-order-status ${order.status}`} value={order.status} disabled={saving} onChange={(event) => onStatus(order.id, event.target.value)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></td>
      <td>{formatDate(order.created_at)}</td>
    </tr>
  );
}
