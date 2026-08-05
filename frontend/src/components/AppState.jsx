import { Inbox, LoaderCircle, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";

const stateMeta = {
  loading: { icon: LoaderCircle, title: "Ladowanie danych" },
  empty: { icon: Inbox, title: "Brak danych" },
  error: { icon: RefreshCw, title: "Nie udalo sie pobrac danych" },
  denied: { icon: ShieldAlert, title: "Brak uprawnien" },
  connection: { icon: WifiOff, title: "Brak polaczenia" }
};

export default function AppState({ variant = "empty", title, description, actionLabel, onAction, action, compact = false }) {
  const meta = stateMeta[variant] || stateMeta.empty;
  const Icon = meta.icon;

  return (
    <section
      className={`app-state ${variant}${compact ? " compact" : ""}`}
      role={variant === "error" || variant === "denied" ? "alert" : "status"}
      aria-busy={variant === "loading" || undefined}
    >
      <span className="app-state-icon"><Icon size={23} /></span>
      <h2>{title || meta.title}</h2>
      {description && <p>{description}</p>}
      {action || (actionLabel && onAction && <button type="button" onClick={onAction}>{actionLabel}</button>)}
    </section>
  );
}
