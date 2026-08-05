import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Mail, Send, X } from "lucide-react";
import { email as emailAPI } from "../../api";

const stripHtml = (value = "") => String(value).replace(/<[^>]*>?/gm, "");

export default function SendOfferEmailModal({ isOpen, offer, onClose, onSent }) {
  const defaultRecipient = offer?.client_email || offer?.customer_email || "";
  const clientName = offer?.client_company_name || offer?.company_name || offer?.customer_name || "Kliencie";
  const offerNumber = offer?.offer_number || `#${offer?.id || ""}`;
  const defaultSubject = `Oferta handlowa ${offerNumber}`;
  const defaultHtml = useMemo(
    () =>
      `<p>Dzień dobry,</p>
<p>w załączniku przesyłamy ofertę handlową <strong>${offerNumber}</strong>.</p>
<p>W razie pytań pozostajemy do dyspozycji.</p>
<p>Pozdrawiamy,<br />Prestige Systems</p>`,
    [offerNumber]
  );

  const [form, setForm] = useState({
    to: "",
    cc: "",
    subject: "",
    html: "",
    attachPdf: true
  });
  const [error, setError] = useState("");
  const [needsSmtpConfig, setNeedsSmtpConfig] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm({
      to: defaultRecipient,
      cc: "",
      subject: defaultSubject,
      html: defaultHtml,
      attachPdf: true
    });
    setError("");
    setNeedsSmtpConfig(false);
    setSending(false);
  }, [defaultHtml, defaultRecipient, defaultSubject, isOpen]);

  if (!isOpen) return null;

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.to.trim()) {
      setError("Podaj adres odbiorcy.");
      return;
    }

    try {
      setSending(true);
      setError("");
      setNeedsSmtpConfig(false);
      const response = await emailAPI.sendOffer(offer.id, {
        ...form,
        text: stripHtml(form.html)
      });
      onSent?.(response.data.offer);
      onClose();
    } catch (err) {
      const backendError = err.response?.data?.error || "";
      const smtpError = backendError.includes("SMTP");
      setNeedsSmtpConfig(smtpError);
      setError(
        smtpError
          ? "SMTP nie jest skonfigurowany. Uzupełnij dane w Ustawieniach -> Poczta, zapisz je i wykonaj test połączenia."
          : backendError || "Nie udało się wysłać oferty."
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="email-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="email-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header className="email-modal-header">
          <div>
            <span className="email-modal-icon"><Mail size={18} /></span>
            <div>
              <h2>Wyślij ofertę e-mailem</h2>
              <p>{clientName} · {offerNumber}</p>
            </div>
          </div>
          <button type="button" className="email-modal-close" onClick={onClose} aria-label="Zamknij">
            <X size={18} />
          </button>
        </header>

        <div className="email-modal-grid">
          <label>
            <span>Do</span>
            <input value={form.to} onChange={(event) => update("to", event.target.value)} placeholder="klient@firma.pl" />
          </label>
          <label>
            <span>DW</span>
            <input value={form.cc} onChange={(event) => update("cc", event.target.value)} placeholder="opcjonalnie" />
          </label>
        </div>

        <label className="email-modal-field">
          <span>Temat</span>
          <input value={form.subject} onChange={(event) => update("subject", event.target.value)} />
        </label>

        <label className="email-modal-field">
          <span>Treść wiadomości</span>
          <textarea value={form.html} onChange={(event) => update("html", event.target.value)} />
        </label>

        <label className="email-modal-check">
          <input
            type="checkbox"
            checked={form.attachPdf}
            onChange={(event) => update("attachPdf", event.target.checked)}
          />
          <FileText size={17} />
          <span>Dołącz aktualny PDF oferty</span>
        </label>

        {error && (
          <div className="email-modal-error">
            <span>{error}</span>
            {needsSmtpConfig && <a href="/settings/email">Otwórz ustawienia poczty</a>}
          </div>
        )}

        <footer className="email-modal-actions">
          <button type="button" onClick={onClose} disabled={sending}>Anuluj</button>
          <button type="submit" className="primary" disabled={sending}>
            {sending ? <Loader2 size={17} className="spin" /> : <Send size={17} />}
            Wyślij
          </button>
        </footer>
      </form>
    </div>
  );
}
