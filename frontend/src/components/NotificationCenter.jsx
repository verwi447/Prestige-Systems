import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import {
  Bell,
  BellRing,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  FileText,
  HardDrive,
  MessageSquare,
  MoreVertical,
  ShieldAlert,
  Users
} from "lucide-react";
import { notifications as notificationsAPI } from "../api";
import { apiOrigin } from "../lib/runtimeConfig";

const API_ORIGIN = apiOrigin;
const PAGE_SIZE = 20;

const adminFilters = [
  { id: "ALL", label: "Wszystkie" },
  { id: "UNREAD", label: "Nieprzeczytane" },
  { id: "OFFERS", label: "Oferty" },
  { id: "TICKETS", label: "Zgłoszenia" },
  { id: "BACKUP", label: "Backup" },
  { id: "SYSTEM", label: "System" }
];

const clientFilters = adminFilters.filter((item) => ["ALL", "UNREAD", "OFFERS", "TICKETS"].includes(item.id));

const categoryLabels = {
  OFFERS: "Oferty",
  TICKETS: "Zgłoszenia",
  BACKUP: "Backup",
  SYSTEM: "System",
  COMPANIES: "Firmy"
};

const categoryIcons = {
  OFFERS: FileText,
  TICKETS: MessageSquare,
  BACKUP: HardDrive,
  SYSTEM: ShieldAlert,
  COMPANIES: Users
};

function playNotificationSound(priority = "INFO") {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const context = new AudioContext();
    if (context.state === "suspended") context.resume().catch(() => {});

    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    gain.connect(context.destination);

    const first = context.createOscillator();
    first.type = "sine";
    first.frequency.setValueAtTime(priority === "CRITICAL" ? 720 : 620, now);
    first.connect(gain);
    first.start(now);
    first.stop(now + 0.16);

    const second = context.createOscillator();
    second.type = "sine";
    second.frequency.setValueAtTime(priority === "CRITICAL" ? 520 : 820, now + 0.18);
    second.connect(gain);
    second.start(now + 0.18);
    second.stop(now + 0.4);

    window.setTimeout(() => context.close().catch(() => {}), 520);
  } catch {
    // Audio can be blocked by browser autoplay policies; notifications still work.
  }
}

function timeAgo(value) {
  const date = value ? new Date(value) : new Date();
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "teraz";
  if (minutes < 60) return `${minutes} min temu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} godz. temu`;
  const days = Math.floor(hours / 24);
  return `${days} dni temu`;
}

function normalizeNotification(row) {
  return {
    id: row.id,
    userId: row.user_id ?? row.userId,
    category: row.category,
    type: row.type,
    priority: row.priority || "INFO",
    title: row.title,
    message: row.message,
    entityType: row.entity_type ?? row.entityType,
    entityId: row.entity_id ?? row.entityId,
    link: row.link,
    isRead: row.is_read ?? row.isRead,
    readAt: row.read_at ?? row.readAt,
    createdAt: row.created_at ?? row.createdAt
  };
}

function notificationMessage(notification) {
  if (notification.category === "BACKUP") {
    return notification.message || "Nowa kopia zapasowa systemu jest gotowa.";
  }

  return notification.message || "Brak dodatkowych informacji.";
}

