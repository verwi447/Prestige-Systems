import jwt from "jsonwebtoken";
import { db } from "../db.js";

export async function auth(req, res, next) {
  const authorization = String(req.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  const token = match?.[1];
  if (!token) return res.status(401).json({ error: "Brak tokenu" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "prestige-systems-hub",
      audience: "prestige-systems-hub-api"
    });
    const result = await db.query(
      `SELECT id, username, email, role, company_id, is_active
       FROM users WHERE id=$1`,
      [decoded.id]
    );
    const user = result.rows[0];
    if (!user || user.is_active === false) return res.status(401).json({ error: "Sesja jest nieważna." });
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role === "USER" ? "CLIENT_EMPLOYEE" : user.role,
      companyId: user.company_id || null,
      company_id: user.company_id || null
    };
    next();
  } catch {
    res.status(401).json({ error: "Błędny token" });
  }
}
