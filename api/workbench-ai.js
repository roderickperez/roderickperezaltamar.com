const {
  SOURCE_PLATFORMS,
  applySecurityHeaders,
  callGeminiGenerateJson,
  callGeminiGenerateJsonWithMeta,
  checkRateLimit,
  classifyIdeaWithServerDecisionModel,
  isSameOriginMutation,
  verifyOwnerFromCookie,
} = require("./_workbench-lib");

const CANONICAL_PROJECTS_PROMPT = [
  "TiefWerk (Energy & Earth platform, tiefwerk.ai) with subdivisions:",
  "  - TiefWerk / Kosmos (global geospatial & energy intelligence, maps, wells, markets)",
  "  - TiefWerk / Otto (Otto AI assistant, agents, watchlists, copilot)",
  "  - TiefWerk / Scout (prospects, basins, Norway/global datasets, exploration)",
  "  - TiefWerk / Bauen (3D subsurface viewer, Cesium/WebGL, seismic, faults, horizons)",
  "  - TiefWerk / Extract (Petrel/LAS/DLIS extraction, well-log digitizers, OCR/PDF)",
  "  - TiefWerk / Welt (watercolor/map explorer, cartography, alerts)",
  "  - TiefWerk / Stratum (sedimentation & sequence stratigraphy lab)",
  "  - TiefWerk / Automata (pipelines, Wache, Grun, Roboter, Blender, PostGIS/Supabase)",
  "HandSchrift (handwriting/stylus/manuscript tooling)",
  "DominoLab (DominoLab experiments & interactive prototypes)",
  "OMV (OMV work, internal courses, roderick.perezaltamar@omv.com)",
  "AI & Agents (general AI models, LLM agents, MCP servers, prompts, coding tools outside a specific TiefWerk module)",
  "Seismic & Subsurface (general seismic interpretation, geophysics, petrophysics, reservoir workflows)",
  "Personal (personal life, finance, health, family, home, private notes)",
  "Papers (academic papers, arXiv, OnePetro, SPE/SEG preprints)",
  "Thesis (thesis research, dissertation, university milestones, roderickperez@ou.edu)",
  "Conferences (EAGE, SEG, SPE, workshops, abstracts, talks)",
  "Travel (flights, hotels, itineraries, trips)",
  "Books (books, Kindle, reading list, notes)",
].join("\n");

const EFFORT_TIERS = [
  "Quick Win < 2h",
  "Weekend Prototype",
  "Deep Research / Course Module",
];

function isSafePublicHttpUrl(raw) {
  if (!raw || typeof raw !== "string") return false;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host) ||
      host === "::1" ||
      host.startsWith("[")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchSingleLinkPreview(url) {
  if (!isSafePublicHttpUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1400);
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    // Fast oEmbed metadata for YouTube videos
    if (host.includes("youtube.com") || host === "youtu.be") {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
        { signal: controller.signal, headers: { "User-Agent": "RPA-Workbench-Bot/1.0" } },
      );
      if (oembedRes.ok) {
        const data = await oembedRes.json();
        return {
          url,
          title: String(data.title || "").slice(0, 140),
          description: data.author_name ? `YouTube video by ${data.author_name}` : "YouTube video",
        };
      }
      return null;
    }
    // Skip login-walled sites that always return auth shells
    if (host.includes("linkedin.com") || host.includes("x.com") || host.includes("twitter.com")) {
      return null;
    }

    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RPA-Workbench/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!resp.ok) return null;
    const ctype = (resp.headers.get("content-type") || "").toLowerCase();
    if (!ctype.includes("text/html") && !ctype.includes("application/xhtml")) return null;
    const html = (await resp.text()).slice(0, 28000);
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1];
    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1];
    const title = decodeHtmlEntities(ogTitle || titleTag || "").slice(0, 140);
    const description = decodeHtmlEntities(ogDesc || metaDesc || "").slice(0, 240);
    if (!title && !description) return null;
    return { url, title, description };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function enrichItemsWithLinkPreviews(items) {
  const uniqueUrls = Array.from(
    new Set(
      items
        .map((i) => i && i.primaryUrl)
        .filter((u) => isSafePublicHttpUrl(u)),
    ),
  ).slice(0, 15);
  if (uniqueUrls.length === 0) return items;

  const previews = await Promise.all(uniqueUrls.map((u) => fetchSingleLinkPreview(u)));
  const previewMap = new Map();
  for (const p of previews) {
    if (p && p.url) previewMap.set(p.url, p);
  }
  return items.map((item) => {
    const p = item && item.primaryUrl ? previewMap.get(item.primaryUrl) : null;
    if (!p) return item;
    return { ...item, linkPreview: { title: p.title, description: p.description } };
  });
}

