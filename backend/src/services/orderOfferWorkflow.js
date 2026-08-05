import { db } from "../db.js";
import { createNotification } from "../utils/notifications.js";

const OFFER_STATUS_TO_ORDER_STATUS = new Map([
  ["DO AKCEPTACJI", "WAITING_FOR_CLIENT"],
  ["WYSŁANA", "WAITING_FOR_CLIENT"],
  ["ZAAKCEPTOWANA", "IN_PROGRESS"],
  ["ODRZUCONA", "REJECTED"]
]);

const terminalOrderStatuses = new Set(["COMPLETED", "CANCELLED"]);

export function normalizeOfferStatus(status) {
  return String(status || "").trim().toUpperCase();
}

export function orderStatusForOfferStatus(status) {
  return OFFER_STATUS_TO_ORDER_STATUS.get(normalizeOfferStatus(status)) || null;
}

export function shouldPublishOffer(previousStatus, nextStatus) {
  const next = normalizeOfferStatus(nextStatus);
  const previous = normalizeOfferStatus(previousStatus);
  return ["DO AKCEPTACJI", "WYSŁANA"].includes(next)
    && !["DO AKCEPTACJI", "WYSŁANA"].includes(previous);
}

export async function synchronizeLinkedOrderStatus(sql, {
  ticketId,
  offerId,
  offerNumber,
  offerStatus,
  actorId
}) {
  const targetStatus = orderStatusForOfferStatus(offerStatus);
  if (!ticketId || !targetStatus) return null;

  const orderResult = await sql.query(
    `SELECT id, ticket_number, status
     FROM tickets
     WHERE id=$1 AND type='ORDER'
     FOR UPDATE`,
    [ticketId]
  );
  const order = orderResult.rows[0];
  if (!order) return null;

  if (terminalOrderStatuses.has(order.status) && order.status !== targetStatus) {
    return { ...order, skipped: true };
  }

  if (order.status === targetStatus) {
    return { ...order, previousStatus: order.status, targetStatus, changed: false };
  }

  await sql.query(
    `UPDATE tickets
     SET status=$1, updated_at=CURRENT_TIMESTAMP, closed_at=NULL
     WHERE id=$2`,
    [targetStatus, order.id]
  );

  const action = targetStatus === "IN_PROGRESS"
    ? "ORDER_OFFER_ACCEPTED"
    : targetStatus === "REJECTED"
      ? "ORDER_OFFER_REJECTED"
      : "ORDER_OFFER_SENT";
  const label = targetStatus === "IN_PROGRESS"
    ? `Klient zaakceptował ofertę ${offerNumber || `#${offerId}`}. Zamówienie przekazano do realizacji.`
    : targetStatus === "REJECTED"
      ? `Klient odrzucił ofertę ${offerNumber || `#${offerId}`}.`
      : `Oferta ${offerNumber || `#${offerId}`} została wysłana do klienta.`;

  await sql.query(
    `INSERT INTO ticket_history (ticket_id, user_id, action, old_value, new_value, metadata)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      order.id,
      actorId || null,
      action,
      order.status,
      targetStatus,
      JSON.stringify({ label, offerId, offerNumber, offerStatus: normalizeOfferStatus(offerStatus) })
    ]
  );

  return {
    ...order,
    previousStatus: order.status,
    targetStatus,
    status: targetStatus,
    changed: true
  };
}

export async function markOfferLifecycle(sql, offerId, status) {
  const normalizedStatus = normalizeOfferStatus(status);
  if (["DO AKCEPTACJI", "WYSŁANA"].includes(normalizedStatus)) {
    await sql.query(
      `UPDATE offers
       SET client_sent_at=COALESCE(client_sent_at, CURRENT_TIMESTAMP)
       WHERE id=$1`,
      [offerId]
    );
  }
  if (normalizedStatus === "ZAAKCEPTOWANA") {
    await sql.query(
      `UPDATE offers
       SET accepted_at=COALESCE(accepted_at, CURRENT_TIMESTAMP)
       WHERE id=$1`,
      [offerId]
    );
  }
}

export async function notifyClientUsersAboutOffer({ offerId, offerNumber, title }) {
  const recipients = await db.query(
    `SELECT DISTINCT u.id
     FROM offers o
     JOIN customers c ON c.id=o.customer_id
     JOIN users u ON (u.company_id=c.company_id OR u.id=c.user_id)
     WHERE o.id=$1
       AND COALESCE(u.is_active, TRUE)=TRUE
       AND u.role IN ('CLIENT_OWNER','CLIENT_EMPLOYEE','USER')
       AND (
         u.role='CLIENT_OWNER'
         OR EXISTS (
           SELECT 1 FROM user_permissions up
           WHERE up.user_id=u.id
             AND up.enabled=TRUE
             AND up.permission_key IN ('VIEW_OFFERS','ACCEPT_OFFERS')
         )
       )`,
    [offerId]
  );

  await Promise.all(recipients.rows.map(({ id }) => createNotification({
    userId: id,
    category: "OFFERS",
    type: "OFFER_SENT",
    priority: "INFO",
    title: "Nowa oferta do akceptacji",
    message: `${offerNumber || `Oferta #${offerId}`}: ${title || "Oferta handlowa"}`,
    entityType: "offer",
    entityId: offerId,
    link: `/client/offers/${offerId}`
  })));

  return recipients.rows.length;
}
