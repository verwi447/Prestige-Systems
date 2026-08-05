import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminActionItems } from "../src/services/dashboardActions.js";
import { buildBackupSuccessSummary } from "../src/utils/notifications.js";

test("dashboard actions prioritize critical unassigned work before drafts", () => {
  const actions = buildAdminActionItems({
    tickets: [
      { id: 11, ticket_number: "ZG/2026/0011", subject: "Normalne zgloszenie", priority: "NORMAL", company_name: "Firma A", created_at: "2026-08-01T10:00:00Z" },
      { id: 12, ticket_number: "ZG/2026/0012", subject: "Krytyczne zgloszenie", priority: "CRITICAL", company_name: "Firma B", created_at: "2026-08-01T08:00:00Z" }
    ],
    offers: [
      { id: 21, offer_number: "PS/2026/0021", title: "Szkic", company_name: "Firma C", created_at: "2026-08-01T11:00:00Z" }
    ],
    orders: [
      { id: 31, ticket_number: "ZS/2026/0031", subject: "Zamowienie", priority: "HIGH", company_name: "Firma D", created_at: "2026-08-01T09:00:00Z" }
    ]
  });

  assert.deepEqual(actions.map((item) => item.id), ["ticket-12", "order-31", "ticket-11", "offer-21"]);
  assert.equal(actions[0].tone, "critical");
  assert.equal(actions[1].link, "/orders/31");
  assert.equal(actions[3].link, "/offers/21");
  assert.equal("rank" in actions[0], false);
});

test("dashboard actions keep the list focused on eight items", () => {
  const actions = buildAdminActionItems({
    tickets: Array.from({ length: 9 }, (_, index) => ({
      id: index + 1,
      ticket_number: `ZG/${index + 1}`,
      subject: "Zgloszenie",
      priority: "NORMAL",
      created_at: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00Z`
    }))
  });

  assert.equal(actions.length, 8);
  assert.equal(actions[0].id, "ticket-9");
});

test("backup success summary increments an existing grouped notification", () => {
  const summary = buildBackupSuccessSummary("Backup zakończony (3)", "backup-v1.0.0.zip został utworzony poprawnie.");

  assert.equal(summary.title, "Backup zakończony (4)");
  assert.match(summary.message, /Utworzono dzisiaj 4 kopie zapasowe/);
  assert.match(summary.message, /backup-v1\.0\.0\.zip/);
});

test("first aggregated backup success begins with two backups", () => {
  const summary = buildBackupSuccessSummary("Backup zakończony", "najnowszy backup");

  assert.equal(summary.title, "Backup zakończony (2)");
});
