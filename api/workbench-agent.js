const {
  appendIdeaWithAgentToken,
  applySecurityHeaders,
  buildCalendarDeadlinesFeed,
  buildContextPack,
  buildKnowledgeGraphSummary,
  claimHandoffWithAgentToken,
  classifyIdeaWithServerDecisionModel,
  createHandoffWithAgentToken,
  hybridRankIdeas,
  loadSecondBrainWithAgentToken,
  rememberRuleWithAgentToken,
  sanitizeIdeaForAgent,
  saveTodosWithAgentToken,
  verifyAgentTokenAndLoad,
} = require("./_workbench-lib");

function buildOpenApiSpec(host) {
  const serverUrl = host ? `https://${host}` : "https://roderickperezaltamar.com";
  return {
    openapi: "3.1.0",
    info: {
      title: "RPA! Workbench Private Agent API",
      version: "1.0.0",
      description:
        "Authorized read/write API for querying Roderick Perez Altamar's private ideas, projects, and 3D knowledge graph (for ChatGPT Custom GPT Actions, Gemini Extensions, and custom agents).",
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Scoped agent token minted in RPA! Workbench Settings -> Agent Access (rpa_ag_...).",
        },
      },
    },
    security: [{ BearerAuth: [] }],
    paths: {
      "/api/workbench-agent/summary": {
        get: {
          operationId: "getWorkbenchSummary",
          summary: "Get KPI backlog snapshot and top domains",
          responses: { "200": { description: "Backlog summary JSON" } },
        },
      },
      "/api/workbench-agent/ideas": {
        get: {
          operationId: "searchWorkbenchIdeas",
          summary: "Search curated ideas, papers, repos, and notes",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: "Keyword filter" },
            { name: "domain", in: "query", schema: { type: "string" }, description: "Category/domain filter" },
            { name: "platform", in: "query", schema: { type: "string" } },
            { name: "stage", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
          ],
          responses: { "200": { description: "Matching ideas" } },
        },
        post: {
          operationId: "addAndClassifyIdea",
          summary: "Add a new idea and classify with Google Decision Model (requires write:ideas scope)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    title: { type: "string" },
                    url: { type: "string" },
                    notes: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created & classified idea" } },
        },
      },
      "/api/workbench-agent/projects": {
        get: {
          operationId: "listWorkbenchProjects",
          summary: "List synthesized projects with MVP scope, tech stack, and checklists",
          parameters: [
            { name: "domain", in: "query", schema: { type: "string" } },
            { name: "effort", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "Projects list" } },
        },
      },
      "/api/workbench-agent/graph": {
        get: {
          operationId: "queryKnowledgeGraph",
          summary: "Query extracted concepts, cross-domain bridges, and concept co-occurrence connections",
          parameters: [
            { name: "concept", in: "query", schema: { type: "string" } },
            { name: "domain", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "Knowledge graph connections" } },
        },
      },
      "/api/workbench-agent/context-pack": {
        get: {
          operationId: "getAgentContextPack",
          summary: "One-call starter brief: profile, confirmed rules, open cross-agent handoffs, wiki summaries, and top priority emails",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "project", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "Unified context pack JSON" } },
        },
      },
      "/api/workbench-agent/handoffs": {
        post: {
          operationId: "createAgentHandoff",
          summary: "Create a typed cross-agent handoff card for another AI tool",
          responses: { "201": { description: "Handoff created" } },
        },
      },
      "/api/workbench-agent/handoffs/claim": {
        post: {
          operationId: "claimAgentHandoff",
          summary: "Atomically claim an open handoff once",
          responses: { "200": { description: "Handoff claimed" } },
        },
      },
      "/api/workbench-agent/rules": {
        post: {
          operationId: "rememberRule",
          summary: "Save a working preference or routing rule (respects human-locked rules)",
          responses: { "200": { description: "Rule saved" } },
        },
      },
      "/api/workbench-agent/todos": {
        get: {
          operationId: "listTodos",
          summary: "List Roderick's right-side To-Do list sorted by priority rank & due date",
          responses: { "200": { description: "To-Do list JSON" } },
        },
        post: {
          operationId: "upsertTodo",
          summary: "Add, edit, or suggest a To-Do item (syncs with Calendar when due_date is set)",
          responses: { "200": { description: "Saved To-Do item" } },
        },
      },
      "/api/workbench-agent/todos/rank": {
        post: {
          operationId: "rankTodos",
          summary: "Batch re-rank To-Do items with priority scores (1-100) and reasons",
          responses: { "200": { description: "Updated rankings count" } },
        },
      },
      "/api/workbench-agent/calendar": {
        get: {
          operationId: "getCalendarDeadlines",
          summary: "List upcoming deadlines across To-Dos, Projects, and Emails",
          responses: { "200": { description: "Calendar deadlines feed" } },
        },
      },
    },
  };
}

