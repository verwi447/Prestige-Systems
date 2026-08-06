import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { after, before, test } from "node:test";
import dotenv from "dotenv";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../src/db.js";
import offerRoutes from "../src/routes/offers.js";
import ticketRoutes from "../src/routes/tickets.js";

dotenv.config();

let server;
let baseUrl;
let adminToken;
let clientOwnerToken;
let fixture;

function createToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: "prestige-systems-hub",
    audience: "prestige-systems-hub-api",
    expiresIn: "5m"
  });
}

async function request(path, token, { method = "GET", body } = {}) {
  const headers = token ? { Cookie: `token=${token}` } : {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await globalThis.fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const contentType = String(response.headers.get("content-type") || "");
  const responseBody = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body: responseBody };
}

before(async () => {
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    throw new Error("Test API wymaga DATABASE_URL oraz JWT_SECRET w pliku backend/.env.");
  }

  const adminResult = await db.query("SELECT id FROM users WHERE role='ADMIN' AND is_active IS DISTINCT FROM FALSE LIMIT 1");
  if (!adminResult.rows[0]) throw new Error("Test API wymaga aktywnego administratora.");
  const adminId = adminResult.rows[0].id;
  adminToken = createToken(adminId);

  const suffix = randomUUID();
  const ownerEmail = `qa-workflow-${suffix}@example.test`;
  const ownerHash = await bcrypt.hash(`Owner-${suffix.slice(0, 12)}!`, 4);

  const sql = await db.connect();
  try {
    await sql.query("BEGIN");
    const company = await sql.query(
      `INSERT INTO companies (name, email, country, is_active, is_own_company, created_by)
       VALUES ($1,$2,'Polska',TRUE,FALSE,$3)
       RETURNING id`,
      [`QA Workflow ${suffix}`, ownerEmail, adminId]
    );
    const companyId = company.rows[0].id;
    const owner = await sql.query(
      `INSERT INTO users (username, email, password, password_hash, company_id, role, first_name, last_name, is_active)
       VALUES ($1,$1,$2,$2,$3,'CLIENT_OWNER','QA','Wlasciciel',TRUE)
       RETURNING id`,
      [ownerEmail, ownerHash, companyId]
    );
    const ownerId = owner.rows[0].id;
    const customer = await sql.query(
      `INSERT INTO customers (name, email, company_id, company_role, user_id, created_by)
       VALUES ($1,$2,$3,'PRIMARY_CONTACT',$4,$5)
       RETURNING id`,
      [`QA Workflow ${suffix}`, ownerEmail, companyId, ownerId, adminId]
    );
    const site = await sql.query(
      `INSERT INTO objects (company_id, name, address, city, country, is_active, status, created_by)
       VALUES ($1,'QA Workflow Obiekt','Testowa 1','Warszawa','Polska',TRUE,'AKTYWNY',$2)
       RETURNING id`,
      [companyId, adminId]
    );
    const ticket = await sql.query(
      `INSERT INTO tickets (ticket_number, type, subject, description, object_id, customer_id, created_by, status)
       VALUES ($1,'SYSTEM_FAILURE','QA test zgloszenia','Opis testowy',$2,$3,$4,'NEW')
       RETURNING id`,
      [`QA-WF/${suffix}`, site.rows[0].id, customer.rows[0].id, ownerId]
    );
    await sql.query("COMMIT");

    fixture = {
      companyId,
      ownerId,
      customerId: customer.rows[0].id,
      siteId: site.rows[0].id,
      ticketId: ticket.rows[0].id
    };
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  } finally {
    sql.release();
  }

  clientOwnerToken = createToken(fixture.ownerId);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/offers", offerRoutes);
  app.use("/tickets", ticketRoutes);

  server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (fixture) {
    await db.query("DELETE FROM ticket_history WHERE ticket_id=$1", [fixture.ticketId]);
    await db.query("DELETE FROM ticket_comments WHERE ticket_id=$1", [fixture.ticketId]);
    await db.query("DELETE FROM offers WHERE customer_id=$1", [fixture.customerId]);
    await db.query("DELETE FROM tickets WHERE id=$1", [fixture.ticketId]);
    await db.query("DELETE FROM objects WHERE id=$1", [fixture.siteId]);
    await db.query("DELETE FROM customers WHERE id=$1", [fixture.customerId]);
    await db.query("DELETE FROM users WHERE id=$1", [fixture.ownerId]);
    await db.query("DELETE FROM companies WHERE id=$1", [fixture.companyId]);
  }
  await new Promise((resolve) => server.close(resolve));
  await db.end();
});

