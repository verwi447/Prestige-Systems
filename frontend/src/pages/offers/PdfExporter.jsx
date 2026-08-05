export default function PdfExporter({ disabled, onExport }) {
  return (
    <button type="button" className="export-button" disabled={disabled} onClick={onExport}>
      Eksportuj PDF
    </button>
  );
}