module.exports = async function (req, res) {
  applySecurityHeaders(res);

  const rl = checkRateLimit(req, { bucket: "owner-ai", maxRequests: 45, windowMs: 60_000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: `AI rate limit exceeded. Retry in ${rl.retryAfterSec}s.` });
  }

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
      const started = Date.now();
      const { usedModel } = await callGeminiGenerateJsonWithMeta(
        apiKey,
        body.model || "gemini-4-hydrogen",
        'Reply with JSON {"status":"ok"}',
        {
          type: "OBJECT",
          properties: { status: { type: "STRING" } },
          required: ["status"],
        },
      );
      return res.status(200).json({
        ok: true,
        usedModel,
        message: `Server-side Gemini API proxy connected via ${usedModel} (${Date.now() - started}ms).`,
      });
    }

    if (action === "classify_decision") {
      const result = await classifyIdeaWithServerDecisionModel({
        apiKey,
        title: String(body.title || ""),
        content: String(body.content || ""),
        url: body.url ? String(body.url) : undefined,
        existingCategories: Array.isArray(body.existingCategories) ? body.existingCategories : [],
        decisionModel: body.decisionModel || "gemini-decision-1",
        flashModel: body.flashModel || "gemini-4-hydrogen",
        threshold: typeof body.threshold === "number" ? body.threshold : 0.62,
      });
      return res.status(200).json({ ok: true, result });
    }

    if (action === "triage_batch") {
      const rawItems = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
      const items = await enrichItemsWithLinkPreviews(rawItems);
      const todayIso = new Date().toISOString().slice(0, 10);
      const prompt = [
        `Today is ${todayIso}. Classify and deeply analyze each saved email bookmark for Roderick Perez Altamar.`,
        "1. Assign exact platform (" + SOURCE_PLATFORMS.join(", ") + ") and domain (prefer his canonical projects/subdivisions below and honor existing gmailLabels as #1 guideline).",
        "2. Use linkPreview (when present), URLs, subject, snippet, and bodyPreview to produce a crisp suggestedTitle (max 75 chars) and oneLineSummary (max 150 chars).",
        "3. Extract dueDate in YYYY-MM-DD ONLY if an explicit deadline, event/conference/travel date, or submission date is mentioned; otherwise empty string ''.",
        "4. Assign suggestedColumn: 'to_deep_dive' if high-value/actionable or has an upcoming deadline, 'processed_archived' if obsolete/noise, else 'inbox_backlog'.",
        "5. Provide connectionNote (max 140 chars): note how this idea connects to or partially overlaps with another project/module/topic in Roderick's portfolio.",
        "6. Provide 3-6 concise lowercase concept tags for the 3D Knowledge Graph.",
        "Output ONLY a raw JSON array (one object per input item, preserving exact `id`) with keys: id, platform, domain, isUntitled (boolean), suggestedTitle, oneLineSummary, tags (string[]), dueDate, suggestedColumn, connectionNote.",
        "Canonical Projects:",
        CANONICAL_PROJECTS_PROMPT,
        "Items:",
        JSON.stringify(items),
      ].join("\n");
      const { value: result, usedModel } = await callGeminiGenerateJsonWithMeta(
        apiKey,
        body.model || "gemini-4-hydrogen",
        prompt,
        {
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
              dueDate: { type: "STRING" },
              suggestedColumn: { type: "STRING", enum: ["inbox_backlog", "to_deep_dive", "processed_archived"] },
              connectionNote: { type: "STRING" },
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
        },
      );
      const unwrapped = Array.isArray(result)
        ? result
        : Array.isArray(result?.results)
          ? result.results
          : Array.isArray(result?.items)
            ? result.items
            : [];
      return res.status(200).json({ ok: true, results: unwrapped, usedModel });
    }

    if (action === "synthesize_projects") {
      const manifest = Array.isArray(body.manifest) ? body.manifest.slice(0, 250) : [];
      const todayIso = new Date().toISOString().slice(0, 10);
      const prompt = [
        `Today is ${todayIso}. Cluster ALL of Roderick Perez Altamar's self-sent emails into comprehensive, cohesive Projects and Subprojects using his canonical taxonomy and existing gmailLabels as primary guidelines.`,
        "CRITICAL COVERAGE RULE: Do NOT stop at 3 projects! Create a distinct project or subproject entry for EVERY active domain/topic in the manifest that has 2+ matching emails (typically 6-16 total across TiefWerk subdivisions AND standalone projects like OMV, AI & Agents, Seismic & Subsurface, HandSchrift, DominoLab, Papers, Thesis, Conferences, Personal, Books, Travel). Aim to assign 80%+ of all input ideaIds.",
        "PARENT / SUBPROJECT HIERARCHY: For subdivisions like `TiefWerk / Scout`, `TiefWerk / Extract`, `TiefWerk / Bauen`, `TiefWerk / Kosmos`, `TiefWerk / Otto`, `TiefWerk / Welt`, `TiefWerk / Stratum`, `TiefWerk / Automata`, set `parentProject: \"TiefWerk\"` and `domain: \"TiefWerk / <Subproject>\"`. For standalone projects (`OMV`, `AI & Agents`, `Seismic & Subsurface`, `Papers`, `Thesis`, `HandSchrift`, `DominoLab`, `Personal`, `Conferences`, `Books`, `Travel`), set `parentProject: \"\"` (or group sub-initiatives under a clear parent if applicable).",
        "Canonical Projects:",
        CANONICAL_PROJECTS_PROMPT,
        "Output ONLY a raw JSON object with keys `projects` (array) and `suggestedTodos` (array).",
        "Each project MUST have: title, parentProject (string, e.g. 'TiefWerk' or ''), objective, whyItMatters, domain, mvpScope, techStack (2-6 strings), effortTier (" + EFFORT_TIERS.join(" | ") + "), checklist (3-5 concrete execution steps), ideaIds (matching input IDs), priorityScore (1-100), dueDate (YYYY-MM-DD or ''), synergyNotes, relatedProjectTitles (string[]).",
        "Each suggestedTodo (up to 6 concrete prioritized tasks) MUST have: title, domain, priority ('high'|'medium'|'low'), dueDate (YYYY-MM-DD or ''), reason, linkedIdeaId.",
        "Ideas:",
        JSON.stringify(manifest),
      ].join("\n");
      const { value: result, usedModel } = await callGeminiGenerateJsonWithMeta(
        apiKey,
        body.model || "gemini-4-hydrogen",
        prompt,
        {
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
                  dueDate: { type: "STRING" },
                  synergyNotes: { type: "STRING" },
                  relatedProjectTitles: { type: "ARRAY", items: { type: "STRING" } },
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
            suggestedTodos: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING" },
                  domain: { type: "STRING" },
                  priority: { type: "STRING", enum: ["high", "medium", "low"] },
                  dueDate: { type: "STRING" },
                  reason: { type: "STRING" },
                  linkedIdeaId: { type: "STRING" },
                },
                required: ["title", "domain", "priority", "reason"],
              },
            },
          },
          required: ["projects"],
        },
      );
      return res.status(200).json({
        ok: true,
        usedModel,
        projects: Array.isArray(result?.projects) ? result.projects : [],
        suggestedTodos: Array.isArray(result?.suggestedTodos) ? result.suggestedTodos : [],
      });
    }

    if (action === "compile_digest") {
      const prompt = `Compile an executive summary (2-3 crisp sentences) and the Top 3 "Execute This Week" quick wins from this snapshot and portfolio.\nReturn ONLY a raw JSON object with keys: executiveSummary (string), topPicks (array of {title, reason, actionStep, url, gmailUrl, effortTier}).\nInput:\n${JSON.stringify(body.context || {})}`;
      const { value: result, usedModel } = await callGeminiGenerateJsonWithMeta(
        apiKey,
        body.model || "gemini-4-hydrogen",
        prompt,
        {
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
        },
      );
      return res.status(200).json({ ok: true, usedModel, result });
    }

    if (action === "rank_todos") {
      const prompt = `You are RPA! Workbench Executive Assistant for Roderick Perez Altamar.\n1. Rank every active To-Do (1-100) based on deadline urgency and project impact (${CANONICAL_PROJECTS_PROMPT.replace(/\n/g, "; ")}). Give a crisp <12-word reason.\n2. Suggest up to 3 concrete new To-Dos from topIdeas or project nextSteps not already in activeTodos.\nReturn ONLY a raw JSON object with keys: rankings (array of {id, rankScore, reason, suggestedDueDate}) and suggestions (array of {title, domain, priority, dueDate, reason, linkedIdeaId}).\nContext:\n${JSON.stringify(body.context || {})}`;
      const { value: result, usedModel } = await callGeminiGenerateJsonWithMeta(
        apiKey,
        body.model || "gemini-4-hydrogen",
        prompt,
        {
          type: "OBJECT",
          properties: {
            rankings: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  id: { type: "STRING" },
                  rankScore: { type: "NUMBER" },
                  reason: { type: "STRING" },
                  suggestedDueDate: { type: "STRING" },
                },
                required: ["id", "rankScore", "reason"],
              },
            },
            suggestions: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING" },
                  domain: { type: "STRING" },
                  priority: { type: "STRING", enum: ["high", "medium", "low"] },
                  dueDate: { type: "STRING" },
                  reason: { type: "STRING" },
                  linkedIdeaId: { type: "STRING" },
                },
                required: ["title", "domain", "priority", "reason"],
              },
            },
          },
          required: ["rankings", "suggestions"],
        },
      );
      return res.status(200).json({ ok: true, usedModel, result });
    }

    return res.status(400).json({ error: `Unsupported AI proxy action: ${action}` });
  } catch (err) {
    return res.status(502).json({
      error: err instanceof Error ? err.message : "Server AI proxy request failed.",
    });
  }
};
