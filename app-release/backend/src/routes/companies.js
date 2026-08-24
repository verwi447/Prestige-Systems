import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireCompanyAccess, requirePermission, requireRole, normalizeRole } from "../middleware/access.js";
import { notifyAdmins } from "../utils/notifications.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = express.Router();

router.use(auth, loadCurrentUser);

const companySelect = `
  SELECT id, name, nip, regon, address, postal_code, city, country, email, phone,
         is_active, description, created_at, updated_at,
         (SELECT COUNT(*)::int FROM users u WHERE u.company_id=companies.id AND u.role IN ('CLIENT_OWNER', 'CLIENT_EMPLOYEE')) AS employee_count,
         (SELECT COUNT(*)::int FROM objects o WHERE o.company_id=companies.id) AS site_count,
         (SELECT COUNT(*)::int FROM offers ofr JOIN customers c ON c.id=ofr.customer_id WHERE c.company_id=companies.id) AS offer_count,
         (SELECT COUNT(*)::int FROM tickets t JOIN customers c ON c.id=t.customer_id WHERE c.company_id=companies.id) AS ticket_count
  FROM companies
  WHERE COALESCE(is_own_company, FALSE) = FALSE
`;

const mapCompanyBody = (body) => ({
  name: body.name?.trim(),
  nip: body.nip || null,
  regon: body.regon || null,
  address: body.address || null,
  postal_code: body.postal_code || body.postalCode || null,
  city: body.city || null,
  country: body.country || "Polska",
  email: body.email || null,
  phone: body.phone || null,
  description: body.description || null,
  is_active: body.is_active ?? body.isActive ?? true
});

async function createPrimaryCustomer(company, createdBy, sql = db) {
  await sql.query(
    `INSERT INTO customers (
       name, email, phone, company_id, company_role, created_by,
       nip, address, postal_code, city, country, contact_person
     )
     VALUES ($1,$2,$3,$4,'PRIMARY_CONTACT',$5,$6,$7,$8,$9,$10,NULL)`,
    [
      company.name,
      company.email,
      company.phone,
      company.id,
      createdBy,
      company.nip,
      company.address,
      company.postal_code,
      company.city,
      company.country
    ]
  );
}

router.get("/", asyncHandler(async (req, res) => {
  if (req.currentUser.role === "ADMIN") {
    const result = await db.query(`${companySelect} ORDER BY created_at DESC`);
    return res.json(result.rows);
  }
  if (!req.currentUser.company_id) return res.json([]);
  const result = await db.query(`${companySelect} AND companies.id=$1`, [req.currentUser.company_id]);
  res.json(result.rows);
}));

router.get("/own", requireRole("ADMIN"), asyncHandler(async (_req, res) => {
  let result = await db.query("SELECT * FROM companies WHERE is_own_company = TRUE ORDER BY id ASC LIMIT 1");
  if (!result.rows[0]) {
    result = await db.query(
      `INSERT INTO companies (name, address, city, country, email, is_own_company, is_active)
       VALUES ($1, '', '', 'Polska', '', TRUE, TRUE)
       RETURNING *`,
      ["Prestige Systems"]
    );
  }
  res.json(result.rows[0]);
}));

router.put("/own", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const { name, address, nip, postal_code, city, country, email } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nazwa naszej firmy jest wymagana." });

  let existing = await db.query("SELECT id FROM companies WHERE is_own_company = TRUE ORDER BY id ASC LIMIT 1");
  if (!existing.rows[0]) {
    existing = await db.query("INSERT INTO companies (name, is_own_company) VALUES ($1, TRUE) RETURNING id", [name.trim()]);
  }

  const result = await db.query(
    `UPDATE companies SET
      name=$1, address=$2, nip=$3, postal_code=$4, city=$5, country=$6, email=$7,
      contact_person=NULL, phone=NULL, website=NULL, bank_account=NULL, description=NULL,
      is_own_company=TRUE, updated_at=CURRENT_TIMESTAMP
     WHERE id=$8
     RETURNING *`,
    [name.trim(), address || null, nip || null, postal_code || null, city || null, country || "Polska", email || null, existing.rows[0].id]
  );
  res.json(result.rows[0]);
}));

