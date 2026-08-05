import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Globe2,
  Info,
  Monitor,
  Network,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  TriangleAlert,
  Wifi
} from "lucide-react";
import { system } from "../api";
import AppState from "../components/AppState";
import { getRequestErrorMessage, showSuccess } from "../lib/feedback";
import "./NetworkSettings.css";

const localUrlsForPort = (port) => new Set([
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`
]);

const createForm = (data) => {
  const configured = data?.configured || {};
  const port = String(configured.port || 5000);
  const excludedOrigins = localUrlsForPort(port);
  if (configured.publicBaseUrl) excludedOrigins.add(configured.publicBaseUrl);

  return {
    accessMode: configured.accessMode || "LOCAL",
    port,
    publicBaseUrl: configured.publicBaseUrl || "",
    allowedOrigins: (configured.allowedOrigins || [])
      .filter((origin) => !excludedOrigins.has(origin))
      .join("\n")
  };
};

const networkLabel = (mode) => (mode === "LAN" ? "Siec lokalna" : "Tylko ten komputer");

function CopyButton({ value, label = "Kopiuj adres" }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be unavailable outside a secure context. The address remains selectable.
    }
  };

  return (
    <button type="button" className="network-copy-button" onClick={copy} aria-label={label} title={label}>
      {copied ? <CheckCircle2 aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}

function SummaryCard({ icon: Icon, tone, label, value, detail }) {
  return (
    <article className="network-summary-card">
      <span className={`network-summary-icon ${tone}`}><Icon aria-hidden="true" /></span>
      <div>
        <p>{label}</p>
        <strong title={value}>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

export default function NetworkSettings() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadSettings = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const response = await system.getNetworkSettings();
      setSettings(response.data);
      setForm(createForm(response.data));
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, "Nie udalo sie pobrac konfiguracji sieci."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage("");
  };

  const selectDetectedAddress = (address) => {
    updateForm("publicBaseUrl", `http://${address}:${form.port || 5000}`);
  };

  const saveSettings = async () => {
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await system.updateNetworkSettings({
        ...form,
        port: Number(form.port)
      });
      setSettings(response.data);
      setForm(createForm(response.data));
      setMessage(response.data.message || "Konfiguracja sieci zostala zapisana.");
      showSuccess("Konfiguracja sieci zostala zapisana.");
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, "Nie udalo sie zapisac konfiguracji sieci."));
    } finally {
      setSaving(false);
    }
  };

  const configuredUrls = useMemo(() => {
    if (!settings) return [];
    return [...new Set([settings.urls?.primaryUrl, ...(settings.urls?.localUrls || []), ...(settings.urls?.lanUrls || [])].filter(Boolean))];
  }, [settings]);

  if (loading) {
    return <div className="page network-settings-page"><AppState variant="loading" title="Ladowanie konfiguracji sieci" description="Sprawdzamy adresy, port i dostep do aplikacji." /></div>;
  }

  if (!settings || !form) {
    return <div className="page network-settings-page"><AppState variant="error" title="Nie mozna pobrac konfiguracji sieci" description={error || "Brak danych konfiguracyjnych."} actionLabel="Sprobuj ponownie" onAction={loadSettings} /></div>;
  }

  const activeRuntime = settings.runtime || {};
  const isLanActive = activeRuntime.accessMode === "LAN";
  const activeAddress = activeRuntime.publicBaseUrl || (isLanActive ? settings.urls?.lanUrls?.[0] : settings.urls?.localUrls?.[0]) || "Brak adresu";

  return (
    <div className="page network-settings-page">
      <header className="network-settings-header">
        <div>
          <div className="network-breadcrumb">Ustawienia <span>&rsaquo;</span> System <span>&rsaquo;</span> Siec</div>
          <h1>Siec i dostep</h1>
          <p>Ustaw adres, port i dostep do panelu z innych urzadzen w tej samej sieci.</p>
        </div>
        <button type="button" className="network-refresh" onClick={() => loadSettings(true)} disabled={refreshing}>
          <RefreshCw className={refreshing ? "spinning" : ""} aria-hidden="true" />
          {refreshing ? "Odswiezanie..." : "Odswiez"}
        </button>
      </header>

      {error && <div className="network-message error" role="alert">{error}</div>}
      {message && <div className="network-message success" role="status">{message}</div>}

      {settings.restartRequired && (
        <section className="network-restart-notice" role="status">
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>Zmiany oczekuja na restart uslugi</strong>
            <p>Zapisana konfiguracja rozni sie od aktualnie uruchomionej aplikacji. Uruchom ponownie usluge Prestige Systems HUB, aby ja zastosowac.</p>
          </div>
        </section>
      )}

      <section className="network-summary-grid" aria-label="Biezacy stan sieci">
        <SummaryCard icon={isLanActive ? Wifi : Monitor} tone={isLanActive ? "green" : "blue"} label="Tryb dzialania" value={networkLabel(activeRuntime.accessMode)} detail={isLanActive ? "Aplikacja nasluchuje w sieci lokalnej" : "Aplikacja jest dostepna lokalnie"} />
        <SummaryCard icon={Globe2} tone="violet" label="Aktywny adres" value={activeAddress} detail="Adres otwierany przez przegladarke" />
        <SummaryCard icon={Server} tone="amber" label="Port aplikacji" value={String(activeRuntime.port || "-")} detail="Port aktualnie uruchomionej uslugi" />
        <SummaryCard icon={ShieldCheck} tone="green" label="Dozwolone zrodla API" value={String(activeRuntime.allowedOrigins?.length || 0)} detail="Adresy dopuszczone przez CORS" />
      </section>

      <section className="network-content-grid">
        <form className="network-panel network-config-panel" onSubmit={(event) => { event.preventDefault(); saveSettings(); }}>
          <header className="network-panel-header">
            <span><Network aria-hidden="true" /></span>
            <div>
              <h2>Konfiguracja dostepu</h2>
              <p>Zmiana adresu lub portu wymaga ponownego uruchomienia uslugi.</p>
            </div>
          </header>

          <div className="network-form-body">
            <fieldset className="network-fieldset">
              <legend>Zakres dostepu</legend>
              <div className="network-mode-control" role="radiogroup" aria-label="Zakres dostepu">
                <button type="button" className={form.accessMode === "LOCAL" ? "active" : ""} role="radio" aria-checked={form.accessMode === "LOCAL"} onClick={() => updateForm("accessMode", "LOCAL")}>
                  <Monitor aria-hidden="true" />
                  <span>Tylko ten komputer<small>Adres localhost</small></span>
                </button>
                <button type="button" className={form.accessMode === "LAN" ? "active" : ""} role="radio" aria-checked={form.accessMode === "LAN"} onClick={() => updateForm("accessMode", "LAN")}>
                  <Wifi aria-hidden="true" />
                  <span>Siec lokalna<small>Inne urzadzenia w tej samej sieci</small></span>
                </button>
              </div>
            </fieldset>

            <label className="network-form-field port">
              <span>Port aplikacji</span>
              <input type="number" inputMode="numeric" min="1024" max="65535" value={form.port} onChange={(event) => updateForm("port", event.target.value)} required />
            </label>

            <label className="network-form-field public-url">
              <span>Glowny adres aplikacji</span>
              <input type="url" placeholder={form.accessMode === "LAN" ? "http://192.168.0.100:5000" : "Opcjonalny adres HTTP/HTTPS"} value={form.publicBaseUrl} onChange={(event) => updateForm("publicBaseUrl", event.target.value)} required={form.accessMode === "LAN"} />
              <small>Adres bez dodatkowej sciezki, np. http://192.168.0.199:5000.</small>
            </label>

            <label className="network-form-field origins">
              <span>Dodatkowe dozwolone zrodla API</span>
              <textarea rows="4" placeholder={"Jeden adres w wierszu, np.\nhttps://panel.example.pl"} value={form.allowedOrigins} onChange={(event) => updateForm("allowedOrigins", event.target.value)} />
              <small>Adresy localhost i glowny adres aplikacji sa dodawane automatycznie.</small>
            </label>
          </div>

          <footer className="network-panel-footer">
            <span><Info aria-hidden="true" /> Konfiguracja jest dostepna tylko dla administratorow.</span>
            <button type="submit" className="network-save" disabled={saving}>
              <Save aria-hidden="true" />
              {saving ? "Zapisywanie..." : "Zapisz konfiguracje"}
            </button>
          </footer>
        </form>

        <aside className="network-side-column">
          <section className="network-panel network-address-panel">
            <header className="network-panel-header">
              <span><Globe2 aria-hidden="true" /></span>
              <div><h2>Adresy tego serwera</h2><p>Wybierz adres, ktory ma byc glownym adresem aplikacji.</p></div>
            </header>
            <div className="network-interface-list">
              {settings.interfaces?.length ? settings.interfaces.map((item) => {
                const addressUrl = `http://${item.address}:${form.port || 5000}`;
                return (
                  <div className="network-interface" key={`${item.name}-${item.address}`}>
                    <span className="network-interface-icon"><Wifi aria-hidden="true" /></span>
                    <div><strong>{item.name}</strong><code>{addressUrl}</code><small>Maska: {item.netmask || "brak danych"}</small></div>
                    <div className="network-interface-actions">
                      <button type="button" onClick={() => selectDetectedAddress(item.address)}>Uzyj</button>
                      <CopyButton value={addressUrl} />
                    </div>
                  </div>
                );
              }) : <AppState compact variant="empty" title="Nie wykryto adresow LAN" description="Sprawdz polaczenie sieciowe serwera." />}
            </div>
          </section>

          <section className="network-panel network-links-panel">
            <header className="network-panel-header">
              <span><Server aria-hidden="true" /></span>
              <div><h2>Adresy dostepu</h2><p>Aktualne i wykryte adresy aplikacji.</p></div>
            </header>
            <div className="network-link-list">
              {configuredUrls.map((url) => (
                <div className="network-link" key={url}>
                  <a href={url} target="_blank" rel="noreferrer">{url}</a>
                  <CopyButton value={url} />
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
