const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/workbench-asset.js");

function createMockRes() {
  const headers = {};
  const res = {
    statusCode: 200,
    headers,
    body: null,
    redirectUrl: null,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
    redirect(code, url) {
      this.statusCode = code;
      this.redirectUrl = url;
      return this;
    },
  };
  return res;
}

test("workbench-asset blocks direct access to private-workbench-dist", async () => {
  const req = { method: "GET", query: { deny: "1" }, headers: {} };
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 403);
});

test("workbench-asset rejects unauthenticated asset requests with 401 and redirects HTML", async () => {
  const jsReq = { method: "GET", query: { path: "assets/app.js" }, headers: {} };
  const jsRes = createMockRes();
  await handler(jsReq, jsRes);
  assert.equal(jsRes.statusCode, 401);

  const htmlReq = { method: "GET", query: { path: "index.html" }, headers: {} };
  const htmlRes = createMockRes();
  await handler(htmlReq, htmlRes);
  assert.equal(htmlRes.statusCode, 302);
  assert.equal(htmlRes.redirectUrl, "/?workbench=signin");
});

test("workbench-asset rejects authenticated non-owner user with 403", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/auth/v1/user")) {
      return { ok: true, json: async () => ({ id: "student-uuid-999" }) };
    }
    if (String(url).includes("/rest/v1/course_owners")) {
      return { ok: true, json: async () => [] };
    }
    throw new Error("Unexpected fetch: " + url);
  };

  try {
    const req = {
      method: "GET",
      query: { path: "index.html" },
      headers: { cookie: "__Host-course_session=valid.jwt.token" },
    };
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
    assert.match(String(res.body), /strictly private to the site owner/i);
  } finally {
    global.fetch = origFetch;
  }
});

test("workbench-asset blocks path traversal attempts", async () => {
  const req = {
    method: "GET",
    query: { path: "../api/config.js" },
    headers: { cookie: "__Host-course_session=valid.jwt.token" },
  };
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test("workbench-asset serves built RPA! Workbench HTML ONLY to verified course_owners", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/auth/v1/user")) {
      return { ok: true, json: async () => ({ id: "owner-uuid-roderick" }) };
    }
    if (String(url).includes("/rest/v1/course_owners")) {
      return { ok: true, json: async () => [{ user_id: "owner-uuid-roderick" }] };
    }
    throw new Error("Unexpected fetch: " + url);
  };

  try {
    const req = {
      method: "GET",
      query: { path: "index.html" },
      headers: { cookie: "__Host-course_session=valid.owner.jwt" },
    };
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(String(res.headers["cache-control"]).startsWith("private, no-store"));
    assert.ok(String(res.headers["x-robots-tag"]).startsWith("noindex, nofollow"));
    assert.match(res.body.toString("utf8"), /RPA! Workbench/);
    assert.match(res.body.toString("utf8"), /\/private-workbench\/assets\//);
  } finally {
    global.fetch = origFetch;
  }
});