module.exports = async function (req, res) {
  applySecurityHeaders(res);

  const route = String((req.query && req.query.route) || "").replace(/^\/+|\/+$/g, "");

  // Publicly importable OpenAPI 3.1 schema (contains zero user data!)
  if (req.method === "GET" && (route === "openapi.json" || route === "")) {
    return res.status(200).json(buildOpenApiSpec(req.headers && req.headers.host));
  }

  const requiredScope =
    route === "projects"
      ? "read:projects"
      : route === "graph"
        ? "read:graph"
        : (route === "ideas" ||
            route === "handoffs" ||
            route === "handoffs/claim" ||
            route === "rules" ||
            route === "todos" ||
            route === "todos/rank") &&
            req.method === "POST"
          ? "write:ideas"
          : "read:ideas";

  const auth = await verifyAgentTokenAndLoad(req, requiredScope);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  try {
    if (req.method === "GET" && route === "summary") {
      const total = auth.ideas.length;
      const processed = auth.ideas.filter((i) => i.column === "processed_archived").length;
      return res.status(200).json({
        totalIdeas: total,
        inboxBacklog: auth.ideas.filter((i) => i.column === "inbox_backlog").length,
        readyToDeepDive: auth.ideas.filter((i) => i.column === "to_deep_dive").length,
        inProgress: auth.ideas.filter((i) => i.column === "in_progress").length,
        processed,
        processedRatePct: total > 0 ? Math.round((processed / total) * 100) : 0,
        totalProjects: auth.projects.length,
        customCategories: auth.customCategories,
        updatedAt: auth.updatedAt,
      });
    }

    if (req.method === "GET" && route === "context-pack") {
      const brain = await loadSecondBrainWithAgentToken(auth.tokenHash, "read:ideas");
      const pack = buildContextPack({
        query: req.query.q ? String(req.query.q) : "",
        projectSlug: req.query.project ? String(req.query.project) : "",
        ideas: auth.ideas,
        projects: auth.projects,
        todos: auth.todos || [],
        rules: brain.rules,
        wikiPages: brain.wikiPages,
        handoffs: brain.handoffs,
      });
      return res.status(200).json(pack);
    }

    if (req.method === "GET" && route === "ideas") {
      const q = req.query.q ? String(req.query.q) : "";
      const domain = req.query.domain ? String(req.query.domain).toLowerCase() : "";
      const platform = req.query.platform ? String(req.query.platform).toLowerCase() : "";
      const stage = req.query.stage ? String(req.query.stage) : "";
      const limit = Math.max(1, Math.min(60, Number(req.query.limit || 25)));

      const prefiltered = auth.ideas.filter((item) => {
        if (item.isSelfSent === false) return false;
        if (domain && String(item.domain || "").toLowerCase() !== domain) return false;
        if (platform && String(item.platform || "").toLowerCase() !== platform) return false;
        if (stage && item.column !== stage) return false;
        return true;
      });
      const matches = hybridRankIdeas(prefiltered, q, limit).map(sanitizeIdeaForAgent);

      return res.status(200).json({ total: matches.length, ideas: matches });
    }

    if (req.method === "POST" && route === "handoffs") {
      const body = req.body || {};
      const title = String(body.title || "").trim();
      const summary = String(body.summary || "").trim();
      const nextStep = String(body.next_step || body.nextStep || "").trim();
      if (!title || !summary || !nextStep) {
        return res.status(400).json({ error: "title, summary, and next_step are required" });
      }
      const created = await createHandoffWithAgentToken(auth.tokenHash, {
        project_slug: String(body.project_slug || body.projectSlug || "general"),
        title,
        from_agent: String(body.from_agent || auth.label || "agent"),
        summary,
        what_worked: Array.isArray(body.what_worked) ? body.what_worked : [],
        what_failed: Array.isArray(body.what_failed) ? body.what_failed : [],
        open_questions: Array.isArray(body.open_questions) ? body.open_questions : [],
        relevant_files: Array.isArray(body.relevant_files) ? body.relevant_files : [],
        next_step: nextStep,
      });
      return res.status(created && created.ok ? 201 : (created && created.status) || 502).json(created);
    }

    if (req.method === "POST" && route === "handoffs/claim") {
      const body = req.body || {};
      const handoffId = String(body.handoff_id || body.handoffId || "").trim();
      if (!handoffId) return res.status(400).json({ error: "handoff_id is required" });
      const claimed = await claimHandoffWithAgentToken(auth.tokenHash, handoffId, body.claimer || auth.label);
      return res.status(claimed && claimed.ok ? 200 : (claimed && claimed.status) || 409).json(claimed);
    }

    if (req.method === "POST" && route === "rules") {
      const body = req.body || {};
      const title = String(body.title || "").trim();
      const ruleText = String(body.rule_text || body.ruleText || "").trim();
      if (!title || !ruleText) return res.status(400).json({ error: "title and rule_text are required" });
      const saved = await rememberRuleWithAgentToken(auth.tokenHash, {
        title,
        rule_text: ruleText,
        kind: body.kind || "preference",
        pattern: body.pattern || null,
        target_domain: body.target_domain || body.targetDomain || null,
        agent_name: auth.label,
      });
      return res.status(saved && saved.ok ? 200 : (saved && saved.status) || 409).json(saved);
    }

    if (req.method === "GET" && route === "todos") {
      const status = req.query.status ? String(req.query.status) : "";
      const domain = req.query.domain ? String(req.query.domain).toLowerCase() : "";
      const todos = (auth.todos || [])
        .filter((t) => (!status || t.status === status) && (!domain || String(t.domain || "").toLowerCase() === domain))
        .sort((a, b) => (Number(b.rankScore) || 50) - (Number(a.rankScore) || 50));
      return res.status(200).json({ total: todos.length, todos });
    }

    if (req.method === "POST" && route === "todos") {
      const body = req.body || {};
      const title = String(body.title || "").trim();
      if (!title) return res.status(400).json({ error: "title is required" });
      const nowIso = new Date().toISOString();
      const list = Array.isArray(auth.todos) ? [...auth.todos] : [];
      const targetId = body.id ? String(body.id).trim() : `todo_ag_${Date.now()}`;
      const idx = list.findIndex((t) => t.id === targetId);
      const prev = idx >= 0 ? list[idx] : null;
      const nextTodo = {
        id: targetId,
        title,
        domain: String(body.domain || (prev && prev.domain) || "TiefWerk").trim(),
        dueDate: body.due_date || body.dueDate ? String(body.due_date || body.dueDate).slice(0, 10) : (prev && prev.dueDate) || undefined,
        priority: ["high", "medium", "low"].includes(body.priority) ? body.priority : (prev && prev.priority) || "medium",
        status: ["open", "in_progress", "done"].includes(body.status) ? body.status : (prev && prev.status) || "open",
        rankScore: Number.isFinite(Number(body.rank_score ?? body.rankScore))
          ? Math.max(1, Math.min(100, Math.round(Number(body.rank_score ?? body.rankScore))))
          : (prev && prev.rankScore) || 75,
        aiReason: body.ai_reason || body.aiReason ? String(body.ai_reason || body.aiReason).trim() : (prev && prev.aiReason) || `Suggested by ${auth.label}`,
        source: "agent",
        agentName: auth.label || "Agent",
        isSuggestion: typeof body.is_suggestion === "boolean" ? body.is_suggestion : idx < 0,
        linkedIdeaId: body.linked_idea_id || body.linkedIdeaId || (prev && prev.linkedIdeaId) || undefined,
        createdAt: (prev && prev.createdAt) || nowIso,
        updatedAt: nowIso,
      };
      if (idx >= 0) list[idx] = nextTodo;
      else list.unshift(nextTodo);
      const saved = await saveTodosWithAgentToken(auth.tokenHash, list.slice(0, 200));
      return res.status(saved && saved.ok ? 200 : (saved && saved.status) || 502).json({ ok: Boolean(saved && saved.ok), todo: nextTodo });
    }

    if (req.method === "POST" && route === "todos/rank") {
      const updates = Array.isArray(req.body && req.body.rankings) ? req.body.rankings : [];
      if (updates.length === 0) return res.status(400).json({ error: "rankings array is required" });
      const map = new Map(updates.map((u) => [String(u.id), u]));
      const nowIso = new Date().toISOString();
      let updatedCount = 0;
      const nextList = (auth.todos || []).map((t) => {
        const u = map.get(String(t.id));
        if (!u) return t;
        updatedCount += 1;
        return {
          ...t,
          rankScore: Math.max(1, Math.min(100, Math.round(Number(u.rank_score ?? u.rankScore ?? t.rankScore ?? 50)))),
          aiReason: u.ai_reason || u.aiReason ? String(u.ai_reason || u.aiReason).trim() : t.aiReason,
          dueDate: u.due_date || u.dueDate ? String(u.due_date || u.dueDate).slice(0, 10) : t.dueDate,
          agentName: auth.label || t.agentName,
          updatedAt: nowIso,
        };
      });
      const saved = await saveTodosWithAgentToken(auth.tokenHash, nextList);
      return res.status(saved && saved.ok ? 200 : (saved && saved.status) || 502).json({ ok: Boolean(saved && saved.ok), updatedCount });
    }

    if (req.method === "GET" && route === "calendar") {
      const domain = req.query.domain ? String(req.query.domain).toLowerCase() : "";
      const deadlines = buildCalendarDeadlinesFeed({
        todos: auth.todos || [],
        ideas: auth.ideas || [],
        projects: auth.projects || [],
      }).filter((e) => !domain || String(e.domain || "").toLowerCase() === domain);
      return res.status(200).json({ total: deadlines.length, deadlines });
    }

    if (req.method === "GET" && route === "projects") {
      const domain = req.query.domain ? String(req.query.domain).toLowerCase() : "";
      const effort = req.query.effort ? String(req.query.effort) : "";
      const projects = auth.projects.filter((p) => {
        if (domain && String(p.domain || "").toLowerCase() !== domain) return false;
        if (effort && p.effortTier !== effort) return false;
        return true;
      });
      return res.status(200).json({ total: projects.length, projects });
    }

    if (req.method === "GET" && route === "graph") {
      const graph = buildKnowledgeGraphSummary(auth.ideas, auth.projects, {
        concept: req.query.concept,
        domain: req.query.domain,
      });
      return res.status(200).json(graph);
    }

    if (req.method === "POST" && route === "ideas") {
      const body = req.body || {};
      const title = String(body.title || "").trim();
      if (!title) return res.status(400).json({ error: "title is required" });
      const notes = String(body.notes || "").trim();
      const url = body.url ? String(body.url).trim() : undefined;

      let decision = {
        action: "ASSIGN_EXISTING",
        category: "Uncategorized",
        platform: "Web Apps & Tools",
        confidence: 0.7,
        priorityScore: 3,
        extractedConcepts: [],
        reasoning: "Added via authorized REST agent.",
        engine: "local-heuristic",
      };
      if (process.env.GEMINI_API_KEY) {
        decision = await classifyIdeaWithServerDecisionModel({
          apiKey: process.env.GEMINI_API_KEY,
          title,
          content: notes,
          url,
          existingCategories: auth.customCategories,
        });
      }

      const now = new Date().toISOString();
      const ideaId = `agent_${Date.now()}`;
      const newIdea = {
        id: ideaId,
        threadId: ideaId,
        messageId: ideaId,
        date: now,
        monthKey: now.slice(0, 7),
        subject: title,
        customTitle: title,
        snippet: notes || decision.reasoning,
        bodyText: notes,
        urls: url ? [url] : [],
        primaryUrl: url,
        attachments: [],
        isUnread: false,
        isStarred: decision.priorityScore >= 4,
        isInInbox: true,
        gmailUrl: url || "https://mail.google.com/mail/u/0/#inbox",
        column: decision.priorityScore >= 4 ? "to_deep_dive" : "inbox_backlog",
        columnOrder: 0,
        platform: decision.platform,
        domain: decision.category,
        notes: `[Added by ${auth.label} · ${decision.engine}] ${notes}`.trim(),
        isUntitled: false,
        aiSummary: decision.reasoning,
        aiTags: decision.extractedConcepts,
        lastSyncedAt: now,
        userModified: true,
      };

      const saved = await appendIdeaWithAgentToken(
        auth.tokenHash,
        newIdea,
        decision.action === "CREATE_NEW_CATEGORY" ? decision.category : null,
      );
      if (!saved || saved.ok !== true) {
        return res.status(502).json({ error: (saved && saved.error) || "Failed to save idea." });
      }
      return res.status(201).json({ ok: true, id: ideaId, decision });
    }

    return res.status(404).json({ error: `Unknown workbench agent route: ${route}` });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Agent request failed.",
    });
  }
};
