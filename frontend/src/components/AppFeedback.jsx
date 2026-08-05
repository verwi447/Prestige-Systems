import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Info, WifiOff, X } from "lucide-react";
import { api } from "../lib/http";
import { CONNECTION_EVENT, FEEDBACK_EVENT } from "../lib/feedback";
import "./AppFeedback.css";

const icons = {
  success: CheckCircle2,
  warning: CircleAlert,
  error: CircleAlert,
  info: Info
};

function normalizeFeedback(detail) {
  if (typeof detail === "string") return { message: detail, type: "success" };
  return {
    message: detail?.message || "Operacja zostala zakonczona.",
    type: detail?.type || "success",
    duration: detail?.duration
  };
}

export default function AppFeedback() {
  const [items, setItems] = useState([]);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [serverAvailable, setServerAvailable] = useState(true);
  const timers = useRef(new Map());

  const checkServer = useCallback(async () => {
    if (!navigator.onLine) return;

    try {
      await api.get("/healthz", { skipGlobalFeedback: true, timeout: 5_000 });
      setServerAvailable(true);
    } catch {
      setServerAvailable(false);
    }
  }, []);

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((detail) => {
    const feedback = normalizeFeedback(detail);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const duration = Number.isFinite(feedback.duration) ? feedback.duration : 5000;

    setItems((current) => {
      const duplicate = current.find((item) => item.message === feedback.message && item.type === feedback.type);
      if (duplicate) return current;
      return [...current.slice(-2), { ...feedback, id }];
    });

    timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
  }, [dismiss]);

  useEffect(() => {
    const activeTimers = timers.current;
    const handleFeedback = (event) => push(event.detail);
    const handleOffline = () => {
      setOnline(false);
      setServerAvailable(false);
    };
    const handleOnline = () => {
      setOnline(true);
      push({ message: "Polaczenie z serwerem zostalo przywrocone.", type: "success" });
      checkServer();
    };
    const handleConnection = (event) => setServerAvailable(Boolean(event.detail?.available));
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") checkServer();
    };
    const healthInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") checkServer();
    }, 30_000);

    window.addEventListener(FEEDBACK_EVENT, handleFeedback);
    window.addEventListener("app-toast", handleFeedback);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener(CONNECTION_EVENT, handleConnection);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    checkServer();

    return () => {
      window.removeEventListener(FEEDBACK_EVENT, handleFeedback);
      window.removeEventListener("app-toast", handleFeedback);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener(CONNECTION_EVENT, handleConnection);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(healthInterval);
      activeTimers.forEach((timer) => window.clearTimeout(timer));
      activeTimers.clear();
    };
  }, [checkServer, push]);

  return (
    <div className="app-feedback-root" aria-live="polite" aria-atomic="true">
      {(!online || !serverAvailable) && (
        <div className="connection-status offline" role="alert">
          <WifiOff size={18} />
          <span>{!online ? "Utracono polaczenie. Dane moga byc nieaktualne, a zmiany nie zostana zapisane." : "Serwer jest chwilowo niedostepny. Sprobuj ponownie za chwile."}</span>
          {online && <button type="button" onClick={checkServer}>Sprawdz ponownie</button>}
        </div>
      )}
      <div className="feedback-stack">
        {items.map((item) => {
          const Icon = icons[item.type] || Info;
          return (
            <div className={`feedback-toast ${item.type}`} key={item.id} role={item.type === "error" ? "alert" : "status"}>
              <Icon size={19} />
              <p>{item.message}</p>
              <button type="button" aria-label="Zamknij komunikat" onClick={() => dismiss(item.id)}><X size={16} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
