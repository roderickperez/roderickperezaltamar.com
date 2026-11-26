const test = require("node:test");
const assert = require("node:assert/strict");
const mcpHandler = require("../api/workbench-mcp");
const agentHandler = require("../api/workbench-agent");
const { hybridRankIdeas, buildContextPack, buildCalendarDeadlinesFeed } = require("../api/_workbench-lib");

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
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
  };
  return res;
}

test("hybridRankIdeas prioritizes exact phrase, domain/label match, and access-weighted retention", () => {
  const now = new Date().toISOString();
  const ideas = [
    {
      id: "old_unused",
      subject: "Random seismic note",
      date: "2024-01-01T00:00:00Z",
      domain: "Uncategorized",
      snippet: "mentions petrel once",
      accessCount: 0,
      dailyRankScore: 20,
    },
    {
      id: "fresh_used",
      subject: "Petrel LAS Well-Log Extractor",
      date: now,
      domain: "TiefWerk / Extract",
      gmailLabels: ["TiefWerk / Extract"],
      snippet: "Extract Petrel grids and LAS logs cleanly",
      accessCount: 5,
      dailyRankScore: 88,
    },
  ];
  const ranked = hybridRankIdeas(ideas, "petrel extract", 10);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].id, "fresh_used");
});

test("buildContextPack compiles profile, confirmed rules, open handoffs, and wiki summaries", () => {
  const pack = buildContextPack({
    query: "petrel",
    projectSlug: "tiefwerk-extract",
    ideas: [
      { id: "i1", subject: "Petrel Extractor", domain: "TiefWerk / Extract", date: "2026-11-25T10:00:00Z", isSelfSent: true },
      { id: "i2", subject: "External spam", domain: "TiefWerk / Extract", date: "2026-11-25T10:00:00Z", isSelfSent: false },
    ],
    projects: [{ id: "p1", title: "TiefWerk / Extract", domain: "TiefWerk / Extract", effortTier: "Weekend Prototype", priorityScore: 90, ideaIds: ["i1"] }],
    rules: [
      { id: "r1", kind: "profile", title: "Owner Scope", rule_text: "Mine only", status: "confirmed", human_locked: true },
      { id: "r2", kind: "routing_rule", title: "Petrel rule", rule_text: "Route Petrel to Extract", status: "confirmed", confidence: 0.92 },
      { id: "r3", kind: "routing_rule", title: "Retired rule", rule_text: "Ignore", status: "retired" },
    ],
    wikiPages: [
      { slug: "tiefwerk-extract", title: "TiefWerk / Extract", domain: "TiefWerk / Extract", compiled_truth_md: "## TiefWerk / Extract\nPetrel parser", last_verified_at: "2026-11-26T00:00:00Z" },
    ],
    handoffs: [
      { id: "h1", project_slug: "tiefwerk-extract", status: "open", title: "Finish LAS parser", next_step: "Run pytest" },
      { id: "h2", project_slug: "tiefwerk-extract", status: "claimed", title: "Already claimed", next_step: "Done" },
    ],
  });

  assert.equal(pack.profile.length, 1);
  assert.equal(pack.confirmedRules.length, 1);
  assert.equal(pack.openHandoffs.length, 1);
  assert.equal(pack.openHandoffs[0].id, "h1");
  assert.equal(pack.wikiPages.length, 1);
  // External sender email excluded from topIdeas
  assert.equal(pack.topIdeas.length, 1);
  assert.equal(pack.topIdeas[0].id, "i1");
});

