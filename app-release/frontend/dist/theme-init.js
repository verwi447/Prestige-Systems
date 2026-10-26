// Applies the saved theme before React mounts so dark-theme users don't see a
// flash of the light theme. Kept as a same-origin file (not an inline script)
// so it passes the backend's `script-src 'self'` CSP.
try {
  const theme = localStorage.getItem("ps-hub-theme") === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
} catch {}
