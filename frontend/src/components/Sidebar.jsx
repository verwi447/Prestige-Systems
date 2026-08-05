import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import HubLogo from "../assets/ps-logo-2.png";
import { APP_VERSION, formatAppVersion } from "../lib/appInfo";
import { hasClientPermission } from "../lib/permissions";
import "./Sidebar.css";

const adminMenu = [
  { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { to: "/companies", label: "Firmy klientów", icon: "building" },
  { to: "/products", label: "Katalog produktów", icon: "catalog" },
  { to: "/offers", label: "Oferty", icon: "document" },
  { to: "/orders", label: "Zamówienia", icon: "order" },
  { to: "/tickets", label: "Zgłoszenia", icon: "ticket" }
];

const adminSettings = [
  { to: "/settings", label: "Nasza firma", icon: "office", end: true },
  { to: "/settings/admins", label: "Administratorzy", icon: "admin" },
  { to: "/settings/notifications", label: "Powiadomienia", icon: "bell" }
];

const adminSystemMenu = [
  { to: "/settings/email", label: "Poczta", icon: "mail" },
  { to: "/settings/network", label: "Siec", icon: "network" },
  { to: "/settings/system-status", label: "Stan systemu", icon: "pulse" },
  { to: "/settings/audit-log", label: "Audit Log", icon: "history" },
  { to: "/settings/backups", label: "Backup systemu", icon: "backup" }
];

const clientMenu = [
  { to: "/client/dashboard", label: "Dashboard", icon: "home" },
  { to: "/client/company", label: "Moja firma", icon: "building" },
  { to: "/client/offers", label: "Oferty", icon: "document", permission: "VIEW_OFFERS" },
  { to: "/client/orders", label: "Zamówienia", icon: "order", permission: "VIEW_TICKETS" },
  { to: "/client/tickets", label: "Zgłoszenia", icon: "wrench", permission: "VIEW_TICKETS" },
  { to: "/client/catalog", label: "Katalog", icon: "book", permission: "VIEW_CATALOG" },
  { to: "/client/settings", label: "Ustawienia konta", icon: "settings" }
];

const activeClass = ({ isActive }) => (isActive ? "active" : undefined);

const iconPaths = {
  home: (
    <>
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6.5 10.5V20h11v-9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  dashboard: (
    <>
      <path d="M4 10.5h5.5V20H4z" />
      <path d="M14.5 4H20v16h-5.5z" />
      <path d="M4 4h5.5v3.5H4z" />
    </>
  ),
  building: (
    <>
      <path d="M4.5 20V5.5h9V20" />
      <path d="M13.5 9H20v11" />
      <path d="M7.5 8h3M7.5 11.5h3M7.5 15h3M16.5 12h1M16.5 15h1" />
    </>
  ),
  catalog: (
    <>
      <path d="M5 7.5 12 4l7 3.5-7 3.5z" />
      <path d="M5 11.5 12 15l7-3.5" />
      <path d="M5 15.5 12 19l7-3.5" />
    </>
  ),
  document: (
    <>
      <path d="M6 3.5h8l4 4V20.5H6z" />
      <path d="M14 3.5v4h4M8.5 11h7M8.5 14.5h7M8.5 18h4" />
    </>
  ),
  ticket: (
    <>
      <path d="M4 8.5 15.5 4l4.5 11.5L8.5 20z" />
      <path d="M9 8.5h.01M11 13.5h.01M13 17.5h.01" />
    </>
  ),
  office: (
    <>
      <path d="M5 20V4h10v16M15 9h4v11" />
      <path d="M8 7h4M8 10.5h4M8 14h4M8 17.5h4" />
    </>
  ),
  admin: (
    <>
      <path d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
      <path d="M4.5 20c.8-4.1 3.4-6.2 7.5-6.2s6.7 2.1 7.5 6.2" />
    </>
  ),
  order: (
    <>
      <path d="M5 7h14l-1 13H6z" />
      <path d="M8 7a4 4 0 0 1 8 0M9 11h.01M15 11h.01" />
    </>
  ),
  users: (
    <>
      <path d="M9.5 11a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z" />
      <path d="M3.8 20c.7-3.8 2.6-5.7 5.7-5.7s5 1.9 5.7 5.7" />
      <path d="M16 11a3 3 0 0 0 0-5.8" />
      <path d="M16.8 14.7c1.8.7 2.9 2.4 3.4 5.3" />
    </>
  ),
  wrench: (
    <>
      <path d="M14.6 5.2a4.6 4.6 0 0 0 5.2 5.2L10.4 19.8a2.5 2.5 0 0 1-3.5-3.5z" />
      <path d="M7.5 17.5h.01" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5h9.5A3.5 3.5 0 0 1 18 8v12H8.5A3.5 3.5 0 0 1 5 16.5z" />
      <path d="M8.5 16H18" />
      <path d="M8.5 8h5.5M8.5 11h4" />
    </>
  ),
  settings: (
    <>
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z" />
      <path d="M19 12a7.7 7.7 0 0 0-.1-1l2-1.6-2-3.4-2.5 1a7.1 7.1 0 0 0-1.8-1L14.2 3h-4.4l-.4 3a7.1 7.1 0 0 0-1.8 1L5.1 6 3.1 9.4l2 1.6a7.7 7.7 0 0 0 0 2l-2 1.6 2 3.4 2.5-1a7.1 7.1 0 0 0 1.8 1l.4 3h4.4l.4-3a7.1 7.1 0 0 0 1.8-1l2.5 1 2-3.4-2-1.6c.1-.3.1-.7.1-1z" />
    </>
  ),
  support: (
    <>
      <path d="M4 13a8 8 0 1 1 16 0" />
      <path d="M5 13h3v5H5zM16 13h3v5h-3z" />
      <path d="M19 18c-.5 2-2.2 3-5 3h-2" />
    </>
  ),
  mail: (
    <>
      <path d="M4 6h16v12H4z" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 22h4" />
    </>
  ),
  backup: (
    <>
      <path d="m12 3 8 4-8 4-8-4z" />
      <path d="M4 12l8 4 8-4M4 17l8 4 8-4" />
      <path d="M16.5 6.2 12 8.4 7.5 6.2" />
    </>
  ),
  pulse: (
    <>
      <path d="M3 12h4l2.2-5 4 10 2.1-5H21" />
    </>
  ),
  network: (
    <>
      <path d="M3.5 9.5a12 12 0 0 1 17 0" />
      <path d="M6.8 13a7.5 7.5 0 0 1 10.4 0" />
      <path d="M10.1 16.4a3 3 0 0 1 3.8 0" />
      <path d="M12 20h.01" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3.2 2" />
      <path d="M4 5.5v4h4" />
    </>
  ),
  chevron: <path d="m7 10 5 5 5-5" />,
};

function SidebarIcon({ name }) {
  return (
    <svg className="sidebar-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
      {iconPaths[name]}
    </svg>
  );
}

function SidebarLink({ item }) {
  return (
    <NavLink to={item.to} end={item.end} className={activeClass}>
      {item.icon && <SidebarIcon name={item.icon} />}
      <span>{item.label}</span>
    </NavLink>
  );
}

export default function Sidebar({ user }) {
  const [appVersion, setAppVersion] = useState(APP_VERSION);
  const [systemOpen, setSystemOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let active = true;
    const apiOrigin = String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

    fetch(`${apiOrigin}/app-version.json`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((appInfo) => {
        if (active && appInfo?.version) setAppVersion(String(appInfo.version));
      })
      .catch(() => null);

    return () => { active = false; };
  }, []);

  const isAdmin = user?.role === "ADMIN";
  const isSystemActive = adminSystemMenu.some((item) => location.pathname === item.to);

  useEffect(() => {
    if (isSystemActive) setSystemOpen(true);
  }, [isSystemActive]);

  return (
    <aside className={isAdmin ? "sidebar admin-sidebar" : "sidebar"}>
      <div className="sidebar-header">
        <img src={HubLogo} alt="Prestige Systems HUB" className="sidebar-brand-logo" />
      </div>

      <nav className="sidebar-nav" aria-label="Nawigacja aplikacji">
        {isAdmin ? (
          <>
            <ul>
              {adminMenu.map((item) => (
                <li key={item.to}>
                  <SidebarLink item={item} />
                </li>
              ))}
            </ul>
            <div className="sidebar-section-label">Ustawienia</div>
            <ul>
              {adminSettings.map((item) => (
                <li key={item.to}>
                  <SidebarLink item={item} />
                </li>
              ))}
              <li className={systemOpen ? "sidebar-system-group open" : "sidebar-system-group"}>
                <button type="button" className={isSystemActive ? "sidebar-system-toggle active" : "sidebar-system-toggle"} onClick={() => setSystemOpen((value) => !value)} aria-expanded={systemOpen} aria-controls="admin-system-menu">
                  <SidebarIcon name="pulse" />
                  <span>System</span>
                  <SidebarIcon name="chevron" />
                </button>
                {systemOpen && <ul id="admin-system-menu" className="sidebar-system-menu">
                  {adminSystemMenu.map((item) => (
                    <li key={item.to}>
                      <SidebarLink item={item} />
                    </li>
                  ))}
                </ul>}
              </li>
            </ul>
          </>
        ) : (
          <ul className="client-menu">
            {clientMenu.filter((item) => !item.permission || hasClientPermission(user, item.permission)).map((item) => (
              <li key={item.to}>
                <SidebarLink item={item} />
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div className={isAdmin ? "sidebar-footer sidebar-admin-footer" : "sidebar-footer"}>
        {!isAdmin && (
          <div className="sidebar-help-card">
            <SidebarIcon name="support" />
            <div>
              <strong>Potrzebujesz pomocy?</strong>
              <span>+48 22 123 45 67</span>
              <small>serwis@prestige-systems.pl</small>
            </div>
          </div>
        )}
        <span className="sidebar-version" title={`Wersja aplikacji ${appVersion}`}>v{formatAppVersion(appVersion)}</span>
      </div>
    </aside>
  );
}
