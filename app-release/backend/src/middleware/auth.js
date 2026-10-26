import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { normalizeRole } from "./access.js";

export async function auth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: "Brak tokenu" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "prestige-systems-hub",
      audience: "prestige-systems-hub-api"
    });
    // Jeden odczyt uzytkownika na zadanie: te same kolumny, ktorych potrzebuje
    // loadCurrentUser, zeby nie powtarzac niemal identycznego SELECT-a
    // kilkaset milisekund pozniej w tym samym lancuchu middleware.
    const result = await db.query(
      `SELECT id, username, email, role, company_id, first_name, last_name, phone, is_active
       FROM users WHERE id=$1`,
      [decoded.id]
    );
    const user = result.rows[0];
    if (!user || user.is_active === false) return res.status(401).json({ error: "Sesja jest nieważna." });

    const role = normalizeRole(user.role);
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role,
      companyId: user.company_id || null,
      company_id: user.company_id || null
    };
    req.currentUser = { ...user, role };
    next();
  } catch {
    res.status(401).json({ error: "Błędny token" });
  }
}
