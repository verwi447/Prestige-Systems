import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";

import { autoAsyncRoutes } from "../utils/autoAsyncRoutes.js";

// Accounts that belong to our own company (company_id IS NULL) are managed by
// one router, parameterised by role: /api/admins serves ADMIN, /api/accountants
// serves ACCOUNTANT. Only ADMIN may call either of them.
const STAFF_ROLES = {
  ADMIN: {
    notFound: "Administrator nie znaleziony.",
    exists: "Administrator z takim e-mailem już istnieje.",
    listFailed: "Nie udało się pobrać administratorów.",
    createFailed: "Nie udało się utworzyć administratora.",
    saveFailed: "Nie udało się zapisać administratora.",
    deleteFailed: "Nie udało się usunąć administratora.",
    // Locking yourself out of the panel has to stay impossible.
    protectLastActive: true
  },
  ACCOUNTANT: {
    notFound: "Konto księgowe nie znalezione.",
    exists: "Konto z takim e-mailem już istnieje.",
    listFailed: "Nie udało się pobrać kont księgowych.",
    createFailed: "Nie udało się utworzyć konta księgowego.",
    saveFailed: "Nie udało się zapisać konta księgowego.",
    deleteFailed: "Nie udało się usunąć konta księgowego.",
    // An accountant cannot administer anything, so there is nothing to protect.
    protectLastActive: false
  }
};

const normalizeEmail = (email = "") => email.trim().toLowerCase();

async function ensureColumns() {
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP");
}

async function emailTaken(email, currentId = null) {
  const params = [normalizeEmail(email)];
  let idSql = "";
  if (currentId) {
    params.push(currentId);
    idSql = "AND id<>$2";
  }
  const result = await db.query(
    `SELECT id FROM users WHERE LOWER(email)=LOWER($1) ${idSql} LIMIT 1`,
    params
  );
  return result.rowCount > 0;
}

async function assertCanDeactivate(role, labels, accountId) {
  const target = await db.query(
    "SELECT id, is_active FROM users WHERE id=$1 AND role=$2 AND company_id IS NULL",
    [accountId, role]
  );
  if (!target.rows[0]) return { ok: false, status: 404, error: labels.notFound };
  if (!labels.protectLastActive) return { ok: true };

  const active = await db.query(
    "SELECT COUNT(*)::int AS count FROM users WHERE role=$1 AND company_id IS NULL AND is_active IS DISTINCT FROM FALSE",
    [role]
  );
  if (target.rows[0].is_active !== false && active.rows[0].count <= 1) {
    return { ok: false, status: 400, error: "Nie można dezaktywować ostatniego aktywnego administratora." };
  }
  return { ok: true };
}

async function tableColumnExists(tableName, columnName) {
  const result = await db.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2
     LIMIT 1`,
    [tableName, columnName]
  );
  return result.rowCount > 0;
}

async function assertCanDeleteAccount(req, role, labels, accountId) {
  if (Number(req.currentUser?.id) === Number(accountId)) {
    return { ok: false, status: 400, error: "Nie można usunąć własnego konta administratora." };
  }

  const target = await db.query(
    "SELECT id, is_active FROM users WHERE id=$1 AND role=$2 AND company_id IS NULL",
    [accountId, role]
  );
  if (!target.rows[0]) return { ok: false, status: 404, error: labels.notFound };

  if (labels.protectLastActive && target.rows[0].is_active !== false) {
    const active = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM users
       WHERE role=$1 AND company_id IS NULL AND is_active IS DISTINCT FROM FALSE AND id<>$2`,
      [role, accountId]
    );
    if (active.rows[0].count < 1) {
      return { ok: false, status: 400, error: "Nie można usunąć ostatniego aktywnego administratora." };
    }
  }

  return { ok: true };
}

