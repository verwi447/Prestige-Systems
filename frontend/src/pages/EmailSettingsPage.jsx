import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Braces, CheckCircle2, Code2, Edit3, Eye, FileImage, FileText, History, LockKeyhole, Mail, Save, Send, Settings, ShieldCheck, Type } from "lucide-react";
import { email as emailAPI } from "../api";
import BarrierCheckbox from "../components/BarrierCheckbox";
import { apiOrigin } from "../lib/runtimeConfig";
import "./EmailSettingsPage.css";

const emptySettings = {
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  fromEmail: "",
  fromName: "Prestige Systems",
  replyToEmail: "",
  footerEnabled: true,
  footerHtml: "<p><strong>Prestige Systems</strong><br />www.prestigesystems.pl</p>",
  footerLogoUrl: "",
  isActive: true
};

const emptyTemplate = {
  name: "",
  subject: "",
  bodyHtml: "",
  bodyText: "",
  variables: "",
  isActive: true
};

const tabs = [
  { id: "smtp", label: "Konfiguracja SMTP", icon: Settings },
  { id: "templates", label: "Szablony wiadomości", icon: FileText },
  { id: "footer", label: "Stopka", icon: FileImage },
  { id: "logs", label: "Historia wysyłek", icon: History },
  { id: "test", label: "Test wysyłki", icon: Send }
];

const templateToForm = (template) => ({
  name: template?.name || "",
  subject: template?.subject || "",
  bodyHtml: template?.body_html || "",
  bodyText: template?.body_text || "",
  variables: Array.isArray(template?.variables)
    ? template.variables.join(", ")
    : typeof template?.variables === "string"
      ? template.variables
      : Object.keys(template?.variables || {}).join(", "),
  isActive: template?.is_active !== false
});

const assetUrl = (url) => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const base = apiOrigin;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
};

const plainTemplateText = (html) => String(html || "")
  .replaceAll("<br>", "\n")
  .replaceAll("<br/>", "\n")
  .replaceAll("<br />", "\n")
  .replaceAll("</p>", "\n\n")
  .replace(/<[^>]*>/g, "")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .trim();

const offerTemplateVariables = [
  { key: "companyName", label: "Nazwa firmy", description: "Firma odbiorcy oferty" },
  { key: "offerNumber", label: "Numer oferty", description: "Np. PS/2026/001" },
  { key: "offerTitle", label: "Tytul oferty", description: "Nazwa przygotowanej oferty" },
  { key: "offerValue", label: "Wartosc oferty", description: "Laczna wartosc netto" }
];

const ticketTemplateVariables = [
  { key: "ticketNumber", label: "Numer zgloszenia", description: "Np. ZG/2026/001" },
  { key: "ticketTitle", label: "Tytul zgloszenia", description: "Temat zgloszenia serwisowego" },
  { key: "ticketStatus", label: "Status zgloszenia", description: "Biezacy etap realizacji" },
  { key: "ticketPriority", label: "Priorytet", description: "Niski, normalny, wysoki lub krytyczny" },
  { key: "ticketType", label: "Typ zgloszenia", description: "Rodzaj zgloszonej sprawy" },
  { key: "siteName", label: "Nazwa obiektu", description: "Lokalizacja wskazana w zgloszeniu" },
  { key: "siteAddress", label: "Adres obiektu", description: "Adres lokalizacji zgloszenia" },
  { key: "reportedByName", label: "Zglaszajacy", description: "Imie i nazwisko osoby zglaszajacej" }
];

