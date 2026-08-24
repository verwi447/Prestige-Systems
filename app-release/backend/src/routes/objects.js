import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireCompanyAccess, requirePermission, requireRole } from "../middleware/access.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = express.Router();

router.use(auth, loadCurrentUser);

const siteSelect = `
  SELECT o.id, o.company_id, o.name, o.address, o.postal_code, o.city, o.country, o.description,
         o.image_url, o.is_active, o.status, o.created_at, o.updated_at, c.name AS company_name,
         (
           SELECT COUNT(*)::int
           FROM user_site_access usa
           WHERE usa.site_id=o.id
         ) AS assigned_employee_count
  FROM objects o
  LEFT JOIN companies c ON c.id=o.company_id
`;

async function visibleSites(req, companyId = null) {
  const params = [];
  const where = [];

  if (companyId) {
    params.push(companyId);
    where.push(`o.company_id=$${params.length}`);
  }

  if (req.currentUser.role === "CLIENT_OWNER") {
    params.push(req.currentUser.company_id);
    where.push(`o.company_id=$${params.length}`);
  }

  if (req.currentUser.role === "CLIENT_EMPLOYEE") {
    params.push(req.currentUser.company_id);
    where.push(`o.company_id=$${params.length}`);
    params.push(req.currentUser.id);
    where.push(`EXISTS (
      SELECT 1 FROM user_site_access usa
      WHERE usa.site_id=o.id AND usa.user_id=$${params.length}
    )`);
  }

  const sql = `${siteSelect}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY o.created_at DESC`;
  return db.query(sql, params);
}

router.get("/", asyncHandler(async (req, res) => {
  const result = await visibleSites(req);
  res.json(result.rows);
}));

router.get("/company/:companyId", requireCompanyAccess("companyId"), asyncHandler(async (req, res) => {
  const result = await visibleSites(req, req.params.companyId);
  res.json(result.rows);
}));

