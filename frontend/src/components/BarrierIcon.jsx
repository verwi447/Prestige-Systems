import { useId } from "react";
import "./BarrierIcon.css";

export default function BarrierIcon({ checked }) {
  const uid = useId();
  const redId = `barrier-stripes-red-${uid}`;
  const greenId = `barrier-stripes-green-${uid}`;

  return (
    <span className={`barrier-icon ${checked ? "is-open" : "is-closed"}`} aria-hidden="true">
      <svg viewBox="0 0 40 40" className="barrier-icon-svg">
        <defs>
          <pattern id={redId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#ffffff" />
            <rect width="3" height="6" fill="#e2242f" />
          </pattern>
          <pattern id={greenId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#ffffff" />
            <rect width="3" height="6" fill="#16a94a" />
          </pattern>
        </defs>

        <rect className="barrier-post" x="25" y="20" width="13" height="18" rx="2.2" />
        <rect className="barrier-post-cap" x="23.5" y="17.5" width="16" height="4" rx="1.5" />
        <path className="barrier-bracket" d="M25 24 L34 30 L25 36 Z" />

        <g className="barrier-arm-pivot">
          <g className="barrier-arm barrier-arm-red">
            <rect x="3" y="22.5" width="22" height="5" rx="2.2" fill={`url(#${redId})`} />
            <rect className="barrier-led barrier-led-red" x="3" y="24.6" width="22" height="1.8" rx="0.9" />
          </g>
          <g className="barrier-arm barrier-arm-green">
            <rect x="3" y="22.5" width="22" height="5" rx="2.2" fill={`url(#${greenId})`} />
            <rect className="barrier-led barrier-led-green" x="3" y="24.6" width="22" height="1.8" rx="0.9" />
          </g>
        </g>
      </svg>
    </span>
  );
}
