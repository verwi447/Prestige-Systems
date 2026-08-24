import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { logError } from "../logger.js";

import { autoAsyncRoutes } from "../utils/autoAsyncRoutes.js";

const router = express.Router();
autoAsyncRoutes(router);
const requireAdmin = (req, res, next) => req.user?.role === "ADMIN" ? next() : res.status(403).json({ error: "Brak uprawnień." });

// GET all customers
router.get("/", auth, requireAdmin, async (req, res) => {
  try {
    let query = `
      SELECT c.*, co.name as company_name 
      FROM customers c
      LEFT JOIN companies co ON c.company_id = co.id
    `;
    const params = [];

    query += " WHERE COALESCE(co.is_active, TRUE)=TRUE";

    query += ' ORDER BY c.created_at DESC';
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    logError(err, 'backend');
    res.status(500).json({ error: "Błąd serwera przy pobieraniu klientów" });
  }
});

// GET current user's customer profile
router.get("/me", auth, async (req, res) => {
    try {
      const result = await db.query("SELECT * FROM customers WHERE user_id = $1", [req.user.id]);
      if (result.rows.length === 0) {
        // This is not an error, the user might just not be a customer
        return res.status(200).json(null);
      }
      res.json(result.rows[0]);
    } catch (err) {
      logError(err, 'backend');
      res.status(500).json({ error: "Błąd serwera" });
    }
  });

// PUT update current user's customer profile
router.put("/me", auth, async (req, res) => {
    const { name, phone } = req.body;
    const userId = req.user.id;

    if (!name?.trim()) {
        return res.status(400).json({ error: "Nazwa jest wymagana." });
    }

    try {
        const result = await db.query(
            "UPDATE customers SET name = $1, phone = $2 WHERE user_id = $3 RETURNING *",
            [name.trim(), phone, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Profil klienta nie znaleziony." });
        }

        res.json(result.rows[0]);
    } catch (err) {
        logError(err, 'backend');
        res.status(500).json({ error: "Błąd serwera podczas aktualizacji profilu." });
    }
});

// GET customer by id
router.get("/:id", auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM customers WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Klient nie znaleziony" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    logError(err, 'backend');
    res.status(500).json({ error: "Błąd serwera" });
  }
});

// POST create customer, optionally with a new user account for them
router.post("/", auth, requireAdmin, async (req, res) => {
  const {
    name,
    email,
    phone,
    company_id,
    password,
    company_role,
    nip,
    address,
    postal_code,
    city,
    country,
    contact_person
  } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: "Nazwa klienta jest wymagana." });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    let finalCompanyId = company_id;

    if (req.user.role !== 'ADMIN') {
        const creatorCustomerRes = await client.query("SELECT company_id, company_role FROM customers WHERE user_id = $1", [req.user.id]);
        if (creatorCustomerRes.rows.length === 0 || creatorCustomerRes.rows[0].company_role !== 'MANAGER') {
            await client.query("ROLLBACK");
            return res.status(403).json({ error: "Brak uprawnień do tworzenia klientów." });
        }
        const managerCompanyId = creatorCustomerRes.rows[0].company_id;
        if (company_id && company_id != managerCompanyId) {
            await client.query("ROLLBACK");
            return res.status(403).json({ error: "Manager może dodawać klientów tylko do własnej firmy." });
        }
        finalCompanyId = managerCompanyId;
    }

    const trimmedEmail = email?.trim() || null;
    const trimmedName = name.trim();
    let userId = null;

    if (password) {
      if (!trimmedEmail) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "E-mail jest wymagany przy tworzeniu konta klienta." });
      }

      const existingUser = await client.query("SELECT id FROM users WHERE username = $1", [trimmedEmail]);
      if (existingUser.rows.length > 0) {
        throw new Error("Użytkownik z tym adresem email już istnieje.");
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const userResult = await client.query(
        "INSERT INTO users (username, password, password_hash, role) VALUES ($1, $2, $2, $3) RETURNING id",
        [trimmedEmail, hashedPassword, "USER"]
      );
      userId = userResult.rows[0].id;
    }

    const customerResult = await client.query(
      `INSERT INTO customers (
        name, email, phone, company_id, user_id, company_role, created_by,
        nip, address, postal_code, city, country, contact_person
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        trimmedName,
        trimmedEmail,
        phone || null,
        finalCompanyId || null,
        userId,
        company_role || 'PRACOWNIK',
        req.user.id,
        nip || null,
        address || null,
        postal_code || null,
        city || null,
        country || null,
        contact_person || null
      ]
    );

    await client.query("COMMIT");
    res.status(201).json(customerResult.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    logError(err, 'backend');

    if (err.message?.includes("Użytkownik z tym adresem email już istnieje")) {
        return res.status(409).json({ error: err.message });
    }
    if (err.code === '23503') {
      return res.status(400).json({ error: "Błąd powiązania danych. Upewnij się, że wybrana firma istnieje, a Twoje konto jest aktywne." });
    }

    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  } finally {
    client.release();
  }
});

// PUT update customer (used for assigning to a company or changing role)
router.put("/:id", auth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { company_id, company_role } = req.body;

  const fieldsToUpdate = [];
  const values = [];
  let paramIndex = 1;

  // We check for `undefined` to allow setting company_id to `null` (un-assigning)
  if (Object.prototype.hasOwnProperty.call(req.body, "company_id")) {
    fieldsToUpdate.push(`company_id = $${paramIndex++}`);
    values.push(company_id);
  }

  if (company_role) {
    fieldsToUpdate.push(`company_role = $${paramIndex++}`);
    values.push(company_role);
  }

  if (fieldsToUpdate.length === 0) {
    return res.status(400).json({ error: "Brak danych do aktualizacji." });
  }

  values.push(id);

  const updateQuery = `UPDATE customers SET ${fieldsToUpdate.join(", ")} WHERE id = $${paramIndex} RETURNING *`;

  try {
    const result = await db.query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Klient nie znaleziony" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    logError(err, 'backend');
    res.status(500).json({ error: "Błąd serwera przy aktualizacji klienta." });
  }
});

// DELETE customer
router.delete("/:id", auth, requireAdmin, async (req, res) => {
  try {
    // The user account associated with the customer will remain, 
    // as per ON DELETE SET NULL in the database schema.
    const result = await db.query("DELETE FROM customers WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Klient nie znaleziony" });
    }
    res.status(204).send();
  } catch (err) {
    logError(err, 'backend');
    res.status(500).json({ error: "Błąd serwera przy usuwaniu klienta" });
  }
});

export default router;