test("MCP serves 11 tools including context_pack, create_handoff, claim_handoff, remember_rule, and wiki", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  const token = "rpa_ag_" + "a".repeat(64);
  let handoffClaimed = false;
  const origFetch = global.fetch;

  global.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/rpc/agent_get_workbench")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: 200,
          label: "Codex CLI",
          scopes: ["read:ideas", "read:projects", "read:graph", "write:ideas", "write:memory", "write:handoffs"],
          ideas: [{ id: "i1", subject: "Petrel LAS", domain: "TiefWerk / Extract", date: "2026-11-25T10:00:00Z", isSelfSent: true }],
          projects: [],
          custom_categories: [],
        }),
      };
    }
    if (u.endsWith("/rpc/agent_get_second_brain")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: 200,
          rules: [{ id: "r1", kind: "profile", title: "Portfolio", rule_text: "TiefWerk + OMV", status: "confirmed", human_locked: true }],
          wiki_pages: [{ slug: "tiefwerk-extract", title: "TiefWerk / Extract", domain: "TiefWerk / Extract", compiled_truth_md: "Verified Petrel notes" }],
          handoffs: [{ id: "ho_1", project_slug: "tiefwerk-extract", status: "open", title: "Next step", next_step: "Build parser" }],
        }),
      };
    }
    if (u.endsWith("/rpc/agent_claim_handoff")) {
      if (handoffClaimed) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: false, status: 409, error: "Handoff already claimed" }),
        };
      }
      handoffClaimed = true;
      const body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, status: 200, handoff: { id: body.p_handoff_id, status: "claimed", claimed_by: body.p_claimer } }),
      };
    }
    if (u.endsWith("/rpc/agent_remember_rule")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, status: 200, id: "rule_123" }) };
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  };

  try {
    // 1. tools/list reports all 11 tools
    const listRes = createMockRes();
    await mcpHandler(
      { method: "POST", headers: { authorization: `Bearer ${token}` }, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } },
      listRes,
    );
    assert.equal(listRes.statusCode, 200);
    const toolNames = listRes.body.result.tools.map((t) => t.name);
    for (const expected of ["context_pack", "create_handoff", "claim_handoff", "remember_rule", "get_wiki_page", "upsert_wiki_page"]) {
      assert.ok(toolNames.includes(expected), `Missing MCP tool ${expected}`);
    }

    // 2. context_pack returns unified brief
    const cpRes = createMockRes();
    await mcpHandler(
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "context_pack", arguments: { project_slug: "tiefwerk-extract" } } },
      },
      cpRes,
    );
    const pack = JSON.parse(cpRes.body.result.content[0].text);
    assert.equal(pack.openHandoffs.length, 1);
    assert.equal(pack.wikiPages.length, 1);

    // 3. claim_handoff succeeds once and rejects second claim with conflict error
    const claim1 = createMockRes();
    await mcpHandler(
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "claim_handoff", arguments: { handoff_id: "ho_1", claimer: "codex" } } },
      },
      claim1,
    );
    assert.ok(claim1.body.result);

    const claim2 = createMockRes();
    await mcpHandler(
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "claim_handoff", arguments: { handoff_id: "ho_1", claimer: "claude-code" } } },
      },
      claim2,
    );
    assert.ok(claim2.body.error);
    assert.equal(claim2.body.error.code, -32009);

    // 4. OpenAPI spec exposes /context-pack, /handoffs, /todos, /todos/rank, and /calendar routes
    const specRes = createMockRes();
    await agentHandler({ method: "GET", headers: { host: "www.roderickperezaltamar.com" }, query: { route: "openapi.json" } }, specRes);
    assert.equal(specRes.statusCode, 200);
    assert.ok(specRes.body.paths["/api/workbench-agent/context-pack"]);
    assert.ok(specRes.body.paths["/api/workbench-agent/handoffs"]);
    assert.ok(specRes.body.paths["/api/workbench-agent/todos"]);
    assert.ok(specRes.body.paths["/api/workbench-agent/todos/rank"]);
    assert.ok(specRes.body.paths["/api/workbench-agent/calendar"]);
  } finally {
    global.fetch = origFetch;
  }
});

test("buildCalendarDeadlinesFeed merges To-Dos, Projects, and self-sent Ideas while excluding external emails", () => {
  const feed = buildCalendarDeadlinesFeed({
    todos: [
      { id: "t1", title: "Submit EAGE abstract", domain: "Conferences", dueDate: "2026-12-01", priority: "high", status: "open", rankScore: 95 },
      { id: "t2", title: "Undated idea note", domain: "TiefWerk", status: "open" },
    ],
    projects: [
      { id: "p1", title: "TiefWerk Extract v1", domain: "TiefWerk / Extract", dueDate: "2026-12-05", priorityScore: 88 },
    ],
    ideas: [
      { id: "i1", subject: "OMV review deadline", domain: "OMV", dueDate: "2026-11-30", column: "in_progress", isStarred: true, isSelfSent: true },
      { id: "i2", subject: "External promo deadline", domain: "Uncategorized", dueDate: "2026-11-29", isSelfSent: false },
    ],
  });

  assert.equal(feed.length, 3);
  assert.deepEqual(
    feed.map((e) => e.id),
    ["idea:i1", "todo:t1", "project:p1"],
  );
  assert.equal(feed[0].status, "in_progress");
  assert.equal(feed[1].kind, "todo");
  assert.equal(feed[2].priority, "high");
});

