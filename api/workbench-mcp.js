const {
  appendIdeaWithAgentToken,
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
  upsertWikiPageWithAgentToken,
  verifyAgentTokenAndLoad,
} = require("./_workbench-lib");

const MCP_TOOLS = [
  {
    name: "context_pack",
    description:
      "One-call startup brief for any AI agent: returns Roderick's profile, confirmed rules, open cross-agent handoffs, matching project wiki summaries, and top priority emails (requires scope: read:ideas).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional focus topic or task query." },
        project_slug: { type: "string", description: "Optional canonical project slug (e.g. tiefwerk-bauen, omv, handschrift)." },
      },
    },
  },
  {
    name: "search_ideas",
    description:
      "Hybrid ranked search across Roderick's self-sent emails, papers, repos, labels, and notes (requires scope: read:ideas).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword search across title, summary, labels, notes, tags, and URLs." },
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
  {
    name: "create_handoff",
    description:
      "Leave a typed cross-agent handoff packet so another agent (Antigravity, Claude Code, Codex, Gemini, ChatGPT) can pick up mid-task without re-explaining (requires scope: write:handoffs or write:ideas).",
    inputSchema: {
      type: "object",
      properties: {
        project_slug: { type: "string", description: "Project slug (e.g. tiefwerk-kosmos, handschrift, omv)." },
        title: { type: "string" },
        from_agent: { type: "string" },
        summary: { type: "string" },
        what_worked: { type: "array", items: { type: "string" } },
        what_failed: { type: "array", items: { type: "string" } },
        open_questions: { type: "array", items: { type: "string" } },
        relevant_files: { type: "array", items: { type: "string" } },
        next_step: { type: "string" },
      },
      required: ["title", "summary", "next_step"],
    },
  },
  {
    name: "claim_handoff",
    description:
      "Atomically claim an open cross-agent handoff exactly once so two agents never duplicate the same task (requires scope: write:handoffs or write:ideas).",
    inputSchema: {
      type: "object",
      properties: {
        handoff_id: { type: "string" },
        claimer: { type: "string", description: "Name of the claiming agent (e.g. codex, antigravity, claude-code)." },
      },
      required: ["handoff_id"],
    },
  },
  {
    name: "remember_rule",
    description:
      "Save a personal working preference or routing correction so every connected agent follows it (respects human_locked rules; requires scope: write:memory or write:ideas).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        rule_text: { type: "string" },
        kind: { type: "string", enum: ["profile", "routing_rule", "preference"] },
        pattern: { type: "string" },
        target_domain: { type: "string" },
      },
      required: ["title", "rule_text"],
    },
  },
  {
    name: "get_wiki_page",
    description:
      "Read compiled Living Project Wiki pages (compiled truth, append-only timeline, contradictions, last_verified timestamp) (requires scope: read:projects).",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Optional wiki page slug (omit to list all wiki pages)." },
      },
    },
  },
  {
    name: "upsert_wiki_page",
    description:
      "Create or update a Living Project Wiki page with compiled truth, optional timeline entry, and replaced_because audit reason (requires scope: write:memory or write:ideas).",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        title: { type: "string" },
        domain: { type: "string" },
        compiled_truth_md: { type: "string" },
        replaced_because: { type: "string" },
        contradictions: { type: "array", items: { type: "string" } },
        source_idea_ids: { type: "array", items: { type: "string" } },
      },
      required: ["slug", "title", "compiled_truth_md"],
    },
  },
  {
    name: "list_todos",
    description:
      "Read Roderick's right-side To-Do List sorted by AI priority rank and due date (requires scope: read:ideas).",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "in_progress", "done"] },
        domain: { type: "string" },
      },
    },
  },
  {
    name: "upsert_todo",
    description:
      "Add, edit, suggest, or mark complete a task in Roderick's To-Do List (syncs with Calendar when due_date is set; requires scope: write:ideas).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Existing todo id to edit (omit to create a new task/suggestion)." },
        title: { type: "string" },
        domain: { type: "string" },
        due_date: { type: "string", description: "Optional YYYY-MM-DD deadline." },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        status: { type: "string", enum: ["open", "in_progress", "done"] },
        rank_score: { type: "integer", minimum: 1, maximum: 100 },
        ai_reason: { type: "string" },
        is_suggestion: { type: "boolean", description: "True to mark as an AI suggestion for owner approval." },
        linked_idea_id: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "rank_todos",
    description:
      "Batch re-rank Roderick's active To-Dos with scores (1-100), crisp reasons, and optional suggested due dates (requires scope: write:ideas).",
    inputSchema: {
      type: "object",
      properties: {
        rankings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              rank_score: { type: "integer", minimum: 1, maximum: 100 },
              ai_reason: { type: "string" },
              due_date: { type: "string" },
            },
            required: ["id", "rank_score"],
          },
        },
      },
      required: ["rankings"],
    },
  },
  {
    name: "get_calendar_deadlines",
    description:
      "Return the unified deadlines calendar combining To-Dos, Project milestones, and Email deadlines (requires scope: read:ideas).",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
      },
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
    const allowed =
      baseAuth.scopes.includes(scope) ||
      ((scope === "write:memory" || scope === "write:handoffs") &&
        baseAuth.scopes.includes("write:ideas"));
    if (!allowed) {
      res.status(403).json(jsonRpcError(id, -32003, `Token lacks required scope: ${scope}`));
      return false;
    }
    return true;
  };

  try {
    if (toolName === "context_pack") {
      if (!requireScope("read:ideas")) return;
      const brain = await loadSecondBrainWithAgentToken(baseAuth.tokenHash, "read:ideas");
      const pack = buildContextPack({
        query: args.query ? String(args.query) : "",
        projectSlug: args.project_slug ? String(args.project_slug) : "",
        ideas: baseAuth.ideas,
        projects: baseAuth.projects,
        todos: baseAuth.todos || [],
        rules: brain.rules,
        wikiPages: brain.wikiPages,
        handoffs: brain.handoffs,
      });
      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(pack, null, 2) }],
        }),
      );
    }

    if (toolName === "search_ideas") {
      if (!requireScope("read:ideas")) return;
      const q = args.query ? String(args.query) : "";
      const domain = args.domain ? String(args.domain).toLowerCase() : "";
      const platform = args.platform ? String(args.platform).toLowerCase() : "";
      const stage = args.stage ? String(args.stage) : "";
      const limit = Math.max(1, Math.min(50, Number(args.limit || 20)));

      const prefiltered = baseAuth.ideas.filter((item) => {
        if (item.isSelfSent === false) return false;
        if (domain && String(item.domain || "").toLowerCase() !== domain) return false;
        if (platform && String(item.platform || "").toLowerCase() !== platform) return false;
        if (stage && item.column !== stage) return false;
        return true;
      });
      const matches = hybridRankIdeas(prefiltered, q, limit).map(sanitizeIdeaForAgent);

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

    if (toolName === "create_handoff") {
      if (!requireScope("write:handoffs")) return;
      const title = String(args.title || "").trim();
      const summary = String(args.summary || "").trim();
      const nextStep = String(args.next_step || "").trim();
      if (!title || !summary || !nextStep) {
        return res.status(200).json(jsonRpcError(id, -32602, "title, summary, and next_step are required"));
      }
      const created = await createHandoffWithAgentToken(baseAuth.tokenHash, {
        project_slug: String(args.project_slug || "general").trim(),
        title,
        from_agent: String(args.from_agent || baseAuth.label || "agent").trim(),
        summary,
        what_worked: Array.isArray(args.what_worked) ? args.what_worked : [],
        what_failed: Array.isArray(args.what_failed) ? args.what_failed : [],
        open_questions: Array.isArray(args.open_questions) ? args.open_questions : [],
        relevant_files: Array.isArray(args.relevant_files) ? args.relevant_files : [],
        next_step: nextStep,
      });
      if (!created || created.ok !== true) {
        return res.status(200).json(jsonRpcError(id, -32000, (created && created.error) || "Failed to create handoff."));
      }
      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(created, null, 2) }],
        }),
      );
    }

    if (toolName === "claim_handoff") {
      if (!requireScope("write:handoffs")) return;
      const handoffId = String(args.handoff_id || "").trim();
      if (!handoffId) {
        return res.status(200).json(jsonRpcError(id, -32602, "handoff_id is required"));
      }
      const claimed = await claimHandoffWithAgentToken(
        baseAuth.tokenHash,
        handoffId,
        args.claimer ? String(args.claimer).trim() : baseAuth.label,
      );
      if (!claimed || claimed.ok !== true) {
        return res.status(200).json(jsonRpcError(id, -32009, (claimed && claimed.error) || "Unable to claim handoff."));
      }
      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(claimed, null, 2) }],
        }),
      );
    }

    if (toolName === "remember_rule") {
      if (!requireScope("write:memory")) return;
      const title = String(args.title || "").trim();
      const ruleText = String(args.rule_text || "").trim();
      if (!title || !ruleText) {
        return res.status(200).json(jsonRpcError(id, -32602, "title and rule_text are required"));
      }
      const saved = await rememberRuleWithAgentToken(baseAuth.tokenHash, {
        title,
        rule_text: ruleText,
        kind: args.kind || "preference",
        pattern: args.pattern || null,
        target_domain: args.target_domain || null,
        agent_name: baseAuth.label,
      });
      if (!saved || saved.ok !== true) {
        return res.status(200).json(jsonRpcError(id, -32000, (saved && saved.error) || "Failed to save rule."));
      }
      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(saved, null, 2) }],
        }),
      );
    }

    if (toolName === "get_wiki_page") {
      if (!requireScope("read:projects")) return;
      const brain = await loadSecondBrainWithAgentToken(baseAuth.tokenHash, "read:projects");
      const slug = args.slug ? String(args.slug).trim().toLowerCase() : "";
      const pages = slug
        ? brain.wikiPages.filter((w) => String(w.slug || "").toLowerCase() === slug)
        : brain.wikiPages;
      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify({ total: pages.length, pages }, null, 2) }],
        }),
      );
    }

    if (toolName === "upsert_wiki_page") {
      if (!requireScope("write:memory")) return;
      const slug = String(args.slug || "").trim();
      const title = String(args.title || "").trim();
      const compiled = String(args.compiled_truth_md || "").trim();
      if (!slug || !title || !compiled) {
        return res.status(200).json(jsonRpcError(id, -32602, "slug, title, and compiled_truth_md are required"));
      }
      const saved = await upsertWikiPageWithAgentToken(baseAuth.tokenHash, {
        slug,
        title,
        domain: args.domain || title,
        compiled_truth_md: compiled,
        replaced_because: args.replaced_because || `Updated by ${baseAuth.label}`,
        contradictions: Array.isArray(args.contradictions) ? args.contradictions : [],
        source_idea_ids: Array.isArray(args.source_idea_ids) ? args.source_idea_ids : [],
      });
      if (!saved || saved.ok !== true) {
        return res.status(200).json(jsonRpcError(id, -32000, (saved && saved.error) || "Failed to update wiki page."));
      }
      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(saved, null, 2) }],
        }),
      );
    }

    if (toolName === "list_todos") {
      if (!requireScope("read:ideas")) return;
      const status = args.status ? String(args.status) : "";
      const domain = args.domain ? String(args.domain).toLowerCase() : "";
      const todos = (baseAuth.todos || [])
        .filter((t) => {
          if (status && t.status !== status) return false;
          if (domain && String(t.domain || "").toLowerCase() !== domain) return false;
          return true;
        })
        .sort((a, b) => (Number(b.rankScore) || 50) - (Number(a.rankScore) || 50));
      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify({ total: todos.length, todos }, null, 2) }],
        }),
      );
    }

    if (toolName === "upsert_todo") {
      if (!requireScope("write:ideas")) return;
      const title = String(args.title || "").trim();
      if (!title) {
        return res.status(200).json(jsonRpcError(id, -32602, "title is required"));
      }
      const nowIso = new Date().toISOString();
      const existingList = Array.isArray(baseAuth.todos) ? [...baseAuth.todos] : [];
      const targetId = args.id ? String(args.id).trim() : `todo_ag_${Date.now()}`;
      const idx = existingList.findIndex((t) => t.id === targetId);
      const prev = idx >= 0 ? existingList[idx] : null;
      const nextTodo = {
        id: targetId,
        title,
        domain: String(args.domain || (prev && prev.domain) || "TiefWerk").trim(),
        dueDate: args.due_date ? String(args.due_date).slice(0, 10) : (prev && prev.dueDate) || undefined,
        priority: ["high", "medium", "low"].includes(args.priority) ? args.priority : (prev && prev.priority) || "medium",
        status: ["open", "in_progress", "done"].includes(args.status) ? args.status : (prev && prev.status) || "open",
        rankScore: Number.isFinite(Number(args.rank_score))
          ? Math.max(1, Math.min(100, Math.round(Number(args.rank_score))))
          : (prev && prev.rankScore) || 75,
        aiReason: args.ai_reason ? String(args.ai_reason).trim() : (prev && prev.aiReason) || `Updated by ${baseAuth.label}`,
        source: "agent",
        agentName: baseAuth.label || "Agent",
        isSuggestion: typeof args.is_suggestion === "boolean" ? args.is_suggestion : idx < 0,
        linkedIdeaId: args.linked_idea_id || (prev && prev.linkedIdeaId) || undefined,
        createdAt: (prev && prev.createdAt) || nowIso,
        updatedAt: nowIso,
      };
      if (idx >= 0) existingList[idx] = nextTodo;
      else existingList.unshift(nextTodo);

      const saved = await saveTodosWithAgentToken(baseAuth.tokenHash, existingList.slice(0, 200));
      if (!saved || saved.ok !== true) {
        return res.status(200).json(jsonRpcError(id, -32000, (saved && saved.error) || "Failed to save todo."));
      }
      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify({ saved: true, todo: nextTodo }, null, 2) }],
        }),
      );
    }

    if (toolName === "rank_todos") {
      if (!requireScope("write:ideas")) return;
      const updates = Array.isArray(args.rankings) ? args.rankings : [];
      if (updates.length === 0) {
        return res.status(200).json(jsonRpcError(id, -32602, "rankings array is required"));
      }
      const updateMap = new Map(updates.map((u) => [String(u.id), u]));
      const nowIso = new Date().toISOString();
      let updatedCount = 0;
      const nextList = (baseAuth.todos || []).map((t) => {
        const u = updateMap.get(String(t.id));
        if (!u) return t;
        updatedCount += 1;
        return {
          ...t,
          rankScore: Math.max(1, Math.min(100, Math.round(Number(u.rank_score || t.rankScore || 50)))),
          aiReason: u.ai_reason ? String(u.ai_reason).trim() : t.aiReason,
          dueDate: u.due_date ? String(u.due_date).slice(0, 10) : t.dueDate,
          agentName: baseAuth.label || t.agentName,
          updatedAt: nowIso,
        };
      });
      const saved = await saveTodosWithAgentToken(baseAuth.tokenHash, nextList);
      if (!saved || saved.ok !== true) {
        return res.status(200).json(jsonRpcError(id, -32000, (saved && saved.error) || "Failed to save ranked todos."));
      }
      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify({ ok: true, updatedCount }, null, 2) }],
        }),
      );
    }

    if (toolName === "get_calendar_deadlines") {
      if (!requireScope("read:ideas")) return;
      const domain = args.domain ? String(args.domain).toLowerCase() : "";
      const events = buildCalendarDeadlinesFeed({
        todos: baseAuth.todos || [],
        ideas: baseAuth.ideas || [],
        projects: baseAuth.projects || [],
      }).filter((e) => !domain || String(e.domain || "").toLowerCase() === domain);
      return res.status(200).json(
        jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify({ total: events.length, deadlines: events }, null, 2) }],
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