export default function NotificationCenter() {
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [items, setItems] = useState([]);
  const [count, setCount] = useState({ totalUnread: 0, criticalUnread: 0 });
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [menuId, setMenuId] = useState("");
  const [preferences, setPreferences] = useState([]);
  const preferencesRef = useRef([]);
  const isAdmin = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null")?.role === "ADMIN";
    } catch {
      return false;
    }
  }, []);
  const visibleFilters = isAdmin ? adminFilters : clientFilters;

  const badgeClass = count.criticalUnread > 0 ? "critical" : "normal";

  const query = useMemo(() => ({
    limit: PAGE_SIZE,
    offset: 0,
    unreadOnly: filter === "UNREAD",
    category: filter !== "ALL" && filter !== "UNREAD" ? filter : undefined
  }), [filter]);

  const loadCount = useCallback(async () => {
    const response = await notificationsAPI.getUnreadCount();
    setCount(response.data || { totalUnread: 0, criticalUnread: 0 });
  }, []);

  const loadPreferences = useCallback(async () => {
    const response = await notificationsAPI.getPreferences();
    setPreferences(response.data || []);
  }, []);

  const loadNotifications = useCallback(async ({ append = false, offset = 0 } = {}) => {
    setLoading(true);
    try {
      const params = append ? { ...query, offset } : query;
      const response = await notificationsAPI.getAll(params);
      const next = (response.data || []).map(normalizeNotification);
      setItems((current) => append ? [...current, ...next] : next);
      setHasMore(next.length === PAGE_SIZE);
      await loadCount();
    } finally {
      setLoading(false);
    }
  }, [loadCount, query]);

  const isSoundEnabled = useCallback((category) => {
    const preference = preferencesRef.current.find((item) => item.category === category);
    return preference ? preference.sound_enabled !== false : true;
  }, []);

  useEffect(() => {
    loadCount().catch(() => {});
    loadPreferences().catch(() => {});
  }, [loadCount, loadPreferences]);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    const refreshPreferences = () => loadPreferences().catch(() => {});
    window.addEventListener("notification-preferences-updated", refreshPreferences);
    return () => window.removeEventListener("notification-preferences-updated", refreshPreferences);
  }, [loadPreferences]);

  useEffect(() => {
    if (!open) return;
    loadNotifications().catch(() => setLoading(false));
  }, [loadNotifications, open]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return undefined;
    const socket = io(API_ORIGIN, { auth: { token } });

    socket.on("notification:new", (notification) => {
      const normalized = normalizeNotification(notification);
      if (isSoundEnabled(normalized.category)) {
        playNotificationSound(normalized.priority);
      }
      setCount((current) => ({
        totalUnread: current.totalUnread + 1,
        criticalUnread: normalized.priority === "CRITICAL" ? current.criticalUnread + 1 : current.criticalUnread
      }));
      setItems((current) => {
        if (!open) return current;
        if (filter !== "ALL" && filter !== "UNREAD" && normalized.category !== filter) return current;
        return [normalized, ...current].slice(0, PAGE_SIZE);
      });
    });
    socket.on("notification:updated", (notification) => {
      const normalized = normalizeNotification(notification);
      setItems((current) => current.map((item) => item.id === normalized.id ? normalized : item));
      loadCount().catch(() => {});
    });
    socket.on("notification:read", (notification) => {
      const normalized = normalizeNotification(notification);
      setItems((current) => current.map((item) => item.id === normalized.id ? normalized : item));
      loadCount().catch(() => {});
    });
    socket.on("notification:readAll", () => {
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
      setCount({ totalUnread: 0, criticalUnread: 0 });
    });
    socket.on("notification:deleted", ({ id }) => {
      setItems((current) => current.filter((item) => item.id !== id));
      loadCount().catch(() => {});
    });

    return () => socket.disconnect();
  }, [filter, isSoundEnabled, loadCount, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        setOpen(false);
        setMenuId("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const openNotification = async (notification) => {
    if (!notification.isRead) await markRead(notification, false);
    if (!notification.link) return;

    setOpen(false);
    setMenuId("");
    navigate(notification.link);
  };

  const handleNotificationKeyDown = (event, notification) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openNotification(notification);
  };

  const markRead = async (notification, reloadCount = true) => {
    const response = await notificationsAPI.markRead(notification.id);
    const updated = normalizeNotification(response.data);
    setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    if (reloadCount) await loadCount();
  };

  const markAllRead = async () => {
    await notificationsAPI.markAllRead();
    setItems((current) => current.map((item) => ({ ...item, isRead: true })));
    setCount({ totalUnread: 0, criticalUnread: 0 });
  };

  const deleteNotification = async (notification) => {
    await notificationsAPI.delete(notification.id);
    setItems((current) => current.filter((item) => item.id !== notification.id));
    await loadCount();
  };

  return (
    <div className="notification-root" ref={panelRef}>
      <button className="header-notification" type="button" aria-label="Powiadomienia" onClick={() => setOpen((value) => !value)}>
        {count.criticalUnread > 0 ? <BellRing size={19} /> : <Bell size={19} />}
        {count.totalUnread > 0 && <strong className={badgeClass}>{count.totalUnread > 99 ? "99+" : count.totalUnread}</strong>}
      </button>

      {open && (
        <section className="notification-panel">
          <header className="notification-panel-header">
            <div>
              <h2>Powiadomienia</h2>
              <span className={count.totalUnread ? "has-unread" : ""}>{count.totalUnread ? `${count.totalUnread} nieprzeczytanych` : "Wszystko przeczytane"}</span>
            </div>
            <div className="notification-header-actions">
              {count.totalUnread > 0 && <button type="button" title="Oznacz wszystkie jako przeczytane" onClick={markAllRead}><CheckCheck size={17} /></button>}
            </div>
          </header>

          <div className="notification-filters">
            {visibleFilters.map((item) => (
              <button key={item.id} type="button" className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)}>
                {item.label}
              </button>
            ))}
          </div>

          <div className="notification-list">
            {loading && !items.length && <div className="notification-empty">Ładowanie powiadomień...</div>}
            {!loading && !items.length && <div className="notification-empty">Brak powiadomień</div>}
            {items.map((notification) => {
              const Icon = categoryIcons[notification.category] || CircleAlert;
              return (
                <article
                  key={notification.id}
                  className={`notification-card priority-${notification.priority.toLowerCase()} ${notification.isRead ? "read" : "unread"}`}
                  onClick={() => openNotification(notification)}
                  onKeyDown={(event) => handleNotificationKeyDown(event, notification)}
                  role="button"
                  tabIndex={0}
                >
                  <span className="notification-type-icon"><Icon size={18} /></span>
                  <div className="notification-content">
                    <div className="notification-title-row">
                      <strong>{notification.title}</strong>
                      {!notification.isRead && <i>Nowe</i>}
                    </div>
                    <p>{notificationMessage(notification)}</p>
                    <div className="notification-meta">
                      <span>{categoryLabels[notification.category] || notification.category}</span>
                      <span><Clock size={12} />{timeAgo(notification.createdAt)}</span>
                    </div>
                  </div>
                  <div className="notification-card-actions" onClick={(event) => event.stopPropagation()}>
                    {!notification.isRead && (
                      <button type="button" title="Oznacz jako przeczytane" onClick={() => markRead(notification)}><Check size={15} /></button>
                    )}
                    <button type="button" title="Menu" onClick={() => setMenuId((current) => current === notification.id ? "" : notification.id)}><MoreVertical size={15} /></button>
                    {menuId === notification.id && (
                      <div className="notification-menu">
                        <button type="button" onClick={() => openNotification(notification)}>Otwórz</button>
                        <button type="button" onClick={() => markRead(notification)}>Oznacz jako przeczytane</button>
                        <button type="button" onClick={() => deleteNotification(notification)}>Usuń</button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {hasMore && (
            <button className="notification-load-more" type="button" disabled={loading} onClick={() => loadNotifications({ append: true, offset: items.length })}>
              Załaduj starsze
            </button>
          )}
        </section>
      )}

    </div>
  );
}
