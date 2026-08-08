import { lazy, Suspense, useEffect, useState } from "react";
import { Bell, ChevronDown, LogOut, Moon, Search, Sun } from "lucide-react";
import { client as clientAPI } from "../api.js";
import { GLOBAL_SEARCH_EVENT } from "./GlobalSearch";
import "./Header.css";

const NotificationCenter = lazy(() => import("./NotificationCenter"));

const NotificationCenterFallback = () => (
  <button className="header-notification" type="button" aria-label="Powiadomienia" disabled>
    <Bell size={19} />
  </button>
);

export default function Header({ user, theme, onThemeToggle, onLogout }) {
  const [companyName, setCompanyName] = useState("ABC Sp. z o.o.");

  useEffect(() => {
    if (!user || user.role === "ADMIN") return;
    clientAPI.me()
      .then((response) => {
        if (response.data?.company?.name) setCompanyName(response.data.company.name);
      })
      .catch(() => {});
  }, [user]);

  const firstName = user?.firstName || user?.first_name;
  const lastName = user?.lastName || user?.last_name;
  const displayName = [firstName, lastName].filter(Boolean).join(" ") || user?.username || user?.email || "Użytkownik";
  const initials = displayName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
  const roleLabel = user?.role === "CLIENT_OWNER" ? "Właściciel konta" : user?.role === "ADMIN" ? "Administrator" : "Pracownik";

  return (
    <header className="header">
      <div className="header-left">
        {user?.role === "ADMIN" ? (
          <>
            <span className="header-kicker">Prestige Systems</span>
            <strong>Panel administratora</strong>
          </>
        ) : (
          <>
            <span className="header-kicker">Moja firma:</span>
            <strong>{companyName}</strong>
            <ChevronDown size={16} aria-hidden="true" />
          </>
        )}
      </div>
      <div className="header-right">
        <button
          className="header-search-trigger"
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_EVENT))}
          aria-label="Szukaj (Ctrl+K)"
          title="Szukaj (Ctrl+K)"
        >
          <Search size={18} aria-hidden="true" />
          <span>Szukaj...</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button
          className="header-theme-toggle"
          type="button"
          onClick={onThemeToggle}
          aria-label={theme === "dark" ? "Włącz jasny motyw" : "Włącz ciemny motyw"}
          title={theme === "dark" ? "Włącz jasny motyw" : "Włącz ciemny motyw"}
        >
          {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        </button>
        <Suspense fallback={<NotificationCenterFallback />}>
          <NotificationCenter />
        </Suspense>
        <div className="header-user">
          <span className="header-avatar">{initials}</span>
          <div>
            <strong>{displayName}</strong>
            <small>{roleLabel}</small>
          </div>
          <button className="header-logout" type="button" onClick={onLogout} aria-label="Wyloguj" title="Wyloguj">
            <LogOut size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
