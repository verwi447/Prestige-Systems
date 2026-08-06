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
import authRoutes from "../src/routes/auth.js";
import adminOrderRoutes from "../src/routes/adminOrders.js";
import auditRoutes from "../src/routes/audit.js";
import clientRoutes from "../src/routes/client.js";
import fileRoutes from "../src/routes/files.js";
import offerRoutes from "../src/routes/offers.js";
import systemRoutes from "../src/routes/system.js";
import ticketRoutes from "../src/routes/tickets.js";
import userRoutes from "../src/routes/users.js";

dotenv.config();

let server;
let baseUrl;
let adminToken;
let clientOwnerToken;
let permissionFixture;

function createToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: "prestige-systems-hub",
    audience: "prestige-systems-hub-api",
    expiresIn: "2m"
  });
}

function extractTokenCookie(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/(?:^|,\s*)token=([^;]+)/);
  return match?.[1];
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

  const [adminResult, clientOwnerResult] = await Promise.all([
    db.query("SELECT id FROM users WHERE role='ADMIN' AND is_active IS DISTINCT FROM FALSE LIMIT 1"),
    db.query("SELECT id FROM users WHERE role='CLIENT_OWNER' AND is_active IS DISTINCT FROM FALSE LIMIT 1")
  ]);

  if (!adminResult.rows[0] || !clientOwnerResult.rows[0]) {
    throw new Error("Test API wymaga aktywnego administratora oraz właściciela firmy.");
  }

  adminToken = createToken(adminResult.rows[0].id);
  clientOwnerToken = createToken(clientOwnerResult.rows[0].id);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/auth", authRoutes);
  app.use("/offers", offerRoutes);
  app.use("/tickets", ticketRoutes);
  app.use("/api/admin-orders", adminOrderRoutes);
  app.use("/api/client", clientRoutes);
  app.use("/api/files", fileRoutes);
  app.use("/api/system", systemRoutes);
  app.use("/api/audit", auditRoutes);
  app.use("/users", userRoutes);

  server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (permissionFixture) {
    const { companyId, userIds, ticketIds, siteIds } = permissionFixture;
    await db.query("DELETE FROM ticket_comments WHERE ticket_id = ANY($1::int[])", [ticketIds]);
    await db.query("DELETE FROM ticket_photos WHERE ticket_id = ANY($1::int[])", [ticketIds]);
    await db.query("DELETE FROM ticket_items WHERE ticket_id = ANY($1::int[])", [ticketIds]);
    await db.query("DELETE FROM ticket_history WHERE ticket_id = ANY($1::int[])", [ticketIds]);
    await db.query("DELETE FROM tickets WHERE id = ANY($1::int[])", [ticketIds]);
    await db.query("DELETE FROM user_permissions WHERE user_id = ANY($1::int[])", [userIds]);
    await db.query("DELETE FROM user_site_access WHERE user_id = ANY($1::int[]) OR site_id = ANY($2::int[])", [userIds, siteIds]);
    await db.query("DELETE FROM objects WHERE id = ANY($1::int[])", [siteIds]);
    await db.query("DELETE FROM users WHERE id = ANY($1::int[])", [userIds]);
    await db.query("DELETE FROM customers WHERE company_id=$1", [companyId]);
    await db.query("DELETE FROM companies WHERE id=$1", [companyId]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.end();
});

test("API enforces authentication, roles, client scope and protected files", async (t) => {
  await t.test("rejects a system request without a token", async () => {
    const { response, body } = await request("/api/system/status");
    assert.equal(response.status, 401);
    assert.equal(body.error, "Brak tokenu");
  });

  await t.test("allows the administrator to read the system status without secrets", async () => {
    const { response, body } = await request("/api/system/status", adminToken);
    assert.equal(response.status, 200);
    assert.equal(body.application.version, "1.0.1");
    assert.equal(body.application.schemaVersion, "2026.08.05.001");
    assert.equal(body.migration.isCurrent, true);
    assert.equal(body.database.status, "ONLINE");
    assert.equal(Object.hasOwn(body.email, "smtpHost"), false);
    assert.equal(Object.hasOwn(body.email, "smtpPassword"), false);
  });

  await t.test("denies system status to a client owner", async () => {
    const { response, body } = await request("/api/system/status", clientOwnerToken);
    assert.equal(response.status, 403);
    assert.equal(body.error, "Brak uprawnień.");
  });

  await t.test("allows only administrators to read the global audit log", async () => {
    const allowed = await request("/api/audit?limit=5", adminToken);
    assert.equal(allowed.response.status, 200);
    assert.ok(Array.isArray(allowed.body.items));
    assert.equal(typeof allowed.body.total, "number");

    const denied = await request("/api/audit", clientOwnerToken);
    assert.equal(denied.response.status, 403);
  });

  await t.test("allows a client owner to read only client modules", async () => {
    for (const path of ["/api/client/offers", "/api/client/tickets", "/api/client/tickets?scope=orders", "/api/client/catalog"]) {
      const { response, body } = await request(path, clientOwnerToken);
      assert.equal(response.status, 200, path);
      assert.ok(Array.isArray(body), `${path} should return an array`);
    }
  });

  await t.test("allows the administrator to read operations modules", async () => {
    for (const path of ["/offers", "/tickets", "/api/admin-orders"]) {
      const { response, body } = await request(path, adminToken);
      assert.equal(response.status, 200, path);
      assert.ok(Array.isArray(body), `${path} should return an array`);
    }
  });

  await t.test("protects attachment downloads before resolving a file", async () => {
    const { response, body } = await request("/api/files/ticket-attachments/non-existent");
    assert.equal(response.status, 401);
    assert.equal(body.error, "Brak tokenu");
  });
});

