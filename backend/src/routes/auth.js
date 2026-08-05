import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { getEffectivePermissions, normalizeRole } from "../middleware/access.js";

const router = express.Router();
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("invalid-login-placeholder", 12);

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
    return res.status(400).json({ error: "Nazwa użytkownika i hasło są wymagane." });
  }
  if (username.length > 254 || password.length > 256) return res.status(400).json({ error: "Nieprawidłowe dane logowania." });

  try {
    const userResult = await db.query(
      `SELECT * FROM users
       WHERE LOWER(COALESCE(email, username)) = LOWER($1)
          OR LOWER(username) = LOWER($1)`,
      [username]
    );
    if (userResult.rows.length === 0) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return res.status(401).json({ error: "Nieprawidłowy login lub hasło." });
    }

    const user = userResult.rows[0];
    if (user.is_active === false) {
      return res.status(403).json({ error: "Konto jest nieaktywne." });
    }

    const passwordHash = user.password_hash || user.password;
    const isMatch = await bcrypt.compare(password, passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: "Nieprawidłowy login lub hasło." });
    }

    await db.query("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=$1", [user.id]);
    const permissions = [...await getEffectivePermissions(user)].sort();

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        role: normalizeRole(user.role),
        companyId: user.company_id || null
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "8h",
        algorithm: "HS256",
        issuer: "prestige-systems-hub",
        audience: "prestige-systems-hub-api"
      }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        role: normalizeRole(user.role),
        companyId: user.company_id || null,
        permissions
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd serwera podczas logowania." });
  }
});

router.get("/me", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Brak tokenu" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"], issuer: "prestige-systems-hub", audience: "prestige-systems-hub-api"
    });
    const result = await db.query(
      `SELECT id, username, first_name, last_name, email, phone, role, company_id, is_active
       FROM users
       WHERE id=$1`,
      [decoded.id]
    );
    const user = result.rows[0];
    if (!user || user.is_active === false) return res.status(401).json({ error: "Konto nieaktywne." });
    const permissions = [...await getEffectivePermissions(user)].sort();
    res.json({
      id: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      phone: user.phone,
      role: normalizeRole(user.role),
      companyId: user.company_id || null,
      permissions
    });
  } catch {
    res.status(401).json({ error: "Błędny token" });
  }
});

export default router;
