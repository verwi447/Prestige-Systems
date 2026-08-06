import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { auth as authMiddleware } from "../middleware/auth.js";
import { getEffectivePermissions, normalizeRole } from "../middleware/access.js";

const router = express.Router();
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("invalid-login-placeholder", 12);
const TOKEN_COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const isHttpsPublicUrl = String(process.env.PUBLIC_BASE_URL || "").trim().toLowerCase().startsWith("https://");
const tokenCookieOptions = {
  httpOnly: true,
  secure: isHttpsPublicUrl,
  sameSite: "lax",
  path: "/"
};

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

    res.cookie("token", token, { ...tokenCookieOptions, maxAge: TOKEN_COOKIE_MAX_AGE_MS });
    res.json({
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

router.post("/logout", (_req, res) => {
  res.clearCookie("token", tokenCookieOptions);
  res.json({ message: "Wylogowano." });
});

router.get("/me", authMiddleware, async (req, res) => {
  const result = await db.query(
    `SELECT id, username, first_name, last_name, email, phone, role, company_id, is_active
     FROM users
     WHERE id=$1`,
    [req.user.id]
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
});

export default router;