router.post("/", requirePermission("MANAGE_SITES"), asyncHandler(async (req, res) => {
  const companyId = Number(req.body.company_id || req.body.companyId || req.currentUser.company_id);
  if (req.currentUser.role !== "ADMIN" && Number(req.currentUser.company_id) !== companyId) {
    return res.status(403).json({ error: "Brak dostępu do tej firmy." });
  }

  const { name, address, postal_code, postalCode, city, description, is_active, isActive, status } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nazwa obiektu jest wymagana." });

  const result = await db.query(
    `INSERT INTO objects (
      company_id, name, address, postal_code, city, description, is_active, status, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      companyId,
      name.trim(),
      address || null,
      postal_code || postalCode || null,
      city || null,
      description || null,
      is_active ?? isActive ?? true,
      status || "AKTYWNY",
      req.currentUser.id
    ]
  );
  res.status(201).json(result.rows[0]);
}));

router.put("/:siteId", requirePermission("MANAGE_SITES"), asyncHandler(async (req, res) => {
  const existing = await db.query("SELECT company_id FROM objects WHERE id=$1", [req.params.siteId]);
  if (!existing.rows[0]) return res.status(404).json({ error: "Obiekt nie znaleziony." });
  if (req.currentUser.role !== "ADMIN" && Number(existing.rows[0].company_id) !== Number(req.currentUser.company_id)) {
    return res.status(403).json({ error: "Brak dostępu do tego obiektu." });
  }

  const { name, address, postal_code, postalCode, city, description, is_active, isActive } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nazwa obiektu jest wymagana." });

  const result = await db.query(
    `UPDATE objects SET
      name=$1, address=$2, postal_code=$3, city=$4, description=$5, is_active=$6,
      updated_at=CURRENT_TIMESTAMP
     WHERE id=$7
     RETURNING *`,
    [name.trim(), address || null, postal_code || postalCode || null, city || null, description || null, is_active ?? isActive ?? true, req.params.siteId]
  );
  res.json(result.rows[0]);
}));

router.get("/:siteId/users", asyncHandler(async (req, res) => {
  const existing = await db.query("SELECT company_id FROM objects WHERE id=$1", [req.params.siteId]);
  if (!existing.rows[0]) return res.status(404).json({ error: "Obiekt nie znaleziony." });
  if (req.currentUser.role !== "ADMIN" && Number(existing.rows[0].company_id) !== Number(req.currentUser.company_id)) {
    return res.status(403).json({ error: "Brak dostępu do tego obiektu." });
  }
  if (req.currentUser.role === "CLIENT_EMPLOYEE") {
    const access = await db.query(
      "SELECT 1 FROM user_site_access WHERE site_id=$1 AND user_id=$2",
      [req.params.siteId, req.currentUser.id]
    );
    if (!access.rows[0]) return res.status(403).json({ error: "Brak dostępu do tego obiektu." });
  }

  const result = await db.query(
    `SELECT u.id, u.company_id, u.role, u.first_name, u.last_name, u.email, u.phone, u.is_active,
            usa.created_at AS assigned_at
     FROM user_site_access usa
     JOIN users u ON u.id=usa.user_id
     WHERE usa.site_id=$1 AND u.role IN ('CLIENT_OWNER', 'CLIENT_EMPLOYEE')
     ORDER BY u.last_name, u.first_name`,
    [req.params.siteId]
  );
  res.json(result.rows);
}));

router.put("/:siteId/users", requireRole("ADMIN", "CLIENT_OWNER"), asyncHandler(async (req, res) => {
  const existing = await db.query("SELECT company_id FROM objects WHERE id=$1", [req.params.siteId]);
  if (!existing.rows[0]) return res.status(404).json({ error: "Obiekt nie znaleziony." });
  if (req.currentUser.role !== "ADMIN" && Number(existing.rows[0].company_id) !== Number(req.currentUser.company_id)) {
    return res.status(403).json({ error: "Brak dostępu do tego obiektu." });
  }

  const userIds = Array.isArray(req.body.userIds) ? req.body.userIds.map(Number).filter(Boolean) : [];
  if (userIds.length) {
    const users = await db.query(
      `SELECT id FROM users
       WHERE company_id=$1 AND role IN ('CLIENT_OWNER', 'CLIENT_EMPLOYEE') AND id = ANY($2::int[])`,
      [existing.rows[0].company_id, userIds]
    );
    if (users.rows.length !== new Set(userIds).size) {
      return res.status(400).json({ error: "Co najmniej jeden pracownik nie należy do tej firmy." });
    }
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM user_site_access WHERE site_id=$1", [req.params.siteId]);
    for (const userId of [...new Set(userIds)]) {
      await client.query(
        "INSERT INTO user_site_access (site_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [req.params.siteId, userId]
      );
    }
    await client.query("COMMIT");
    const result = await db.query(
      `SELECT u.id, u.company_id, u.role, u.first_name, u.last_name, u.email, u.phone, u.is_active,
              usa.created_at AS assigned_at
       FROM user_site_access usa
       JOIN users u ON u.id=usa.user_id
       WHERE usa.site_id=$1 AND u.role IN ('CLIENT_OWNER', 'CLIENT_EMPLOYEE')
       ORDER BY u.last_name, u.first_name`,
      [req.params.siteId]
    );
    res.json(result.rows);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  } finally {
    client.release();
  }
}));

router.delete("/:siteId", requirePermission("MANAGE_SITES"), asyncHandler(async (req, res) => {
  const existing = await db.query("SELECT company_id FROM objects WHERE id=$1", [req.params.siteId]);
  if (!existing.rows[0]) return res.status(404).json({ error: "Obiekt nie znaleziony." });
  if (req.currentUser.role !== "ADMIN" && Number(existing.rows[0].company_id) !== Number(req.currentUser.company_id)) {
    return res.status(403).json({ error: "Brak dostępu do tego obiektu." });
  }

  await db.query("DELETE FROM objects WHERE id=$1", [req.params.siteId]);
  res.status(204).send();
}));

export default router;
