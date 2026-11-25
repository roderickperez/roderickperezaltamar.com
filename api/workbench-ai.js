const {
  SOURCE_PLATFORMS,
  callGeminiGenerateJson,
  classifyIdeaWithServerDecisionModel,
  isSameOriginMutation,
  verifyOwnerFromCookie,
} = require("./_workbench-lib");

const EFFORT_TIERS = [
  "Quick Win < 2h",
  "Weekend Prototype",
  "Deep Research / Course Module",
];

module.exports = async function (req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  const owner = await verifyOwnerFromCookie(req);
  if (!owner.ok) {
    return res.status(owner.status).json({ error: owner.error });
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      configured: Boolean(process.env.GEMINI_API_KEY),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!isSameOriginMutation(req)) {
    return res.status(403).json({ error: "Cross-origin AI proxy request denied." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "Server-side GEMINI_API_KEY is not configured in Vercel environment variables.",
    });
  }

  const body = req.body || {};
  const action = String(body.action || "");

  try {
    if (action === "test") {
      await callGeminiGenerateJson(
        apiKey,
        body.model || "gemini-2.5-flash",
        'Reply with JSON {"status":"ok"}',
        {
          type: "OBJECT",
          properties: { status: { type: "STRING" } },
          required: ["status"],
        },
      );
      return res.status(200).json({ ok: true, message: "Server-side Gemini API proxy connected." });
    }

    if (action === "classify_decision") {
      const result = await classifyIdeaWithServerDecisionModel({
        apiKey,
        title: String(body.title || ""),
        content: String(body.content || ""),
        url: body.url ? String(body.url) : undefined,
        existingCategories: Array.isArray(body.existingCategories) ? body.existingCategories : [],
        decisionModel: body.decisionModel || "gemini-decision-1",
        flashModel: body.flashModel || "gemini-2.5-flash",
        threshold: typeof body.threshold === "number" ? body.threshold : 0.62,
      });
      return res.status(200).json({ ok: true, result });
    }

    if (action === "triage_batch") {
      const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
      const prompt = `Classify each saved technical idea into exact platform (${SOURCE_PLATFORMS.join(", ")}), concise domain, isUntitled boolean, clean suggestedTitle, oneLineSummary, and 2-4 concise tags.\nItems:\n${JSON.stringify(items)}`;
      const result = await callGeminiGenerateJson(apiKey, body.model || "gemini-2.5-flash", prompt, {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING" },
            platform: { type: "STRING", enum: SOURCE_PLATFORMS },
            domain: { type: "STRING" },
            isUntitled: { type: "BOOLEAN" },
            suggestedTitle: { type: "STRING" },
            oneLineSummary: { type: "STRING" },
            tags: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: [
            "id",
            "platform",
            "domain",
            "isUntitled",
            "suggestedTitle",
            "oneLineSummary",
            "tags",
          ],
        },
      });
      return res.status(200).json({ ok: true, results: result });
    }

    if (action === "synthesize_projects") {
      const manifest = Array.isArray(body.manifest) ? body.manifest.slice(0, 250) : [];
      const prompt = `Cluster these technical ideas into cohesive, actionable projects. For each project output title, objective, whyItMatters, domain, mvpScope, techStack (2-6 strings), effortTier (${EFFORT_TIERS.join(" | ")}), checklist (3-5 concrete execution steps), ideaIds (matching input IDs), priorityScore (1-100).\nIdeas:\n${JSON.stringify(manifest)}`;
      const result = await callGeminiGenerateJson(apiKey, body.model || "gemini-2.5-pro", prompt, {
        type: "OBJECT",
        properties: {
          projects: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                objective: { type: "STRING" },
                whyItMatters: { type: "STRING" },
                domain: { type: "STRING" },
                mvpScope: { type: "STRING" },
                techStack: { type: "ARRAY", items: { type: "STRING" } },
                effortTier: { type: "STRING", enum: EFFORT_TIERS },
                checklist: { type: "ARRAY", items: { type: "STRING" } },
                ideaIds: { type: "ARRAY", items: { type: "STRING" } },
                priorityScore: { type: "NUMBER" },
              },
              required: [
                "title",
                "objective",
                "whyItMatters",
                "domain",
                "mvpScope",
                "techStack",
                "effortTier",
                "checklist",
                "ideaIds",
                "priorityScore",
              ],
            },
          },
        },
        required: ["projects"],
      });
      return res.status(200).json({ ok: true, projects: result.projects || [] });
    }

    if (action === "compile_digest") {
      const prompt = `Compile an executive summary (2-3 crisp sentences) and the Top 3 "Execute This Week" quick wins from this snapshot and portfolio.\nInput:\n${JSON.stringify(body.context || {})}`;
      const result = await callGeminiGenerateJson(apiKey, body.model || "gemini-2.5-flash", prompt, {
        type: "OBJECT",
        properties: {
          executiveSummary: { type: "STRING" },
          topPicks: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                reason: { type: "STRING" },
                actionStep: { type: "STRING" },
                url: { type: "STRING" },
                gmailUrl: { type: "STRING" },
                effortTier: { type: "STRING", enum: EFFORT_TIERS },
              },
              required: ["title", "reason", "actionStep"],
            },
          },
        },
        required: ["executiveSummary", "topPicks"],
      });
      return res.status(200).json({ ok: true, result });
    }

    return res.status(400).json({ error: `Unsupported AI proxy action: ${action}` });
  } catch (err) {
    return res.status(502).json({
      error: err instanceof Error ? err.message : "Server AI proxy request failed.",
    });
  }
};
