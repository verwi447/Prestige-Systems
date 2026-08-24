import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, requireRole } from "../middleware/access.js";

import { autoAsyncRoutes } from "../utils/autoAsyncRoutes.js";

const router = express.Router();
autoAsyncRoutes(router);
router.use(auth, loadCurrentUser, requireRole("ADMIN"));

// GET all templates
router.get("/", auth, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM offer_templates ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd serwera przy pobieraniu szablonów" });
  }
});

// GET single template with items
router.get("/:id", auth, async (req, res) => {
  try {
    const templateRes = await db.query("SELECT * FROM offer_templates WHERE id = $1", [req.params.id]);
    if (templateRes.rows.length === 0) {
      return res.status(404).json({ error: "Szablon nie znaleziony" });
    }
    // Błąd "created_at" nie istnieje, występował prawdopodobnie tutaj.
    // Tabela `template_items` nie ma tej kolumny, sortujemy po `sort_order`.
    const itemsRes = await db.query("SELECT * FROM template_items WHERE template_id = $1 ORDER BY sort_order ASC", [req.params.id]);
    
    const template = templateRes.rows[0];
    template.items = itemsRes.rows;
    
    res.json(template);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd serwera przy pobieraniu szablonu" });
  }
});

// POST create template
router.post("/", auth, async (req, res) => {
  const { name, description, address, items } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Nazwa szablonu jest wymagana." });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const templateResult = await client.query(
      `INSERT INTO offer_templates (name, description, address, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, description, address, req.user.id]
    );
    const newTemplate = templateResult.rows[0];

    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await client.query(
          `INSERT INTO template_items (template_id, item_number, title, description, unit_price, quantity, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [newTemplate.id, i + 1, item.title, item.description, item.unit_price, item.quantity, i]
        );
      }
    }

    await client.query("COMMIT");
    res.status(201).json(newTemplate);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Błąd serwera przy tworzeniu szablonu." });
  } finally {
    client.release();
  }
});

// DELETE template
router.delete("/:id", auth, async (req, res) => {
  try {
    const result = await db.query("DELETE FROM offer_templates WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Szablon nie znaleziony" });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd serwera przy usuwaniu szablonu" });
  }
});

export default router;
