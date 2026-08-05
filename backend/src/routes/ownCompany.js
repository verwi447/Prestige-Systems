import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";

const router = express.Router();

router.use(auth, loadCurrentUser, requireRole("ADMIN"));

const defaultOwnCompany = {
  name: "Prestige Systems",
  nip: "123-456-78-90",
  regon: "123456789",
  address: "ul. Przykładowa 123, 60-001 Poznań",
  email: "biuro@prestigesystems.pl",
  phone: "+48 123 456 789",
  website: "https://prestigesystems.pl",
  additionalInfo: "Nowoczesne rozwiązania dla parkingów."
};

async function ensureOwnCompany() {
  let result = await db.query("SELECT * FROM own_company ORDER BY id ASC LIMIT 1");
  if (result.rows[0]) {
    const company = result.rows[0];
    if (!company.nip && !company.address && !company.email) {
      result = await db.query(
        `UPDATE own_company SET
          nip=$1, regon=$2, address=$3, email=$4, phone=$5, website=$6,
          additional_info=$7, updated_at=CURRENT_TIMESTAMP
         WHERE id=$8
         RETURNING *`,
        [
          defaultOwnCompany.nip,
          defaultOwnCompany.regon,
          defaultOwnCompany.address,
          defaultOwnCompany.email,
          defaultOwnCompany.phone,
          defaultOwnCompany.website,
          defaultOwnCompany.additionalInfo,
          company.id
        ]
      );
    }
    return result.rows[0];
  }
  result = await db.query(
    `INSERT INTO own_company (name, nip, regon, address, email, phone, website, additional_info)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      defaultOwnCompany.name,
      defaultOwnCompany.nip,
      defaultOwnCompany.regon,
      defaultOwnCompany.address,
      defaultOwnCompany.email,
      defaultOwnCompany.phone,
      defaultOwnCompany.website,
      defaultOwnCompany.additionalInfo
    ]
  );
  return result.rows[0];
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.get("/", async (_req, res) => {
  res.json(await ensureOwnCompany());
});

router.put("/", async (req, res) => {
  const { logoUrl, name, nip, regon, address, email, phone, website, additionalInfo } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nazwa naszej firmy jest wymagana." });
  if (!nip?.trim()) return res.status(400).json({ error: "NIP jest wymagany." });
  if (!address?.trim()) return res.status(400).json({ error: "Adres jest wymagany." });
  if (!email?.trim()) return res.status(400).json({ error: "E-mail jest wymagany." });
  if (!isValidEmail(email.trim())) return res.status(400).json({ error: "Podaj poprawny adres e-mail." });

  const existing = await ensureOwnCompany();
  const result = await db.query(
    `UPDATE own_company SET
      logo_url=$1, name=$2, nip=$3, regon=$4, address=$5, email=$6,
      phone=$7, website=$8, additional_info=$9, updated_at=CURRENT_TIMESTAMP
     WHERE id=$10
     RETURNING *`,
    [
      logoUrl || null,
      name.trim(),
      nip.trim(),
      regon?.trim() || null,
      address.trim(),
      email.trim(),
      phone?.trim() || null,
      website?.trim() || null,
      additionalInfo?.trim() || null,
      existing.id
    ]
  );
  res.json(result.rows[0]);
});

export default router;
