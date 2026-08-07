import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, Link } from "react-router-dom";
import Login from "./pages/Login";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import AppFeedback from "./components/AppFeedback";
import AppState from "./components/AppState";
import { auth } from "./api";
import { getRequestErrorMessage } from "./lib/feedback";
import { getStoredUser, hasClientPermission, isClientRole } from "./lib/permissions";
import "./App.css";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Companies = lazy(() => import("./pages/Companies"));
const CompanyDetail = lazy(() => import("./pages/CompanyDetail"));
const Products = lazy(() => import("./pages/Products"));
const Admin = lazy(() => import("./pages/Admin"));
const Templates = lazy(() => import("./pages/Templates"));
const MyCompany = lazy(() => import("./pages/MyCompany"));
const NewTicket = lazy(() => import("./pages/NewTicket"));
const Profile = lazy(() => import("./pages/Profile"));
const AdminOffers = lazy(() => import("./pages/AdminOffers"));
const MyOffers = lazy(() => import("./pages/MyOffers"));
const MyTickets = lazy(() => import("./pages/MyTickets"));
const TicketDetail = lazy(() => import("./pages/TicketDetail"));
const ClientTicketDetail = lazy(() => import("./pages/ClientTicketDetail"));
const NewOffer = lazy(() => import("./pages/NewOffer"));
const OfferDetail = lazy(() => import("./pages/OfferDetail"));
const Settings = lazy(() => import("./pages/Settings"));
const BackupSystem = lazy(() => import("./pages/BackupSystem"));
const EmailSettingsPage = lazy(() => import("./pages/EmailSettingsPage"));
const AdminOrders = lazy(() => import("./pages/AdminOrders"));
const AdminOrderDetail = lazy(() => import("./pages/AdminOrderDetail"));
const SystemStatus = lazy(() => import("./pages/SystemStatus"));
const NetworkSettings = lazy(() => import("./pages/NetworkSettings"));
const AuditLog = lazy(() => import("./pages/AuditLog"));

const THEME_STORAGE_KEY = "ps-hub-theme";
const IDLE_ACTIVITY_STORAGE_KEY = "ps-hub-last-activity";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 15_000;
const IDLE_ACTIVITY_THROTTLE_MS = 5_000;
const IDLE_ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart", "wheel"];

function getInitialTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

const AccessDenied = ({ client = false }) => (
  <div className="page">
    <AppState
      variant="denied"
      description="Nie masz dostepu do tej czesci panelu. Skontaktuj sie z administratorem, jezeli potrzebujesz dodatkowych uprawnien."
      action={<Link to={client ? "/client/dashboard" : "/dashboard"}>Wroc do dashboardu</Link>}
    />
  </div>
);

const AdminOnly = ({ user, children }) => (
  user?.role === "ADMIN" ? children : <AccessDenied client={isClientRole(user?.role)} />
);

const ClientOnly = ({ user, children }) => (
  isClientRole(user?.role) ? children : <AccessDenied />
);

const ClientPermission = ({ user, permission, children }) => (
  isClientRole(user?.role) && hasClientPermission(user, permission)
    ? children
    : <AccessDenied client />
);

