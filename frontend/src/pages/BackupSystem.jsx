import { useEffect, useMemo, useRef, useState } from "react";
import { backups } from "../api";
import AppState from "../components/AppState";
import ConfirmationModal from "../components/ConfirmationModal";
import BarrierCheckbox from "../components/BarrierCheckbox";
import "./BackupSystem.css";

const tabs = [
  { id: "overview", label: "Przegląd" },
  { id: "history", label: "Historia backupów" },
  { id: "schedule", label: "Harmonogram" },
  { id: "locations", label: "Lokalizacje" },
  { id: "import", label: "Import / Eksport" },
  { id: "audit", label: "Audit Log" }
];

const emptyLocation = { name: "", type: "LOCAL_FOLDER", path: "", isDefault: false };
const BACKUP_HISTORY_PAGE_SIZE = 5;

function BackupIcon({ type }) {
  const paths = {
    calendar: <path d="M7 3v3M17 3v3M4 8h16M5 5h14v15H5zM8 12h3M13 12h3M8 16h3" />,
    shield: <path d="M12 3 19 6v5c0 4.5-2.8 7.6-7 10-4.2-2.4-7-5.5-7-10V6zM9 12l2 2 4-5" />,
    stack: <path d="m12 3 8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4" />,
    chart: <path d="M12 21a9 9 0 1 0-9-9h9zM12 3v9h9" />,
    plus: <path d="M12 5v14M5 12h14" />,
    upload: <path d="M12 15V4M8 8l4-4 4 4M5 20h14" />,
    download: <path d="M12 4v11M8 11l4 4 4-4M5 20h14" />,
    check: <path d="M5 12.5 9.5 17 19 7" />,
    restore: <path d="M4 7v5h5M5 12a7 7 0 1 0 2-5" />,
    trash: <path d="M4 7h16M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3" />,
    edit: <path d="M4 20h4.2L19.1 9.1a2.4 2.4 0 0 0-3.4-3.4L4.8 16.6zM14.4 7 17 9.6" />,
    folder: <path d="M3 6h7l2 2h9v10H3z" />,
    more: <path d="M12 7h.01M12 12h.01M12 17h.01" />,
    info: <path d="M12 8h.01M12 11v5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />,
    lock: <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6z" />,
    arrow: <path d="M9 18l6-6-6-6" />
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[type]}</svg>;
}

const formatDate = (date) => (date ? new Date(date).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" }) : "-");
const bytes = (value, emptyLabel = "0 B") => {
  const number = Number(value || 0);
  if (!number) return emptyLabel;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(number) / Math.log(1024)), units.length - 1);
  return `${(number / 1024 ** index).toLocaleString("pl-PL", { maximumFractionDigits: 2 })} ${units[index]}`;
};

const statusLabel = (status) => ({
  COMPLETED: "Zakończony",
  RUNNING: "W toku",
  PENDING: "Oczekujący",
  FAILED: "Błąd",
  VERIFIED: "Zweryfikowany",
  FAILED_INTEGRITY: "Błąd",
  NOT_CHECKED: "Nie sprawdzono",
  NOT_TESTED: "Nie testowano",
  TESTING: "Testowanie",
  ONLINE: "Online",
  OFFLINE: "Offline",
  ERROR: "Błąd"
}[status] || status || "-");

function Badge({ value, type = "status" }) {
  const normalized = String(value || "").toLowerCase().replace(/_/g, "-");
  return <span className={`backup-badge ${type}-${normalized}`}>{statusLabel(value)}</span>;
}

function adminName(row) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || row.username || "System";
}

function hasBackupFile(job) {
  return job.status === "COMPLETED" && Number(job.size_bytes || 0) > 0;
}

function backupSizeLabel(job) {
  if (job.status === "RUNNING" || job.status === "PENDING") return "W toku";
  return hasBackupFile(job) ? bytes(job.size_bytes) : "Brak pliku";
}

