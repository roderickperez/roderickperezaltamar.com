const {
  appendIdeaWithAgentToken,
  buildKnowledgeGraphSummary,
  classifyIdeaWithServerDecisionModel,
  getDisplayTitle,
  sanitizeIdeaForAgent,
  verifyAgentTokenAndLoad,
} = require("./_workbench-lib");

const MCP_TOOLS = [
  {
    name: "search_ideas",
    description:
      "Search and filter Roderick's curated technical ideas, saved papers, repos, and notes (requires scope: read:ideas).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword search across title, summary, notes, tags, and URLs." },
        domain: { type: "string", description: "Optional category/domain filter." },
        platform: { type: "string", description: "Optional source platform filter." },
        stage: {
          type: "string",
          enum: ["inbox_backlog", "to_deep_dive", "in_progress", "processed_archived"],
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
    },
  },
  {
    name: "list_projects",
    description:
      "List synthesized projects with objectives, MVP scope, tech stack, execution checklists, and linked idea IDs (requires scope: read:projects).",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        effort_tier: {
          type: "string",
          enum: ["Quick Win < 2h", "Weekend Prototype", "Deep Research / Course Module"],
        },
      },
    },
  },
  {
    name: "query_knowledge_graph",
    description:
      "Inspect concepts, cross-domain bridge hubs, and co-occurrence connections from the 3D Knowledge Base (requires scope: read:graph).",
    inputSchema: {
      type: "object",
      properties: {
        concept: { type: "string", description: "Optional concept substring to focus connections." },
        domain: { type: "string", description: "Optional domain filter." },
      },
    },
  },
  {
    name: "get_backlog_summary",
    description:
      "Return KPI metrics (total ideas, backlog, active focus, processed rate, top domains, project count) (requires scope: read:ideas).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_and_classify_idea",
    description:
      "Add a new concept/link to RPA! Workbench and route it into an existing or newly created category using Google Decision Model (requires scope: write:ideas).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        url: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title"],
    },
  },
];

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

