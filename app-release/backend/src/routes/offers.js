import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { normalizeRole } from "../middleware/access.js";
import { notifyAdmins } from "../utils/notifications.js";
import { renderEmailTemplate, sendEmail } from "../services/emailService.js";
import {
  markOfferLifecycle,
  notifyClientUsersAboutOffer,
  shouldPublishOffer,
  synchronizeLinkedOrderStatus
} from "../services/orderOfferWorkflow.js";
import { writeAuditLog } from "../utils/auditLog.js";

const router = express.Router();

function requireAdmin(req, res, next) {
  if (normalizeRole(req.user?.role) !== "ADMIN") return res.status(403).json({ error: "Brak uprawnień." });
  next();
}

async function generateOfferNumber(sql = db) {
  const year = new Date().getFullYear();
  const lastOffer = await sql.query(
    "SELECT offer_number FROM offers WHERE offer_number LIKE $1 ORDER BY id DESC LIMIT 1",
    [`PS/${year}/%`]
  );

  let nextNumber = 1;
  if (lastOffer.rows[0]) {
    const lastNum = parseInt(lastOffer.rows[0].offer_number.split("/")[2], 10);
    nextNumber = Number.isFinite(lastNum) ? lastNum + 1 : 1;
  }

  return `PS/${year}/${String(nextNumber).padStart(3, "0")}`;
}

function calculateItem(item) {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unit_price || 0);
  const vatRate = Number(item.vat_rate || 0);
  const netTotal = quantity * unitPrice;
  const vatValue = netTotal * (vatRate / 100);
  const grossTotal = netTotal + vatValue;
  return { netTotal, vatValue, grossTotal };
}

async function getAdminContact(userId) {
  const result = await db.query(
    `SELECT username, first_name, last_name, email, phone
     FROM users
     WHERE id=$1`,
    [userId]
  );
  const user = result.rows[0] || {};
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || null;

  return {
    name,
    phone: user.phone || null,
    email: user.email || null
  };
}

async function toOfferValues(body, userId, offerNumber) {
  const client = body.client || {};
  const items = body.items || [];
  const adminContact = await getAdminContact(userId);
  const summary = items.reduce(
    (acc, item) => {
      const calculated = calculateItem(item);
      acc.net += calculated.netTotal;
      acc.vat += calculated.vatValue;
      acc.gross += calculated.grossTotal;
      return acc;
    },
    { net: 0, vat: 0, gross: 0 }
  );

  return {
    offerNumber,
    title: body.title || "Oferta handlowa",
    description: body.description || null,
    object_id: body.object_id || null,
    customer_id: body.customer_id || null,
    template_id: body.template_id || null,
    status: body.status || "SZKIC",
    total_price: summary.net,
    created_by: userId,
    issue_date: body.issue_date || null,
    valid_until: body.valid_until || null,
    salesperson: body.salesperson || adminContact.name,
    currency: body.currency || "PLN",
    payment_terms: body.payment_terms || null,
    payment_due_days: body.payment_due_days || null,
    delivery_method: body.delivery_method || null,
    delivery_date: body.delivery_date || null,
    realization_time: body.realization_time || null,
    prepared_by_name: adminContact.name,
    prepared_by_phone: adminContact.phone,
    prepared_by_email: adminContact.email,
    remarks: body.remarks || body.notes || null,
    additional_info: body.additional_info || null,
    client_company_name: client.company_name || null,
    client_nip: client.nip || null,
    client_address: client.address || null,
    client_postal_code: client.postal_code || null,
    client_city: client.city || null,
    client_country: client.country || null,
    client_contact_person: client.contact_person || null,
    client_phone: client.phone || null,
    client_email: client.email || null,
    ticket_id: body.ticket_id || null
  };
}

async function validateSourceOrder(ticketId, customerId, sql = db) {
  if (!ticketId) return true;
  const result = await sql.query(
    `SELECT 1
     FROM tickets t
     JOIN customers order_customer ON order_customer.id=t.customer_id
     JOIN customers offer_customer ON offer_customer.id=$2
     WHERE t.id=$1 AND t.type='ORDER'
       AND order_customer.company_id=offer_customer.company_id`,
    [ticketId, customerId]
  );
  return Boolean(result.rows[0]);
}

