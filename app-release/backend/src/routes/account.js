import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser } from "../middleware/access.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = express.Router();

router.use(auth, loadCurrentUser);

const normalizeAccount = (row) => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  email: row.email || row.username,
  username: row.username,
  phone: row.phone,
  role: row.role,
  isActive: row.is_active !== false,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
  company: row.company_id ? { id: row.company_id, name: row.company_name } : null,
  passwordChangedAt: row.password_changed_at
});

router.get("/", asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT u.id, u.username, u.role, u.company_id, u.first_name, u.last_name, u.email, u.phone,
            u.is_active, u.last_login_at, u.created_at, u.password_changed_at, c.name AS company_name
     FROM users u
     LEFT JOIN companies c ON c.id=u.company_id
     WHERE u.id=$1`,
    [req.currentUser.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Konto nie istnieje." });
  res.json(normalizeAccount(result.rows[0]));
}));

router.patch("/", asyncHandler(async (req, res) => {
  const firstName = String(req.body.firstName ?? req.body.first_name ?? "").trim();
  const lastName = String(req.body.lastName ?? req.body.last_name ?? "").trim();
  const phone = String(req.body.phone ?? "").trim() || null;

  if (!firstName || !lastName) {
    return res.status(400).json({ error: "Imie i nazwisko sa wymagane." });
  }

  const result = await db.query(
    `UPDATE users
     SET first_name=$1, last_name=$2, phone=$3, updated_at=CURRENT_TIMESTAMP
     WHERE id=$4
     RETURNING id, username, role, company_id, first_name, last_name, email, phone, is_active, last_login_at, created_at, password_changed_at,
       (SELECT name FROM companies WHERE id=users.company_id) AS company_name`,
    [firstName, lastName, phone, req.currentUser.id]
  );
  res.json(normalizeAccount(result.rows[0]));
}));

const passwordRules = (password) => ({
  minLength: String(password || "").length >= 8,
  upper: /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(password || ""),
  lower: /[a-ząćęłńóśźż]/.test(password || ""),
  digit: /\d/.test(password || ""),
  special: /[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9]/.test(password || "")
});

router.post("/change-password", asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  const confirmPassword = String(req.body.confirmPassword || "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: "Wszystkie pola hasla sa wymagane." });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: "Nowe hasla nie sa zgodne." });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: "Nowe haslo musi byc inne niz obecne." });
  }
  const rules = passwordRules(newPassword);
  if (!Object.values(rules).every(Boolean)) {
    return res.status(400).json({ error: "Nowe haslo nie spelnia wymagan bezpieczenstwa." });
  }

  const user = await db.query("SELECT id, password, password_hash FROM users WHERE id=$1", [req.currentUser.id]);
  if (!user.rows[0]) return res.status(404).json({ error: "Konto nie istnieje." });

  const hash = user.rows[0].password_hash || user.rows[0].password;
  const matches = await bcrypt.compare(currentPassword, hash || "");
  if (!matches) {
    return res.status(401).json({ error: "Obecne haslo jest nieprawidlowe." });
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await db.query("UPDATE users SET password=$1, password_hash=$1, password_changed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$2", [newHash, req.currentUser.id]);
  res.json({ message: "Haslo zostalo zmienione." });
}));

router.get("/notification-preferences", asyncHandler(async (req, res) => {
  const result = await db.query(
    `INSERT INTO account_notification_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING *`,
    [req.currentUser.id]
  );
  const preferences = result.rows[0] || (await db.query("SELECT * FROM account_notification_preferences WHERE user_id=$1", [req.currentUser.id])).rows[0];
  res.json(preferences);
}));

router.put("/notification-preferences", asyncHandler(async (req, res) => {
  const values = {
    inApp: req.body.inApp !== false,
    email: req.body.email === true,
    offers: req.body.offers !== false,
    tickets: req.body.tickets !== false,
    comments: req.body.comments !== false,
    system: req.body.system !== false
  };
  const result = await db.query(
    `INSERT INTO account_notification_preferences (user_id, in_app, email, offers, tickets, comments, system, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET
       in_app=EXCLUDED.in_app, email=EXCLUDED.email, offers=EXCLUDED.offers,
       tickets=EXCLUDED.tickets, comments=EXCLUDED.comments, system=EXCLUDED.system,
       updated_at=CURRENT_TIMESTAMP
     RETURNING *`,
    [req.currentUser.id, values.inApp, values.email, values.offers, values.tickets, values.comments, values.system]
  );

  await Promise.all([
    { category: "OFFERS", enabled: values.inApp && values.offers },
    { category: "TICKETS", enabled: values.inApp && values.tickets }
  ].map(({ category, enabled }) => db.query(
    `INSERT INTO notification_preferences (user_id, category, in_app_enabled, email_enabled)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, category) DO UPDATE SET
       in_app_enabled=EXCLUDED.in_app_enabled,
       email_enabled=EXCLUDED.email_enabled,
       updated_at=CURRENT_TIMESTAMP`,
    [req.currentUser.id, category, enabled, values.email && enabled]
  )));

  res.json(result.rows[0]);
}));

router.get("/sessions", (_req, res) => {
  res.json([]);
});

router.delete("/sessions/:id", (_req, res) => {
  res.status(404).json({ error: "Zarzadzanie sesjami nie jest jeszcze dostepne." });
});

router.get("/activity", asyncHandler(async (req, res) => {
  const userId = req.currentUser.id;
  const [comments, ticketComments, offers] = await Promise.all([
    db.query("SELECT id, created_at FROM comments WHERE author_id=$1 ORDER BY created_at DESC LIMIT 5", [userId]),
    db.query("SELECT id, created_at FROM ticket_comments WHERE author_id=$1 ORDER BY created_at DESC LIMIT 5", [userId]),
    db.query("SELECT id, offer_number, status, updated_at FROM offers WHERE updated_at IS NOT NULL AND created_by=$1 ORDER BY updated_at DESC LIMIT 5", [userId])
  ]);
  const activity = [
    { id: "login", type: "LOGIN", label: "Zalogowano do systemu", createdAt: req.currentUser.last_login_at || req.currentUser.created_at },
    ...comments.rows.map((row) => ({ id: `comment-${row.id}`, type: "COMMENT", label: "Dodano komentarz do oferty", createdAt: row.created_at })),
    ...ticketComments.rows.map((row) => ({ id: `ticket-comment-${row.id}`, type: "COMMENT", label: "Dodano komentarz do zgloszenia", createdAt: row.created_at })),
    ...offers.rows.map((row) => ({ id: `offer-${row.id}`, type: "OFFER", label: `Zmieniono status oferty ${row.offer_number || row.id}: ${row.status}`, createdAt: row.updated_at }))
  ].filter((item) => item.createdAt).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);
  res.json(activity);
}));

export default router;
