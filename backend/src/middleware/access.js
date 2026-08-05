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

export function normalizeRole(role) {
  if (role === "USER") return "CLIENT_EMPLOYEE";
  return role;
}

export async function loadCurrentUser(req, res, next) {
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
    res.status(500).json({ error: "Wewnetrzny blad serwera." });
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
  if (role !== "CLIENT_EMPLOYEE" || !user?.id) return new Set();

  const result = await db.query(
    "SELECT permission_key FROM user_permissions WHERE user_id=$1 AND enabled=TRUE",
    [user.id]
  );
  return new Set(result.rows.map((row) => row.permission_key));
}

export function requireAllPermissions(...permissionKeys) {
  const requiredPermissions = [...new Set(permissionKeys.filter(Boolean))];

  return async (req, res, next) => {
    const role = normalizeRole(req.currentUser?.role || req.user?.role);
    if (role === "ADMIN" || role === "CLIENT_OWNER") return next();

    if (!requiredPermissions.length) return next();

    try {
      const result = await db.query(
        `SELECT permission_key
         FROM user_permissions
         WHERE user_id=$1 AND enabled=TRUE AND permission_key = ANY($2::text[])`,
        [req.currentUser.id, requiredPermissions]
      );
      const grantedPermissions = new Set(result.rows.map((row) => row.permission_key));
      if (requiredPermissions.every((permission) => grantedPermissions.has(permission))) return next();
      return res.status(403).json({ error: "Brak wymaganego uprawnienia." });
    } catch (err) {
      console.error("Failed to check user permission:", err);
      res.status(500).json({ error: "Wewnetrzny blad serwera." });
    }
  };
}

export function requireAnyPermission(...permissionKeys) {
  const requiredPermissions = [...new Set(permissionKeys.filter(Boolean))];

  return async (req, res, next) => {
    const role = normalizeRole(req.currentUser?.role || req.user?.role);
    if (role === "ADMIN" || role === "CLIENT_OWNER") return next();

    if (!requiredPermissions.length) return next();

    try {
      const result = await db.query(
        `SELECT 1
         FROM user_permissions
         WHERE user_id=$1 AND enabled=TRUE AND permission_key = ANY($2::text[])
         LIMIT 1`,
        [req.currentUser.id, requiredPermissions]
      );
      if (result.rows[0]) return next();
      return res.status(403).json({ error: "Brak wymaganego uprawnienia." });
    } catch (err) {
      console.error("Failed to check user permission:", err);
      res.status(500).json({ error: "Wewnetrzny blad serwera." });
    }
  };
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
