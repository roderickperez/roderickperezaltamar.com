const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const dataHandler = require("../api/workbench-data.js");
const aiHandler = require("../api/workbench-ai.js");
const mcpHandler = require("../api/workbench-mcp.js");
const agentHandler = require("../api/workbench-agent.js");

function createMockRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    body: null,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

const SAMPLE_IDEAS = [
  {
    id: "idea-1",
    subject: "Petrel LAS Well-Log Parser",
    customTitle: "Petrel LAS Well-Log Parser",
    domain: "Subsurface & Wells",
    platform: "GitHub / GitLab",
    column: "in_progress",
    date: "2026-11-10T10:00:00Z",
    monthKey: "2026-11",
    primaryUrl: "https://github.com/example/las-parser",
    urls: ["https://github.com/example/las-parser"],
    attachments: [],
    snippet: "Python parser for LAS well logs",
    notes: "Integrate with PyPSA",
    aiTags: ["Python", "Petrel", "LAS"],
    isStarred: true,
    isUntitled: false,
  },
];

const SAMPLE_PROJECTS = [
  {
    id: "proj-1",
    title: "Petrel & LAS Well-Log Pipeline",
    objective: "Parse and clean LAS logs",
    whyItMatters: "Saves petrophysics prep time",
    domain: "Subsurface & Wells",
    mvpScope: "CLI + DuckDB exporter",
    techStack: ["Python", "DuckDB", "LAS"],
    effortTier: "Weekend Prototype",
    checklist: [{ id: "s1", text: "Build parser", completed: true }],
    ideaIds: ["idea-1"],
    priorityScore: 92,
  },
];

test("workbench-data blocks non-owner user with 403", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/auth/v1/user")) {
      return { ok: true, json: async () => ({ id: "student-1" }) };
    }
    if (String(url).includes("/rest/v1/course_owners")) {
      return { ok: true, json: async () => [] };
    }
    throw new Error("Unexpected fetch: " + url);
  };

  try {
    const req = {
      method: "GET",
      headers: { cookie: "__Host-course_session=valid.jwt.student" },
    };
    const res = createMockRes();
    await dataHandler(req, res);
    assert.equal(res.statusCode, 403);
  } finally {
    global.fetch = origFetch;
  }
});

test("workbench-data mints SHA-256 hashed agent token for verified owner and returns plaintext once", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  let storedRow = null;
  const origFetch = global.fetch;
  global.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) {
      return { ok: true, json: async () => ({ id: "owner-1", email: "roderickperezaltamar@gmail.com" }) };
    }
    if (u.includes("/rest/v1/course_owners")) {
      return { ok: true, json: async () => [{ user_id: "owner-1" }] };
    }
    if (u.includes("/rest/v1/workbench_agent_tokens") && init.method === "POST") {
      storedRow = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => [
          {
            id: "11111111-1111-1111-1111-111111111111",
            label: storedRow.label,
            token_prefix: storedRow.token_prefix,
            scopes: storedRow.scopes,
            created_at: "2026-11-25T20:00:00Z",
          },
        ],
      };
    }
    throw new Error("Unexpected fetch: " + u);
  };

  try {
    const req = {
      method: "POST",
      headers: {
        host: "roderickperezaltamar.com",
        origin: "https://roderickperezaltamar.com",
        cookie: "__Host-course_session=valid.jwt.owner",
      },
      body: {
        label: "ChatGPT Custom GPT",
        scopes: ["read:ideas", "read:projects", "read:graph"],
        expiresInDays: 90,
      },
    };
    const res = createMockRes();
    await dataHandler(req, res);
    assert.equal(res.statusCode, 201);
    assert.match(res.body.token, /^rpa_ag_[a-f0-9]{64}$/);
    const expectedHash = crypto.createHash("sha256").update(res.body.token).digest("hex");
    assert.equal(storedRow.token_hash, expectedHash);
    assert.notEqual(storedRow.token_hash, res.body.token);
  } finally {
    global.fetch = origFetch;
  }
});

test("workbench-ai rejects unauthenticated requests with 401", async () => {
  const req = { method: "POST", headers: {}, body: { action: "test" } };
  const res = createMockRes();
  await aiHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test("workbench-mcp enforces Bearer token auth, scopes, and serves MCP tools/call", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  // 1. Missing token -> 401
  const noAuthRes = createMockRes();
  await mcpHandler({ method: "POST", headers: {}, body: { id: 1, method: "tools/list" } }, noAuthRes);
  assert.equal(noAuthRes.statusCode, 401);

  const validToken = "rpa_ag_" + "a".repeat(64);
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/rpc/agent_get_workbench")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          status: 200,
          label: "Gemini Agent",
          scopes: ["read:ideas", "read:projects", "read:graph"],
          ideas: SAMPLE_IDEAS,
          projects: SAMPLE_PROJECTS,
          custom_categories: ["Geothermal & CCS"],
          updated_at: "2026-11-25T20:00:00Z",
        }),
      };
    }
    throw new Error("Unexpected fetch: " + url);
  };

  try {
    // 2. Authorized read:ideas tool call -> 200
    const searchRes = createMockRes();
    await mcpHandler(
      {
        method: "POST",
        headers: { authorization: "Bearer " + validToken },
        body: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "search_ideas", arguments: { query: "Petrel" } },
        },
      },
      searchRes,
    );
    assert.equal(searchRes.statusCode, 200);
    const parsed = JSON.parse(searchRes.body.result.content[0].text);
    assert.equal(parsed.total, 1);
    assert.equal(parsed.ideas[0].title, "Petrel LAS Well-Log Parser");

    // 3. Read-only token attempting write:ideas tool -> 403
    const writeRes = createMockRes();
    await mcpHandler(
      {
        method: "POST",
        headers: { authorization: "Bearer " + validToken },
        body: {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "add_and_classify_idea", arguments: { title: "Unauthorized write" } },
        },
      },
      writeRes,
    );
    assert.equal(writeRes.statusCode, 403);
  } finally {
    global.fetch = origFetch;
  }
});

test("workbench-agent serves OpenAPI 3.1 spec and authorized graph endpoint", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  // 1. OpenAPI schema requires no user data
  const specRes = createMockRes();
  await agentHandler(
    { method: "GET", query: { route: "openapi.json" }, headers: { host: "roderickperezaltamar.com" } },
    specRes,
  );
  assert.equal(specRes.statusCode, 200);
  assert.equal(specRes.body.openapi, "3.1.0");
  assert.ok(specRes.body.paths["/api/workbench-agent/graph"]);

  // 2. Authorized graph query -> 200
  const validToken = "rpa_ag_" + "b".repeat(64);
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/rpc/agent_get_workbench")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          status: 200,
          label: "ChatGPT",
          scopes: ["read:graph"],
          ideas: SAMPLE_IDEAS,
          projects: SAMPLE_PROJECTS,
          custom_categories: [],
        }),
      };
    }
    throw new Error("Unexpected fetch: " + url);
  };

  try {
    const graphRes = createMockRes();
    await agentHandler(
      {
        method: "GET",
        query: { route: "graph", concept: "Python" },
        headers: { authorization: "Bearer " + validToken },
      },
      graphRes,
    );
    assert.equal(graphRes.statusCode, 200);
    assert.ok(graphRes.body.totalConcepts >= 3);
    assert.ok(graphRes.body.concepts.some((c) => c.label === "Python"));
  } finally {
    global.fetch = origFetch;
  }
});
