import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { autoAsyncRoutes } from "../utils/autoAsyncRoutes.js";

const router = express.Router();
autoAsyncRoutes(router);

const uploadDir = path.join(__dirname, "../../uploads/articles");
fs.mkdirSync(uploadDir, { recursive: true });

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return cb(new Error("Obsługiwane formaty zdjęć: JPG, PNG, WEBP."));
    }
    cb(null, true);
  }
});

const isAdmin = (req) => req.user?.role === "ADMIN";

const slugify = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes", "tak"].includes(value.toLowerCase());
  return Boolean(value);
};

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const mapProductBody = (body = {}) => ({
  name: body.name?.trim(),
  category_id: body.category_id || body.categoryId || null,
  image_url: body.image_url ?? body.imageUrl ?? null,
  description: body.description || null,
  code: body.code || null,
  unit: body.unit || "szt.",
  catalog_price: toNumber(body.catalog_price ?? body.catalogPrice, 0),
  sale_price: toNumber(body.sale_price ?? body.salePrice, 0),
  vat_rate: toNumber(body.vat_rate ?? body.vatRate, 23),
  visible_for_clients: toBool(body.visible_for_clients ?? body.visibleForClients, false),
  show_price_to_client: toBool(body.show_price_to_client ?? body.showPriceToClient, false),
  active: toBool(body.active, true)
});

const productSelect = `
  SELECT
    p.id,
    p.name,
    p.description,
    p.catalog_price,
    p.sale_price,
    p.code,
    p.unit,
    p.vat_rate,
    p.image_url,
    p.visible_for_clients,
    p.show_price_to_client,
    p.active,
    p.category_id,
    p.created_at,
    p.updated_at,
    c.name AS category_name,
    c.slug AS category_slug,
    c.description AS category_description
  FROM products p
  LEFT JOIN article_categories c ON c.id=p.category_id
`;

function formatProduct(product, adminView) {
  const formatted = {
    ...product,
    imageUrl: product.image_url,
    categoryId: product.category_id,
    catalogPrice: product.catalog_price,
    salePrice: product.sale_price,
    vatRate: product.vat_rate,
    visibleForClients: product.visible_for_clients,
    showPriceToClient: product.show_price_to_client,
    category: product.category_id
      ? {
          id: product.category_id,
          name: product.category_name,
          slug: product.category_slug,
          description: product.category_description
        }
      : null
  };

  if (!adminView && !product.show_price_to_client) {
    delete formatted.catalog_price;
    delete formatted.sale_price;
    delete formatted.catalogPrice;
    delete formatted.salePrice;
  }

  return formatted;
}

router.get("/categories", auth, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, slug, description, sort_order, active
       FROM article_categories
       WHERE active=TRUE
       ORDER BY sort_order, name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd serwera przy pobieraniu kategorii." });
  }
});

router.post("/categories", auth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Brak uprawnien." });

  const name = req.body.name?.trim();
  const description = req.body.description?.trim() || null;
  if (!name) return res.status(400).json({ error: "Nazwa kategorii jest wymagana." });

  const baseSlug = slugify(name);
  if (!baseSlug || baseSlug === "all") {
    return res.status(400).json({ error: "Nieprawidłowa nazwa kategorii." });
  }

  try {
    const countResult = await db.query("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM article_categories");
    const result = await db.query(
      `INSERT INTO article_categories (name, slug, description, sort_order, active)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (slug) DO UPDATE SET
         name=EXCLUDED.name,
         description=EXCLUDED.description,
         active=TRUE,
         updated_at=CURRENT_TIMESTAMP
       RETURNING id, name, slug, description, sort_order, active`,
      [name, baseSlug, description, countResult.rows[0].next_order]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Kategoria o takiej nazwie juz istnieje." });
    }
    console.error(err);
    res.status(500).json({ error: "Błąd serwera przy tworzeniu kategorii." });
  }
});

router.delete("/categories/:id", auth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Brak uprawnien." });

  const categoryId = Number(req.params.id);
  if (!Number.isInteger(categoryId)) return res.status(400).json({ error: "Nieprawidłowa kategoria." });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const categoryResult = await client.query("SELECT id, slug FROM article_categories WHERE id=$1 AND active=TRUE", [categoryId]);
    const category = categoryResult.rows[0];
    if (!category) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Kategoria nie istnieje." });
    }
    if (category.slug === "all") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Tej kategorii nie można usunąć." });
    }

    const fallbackResult = await client.query("SELECT id FROM article_categories WHERE slug='inne' AND active=TRUE LIMIT 1");
    const fallbackId = fallbackResult.rows[0]?.id;
    if (fallbackId && fallbackId !== categoryId) {
      await client.query("UPDATE products SET category_id=$1, updated_at=CURRENT_TIMESTAMP WHERE category_id=$2", [fallbackId, categoryId]);
    } else {
      await client.query("UPDATE products SET category_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE category_id=$1", [categoryId]);
    }
    await client.query("UPDATE article_categories SET active=FALSE, updated_at=CURRENT_TIMESTAMP WHERE id=$1", [categoryId]);
    await client.query("COMMIT");
    res.status(204).send();
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Błąd serwera przy usuwaniu kategorii." });
  } finally {
    client.release();
  }
});