export default function BackupSystem() {
  const fileRef = useRef(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [jobs, setJobs] = useState([]);
  const [settings, setSettings] = useState(null);
  const [locations, setLocations] = useState([]);
  const [audit, setAudit] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [locationForm, setLocationForm] = useState(emptyLocation);
  const [editingLocation, setEditingLocation] = useState(null);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [importOptions, setImportOptions] = useState({ integrity: true, testRestore: false });
  const [selectedImportFile, setSelectedImportFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [restoreJob, setRestoreJob] = useState(null);
  const [forceRestore, setForceRestore] = useState(false);
  const [restoreForm, setRestoreForm] = useState({ confirmation: "", password: "", riskAccepted: false });
  const [deleteJob, setDeleteJob] = useState(null);
  const [historyPage, setHistoryPage] = useState(1);

  const loadData = async () => {
    setLoading(true);
    try {
      const [jobsRes, settingsRes, locationsRes, auditRes] = await Promise.all([
        backups.getAll(),
        backups.getSettings(),
        backups.getLocations(),
        backups.audit()
      ]);
      setJobs(jobsRes.data || []);
      setSettings(settingsRes.data);
      setLocations(locationsRes.data || []);
      setAudit(auditRes.data || []);
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się pobrać danych backupu.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const completedJobs = jobs.filter((job) => job.status === "COMPLETED");
  const lastBackup = completedJobs[0];
  const totalSize = jobs.reduce((sum, job) => sum + Number(job.size_bytes || 0), 0);
  const verifiedCount = jobs.filter((job) => job.integrity_status === "VERIFIED").length;
  const testedCount = jobs.filter((job) => job.test_restore_status === "VERIFIED").length;
  const failedCount = jobs.filter((job) => job.status === "FAILED" || job.integrity_status === "FAILED" || job.test_restore_status === "FAILED").length;
  const untestedCount = Math.max(jobs.length - testedCount - failedCount, 0);
  const latestActivity = audit.slice(0, 4);
  const restoreTotal = Math.max(jobs.length, 1);
  const restoreVerifiedEnd = jobs.length ? (testedCount / restoreTotal) * 360 : 0;
  const restorePendingEnd = jobs.length ? ((testedCount + untestedCount) / restoreTotal) * 360 : 0;
  const restoreRingStyle = {
    "--restore-verified-end": `${restoreVerifiedEnd}deg`,
    "--restore-pending-end": `${restorePendingEnd}deg`
  };
  const historyPageCount = Math.max(1, Math.ceil(jobs.length / BACKUP_HISTORY_PAGE_SIZE));
  const currentHistoryPage = Math.min(historyPage, historyPageCount);
  const historyStart = jobs.length ? (currentHistoryPage - 1) * BACKUP_HISTORY_PAGE_SIZE : 0;
  const historyEnd = Math.min(historyStart + BACKUP_HISTORY_PAGE_SIZE, jobs.length);
  const visibleJobs = jobs.slice(historyStart, historyEnd);

  useEffect(() => {
    setHistoryPage((current) => Math.min(current, Math.max(1, Math.ceil(jobs.length / BACKUP_HISTORY_PAGE_SIZE))));
  }, [jobs.length]);

  const stats = useMemo(() => [
    { icon: "calendar", label: "Ostatni backup", value: lastBackup ? formatDate(lastBackup.completed_at || lastBackup.created_at) : "-", hint: lastBackup ? `${statusLabel(lastBackup.type)} · ${statusLabel(lastBackup.status)}` : "Brak backupów" },
    { icon: "shield", label: "Status systemu", value: failedCount ? "Wymaga uwagi" : "Wszystko działa prawidłowo", hint: `Ostatnia weryfikacja: ${lastBackup ? formatDate(lastBackup.completed_at) : "-"}`, good: !failedCount },
    { icon: "stack", label: "Liczba backupów", value: jobs.length, hint: "Wszystkie lokalizacje" },
    { icon: "chart", label: "Łączny rozmiar backupów", value: bytes(totalSize), hint: jobs.length ? `Średnio ${bytes(totalSize / jobs.length)} / backup` : "Brak danych" },
    { icon: "shield", label: "Bezpieczeństwo", value: settings?.encryption_enabled === false ? "Standardowe" : "Aktywne", hint: "Szyfrowanie AES-256" }
  ], [jobs, lastBackup, totalSize, failedCount, settings]);

  const saveSettings = async () => {
    setSaving("settings");
    try {
      await backups.updateSettings({
        enabled: settings.enabled,
        frequency: settings.frequency,
        timeOfDay: settings.time_of_day,
        retentionCount: settings.retention_count,
        includeDatabase: settings.include_database,
        includeUploads: settings.include_uploads,
        includePdf: settings.include_pdf,
        includeConfig: settings.include_config,
        encryptionEnabled: settings.encryption_enabled
      });
      setMessage("Ustawienia backupów zostały zapisane.");
      await loadData();
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać ustawień.");
    } finally {
      setSaving("");
    }
  };

  const runBackup = async () => {
    setSaving("backup");
    try {
      await backups.create();
      setMessage("Backup został uruchomiony w tle.");
      await loadData();
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się uruchomić backupu.");
    } finally {
      setSaving("");
    }
  };

  const saveLocation = async () => {
    setSaving("location");
    try {
      if (editingLocation) await backups.updateLocation(editingLocation.id, locationForm);
      else await backups.createLocation(locationForm);
      setLocationForm(emptyLocation);
      setEditingLocation(null);
      setShowLocationForm(false);
      setMessage("Lokalizacja backupu została zapisana.");
      await loadData();
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać lokalizacji.");
    } finally {
      setSaving("");
    }
  };

  const chooseLocationPath = async () => {
    setSaving("folder-picker");
    try {
      const response = await backups.pickLocationFolder();
      if (response.data?.cancelled) {
        setMessage("Wybór folderu został anulowany.");
      } else if (response.data?.path) {
        setLocationForm((current) => ({ ...current, path: response.data.path }));
        setMessage("");
      }
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się otworzyć okna wyboru folderu.");
    } finally {
      setSaving("");
    }
  };

  const selectImportFile = (file) => {
    if (!file) return;
    setSelectedImportFile(file);
    setMessage("");
  };

  const uploadBackup = async (file = selectedImportFile) => {
    if (!file) return;
    setSaving("import");
    try {
      await backups.importBackup(file, importOptions);
      setSelectedImportFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setMessage("Backup został zaimportowany.");
      await loadData();
    } catch (error) {
      setMessage(error.response?.data?.error || "Import backupu nie powiódł się.");
    } finally {
      setSaving("");
    }
  };

  const downloadBackup = async (job) => {
    setSaving(`download-${job.id}`);
    try {
      const response = await backups.download(job.id);
      const url = URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = job.file_name || `backup-${job.id}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się pobrać backupu.");
    } finally {
      setSaving("");
    }
  };

  const runJobAction = async (job, action) => {
    setSaving(`${action}-${job.id}`);
    try {
      if (action === "integrity") await backups.integrity(job.id);
      if (action === "test") await backups.testRestore(job.id);
      setMessage(action === "integrity" ? "Integrity Check zakończony." : "Test Restore zakończony.");
      await loadData();
    } catch (error) {
      setMessage(error.response?.data?.error || "Operacja nie powiodła się.");
      await loadData();
    } finally {
      setSaving("");
    }
  };

  const runAllJobAction = async (action) => {
    const runnableJobs = jobs.filter((job) => job.id);
    if (!runnableJobs.length) return;
    setSaving(action === "integrity" ? "integrity-all" : "test-all");
    try {
      for (const job of runnableJobs) {
        if (action === "integrity") await backups.integrity(job.id);
        if (action === "test") await backups.testRestore(job.id);
      }
      setMessage(action === "integrity" ? "Sprawdzono integralność backupów." : "Test Restore backupów zakończony.");
      await loadData();
    } catch (error) {
      setMessage(error.response?.data?.error || "Operacja nie powiodła się.");
      await loadData();
    } finally {
      setSaving("");
    }
  };

  const testAllLocations = async () => {
    if (!locations.length) return;
    setSaving("locations-test");
    try {
      for (const location of locations) {
        await backups.testLocation(location.id);
      }
      setMessage("Lokalizacje backupów zostały przetestowane.");
      await loadData();
    } catch (error) {
      setMessage(error.response?.data?.error || "Test lokalizacji nie powiódł się.");
      await loadData();
    } finally {
      setSaving("");
    }
  };

  const submitRestore = async () => {
    if (!restoreJob) return;
    setSaving("restore");
    try {
      if (forceRestore) {
        await backups.forceRestore(restoreJob.id, restoreForm);
      } else {
        await backups.restore(restoreJob.id, restoreForm);
      }
      setMessage("Operacja przywracania została przyjęta.");
      setRestoreJob(null);
      setRestoreForm({ confirmation: "", password: "", riskAccepted: false });
      await loadData();
    } catch (error) {
      setMessage(error.response?.data?.error || "Przywracanie nie powiodło się.");
    } finally {
      setSaving("");
    }
  };

  const deleteSelectedJob = async () => {
    if (!deleteJob) return;
    setSaving("delete");
    try {
      const deletedJobId = deleteJob.id;
      await backups.delete(deletedJobId);
      setJobs((current) => current.filter((job) => job.id !== deletedJobId));
      setMessage("Backup został usunięty.");
      setDeleteJob(null);
      backups.audit().then((response) => setAudit(response.data || [])).catch(() => {});
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się usunąć backupu.");
    } finally {
      setSaving("");
    }
  };

  if (loading) return <div className="page backup-page"><AppState variant="loading" title="Ladowanie backupow" description="Pobieramy konfiguracje, historie kopii i lokalizacje." /></div>;
  if (!settings) return <div className="page backup-page"><AppState variant="error" title="Nie mozna pobrac modulu backupu" description={message || "Brak danych konfiguracyjnych backupu."} actionLabel="Sprobuj ponownie" onAction={loadData} /></div>;

  return (
    <div className="page backup-page">
      <header className="backup-topbar">
        <div>
          <div className="backup-breadcrumb">Ustawienia <span>›</span> Backup systemu</div>
          <h1>Backup systemu</h1>
        </div>
      </header>

      {message && <div className="settings-message">{message}</div>}

      <section className="backup-stats">
        {stats.map((card) => (
          <article className="backup-stat-card" key={card.label}>
            <span className={`backup-stat-icon ${card.good ? "good" : ""}`}><BackupIcon type={card.icon} /></span>
            <div>
              <p>{card.label}</p>
              <strong>{card.value}</strong>
              <small>{card.hint}</small>
            </div>
          </article>
        ))}
      </section>

      <div className="backup-actions-bar">
        <nav className="backup-tabs">
          {tabs.map((tab) => (
            <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)} type="button">
              {tab.label}
            </button>
          ))}
        </nav>
        <div>
          <button className="backup-primary" onClick={runBackup} disabled={saving === "backup"}><BackupIcon type="plus" />Wykonaj backup teraz</button>
          <button className="backup-secondary" onClick={() => fileRef.current?.click()}><BackupIcon type="upload" />Importuj backup</button>
        </div>
      </div>

      <main className={`backup-layout backup-tab-${activeTab}`}>
        <div className="backup-main">
          {activeTab === "schedule" && (
            <section className="backup-card backup-settings-card">
              <h2>Ustawienia backupów</h2>
              <div className="backup-switch-row">
                <span>Automatyczne backupy</span>
                <button className={settings.enabled ? "switch active" : "switch"} onClick={() => setSettings((current) => ({ ...current, enabled: !current.enabled }))} type="button"><span /></button>
              </div>
              <div className="backup-settings-grid">
                <label>Częstotliwość<select value={settings.frequency} onChange={(event) => setSettings((current) => ({ ...current, frequency: event.target.value }))}><option value="DAILY">Codziennie</option><option value="EVERY_7_DAYS">Co 7 dni</option><option value="MONTHLY">Miesięcznie</option></select></label>
                <label>Godzina backupu<input type="time" value={settings.time_of_day} onChange={(event) => setSettings((current) => ({ ...current, time_of_day: event.target.value }))} /></label>
                <label>Retencja<input type="number" min="1" value={settings.retention_count} onChange={(event) => setSettings((current) => ({ ...current, retention_count: event.target.value }))} /></label>
              </div>
              <div className="backup-check-grid">
                {[
                  ["include_database", "Baza danych (PostgreSQL)"],
                  ["include_uploads", "Uploads i załączniki"],
                  ["include_pdf", "Wygenerowane PDF"],
                  ["include_config", "Konfiguracja systemu"]
                ].map(([key, label]) => (
                  <BarrierCheckbox key={key} className="backup-check-item" checked={settings[key] !== false} onChange={(value) => setSettings((current) => ({ ...current, [key]: value }))} label={label} />
                ))}
              </div>
              <button className="backup-primary small" onClick={saveSettings} disabled={saving === "settings"}>Zapisz ustawienia</button>
            </section>
          )}

          {activeTab === "locations" && (
            <section className="backup-card backup-locations-card">
              <div className="backup-card-header">
                <h2>Lokalizacje backupów</h2>
              </div>
              <div className="backup-card-location-action">
                <button type="button" className="backup-card-action" onClick={() => {
                  setEditingLocation(null);
                  setLocationForm(emptyLocation);
                  setShowLocationForm((current) => !current);
                }}>
                  <BackupIcon type="plus" />
                  Dodaj lokalizację
                </button>
              </div>
              {(showLocationForm || editingLocation || activeTab === "locations") && <div className="backup-location-form">
                <input placeholder="Nazwa lokalizacji" value={locationForm.name} onChange={(event) => setLocationForm((current) => ({ ...current, name: event.target.value }))} />
                <select value={locationForm.type} onChange={(event) => setLocationForm((current) => ({ ...current, type: event.target.value }))}><option value="LOCAL_FOLDER">Folder lokalny</option><option value="NETWORK_FOLDER">Folder sieciowy</option></select>
                <div className="backup-path-picker"><input placeholder="D:\\Prestige Backups" value={locationForm.path} onChange={(event) => setLocationForm((current) => ({ ...current, path: event.target.value }))} /><button type="button" className="backup-folder-picker" title="Wybierz folder" aria-label="Wybierz folder" onClick={chooseLocationPath} disabled={saving === "folder-picker"}><BackupIcon type="folder" /></button></div>
                <BarrierCheckbox className="backup-location-default" checked={locationForm.isDefault} onChange={(value) => setLocationForm((current) => ({ ...current, isDefault: value }))} label="Domyślna" />
                <button className="backup-secondary backup-location-save" onClick={saveLocation} disabled={saving === "location"}>{editingLocation ? "Zapisz" : "Dodaj lokalizację"}</button>
              </div>}
              <div className="backup-table-shell">
                <table className="backup-table">
                  <thead><tr><th>Nazwa</th><th>Typ</th><th>Ścieżka</th><th>Status</th><th>Wolne miejsce</th><th>Domyślna</th><th>Akcje</th></tr></thead>
                  <tbody>
                    {locations.map((location) => (
                      <tr key={location.id}>
                        <td><strong>{location.name}</strong></td>
                        <td>{location.type === "NETWORK_FOLDER" ? "Folder sieciowy" : "Folder lokalny"}</td>
                        <td><span className="backup-location-path">{location.path}</span></td>
                        <td><Badge value={location.status} /></td>
                        <td>{bytes(location.free_space_bytes)}</td>
                        <td>{location.is_default ? "★" : "-"}</td>
                        <td>
                          <div className="backup-row-actions">
                            <button title="Testuj" onClick={() => backups.testLocation(location.id).then(loadData).catch((error) => setMessage(error.response?.data?.error || "Test lokalizacji nie powiódł się."))}><BackupIcon type="shield" /></button>
                            <button title="Edytuj" onClick={() => { setEditingLocation(location); setShowLocationForm(true); setLocationForm({ name: location.name, type: location.type, path: location.path, isDefault: location.is_default }); }}><BackupIcon type="edit" /></button>
                            <button title="Usuń" disabled={location.is_default} onClick={() => backups.deleteLocation(location.id).then(loadData).catch((error) => setMessage(error.response?.data?.error || "Nie udało się usunąć lokalizacji."))}><BackupIcon type="trash" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="backup-secondary backup-test-locations" type="button" onClick={testAllLocations} disabled={saving === "locations-test"}><BackupIcon type="shield" />Przetestuj wszystkie lokalizacje</button>
              <footer className="backup-history-footer">
                <span>Wyświetlanie 1-{Math.min(jobs.length, 5)} z {jobs.length} backupów</span>
                <div className="backup-pagination">
                  <button type="button" disabled>‹</button>
                  <button type="button" className="active">1</button>
                  <button type="button">2</button>
                  <button type="button">3</button>
                  <button type="button">...</button>
                  <button type="button">›</button>
                </div>
                <div className="backup-legend">
                  <span><i className="green" />Zakończony</span>
                  <span><i className="yellow" />W toku</span>
                  <span><i className="red" />Błąd</span>
                  <span><i className="gray" />Oczekujący</span>
                </div>
              </footer>
            </section>
          )}

          {(activeTab === "history" || activeTab === "import") && (
            <section className="backup-card backup-history-card">
              <h2>Historia backupów</h2>
              <div className="backup-table-shell">
                <table className="backup-table">
                  <thead><tr><th>Data</th><th>Typ</th><th>Status</th><th>Integrity</th><th>Test Restore</th><th>Rozmiar</th><th>Lokalizacja</th><th>Admin</th><th>Akcje</th></tr></thead>
                  <tbody>
                    {visibleJobs.map((job) => {
                      const fileReady = hasBackupFile(job);
                      return (
                      <tr key={job.id} className={!fileReady ? "backup-row-missing-file" : undefined}>
                        <td>{formatDate(job.created_at)}</td>
                        <td>{statusLabel(job.type)}</td>
                        <td><Badge value={job.status} /></td>
                        <td><Badge value={job.integrity_status} type="integrity" /></td>
                        <td><Badge value={job.test_restore_status} type="restore" /></td>
                        <td className={!fileReady ? "backup-size-missing" : undefined}>{backupSizeLabel(job)}</td>
                        <td>{job.location_name || "-"}</td>
                        <td>{adminName(job)}</td>
                        <td>
                          <div className="backup-row-actions">
                            <button title={fileReady ? "Pobierz" : "Brak pliku backupu"} disabled={!fileReady} onClick={() => downloadBackup(job)}><BackupIcon type="download" /></button>
                            <button title={fileReady ? "Integrity Check" : "Brak pliku backupu"} disabled={!fileReady} onClick={() => runJobAction(job, "integrity")}><BackupIcon type="shield" /></button>
                            <button title={fileReady ? "Test Restore" : "Brak pliku backupu"} disabled={!fileReady} onClick={() => runJobAction(job, "test")}><BackupIcon type="check" /></button>
                            <button title={fileReady ? "Restore" : "Brak pliku backupu"} disabled={!fileReady} onClick={() => { setRestoreJob(job); setForceRestore(job.integrity_status === "FAILED"); }}><BackupIcon type="restore" /></button>
                            <button title="Usuń" onClick={() => setDeleteJob(job)}><BackupIcon type="trash" /></button>
                          </div>
                        </td>
                      </tr>
                    )})}
                    {!jobs.length && <tr><td colSpan="9">Brak backupów.</td></tr>}
                  </tbody>
                </table>
              </div>
              <footer className="backup-history-footer">
                <span>Wyświetlanie {jobs.length ? historyStart + 1 : 0}-{historyEnd} z {jobs.length} backupów</span>
                <div className="backup-pagination">
                  <button type="button" disabled={currentHistoryPage === 1} onClick={() => setHistoryPage((current) => Math.max(current - 1, 1))}>&lt;</button>
                  {Array.from({ length: historyPageCount }, (_, index) => index + 1).map((page) => (
                    <button type="button" key={page} className={page === currentHistoryPage ? "active" : ""} onClick={() => setHistoryPage(page)}>{page}</button>
                  ))}
                  <button type="button" disabled={currentHistoryPage === historyPageCount} onClick={() => setHistoryPage((current) => Math.min(current + 1, historyPageCount))}>&gt;</button>
                </div>
                <div className="backup-legend">
                  <span><i className="green" />Zakończony</span>
                  <span><i className="yellow" />W toku</span>
                  <span><i className="red" />Błąd</span>
                  <span><i className="gray" />Oczekujacy</span>
                </div>
              </footer>
            </section>
          )}

          {activeTab === "audit" && (
            <section className="backup-card backup-history-card">
              <h2>Audit Log</h2>
              <div className="backup-table-shell">
                <table className="backup-table">
                  <thead><tr><th>Data</th><th>Akcja</th><th>Status</th><th>Administrator</th><th>IP</th><th>Komunikat</th></tr></thead>
                  <tbody>
                    {audit.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDate(row.created_at)}</td>
                        <td>{row.action}</td>
                        <td><Badge value={row.status} /></td>
                        <td>{adminName(row)}</td>
                        <td>{row.ip_address || "-"}</td>
                        <td>{row.message || "-"}</td>
                      </tr>
                    ))}
                    {!audit.length && <tr><td colSpan="6">Brak wpisów audytu.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {(activeTab === "overview" || activeTab === "history" || activeTab === "import") && (
            <section className="backup-restore-section backup-restore-inline">
              <header><BackupIcon type="restore" /><h2>Przywracanie systemu</h2></header>
              <div className="backup-restore-grid">
                <article>
                  <h3>Przywroc z dostepnego backupu</h3>
                  <p>Wybierz backup z listy i przywroc system do wybranego stanu.</p>
                  <button className="backup-secondary" onClick={() => { setRestoreJob(jobs[0] || null); setForceRestore(jobs[0]?.integrity_status === "FAILED"); }}>Wybierz backup do przywrócenia</button>
                </article>
                <article
                  className={`backup-import-card ${dragging ? "dragging" : ""}`}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    selectImportFile(event.dataTransfer.files?.[0]);
                  }}
                >
                  <h3>Import backupu</h3>
                  <p>Przeciagnij plik backupu tutaj lub wybierz go z dysku.</p>
                  <button className="backup-secondary" onClick={() => fileRef.current?.click()}>Wybierz plik</button>
                  <div className="backup-dropzone">
                    <span><BackupIcon type="upload" /></span>
                    <strong>Przeciagnij plik backupu tutaj</strong>
                    <small>lub</small>
                    <button className="backup-secondary" onClick={() => fileRef.current?.click()}>Wybierz plik</button>
                    <em>Obslugiwane formaty: .backup, .zip, .tar.gz<br />Maksymalny rozmiar pliku: 100 GB</em>
                  </div>
                  {selectedImportFile && <div className="backup-selected-file"><BackupIcon type="folder" /><span>{selectedImportFile.name}</span><small>{bytes(selectedImportFile.size)}</small></div>}
                  <button className="backup-primary backup-import-confirm" onClick={() => uploadBackup()} disabled={!selectedImportFile || saving === "import"}>Importuj backup</button>
                  <BarrierCheckbox checked={importOptions.integrity} onChange={(value) => setImportOptions((current) => ({ ...current, integrity: value }))} label="Wykonaj Integrity Check" />
                  <BarrierCheckbox checked={importOptions.testRestore} onChange={(value) => setImportOptions((current) => ({ ...current, testRestore: value }))} label="Wykonaj Test Restore po imporcie" />
                </article>
                <article>
                  <h3>Informacje</h3>
                  <p>Przed przywroceniem system automatycznie utworzy backup biezacego stanu.</p>
                  <p>Przywracanie moze potrwac kilka minut.</p>
                  <p>Po zakonczeniu operacji uzytkownicy moga zostac wylogowani.</p>
                  <p>Wszystkie operacje sa zapisywane w Audit Log.</p>
                </article>
              </div>
            </section>
          )}
        </div>

        <aside className="backup-sidebar">
          <section className="backup-card backup-quick-card">
            <h2>Szybkie akcje</h2>
            <div className="backup-quick-actions-new">
              <button onClick={() => runAllJobAction("integrity")} disabled={saving === "integrity-all"}><BackupIcon type="shield" />Sprawdź integralność wszystkich backupów <BackupIcon type="arrow" /></button>
              <button onClick={() => runAllJobAction("test")} disabled={saving === "test-all"}><BackupIcon type="check" />Test Restore wszystkich backupów <BackupIcon type="arrow" /></button>
              <button onClick={() => setActiveTab("locations")}><BackupIcon type="folder" />Przeglądaj lokalizacje backupów <BackupIcon type="arrow" /></button>
              <button onClick={() => setActiveTab("audit")}><BackupIcon type="info" />Zobacz dziennik aktywnosci <BackupIcon type="arrow" /></button>
            </div>
            <button onClick={() => jobs[0] && runJobAction(jobs[0], "integrity")}><BackupIcon type="shield" />Sprawdź integralność najnowszego backupu</button>
            <button onClick={() => jobs[0] && runJobAction(jobs[0], "test")}><BackupIcon type="check" />Test Restore najnowszego backupu</button>
            <button onClick={() => setActiveTab("locations")}><BackupIcon type="folder" />Przeglądaj lokalizacje backupów</button>
            <button onClick={() => setActiveTab("audit")}><BackupIcon type="info" />Zobacz dziennik aktywności</button>
          </section>

          <section className="backup-card backup-integrity-card">
            <h2>Integralność backupów</h2>
            <div className="backup-integrity-body">
              <span className="backup-integrity-mark"><BackupIcon type="check" /></span>
              <div>
                <strong>{verifiedCount === jobs.length ? "Wszystkie backupy sa poprawne" : "Wymagana weryfikacja"}</strong>
                <p>{verifiedCount} z {jobs.length} backupów jest zweryfikowanych</p>
              </div>
            </div>
            <button type="button" onClick={() => runAllJobAction("integrity")} disabled={saving === "integrity-all"}><BackupIcon type="arrow" />Sprawdź integralność wszystkich</button>
          </section>

          <section className="backup-card backup-ring-card">
            <h2>Test Restore</h2>
            <strong className="backup-total">Łącznie: {jobs.length}</strong>
            <button type="button" onClick={() => runAllJobAction("test")} disabled={saving === "test-all"}>Testuj wszystkie backupy</button>
            <div className="backup-ring-layout">
              <div className="backup-ring" style={restoreRingStyle}><strong>{testedCount}</strong></div>
              <div className="backup-ring-legend">
                <p><i className="green" />Zweryfikowane <b>{testedCount}</b></p>
                <p><i className="yellow" />Nie testowano <b>{untestedCount}</b></p>
                <p><i className="red" />Nieudane <b>{failedCount}</b></p>
              </div>
            </div>
            <p><b>{verifiedCount}</b> integralnych z {jobs.length} backupów</p>
            <p><b>{failedCount}</b> wymagających uwagi</p>
          </section>

          <section className="backup-card backup-activity-card">
            <h2>Ostatnia aktywnosc</h2>
            <div className="backup-activity-list">
              {latestActivity.map((row) => (
                <article key={row.id}>
                  <span className={row.status === "ERROR" || row.status === "FAILED" ? "error" : "success"}><BackupIcon type={row.status === "ERROR" || row.status === "FAILED" ? "info" : "check"} /></span>
                  <div>
                    <strong>{row.action || "Operacja backupu"}</strong>
                    <small>{row.message || "Zapisano zdarzenie systemowe"}</small>
                  </div>
                  <time>{formatDate(row.created_at)}</time>
                </article>
              ))}
              {!latestActivity.length && <p className="backup-empty">Brak ostatniej aktywnosci.</p>}
            </div>
            <button type="button" onClick={() => setActiveTab("audit")}>Zobacz pelny dziennik aktywnosci</button>
          </section>
        </aside>
      </main>

      <section className="backup-restore-section backup-restore-section-legacy">
        <header><BackupIcon type="restore" /><h2>Przywracanie systemu</h2></header>
        <div className="backup-restore-grid">
          <article>
            <h3>Przywróć z dostępnego backupu</h3>
            <p>Wybierz backup z listy i przywróć system do wybranego stanu.</p>
            <button className="backup-secondary" onClick={() => { setRestoreJob(jobs[0] || null); setForceRestore(jobs[0]?.integrity_status === "FAILED"); }}>Wybierz backup do przywrócenia</button>
          </article>
          <article
            className={`backup-import-card ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              selectImportFile(event.dataTransfer.files?.[0]);
            }}
          >
            <h3>Import backupu</h3>
            <p>Przeciągnij plik backupu tutaj lub wybierz go z dysku.</p>
            <button className="backup-secondary" onClick={() => fileRef.current?.click()}>Wybierz plik</button>
            <div className="backup-dropzone">
              <span><BackupIcon type="upload" /></span>
              <strong>Przeciagnij plik backupu tutaj</strong>
              <small>lub</small>
              <button className="backup-secondary" onClick={() => fileRef.current?.click()}>Wybierz plik</button>
              <em>Obslugiwane formaty: .backup, .zip, .tar.gz<br />Maksymalny rozmiar pliku: 100 GB</em>
            </div>
            {selectedImportFile && <div className="backup-selected-file"><BackupIcon type="folder" /><span>{selectedImportFile.name}</span><small>{bytes(selectedImportFile.size)}</small></div>}
            <button className="backup-primary backup-import-confirm" onClick={() => uploadBackup()} disabled={!selectedImportFile || saving === "import"}>Importuj backup</button>
            <BarrierCheckbox checked={importOptions.integrity} onChange={(value) => setImportOptions((current) => ({ ...current, integrity: value }))} label="Wykonaj Integrity Check" />
            <BarrierCheckbox checked={importOptions.testRestore} onChange={(value) => setImportOptions((current) => ({ ...current, testRestore: value }))} label="Wykonaj Test Restore po imporcie" />
          </article>
          <article>
            <h3>Informacje</h3>
            <p>Przed przywróceniem system automatycznie utworzy backup bieżącego stanu.</p>
            <p>Przywracanie może potrwać kilka minut.</p>
            <p>Po zakończeniu operacji użytkownicy mogą zostać wylogowani.</p>
            <p>Wszystkie operacje są zapisywane w Audit Log.</p>
          </article>
        </div>
      </section>

      <input ref={fileRef} type="file" hidden accept=".backup,.zip,.tar.gz" onChange={(event) => selectImportFile(event.target.files?.[0])} />

      <ConfirmationModal isOpen={!!deleteJob} onClose={() => setDeleteJob(null)} onConfirm={deleteSelectedJob} title="Usuń backup" confirmText="Usuń">
        <p>Czy na pewno chcesz usunąć backup <strong>{deleteJob?.file_name || deleteJob?.id}</strong>?</p>
      </ConfirmationModal>

      <ConfirmationModal isOpen={!!restoreJob} onClose={() => setRestoreJob(null)} onConfirm={submitRestore} title={forceRestore ? "Wymuś przywrócenie backupu" : "Przywróć backup"} confirmText={saving === "restore" ? "Przywracanie..." : forceRestore ? "Wymuś przywrócenie" : "Przywróć"}>
        <div className="backup-restore-modal">
          <p>{forceRestore ? "Ten backup ma błąd integralności. Wymuszone przywrócenie jest ryzykowne." : "Ta operacja wymaga ponownego hasła administratora."}</p>
          <label>Fraza potwierdzająca<input value={restoreForm.confirmation} onChange={(event) => setRestoreForm((current) => ({ ...current, confirmation: event.target.value }))} placeholder={forceRestore ? "WYMUSZ PRZYWRÓCENIE" : "PRZYWRÓĆ BACKUP"} /></label>
          <label>Hasło administratora<input type="password" value={restoreForm.password} onChange={(event) => setRestoreForm((current) => ({ ...current, password: event.target.value }))} /></label>
          {forceRestore && <BarrierCheckbox className="risk" checked={restoreForm.riskAccepted} onChange={(value) => setRestoreForm((current) => ({ ...current, riskAccepted: value }))} label="Rozumiem ryzyko przywrócenia uszkodzonego backupu." />}
        </div>
      </ConfirmationModal>
    </div>
  );
}