export default function EmailSettingsPage() {
  const [activeTab, setActiveTab] = useState("smtp");
  const [settings, setSettings] = useState(emptySettings);
  const sanitizedFooterPreview = useMemo(() => DOMPurify.sanitize(settings.footerHtml || ""), [settings.footerHtml]);
  const [hasPassword, setHasPassword] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateForm, setTemplateForm] = useState(emptyTemplate);
  const [templateContentMode, setTemplateContentMode] = useState("html");
  const [activeTemplateField, setActiveTemplateField] = useState("bodyHtml");
  const [templateVariableCategory, setTemplateVariableCategory] = useState("offers");
  const templateFieldRefs = useRef({});
  const [logs, setLogs] = useState([]);
  const [testMail, setTestMail] = useState({
    to: "",
    subject: "Test Prestige Systems HUB",
    html: "<p>To jest testowa wiadomość.</p>"
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const selectTemplate = useCallback((template) => {
    if (!template) return;
    setSelectedTemplateId(template.id);
    setTemplateForm(templateToForm(template));
    setTemplateContentMode("html");
    setActiveTemplateField("bodyHtml");
  }, []);

  const loadData = useCallback(async (preferredTemplateId = "") => {
    setLoading(true);
    try {
      const [settingsRes, footerRes, templatesRes, logsRes] = await Promise.all([
        emailAPI.getSettings().catch(() => ({ data: null })),
        emailAPI.getFooter().catch(() => ({ data: null })),
        emailAPI.getTemplates().catch(() => ({ data: [] })),
        emailAPI.getLogs({ limit: 20 }).catch(() => ({ data: { items: [] } }))
      ]);

      if (settingsRes.data) {
        setSettings({
          smtpHost: settingsRes.data.smtp_host || "",
          smtpPort: settingsRes.data.smtp_port || 587,
          smtpSecure: Boolean(settingsRes.data.smtp_secure),
          smtpUser: settingsRes.data.smtp_user || "",
          smtpPassword: "",
          fromEmail: settingsRes.data.from_email || "",
          fromName: settingsRes.data.from_name || "",
          replyToEmail: settingsRes.data.reply_to_email || "",
          isActive: settingsRes.data.is_active !== false
        });
        setHasPassword(Boolean(settingsRes.data.hasPassword));
      }

      if (footerRes.data) {
        setSettings((current) => ({
          ...current,
          footerEnabled: footerRes.data.footer_enabled !== false,
          footerHtml: footerRes.data.footer_html || emptySettings.footerHtml,
          footerLogoUrl: footerRes.data.footer_logo_url || ""
        }));
      }

      const loadedTemplates = templatesRes.data || [];
      setTemplates(loadedTemplates);
      const selected = loadedTemplates.find((template) => template.id === preferredTemplateId) || loadedTemplates[0];
      if (selected) selectTemplate(selected);
      setLogs(logsRes.data?.items || []);
    } finally {
      setLoading(false);
    }
  }, [selectTemplate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const update = (field, value) => setSettings((current) => ({ ...current, [field]: value }));
  const updateTemplate = (field, value) => setTemplateForm((current) => ({ ...current, [field]: value }));

  const insertTemplateVariable = (variable) => {
    const targetField = activeTemplateField === "bodyText" || activeTemplateField === "subject"
      ? activeTemplateField
      : "bodyHtml";
    const target = templateFieldRefs.current[targetField];
    const currentValue = templateForm[targetField] || "";
    const start = target?.selectionStart ?? currentValue.length;
    const end = target?.selectionEnd ?? currentValue.length;
    const token = `{{${variable}}}`;

    setTemplateForm((current) => {
      const knownVariables = current.variables
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      return {
        ...current,
        [targetField]: `${currentValue.slice(0, start)}${token}${currentValue.slice(end)}`,
        variables: knownVariables.includes(variable) ? current.variables : [...knownVariables, variable].join(", ")
      };
    });
    requestAnimationFrame(() => {
      if (!target) return;
      const cursor = start + token.length;
      target.focus();
      target.setSelectionRange(cursor, cursor);
    });
  };

  const uploadFooterLogo = async (file) => {
    if (!file) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await emailAPI.uploadFooterLogo(file);
      setSettings((current) => ({ ...current, footerLogoUrl: response.data.logoUrl }));
      setMessage("Logo stopki zostało wgrane. Zapisz ustawienia, aby używać go w wiadomościach.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się wgrać logo stopki.");
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await emailAPI.updateSettings(settings);
      setHasPassword(Boolean(response.data?.hasPassword));
      setSettings((current) => ({ ...current, smtpPassword: "" }));
      setMessage("Ustawienia poczty zostały zapisane.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać ustawień poczty.");
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    setLoading(true);
    setMessage("");
    try {
      await emailAPI.testConnection();
      setMessage("Połączenie SMTP działa poprawnie.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Test połączenia SMTP nie powiódł się.");
    } finally {
      setLoading(false);
    }
  };

  const saveTemplate = async () => {
    if (!selectedTemplateId) return;
    setLoading(true);
    setMessage("");
    try {
      const variables = templateForm.variables
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const response = await emailAPI.updateTemplate(selectedTemplateId, {
        name: templateForm.name,
        subject: templateForm.subject,
        bodyHtml: templateForm.bodyHtml,
        bodyText: templateForm.bodyText,
        variables,
        isActive: templateForm.isActive
      });
      setTemplates((current) => current.map((template) => (template.id === selectedTemplateId ? response.data : template)));
      setTemplateForm(templateToForm(response.data));
      setMessage("Szablon wiadomości został zapisany.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać szablonu wiadomości.");
    } finally {
      setLoading(false);
    }
  };

  const saveFooter = async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await emailAPI.updateFooter({
        footerEnabled: settings.footerEnabled,
        footerHtml: settings.footerHtml,
        footerLogoUrl: settings.footerLogoUrl
      });
      setSettings((current) => ({
        ...current,
        footerEnabled: response.data.footer_enabled !== false,
        footerHtml: response.data.footer_html || "",
        footerLogoUrl: response.data.footer_logo_url || ""
      }));
      setMessage("Stopka wiadomości została zapisana.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać stopki.");
    } finally {
      setLoading(false);
    }
  };

  const sendTest = async () => {
    setLoading(true);
    setMessage("");
    try {
      await emailAPI.testSend(testMail);
      setMessage("Testowy e-mail został wysłany.");
      await loadData(selectedTemplateId);
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się wysłać testowego e-maila.");
    } finally {
      setLoading(false);
    }
  };

  const templateVariables = templateForm.variables
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const templatePreview = templateForm.bodyText.trim() || plainTemplateText(templateForm.bodyHtml);
  const readyTemplateVariables = templateVariableCategory === "tickets" ? ticketTemplateVariables : offerTemplateVariables;

  return (
    <div className="page email-settings-page">
      <div className="email-settings-header">
        <div>
          <span>Poczta</span>
          <h1>Ustawienia e-mail</h1>
        </div>
        <div className="email-settings-header-actions">
          <span className={settings.isActive ? "email-delivery-status active" : "email-delivery-status inactive"}>
            <CheckCircle2 size={15} /> {settings.isActive ? "Wysylka aktywna" : "Wysylka wylaczona"}
          </span>
          <Mail size={28} />
        </div>
      </div>

      {message && <div className="settings-message">{message}</div>}

      <nav className="email-settings-tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
              <Icon size={16} />{tab.label}
            </button>
          );
        })}
      </nav>

      {activeTab === "smtp" && (
        <section className="email-card email-smtp-card">
          <div className="email-card-title">
            <h2>Konfiguracja SMTP</h2>
            <p>Hasło SMTP jest szyfrowane i nie jest zwracane do frontendu.</p>
          </div>
          <div className="smtp-security-summary">
            <span className="smtp-security-icon"><LockKeyhole size={20} /></span>
            <div>
              <strong>Bezpieczna konfiguracja</strong>
              <p>Haslo SMTP jest szyfrowane i nie jest zwracane do przegladarki.</p>
            </div>
            <span className={settings.smtpSecure ? "smtp-security-state enabled" : "smtp-security-state"}><ShieldCheck size={16} /> {settings.smtpSecure ? "SSL/TLS wlaczone" : "SSL/TLS wylaczone"}</span>
          </div>
          <div className="email-form-grid smtp-form-grid">
            <label>Host SMTP<input value={settings.smtpHost} onChange={(event) => update("smtpHost", event.target.value)} placeholder="smtp.example.com" /></label>
            <label>Port<input type="number" value={settings.smtpPort} onChange={(event) => update("smtpPort", event.target.value)} /></label>
            <BarrierCheckbox className="email-check" checked={settings.smtpSecure} onChange={(value) => update("smtpSecure", value)} label="Połączenie SSL/TLS" />
            <BarrierCheckbox className="email-check" checked={settings.isActive} onChange={(value) => update("isActive", value)} label="Konfiguracja aktywna" />
            <label>Użytkownik SMTP<input value={settings.smtpUser} onChange={(event) => update("smtpUser", event.target.value)} placeholder="konto SMTP" /></label>
            <label>Hasło SMTP<input type="password" value={settings.smtpPassword} onChange={(event) => update("smtpPassword", event.target.value)} placeholder={hasPassword ? "Pozostaw puste, aby nie zmieniać" : "Wprowadź hasło SMTP"} /></label>
            <label>E-mail nadawcy<input type="email" value={settings.fromEmail} onChange={(event) => update("fromEmail", event.target.value)} placeholder="biuro@prestigesystems.pl" /></label>
            <label>Nazwa nadawcy<input value={settings.fromName} onChange={(event) => update("fromName", event.target.value)} placeholder="Prestige Systems" /></label>
            <label className="full">Reply-to<input type="email" value={settings.replyToEmail} onChange={(event) => update("replyToEmail", event.target.value)} placeholder="serwis@prestigesystems.pl" /></label>
          </div>
          <div className="email-actions smtp-actions">
            <button type="button" className="email-secondary" disabled={loading} onClick={testConnection}>Testuj połączenie</button>
            <button type="button" className="email-primary" disabled={loading} onClick={saveSettings}>Zapisz ustawienia</button>
          </div>
        </section>
      )}

      {activeTab === "templates" && (
        <section className="email-card template-settings-card">
          <div className="email-card-title">
            <h2>Szablony wiadomości</h2>
            <p>Edytuj temat, HTML, tekst oraz listę zmiennych używanych w wiadomościach.</p>
          </div>
          <div className="template-editor-layout">
            <aside className="template-list">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={selectedTemplateId === template.id ? "active" : ""}
                  onClick={() => selectTemplate(template)}
                >
                  <Edit3 size={15} />
                  <span>
                    <strong>{template.name}</strong>
                    <small>{template.key}</small>
                  </span>
                </button>
              ))}
              {!templates.length && <p>Brak szablonów.</p>}
            </aside>

            {selectedTemplateId && (
              <div className="template-editor">
                <div className="template-editor-topbar">
                  <div>
                    <span>Edytujesz szablon</span>
                    <strong>{templateForm.name || "Bez nazwy"}</strong>
                  </div>
                  <div className="template-mode-switch" aria-label="Widok tresci szablonu">
                    <button type="button" className={templateContentMode === "html" ? "active" : ""} onClick={() => { setTemplateContentMode("html"); setActiveTemplateField("bodyHtml"); }}><Code2 size={15} />HTML</button>
                    <button type="button" className={templateContentMode === "text" ? "active" : ""} onClick={() => { setTemplateContentMode("text"); setActiveTemplateField("bodyText"); }}><Type size={15} />Tekst</button>
                    <button type="button" className={templateContentMode === "preview" ? "active" : ""} onClick={() => setTemplateContentMode("preview")}><Eye size={15} />Podglad</button>
                  </div>
                </div>
                <div className="template-properties">
                  <label>Nazwa<input ref={(node) => { templateFieldRefs.current.name = node; }} value={templateForm.name} onFocus={() => setActiveTemplateField("name")} onChange={(event) => updateTemplate("name", event.target.value)} /></label>
                  <label>Temat<input ref={(node) => { templateFieldRefs.current.subject = node; }} value={templateForm.subject} onFocus={() => setActiveTemplateField("subject")} onChange={(event) => updateTemplate("subject", event.target.value)} placeholder="Np. Oferta {{offerNumber}}" /></label>
                </div>
                <div className="template-content-layout">
                  <div className="template-content-editor">
                    {templateContentMode === "html" && (
                      <label className="template-content-field">
                        <span><Code2 size={15} />Tresc HTML</span>
                        <textarea ref={(node) => { templateFieldRefs.current.bodyHtml = node; }} rows="13" value={templateForm.bodyHtml} onFocus={() => setActiveTemplateField("bodyHtml")} onChange={(event) => updateTemplate("bodyHtml", event.target.value)} placeholder="<p>Dzien dobry {{companyName}},</p>" />
                      </label>
                    )}
                    {templateContentMode === "text" && (
                      <label className="template-content-field">
                        <span><Type size={15} />Tresc tekstowa</span>
                        <textarea ref={(node) => { templateFieldRefs.current.bodyText = node; }} rows="13" value={templateForm.bodyText} onFocus={() => setActiveTemplateField("bodyText")} onChange={(event) => updateTemplate("bodyText", event.target.value)} placeholder="Dzien dobry {{companyName}}," />
                      </label>
                    )}
                    {templateContentMode === "preview" && (
                      <div className="template-message-preview">
                        <div className="template-preview-mailbar"><Mail size={15} />Podglad wiadomosci tekstowej</div>
                        <span>Temat</span>
                        <strong>{templateForm.subject || "Temat wiadomosci"}</strong>
                        <div>{templatePreview || "Dodaj tresc HTML lub tekstowa, aby zobaczyc podglad."}</div>
                      </div>
                    )}
                  </div>
                  <aside className="template-variables-panel">
                    <div>
                      <span><Braces size={16} />Zmienne</span>
                      <p>Kliknij zmienna, aby wstawic ja w miejscu kursora.</p>
                    </div>
                    <label>
                      Lista zmiennych
                      <input ref={(node) => { templateFieldRefs.current.variables = node; }} value={templateForm.variables} onFocus={() => setActiveTemplateField("variables")} onChange={(event) => updateTemplate("variables", event.target.value)} placeholder="companyName, offerNumber" />
                    </label>
                    <div className="template-variable-library">
                      <span>Gotowe zmienne</span>
                      <div className="template-variable-category" aria-label="Kategoria zmiennych">
                        <button type="button" className={templateVariableCategory === "offers" ? "active" : ""} onClick={() => setTemplateVariableCategory("offers")}>Oferty</button>
                        <button type="button" className={templateVariableCategory === "tickets" ? "active" : ""} onClick={() => setTemplateVariableCategory("tickets")}>Zgloszenia</button>
                      </div>
                      <div className="template-variable-library-list">
                        {readyTemplateVariables.map((variable) => (
                          <button key={variable.key} type="button" onClick={() => insertTemplateVariable(variable.key)}>
                            <strong>{`{{${variable.key}}}`}</strong>
                            <small>{variable.label}</small>
                            <em>{variable.description}</em>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="template-variable-current">
                      <span>Uzyte w szablonie</span>
                      <div className="template-variable-chips">
                        {templateVariables.map((variable) => <button key={variable} type="button" onClick={() => insertTemplateVariable(variable)}>{`{{${variable}}}`}</button>)}
                        {!templateVariables.length && <span>Dodaj zmienne po przecinku.</span>}
                      </div>
                    </div>
                  </aside>
                </div>
                <div className="template-editor-actions">
                  <BarrierCheckbox className="email-check" checked={templateForm.isActive} onChange={(value) => updateTemplate("isActive", value)} label="Szablon aktywny" />
                  <button type="button" className="email-primary" disabled={loading} onClick={saveTemplate}><Save size={16} />Zapisz szablon</button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === "footer" && (
        <section className="email-card">
          <div className="email-card-title">
            <h2>Stopka wiadomości</h2>
            <p>Stopka jest automatycznie dodawana pod treścią wysyłanych e-maili.</p>
          </div>
          <div className="footer-editor-layout">
            <div className="footer-editor">
              <div className="footer-control-row">
                <BarrierCheckbox
                  className="footer-toggle"
                  checked={settings.footerEnabled}
                  onChange={(value) => update("footerEnabled", value)}
                  label={<strong>Dodawaj stopkę do wiadomości</strong>}
                />
                <label className="footer-upload">
                  <span>Logo stopki</span>
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(event) => uploadFooterLogo(event.target.files?.[0])} />
                </label>
              </div>
              <div className="email-form-grid footer-fields">
                <label className="full">Adres logo albo obrazka
                  <input value={settings.footerLogoUrl} onChange={(event) => update("footerLogoUrl", event.target.value)} placeholder="/uploads/email/logo.png albo https://..." />
                </label>
                <label className="full">Treść stopki HTML
                  <textarea rows="9" value={settings.footerHtml} onChange={(event) => update("footerHtml", event.target.value)} />
                </label>
              </div>
              <div className="email-actions">
                <button type="button" className="email-primary" disabled={loading} onClick={saveFooter}><Save size={16} />Zapisz stopkę</button>
              </div>
            </div>
            <aside className="footer-preview">
              <span>Podgląd</span>
              {settings.footerLogoUrl && <img src={assetUrl(settings.footerLogoUrl)} alt="Logo stopki" />}
              <div dangerouslySetInnerHTML={{ __html: sanitizedFooterPreview }} />
            </aside>
          </div>
        </section>
      )}

      {activeTab === "logs" && (
        <section className="email-card">
          <h2>Historia wysyłek</h2>
          <div className="email-log-table">
            {logs.map((log) => <article key={log.id}><strong>{log.subject}</strong><span>{log.to_email}</span><i className={log.status.toLowerCase()}>{log.status}</i></article>)}
            {!logs.length && <p>Brak wysyłek.</p>}
          </div>
        </section>
      )}

      {activeTab === "test" && (
        <section className="email-card">
          <h2>Test wysyłki</h2>
          <div className="email-form-grid">
            <label>Do<input type="email" value={testMail.to} onChange={(event) => setTestMail((current) => ({ ...current, to: event.target.value }))} /></label>
            <label>Temat<input value={testMail.subject} onChange={(event) => setTestMail((current) => ({ ...current, subject: event.target.value }))} /></label>
            <label className="full">Treść HTML<textarea rows="7" value={testMail.html} onChange={(event) => setTestMail((current) => ({ ...current, html: event.target.value }))} /></label>
          </div>
          <div className="email-actions">
            <button type="button" className="email-primary" disabled={loading} onClick={sendTest}>Wyślij test</button>
          </div>
        </section>
      )}
    </div>
  );
}