router.get("/my-company", asyncHandler(async (req, res) => {
  if (!req.currentUser.company_id) return res.json({ company: null, contacts: [] });
  const companyResult = await db.query(`${companySelect} AND companies.id=$1`, [req.currentUser.company_id]);
  const contactsResult = await db.query(
    `SELECT id, first_name, last_name, email, phone, role, is_active
     FROM users
     WHERE company_id=$1 AND role IN ('CLIENT_OWNER', 'CLIENT_EMPLOYEE')
     ORDER BY last_name, first_name`,
    [req.currentUser.company_id]
  );
  res.json({ company: companyResult.rows[0] || null, contacts: contactsResult.rows });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  if (req.currentUser.role !== "ADMIN" && Number(req.currentUser.company_id) !== Number(req.params.id)) {
    return res.status(403).json({ error: "Brak dostępu do tej firmy." });
  }
  const result = await db.query(`${companySelect} AND companies.id=$1`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: "Firma nie znaleziona." });
  res.json(result.rows[0]);
}));

router.post("/", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const company = mapCompanyBody(req.body);
  if (!company.name) return res.status(400).json({ error: "Nazwa firmy jest wymagana." });

  const client = await db.connect();
  let createdCompany;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO companies (
        name, nip, regon, address, postal_code, city, country, email, phone, description,
        is_active, created_by, is_own_company
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE)
       RETURNING *`,
      [
        company.name, company.nip, company.regon, company.address, company.postal_code, company.city,
        company.country, company.email, company.phone, company.description, company.is_active, req.currentUser.id
      ]
    );
    createdCompany = result.rows[0];
    await createPrimaryCustomer(createdCompany, req.currentUser.id, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: "Nie udało się utworzyć firmy." });
  } finally {
    client.release();
  }

  await notifyAdmins({
    category: "COMPANIES",
    type: "COMPANY_CREATED",
    priority: "INFO",
    title: "Dodano firmę",
    message: createdCompany.name,
    entityType: "company",
    entityId: createdCompany.id,
    link: `/companies/${createdCompany.id}`
  });
  await writeAuditLog({
    category: "COMPANY",
    action: "COMPANY_CREATED",
    userId: req.currentUser.id,
    companyId: createdCompany.id,
    entityType: "company",
    entityId: createdCompany.id,
    message: `Dodano firme ${createdCompany.name}`
  }).catch((error) => console.error("Global audit log failed:", error));
  res.status(201).json(createdCompany);
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const role = normalizeRole(req.currentUser.role);
  const isAdmin = role === "ADMIN";
  const isOwnerOfCompany = role === "CLIENT_OWNER" && Number(req.currentUser.company_id) === Number(req.params.id);
  if (!isAdmin && !isOwnerOfCompany) {
    return res.status(403).json({ error: "Brak dostępu do tej firmy." });
  }
  const company = mapCompanyBody(req.body);
  if (!company.name) return res.status(400).json({ error: "Nazwa firmy jest wymagana." });

  const result = await db.query(
    `UPDATE companies SET
      name=$1, nip=$2, regon=$3, address=$4, postal_code=$5, city=$6, country=$7,
      email=$8, phone=$9, description=$10, is_active=$11, updated_at=CURRENT_TIMESTAMP
     WHERE id=$12 AND COALESCE(is_own_company, FALSE) = FALSE
     RETURNING *`,
    [
      company.name, company.nip, company.regon, company.address, company.postal_code, company.city,
      company.country, company.email, company.phone, company.description, company.is_active, req.params.id
    ]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Firma nie znaleziona." });
  await writeAuditLog({
    category: "COMPANY",
    action: "COMPANY_UPDATED",
    userId: req.currentUser.id,
    companyId: result.rows[0].id,
    entityType: "company",
    entityId: result.rows[0].id,
    message: `Zaktualizowano firme ${result.rows[0].name}`
  }).catch((error) => console.error("Global audit log failed:", error));
  res.json(result.rows[0]);
}));

router.delete("/:id", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const companyId = Number(req.params.id);
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const company = await client.query(
      "SELECT id FROM companies WHERE id=$1 AND COALESCE(is_own_company, FALSE)=FALSE FOR UPDATE",
      [companyId]
    );
    if (!company.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Firma nie znaleziona." });
    }

    const customers = await client.query("SELECT id FROM customers WHERE company_id=$1", [companyId]);
    const customerIds = customers.rows.map((customer) => customer.id);
    const customerIdArray = customerIds.length ? customerIds : [0];

    await client.query(
      `DELETE FROM ticket_photos
       WHERE ticket_id IN (SELECT id FROM tickets WHERE customer_id = ANY($1::int[]))`,
      [customerIdArray]
    );
    await client.query("DELETE FROM tickets WHERE customer_id = ANY($1::int[])", [customerIdArray]);

    await client.query(
      `DELETE FROM photos
       WHERE offer_id IN (SELECT id FROM offers WHERE customer_id = ANY($1::int[]))`,
      [customerIdArray]
    );
    await client.query(
      `DELETE FROM comments
       WHERE offer_id IN (SELECT id FROM offers WHERE customer_id = ANY($1::int[]))`,
      [customerIdArray]
    );
    await client.query(
      `DELETE FROM rejections
       WHERE offer_id IN (SELECT id FROM offers WHERE customer_id = ANY($1::int[]))`,
      [customerIdArray]
    );
    await client.query(
      `DELETE FROM offer_items
       WHERE offer_id IN (SELECT id FROM offers WHERE customer_id = ANY($1::int[]))`,
      [customerIdArray]
    );
    await client.query("DELETE FROM offers WHERE customer_id = ANY($1::int[])", [customerIdArray]);

    await client.query(
      `DELETE FROM user_site_access
       WHERE site_id IN (SELECT id FROM objects WHERE company_id=$1)
          OR user_id IN (SELECT id FROM users WHERE company_id=$1)`,
      [companyId]
    );
    await client.query(
      "DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE company_id=$1)",
      [companyId]
    );
    await client.query("DELETE FROM objects WHERE company_id=$1", [companyId]);
    await client.query("DELETE FROM customers WHERE company_id=$1", [companyId]);
    await client.query("DELETE FROM users WHERE company_id=$1 AND role IN ('CLIENT_OWNER', 'CLIENT_EMPLOYEE', 'USER')", [companyId]);

    await client.query("DELETE FROM companies WHERE id=$1", [companyId]);
    await client.query("COMMIT");

    res.status(204).send();
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Błąd przy usuwaniu firmy:", err);
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  } finally {
    client.release();
  }
}));

router.get("/:companyId/customers", requireCompanyAccess("companyId"), asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT id, name, email, phone, company_role, contact_person
     FROM customers
     WHERE company_id=$1
     ORDER BY name`,
    [req.params.companyId]
  );
  res.json(result.rows);
}));