test("MCP serves 15 tools and supports list_todos, upsert_todo, rank_todos, and get_calendar_deadlines", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

  const token = "rpa_ag_" + "b".repeat(64);
  let storedTodos = [
    { id: "todo_1", title: "Draft TiefWerk Kosmos spec", domain: "TiefWerk / Kosmos", dueDate: "2026-12-02", priority: "high", status: "open", rankScore: 70 },
  ];
  const origFetch = global.fetch;

  global.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/rpc/agent_get_workbench")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: 200,
          label: "ChatGPT Custom GPT",
          scopes: ["read:ideas", "read:projects", "read:graph", "write:ideas"],
          ideas: [{ id: "i1", subject: "Thesis defense prep", domain: "Thesis", dueDate: "2026-12-10", isSelfSent: true }],
          projects: [{ id: "p1", title: "HandSchrift OCR", domain: "HandSchrift", dueDate: "2026-12-15", priorityScore: 80 }],
          todos: storedTodos,
          custom_categories: [],
        }),
      };
    }
    if (u.endsWith("/rpc/agent_save_todos")) {
      const body = JSON.parse(init.body);
      storedTodos = body.p_todos;
      return { ok: true, status: 200, json: async () => ({ ok: true, status: 200, count: storedTodos.length }) };
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  };

  try {
    // 1. Verify all 15 tools exist
    const listRes = createMockRes();
    await mcpHandler(
      { method: "POST", headers: { authorization: `Bearer ${token}` }, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } },
      listRes,
    );
    const toolNames = listRes.body.result.tools.map((t) => t.name);
    assert.equal(toolNames.length, 15);
    for (const expected of ["list_todos", "upsert_todo", "rank_todos", "get_calendar_deadlines"]) {
      assert.ok(toolNames.includes(expected), `Missing MCP tool ${expected}`);
    }

    // 2. upsert_todo creates an AI suggestion
    const upsertRes = createMockRes();
    await mcpHandler(
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "upsert_todo",
            arguments: {
              title: "Review DominoLab prototype",
              domain: "DominoLab",
              due_date: "2026-12-03",
              priority: "high",
              rank_score: 92,
              is_suggestion: true,
            },
          },
        },
      },
      upsertRes,
    );
    const upserted = JSON.parse(upsertRes.body.result.content[0].text);
    assert.equal(upserted.saved, true);
    assert.equal(upserted.todo.agentName, "ChatGPT Custom GPT");
    assert.equal(upserted.todo.isSuggestion, true);
    assert.equal(storedTodos.length, 2);

    // 3. rank_todos updates scores & due dates
    const rankRes = createMockRes();
    await mcpHandler(
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "rank_todos",
            arguments: {
              rankings: [{ id: "todo_1", rank_score: 98, ai_reason: "Blocking release", due_date: "2026-11-28" }],
            },
          },
        },
      },
      rankRes,
    );
    const rankBody = JSON.parse(rankRes.body.result.content[0].text);
    assert.equal(rankBody.updatedCount, 1);
    assert.equal(storedTodos.find((t) => t.id === "todo_1").rankScore, 98);

    // 4. get_calendar_deadlines merges todos + projects + ideas
    const calRes = createMockRes();
    await mcpHandler(
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_calendar_deadlines", arguments: {} } },
      },
      calRes,
    );
    const calBody = JSON.parse(calRes.body.result.content[0].text);
    assert.equal(calBody.total, 4);
    assert.equal(calBody.deadlines[0].date, "2026-11-28");
  } finally {
    global.fetch = origFetch;
  }
});
