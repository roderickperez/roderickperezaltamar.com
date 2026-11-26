const test = require("node:test");
const assert = require("node:assert/strict");
const assetHandler = require("../api/workbench-asset");
const dataHandler = require("../api/workbench-data");
const mcpHandler = require("../api/workbench-mcp");
const {
  isSameOriginMutation,
  redactSecretsInText,
  resetSecurityBuckets,
  sanitizeIdeaForAgent,
} = require("../api/_workbench-lib");

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    redirectTo: null,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
    redirect(code, target) {
      this.statusCode = code;
      this.redirectTo = target;
      return this;
    },
    end() {
      return this;
    },
  };
}

test("applySecurityHeaders emits strict HSTS, CSP, Frame-Deny, Referrer, and Permissions headers", async () => {
  const res = createMockRes();
  await assetHandler(
    { method: "GET", query: { path: "index.html" }, headers: {} },
    res,
  );
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["referrer-policy"], "no-referrer");
  assert.ok(String(res.headers["strict-transport-security"]).includes("max-age=63072000"));
  assert.ok(String(res.headers["content-security-policy"]).includes("frame-ancestors 'none'"));
  assert.ok(String(res.headers["content-security-policy"]).includes("object-src 'none'"));
  assert.ok(String(res.headers["permissions-policy"]).includes("camera=()"));
});

test("redactSecretsInText and sanitizeIdeaForAgent scrub accidental tokens and API keys", () => {
  const dirty =
    "Key AIzaSyB1234567890abcdefghijklmno and token rpa_ag_" +
    "a".repeat(64) +
    " plus sk-proj-1234567890abcdefghijklmnop and ghp_1234567890abcdefghijklmnop";
  const cleaned = redactSecretsInText(dirty);
  assert.ok(!cleaned.includes("AIzaSy"));
  assert.ok(!cleaned.includes("rpa_ag_"));
  assert.ok(!cleaned.includes("sk-proj-"));
  assert.ok(!cleaned.includes("ghp_"));

  const sanitized = sanitizeIdeaForAgent({
    id: "t1",
    subject: "Notes",
    notes: "Secret " + "rpa_ag_" + "f".repeat(64),
    aiSummary: "Uses AIzaSyD0987654321abcdefghijklmno",
    bodyText: "RAW BODY MUST NEVER LEAK",
  });
  assert.equal("bodyText" in sanitized, false);
  assert.ok(sanitized.notes.includes("[REDACTED_WORKBENCH_TOKEN]"));
  assert.ok(sanitized.summary.includes("[REDACTED_GOOGLE_KEY]"));
});

test("isSameOriginMutation blocks cross-site Sec-Fetch-Site and mismatched origins", () => {
  assert.equal(
    isSameOriginMutation({
      headers: {
        origin: "https://www.roderickperezaltamar.com",
        host: "www.roderickperezaltamar.com",
        "sec-fetch-site": "cross-site",
      },
    }),
    false,
  );
  assert.equal(
    isSameOriginMutation({
      headers: {
        origin: "https://evil.example.com",
        host: "www.roderickperezaltamar.com",
        "sec-fetch-site": "same-origin",
      },
    }),
    false,
  );
  assert.equal(
    isSameOriginMutation({
      headers: {
        origin: "https://www.roderickperezaltamar.com",
        host: "www.roderickperezaltamar.com",
        "sec-fetch-site": "same-origin",
      },
    }),
    true,
  );
});

test("owner email allowlist blocks non-owner email even if course_owners check were reached", async () => {
  resetSecurityBuckets();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).endsWith("/auth/v1/user")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "uuid-intruder", email: "intruder@evil.com" }),
      };
    }
    throw new Error(`Should have blocked before calling ${url}`);
  };

  try {
    const res = createMockRes();
    await dataHandler(
      {
        method: "GET",
        headers: { cookie: "__Host-course_session=valid.jwt.token" },
        query: {},
      },
      res,
    );
    assert.equal(res.statusCode, 403);
    assert.ok(String(res.body.error).toLowerCase().includes("not authorized"));
  } finally {
    global.fetch = origFetch;
  }
});

test("brute-force protection locks IP with 429 after 8 failed MCP Bearer auth attempts", async () => {
  resetSecurityBuckets();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  const fakeIp = "203.0.113.99";
  for (let i = 0; i < 8; i += 1) {
    const res = createMockRes();
    await mcpHandler(
      {
        method: "POST",
        headers: { "x-forwarded-for": fakeIp, authorization: "Bearer bad_token" },
        body: { jsonrpc: "2.0", id: i, method: "tools/list" },
      },
      res,
    );
    assert.equal(res.statusCode, 401);
  }

  // 9th attempt is locked out with 429
  const lockedRes = createMockRes();
  await mcpHandler(
    {
      method: "POST",
      headers: { "x-forwarded-for": fakeIp, authorization: "Bearer bad_token" },
      body: { jsonrpc: "2.0", id: 99, method: "tools/list" },
    },
    lockedRes,
  );
  assert.equal(lockedRes.statusCode, 429);
  resetSecurityBuckets();
});

test("emergency kill switch DELETE /api/workbench-data?revokeAll=1 revokes all active agent tokens", async () => {
  resetSecurityBuckets();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  const origFetch = global.fetch;
  let patchedRevokeAll = false;
  global.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "uuid-roderick", email: "roderickperezaltamar@gmail.com" }),
      };
    }
    if (u.includes("/rest/v1/course_owners")) {
      return { ok: true, status: 200, json: async () => [{ user_id: "uuid-roderick" }] };
    }
    if (u.includes("/rest/v1/workbench_agent_tokens") && init.method === "PATCH") {
      patchedRevokeAll = u.includes("revoked_at=is.null");
      return { ok: true, status: 204, json: async () => ({}) };
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  };

  try {
    const res = createMockRes();
    await dataHandler(
      {
        method: "DELETE",
        query: { revokeAll: "1" },
        headers: {
          cookie: "__Host-course_session=valid.jwt.token",
          origin: "https://www.roderickperezaltamar.com",
          host: "www.roderickperezaltamar.com",
        },
      },
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.revokedAll, true);
    assert.equal(patchedRevokeAll, true);
  } finally {
    global.fetch = origFetch;
  }
});