module.exports = async function (req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  if (req.method === "GET") {
    return res.status(200).json({
      name: "rpa-workbench-mcp",
      protocol: "MCP Streamable HTTP (JSON-RPC 2.0)",
      auth: "Authorization: Bearer rpa_ag_...",
      tools: MCP_TOOLS.map((t) => t.name),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const rpc = req.body || {};
  const { id, method, params } = rpc;

  // Authenticate Bearer token before serving any MCP method
  const baseAuth = await verifyAgentTokenAndLoad(req, null);
  if (!baseAuth.ok) {
    return res.status(baseAuth.status).json(jsonRpcError(id, -32001, baseAuth.error));
  }

  if (method === "initialize") {
    return res.status(200).json(
      jsonRpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "rpa-workbench-mcp", version: "1.0.0" },
      }),
    );
  }

  if (method === "notifications/initialized" || method === "ping") {
    return res.status(200).json(jsonRpcResult(id, {}));
  }

  if (method === "tools/list") {
    return res.status(200).json(jsonRpcResult(id, { tools: MCP_TOOLS }));
  }

  if (method !== "tools/call") {
    return res.status(200).json(jsonRpcError(id, -32601, `Unknown MCP method: ${method}`));
  }

  const toolName = params && params.name;
  const args = (params && params.arguments) || {};

  const requireScope = (scope) => {
    if (!baseAuth.scopes.includes(scope)) {
      res.status(403).json(jsonRpcError(id, -32003, `Token lacks required scope: ${scope}`));
      return false;
    }
    return true;
  };

  try {
    if (toolName === "search_ideas") {
      if (!requireScope("read:ideas")) return;
      const q = args.query ? String(args.query).toLowerCase() : "";
      const domain = args.domain ? String(args.domain).toLowerCase() : "";
      const platform = args.platform ? String(args.platform).toLowerCase() : "";
      const stage = args.stage ? String(args.stage) : "";
      const limit = Math.max(1, Math.min(50, Number(args.limit || 20)));

      const matches = baseAuth.ideas
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
              ...(item.urls || []),
            ]
              .join(" ")
              .toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        })
        .slice(0, limit)
        .map(sanitizeIdeaForAgent);

      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify({ total: matches.length, ideas: matches }, null, 2) }],
        }),
      );
    }

    if (toolName === "list_projects") {
      if (!requireScope("read:projects")) return;
      const domain = args.domain ? String(args.domain).toLowerCase() : "";
      const effort = args.effort_tier ? String(args.effort_tier) : "";
      const filtered = baseAuth.projects.filter((p) => {
        if (domain && String(p.domain || "").toLowerCase() !== domain) return false;
        if (effort && p.effortTier !== effort) return false;
        return true;
      });
      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify({ total: filtered.length, projects: filtered }, null, 2) }],
        }),
      );
    }

    if (toolName === "query_knowledge_graph") {
      if (!requireScope("read:graph")) return;
      const graph = buildKnowledgeGraphSummary(baseAuth.ideas, baseAuth.projects, {
        concept: args.concept,
        domain: args.domain,
      });
      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(graph, null, 2) }],
        }),
      );
    }

    if (toolName === "get_backlog_summary") {
      if (!requireScope("read:ideas")) return;
      const total = baseAuth.ideas.length;
      const inboxBacklog = baseAuth.ideas.filter((i) => i.column === "inbox_backlog").length;
      const inProgress = baseAuth.ideas.filter((i) => i.column === "in_progress").length;
      const ready = baseAuth.ideas.filter((i) => i.column === "to_deep_dive").length;
      const processed = baseAuth.ideas.filter((i) => i.column === "processed_archived").length;
      const summary = {
        totalIdeas: total,
        inboxBacklog,
        readyToDeepDive: ready,
        inProgress,
        processed,
        processedRatePct: total > 0 ? Math.round((processed / total) * 100) : 0,
        totalProjects: baseAuth.projects.length,
        customCategories: baseAuth.customCategories,
        updatedAt: baseAuth.updatedAt,
      };
      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        }),
      );
    }

    if (toolName === "add_and_classify_idea") {
      if (!requireScope("write:ideas")) return;
      const title = String(args.title || "").trim();
      if (!title) {
        return res.status(200).json(jsonRpcError(id, -32602, "title is required"));
      }
      const notes = String(args.notes || "").trim();
      const url = args.url ? String(args.url).trim() : undefined;
      const apiKey = process.env.GEMINI_API_KEY;
      let decision = {
        action: "ASSIGN_EXISTING",
        category: "Uncategorized",
        platform: "Web Apps & Tools",
        confidence: 0.7,
        priorityScore: 3,
        extractedConcepts: [],
        reasoning: "Added via authorized MCP agent.",
        engine: "local-heuristic",
      };
      if (apiKey) {
        decision = await classifyIdeaWithServerDecisionModel({
          apiKey,
          title,
          content: notes,
          url,
          existingCategories: baseAuth.customCategories,
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
        notes: `[Added by ${baseAuth.label} · ${decision.engine}] ${notes}`.trim(),
        isUntitled: false,
        aiSummary: decision.reasoning,
        aiTags: decision.extractedConcepts,
        lastSyncedAt: now,
        userModified: true,
      };

      const saved = await appendIdeaWithAgentToken(
        baseAuth.tokenHash,
        newIdea,
        decision.action === "CREATE_NEW_CATEGORY" ? decision.category : null,
      );
      if (!saved || saved.ok !== true) {
        return res.status(200).json(jsonRpcError(id, -32000, (saved && saved.error) || "Failed to save idea."));
      }

      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify({ saved: true, id: ideaId, decision }, null, 2) }],
        }),
      );
    }

    return res.status(200).json(jsonRpcError(id, -32601, `Unknown tool: ${toolName}`));
  } catch (err) {
    return res.status(200).json(
      jsonRpcError(id, -32000, err instanceof Error ? err.message : "Tool execution failed."),
    );
  }
};
