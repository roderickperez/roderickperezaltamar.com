const {
  appendIdeaWithAgentToken,
  buildKnowledgeGraphSummary,
  classifyIdeaWithServerDecisionModel,
  getDisplayTitle,
  sanitizeIdeaForAgent,
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
    },
  };
}

module.exports = async function (req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

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
        : route === "ideas" && req.method === "POST"
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

    if (req.method === "GET" && route === "ideas") {
      const q = req.query.q ? String(req.query.q).toLowerCase() : "";
      const domain = req.query.domain ? String(req.query.domain).toLowerCase() : "";
      const platform = req.query.platform ? String(req.query.platform).toLowerCase() : "";
      const stage = req.query.stage ? String(req.query.stage) : "";
      const limit = Math.max(1, Math.min(60, Number(req.query.limit || 25)));

      const matches = auth.ideas
        .filter((item) => {
          if (domain && String(item.domain || "").toLowerCase() !== domain) return false;
          if (platform && String(item.platform || "").toLowerCase() !== platform) return false;
          if (stage && item.column !== stage) return false;
          if (q) {
            const hay = [
              getDisplayTitle(item),
              item.snippet,
              item.notes,
              item.aiSummary,
              item.domain,
              ...(item.aiTags || []),
            ]
              .join(" ")
              .toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        })
        .slice(0, limit)
        .map(sanitizeIdeaForAgent);

      return res.status(200).json({ total: matches.length, ideas: matches });
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
