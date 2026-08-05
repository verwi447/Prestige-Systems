import { useCallback, useEffect, useState } from "react";
import {
  ArchiveRestore,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Database,
  HardDrive,
  Mail,
  RefreshCw,
  Server
} from "lucide-react";
import { system } from "../api";
import AppState from "../components/AppState";
import "./SystemStatus.css";

const formatDate = (value) => (
  value
    ? new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "Brak danych"
);

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return "Brak danych";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} ${units[index]}`;
};

const formatUptime = (seconds) => {
  const totalMinutes = Math.max(0, Math.floor(Number(seconds || 0) / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
};

function State({ good, label }) {
  return (
    <span className={`system-state ${good ? "good" : "attention"}`}>
      {good ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
      {label}
    </span>
  );
}

function Detail({ label, children }) {
  return (
    <div className="system-detail">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function SystemStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await system.getStatus();
      setStatus(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.error || "Nie udało się pobrać stanu systemu.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  if (loading) return <div className="page system-status-page"><AppState variant="loading" title="Ladowanie stanu systemu" description="Sprawdzamy aplikacje, baze danych, backup i poczte." /></div>;
  if (error && !status) return <div className="page system-status-page"><AppState variant="error" title="Nie mozna pobrac stanu systemu" description={error} actionLabel="Sprobuj ponownie" onAction={loadStatus} /></div>;

  const latestBackup = status?.backup?.latest;
  const backupHealthy = latestBackup?.status === "COMPLETED" && latestBackup?.integrityStatus === "VERIFIED";
  const backupTested = latestBackup?.testRestoreStatus === "VERIFIED";
  const mailHealthy = status?.email?.configured && status?.email?.enabled && status?.email?.lastTestStatus !== "FAILED";
  const migrationsHealthy = status?.migration?.isCurrent === true;

  return (
    <div className="page system-status-page">
      <header className="system-status-header">
        <div>
          <div className="system-status-breadcrumb">Ustawienia <span>›</span> Stan systemu</div>
          <h1>Stan systemu</h1>
          <p>Aktualny stan usług i zabezpieczeń aplikacji.</p>
        </div>
        <button type="button" className="system-refresh" onClick={() => loadStatus(true)} disabled={refreshing}>
          <RefreshCw className={refreshing ? "spinning" : ""} aria-hidden="true" />
          {refreshing ? "Odświeżanie..." : "Odśwież"}
        </button>
      </header>

      {error && <div className="system-status-message" role="alert">{error}</div>}

      <section className="system-summary-grid" aria-label="Najważniejsze statusy">
        <article className="system-summary-card">
          <span className="system-summary-icon blue"><Server aria-hidden="true" /></span>
          <div><p>Aplikacja</p><strong>v{status?.application?.version || "-"}</strong><small>Działa od {formatUptime(status?.application?.uptimeSeconds)}</small></div>
          <State good={Boolean(status?.application)} label="Online" />
        </article>
        <article className="system-summary-card">
          <span className="system-summary-icon green"><Database aria-hidden="true" /></span>
          <div><p>Baza danych</p><strong>{status?.database?.responseMs ?? "-"} ms</strong><small>Odpowiedź zapytania kontrolnego</small></div>
          <State good={status?.database?.status === "ONLINE"} label={status?.database?.status === "ONLINE" ? "Online" : "Błąd"} />
        </article>
        <article className="system-summary-card">
          <span className="system-summary-icon amber"><ArchiveRestore aria-hidden="true" /></span>
          <div><p>Ostatni backup</p><strong>{backupHealthy ? "Zweryfikowany" : "Wymaga uwagi"}</strong><small>{latestBackup ? formatDate(latestBackup.completedAt) : "Brak backupu"}</small></div>
          <State good={backupHealthy} label={backupHealthy ? "Gotowy" : "Sprawdź"} />
        </article>
        <article className="system-summary-card">
          <span className="system-summary-icon violet"><Mail aria-hidden="true" /></span>
          <div><p>Poczta systemowa</p><strong>{mailHealthy ? "Aktywna" : "Sprawdź konfigurację"}</strong><small>{status?.email?.lastTestAt ? `Test: ${formatDate(status.email.lastTestAt)}` : "Brak testu połączenia"}</small></div>
          <State good={mailHealthy} label={mailHealthy ? "Gotowa" : "Uwaga"} />
        </article>
      </section>

      <section className="system-content-grid">
        <article className="system-panel">
          <header><span className="system-panel-icon"><Server aria-hidden="true" /></span><div><h2>Aplikacja i baza danych</h2><p>Parametry uruchomionej instancji.</p></div></header>
          <dl className="system-details-grid">
            <Detail label="Nazwa aplikacji">{status?.application?.name || "Prestige Systems HUB"}</Detail>
            <Detail label="Wersja">v{status?.application?.version || "-"}</Detail>
            <Detail label="Wersja Node.js">{status?.application?.nodeVersion || "-"}</Detail>
            <Detail label="Czas działania">{formatUptime(status?.application?.uptimeSeconds)}</Detail>
            <Detail label="Baza danych"><State good={status?.database?.status === "ONLINE"} label={status?.database?.status === "ONLINE" ? "Online" : "Niedostępna"} /></Detail>
            <Detail label="Czas odpowiedzi">{status?.database?.responseMs ?? "-"} ms</Detail>
            <Detail label="Migracje"><State good={migrationsHealthy} label={migrationsHealthy ? "Aktualne" : "Wymagają uwagi"} /></Detail>
            <Detail label="Schemat bazy">{status?.migration?.appliedVersion || status?.application?.schemaVersion || "Brak danych"}</Detail>
          </dl>
        </article>

        <article className="system-panel">
          <header><span className="system-panel-icon backup"><HardDrive aria-hidden="true" /></span><div><h2>Backup i odtwarzanie</h2><p>Stan najnowszej kopii bezpieczeństwa.</p></div></header>
          <dl className="system-details-grid">
            <Detail label="Automatyczny backup"><State good={status?.backup?.enabled} label={status?.backup?.enabled ? "Włączony" : "Wyłączony"} /></Detail>
            <Detail label="Harmonogram">{status?.backup?.frequency || "-"}{status?.backup?.timeOfDay ? `, ${status.backup.timeOfDay}` : ""}</Detail>
            <Detail label="Ostatni backup">{latestBackup ? formatDate(latestBackup.completedAt) : "Brak backupu"}</Detail>
            <Detail label="Rozmiar pliku">{formatBytes(latestBackup?.sizeBytes)}</Detail>
            <Detail label="Integralność"><State good={backupHealthy} label={backupHealthy ? "Zweryfikowana" : "Niezweryfikowana"} /></Detail>
            <Detail label="Test odtworzenia"><State good={backupTested} label={backupTested ? "Zweryfikowany" : "Nie wykonano"} /></Detail>
            <Detail label="Wolne miejsce">{formatBytes(status?.backup?.freeSpaceBytes)}</Detail>
            <Detail label="Retencja">{status?.backup?.retentionCount ? `${status.backup.retentionCount} kopii` : "-"}</Detail>
          </dl>
        </article>

        <article className="system-panel system-panel-wide">
          <header><span className="system-panel-icon mail"><Mail aria-hidden="true" /></span><div><h2>Wysyłka wiadomości</h2><p>Stan konfiguracji poczty systemowej.</p></div></header>
          <dl className="system-details-grid compact">
            <Detail label="Konfiguracja SMTP"><State good={status?.email?.configured} label={status?.email?.configured ? "Skonfigurowana" : "Brak konfiguracji"} /></Detail>
            <Detail label="Wysyłka"><State good={status?.email?.enabled} label={status?.email?.enabled ? "Aktywna" : "Wyłączona"} /></Detail>
            <Detail label="Ostatni test"><State good={status?.email?.lastTestStatus === "SUCCESS"} label={status?.email?.lastTestStatus === "SUCCESS" ? "Poprawny" : "Nie wykonano"} /></Detail>
            <Detail label="Data testu">{formatDate(status?.email?.lastTestAt)}</Detail>
          </dl>
        </article>
      </section>

      <footer className="system-status-footer"><Clock3 aria-hidden="true" /> Dane pobrane: {formatDate(status?.generatedAt)}</footer>
    </div>
  );
}