export function createStaffRouter(role) {
  const labels = STAFF_ROLES[role];
  if (!labels) throw new Error(`Unsupported staff role: ${role}`);

  const router = express.Router();
  autoAsyncRoutes(router);
  router.use(auth, loadCurrentUser, requireRole("ADMIN"));

  router.get("/", async (_req, res) => {
    try {
      await ensureColumns();
      const result = await db.query(
        `SELECT id, first_name, last_name, email, phone, is_active, last_login_at, created_at, updated_at
         FROM users
         WHERE role=$1 AND company_id IS NULL
         ORDER BY created_at DESC`,
        [role]
      );
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: labels.listFailed });
    }
  });

  router.post("/", async (req, res) => {
    const { firstName, lastName, email, phone, password, isActive = true } = req.body;
    const cleanEmail = normalizeEmail(email);

    if (!firstName?.trim() || !lastName?.trim() || !cleanEmail) {
      return res.status(400).json({ error: "Imię, nazwisko i e-mail są wymagane." });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Hasło musi mieć minimum 8 znaków." });
    }

    try {
      await ensureColumns();
      if (await emailTaken(cleanEmail)) {
        return res.status(400).json({ error: labels.exists });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const result = await db.query(
        `INSERT INTO users (
          username, email, password, password_hash, role, company_id,
          first_name, last_name, phone, is_active, updated_at
         )
         VALUES ($1, $1, $2, $2, $7, NULL, $3, $4, $5, $6, CURRENT_TIMESTAMP)
         RETURNING id, first_name, last_name, email, phone, is_active, last_login_at, created_at, updated_at`,
        [cleanEmail, passwordHash, firstName.trim(), lastName.trim(), phone?.trim() || null, Boolean(isActive), role]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: labels.createFailed });
    }
  });

  router.put("/:id", async (req, res) => {
    const { firstName, lastName, email, phone, password, isActive = true } = req.body;
    const cleanEmail = normalizeEmail(email);

    if (!firstName?.trim() || !lastName?.trim() || !cleanEmail) {
      return res.status(400).json({ error: "Imię, nazwisko i e-mail są wymagane." });
    }
    if (password?.trim() && password.length < 8) {
      return res.status(400).json({ error: "Nowe hasło musi mieć minimum 8 znaków." });
    }

    try {
      await ensureColumns();
      if (await emailTaken(cleanEmail, req.params.id)) {
        return res.status(400).json({ error: labels.exists });
      }
      if (Boolean(isActive) === false) {
        const canDeactivate = await assertCanDeactivate(role, labels, req.params.id);
        if (!canDeactivate.ok) return res.status(canDeactivate.status).json({ error: canDeactivate.error });
      }

      const values = [firstName.trim(), lastName.trim(), cleanEmail, phone?.trim() || null, Boolean(isActive), req.params.id, role];
      let passwordSql = "";
      if (password?.trim()) {
        const passwordHash = await bcrypt.hash(password, 10);
        values.push(passwordHash);
        passwordSql = ", password=$8, password_hash=$8, password_changed_at=CURRENT_TIMESTAMP";
      }

      const result = await db.query(
        `UPDATE users SET
          first_name=$1,
          last_name=$2,
          email=$3,
          username=$3,
          phone=$4,
          is_active=$5,
          updated_at=CURRENT_TIMESTAMP
          ${passwordSql}
         WHERE id=$6 AND role=$7 AND company_id IS NULL
         RETURNING id, first_name, last_name, email, phone, is_active, last_login_at, created_at, updated_at`,
        values
      );
      if (!result.rows[0]) return res.status(404).json({ error: labels.notFound });
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: labels.saveFailed });
    }
  });

  router.delete("/:id", async (req, res) => {
    const client = await db.connect();
    try {
      await ensureColumns();
      const canDelete = await assertCanDeleteAccount(req, role, labels, req.params.id);
      if (!canDelete.ok) return res.status(canDelete.status).json({ error: canDelete.error });

      await client.query("BEGIN");
      for (const [tableName, columnName] of [
        ["backup_jobs", "created_by_id"],
        ["backup_audit", "user_id"],
        ["email_logs", "created_by_id"],
        ["companies", "created_by"],
        ["customers", "user_id"],
        ["customers", "created_by"],
        ["objects", "created_by"],
        ["products", "created_by"],
        ["offer_templates", "created_by"],
        ["offers", "created_by"],
        ["tickets", "created_by"],
        ["photos", "uploaded_by"],
        ["comments", "author_id"],
        ["rejections", "rejected_by"]
      ]) {
        if (await tableColumnExists(tableName, columnName)) {
          await client.query(`UPDATE ${tableName} SET ${columnName}=NULL WHERE ${columnName}=$1`, [req.params.id]);
        }
      }

      const result = await client.query(
        `DELETE FROM users
         WHERE id=$1 AND role=$2 AND company_id IS NULL
         RETURNING id, first_name, last_name, email, phone, is_active, last_login_at, created_at, updated_at`,
        [req.params.id, role]
      );
      await client.query("COMMIT");
      res.json(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(err);
      res.status(500).json({ error: labels.deleteFailed });
    } finally {
      client.release();
    }
  });

  return router;
}

export default createStaffRouter("ADMIN");