router.get("/:companyId/users", requireCompanyAccess("companyId"), requireRole("ADMIN", "CLIENT_OWNER"), asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT id, company_id, role, first_name, last_name, email, phone, is_active, created_at, updated_at
     FROM users
     WHERE company_id=$1 AND role IN ('CLIENT_OWNER', 'CLIENT_EMPLOYEE')
     ORDER BY last_name, first_name`,
    [req.params.companyId]
  );
  res.json(result.rows);
}));

router.post("/:companyId/users", requireCompanyAccess("companyId"), requireRole("ADMIN", "CLIENT_OWNER"), asyncHandler(async (req, res) => {
  const role = normalizeRole(req.body.role || "CLIENT_EMPLOYEE");
  const { firstName, lastName, email, phone, password, isActive = true } = req.body;

  if (!["CLIENT_OWNER", "CLIENT_EMPLOYEE"].includes(role)) {
    return res.status(400).json({ error: "Niepoprawna rola pracownika." });
  }
  if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: "Imię, nazwisko, e-mail i hasło są wymagane." });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO users (
        username, email, password, password_hash, company_id, role,
        first_name, last_name, phone, is_active
       )
       VALUES ($1,$1,$2,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, company_id, role, first_name, last_name, email, phone, is_active, created_at`,
      [email.trim(), passwordHash, req.params.companyId, role, firstName.trim(), lastName.trim(), phone || null, Boolean(isActive)]
    );
    const createdUser = result.rows[0];
    await notifyAdmins({
      category: "COMPANIES",
      type: "COMPANY_EMPLOYEE_ADDED",
      priority: "INFO",
      title: "Dodano pracownika firmy",
      message: `${createdUser.first_name} ${createdUser.last_name}`.trim() || createdUser.email,
      entityType: "company",
      entityId: req.params.companyId,
      link: `/companies/${req.params.companyId}`
    });
    res.status(201).json(createdUser);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Użytkownik z takim e-mailem już istnieje." });
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
}));