function App() {
  const [user, setUser] = useState(getStoredUser);
  const [theme, setTheme] = useState(getInitialTheme);
  const [identityReady, setIdentityReady] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionNotice, setSessionNotice] = useState("");
  const idleActivityRef = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The interface can still work when storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    const isEditableTarget = (target) => {
      if (!target) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      if (tag === "TEXTAREA") return true;
      if (tag !== "INPUT") return false;
      const nonTextTypes = new Set(["checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image"]);
      const type = (target.getAttribute("type") || "text").toLowerCase();
      return !nonTextTypes.has(type) && !target.disabled && !target.readOnly;
    };

    // Backspace navigates the browser back when focus isn't on an editable
    // field (e.g. focus landed on a button/icon next to a password input),
    // which silently discards whatever the user was filling in.
    const preventStrayBackspaceNavigation = (event) => {
      if (event.key !== "Backspace" || isEditableTarget(event.target)) return;
      event.preventDefault();
    };

    document.addEventListener("keydown", preventStrayBackspaceNavigation);
    return () => document.removeEventListener("keydown", preventStrayBackspaceNavigation);
  }, []);

  const toggleTheme = () => setTheme((currentTheme) => currentTheme === "dark" ? "light" : "dark");

  const handleLogout = useCallback(() => {
    auth.logout().catch(() => {});
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }, []);

  const handleLoginSuccess = (loggedInUser) => {
    setSessionError("");
    setSessionNotice("");
    setUser(loggedInUser);
    setIdentityReady(true);
  };

  useEffect(() => {
    if (!user) return undefined;

    const markActivity = () => {
      const now = Date.now();
      if (now - idleActivityRef.current < IDLE_ACTIVITY_THROTTLE_MS) return;
      idleActivityRef.current = now;
      try {
        localStorage.setItem(IDLE_ACTIVITY_STORAGE_KEY, String(now));
      } catch {
        // The interface can still work when storage is unavailable.
      }
    };

    markActivity();
    IDLE_ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }));

    const intervalId = window.setInterval(() => {
      let lastActivity = idleActivityRef.current;
      try {
        lastActivity = Math.max(lastActivity, Number(localStorage.getItem(IDLE_ACTIVITY_STORAGE_KEY)) || 0);
      } catch {
        // Fall back to the in-memory timestamp when storage is unavailable.
      }
      if (Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
        setSessionNotice("Zostałeś wylogowany z powodu braku aktywności. Zaloguj się ponownie.");
        handleLogout();
      }
    }, IDLE_CHECK_INTERVAL_MS);

    return () => {
      IDLE_ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, markActivity));
      window.clearInterval(intervalId);
    };
  }, [user, handleLogout]);

  useEffect(() => {
    let mounted = true;
    setIdentityReady(false);
    setSessionError("");
    auth.me()
      .then((response) => {
        if (!mounted) return;
        localStorage.setItem("user", JSON.stringify(response.data));
        setUser(response.data);
      })
      .catch((error) => {
        if (!mounted) return;
        if (error.response?.status === 401) {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          setUser(null);
        } else if (!getStoredUser()) {
          setSessionError(getRequestErrorMessage(error, "Nie udalo sie potwierdzic sesji."));
        }
      })
      .finally(() => {
        if (mounted) setIdentityReady(true);
      });

    return () => { mounted = false; };
  }, [sessionAttempt]);

  if (!identityReady) {
    return <><AppFeedback /><div className="session-state"><AppState title="Ladowanie sesji" description="Sprawdzamy dostep do panelu." /></div></>;
  }

  if (!user) {
    if (sessionError) {
      return (
        <>
          <AppFeedback />
          <div className="session-state">
            <AppState variant="connection" title="Nie udalo sie otworzyc panelu" description={sessionError} actionLabel="Sprobuj ponownie" onAction={() => setSessionAttempt((value) => value + 1)} />
          </div>
        </>
      );
    }
    return <><AppFeedback /><Login onLoginSuccess={handleLoginSuccess} theme={theme} onThemeToggle={toggleTheme} notice={sessionNotice} /></>;
  }

  return (
    <>
      <AppFeedback />
      <div className="app-layout">
        <Sidebar user={user} />
        <main className="main-content">
          <Header user={user} theme={theme} onThemeToggle={toggleTheme} onLogout={handleLogout} />
          <Suspense fallback={<div className="page"><AppState title="Ladowanie widoku" description="Pobieramy potrzebne dane." /></div>}>
          <Routes>
          {/* Common */}
          <Route path="/" element={<Navigate to={user?.role === "ADMIN" ? "/dashboard" : "/client/dashboard"} replace />} />
          <Route path="/dashboard" element={user?.role === "ADMIN" ? <Dashboard /> : <Navigate to="/client/dashboard" replace />} />

          {/* Admin panel */}
          <Route path="/customers" element={<Navigate to="/companies" replace />} />
          <Route path="/companies" element={<AdminOnly user={user}><Companies /></AdminOnly>} />
          <Route path="/companies/:id" element={<AdminOnly user={user}><CompanyDetail /></AdminOnly>} />
          <Route path="/offers" element={<AdminOnly user={user}><AdminOffers /></AdminOnly>} />
          <Route path="/orders" element={<AdminOnly user={user}><AdminOrders /></AdminOnly>} />
          <Route path="/orders/:id" element={<AdminOnly user={user}><AdminOrderDetail /></AdminOnly>} />

          {/* Admin-only routes */}
          <Route path="/products" element={user?.role === "ADMIN" ? <Products /> : <Navigate to="/client/catalog" replace />} />
          <Route path="/admin" element={<AdminOnly user={user}><Admin /></AdminOnly>} />
          <Route path="/templates" element={<AdminOnly user={user}><Templates /></AdminOnly>} />
          <Route path="/settings" element={<AdminOnly user={user}><Settings /></AdminOnly>} />
          <Route path="/settings/admins" element={<Navigate to="/profile?tab=admins" replace />} />
          <Route path="/settings/notifications" element={<Navigate to="/profile?tab=admin-notifications" replace />} />
          <Route path="/settings/email" element={<AdminOnly user={user}><EmailSettingsPage /></AdminOnly>} />
          <Route path="/settings/backups" element={<AdminOnly user={user}><BackupSystem /></AdminOnly>} />
          <Route path="/settings/network" element={<AdminOnly user={user}><NetworkSettings /></AdminOnly>} />
          <Route path="/settings/system-status" element={<AdminOnly user={user}><SystemStatus /></AdminOnly>} />
          <Route path="/settings/audit-log" element={<AdminOnly user={user}><AuditLog /></AdminOnly>} />
          
          {/* Client */}
          <Route path="/client/dashboard" element={<ClientOnly user={user}><Dashboard /></ClientOnly>} />
          <Route path="/client/tickets" element={<ClientPermission user={user} permission="VIEW_TICKETS"><MyTickets /></ClientPermission>} />
          <Route path="/client/tickets/:id" element={<ClientPermission user={user} permission="VIEW_TICKETS"><ClientTicketDetail /></ClientPermission>} />
          <Route path="/client/tickets/new" element={<ClientPermission user={user} permission="CREATE_TICKET"><NewTicket /></ClientPermission>} />
          <Route path="/client/orders" element={<ClientPermission user={user} permission="VIEW_TICKETS"><MyTickets clientScope="orders" /></ClientPermission>} />
          <Route path="/client/orders/new" element={<ClientPermission user={user} permission="CREATE_TICKET"><ClientPermission user={user} permission="VIEW_CATALOG"><NewTicket mode="order" /></ClientPermission></ClientPermission>} />
          <Route path="/client/orders/:id" element={<ClientPermission user={user} permission="VIEW_TICKETS"><ClientTicketDetail /></ClientPermission>} />
          <Route path="/client/offers" element={<ClientPermission user={user} permission="VIEW_OFFERS"><MyOffers /></ClientPermission>} />
          <Route path="/client/offers/:id" element={<ClientPermission user={user} permission="VIEW_OFFERS"><OfferDetail /></ClientPermission>} />
          <Route path="/client/sites" element={<Navigate to="/client/company?tab=sites" replace />} />
          <Route path="/client/employees" element={<Navigate to="/client/company?tab=employees" replace />} />
          <Route path="/client/employees/new" element={<Navigate to="/client/company?tab=employees&action=new" replace />} />
          <Route path="/client/company" element={<ClientOnly user={user}><MyCompany /></ClientOnly>} />
          <Route path="/client/catalog" element={<ClientPermission user={user} permission="VIEW_CATALOG"><Products /></ClientPermission>} />
          <Route path="/client/settings" element={<ClientOnly user={user}><Profile /></ClientOnly>} />
          <Route path="/tickets" element={user?.role === "ADMIN" ? <MyTickets /> : <Navigate to="/client/tickets" replace />} />
          <Route path="/tickets/:id" element={<AdminOnly user={user}><TicketDetail /></AdminOnly>} />
          <Route path="/tickets/new" element={user?.role === "ADMIN" ? <NewTicket /> : <Navigate to="/client/tickets/new" replace />} />
          <Route path="/my-offers" element={<Navigate to="/client/offers" replace />} />
          <Route path="/offers/new" element={<AdminOnly user={user}><NewOffer /></AdminOnly>} />
          <Route path="/offers/edit/:id" element={<AdminOnly user={user}><NewOffer /></AdminOnly>} />
          <Route path="/offers/:id" element={<AdminOnly user={user}><OfferDetail /></AdminOnly>} />
          <Route path="/my-company" element={<ClientOnly user={user}><MyCompany /></ClientOnly>} />
          <Route path="/catalog" element={<ClientOnly user={user}><Products /></ClientOnly>} />
          
          {/* Placeholder routes for client */}
          <Route path="/documents" element={<div className="page"><h1>Dokumenty</h1><p>Ta strona jest w budowie.</p></div>} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/contact" element={<div className="page"><h1>Kontakt</h1><p>Ta strona jest w budowie.</p></div>} />

          <Route path="*" element={<Navigate to={user?.role === "ADMIN" ? "/dashboard" : "/client/dashboard"} replace />} />
          </Routes>
          </Suspense>
        </main>
      </div>
    </>
  );
}

export default App;