test("offer lifecycle: create, read, update, change status, delete", async () => {
  const create = await request("/offers", adminToken, {
    method: "POST",
    body: { customer_id: fixture.customerId, title: "QA Oferta testowa", items: [] }
  });
  assert.equal(create.response.status, 201);
  assert.equal(create.body.status, "SZKIC");
  assert.ok(create.body.offer_number);
  const offerId = create.body.id;

  const forbidden = await request("/offers", clientOwnerToken, {
    method: "POST",
    body: { customer_id: fixture.customerId, title: "QA nieuprawniona oferta" }
  });
  assert.equal(forbidden.response.status, 403);

  const read = await request(`/offers/${offerId}`, adminToken);
  assert.equal(read.response.status, 200);
  assert.equal(read.body.title, "QA Oferta testowa");

  const update = await request(`/offers/${offerId}`, adminToken, {
    method: "PUT",
    body: { customer_id: fixture.customerId, title: "QA Oferta zaktualizowana", items: [] }
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.body.title, "QA Oferta zaktualizowana");

  const statusChange = await request(`/offers/${offerId}/status`, adminToken, {
    method: "PATCH",
    body: { status: "WYSŁANA" }
  });
  assert.equal(statusChange.response.status, 200);
  assert.equal(statusChange.body.status, "WYSŁANA");

  const badStatus = await request(`/offers/${offerId}/status`, adminToken, {
    method: "PATCH",
    body: { status: "NIEISTNIEJACY" }
  });
  assert.equal(badStatus.response.status, 400);

  const auditRows = await db.query(
    "SELECT action FROM system_audit_log WHERE entity_type='offer' AND entity_id=$1 ORDER BY created_at",
    [String(offerId)]
  );
  assert.ok(auditRows.rows.some((row) => row.action === "OFFER_CREATED"));
  assert.ok(auditRows.rows.some((row) => row.action === "OFFER_STATUS_CHANGED"));

  const remove = await request(`/offers/${offerId}`, adminToken, { method: "DELETE" });
  assert.equal(remove.response.status, 200);

  const readAfterDelete = await request(`/offers/${offerId}`, adminToken);
  assert.equal(readAfterDelete.response.status, 404);
});

test("ticket lifecycle: update, change status, change priority, assign, comment, close", async () => {
  const adminSelf = await db.query("SELECT id FROM users WHERE role='ADMIN' AND is_active IS DISTINCT FROM FALSE ORDER BY id LIMIT 1");
  const adminId = adminSelf.rows[0].id;

  const forbiddenChange = await request(`/tickets/${fixture.ticketId}/change-status`, clientOwnerToken, {
    method: "POST",
    body: { status: "IN_PROGRESS" }
  });
  assert.equal(forbiddenChange.response.status, 403);

  const priorityChange = await request(`/tickets/${fixture.ticketId}/change-priority`, adminToken, {
    method: "POST",
    body: { priority: "HIGH" }
  });
  assert.equal(priorityChange.response.status, 200);
  assert.equal(priorityChange.body.priority, "HIGH");

  const assign = await request(`/tickets/${fixture.ticketId}/assign`, adminToken, {
    method: "POST",
    body: { adminId }
  });
  assert.equal(assign.response.status, 200);
  assert.equal(assign.body.status, "IN_PROGRESS");

  const badAssign = await request(`/tickets/${fixture.ticketId}/assign`, adminToken, {
    method: "POST",
    body: { adminId: 999999999 }
  });
  assert.equal(badAssign.response.status, 400);

  const statusChange = await request(`/tickets/${fixture.ticketId}/change-status`, adminToken, {
    method: "POST",
    body: { status: "WAITING_FOR_PARTS", comment: "QA: czekamy na czesci" }
  });
  assert.equal(statusChange.response.status, 200);
  assert.equal(statusChange.body.status, "WAITING_FOR_PARTS");

  const comment = await request(`/tickets/${fixture.ticketId}/comments`, adminToken, {
    method: "POST",
    body: { content: "QA komentarz wewnetrzny", isInternal: true }
  });
  assert.equal(comment.response.status, 201);

  const close = await request(`/tickets/${fixture.ticketId}/close`, adminToken, {
    method: "POST",
    body: { summary: "QA: naprawiono usterke." }
  });
  assert.equal(close.response.status, 200);
  assert.equal(close.body.status, "COMPLETED");

  const closeWithoutSummary = await request(`/tickets/${fixture.ticketId}/close`, adminToken, {
    method: "POST",
    body: {}
  });
  assert.equal(closeWithoutSummary.response.status, 400);

  const history = await request(`/tickets/${fixture.ticketId}/history`, adminToken);
  assert.equal(history.response.status, 200);
  const actions = history.body.map((item) => item.action);
  assert.ok(actions.includes("TICKET_PRIORITY_CHANGED"));
  assert.ok(actions.includes("TICKET_ASSIGNED"));
  assert.ok(actions.includes("TICKET_STATUS_CHANGED"));
  assert.ok(actions.includes("TICKET_CLOSED"));
});

test("client can create a ticket for their own company", async () => {
  const create = await request("/tickets", clientOwnerToken, {
    method: "POST",
    body: { type: "SYSTEM_FAILURE", object_id: fixture.siteId, subject: "QA nowe zgloszenie", description: "Opis" }
  });
  assert.equal(create.response.status, 201);
  assert.equal(create.body.status, "NEW");
  assert.ok(create.body.ticket_number);

  await db.query("DELETE FROM ticket_history WHERE ticket_id=$1", [create.body.id]);
  await db.query("DELETE FROM tickets WHERE id=$1", [create.body.id]);

  const missingFields = await request("/tickets", clientOwnerToken, {
    method: "POST",
    body: { type: "SYSTEM_FAILURE" }
  });
  assert.equal(missingFields.response.status, 400);

  const adminCannotCreate = await request("/tickets", adminToken, {
    method: "POST",
    body: { type: "SYSTEM_FAILURE", object_id: fixture.siteId, subject: "QA admin proba", description: "Opis" }
  });
  assert.equal(adminCannotCreate.response.status, 403);
});
