import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { db } from "../src/db.js";

let fixture;

async function createFixture() {
  const suffix = randomUUID();
  const ownerEmail = `e2e-owner-${suffix}@example.test`;
  const employeeEmail = `e2e-employee-${suffix}@example.test`;
  const adminEmail = `e2e-admin-${suffix}@example.test`;
  const ownerPassword = `Owner-${suffix.slice(0, 12)}!`;
  const employeePassword = `Employee-${suffix.slice(0, 12)}!`;
  const adminPassword = `Admin-${suffix.slice(0, 12)}!`;
  const connection = await db.connect();

  try {
    await connection.query("BEGIN");
    const admin = await connection.query("SELECT id FROM users WHERE role='ADMIN' AND is_active IS DISTINCT FROM FALSE LIMIT 1");
    assert.ok(admin.rows[0], "Test E2E wymaga aktywnego administratora.");

    const company = await connection.query(
      `INSERT INTO companies (name, email, country, is_active, is_own_company, created_by)
       VALUES ($1,$2,'Polska',TRUE,FALSE,$3)
       RETURNING id`,
      [`QA E2E ${suffix}`, ownerEmail, admin.rows[0].id]
    );
    const companyId = company.rows[0].id;
    const customer = await connection.query(
      `INSERT INTO customers (name, email, company_id, company_role, created_by)
       VALUES ($1,$2,$3,'PRIMARY_CONTACT',$4)
       RETURNING id`,
      [`QA E2E ${suffix}`, ownerEmail, companyId, admin.rows[0].id]
    );
    const [ownerHash, employeeHash, adminHash] = await Promise.all([
      bcrypt.hash(ownerPassword, 4),
      bcrypt.hash(employeePassword, 4),
      bcrypt.hash(adminPassword, 4)
    ]);
    const owner = await connection.query(
      `INSERT INTO users (username, email, password, password_hash, company_id, role, first_name, last_name, is_active)
       VALUES ($1,$1,$2,$2,$3,'CLIENT_OWNER','QA','Wlasciciel',TRUE)
       RETURNING id`,
      [ownerEmail, ownerHash, companyId]
    );
    const employee = await connection.query(
      `INSERT INTO users (username, email, password, password_hash, company_id, role, first_name, last_name, is_active)
       VALUES ($1,$1,$2,$2,$3,'CLIENT_EMPLOYEE','QA','Pracownik',TRUE)
       RETURNING id`,
      [employeeEmail, employeeHash, companyId]
    );
    const adminUser = await connection.query(
      `INSERT INTO users (username, email, password, password_hash, role, first_name, last_name, is_active)
       VALUES ($1,$1,$2,$2,'ADMIN','QA','Administrator',TRUE)
       RETURNING id`,
      [adminEmail, adminHash]
    );
    await connection.query("UPDATE customers SET user_id=$1 WHERE id=$2", [owner.rows[0].id, customer.rows[0].id]);
    const site = await connection.query(
      `INSERT INTO objects (company_id, name, address, city, country, is_active, status, created_by)
       VALUES ($1,'QA E2E obiekt','Testowa 1','Warszawa','Polska',TRUE,'AKTYWNY',$2)
       RETURNING id`,
      [companyId, admin.rows[0].id]
    );
    const order = await connection.query(
      `INSERT INTO tickets (
        ticket_number, type, object_id, subject, description, customer_id, created_by,
        status, priority, updated_at
      )
       VALUES ($1,'ORDER',$2,'QA E2E zamowienie','Zamowienie do testu E2E',$3,$4,'WAITING_FOR_CLIENT','NORMAL',CURRENT_TIMESTAMP)
       RETURNING id`,
      [`E2E/${suffix}`, site.rows[0].id, customer.rows[0].id, owner.rows[0].id]
    );
    await connection.query(
      `INSERT INTO ticket_items (ticket_id, name, code, quantity, price_net, total_net)
       VALUES ($1,'QA E2E artykul','QA-E2E',1,120,120)`,
      [order.rows[0].id]
    );
    const adminOrder = await connection.query(
      `INSERT INTO tickets (
        ticket_number, type, object_id, subject, description, customer_id, created_by,
        status, priority, updated_at
      )
       VALUES ($1,'ORDER',$2,'QA E2E przeplyw admina','Zamowienie do testu kreatora oferty',$3,$4,'NEW','NORMAL',CURRENT_TIMESTAMP)
       RETURNING id`,
      [`E2E/A/${suffix}`, site.rows[0].id, customer.rows[0].id, owner.rows[0].id]
    );
    await connection.query(
      `INSERT INTO ticket_items (ticket_id, name, code, quantity, price_net, total_net, vat_rate)
       VALUES ($1,'QA E2E produkt z zamowienia','QA-ORDER',2,75,150,23)`,
      [adminOrder.rows[0].id]
    );
    const attentionTicket = await connection.query(
      `INSERT INTO tickets (
        ticket_number, type, object_id, subject, description, customer_id, created_by,
        status, priority, updated_at
      )
       VALUES ($1,'HARDWARE_FAILURE',$2,'QA E2E zgloszenie bez opiekuna','Zgloszenie do testu centrum dzialan',$3,$4,'NEW','HIGH',CURRENT_TIMESTAMP)
       RETURNING id`,
      [`E2E/T/${suffix}`, site.rows[0].id, customer.rows[0].id, owner.rows[0].id]
    );
    const offer = await connection.query(
      `INSERT INTO offers (
        offer_number, title, description, object_id, customer_id, status, total_price,
        created_by, issue_date, valid_until, currency, ticket_id, client_sent_at
      )
       VALUES ($1,'QA E2E oferta','Oferta powiazana z zamowieniem',$2,$3,'DO AKCEPTACJI',120,$4,CURRENT_DATE,CURRENT_DATE + 14,'PLN',$5,CURRENT_TIMESTAMP)
       RETURNING id`,
      [`E2E/O/${suffix}`, site.rows[0].id, customer.rows[0].id, admin.rows[0].id, order.rows[0].id]
    );
    await connection.query(
      `INSERT INTO offer_items (offer_id, item_number, title, quantity, unit_price, total, net_total, vat_rate, vat_value, gross_total)
       VALUES ($1,1,'QA E2E artykul',1,120,120,120,23,27.6,147.6)`,
      [offer.rows[0].id]
    );
    await connection.query("COMMIT");

    return {
      companyId,
      customerId: customer.rows[0].id,
      ownerId: owner.rows[0].id,
      employeeId: employee.rows[0].id,
      adminId: adminUser.rows[0].id,
      siteId: site.rows[0].id,
      orderId: order.rows[0].id,
      adminOrderId: adminOrder.rows[0].id,
      attentionTicketId: attentionTicket.rows[0].id,
      offerId: offer.rows[0].id,
      ownerEmail,
      ownerPassword,
      employeeEmail,
      employeePassword,
      adminEmail,
      adminPassword
    };
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

async function cleanupFixture() {
  if (!fixture) return;
  const ticketIds = [fixture.orderId, fixture.adminOrderId, fixture.attentionTicketId];
  const userIds = [fixture.ownerId, fixture.employeeId, fixture.adminId];
  const offerIdsResult = await db.query("SELECT id FROM offers WHERE ticket_id = ANY($1::int[]) OR id=$2", [ticketIds, fixture.offerId]);
  const offerIds = offerIdsResult.rows.map(({ id }) => id);

  const uploaded = await db.query("SELECT file_path FROM ticket_photos WHERE ticket_id = ANY($1::int[])", [ticketIds]);
  await Promise.all(uploaded.rows.map(async ({ file_path: filePath }) => {
    if (!filePath) return;
    const absolutePath = path.resolve("uploads", filePath.replace(/^\/uploads\//, ""));
    await fs.rm(absolutePath, { force: true });
  }));

  await db.query(
    "DELETE FROM notifications WHERE user_id = ANY($1::int[]) OR entity_id = ANY($2::text[])",
    [userIds, [...ticketIds, ...offerIds].map(String)]
  );
  await db.query("DELETE FROM system_audit_log WHERE company_id=$1", [fixture.companyId]);
  await db.query("DELETE FROM comments WHERE offer_id = ANY($1::int[])", [offerIds]);
  await db.query("DELETE FROM offer_items WHERE offer_id = ANY($1::int[])", [offerIds]);
  await db.query("DELETE FROM offers WHERE id = ANY($1::int[])", [offerIds]);
  await db.query("DELETE FROM ticket_comments WHERE ticket_id = ANY($1::int[])", [ticketIds]);
  await db.query("DELETE FROM ticket_photos WHERE ticket_id = ANY($1::int[])", [ticketIds]);
  await db.query("DELETE FROM ticket_items WHERE ticket_id = ANY($1::int[])", [ticketIds]);
  await db.query("DELETE FROM ticket_history WHERE ticket_id = ANY($1::int[])", [ticketIds]);
  await db.query("DELETE FROM tickets WHERE id = ANY($1::int[])", [ticketIds]);
  await db.query("DELETE FROM user_permissions WHERE user_id = ANY($1::int[])", [userIds]);
  await db.query("DELETE FROM user_site_access WHERE user_id = ANY($1::int[]) OR site_id=$2", [userIds, fixture.siteId]);
  await db.query("DELETE FROM objects WHERE id=$1", [fixture.siteId]);
  await db.query("DELETE FROM users WHERE id = ANY($1::int[])", [userIds]);
  await db.query("DELETE FROM customers WHERE id=$1", [fixture.customerId]);
  await db.query("DELETE FROM companies WHERE id=$1", [fixture.companyId]);
}

async function login(page, username, password, destination = /\/client\/dashboard$/) {
  await page.goto("/login");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/auth/login") && response.request().method() === "POST");
  await page.locator("button.login-submit").click();
  expect((await responsePromise).status()).toBe(200);
  await page.waitForURL(destination, { timeout: 10_000 });
}

test.beforeAll(async ({ request }) => {
  const response = await request.get("/app-version.json");
  expect(response.ok(), "Uruchom lokalna usluge Prestige Systems HUB przed testami E2E.").toBeTruthy();
  fixture = await createFixture();
});

test.afterAll(async () => {
  await cleanupFixture();
  await db.end();
});

test("dashboard administratora prowadzi do spraw bez opiekuna", async ({ page }) => {
  await login(page, fixture.adminEmail, fixture.adminPassword, /\/dashboard$/);

  const actionPanel = page.locator(".admin-attention-panel");
  await expect(actionPanel).toBeVisible();
  await expect(actionPanel.getByText("Wymaga Twojej uwagi", { exact: true })).toBeVisible();
  const ticketAction = actionPanel.locator(`a[href="/tickets/${fixture.attentionTicketId}"]`);
  await expect(ticketAction).toContainText("QA E2E zgloszenie bez opiekuna");
  await ticketAction.click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${fixture.attentionTicketId}$`));
});

test("klient akceptuje oferte powiazana z zamowieniem", async ({ page }) => {
  await login(page, fixture.ownerEmail, fixture.ownerPassword);
  await page.goto(`/client/orders/${fixture.orderId}`);

  await expect(page.getByText("QA E2E zamowienie", { exact: true })).toBeVisible();
  await page.locator("a, button").filter({ hasText: "Przejrzyj oferte" }).first().click();
  await expect(page.getByText("QA E2E oferta", { exact: true }).first()).toBeVisible();

  await page.locator(".client-offer-header-actions button.success").click();
  await page.locator(".client-offer-modal button.success").click();
  await expect(page.getByText("Zaakceptowana").first()).toBeVisible();

  await expect.poll(async () => (await db.query("SELECT status FROM offers WHERE id=$1", [fixture.offerId])).rows[0]?.status).toBe("ZAAKCEPTOWANA");
  await expect.poll(async () => (await db.query("SELECT status FROM tickets WHERE id=$1", [fixture.orderId])).rows[0]?.status).toBe("IN_PROGRESS");
});

test("administrator tworzy oferte z zamowienia, a klient akceptuje ja w portalu", async ({ page }) => {
  await login(page, fixture.adminEmail, fixture.adminPassword, /\/dashboard$/);
  await page.goto(`/orders/${fixture.adminOrderId}`);

  await expect(page.getByText("QA E2E przeplyw admina", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Przypisz", exact: true }).click();
  const assignModal = page.locator(".admin-order-modal");
  await assignModal.getByLabel("Administrator").selectOption(String(fixture.adminId));
  const assignmentResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin-orders/${fixture.adminOrderId}/assign`) && response.request().method() === "PATCH"
  );
  await assignModal.getByRole("button", { name: "Przypisz", exact: true }).click();
  expect((await assignmentResponse).status()).toBe(200);

  await expect.poll(async () => (await db.query(
    "SELECT assigned_to_id, status FROM tickets WHERE id=$1",
    [fixture.adminOrderId]
  )).rows[0]).toMatchObject({ assigned_to_id: fixture.adminId, status: "NEW" });

  await page.getByRole("button", { name: "Utwórz ofertę", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Kreator ofert handlowych" })).toBeVisible();
  await expect(page.getByText("Uzupełniono dane i produkty z zamówienia", { exact: false })).toBeVisible();
  await expect(page.getByText("QA E2E produkt z zamowienia", { exact: true })).toBeVisible();
  await page.locator(".wizard-progress button").filter({ hasText: "Podsumowanie" }).click();

  const createOfferResponse = page.waitForResponse((response) =>
    response.url().endsWith("/offers") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Zapisz i zakończ", exact: true }).click();
  expect((await createOfferResponse).status()).toBe(201);
  await expect(page).toHaveURL(new RegExp(`/orders/${fixture.adminOrderId}\\?tab=offer$`));

  await expect.poll(async () => (await db.query(
    "SELECT id, status, ticket_id, client_sent_at FROM offers WHERE ticket_id=$1 ORDER BY id DESC LIMIT 1",
    [fixture.adminOrderId]
  )).rows[0]).toMatchObject({ status: "DO AKCEPTACJI", ticket_id: fixture.adminOrderId });
  const createdOffer = (await db.query(
    "SELECT id, client_sent_at FROM offers WHERE ticket_id=$1 ORDER BY id DESC LIMIT 1",
    [fixture.adminOrderId]
  )).rows[0];
  expect(createdOffer.client_sent_at).toBeTruthy();
  await expect.poll(async () => (await db.query("SELECT status FROM tickets WHERE id=$1", [fixture.adminOrderId])).rows[0]?.status).toBe("WAITING_FOR_CLIENT");

  await login(page, fixture.ownerEmail, fixture.ownerPassword);
  await page.goto(`/client/orders/${fixture.adminOrderId}`);
  await page.locator("a, button").filter({ hasText: "Przejrzyj oferte" }).first().click();

  await page.locator(".client-offer-header-actions button.success").click();
  await page.locator(".client-offer-modal button.success").click();
  await expect.poll(async () => (await db.query("SELECT status FROM offers WHERE id=$1", [createdOffer.id])).rows[0]?.status).toBe("ZAAKCEPTOWANA");
  await expect.poll(async () => (await db.query("SELECT status FROM tickets WHERE id=$1", [fixture.adminOrderId])).rows[0]?.status).toBe("IN_PROGRESS");
});

test("pracownik bez uprawnienia otrzymuje czytelny ekran braku dostepu", async ({ page }) => {
  await login(page, fixture.employeeEmail, fixture.employeePassword);
  await page.goto("/client/offers");

  await expect(page.getByRole("heading", { name: "Brak uprawnien" })).toBeVisible();
  await expect(page.getByText("Nie masz dostepu do tej czesci panelu.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Wroc do dashboardu" })).toBeVisible();
});

test("klient dodaje komentarz i bezpieczny zalacznik do zamowienia", async ({ page }) => {
  await login(page, fixture.ownerEmail, fixture.ownerPassword);
  await page.goto(`/client/orders/${fixture.orderId}`);

  const composer = page.locator(".client-ticket-comment-composer");
  await composer.getByPlaceholder("Napisz komentarz...").fill("Komentarz E2E od klienta.");
  const commentResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/client/tickets/${fixture.orderId}/comments`) && response.request().method() === "POST"
  );
  await composer.getByRole("button", { name: "Dodaj komentarz" }).click();
  expect((await commentResponse).status()).toBe(201);
  await expect(page.getByText("Komentarz E2E od klienta.", { exact: true })).toBeVisible();

  const attachmentResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/client/tickets/${fixture.orderId}/attachments`) && response.request().method() === "POST"
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "dowod-e2e.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9o+7n8QAAAAASUVORK5CYII=", "base64")
  });
  expect((await attachmentResponse).status()).toBe(201);
  await expect(page.locator(".client-ticket-detail-side .client-ticket-detail-row").filter({ hasText: "Zalaczniki" }).getByText("1", { exact: true })).toBeVisible();
});

test("panel pokazuje utrate i przywrocenie polaczenia", async ({ page }) => {
  await login(page, fixture.ownerEmail, fixture.ownerPassword);
  await expect(page.getByRole("main")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText("Utracono polaczenie.")).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("Polaczenie z serwerem zostalo przywrocone.")).toBeVisible();
});

test("bledne logowanie przekazuje komunikat bez ujawniania danych", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[autocomplete="username"]').fill(fixture.ownerEmail);
  await page.locator('input[autocomplete="current-password"]').fill("zle-haslo");
  await page.locator("button.login-submit").click();

  await expect(page.locator(".login-message")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
