const actionPriority = (priority = "") => {
  const normalized = String(priority).toUpperCase();
  if (normalized === "CRITICAL") return { tone: "critical", rank: 0 };
  if (normalized === "HIGH") return { tone: "warning", rank: 1 };
  return { tone: "info", rank: 2 };
};

const companyName = (row) => row.company_name || row.customer_name || "Brak przypisanej firmy";

const actionDate = (row) => row.updated_at || row.created_at || null;

export function buildAdminActionItems({ tickets = [], offers = [], orders = [] } = {}) {
  const ticketActions = tickets.map((ticket) => {
    const priority = actionPriority(ticket.priority);
    return {
      id: `ticket-${ticket.id}`,
      kind: "ticket",
      title: "Zgloszenie bez opiekuna",
      description: [ticket.ticket_number, ticket.subject].filter(Boolean).join(" - ") || "Zgloszenie wymaga przypisania.",
      companyName: companyName(ticket),
      link: `/tickets/${ticket.id}`,
      createdAt: actionDate(ticket),
      tone: priority.tone,
      rank: priority.rank
    };
  });

  const orderActions = orders.map((order) => {
    const priority = actionPriority(order.priority);
    return {
      id: `order-${order.id}`,
      kind: "order",
      title: "Zamowienie bez opiekuna",
      description: [order.ticket_number, order.subject].filter(Boolean).join(" - ") || "Zamowienie wymaga przypisania.",
      companyName: companyName(order),
      link: `/orders/${order.id}`,
      createdAt: actionDate(order),
      tone: priority.tone,
      rank: priority.rank
    };
  });

  const offerActions = offers.map((offer) => ({
    id: `offer-${offer.id}`,
    kind: "offer",
    title: "Oferta do wyslania",
    description: [offer.offer_number, offer.title].filter(Boolean).join(" - ") || "Szkic oferty wymaga wyslania.",
    companyName: companyName(offer),
    link: `/offers/${offer.id}`,
    createdAt: actionDate(offer),
    tone: "info",
    rank: 3
  }));

  return [...ticketActions, ...orderActions, ...offerActions]
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    })
    .slice(0, 8)
    .map((item) => {
      const publicItem = { ...item };
      delete publicItem.rank;
      return publicItem;
    });
}

export async function getAdminActionItems(query) {
  const [tickets, offers, orders] = await Promise.all([
    query(
      `SELECT t.id, t.ticket_number, t.subject, t.priority, t.created_at, t.updated_at,
              COALESCE(co.name, c.name) AS company_name
       FROM tickets t
       LEFT JOIN customers c ON c.id=t.customer_id
       LEFT JOIN companies co ON co.id=c.company_id
       WHERE t.type <> 'ORDER'
         AND t.assigned_to_id IS NULL
         AND t.status IN ('NEW', 'ACCEPTED', 'IN_PROGRESS', 'WAITING_FOR_PARTS')
       ORDER BY CASE t.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
                COALESCE(t.updated_at, t.created_at) DESC
       LIMIT 4`
    ),
    query(
      `SELECT o.id, o.offer_number, o.title, o.created_at, o.updated_at,
              COALESCE(co.name, o.client_company_name, c.name) AS company_name
       FROM offers o
       LEFT JOIN customers c ON c.id=o.customer_id
       LEFT JOIN companies co ON co.id=c.company_id
       WHERE o.status='SZKIC'
       ORDER BY COALESCE(o.updated_at, o.created_at) DESC
       LIMIT 4`
    ),
    query(
      `SELECT t.id, t.ticket_number, t.subject, t.priority, t.created_at, t.updated_at,
              COALESCE(co.name, c.name) AS company_name
       FROM tickets t
       LEFT JOIN customers c ON c.id=t.customer_id
       LEFT JOIN companies co ON co.id=c.company_id
       WHERE t.type='ORDER'
         AND t.assigned_to_id IS NULL
         AND t.status IN ('NEW', 'ACCEPTED', 'IN_PROGRESS', 'WAITING_FOR_PARTS')
       ORDER BY CASE t.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
                COALESCE(t.updated_at, t.created_at) DESC
       LIMIT 4`
    )
  ]);

  return buildAdminActionItems({ tickets: tickets.rows, offers: offers.rows, orders: orders.rows });
}
