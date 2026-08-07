import { useEffect, useState } from "react";
import {
  Bell,
  Building2,
  FileText,
  HardDrive,
  MessageSquare,
  Save,
  ShieldAlert
} from "lucide-react";
import { notifications } from "../api";
import AppState from "../components/AppState";
import BarrierIcon from "../components/BarrierIcon";
import { getRequestErrorMessage, showFeedback } from "../lib/feedback";
import "./AdminNotificationSettings.css";

const categories = [
  {
    id: "OFFERS",
    label: "Oferty",
    description: "Nowe oferty, akceptacje i zmiany ich statusu.",
    icon: FileText
  },
  {
    id: "TICKETS",
    label: "Zgloszenia",
    description: "Nowe zgloszenia, komentarze i zmiany statusu.",
    icon: MessageSquare
  },
  {
    id: "BACKUP",
    label: "Backup",
    description: "Wyniki backupow i testow przywracania danych.",
    icon: HardDrive
  },
  {
    id: "SYSTEM",
    label: "System",
    description: "Komunikaty bezpieczenstwa i istotne zdarzenia systemowe.",
    icon: ShieldAlert
  },
  {
    id: "COMPANIES",
    label: "Firmy klienckie",
    description: "Zmiany dotyczace firm oraz ich danych kontaktowych.",
    icon: Building2
  }
];

const defaultPreference = (category) => ({
  category,
  in_app_enabled: true,
  email_enabled: false,
  push_enabled: false,
  sound_enabled: true
});

function Toggle({ checked, label, onChange }) {
  return (
    <button
      type="button"
      className={`admin-notification-switch ${checked ? "active" : ""}`}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    >
      <BarrierIcon checked={checked} />
      <span>{label}</span>
    </button>
  );
}

export default function AdminNotificationSettings({ embedded = false } = {}) {
  const [preferences, setPreferences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    notifications.getPreferences()
      .then((response) => {
        if (active) setPreferences(response.data || []);
      })
      .catch((requestError) => {
        if (active) showFeedback({ message: getRequestErrorMessage(requestError, "Nie udalo sie pobrac ustawien powiadomien."), type: "error" });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const preferenceFor = (category) => (
    preferences.find((preference) => preference.category === category) || defaultPreference(category)
  );

  const updatePreference = (category, field, value) => {
    setPreferences((current) => {
      const existing = current.find((preference) => preference.category === category);
      const next = { ...(existing || defaultPreference(category)), [field]: value };
      return existing
        ? current.map((preference) => preference.category === category ? next : preference)
        : [...current, next];
    });
  };

  const savePreferences = async () => {
    setSaving(true);
    try {
      const response = await notifications.updatePreferences(preferences);
      setPreferences(response.data || []);
      window.dispatchEvent(new Event("notification-preferences-updated"));
      showFeedback({ message: "Ustawienia powiadomien zostaly zapisane.", type: "success" });
    } catch (requestError) {
      showFeedback({ message: getRequestErrorMessage(requestError, "Nie udalo sie zapisac ustawien powiadomien."), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className={embedded ? "admin-notification-settings-page" : "page admin-notification-settings-page"}><AppState variant="loading" title="Ladowanie ustawien powiadomien" description="Pobieramy zapisane preferencje administratora." /></div>;
  }

  return (
    <div className={embedded ? "admin-notification-settings-page" : "page admin-notification-settings-page"}>
      <header className="admin-notification-settings-header">
        <div>
          {!embedded && <div className="admin-breadcrumb">Ustawienia <span>&rsaquo;</span> Powiadomienia</div>}
          {!embedded && <h1>Powiadomienia</h1>}
          <p>Wybierz, o ktorych zdarzeniach administrator ma otrzymywac alerty.</p>
        </div>
        <button type="button" className="admin-notification-save" onClick={savePreferences} disabled={saving}>
          <Save size={17} />
          {saving ? "Zapisywanie..." : "Zapisz zmiany"}
        </button>
      </header>

      <section className="admin-notification-panel">
        <header className="admin-notification-panel-header">
          <span><Bell size={21} /></span>
          <div>
            <h2>Preferencje powiadomien</h2>
            <p>Ustawienia sa stosowane do nowych powiadomien w panelu administratora.</p>
          </div>
        </header>

        <div className="admin-notification-list">
          {categories.map(({ id, label, description, icon: Icon }) => {
            const preference = preferenceFor(id);
            return (
              <article className="admin-notification-row" key={id}>
                <div className="admin-notification-category">
                  <span><Icon size={20} /></span>
                  <div>
                    <h3>{label}</h3>
                    <p>{description}</p>
                  </div>
                </div>
                <div className="admin-notification-controls">
                  <Toggle
                    label="W aplikacji"
                    checked={preference.in_app_enabled !== false}
                    onChange={(value) => updatePreference(id, "in_app_enabled", value)}
                  />
                  <Toggle
                    label="Dzwiek"
                    checked={preference.sound_enabled !== false}
                    onChange={(value) => updatePreference(id, "sound_enabled", value)}
                  />
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