async function replaceItems(offerId, items = [], sql = db) {
  await sql.query("DELETE FROM offer_items WHERE offer_id=$1", [offerId]);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const calculated = calculateItem(item);
    await sql.query(
      `INSERT INTO offer_items (
        offer_id, item_number, product_id, sku, code, title, description,
        unit, unit_price, quantity, vat_rate, total, net_total, vat_value, gross_total
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        offerId,
        i + 1,
        item.product_id || null,
        item.sku || item.code || null,
        item.code || item.sku || null,
        item.title || item.name || "",
        item.description || null,
        item.unit || null,
        item.unit_price || 0,
        item.quantity || 0,
        item.vat_rate ?? 23,
        calculated.netTotal,
        calculated.netTotal,
        calculated.vatValue,
        calculated.grossTotal
      ]
    );
  }
}

async function applyLinkedOrderWorkflow(sql, offer, actorId) {
  await markOfferLifecycle(sql, offer.id, offer.status);
  return synchronizeLinkedOrderStatus(sql, {
    ticketId: offer.ticket_id,
    offerId: offer.id,
    offerNumber: offer.offer_number,
    offerStatus: offer.status,
    actorId
  });
}

async function deliverOfferEmail(offerId, authorization, createdById) {
  const offerResult = await db.query(
    `SELECT o.*, c.name AS customer_name, c.email AS customer_email, co.name AS company_name
     FROM offers o
     LEFT JOIN customers c ON c.id=o.customer_id
     LEFT JOIN companies co ON co.id=c.company_id
     WHERE o.id=$1`,
    [offerId]
  );
  const offer = offerResult.rows[0];
  if (!offer) throw new Error("Oferta nie istnieje.");

  const recipient = offer.client_email || offer.customer_email;
  const variables = {
    companyName: offer.company_name || offer.customer_name || "",
    offerNumber: offer.offer_number || `#${offer.id}`,
    offerTitle: offer.title || "Oferta handlowa",
    offerValue: String(offer.total_price || "")
  };
  const rendered = await renderEmailTemplate("OFFER_SEND", variables);
  const pdfUrl = `http://127.0.0.1:${process.env.PORT || 5000}/pdf/${offer.id}`;
  const pdfResponse = await fetch(pdfUrl, { headers: { Authorization: authorization || "" } });
  if (!pdfResponse.ok) throw new Error("Nie udało się wygenerować PDF do załącznika.");

  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
  const log = await sendEmail({
    to: recipient,
    toName: offer.client_contact_person || offer.customer_name,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments: [{
      filename: `oferta_${String(offer.offer_number || offer.id).replace(/\//g, "_")}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf"
    }],
    templateKey: "OFFER_SEND",
    entityType: "OFFER",
    entityId: offer.id,
    createdById
  });

  return { log, recipient };
}

async function publishOfferToClient(offer, req) {
  const delivery = {
    portalPublished: true,
    notificationRecipients: 0,
    emailSent: false,
    emailRecipient: null,
    emailError: null
  };

  try {
    delivery.notificationRecipients = await notifyClientUsersAboutOffer({
      offerId: offer.id,
      offerNumber: offer.offer_number,
      title: offer.title
    });
  } catch (error) {
    console.error("Failed to notify client about offer:", error);
  }

  try {
    const emailDelivery = await deliverOfferEmail(offer.id, req.headers.authorization, req.user.id);
    delivery.emailSent = true;
    delivery.emailRecipient = emailDelivery.recipient;
  } catch (error) {
    delivery.emailError = error.message;
    console.error("Automatic offer email was not sent:", error.message);
  }

  return delivery;
}

router.get("/", auth, async (req, res) => {
  try {
    const role = normalizeRole(req.user.role);
    const params = [];
    let whereSql = "";

    if (role !== "ADMIN") {
      const customerRes = await db.query("SELECT id, company_id FROM customers WHERE user_id=$1", [req.user.id]);
      if (customerRes.rows.length === 0) return res.json([]);

      const customer = customerRes.rows[0];
      if (customer.company_id) {
        const companyCustomers = await db.query("SELECT id FROM customers WHERE company_id=$1", [customer.company_id]);
        params.push(companyCustomers.rows.map((row) => row.id));
        whereSql = "WHERE o.customer_id = ANY($1::int[])";
      } else {
        params.push(customer.id);
        whereSql = "WHERE o.customer_id = $1";
      }
    }

    const offers = await db.query(
      `SELECT o.*, c.name as customer_name, obj.name as object_name
       FROM offers o
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN objects obj ON o.object_id = obj.id
       ${whereSql}
       ORDER BY o.created_at DESC`,
      params
    );
    res.json(offers.rows);
  } catch (err) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.get("/:id", auth, async (req, res) => {
  try {
    const role = normalizeRole(req.user.role);
    const params = [req.params.id];
    let accessSql = "WHERE o.id=$1";
    if (role !== "ADMIN") {
      params.push(req.user.companyId || req.user.company_id);
      accessSql += " AND c.company_id=$2 AND UPPER(COALESCE(o.status, '')) NOT IN ('SZKIC','DRAFT')";
    }
    const offer = await db.query(
      `SELECT
        o.*,
        c.name as customer_name,
        c.address as customer_address,
        c.email as customer_email,
        c.phone as customer_phone,
        c.nip as customer_nip,
        co.name as company_name,
        u.username as creator_name,
        u.first_name as creator_first_name,
        u.last_name as creator_last_name,
        u.email as creator_email,
        u.phone as creator_phone,
        obj.name as object_name
       FROM offers o
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN companies co ON c.company_id = co.id
       LEFT JOIN users u ON o.created_by = u.id
       LEFT JOIN objects obj ON o.object_id = obj.id
       ${accessSql}`,
      params
    );

    if (!offer.rows[0]) return res.status(404).json({ error: "Oferta nie znaleziona" });

    const items = await db.query("SELECT * FROM offer_items WHERE offer_id=$1 ORDER BY item_number ASC", [req.params.id]);
    const comments = await db.query(
      `SELECT c.*, u.username FROM comments c
       JOIN users u ON c.author_id = u.id
       WHERE c.offer_id=$1
       ORDER BY c.created_at DESC`,
      [req.params.id]
    );

    res.json({
      ...offer.rows[0],
      items: items.rows,
      comments: comments.rows
    });
  } catch (err) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.post("/", auth, requireAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["prestige-offer-number"]);
    const offerNumber = req.body.offer_number?.trim() || await generateOfferNumber(client);
    const values = await toOfferValues(req.body, req.user.id, offerNumber);
    if (!(await validateSourceOrder(values.ticket_id, values.customer_id, client))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Zamówienie źródłowe i klient oferty muszą należeć do tej samej firmy." });
    }

    const offer = await client.query(
      `INSERT INTO offers (
        offer_number, title, description, object_id, customer_id, template_id, status,
        total_price, created_by, issue_date, valid_until, salesperson, currency,
        payment_terms, payment_due_days, delivery_method, delivery_date, realization_time,
        prepared_by_name, prepared_by_phone, prepared_by_email,
        remarks, additional_info, client_company_name, client_nip, client_address,
        client_postal_code, client_city, client_country, client_contact_person,
        client_phone, client_email, ticket_id
      )
       VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33
      )
       RETURNING *`,
      [
        values.offerNumber,
        values.title,
        values.description,
        values.object_id,
        values.customer_id,
        values.template_id,
        values.status,
        values.total_price,
        values.created_by,
        values.issue_date,
        values.valid_until,
        values.salesperson,
        values.currency,
        values.payment_terms,
        values.payment_due_days,
        values.delivery_method,
        values.delivery_date,
        values.realization_time,
        values.prepared_by_name,
        values.prepared_by_phone,
        values.prepared_by_email,
        values.remarks,
        values.additional_info,
        values.client_company_name,
        values.client_nip,
        values.client_address,
        values.client_postal_code,
        values.client_city,
        values.client_country,
        values.client_contact_person,
        values.client_phone,
        values.client_email,
        values.ticket_id
      ]
    );

    const savedOffer = offer.rows[0];
    await replaceItems(savedOffer.id, req.body.items || [], client);
    await applyLinkedOrderWorkflow(client, savedOffer, req.user.id);
    await client.query("COMMIT");

    const delivery = shouldPublishOffer(null, savedOffer.status)
      ? await publishOfferToClient(savedOffer, req)
      : null;
    await writeAuditLog({
      category: "OFFER",
      action: "OFFER_CREATED",
      userId: req.user.id,
      entityType: "offer",
      entityId: savedOffer.id,
      message: `Utworzono oferte ${savedOffer.offer_number || `#${savedOffer.id}`}`,
      metadata: { status: savedOffer.status, ticketId: savedOffer.ticket_id || null }
    }).catch((error) => console.error("Global audit log failed:", error));
    res.status(201).json({ ...savedOffer, delivery });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to create offer:", err);
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  } finally {
    client.release();
  }
});

router.put("/:id", auth, requireAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT offer_number, status, ticket_id FROM offers WHERE id=$1 FOR UPDATE",
      [req.params.id]
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Oferta nie znaleziona" });
    }

    const values = await toOfferValues(req.body, req.user.id, req.body.offer_number || current.rows[0].offer_number);
    if (!(await validateSourceOrder(values.ticket_id, values.customer_id, client))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Zamówienie źródłowe i klient oferty muszą należeć do tej samej firmy." });
    }

    const offer = await client.query(
      `UPDATE offers SET
        offer_number=$1, title=$2, description=$3, object_id=$4, customer_id=$5,
        template_id=$6, status=$7, total_price=$8, updated_at=NOW(),
        issue_date=$9, valid_until=$10, salesperson=$11, currency=$12,
        payment_terms=$13, payment_due_days=$14, delivery_method=$15, delivery_date=$16,
        realization_time=$17, prepared_by_name=$18, prepared_by_phone=$19, prepared_by_email=$20,
        remarks=$21, additional_info=$22, client_company_name=$23,
        client_nip=$24, client_address=$25, client_postal_code=$26, client_city=$27,
        client_country=$28, client_contact_person=$29, client_phone=$30, client_email=$31,
        ticket_id=$32
       WHERE id=$33
       RETURNING *`,
      [
        values.offerNumber,
        values.title,
        values.description,
        values.object_id,
        values.customer_id,
        values.template_id,
        values.status,
        values.total_price,
        values.issue_date,
        values.valid_until,
        values.salesperson,
        values.currency,
        values.payment_terms,
        values.payment_due_days,
        values.delivery_method,
        values.delivery_date,
        values.realization_time,
        values.prepared_by_name,
        values.prepared_by_phone,
        values.prepared_by_email,
        values.remarks,
        values.additional_info,
        values.client_company_name,
        values.client_nip,
        values.client_address,
        values.client_postal_code,
        values.client_city,
        values.client_country,
        values.client_contact_person,
        values.client_phone,
        values.client_email,
        values.ticket_id,
        req.params.id
      ]
    );

    const savedOffer = offer.rows[0];
    await replaceItems(req.params.id, req.body.items || [], client);
    await applyLinkedOrderWorkflow(client, savedOffer, req.user.id);
    await client.query("COMMIT");

    const delivery = shouldPublishOffer(current.rows[0].status, savedOffer.status)
      ? await publishOfferToClient(savedOffer, req)
      : null;
    await writeAuditLog({
      category: "OFFER",
      action: "OFFER_UPDATED",
      userId: req.user.id,
      entityType: "offer",
      entityId: savedOffer.id,
      message: `Zaktualizowano oferte ${savedOffer.offer_number || `#${savedOffer.id}`}`,
      metadata: { previousStatus: current.rows[0].status, status: savedOffer.status }
    }).catch((error) => console.error("Global audit log failed:", error));
    res.json({ ...savedOffer, delivery });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to update offer:", err);
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  } finally {
    client.release();
  }
});

router.put("/:id/draft", auth, requireAdmin, async (req, res) => {
  try {
    const current = await db.query("SELECT offer_number FROM offers WHERE id=$1", [req.params.id]);
    if (!current.rows[0]) return res.status(404).json({ error: "Oferta nie znaleziona" });

    const values = await toOfferValues(
      { ...req.body, status: "SZKIC" },
      req.user.id,
      req.body.offer_number || current.rows[0].offer_number
    );

    const offer = await db.query(
      `UPDATE offers SET
        offer_number=$1, title=$2, description=$3, object_id=$4, customer_id=$5,
        template_id=$6, status='SZKIC', total_price=$7, updated_at=NOW(),
        issue_date=$8, valid_until=$9, salesperson=$10, currency=$11,
        payment_terms=$12, payment_due_days=$13, delivery_method=$14, delivery_date=$15,
        realization_time=$16, prepared_by_name=$17, prepared_by_phone=$18, prepared_by_email=$19,
        remarks=$20, additional_info=$21, client_company_name=$22,
        client_nip=$23, client_address=$24, client_postal_code=$25, client_city=$26,
        client_country=$27, client_contact_person=$28, client_phone=$29, client_email=$30
       WHERE id=$31
       RETURNING *`,
      [
        values.offerNumber,
        values.title,
        values.description,
        values.object_id,
        values.customer_id,
        values.template_id,
        values.total_price,
        values.issue_date,
        values.valid_until,
        values.salesperson,
        values.currency,
        values.payment_terms,
        values.payment_due_days,
        values.delivery_method,
        values.delivery_date,
        values.realization_time,
        values.prepared_by_name,
        values.prepared_by_phone,
        values.prepared_by_email,
        values.remarks,
        values.additional_info,
        values.client_company_name,
        values.client_nip,
        values.client_address,
        values.client_postal_code,
        values.client_city,
        values.client_country,
        values.client_contact_person,
        values.client_phone,
        values.client_email,
        req.params.id
      ]
    );

    await replaceItems(req.params.id, req.body.items || []);
    await writeAuditLog({
      category: "OFFER",
      action: "OFFER_DRAFT_SAVED",
      userId: req.user.id,
      entityType: "offer",
      entityId: req.params.id,
      message: `Zapisano szkic oferty ${offer.rows[0].offer_number || `#${req.params.id}`}`
    }).catch((error) => console.error("Global audit log failed:", error));
    res.json(offer.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

router.patch("/:id/status", auth, requireAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    const status = String(req.body.status || "").toUpperCase();
    const validStatuses = ["SZKIC", "WYSŁANA", "W REALIZACJI", "DO AKCEPTACJI", "ZAAKCEPTOWANA", "ODRZUCONA", "ZAKOŃCZONA"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Niepoprawny status" });
    }

    await client.query("BEGIN");
    const current = await client.query("SELECT status FROM offers WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Oferta nie znaleziona" });
    }

    const offer = await client.query(
      "UPDATE offers SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [status, req.params.id]
    );

    const savedOffer = offer.rows[0];
    await applyLinkedOrderWorkflow(client, savedOffer, req.user.id);
    await client.query("COMMIT");

    const delivery = shouldPublishOffer(current.rows[0].status, savedOffer.status)
      ? await publishOfferToClient(savedOffer, req)
      : null;

    if (["ZAAKCEPTOWANA", "ODRZUCONA", "WYSŁANA"].includes(status)) {
      const title = status === "ZAAKCEPTOWANA" ? "Oferta zaakceptowana" : status === "ODRZUCONA" ? "Oferta odrzucona" : "Oferta wysłana";
      const message = `${savedOffer.client_company_name || "Klient"}: ${savedOffer.offer_number || "oferta #" + savedOffer.id}`;
      await notifyAdmins({
        category: "OFFERS",
        type: status === "ZAAKCEPTOWANA" ? "OFFER_ACCEPTED" : status === "ODRZUCONA" ? "OFFER_REJECTED" : "OFFER_SENT",
        priority: status === "ODRZUCONA" ? "WARNING" : "SUCCESS",
        title,
        message,
        entityType: "offer",
        entityId: savedOffer.id,
        link: `/offers/${savedOffer.id}`
      });
    }
    await writeAuditLog({
      category: "OFFER",
      action: "OFFER_STATUS_CHANGED",
      userId: req.user.id,
      entityType: "offer",
      entityId: savedOffer.id,
      message: `Zmieniono status oferty ${savedOffer.offer_number || `#${savedOffer.id}`}`,
      metadata: { previousStatus: current.rows[0].status, status }
    }).catch((error) => console.error("Global audit log failed:", error));

    res.json({ ...savedOffer, delivery });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  } finally {
    client.release();
  }
});
router.post("/:id/send-email", auth, requireAdmin, async (req, res) => {
  if (normalizeRole(req.user.role) !== "ADMIN") {
    return res.status(403).json({ error: "Brak uprawnień do wysyłki oferty." });
  }

  try {
    const { to, toName, cc, subject, html, text, attachPdf = true } = req.body;
    const offerResult = await db.query(
      `SELECT o.*, c.name AS customer_name, c.email AS customer_email, co.name AS company_name
       FROM offers o
       LEFT JOIN customers c ON c.id=o.customer_id
       LEFT JOIN companies co ON co.id=c.company_id
       WHERE o.id=$1`,
      [req.params.id]
    );
    const offer = offerResult.rows[0];
    if (!offer) return res.status(404).json({ error: "Oferta nie znaleziona." });

    const variables = {
      companyName: offer.company_name || offer.customer_name || "",
      offerNumber: offer.offer_number || `#${offer.id}`,
      offerTitle: offer.title || "Oferta handlowa",
      offerValue: String(offer.total_price || "")
    };
    const rendered = (!subject || !html) ? await renderEmailTemplate("OFFER_SEND", variables) : null;
    const finalSubject = subject || rendered.subject;
    const finalHtml = html || rendered.html;

    const recipient = to || offer.client_email || offer.customer_email;
    const attachments = [];
    if (attachPdf) {
      const pdfUrl = `http://127.0.0.1:${process.env.PORT || 5000}/pdf/${offer.id}`;
      const pdfResponse = await fetch(pdfUrl, {
        headers: { Authorization: req.headers.authorization || "" }
      });
      if (!pdfResponse.ok) throw new Error("Nie udało się wygenerować PDF do załącznika.");
      const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
      attachments.push({
        filename: `oferta_${String(offer.offer_number || offer.id).replace(/\//g, "_")}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf"
      });
    }

    const log = await sendEmail({
      to: recipient,
      toName: toName || offer.client_contact_person || offer.customer_name,
      subject: finalSubject,
      html: finalHtml,
      cc,
      text: text || String(finalHtml || "").replace(/<[^>]*>?/gm, ""),
      attachments,
      templateKey: "OFFER_SEND",
      entityType: "OFFER",
      entityId: offer.id,
      createdById: req.user.id
    });

    const workflowClient = await db.connect();
    let savedOffer;
    try {
      await workflowClient.query("BEGIN");
      const updated = await workflowClient.query(
        "UPDATE offers SET status='WYSŁANA', updated_at=NOW() WHERE id=$1 RETURNING *",
        [offer.id]
      );
      savedOffer = updated.rows[0];
      await applyLinkedOrderWorkflow(workflowClient, savedOffer, req.user.id);
      await workflowClient.query("COMMIT");
    } catch (error) {
      await workflowClient.query("ROLLBACK");
      throw error;
    } finally {
      workflowClient.release();
    }

    if (shouldPublishOffer(offer.status, savedOffer.status)) {
      await notifyClientUsersAboutOffer({
        offerId: savedOffer.id,
        offerNumber: savedOffer.offer_number,
        title: savedOffer.title
      }).catch((error) => console.error("Failed to notify client about sent offer:", error));
    }

    await notifyAdmins({
      category: "OFFERS",
      type: "OFFER_SENT",
      priority: "SUCCESS",
      title: "Oferta wysłana e-mailem",
      message: `${offer.offer_number || "oferta #" + offer.id} wysłana do ${recipient}`,
      entityType: "offer",
      entityId: offer.id,
      link: `/offers/${offer.id}`
    }).catch(() => {});
    await writeAuditLog({
      category: "OFFER",
      action: "OFFER_EMAIL_SENT",
      userId: req.user.id,
      entityType: "offer",
      entityId: offer.id,
      message: `Wyslano oferte ${offer.offer_number || `#${offer.id}`} e-mailem.`,
      metadata: { hasPdfAttachment: Boolean(attachPdf) }
    }).catch((error) => console.error("Global audit log failed:", error));

    res.json({ message: "Oferta została wysłana e-mailem.", log, offer: savedOffer });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/:id", auth, requireAdmin, async (req, res) => {
  if (normalizeRole(req.user.role) !== "ADMIN") {
    return res.status(403).json({ error: "Brak uprawnień do usunięcia oferty" });
  }

  try {
    const offer = await db.query("DELETE FROM offers WHERE id=$1 RETURNING *", [req.params.id]);
    if (!offer.rows[0]) return res.status(404).json({ error: "Oferta nie znaleziona" });
    await writeAuditLog({
      category: "OFFER",
      action: "OFFER_DELETED",
      userId: req.user.id,
      entityType: "offer",
      entityId: offer.rows[0].id,
      message: `Usunieto oferte ${offer.rows[0].offer_number || `#${offer.rows[0].id}`}`
    }).catch((error) => console.error("Global audit log failed:", error));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

export default router;
