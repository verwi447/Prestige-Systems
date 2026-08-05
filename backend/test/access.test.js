import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRole,
  requireClient,
  requireCompanyAccess,
  requireAnyPermission,
  requirePermission,
  requireRole
} from "../src/middleware/access.js";
import { db } from "../src/db.js";

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function runMiddleware(middleware, req) {
  const res = createResponse();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

async function runAsyncMiddleware(middleware, req) {
  const res = createResponse();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

test("normalizeRole maps the legacy USER role", () => {
  assert.equal(normalizeRole("USER"), "CLIENT_EMPLOYEE");
  assert.equal(normalizeRole("ADMIN"), "ADMIN");
});

test("requireRole allows only configured roles", () => {
  const allowed = runMiddleware(requireRole("ADMIN"), { currentUser: { role: "ADMIN" } });
  const denied = runMiddleware(requireRole("ADMIN"), { currentUser: { role: "CLIENT_OWNER" } });

  assert.equal(allowed.nextCalled, true);
  assert.equal(denied.nextCalled, false);
  assert.equal(denied.res.statusCode, 403);
});

test("only an administrator or client owner can manage employee permissions", () => {
  const middleware = requireRole("ADMIN", "CLIENT_OWNER");
  const owner = runMiddleware(middleware, { currentUser: { role: "CLIENT_OWNER" } });
  const employee = runMiddleware(middleware, { currentUser: { role: "CLIENT_EMPLOYEE" } });

  assert.equal(owner.nextCalled, true);
  assert.equal(employee.nextCalled, false);
  assert.equal(employee.res.statusCode, 403);
});

test("client owner has effective permissions without a database grant", async () => {
  const result = await runAsyncMiddleware(requirePermission("VIEW_OFFERS"), {
    currentUser: { id: 7, role: "CLIENT_OWNER" }
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.res.statusCode, 200);
});

test("client employee needs an explicitly enabled permission", async (t) => {
  const originalQuery = db.query;
  t.after(() => {
    db.query = originalQuery;
  });

  db.query = async (...args) => {
    const permissions = args[1][1];
    return { rows: permissions.includes("VIEW_TICKETS") ? [{ permission_key: "VIEW_TICKETS" }] : [] };
  };

  const allowed = await runAsyncMiddleware(requirePermission("VIEW_TICKETS"), {
    currentUser: { id: 8, role: "CLIENT_EMPLOYEE" }
  });
  const denied = await runAsyncMiddleware(requirePermission("VIEW_OFFERS"), {
    currentUser: { id: 8, role: "CLIENT_EMPLOYEE" }
  });

  assert.equal(allowed.nextCalled, true);
  assert.equal(denied.nextCalled, false);
  assert.equal(denied.res.statusCode, 403);
});

test("attachment access accepts either ticket creation or commenting permission", async (t) => {
  const originalQuery = db.query;
  t.after(() => {
    db.query = originalQuery;
  });

  db.query = async () => ({ rows: [{ permission_key: "COMMENT_TICKET" }] });
  const result = await runAsyncMiddleware(requireAnyPermission("CREATE_TICKET", "COMMENT_TICKET"), {
    currentUser: { id: 9, role: "CLIENT_EMPLOYEE" }
  });

  assert.equal(result.nextCalled, true);
});

test("requireClient requires a client role and company", () => {
  const allowed = runMiddleware(requireClient, {
    currentUser: { role: "CLIENT_OWNER", company_id: 7 }
  });
  const missingCompany = runMiddleware(requireClient, {
    currentUser: { role: "CLIENT_EMPLOYEE", company_id: null }
  });

  assert.equal(allowed.nextCalled, true);
  assert.equal(missingCompany.nextCalled, false);
  assert.equal(missingCompany.res.statusCode, 403);
});

test("requireCompanyAccess isolates clients by company", () => {
  const middleware = requireCompanyAccess();
  const matching = runMiddleware(middleware, {
    currentUser: { role: "CLIENT_OWNER", company_id: 7 },
    params: { companyId: "7" },
    body: {},
    query: {}
  });
  const otherCompany = runMiddleware(middleware, {
    currentUser: { role: "CLIENT_OWNER", company_id: 7 },
    params: { companyId: "8" },
    body: {},
    query: {}
  });

  assert.equal(matching.nextCalled, true);
  assert.equal(otherCompany.nextCalled, false);
  assert.equal(otherCompany.res.statusCode, 403);
});

test("requireCompanyAccess lets administrators cross company boundaries", () => {
  const result = runMiddleware(requireCompanyAccess(), {
    currentUser: { role: "ADMIN", company_id: null },
    params: { companyId: "999" },
    body: {},
    query: {}
  });

  assert.equal(result.nextCalled, true);
});
