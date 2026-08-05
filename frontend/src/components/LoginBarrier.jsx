import { useId } from "react";
import "./LoginBarrier.css";

export default function LoginBarrier({ state = "idle" }) {
  const uid = useId();
  const redId = `login-barrier-red-${uid}`;
  const greenId = `login-barrier-green-${uid}`;

  return (
    <div className={`login-barrier login-barrier--${state}`} aria-hidden="true">
      <svg viewBox="0 0 120 120" className="login-barrier-svg">
        <defs>
          <pattern id={redId} patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
            <rect width="10" height="10" fill="#ffffff" />
            <rect width="5" height="10" fill="#e2242f" />
          </pattern>
          <pattern id={greenId} patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
            <rect width="10" height="10" fill="#ffffff" />
            <rect width="5" height="10" fill="#16a94a" />
          </pattern>
        </defs>

        <ellipse className="login-barrier-shadow" cx="60" cy="106" rx="34" ry="6" />

        <rect className="login-barrier-post" x="66" y="46" width="30" height="58" rx="5" />
        <rect className="login-barrier-post-cap" x="62" y="40" width="38" height="10" rx="4" />
        <path className="login-barrier-bracket" d="M66 58 L88 72 L66 86 Z" />
        <circle className="login-barrier-eye-ring" cx="81" cy="72" r="6" />
        <circle className="login-barrier-eye" cx="81" cy="72" r="2.4" />

        <g className="login-barrier-arm-pivot">
          <g className="login-barrier-arm login-barrier-arm-red">
            <rect x="8" y="52" width="58" height="13" rx="5" fill={`url(#${redId})`} />
            <rect className="login-barrier-led login-barrier-led-red" x="8" y="56.5" width="58" height="4" rx="2" />
          </g>
          <g className="login-barrier-arm login-barrier-arm-green">
            <rect x="8" y="52" width="58" height="13" rx="5" fill={`url(#${greenId})`} />
            <rect className="login-barrier-led login-barrier-led-green" x="8" y="56.5" width="58" height="4" rx="2" />
          </g>
        </g>
      </svg>
      <div className="login-barrier-caption">
        <span className="login-barrier-dot" />
        <span className="login-barrier-text">
          {state === "loading" && "Weryfikacja dostępu…"}
          {state === "success" && "Dostęp przyznany"}
          {state === "error" && "Odmowa dostępu"}
          {state === "idle" && "System gotowy"}
        </span>
      </div>
    </div>
  );
}
