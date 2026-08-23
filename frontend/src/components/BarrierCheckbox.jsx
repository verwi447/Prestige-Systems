import BarrierIcon from "./BarrierIcon";
import "./BarrierCheckbox.css";

export default function BarrierCheckbox({ checked, onChange, label, description, className = "", title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`barrier-checkbox ${className}`.trim()}
      title={title}
      onClick={() => onChange(!checked)}
    >
      <BarrierIcon checked={checked} />
      {label ? (
        <span className="barrier-checkbox-label">
          {label}
          {description ? <small>{description}</small> : null}
        </span>
      ) : null}
    </button>
  );
}
