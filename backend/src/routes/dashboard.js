import express from "express";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { normalizeRole } from "../middleware/access.js";
import { getAdminActionItems } from "../services/dashboardActions.js";

const router = express.Router();

const requireAdmin = (req, res) => {
    if (normalizeRole(req.user?.role) !== "ADMIN") {
        res.status(403).json({ error: "Brak uprawnień." });
        return false;
    }
    return true;
};

// GET admin dashboard summary
router.get("/admin-summary", auth, async (req, res) => {
    if (!requireAdmin(req, res)) return;

    try {
        const [
            companyCount,
            offersThisMonth,
            openTickets,
            productCount,
            offersToSend,
            recentOffers,
            recentTickets,
            recentCompanies,
            actionItems,
            monthlyTrend
        ] = await Promise.all([
            db.query("SELECT COUNT(*)::int AS count FROM companies WHERE COALESCE(is_own_company, FALSE)=FALSE"),
            db.query(`
                SELECT COUNT(*)::int AS count
                FROM offers
                WHERE created_at >= date_trunc('month', CURRENT_DATE)
                  AND created_at < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
            `),
            db.query(`
                SELECT COUNT(*)::int AS count
                FROM tickets
                WHERE type <> 'ORDER'
                  AND COALESCE(status, '') NOT IN ('ZAKOŃCZONE', 'ZAKONCZONE', 'ZAMKNIĘTE', 'ZAMKNIETE', 'ODRZUCONE', 'REJECTED', 'COMPLETED', 'CANCELLED')
            `),
            db.query("SELECT COUNT(*)::int AS count FROM products"),
            db.query("SELECT COUNT(*)::int AS count FROM offers WHERE status IN ('SZKIC', 'DO AKCEPTACJI')"),
            db.query(`
                SELECT
                    o.id,
                    o.offer_number,
                    o.total_price,
                    o.created_at,
                    o.status,
                    COALESCE(co.name, o.client_company_name, c.name, '-') AS company_name
                FROM offers o
                LEFT JOIN customers c ON c.id=o.customer_id
                LEFT JOIN companies co ON co.id=c.company_id
                ORDER BY o.created_at DESC
                LIMIT 5
            `),
            db.query(`
                SELECT
                    t.id,
                    t.ticket_number,
                    t.status,
                    COALESCE(co.name, c.name, '-') AS company_name,
                    COALESCE(obj.name, '-') AS object_name
                FROM tickets t
                LEFT JOIN customers c ON c.id=t.customer_id
                LEFT JOIN companies co ON co.id=c.company_id
                LEFT JOIN objects obj ON obj.id=t.object_id
                WHERE t.type <> 'ORDER'
                ORDER BY t.created_at DESC
                LIMIT 5
            `),
            db.query(`
                SELECT id, name, nip, city, email, created_at
                FROM companies
                WHERE COALESCE(is_own_company, FALSE)=FALSE
                ORDER BY created_at DESC
                LIMIT 5
            `),
            getAdminActionItems((...args) => db.query(...args)),
            db.query(`
                WITH months AS (
                    SELECT date_trunc('month', CURRENT_DATE) - (n || ' months')::interval AS month_start
                    FROM generate_series(5, 0, -1) AS n
                )
                SELECT
                    to_char(m.month_start, 'YYYY-MM') AS month,
                    COALESCE(o.count, 0)::int AS offers,
                    COALESCE(t.count, 0)::int AS tickets
                FROM months m
                LEFT JOIN (
                    SELECT date_trunc('month', created_at) AS month_start, COUNT(*) AS count
                    FROM offers
                    GROUP BY 1
                ) o ON o.month_start = m.month_start
                LEFT JOIN (
                    SELECT date_trunc('month', created_at) AS month_start, COUNT(*) AS count
                    FROM tickets
                    WHERE type <> 'ORDER'
                    GROUP BY 1
                ) t ON t.month_start = m.month_start
                ORDER BY m.month_start
            `)
        ]);

        res.json({
            stats: {
                companies: companyCount.rows[0]?.count || 0,
                offersThisMonth: offersThisMonth.rows[0]?.count || 0,
                openTickets: openTickets.rows[0]?.count || 0,
                products: productCount.rows[0]?.count || 0,
                offersToSend: offersToSend.rows[0]?.count || 0
            },
            recentOffers: recentOffers.rows,
            recentTickets: recentTickets.rows,
            recentCompanies: recentCompanies.rows,
            actionItems,
            monthlyTrend: monthlyTrend.rows
        });
    } catch (err) {
        console.error("Błąd przy pobieraniu dashboardu admina:", err);
        res.status(500).json({ error: "Błąd serwera." });
    }
});

