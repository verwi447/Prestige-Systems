import assert from "node:assert/strict";
import test from "node:test";
import { containsUnsafeValue, requestGuard } from "../src/middleware/security.js";

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

test("containsUnsafeValue accepts normal request data", () => {
  assert.equal(containsUnsafeValue({ title: "Awaria czytnika", tags: ["pilne", "serwis"] }), false);
});

test("containsUnsafeValue rejects prototype keys and null bytes", () => {
  assert.equal(containsUnsafeValue(JSON.parse('{"__proto__":{"admin":true}}')), true);
  assert.equal(containsUnsafeValue({ nested: { constructor: "override" } }), true);
  assert.equal(containsUnsafeValue({ value: "tekst\0ukryty" }), true);
});

test("requestGuard rejects unsafe payload before the route handler", () => {
  const req = { body: { prototype: "unsafe" }, query: {}, params: {} };
  const res = createResponse();
  let nextCalled = false;

  requestGuard(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Nieprawidłowe dane żądania." });
});

test("requestGuard passes a valid request", () => {
  const req = { body: { title: "Test" }, query: { page: "1" }, params: { id: "12" } };
  const res = createResponse();
  let nextCalled = false;

  requestGuard(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});