test("client owner can grant employee permissions and employee restrictions are enforced", async () => {
  const suffix = randomUUID();
  const ownerPassword = `Owner-${suffix.slice(0, 12)}!`;
  const employeePassword = `Employee-${suffix.slice(0, 12)}!`;
  const ownerEmail = `qa-owner-${suffix}@example.test`;
  const employeeEmail = `qa-employee-${suffix}@example.test`;
  const adminResult = await db.query("SELECT id FROM users WHERE role='ADMIN' AND is_active IS DISTINCT FROM FALSE LIMIT 1");
  assert.ok(adminResult.rows[0], "Test wymaga aktywnego administratora.");

  const sql = await db.connect();
  try {
    await sql.query("BEGIN");
    const company = await sql.query(
      `INSERT INTO companies (name, email, country, is_active, is_own_company, created_by)
       VALUES ($1,$2,'Polska',TRUE,FALSE,$3)
       RETURNING id`,
      [`QA Uprawnienia ${suffix}`, ownerEmail, adminResult.rows[0].id]
    );
    const companyId = company.rows[0].id;
    const customer = await sql.query(
      `INSERT INTO customers (name, email, company_id, company_role, created_by)
       VALUES ($1,$2,$3,'PRIMARY_CONTACT',$4)
       RETURNING id`,
      [`QA Uprawnienia ${suffix}`, ownerEmail, companyId, adminResult.rows[0].id]
    );

    const [ownerHash, employeeHash] = await Promise.all([
      bcrypt.hash(ownerPassword, 4),
      bcrypt.hash(employeePassword, 4)
    ]);
    const owner = await sql.query(
      `INSERT INTO users (username, email, password, password_hash, company_id, role, first_name, last_name, is_active)
       VALUES ($1,$1,$2,$2,$3,'CLIENT_OWNER','QA','Wlasciciel',TRUE)
       RETURNING id`,
      [ownerEmail, ownerHash, companyId]
    );
    const employee = await sql.query(
      `INSERT INTO users (username, email, password, password_hash, company_id, role, first_name, last_name, is_active)
       VALUES ($1,$1,$2,$2,$3,'CLIENT_EMPLOYEE','QA','Pracownik',TRUE)
       RETURNING id`,
      [employeeEmail, employeeHash, companyId]
    );
    const visibleSite = await sql.query(
      `INSERT INTO objects (company_id, name, address, city, country, is_active, status, created_by)
       VALUES ($1,'QA Obiekt dostepny','Testowa 1','Warszawa','Polska',TRUE,'AKTYWNY',$2)
       RETURNING id`,
      [companyId, adminResult.rows[0].id]
    );
    const hiddenSite = await sql.query(
      `INSERT INTO objects (company_id, name, address, city, country, is_active, status, created_by)
       VALUES ($1,'QA Obiekt niedostepny','Testowa 2','Warszawa','Polska',TRUE,'AKTYWNY',$2)
       RETURNING id`,
      [companyId, adminResult.rows[0].id]
    );
    const hiddenTicket = await sql.query(
      `INSERT INTO tickets (ticket_number, type, subject, description, object_id, customer_id, created_by, status)
       VALUES ($1,'SYSTEM_FAILURE','QA tylko dla przypisanego obiektu','Test zakresu obiektowego',$2,$3,$4,'NEW')
       RETURNING id`,
      [`QA/${suffix}`, hiddenSite.rows[0].id, customer.rows[0].id, owner.rows[0].id]
    );
    await sql.query("COMMIT");
    permissionFixture = {
      companyId,
      ownerId: owner.rows[0].id,
      employeeId: employee.rows[0].id,
      userIds: [owner.rows[0].id, employee.rows[0].id],
      siteIds: [visibleSite.rows[0].id, hiddenSite.rows[0].id],
      visibleSiteId: visibleSite.rows[0].id,
      hiddenSiteId: hiddenSite.rows[0].id,
      ticketIds: [hiddenTicket.rows[0].id],
      hiddenTicketId: hiddenTicket.rows[0].id
    };
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  } finally {
    sql.release();
  }

  const ownerLogin = await request("/auth/login", undefined, {
    method: "POST",
    body: { username: ownerEmail, password: ownerPassword }
  });
  const employeeLogin = await request("/auth/login", undefined, {
    method: "POST",
    body: { username: employeeEmail, password: employeePassword }
  });
  assert.equal(ownerLogin.response.status, 200);
  assert.equal(employeeLogin.response.status, 200);
  const ownerToken = extractTokenCookie(ownerLogin.response);
  const employeeToken = extractTokenCookie(employeeLogin.response);

  const ownerEmployees = await request("/api/client/company/employees", ownerToken);
  assert.equal(ownerEmployees.response.status, 200);
  assert.equal(ownerEmployees.body.some((employee) => employee.id === permissionFixture.employeeId), true);

  const employeeEmployeeList = await request("/api/client/company/employees", employeeToken);
  assert.equal(employeeEmployeeList.response.status, 403);

  const grantTickets = await request(`/users/${permissionFixture.employeeId}/permissions`, ownerToken, {
    method: "PUT",
    body: { permissions: [{ permissionKey: "VIEW_TICKETS", enabled: true }] }
  });
  assert.equal(grantTickets.response.status, 200);
  assert.deepEqual(grantTickets.body, [{ permission_key: "VIEW_TICKETS", enabled: true }]);

  const ticketsAllowed = await request("/api/client/tickets", employeeToken);
  const offersDenied = await request("/api/client/offers", employeeToken);
  assert.equal(ticketsAllowed.response.status, 200);
  assert.deepEqual(ticketsAllowed.body, []);
  assert.equal(offersDenied.response.status, 403);

  const hiddenTicket = await request(`/api/client/tickets/${permissionFixture.hiddenTicketId}`, employeeToken);
  const noAssignedSites = await request("/api/client/company/sites", employeeToken);
  const employeeDashboard = await request("/api/client/dashboard", employeeToken);
  const employeeCompanySummary = await request("/api/client/company/summary", employeeToken);
  const employeeActivity = await request("/api/client/company/activity", employeeToken);
  const employeeLegacyList = await request("/api/client/employees", employeeToken);
  assert.equal(hiddenTicket.response.status, 404);
  assert.deepEqual(noAssignedSites.body, []);
  assert.equal(employeeDashboard.response.status, 200);
  assert.equal(employeeDashboard.body.stats.sitesCount, 0);
  assert.equal(employeeDashboard.body.stats.openTicketsCount, 0);
  assert.deepEqual(employeeDashboard.body.recentTickets, []);
  assert.deepEqual(employeeCompanySummary.body.recentSites, []);
  assert.deepEqual(employeeCompanySummary.body.recentEmployees, []);
  assert.deepEqual(employeeActivity.body, []);
  assert.equal(employeeLegacyList.response.status, 403);

  const assignVisibleSite = await request(`/api/client/company/employees/${permissionFixture.employeeId}/sites`, ownerToken, {
    method: "PUT",
    body: { siteIds: [permissionFixture.visibleSiteId] }
  });
  assert.equal(assignVisibleSite.response.status, 200);
  assert.deepEqual(assignVisibleSite.body.siteIds, [permissionFixture.visibleSiteId]);

  const assignedSites = await request("/api/client/company/sites", employeeToken);
  assert.equal(assignedSites.response.status, 200);
  assert.deepEqual(assignedSites.body.map((site) => site.id), [permissionFixture.visibleSiteId]);

  const employeePermissionChange = await request(`/users/${permissionFixture.employeeId}/permissions`, employeeToken, {
    method: "PUT",
    body: { permissions: [{ permissionKey: "VIEW_OFFERS", enabled: true }] }
  });
  assert.equal(employeePermissionChange.response.status, 403);

  const ownerPermissionChange = await request(`/users/${permissionFixture.ownerId}/permissions`, ownerToken, {
    method: "PUT",
    body: { permissions: [{ permissionKey: "VIEW_OFFERS", enabled: true }] }
  });
  assert.equal(ownerPermissionChange.response.status, 400);

  const privilegedPermission = await request(`/users/${permissionFixture.employeeId}/permissions`, ownerToken, {
    method: "PUT",
    body: { permissions: [{ permissionKey: "MANAGE_EMPLOYEES", enabled: true }] }
  });
  assert.equal(privilegedPermission.response.status, 400);

  const grantOffers = await request(`/users/${permissionFixture.employeeId}/permissions`, ownerToken, {
    method: "PUT",
    body: {
      permissions: [
        { permissionKey: "VIEW_TICKETS", enabled: true },
        { permissionKey: "VIEW_OFFERS", enabled: true },
        { permissionKey: "ACCEPT_OFFERS", enabled: true }
      ]
    }
  });
  assert.equal(grantOffers.response.status, 200);

  const offersAllowed = await request("/api/client/offers", employeeToken);
  assert.equal(offersAllowed.response.status, 200);
  assert.ok(Array.isArray(offersAllowed.body));
});