// Helper to get the scope of customer IDs a user can see
const getCustomerScope = async (userId) => {
    const customerRes = await db.query("SELECT id, company_id FROM customers WHERE user_id = $1", [userId]);
    if (customerRes.rows.length === 0) {
        return []; // Not a customer, can't see anything
    }
    const customer = customerRes.rows[0];

    if (customer.company_id) {
        const companyCustomersRes = await db.query("SELECT id FROM customers WHERE company_id = $1", [customer.company_id]);
        return companyCustomersRes.rows.map(c => c.id);
    }
    
    return [customer.id]; // Only see their own data
};

// GET client dashboard stats
router.get("/client-stats", auth, async (req, res) => {
    if (normalizeRole(req.user.role) === 'ADMIN') {
        return res.status(403).json({ error: "Dostęp tylko dla klientów." });
    }

    try {
        const customerIds = await getCustomerScope(req.user.id);
        if (customerIds.length === 0) {
            return res.json({ tickets: {}, offers: {}, orders: 0 });
        }

        const ticketStats = await db.query(
            `SELECT status, COUNT(*) as count FROM tickets WHERE customer_id = ANY($1::int[]) GROUP BY status`,
            [customerIds]
        );

        const offerStats = await db.query(
            `SELECT status, COUNT(*) as count FROM offers WHERE customer_id = ANY($1::int[]) GROUP BY status`,
            [customerIds]
        );

        const tickets = ticketStats.rows.reduce((acc, row) => ({ ...acc, [row.status]: parseInt(row.count) }), {});
        const offers = offerStats.rows.reduce((acc, row) => ({ ...acc, [row.status]: parseInt(row.count) }), {});
        
        // "Zamówienia realizowane" are accepted offers
        const orders = offers['ZAAKCEPTOWANA'] || 0;

        res.json({ tickets, offers, orders });

    } catch (err) {
        console.error("Błąd przy pobieraniu statystyk klienta:", err);
        res.status(500).json({ error: "Błąd serwera." });
    }
});

// GET client activities
router.get("/client-activities", auth, async (req, res) => {
    if (normalizeRole(req.user.role) === 'ADMIN') {
        return res.status(403).json({ error: "Dostęp tylko dla klientów." });
    }
    try {
        const customerIds = await getCustomerScope(req.user.id);
        if (customerIds.length === 0) {
            return res.json([]);
        }

        const activities = await db.query(
            `(SELECT 'zlecenie_wyslane' as type, created_at as timestamp, subject as description
              FROM tickets WHERE customer_id = ANY($1::int[]))
             UNION ALL
             (SELECT 'oferta_otrzymana' as type, created_at as timestamp, title as description
              FROM offers WHERE customer_id = ANY($1::int[]))
             UNION ALL
             (SELECT 'oferta_zaakceptowana' as type, COALESCE(updated_at, created_at) as timestamp, title as description
              FROM offers WHERE customer_id = ANY($1::int[]) AND status = 'ZAAKCEPTOWANA')
             ORDER BY timestamp DESC
             LIMIT 10`,
            [customerIds]
        );
        res.json(activities.rows);
    } catch (err) {
        console.error("Błąd przy pobieraniu aktywności klienta:", err);
        res.status(500).json({ error: "Błąd serwera." });
    }
});

export default router;
