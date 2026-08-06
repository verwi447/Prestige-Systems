import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  CheckCircle2,
  Clock3,
  Edit3,
  KeyRound,
  Laptop,
  Mail,
  ShieldCheck,
  User,
  X
} from "lucide-react";
import { client as clientAPI } from "../api";
import AppState from "../components/AppState";
import BarrierIcon from "../components/BarrierIcon";
import { getRequestErrorMessage, showFeedback } from "../lib/feedback";
import "./Profile.css";

const tabs = [
  { id: "profile", label: "Profil", icon: User },
  { id: "security", label: "Bezpieczeństwo", icon: ShieldCheck },
  { id: "notifications", label: "Powiadomienia", icon: Bell },
  { id: "sessions", label: "Sesje logowania", icon: Laptop },
  { id: "activity", label: "Aktywność konta", icon: Activity }
];

const roleLabels = {
  CLIENT_OWNER: "Właściciel konta",
  CLIENT_EMPLOYEE: "Pracownik",
  ADMIN: "Administrator"
};

const formatDate = (value, withTime = true) => {
  if (!value) return "Nie określono";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Nie określono";
  return date.toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {})
  });
};

const initials = (account) =>
  [account?.firstName, account?.lastName]
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "U";

function Field({ label, value, children }) {
  return (
    <div className="account-field">
      <span>{label}</span>
      <strong>{children || value || "Nie określono"}</strong>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <div className="account-toggle-row">
      <div>
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={checked ? "account-switch active" : "account-switch"}
        onClick={() => onChange(!checked)}
      >
        <BarrierIcon checked={checked} />
      </button>
    </div>
  );
}