router.put("/:companyId/users/:userId", requireCompanyAccess("companyId"), requireRole("ADMIN", "CLIENT_OWNER"), asyncHandler(async (req, res) => {
  const role = normalizeRole(req.body.role || "CLIENT_EMPLOYEE");
  const { firstName, lastName, email, phone, password, isActive = true } = req.body;
  if (!["CLIENT_OWNER", "CLIENT_EMPLOYEE"].includes(role)) {
    return res.status(400).json({ error: "Niepoprawna rola pracownika." });
  }

  const values = [role, firstName || "", lastName || "", email || "", phone || null, Boolean(isActive), req.params.companyId, req.params.userId];
  let passwordSql = "";
  if (password?.trim()) {
    const passwordHash = await bcrypt.hash(password, 10);
    values.push(passwordHash);
    passwordSql = ", password=$9, password_hash=$9, password_changed_at=CURRENT_TIMESTAMP";
  }

  const result = await db.query(
    `UPDATE users SET
      role=$1, first_name=$2, last_name=$3, email=$4, username=$4, phone=$5,
      is_active=$6, updated_at=CURRENT_TIMESTAMP${passwordSql}
     WHERE company_id=$7 AND id=$8 AND role IN ('CLIENT_OWNER', 'CLIENT_EMPLOYEE')
     RETURNING id, company_id, role, first_name, last_name, email, phone, is_active, updated_at`,
    values
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Pracownik nie znaleziony." });
  res.json(result.rows[0]);
}));

router.delete("/:companyId/users/:userId", requireCompanyAccess("companyId"), requireRole("ADMIN", "CLIENT_OWNER"), asyncHandler(async (req, res) => {
  const result = await db.query(
    "DELETE FROM users WHERE company_id=$1 AND id=$2 AND role IN ('CLIENT_OWNER', 'CLIENT_EMPLOYEE')",
    [req.params.companyId, req.params.userId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Pracownik nie znaleziony." });
  res.status(204).send();
}));

router.get("/:companyId/sites", requireCompanyAccess("companyId"), asyncHandler(async (req, res) => {
  const params = [req.params.companyId];
  let accessSql = "";
  if (req.currentUser.role === "CLIENT_EMPLOYEE") {
    params.push(req.currentUser.id);
    accessSql = `AND EXISTS (
      SELECT 1 FROM user_site_access usa
      WHERE usa.site_id=o.id AND usa.user_id=$2
    )`;
  }
  const result = await db.query(
    `SELECT id, company_id, name, address, postal_code, city, country, description, image_url, is_active, created_at, updated_at,
            (
              SELECT COUNT(*)::int
              FROM user_site_access usa
              WHERE usa.site_id=o.id
            ) AS assigned_employee_count
     FROM objects o
     WHERE company_id=$1 ${accessSql}
     ORDER BY created_at DESC`,
    params
  );
  res.json(result.rows.map((site) => ({ ...site, imageUrl: site.image_url })));
}));

router.post("/:companyId/sites", requireCompanyAccess("companyId"), requirePermission("MANAGE_SITES"), asyncHandler(async (req, res) => {
  const { name, address, postal_code, postalCode, city, description, is_active, isActive } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nazwa obiektu jest wymagana." });

  try {
    const result = await db.query(
      `INSERT INTO objects (company_id, name, address, postal_code, city, description, is_active, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'AKTYWNY',$8)
       RETURNING *`,
      [
        req.params.companyId,
        name.trim(),
        address || null,
        postal_code || postalCode || null,
        city || null,
        description || null,
        is_active ?? isActive ?? true,
        req.currentUser.id
      ]
    );
    const createdSite = result.rows[0];
    await notifyAdmins({
      category: "COMPANIES",
      type: "COMPANY_SITE_ADDED",
      priority: "INFO",
      title: "Dodano obiekt firmy",
      message: createdSite.name,
      entityType: "company",
      entityId: req.params.companyId,
      link: `/companies/${req.params.companyId}`
    });
    res.status(201).json(createdSite);
  } catch (err) {
    console.error("Błąd przy tworzeniu obiektu firmy:", err);
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
}));

router.get("/:companyId/offers", requireCompanyAccess("companyId"), asyncHandler(async (req, res) => {
  const result = await db.query(
     `SELECT
       o.id,
       o.offer_number,
       o.title,
       o.object_id,
       obj.name AS object_name,
       c.name AS customer_name,
       o.client_company_name,
       o.issue_date,
       o.created_at,
       o.updated_at,
       o.valid_until,
       o.status,
       o.total_price,
       o.currency,
       COALESCE((
         SELECT SUM(oi.vat_value)
         FROM offer_items oi
         WHERE oi.offer_id=o.id
       ), 0) AS vat_total,
       COALESCE((
         SELECT SUM(oi.gross_total)
         FROM offer_items oi
         WHERE oi.offer_id=o.id
       ), o.total_price) AS gross_total,
       o.prepared_by_name,
       o.salesperson
     FROM offers o
     JOIN customers c ON c.id=o.customer_id
     LEFT JOIN objects obj ON obj.id=o.object_id
     WHERE c.company_id=$1
     ORDER BY o.created_at DESC`,
    [req.params.companyId]
  );
  res.json(result.rows);
}));

router.get("/:companyId/tickets", requireCompanyAccess("companyId"), asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT
       t.id,
       t.ticket_number,
       t.type,
       t.subject,
       t.object_id,
       t.status,
       t.created_at
     FROM tickets t
     JOIN customers c ON c.id=t.customer_id
     WHERE c.company_id=$1
     ORDER BY t.created_at DESC`,
    [req.params.companyId]
  );
  res.json(result.rows);
}));

export default router;
