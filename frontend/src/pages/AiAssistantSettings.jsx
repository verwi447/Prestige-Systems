import { useCallback, useEffect, useState } from "react";
import { Save, Sparkles } from "lucide-react";
import { aiAssistant } from "../api";
import AppState from "../components/AppState";
import BarrierCheckbox from "../components/BarrierCheckbox";
import { getRequestErrorMessage, showSuccess } from "../lib/feedback";
import "./AiAssistantSettings.css";

export default function AiAssistantSettings() {
  const [settings, setSettings] = useState(null);
  const [autoSendEnabled, setAutoSendEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await aiAssistant.getSettings();
      setSettings(response.data);
      setAutoSendEnabled(Boolean(response.data?.auto_send_enabled));
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, "Nie udalo sie pobrac ustawien asystenta AI."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveSettings = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await aiAssistant.updateSettings({ autoSendEnabled });
      setSettings(response.data);
      setAutoSendEnabled(Boolean(response.data?.auto_send_enabled));
      showSuccess("Ustawienia asystenta AI zostaly zapisane.");
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, "Nie udalo sie zapisac ustawien asystenta AI."));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="page ai-settings-page"><AppState variant="loading" title="Ladowanie ustawien" description="Pobieramy konfiguracje asystenta AI." /></div>;
  }

  if (!settings) {
    return <div className="page ai-settings-page"><AppState variant="error" title="Nie mozna pobrac ustawien" description={error || "Brak danych."} actionLabel="Sprobuj ponownie" onAction={loadSettings} /></div>;
  }

  const hasChanges = autoSendEnabled !== Boolean(settings.auto_send_enabled);

  return (
    <div className="page ai-settings-page">
      <header className="ai-settings-header">
        <div>
          <div className="ai-settings-breadcrumb">Ustawienia <span>&rsaquo;</span> System <span>&rsaquo;</span> Asystent AI</div>
          <h1>Asystent AI</h1>
          <p>Steruj tym, jak asystent AI reaguje na nowe zgloszenia serwisowe.</p>
        </div>
      </header>

      {error && <div className="ai-settings-message error" role="alert">{error}</div>}

      <section className="ai-settings-panel">
        <header className="ai-settings-panel-header">
          <span><Sparkles aria-hidden="true" /></span>
          <div>
            <h2>Automatyczna wysylka sugestii</h2>
            <p>Dotyczy zgloszen typu awaria systemu i awaria sprzetu.</p>
          </div>
        </header>

        <div className="ai-settings-panel-body">
          <BarrierCheckbox
            checked={autoSendEnabled}
            onChange={setAutoSendEnabled}
            label="Bot wysyla sugestie AI automatycznie"
            description="Wlaczone: sugestia trafia od razu jako publiczna wiadomosc widoczna dla klienta. Wylaczone (domyslnie): sugestia czeka jako notatka wewnetrzna, admin przegladajac zgloszenie moze ja poprawic i wyslac recznie."
          />
        </div>

        <footer className="ai-settings-panel-footer">
          <span>Zmiana dotyczy kolejnych zgloszen, nie wplywa na juz wyslane sugestie.</span>
          <button type="button" className="ai-settings-save" onClick={saveSettings} disabled={saving || !hasChanges}>
            <Save aria-hidden="true" />
            {saving ? "Zapisywanie..." : "Zapisz"}
          </button>
        </footer>
      </section>
    </div>
  );
}
