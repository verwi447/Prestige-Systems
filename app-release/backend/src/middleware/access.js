import { db } from "../db.js";

export const PERMISSIONS = [
  "CREATE_TICKET",
  "VIEW_TICKETS",
  "COMMENT_TICKET",
  "VIEW_OFFERS",
  "ACCEPT_OFFERS",
  "VIEW_CATALOG",
  "MANAGE_EMPLOYEES",
  "MANAGE_SITES"
];

// Roles that belong to our own company instead of a client company. They see
// the whole book of business, so every company-scoped query has to treat them
// like ADMIN rather than falling through to the "find my own company" path.
export const INTERNAL_ROLES = ["ADMIN", "ACCOUNTANT"];

// The accounting role is read-only by design: it needs the commercial numbers
// (offers, orders, their items) and nothing else. Permissions are fixed in code
// rather than stored per user - there is no UI to grant extra ones, on purpose.
export const ACCOUNTANT_PERMISSIONS = ["VIEW_OFFERS"];

export function normalizeRole(role) {
  if (role === "USER") return "CLIENT_EMPLOYEE";
  return role;
}

export function isInternalRole(role) {
  return INTERNAL_ROLES.includes(normalizeRole(role));
}

export async function loadCurrentUser(req, res, next) {
  // auth() czyta juz pelny rekord uzytkownika i wypelnia req.currentUser, wiec
  // w normalnym lancuchu (auth -> loadCurrentUser) nie ma tu drugiego
  // zapytania. Fallback zostaje dla tras, ktore uzywaja tego middleware
  // samodzielnie, oraz dla testow wstrzykujacych samo req.user.
  if (req.currentUser) return next();

  try {
    const result = await db.query(
      `SELECT id, username, role, company_id, first_name, last_name, email, phone, is_active
       FROM users
       WHERE id=$1`,
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user || user.is_active === false) {
      return res.status(401).json({ error: "Użytkownik jest nieaktywny albo nie istnieje." });
    }
    req.currentUser = { ...user, role: normalizeRole(user.role) };
    next();
  } catch (err) {
    console.error("Failed to load current user:", err);
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const role = normalizeRole(req.currentUser?.role || req.user?.role);
    if (!roles.includes(role)) {
      return res.status(403).json({ error: "Brak uprawnień." });
    }
    next();
  };
}

export function requireClient(req, res, next) {
  const currentUser = req.currentUser || req.user;
  const role = normalizeRole(currentUser?.role);
  const companyId = currentUser?.company_id || currentUser?.companyId;

  if (!currentUser) {
    return res.status(401).json({ error: "Brak autoryzacji." });
  }

  if (!["CLIENT_OWNER", "CLIENT_EMPLOYEE"].includes(role)) {
    return res.status(403).json({ error: "Brak dostępu do panelu klienta." });
  }

  if (!companyId) {
    return res.status(403).json({ error: "Użytkownik nie jest przypisany do firmy." });
  }

  next();
}

export function requireClientOwner(req, res, next) {
  const currentUser = req.currentUser || req.user;
  const role = normalizeRole(currentUser?.role);
  const companyId = currentUser?.company_id || currentUser?.companyId;

  if (!currentUser) {
    return res.status(401).json({ error: "Brak autoryzacji." });
  }

  if (role !== "CLIENT_OWNER") {
    return res.status(403).json({ error: "Brak dostępu do tej operacji." });
  }

  if (!companyId) {
    return res.status(403).json({ error: "Użytkownik nie jest przypisany do firmy." });
  }

  next();
}

export function requireCompanyAccess(paramName = "companyId") {
  return (req, res, next) => {
    const role = normalizeRole(req.currentUser?.role || req.user?.role);
    const requestedCompanyId = Number(req.params[paramName] ?? req.body[paramName] ?? req.query[paramName]);

    if (role === "ADMIN") return next();
    if (!requestedCompanyId || Number(req.currentUser?.company_id) !== requestedCompanyId) {
      return res.status(403).json({ error: "Brak dostępu do tej firmy." });
    }
    next();
  };
}

export function requirePermission(permissionKey) {
  return requireAllPermissions(permissionKey);
}

export async function getEffectivePermissions(user) {
  const role = normalizeRole(user?.role);
  if (role === "ADMIN" || role === "CLIENT_OWNER") return new Set(PERMISSIONS);
  if (role === "ACCOUNTANT") return new Set(ACCOUNTANT_PERMISSIONS);
  if (role !== "CLIENT_EMPLOYEE" || !user?.id) return new Set();

  const result = await db.query(
    "SELECT permission_key FROM user_permissions WHERE user_id=$1 AND enabled=TRUE",
    [user.id]
  );
  return new Set(result.rows.map((row) => row.permission_key));
}

// Both guards resolve permissions through getEffectivePermissions so that every
// role which carries a fixed set in code (ADMIN, CLIENT_OWNER, ACCOUNTANT) is
// handled in exactly one place instead of being special-cased per guard.
function permissionGuard(permissionKeys, isSatisfied) {
  const requiredPermissions = [...new Set(permissionKeys.filter(Boolean))];

  return async (req, res, next) => {
    if (!requiredPermissions.length) return next();

    try {
      const grantedPermissions = await getEffectivePermissions(req.currentUser || req.user);
      if (isSatisfied(requiredPermissions, grantedPermissions)) return next();
      return res.status(403).json({ error: "Brak wymaganego uprawnienia." });
    } catch (err) {
      console.error("Failed to check user permission:", err);
      res.status(500).json({ error: "Wewnętrzny błąd serwera." });
    }
  };
}

export function requireAllPermissions(...permissionKeys) {
  return permissionGuard(permissionKeys, (required, granted) => required.every((permission) => granted.has(permission)));
}

export function requireAnyPermission(...permissionKeys) {
  return permissionGuard(permissionKeys, (required, granted) => required.some((permission) => granted.has(permission)));
}

// Mounted on routers that an accountant may read but never change. Keying off
// the HTTP method instead of a per-route list means a route added later is
// read-only for the accounting role by default, not accidentally writable.
// Mounted on routers the accounting role has no business calling at all. Without
// it those handlers fall into their "scope to my own company" branch and answer
// with an empty client-shaped result, which reads like a feature rather than a
// denial. The role has no company, so an explicit 403 is the honest answer.
export function denyAccountant(req, res, next) {
  const role = normalizeRole(req.currentUser?.role || req.user?.role);
  if (role === "ACCOUNTANT") {
    return res.status(403).json({ error: "Brak uprawnień." });
  }
  next();
}

export function blockAccountantWrites(req, res, next) {
  const role = normalizeRole(req.currentUser?.role || req.user?.role);
  if (role === "ACCOUNTANT" && req.method !== "GET" && req.method !== "HEAD") {
    return res.status(403).json({ error: "Konto księgowe ma dostęp wyłącznie do podglądu." });
  }
  next();
}

export async function canAccessSite(user, siteId) {
  const role = normalizeRole(user.role);
  if (role === "ADMIN") return true;

  const site = await db.query("SELECT company_id FROM objects WHERE id=$1", [siteId]);
  if (!site.rows[0]) return false;
  if (Number(site.rows[0].company_id) !== Number(user.company_id)) return false;
  if (role === "CLIENT_OWNER") return true;

  const access = await db.query(
    "SELECT 1 FROM user_site_access WHERE user_id=$1 AND site_id=$2",
    [user.id, siteId]
  );
  return access.rows.length > 0;
}