export default function Profile() {
  const [account, setAccount] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activity, setActivity] = useState([]);
  const [activeTab, setActiveTab] = useState("profile");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ firstName: "", lastName: "", phone: "" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const loadData = async () => {
    setError("");
    const [accountRes, preferencesRes, sessionsRes, activityRes] = await Promise.all([
      clientAPI.account(),
      clientAPI.accountNotificationPreferences(),
      clientAPI.accountSessions(),
      clientAPI.accountActivity()
    ]);
    setAccount(accountRes.data);
    setPreferences(preferencesRes.data);
    setSessions(sessionsRes.data || []);
    setActivity(activityRes.data || []);
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    loadData()
      .catch((err) => {
        if (mounted) setError(err.response?.status === 403 ? "Brak dostępu do ustawień konta." : "Nie udało się pobrać ustawień konta.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const passwordRules = useMemo(() => {
    const password = passwordForm.newPassword;
    return [
      { label: "minimum 8 znaków", valid: password.length >= 8 },
      { label: "wielka litera", valid: /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(password) },
      { label: "mała litera", valid: /[a-ząćęłńóśźż]/.test(password) },
      { label: "cyfra", valid: /\d/.test(password) },
      { label: "znak specjalny", valid: /[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9]/.test(password) }
    ];
  }, [passwordForm.newPassword]);

  const openEdit = () => {
    setProfileForm({
      firstName: account?.firstName || "",
      lastName: account?.lastName || "",
      phone: account?.phone || ""
    });
    setEditOpen(true);
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const response = await clientAPI.updateAccount(profileForm);
      setAccount(response.data);
      setEditOpen(false);
      showFeedback({ message: "Dane profilu zostały zaktualizowane.", type: "success" });
    } catch (err) {
      showFeedback({ message: getRequestErrorMessage(err, "Nie udało się zaktualizować profilu."), type: "error" });
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setPasswordError("");

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordError("Wszystkie pola są wymagane.");
      return;
    }
    if (passwordForm.currentPassword === passwordForm.newPassword) {
      setPasswordError("Nowe hasło musi być inne niż obecne.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("Nowe hasła nie są zgodne.");
      return;
    }
    if (!passwordRules.every((rule) => rule.valid)) {
      setPasswordError("Nowe hasło nie spełnia wymagań bezpieczeństwa.");
      return;
    }

    setSavingPassword(true);
    try {
      await clientAPI.changeAccountPassword(passwordForm);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showFeedback({ message: "Hasło zostało zmienione.", type: "success" });
      const response = await clientAPI.account();
      setAccount(response.data);
    } catch (err) {
      setPasswordError(err.response?.data?.error || "Nie udało się zmienić hasła.");
    } finally {
      setSavingPassword(false);
    }
  };

  const updatePreference = async (key, value) => {
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    try {
      const response = await clientAPI.updateAccountNotificationPreferences({
        inApp: next.in_app,
        email: next.email,
        offers: next.offers,
        tickets: next.tickets,
        comments: next.comments,
        system: next.system
      });
      setPreferences(response.data);
      window.dispatchEvent(new Event("notification-preferences-updated"));
      showFeedback({ message: "Preferencje powiadomień zostały zapisane.", type: "success" });
    } catch (err) {
      showFeedback({ message: getRequestErrorMessage(err, "Nie udało się zapisać preferencji."), type: "error" });
    }
  };

  if (loading) return <div className="page account-page"><AppState variant="loading" title="Ladowanie ustawien konta" description="Pobieramy profil, zabezpieczenia i preferencje." /></div>;
  if (error && !account) return <div className="page account-page"><AppState variant="error" title="Nie mozna otworzyc ustawien konta" description={error} /></div>;
  if (!account) return null;

  return (
    <div className="page account-page">
      <header className="account-header">
        <div>
          <h1>Ustawienia konta</h1>
          <p>Zarządzaj swoim profilem, hasłem, powiadomieniami i bezpieczeństwem konta.</p>
        </div>
      </header>

      <section className="account-hero-card">
        <span className="account-avatar">{initials(account)}</span>
        <div>
          <h2>{[account.firstName, account.lastName].filter(Boolean).join(" ") || account.email}</h2>
          <p><Mail size={16} /> {account.email}</p>
          <div className="account-hero-badges">
            <span>{roleLabels[account.role] || account.role}</span>
            <span>{account.company?.name || "Brak firmy"}</span>
            <span className="active">Aktywne</span>
          </div>
          <small>Ostatnie logowanie: {formatDate(account.lastLoginAt)}</small>
        </div>
        <button type="button" onClick={openEdit}><Edit3 size={18} /> Edytuj profil</button>
      </section>

      <nav className="account-tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
              <Icon size={17} /> {tab.label}
            </button>
          );
        })}
      </nav>

      {activeTab === "profile" && (
        <section className="account-card">
          <div className="account-card-title"><h2>Dane profilu</h2><button type="button" onClick={openEdit}>Edytuj dane</button></div>
          <div className="account-fields-grid">
            <Field label="Imię" value={account.firstName} />
            <Field label="Nazwisko" value={account.lastName} />
            <Field label="E-mail/login" value={account.email} />
            <Field label="Telefon" value={account.phone} />
            <Field label="Rola" value={roleLabels[account.role] || account.role} />
            <Field label="Firma" value={account.company?.name} />
            <Field label="Status konta"><span className="account-status">Aktywne</span></Field>
          </div>
        </section>
      )}

      {activeTab === "security" && (
        <div className="account-two-column">
          <section className="account-card">
            <h2>Zmiana hasła</h2>
            <form className="account-password-form" onSubmit={changePassword}>
              <label>Obecne hasło<input type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((current) => ({ ...current, currentPassword: e.target.value }))} /></label>
              <label>Nowe hasło<input type="password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm((current) => ({ ...current, newPassword: e.target.value }))} /></label>
              <label>Powtórz nowe hasło<input type="password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm((current) => ({ ...current, confirmPassword: e.target.value }))} /></label>
              <div className="password-rules">
                {passwordRules.map((rule) => <span key={rule.label} className={rule.valid ? "valid" : ""}><CheckCircle2 size={14} /> {rule.label}</span>)}
              </div>
              {passwordError && <p className="account-form-error">{passwordError}</p>}
              <button type="submit" disabled={savingPassword}><KeyRound size={17} /> {savingPassword ? "Zapisywanie..." : "Zmień hasło"}</button>
            </form>
          </section>
          <section className="account-card">
            <h2>Bezpieczeństwo konta</h2>
            <div className="account-fields-grid single">
              <Field label="Ostatnie logowanie" value={formatDate(account.lastLoginAt)} />
              <Field label="Ostatnia zmiana hasła" value={formatDate(account.passwordChangedAt)} />
              <Field label="Status 2FA" value="Nieaktywne" />
            </div>
            <div className="account-info-box">Uwierzytelnianie dwuskładnikowe będzie dostępne w przyszłości.</div>
          </section>
        </div>
      )}

      {activeTab === "notifications" && preferences && (
        <section className="account-card">
          <h2>Preferencje powiadomień</h2>
          <div className="account-toggle-list">
            <ToggleRow label="Powiadomienia w aplikacji" description="Alerty widoczne w panelu HUB." checked={preferences.in_app !== false} onChange={(value) => updatePreference("in_app", value)} />
            <ToggleRow label="Powiadomienia e-mail" description="Wysyłka najważniejszych informacji na e-mail." checked={preferences.email === true} onChange={(value) => updatePreference("email", value)} />
            <ToggleRow label="Powiadomienia o ofertach" description="Zmiany statusu i nowe oferty." checked={preferences.offers !== false} onChange={(value) => updatePreference("offers", value)} />
            <ToggleRow label="Powiadomienia o zgłoszeniach" description="Aktualizacje zgłoszeń serwisowych." checked={preferences.tickets !== false} onChange={(value) => updatePreference("tickets", value)} />
            <ToggleRow label="Powiadomienia o komentarzach" description="Nowe komentarze przy ofertach i zgłoszeniach." checked={preferences.comments !== false} onChange={(value) => updatePreference("comments", value)} />
            {account.role === "ADMIN" && <ToggleRow label="Powiadomienia systemowe" description="Komunikaty bezpieczeństwa i systemu." checked={preferences.system !== false} onChange={(value) => updatePreference("system", value)} />}
          </div>
        </section>
      )}

      {activeTab === "sessions" && (
        <section className="account-card">
          <h2>Aktywne sesje</h2>
          {sessions.length ? (
            <div className="account-table-wrap"><table><thead><tr><th>Urządzenie</th><th>Przeglądarka</th><th>IP</th><th>Ostatnia aktywność</th><th>Status</th><th>Akcje</th></tr></thead><tbody>{sessions.map((session) => <tr key={session.id}><td>{session.device}</td><td>{session.browser}</td><td>{session.ip}</td><td>{formatDate(session.lastActivityAt)}</td><td>Aktywna</td><td><button type="button">Wyloguj sesję</button></td></tr>)}</tbody></table></div>
          ) : (
            <div className="account-empty-state"><Laptop size={34} /><h3>Historia sesji logowania będzie widoczna tutaj.</h3></div>
          )}
        </section>
      )}

      {activeTab === "activity" && (
        <section className="account-card">
          <h2>Ostatnia aktywność</h2>
          <div className="account-activity-list">
            {activity.map((item) => <article key={item.id}><Clock3 size={18} /><div><strong>{item.label}</strong><span>{formatDate(item.createdAt)}</span></div></article>)}
            {!activity.length && <div className="account-empty-state"><Activity size={34} /><h3>Brak ostatniej aktywności.</h3></div>}
          </div>
        </section>
      )}

      {editOpen && (
        <div className="account-modal-backdrop">
          <form className="account-modal" onSubmit={saveProfile}>
            <header><h2>Edytuj dane profilu</h2><button type="button" onClick={() => setEditOpen(false)}><X size={18} /></button></header>
            <label>Imię<input value={profileForm.firstName} onChange={(e) => setProfileForm((current) => ({ ...current, firstName: e.target.value }))} /></label>
            <label>Nazwisko<input value={profileForm.lastName} onChange={(e) => setProfileForm((current) => ({ ...current, lastName: e.target.value }))} /></label>
            <label>Telefon<input value={profileForm.phone} onChange={(e) => setProfileForm((current) => ({ ...current, phone: e.target.value }))} /></label>
            <footer><button type="button" onClick={() => setEditOpen(false)}>Anuluj</button><button type="submit" className="primary" disabled={savingProfile}>{savingProfile ? "Zapisywanie..." : "Zapisz zmiany"}</button></footer>
          </form>
        </div>
      )}
    </div>
  );
}