router.post("/upload-image", auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Brak uprawnień." });

  upload.single("image")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Nie udało się wgrać zdjęcia." });
    }
    if (!req.file) return res.status(400).json({ error: "Nie wybrano pliku." });

    res.status(201).json({ imageUrl: `/uploads/articles/${req.file.filename}` });
  });
});

router.get("/", auth, async (req, res) => {
  try {
    const adminView = isAdmin(req);
    const where = [];
    const params = [];

    if (!adminView) {
      where.push("p.active=TRUE");
      where.push("p.visible_for_clients=TRUE");
    }

    if (req.query.category && req.query.category !== "all") {
      params.push(req.query.category);
      where.push(`c.slug=$${params.length}`);
    }

    const result = await db.query(
      `${productSelect}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY c.sort_order NULLS LAST, p.name ASC`,
      params
    );
    res.json(result.rows.map((product) => formatProduct(product, adminView)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd serwera przy pobieraniu artykułów." });
  }
});

router.post("/", auth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Brak uprawnień." });

  const product = mapProductBody(req.body);
  if (!product.name) return res.status(400).json({ error: "Nazwa artykułu jest wymagana." });
  if (!product.category_id) return res.status(400).json({ error: "Kategoria jest wymagana." });

  try {
    const result = await db.query(
      `INSERT INTO products (
        name, description, catalog_price, sale_price, code, unit, vat_rate,
        category_id, image_url, visible_for_clients, show_price_to_client, active
      )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        product.name,
        product.description,
        product.catalog_price,
        product.sale_price,
        product.code,
        product.unit,
        product.vat_rate,
        product.category_id,
        product.image_url,
        product.visible_for_clients,
        product.show_price_to_client,
        product.active
      ]
    );
    res.status(201).json(formatProduct(result.rows[0], true));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd serwera przy tworzeniu artykułu." });
  }
});

router.put("/:id", auth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Brak uprawnień." });

  const product = mapProductBody(req.body);
  if (!product.name) return res.status(400).json({ error: "Nazwa artykułu jest wymagana." });
  if (!product.category_id) return res.status(400).json({ error: "Kategoria jest wymagana." });

  try {
    const result = await db.query(
      `UPDATE products SET
        name=$1,
        description=$2,
        catalog_price=$3,
        sale_price=$4,
        code=$5,
        unit=$6,
        vat_rate=$7,
        category_id=$8,
        image_url=$9,
        visible_for_clients=$10,
        show_price_to_client=$11,
        active=$12,
        updated_at=CURRENT_TIMESTAMP
       WHERE id=$13
       RETURNING *`,
      [
        product.name,
        product.description,
        product.catalog_price,
        product.sale_price,
        product.code,
        product.unit,
        product.vat_rate,
        product.category_id,
        product.image_url,
        product.visible_for_clients,
        product.show_price_to_client,
        product.active,
        req.params.id
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Artykuł nie znaleziony." });
    res.json(formatProduct(result.rows[0], true));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd serwera przy aktualizacji artykułu." });
  }
});

router.post("/:id/duplicate", auth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Brak uprawnień." });

  try {
    const result = await db.query(
      `INSERT INTO products (
        name, description, catalog_price, sale_price, code, unit, vat_rate,
        category_id, image_url, visible_for_clients, show_price_to_client, active
      )
       SELECT
        name || ' (kopia)', description, catalog_price, sale_price, code, unit, vat_rate,
        category_id, image_url, visible_for_clients, show_price_to_client, active
       FROM products
       WHERE id=$1
       RETURNING *`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Artykuł nie znaleziony." });
    res.status(201).json(formatProduct(result.rows[0], true));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd serwera przy duplikowaniu artykułu." });
  }
});

router.delete("/:id", auth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Brak uprawnień." });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE offer_items SET product_id=NULL WHERE product_id=$1", [req.params.id]);
    const result = await client.query("DELETE FROM products WHERE id=$1", [req.params.id]);
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Artykuł nie znaleziony." });
    }
    await client.query("COMMIT");
    res.status(204).send();
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Błąd serwera przy usuwaniu artykułu." });
  } finally {
    client.release();
  }
});

export default router;
