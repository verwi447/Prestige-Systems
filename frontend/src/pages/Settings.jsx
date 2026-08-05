import { useEffect, useMemo, useState } from "react";
import { api, companies } from "../api";
import AppState from "../components/AppState";
import "./Settings.css";

const emptyOwnCompany = {
  logoUrl: "",
  name: "",
  nip: "",
  regon: "",
  address: "",
  email: "",
  phone: "",
  website: "",
  additionalInfo: ""
};

const normalizeOwnCompany = (data = {}) => ({
  ...emptyOwnCompany,
  ...data,
  logoUrl: data.logoUrl || data.logo_url || "",
  additionalInfo: data.additionalInfo || data.additional_info || ""
});

const getOfferFooterLines = (company = {}) => [
  company.nip ? `NIP: ${company.nip}` : "",
  company.address || "",
  [company.phone ? `tel.: ${company.phone}` : "", company.email || ""].filter(Boolean).join(" | ")
].filter(Boolean);

const getCompanyInitials = (name = "") =>
  String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "PS";

function SettingsIcon({ type }) {
  const paths = {
    building: (
      <>
        <path d="M5 20V4h10v16M15 9h4v11" />
        <path d="M8 7h4M8 10.5h4M8 14h4M8 17.5h4" />
      </>
    ),
    upload: (
      <>
        <path d="M12 15V5" />
        <path d="m8 9 4-4 4 4" />
        <path d="M5 16.5a4 4 0 0 0 2.8 6.5h8.4A4 4 0 0 0 19 15.6 6.5 6.5 0 0 0 6.7 13" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16" />
        <path d="M10 11v6M14 11v6" />
        <path d="M6 7l1 13h10l1-13" />
        <path d="M9 7V4h6v3" />
      </>
    ),
    save: (
      <>
        <path d="M5 4h12l2 2v14H5z" />
        <path d="M8 4v6h8V4M8 20v-6h8v6" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12.5 2.2 2.2 4.8-5" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 11v5M12 8h.01" />
      </>
    )
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[type]}
    </svg>
  );
}

