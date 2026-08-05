import assert from "node:assert/strict";
import test from "node:test";
import {
  orderStatusForOfferStatus,
  shouldPublishOffer
} from "../src/services/orderOfferWorkflow.js";

test("client-facing offer statuses move an order to waiting for client", () => {
  assert.equal(orderStatusForOfferStatus("DO AKCEPTACJI"), "WAITING_FOR_CLIENT");
  assert.equal(orderStatusForOfferStatus("wysłana"), "WAITING_FOR_CLIENT");
});

test("accepted offer moves an order to in progress", () => {
  assert.equal(orderStatusForOfferStatus("ZAAKCEPTOWANA"), "IN_PROGRESS");
});

test("draft offers do not change the linked order status", () => {
  assert.equal(orderStatusForOfferStatus("SZKIC"), null);
});

test("rejected offer marks the linked order as rejected", () => {
  assert.equal(orderStatusForOfferStatus("ODRZUCONA"), "REJECTED");
});

test("offer is published only on its first transition to a client-facing status", () => {
  assert.equal(shouldPublishOffer("SZKIC", "DO AKCEPTACJI"), true);
  assert.equal(shouldPublishOffer("DO AKCEPTACJI", "DO AKCEPTACJI"), false);
  assert.equal(shouldPublishOffer("WYSŁANA", "DO AKCEPTACJI"), false);
});
