import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { getEffectivePermissions, loadCurrentUser, normalizeRole } from "../middleware/access.js";

import { autoAsyncRoutes } from "../utils/autoAsyncRoutes.js";

const router = express.Router();
autoAsyncRoutes(router);

router.use(auth, loadCurrentUser);

const RESULT_LIMIT = 6;
const MIN_QUERY_LENGTH = 2;
const HIDDEN_CLIENT_OFFER_STATUSES = ["SZKIC", "DRAFT"];

function employeeSiteAccessSql(req, objectColumn, params) {
  if (normalizeRole(req.currentUser.role) !== "CLIENT_EMPLOYEE") return "";
  params.push(req.currentUser.id);
  return ` AND EXISTS (
    SELECT 1 FROM user_site_access usa
    WHERE usa.site_id=${objectColumn} AND usa.user_id=$${params.length}
  )`;
}

router.get("/", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const results = { companies: [], offers: [], tickets: [], orders: [] };

  if (query.length < MIN_QUERY_LENGTH) return res.json(results);

  const like = `%${query}%`;
  const role = normalizeRole(req.currentUser.role);

  try {
    if (role === "ADMIN") {
      const companiesRes = await db.query(
        `SELECT id, name, nip, city, email
         FROM companies
         WHERE COALESCE(is_own_company, FALSE) = FALSE
           AND (name ILIKE $1 OR nip ILIKE $1 OR city ILIKE $1 OR email ILIKE $1)
         ORDER BY name
         LIMIT $2`,
        [like, RESULT_LIMIT]
      );
      results.companies = companiesRes.rows;

      const offersRes = await db.query(
        `SELECT o.id, o.offer_number, o.title, o.status, c.name AS customer_name
         FROM offers o
         LEFT JOIN customers c ON c.id = o.customer_id
         WHERE o.offer_number ILIKE $1 OR o.title ILIKE $1 OR c.name ILIKE $1
         ORDER BY o.created_at DESC
         LIMIT $2`,
        [like, RESULT_LIMIT]
      );
      results.offers = offersRes.rows;

      const ticketsRes = await db.query(
        `SELECT t.id, t.ticket_number, t.subject, t.status, c.name AS customer_name
         FROM tickets t
         LEFT JOIN customers c ON c.id = t.customer_id
         WHERE t.type <> 'ORDER' AND (t.ticket_number ILIKE $1 OR t.subject ILIKE $1 OR c.name ILIKE $1)
         ORDER BY t.created_at DESC
         LIMIT $2`,
        [like, RESULT_LIMIT]
      );
      results.tickets = ticketsRes.rows;

      const ordersRes = await db.query(
        `SELECT t.id, t.ticket_number AS order_number, t.subject, t.status, c.name AS customer_name
         FROM tickets t
         LEFT JOIN customers c ON c.id = t.customer_id
         WHERE t.type = 'ORDER' AND (t.ticket_number ILIKE $1 OR t.subject ILIKE $1 OR c.name ILIKE $1)
         ORDER BY t.created_at DESC
         LIMIT $2`,
        [like, RESULT_LIMIT]
      );
      results.orders = ordersRes.rows;

      return res.json(results);
    }

    const companyId = Number(req.currentUser.company_id);
    if (!companyId) return res.json(results);

    const permissions = await getEffectivePermissions(req.currentUser);

    if (permissions.has("VIEW_OFFERS")) {
      const params = [companyId, HIDDEN_CLIENT_OFFER_STATUSES, like];
      const siteAccess = employeeSiteAccessSql(req, "o.object_id", params);
      const offersRes = await db.query(
        `SELECT o.id, o.offer_number, o.title, o.status
         FROM offers o
         JOIN customers c ON c.id = o.customer_id
         WHERE c.company_id=$1
           AND UPPER(COALESCE(o.status, '')) <> ALL($2::text[])
           AND (o.offer_number ILIKE $3 OR o.title ILIKE $3)
           ${siteAccess}
         ORDER BY o.created_at DESC
         LIMIT ${RESULT_LIMIT}`,
        params
      );
      results.offers = offersRes.rows;
    }

    if (permissions.has("VIEW_TICKETS")) {
      const ticketParams = [companyId, like];
      const ticketSiteAccess = employeeSiteAccessSql(req, "t.object_id", ticketParams);
      const ticketsRes = await db.query(
        `SELECT t.id, t.ticket_number, t.subject, t.status
         FROM tickets t
         JOIN customers c ON c.id = t.customer_id
         WHERE c.company_id=$1
           AND t.type IN ('SYSTEM_FAILURE','HARDWARE_FAILURE')
           AND (t.ticket_number ILIKE $2 OR t.subject ILIKE $2)
           ${ticketSiteAccess}
         ORDER BY t.created_at DESC
         LIMIT ${RESULT_LIMIT}`,
        ticketParams
      );
      results.tickets = ticketsRes.rows;

      const orderParams = [companyId, like];
      const orderSiteAccess = employeeSiteAccessSql(req, "t.object_id", orderParams);
      const ordersRes = await db.query(
        `SELECT t.id, t.ticket_number AS order_number, t.subject, t.status
         FROM tickets t
         JOIN customers c ON c.id = t.customer_id
         WHERE c.company_id=$1
           AND t.type = 'ORDER'
           AND (t.ticket_number ILIKE $2 OR t.subject ILIKE $2)
           ${orderSiteAccess}
         ORDER BY t.created_at DESC
         LIMIT ${RESULT_LIMIT}`,
        orderParams
      );
      results.orders = ordersRes.rows;
    }

    res.json(results);
  } catch (err) {
    console.error("Global search failed:", err);
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

export default router;