export default function Settings() {
  const [ownCompany, setOwnCompany] = useState(emptyOwnCompany);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [localLogoPreview, setLocalLogoPreview] = useState("");

  const logoPreview = useMemo(() => {
    if (localLogoPreview) return localLogoPreview;
    if (!ownCompany.logoUrl) return "";
    if (/^https?:\/\//i.test(ownCompany.logoUrl)) return ownCompany.logoUrl;
    return `${api.defaults.baseURL}${ownCompany.logoUrl}`;
  }, [localLogoPreview, ownCompany.logoUrl]);

  const footerLines = getOfferFooterLines(ownCompany);

  const loadOwnCompany = async () => {
    const response = await companies.getOwnCompany();
    setOwnCompany(normalizeOwnCompany(response.data));
  };

  useEffect(() => {
    loadOwnCompany()
      .catch((error) => setMessage(error.response?.data?.error || "Nie udało się pobrać danych naszej firmy."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return () => {
      if (localLogoPreview) URL.revokeObjectURL(localLogoPreview);
    };
  }, [localLogoPreview]);

  const updateField = (field, value) => {
    setOwnCompany((current) => ({ ...current, [field]: value }));
  };

  const validateLogo = (file) => {
    const allowed = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
    const allowedExtensions = [".png", ".jpg", ".jpeg", ".svg", ".webp"];
    const lowerName = file.name?.toLowerCase() || "";
    const hasAllowedExtension = allowedExtensions.some((extension) => lowerName.endsWith(extension));
    if (!allowed.includes(file.type) && !hasAllowedExtension) return "Logo musi być plikiem PNG, JPG, SVG albo WEBP.";
    if (file.size > 5 * 1024 * 1024) return "Logo może mieć maksymalnie 5 MB.";
    return "";
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    const validation = validateLogo(file);
    if (validation) {
      setMessage(validation);
      return;
    }

    const nextPreview = URL.createObjectURL(file);
    setUploading(true);
    setMessage("");
    setLocalLogoPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return nextPreview;
    });
    try {
      const response = await companies.uploadOwnCompanyLogo(file);
      updateField("logoUrl", response.data.logoUrl);
      setMessage("Logo zostało dodane.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się wysłać logo.");
    } finally {
      setUploading(false);
    }
  };

  const saveOwnCompany = async () => {
    if (!ownCompany.name.trim()) return setMessage("Nazwa firmy jest wymagana.");
    if (!ownCompany.nip.trim()) return setMessage("NIP jest wymagany.");
    if (!ownCompany.address.trim()) return setMessage("Adres jest wymagany.");
    if (!ownCompany.email.trim()) return setMessage("E-mail jest wymagany.");

    setSaving(true);
    setMessage("");
    try {
      const response = await companies.updateOwnCompany({
        logoUrl: ownCompany.logoUrl,
        name: ownCompany.name,
        nip: ownCompany.nip,
        regon: ownCompany.regon,
        address: ownCompany.address,
        email: ownCompany.email,
        phone: ownCompany.phone,
        website: ownCompany.website,
        additionalInfo: ownCompany.additionalInfo
      });
      setOwnCompany(normalizeOwnCompany(response.data));
      setMessage("Dane naszej firmy zostały zapisane.");
      await loadOwnCompany();
    } catch (error) {
      setMessage(error.response?.data?.error || "Nie udało się zapisać danych naszej firmy.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="page"><AppState variant="loading" title="Ladowanie ustawien firmy" description="Pobieramy dane wykorzystywane w dokumentach i systemie." /></div>;
  }

  return (
    <div className="page own-company-page">
      <header className="own-company-header">
        <div>
          <div className="admin-breadcrumb">Ustawienia <span>›</span> Nasza firma</div>
          <h1>Nasza firma</h1>
          <p>Zarządzaj danymi swojej firmy widocznymi na ofertach PDF i w systemie.</p>
        </div>
      </header>

      {message && <div className="settings-message">{message}</div>}

      <div className="own-company-grid">
        <section className="own-company-card own-company-data-card">
          <div className="own-company-card-title">
            <span><SettingsIcon type="building" /></span>
            <div>
              <h2>Dane stopki ofert</h2>
              <p>Informacje drukowane w stopce ofert PDF i dokumentow.</p>
            </div>
          </div>

          <div className="own-company-form">
            <label className="own-company-logo-label">Logo firmy</label>
            <div
              className={`own-company-upload ${dragging ? "dragging" : ""} ${logoPreview ? "has-logo" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                uploadLogo(event.dataTransfer.files?.[0]);
              }}
            >
              <div className="own-company-upload-main">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo firmy" />
                ) : (
                  <span><SettingsIcon type="upload" /></span>
                )}
                <div>
                  <strong>{logoPreview ? "Logo jest dodane" : "Kliknij, aby dodać plik"}</strong>
                  <small>PNG, JPG, SVG, WEBP do 5 MB</small>
                </div>
              </div>
              <div className="own-company-upload-actions">
                <label className="own-company-file-button">
                  {uploading ? "Wysyłanie..." : logoPreview ? "Zmień logo" : "Wybierz plik"}
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp"
                    disabled={uploading}
                    onChange={(event) => {
                      uploadLogo(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
                {logoPreview && (
                  <button
                    type="button"
                    className="own-company-remove-logo"
                    onClick={() => {
                      setLocalLogoPreview((current) => {
                        if (current) URL.revokeObjectURL(current);
                        return "";
                      });
                      updateField("logoUrl", "");
                    }}
                  >
                    <SettingsIcon type="trash" />
                  </button>
                )}
              </div>
            </div>

            <div className="own-company-fields">
              <label>Nazwa firmy <span>*</span><input value={ownCompany.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Prestige Systems" /></label>
              <label>NIP <span>*</span><input value={ownCompany.nip} onChange={(event) => updateField("nip", event.target.value)} placeholder="123-456-78-90" /></label>
              <label>REGON<input value={ownCompany.regon} onChange={(event) => updateField("regon", event.target.value)} placeholder="123456789" /></label>
              <label>E-mail <span>*</span><input type="email" value={ownCompany.email} onChange={(event) => updateField("email", event.target.value)} placeholder="biuro@prestigesystems.pl" /></label>
              <label className="full">Adres <span>*</span><input value={ownCompany.address} onChange={(event) => updateField("address", event.target.value)} placeholder="ul. Przykładowa 123, 60-001 Poznań" /></label>
              <label>Telefon<input value={ownCompany.phone} onChange={(event) => updateField("phone", event.target.value)} placeholder="+48 123 456 789" /></label>
              <label>Strona internetowa<input value={ownCompany.website} onChange={(event) => updateField("website", event.target.value)} placeholder="https://prestigesystems.pl" /></label>
              <label className="full">Dodatkowe informacje <em>(opcjonalnie)</em><textarea value={ownCompany.additionalInfo} onChange={(event) => updateField("additionalInfo", event.target.value)} placeholder="Nowoczesne rozwiązania dla parkingów." /></label>
            </div>

          </div>
          <div className="own-company-actions">
            <button className="admin-submit-button" onClick={saveOwnCompany} disabled={saving || uploading}>
              <SettingsIcon type="save" />
              {saving ? "Zapisywanie..." : "Zapisz zmiany"}
            </button>
          </div>
        </section>

        <aside className="own-company-side">
          <section className="own-company-card own-company-footer-preview-card">
            <div className="own-company-card-title">
              <span><SettingsIcon type="building" /></span>
              <div>
                <h2>Podglad stopki oferty</h2>
                <p>Tak dane firmy pojawia sie na dole dokumentu PDF.</p>
              </div>
            </div>

            <div className="offer-footer-preview" aria-label="Podglad stopki oferty PDF">
              <div className="offer-footer-preview-document">
                <div className="offer-footer-preview-document-label">
                  <span>OFERTA HANDLOWA</span>
                  <small>fragment dokumentu PDF</small>
                </div>
                <div className="offer-footer-preview-rule" />
                <div className="offer-footer-preview-content">
                  <div className="offer-footer-preview-company">
                    {logoPreview ? (
                      <img src={logoPreview} alt="Logo firmy w stopce" />
                    ) : (
                      <span className="offer-footer-preview-monogram">{getCompanyInitials(ownCompany.name)}</span>
                    )}
                    <div>
                      <strong>{ownCompany.name || "Nazwa firmy"}</strong>
                      {footerLines.length > 0 ? (
                        footerLines.map((line) => <span key={line}>{line}</span>)
                      ) : (
                        <span>Uzupelnij dane firmy, aby pojawily sie w stopce.</span>
                      )}
                    </div>
                  </div>
                  <div className="offer-footer-preview-prepared">
                    <span>Oferte przygotowal</span>
                    <strong>Administrator</strong>
                    <span>tel.: -</span>
                    <span>e-mail: -</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="own-company-pdf-note">
              <SettingsIcon type="check" />
              <p>Po zapisie te dane sa automatycznie pobierane do stopki podczas generowania oferty PDF.</p>
            </div>
          </section>

          <section className="own-company-info-card">
            <SettingsIcon type="info" />
            <div>
              <strong>Informacja</strong>
              <p>Zmiana danych firmy odswieza stopke w podgladzie kreatora oraz przy kolejnym pobraniu PDF oferty.</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
