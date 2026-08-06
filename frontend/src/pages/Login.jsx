import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Moon, Sun, UserRound } from "lucide-react";
import { auth } from "../api.js";
import LoginBarrier from "../components/LoginBarrier";

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function Login({ onLoginSuccess, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authState, setAuthState] = useState("idle");

  useEffect(() => {
    if (authState !== "error") return undefined;
    const timeout = window.setTimeout(() => setAuthState("idle"), 900);
    return () => window.clearTimeout(timeout);
  }, [authState]);

  const login = async () => {
    if (!username.trim() || !password.trim()) {
      setMessage("Wpisz login i hasło.");
      setAuthState("error");
      return;
    }

    try {
      setLoading(true);
      setAuthState("loading");
      setMessage("");
      const res = await auth.login(username, password);
      if (res.data?.user) {
        setAuthState("success");
        localStorage.setItem("user", JSON.stringify(res.data.user));
        await wait(650);
        navigate("/", { replace: true });
        onLoginSuccess(res.data.user);
      } else {
        throw new Error("Odpowiedź serwera nie zawiera danych użytkownika.");
      }
    } catch (err) {
      const apiMessage = err.response?.data?.error;
      const code = err.response ? `ERR_HTTP_${err.response.status}` : "ERR_NETWORK";
      setMessage(apiMessage || `Wystąpił błąd. Skontaktuj się z administratorem. (Kod: ${code})`);
      setAuthState("error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <button
        className="login-theme-toggle"
        type="button"
        onClick={onThemeToggle}
        aria-label={theme === "dark" ? "Włącz jasny motyw" : "Włącz ciemny motyw"}
        title={theme === "dark" ? "Włącz jasny motyw" : "Włącz ciemny motyw"}
      >
        {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
      </button>
      <main className={`login-card ${authState === "error" ? "is-shaking" : ""}`}>
        <LoginBarrier state={authState} />

        <div className="login-heading">
          <span>Panel klienta i administratora</span>
          <h1>Witaj ponownie</h1>
          <p>Zaloguj się do swojego konta.</p>
        </div>

        <form onSubmit={(event) => { event.preventDefault(); login(); }}>
          <label className="login-field">
            <span>Login lub adres e-mail</span>
            <div>
              <UserRound size={19} aria-hidden="true" />
              <input
                autoComplete="username"
                autoFocus
                placeholder="Wpisz login"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={loading}
              />
            </div>
          </label>

          <label className="login-field">
            <span>Hasło</span>
            <div>
              <LockKeyhole size={19} aria-hidden="true" />
              <input
                autoComplete="current-password"
                placeholder="Wpisz hasło"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={loading}
              />
              <button
                className="login-password-toggle"
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Ukryj hasło" : "Pokaż hasło"}
                title={showPassword ? "Ukryj hasło" : "Pokaż hasło"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          {message && <div className="login-message" role="alert">{message}</div>}

          <button className={`login-submit login-submit--${authState}`} type="submit" disabled={loading}>
            <span>
              {authState === "success" ? "Zalogowano!" : loading ? "Logowanie..." : "Zaloguj się"}
            </span>
            {loading ? <i className="login-spinner" aria-hidden="true" /> : <ArrowRight size={19} aria-hidden="true" />}
          </button>
        </form>
      </main>
    </div>
  );
}
