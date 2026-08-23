import { useCallback, useEffect, useState } from "react";
import { BookOpen, Check, Pencil, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { aiAssistant } from "../api";
import AppState from "../components/AppState";
import BarrierCheckbox from "../components/BarrierCheckbox";
import ConfirmationModal from "../components/ConfirmationModal";
import { getRequestErrorMessage, showFeedback, showSuccess } from "../lib/feedback";
import "./AiAssistantSettings.css";

const emptyForm = { id: null, title: "", category: "", content: "" };

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("pl-PL");
}

export default function AiAssistantSettings() {
  const [settings, setSettings] = useState(null);
  const [autoSendEnabled, setAutoSendEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [knowledgeEntries, setKnowledgeEntries] = useState([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [formSaving, setFormSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState("ALL");

  const [equipment, setEquipment] = useState([]);
  const [addingEquipment, setAddingEquipment] = useState(false);
  const [newEquipmentName, setNewEquipmentName] = useState("");
  const [editingEquipmentId, setEditingEquipmentId] = useState(null);
  const [editingEquipmentName, setEditingEquipmentName] = useState("");

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

  const loadKnowledge = useCallback(async () => {
    setKnowledgeLoading(true);
    try {
      const response = await aiAssistant.getKnowledge();
      setKnowledgeEntries(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      showFeedback({ message: getRequestErrorMessage(requestError, "Nie udalo sie pobrac bazy wiedzy."), type: "error" });
    } finally {
      setKnowledgeLoading(false);
    }
  }, []);

  const loadEquipment = useCallback(async () => {
    try {
      const response = await aiAssistant.getEquipment();
      setEquipment(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      showFeedback({ message: getRequestErrorMessage(requestError, "Nie udalo sie pobrac listy urzadzen."), type: "error" });
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadKnowledge();
    loadEquipment();
  }, [loadSettings, loadKnowledge, loadEquipment]);

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

  const defaultEquipmentName = () => (equipment.find((item) => item.isActive) || equipment[0])?.name || "";

  const openNewEntryForm = () => setForm({ ...emptyForm, category: selectedCategory === "ALL" ? defaultEquipmentName() : selectedCategory });
  const openEditEntryForm = (entry) => setForm({ id: entry.id, title: entry.title, category: entry.category, content: entry.content });
  const closeForm = () => setForm(null);

  const submitForm = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.content.trim()) {
      showFeedback({ message: "Podaj tytul i tresc wpisu.", type: "error" });
      return;
    }
    setFormSaving(true);
    try {
      const payload = { title: form.title.trim(), category: form.category || defaultEquipmentName(), content: form.content.trim() };
      if (form.id) await aiAssistant.updateKnowledge(form.id, payload);
      else await aiAssistant.createKnowledge(payload);
      showSuccess(form.id ? "Wpis zostal zaktualizowany." : "Wpis zostal dodany do bazy wiedzy.");
      setForm(null);
      await loadKnowledge();
    } catch (requestError) {
      showFeedback({ message: getRequestErrorMessage(requestError, "Nie udalo sie zapisac wpisu."), type: "error" });
    } finally {
      setFormSaving(false);
    }
  };

  const confirmDelete = async () => {
    const entry = deleteTarget;
    setDeleteTarget(null);
    try {
      await aiAssistant.deleteKnowledge(entry.id);
      showSuccess("Wpis zostal usuniety.");
      await loadKnowledge();
    } catch (requestError) {
      showFeedback({ message: getRequestErrorMessage(requestError, "Nie udalo sie usunac wpisu."), type: "error" });
    }
  };

  const submitNewEquipment = async (event) => {
    event.preventDefault();
    const name = newEquipmentName.trim();
    if (!name) return;
    try {
      await aiAssistant.createEquipment({ name });
      showSuccess("Urzadzenie zostalo dodane.");
      setNewEquipmentName("");
      setAddingEquipment(false);
      await loadEquipment();
    } catch (requestError) {
      showFeedback({ message: getRequestErrorMessage(requestError, "Nie udalo sie dodac urzadzenia."), type: "error" });
    }
  };

  const startEditEquipment = (item) => {
    setEditingEquipmentId(item.id);
    setEditingEquipmentName(item.name);
  };

  const cancelEditEquipment = () => {
    setEditingEquipmentId(null);
    setEditingEquipmentName("");
  };

  const submitEquipmentRename = async (event, item) => {
    event.preventDefault();
    const name = editingEquipmentName.trim();
    if (!name || name === item.name) {
      cancelEditEquipment();
      return;
    }
    try {
      await aiAssistant.updateEquipment(item.id, { name });
      showSuccess("Nazwa urzadzenia zostala zaktualizowana.");
      if (selectedCategory === item.name) setSelectedCategory(name);
      cancelEditEquipment();
      await Promise.all([loadEquipment(), loadKnowledge()]);
    } catch (requestError) {
      showFeedback({ message: getRequestErrorMessage(requestError, "Nie udalo sie zapisac nazwy urzadzenia."), type: "error" });
    }
  };

  const toggleEquipmentActive = async (item) => {
    try {
      await aiAssistant.updateEquipment(item.id, { isActive: !item.isActive });
      await loadEquipment();
    } catch (requestError) {
      showFeedback({ message: getRequestErrorMessage(requestError, "Nie udalo sie zmienic statusu urzadzenia."), type: "error" });
    }
  };

  if (loading) {
    return <div className="page ai-settings-page"><AppState variant="loading" title="Ladowanie ustawien" description="Pobieramy konfiguracje asystenta AI." /></div>;
  }

  if (!settings) {
    return <div className="page ai-settings-page"><AppState variant="error" title="Nie mozna pobrac ustawien" description={error || "Brak danych."} actionLabel="Sprobuj ponownie" onAction={loadSettings} /></div>;
  }

  const hasChanges = autoSendEnabled !== Boolean(settings.auto_send_enabled);
  const categoryCounts = knowledgeEntries.reduce((counts, entry) => {
    counts[entry.category] = (counts[entry.category] || 0) + 1;
    return counts;
  }, {});
  const filteredEntries = selectedCategory === "ALL" ? knowledgeEntries : knowledgeEntries.filter((entry) => entry.category === selectedCategory);

  return (
    <div className="page ai-settings-page">
      <header className="ai-settings-header">
        <div>
          <div className="ai-settings-breadcrumb">Ustawienia <span>&rsaquo;</span> System <span>&rsaquo;</span> Asystent AI</div>
          <h1>Asystent AI</h1>
          <p>Steruj tym, jak asystent AI reaguje na nowe zgloszenia serwisowe i czego sie uczy.</p>
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

      <section className="ai-settings-panel">
        <header className="ai-settings-panel-header">
          <span><BookOpen aria-hidden="true" /></span>
          <div>
            <h2>Baza wiedzy o sprzecie i naprawach</h2>
            <p>Wpisy sa dolaczane do kazdej analizy AI jako najbardziej wiarygodne zrodlo wiedzy. Aktywne urzadzenia sa widoczne do wyboru dla klienta przy zgloszeniu.</p>
          </div>
        </header>

        <div className="ai-knowledge-layout">
          <nav className="ai-knowledge-categories" aria-label="Urzadzenia i kategorie bazy wiedzy">
            <button type="button" className={selectedCategory === "ALL" ? "active" : ""} onClick={() => setSelectedCategory("ALL")}>
              <span>Wszystkie</span>
              <b>{knowledgeEntries.length}</b>
            </button>

            {equipment.map((item) => (
              <div key={item.id} className={`ai-equipment-row ${item.isActive ? "" : "inactive"}`}>
                {editingEquipmentId === item.id ? (
                  <form className="ai-equipment-edit-form" onSubmit={(event) => submitEquipmentRename(event, item)}>
                    <input autoFocus value={editingEquipmentName} onChange={(event) => setEditingEquipmentName(event.target.value)} maxLength={80} />
                    <button type="submit" aria-label="Zapisz nazwe"><Check size={14} /></button>
                    <button type="button" onClick={cancelEditEquipment} aria-label="Anuluj"><X size={14} /></button>
                  </form>
                ) : (
                  <>
                    <button type="button" className={selectedCategory === item.name ? "ai-equipment-select active" : "ai-equipment-select"} onClick={() => setSelectedCategory(item.name)}>
                      <span>{item.name}</span>
                      <b>{categoryCounts[item.name] || 0}</b>
                    </button>
                    <div className="ai-equipment-row-actions">
                      <button type="button" title="Edytuj nazwe" onClick={() => startEditEquipment(item)}><Pencil size={13} /></button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.isActive}
                        className={item.isActive ? "ai-equipment-toggle on" : "ai-equipment-toggle"}
                        title={item.isActive ? "Aktywne - widoczne dla klienta w zgloszeniach" : "Nieaktywne - ukryte dla klienta"}
                        onClick={() => toggleEquipmentActive(item)}
                      >
                        <i />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}

            {addingEquipment ? (
              <form className="ai-equipment-add-form" onSubmit={submitNewEquipment}>
                <input autoFocus value={newEquipmentName} onChange={(event) => setNewEquipmentName(event.target.value)} placeholder="Nazwa urzadzenia" maxLength={80} />
                <button type="submit" aria-label="Dodaj"><Check size={14} /></button>
                <button type="button" onClick={() => { setAddingEquipment(false); setNewEquipmentName(""); }} aria-label="Anuluj"><X size={14} /></button>
              </form>
            ) : (
              <button type="button" className="ai-equipment-add" onClick={() => setAddingEquipment(true)}>
                <Plus size={14} /> Dodaj urzadzenie
              </button>
            )}
          </nav>

          <div className="ai-knowledge-main">
            <div className="ai-knowledge-main-header">
              <h3>{selectedCategory === "ALL" ? "Wszystkie wpisy" : selectedCategory}</h3>
              {!form && (
                <button type="button" className="ai-knowledge-add" onClick={openNewEntryForm} disabled={!equipment.length}>
                  <Plus aria-hidden="true" /> Dodaj wpis
                </button>
              )}
            </div>

            {form && (
              <form className="ai-knowledge-form" onSubmit={submitForm}>
                <label>
                  <span>Tytul</span>
                  <input type="text" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Np. Szlaban CAME Gard 4 - typowe usterki" maxLength={200} required />
                </label>
                <label>
                  <span>Urzadzenie</span>
                  <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                    {equipment.map((item) => (
                      <option key={item.id} value={item.name}>{item.name}{!item.isActive ? " (nieaktywne)" : ""}</option>
                    ))}
                  </select>
                </label>
                <label className="ai-knowledge-form-content">
                  <span>Tresc</span>
                  <textarea rows="6" value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} placeholder="Opisz sprzet, typowe usterki i sposob ich rozwiazywania - im konkretniej, tym lepsze sugestie AI." required />
                </label>
                <div className="ai-knowledge-form-actions">
                  <button type="button" className="ai-knowledge-cancel" onClick={closeForm}><X aria-hidden="true" /> Anuluj</button>
                  <button type="submit" className="ai-settings-save" disabled={formSaving}>
                    <Save aria-hidden="true" /> {formSaving ? "Zapisywanie..." : "Zapisz wpis"}
                  </button>
                </div>
              </form>
            )}

            <div className="ai-knowledge-list">
              {knowledgeLoading ? (
                <AppState compact variant="loading" title="Ladowanie bazy wiedzy" />
              ) : filteredEntries.length ? (
                filteredEntries.map((entry) => (
                  <article className="ai-knowledge-entry" key={entry.id}>
                    <header>
                      <strong>{entry.title}</strong>
                      {selectedCategory === "ALL" && <span className="ai-knowledge-badge">{entry.category}</span>}
                    </header>
                    <p>{entry.content}</p>
                    <footer>
                      <small>{entry.authorName} • {formatDate(entry.updatedAt)}</small>
                      <div className="ai-knowledge-entry-actions">
                        <button type="button" onClick={() => openEditEntryForm(entry)}><Pencil aria-hidden="true" /> Edytuj</button>
                        <button type="button" className="danger" onClick={() => setDeleteTarget(entry)}><Trash2 aria-hidden="true" /> Usun</button>
                      </div>
                    </footer>
                  </article>
                ))
              ) : selectedCategory === "ALL" ? (
                <AppState compact variant="empty" title="Baza wiedzy jest pusta" description="Dodaj pierwszy wpis o sprzecie lub typowej naprawie, aby AI mogl z niego korzystac." />
              ) : (
                <AppState compact variant="empty" title="Brak wpisow w tej kategorii" description={`Dodaj pierwszy wpis dla kategorii "${selectedCategory}".`} />
              )}
            </div>
          </div>
        </div>
      </section>

      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Usun wpis z bazy wiedzy"
        confirmText="Usun"
      >
        <p>Usunac wpis <strong>{deleteTarget?.title}</strong>? Tej operacji nie mozna cofnac.</p>
      </ConfirmationModal>
    </div>
  );
}
