const crypto = require("crypto");

const ALLOWED_SCOPES = ["read:ideas", "read:projects", "read:graph", "write:ideas"];
const DEFAULT_CATEGORIES = [
  "Subsurface & Wells",
  "AI, Agents & ML",
  "Energy & Climate",
  "Digital Twins & 3D Viz",
  "Seismic & Geophysics",
  "Python & Dev Tools",
  "Papers & Algorithms",
];
const SOURCE_PLATFORMS = [
  "LinkedIn",
  "YouTube",
  "GitHub / GitLab",
  "Papers & PDFs",
  "Blogs & Docs",
  "Web Apps & Tools",
];
const CREATE_NEW_KEY = "__create_new_category__";
const DECISIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/decisions";

function readSessionToken(cookieHeader) {
  return (cookieHeader || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("__Host-course_session="))
    ?.slice("__Host-course_session=".length);
}

function sha256Hex(secret) {
  return crypto.createHash("sha256").update(String(secret), "utf8").digest("hex");
}

function isSameOriginMutation(req) {
  const origin = req.headers && req.headers.origin;
  const host = req.headers && req.headers.host;
  if (!origin || !host) return false;
  return origin === "https://" + host || origin === "http://" + host;
}

async function verifyOwnerFromCookie(req) {
  const token = readSessionToken(req.headers && req.headers.cookie);
  if (!token || !/^[A-Za-z0-9_.-]+$/.test(token)) {
    return { ok: false, status: 401, error: "Owner authentication required." };
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return { ok: false, status: 503, error: "Supabase configuration missing." };
  }

  const headers = { apikey: key, Authorization: "Bearer " + token };
  try {
    const userRes = await fetch(url + "/auth/v1/user", { headers });
    if (!userRes.ok) {
      return { ok: false, status: 401, error: "Session expired. Please sign in again." };
    }
    const user = await userRes.json();
    if (!user || typeof user.id !== "string") {
      return { ok: false, status: 401, error: "Invalid user session." };
    }

    const ownerRes = await fetch(
      `${url}/rest/v1/course_owners?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`,
      { headers: { ...headers, Accept: "application/json" } },
    );
    if (!ownerRes.ok) {
      return { ok: false, status: 403, error: "Owner authorization check failed." };
    }
    const owners = await ownerRes.json();
    if (!Array.isArray(owners) || owners.length === 0) {
      return {
        ok: false,
        status: 403,
        error: "Access denied: strictly private to the site owner.",
      };
    }

    return { ok: true, userId: user.id, email: user.email || "", token, url, key, headers };
  } catch (_) {
    return { ok: false, status: 503, error: "Unable to verify owner session." };
  }
}

function extractBearerToken(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (typeof auth !== "string") return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!/^rpa_ag_[a-f0-9]{48,128}$/i.test(token)) return null;
  return token;
}

async function verifyAgentTokenAndLoad(req, requiredScope) {
  const rawToken = extractBearerToken(req);
  if (!rawToken) {
    return { ok: false, status: 401, error: "Missing or malformed Authorization: Bearer rpa_ag_... token." };
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return { ok: false, status: 503, error: "Supabase backend not configured." };
  }

  const tokenHash = sha256Hex(rawToken);
  try {
    const rpcRes = await fetch(`${url}/rest/v1/rpc/agent_get_workbench`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_token_hash: tokenHash,
        p_required_scope: requiredScope || null,
      }),
    });
    if (!rpcRes.ok) {
      return { ok: false, status: 503, error: "Agent authorization RPC unavailable." };
    }
    const payload = await rpcRes.json();
    if (!payload || payload.ok !== true) {
      return {
        ok: false,
        status: Number(payload && payload.status) || 401,
        error: (payload && payload.error) || "Unauthorized agent token.",
      };
    }
    return {
      ok: true,
      tokenHash,
      label: payload.label || "Agent",
      scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
      ideas: Array.isArray(payload.ideas) ? payload.ideas : [],
      projects: Array.isArray(payload.projects) ? payload.projects : [],
      customCategories: Array.isArray(payload.custom_categories) ? payload.custom_categories : [],
      updatedAt: payload.updated_at || null,
      url,
      key,
    };
  } catch (_) {
    return { ok: false, status: 503, error: "Agent token verification failed." };
  }
}

async function appendIdeaWithAgentToken(tokenHash, idea, newCategory) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const rpcRes = await fetch(`${url}/rest/v1/rpc/agent_append_idea`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_token_hash: tokenHash,
      p_idea: idea,
      p_new_category: newCategory || null,
    }),
  });
  if (!rpcRes.ok) {
    return { ok: false, status: 503, error: "Failed to persist idea." };
  }
  return await rpcRes.json();
}

function getDisplayTitle(idea) {
  if (idea.customTitle && String(idea.customTitle).trim()) return String(idea.customTitle).trim();
  if (idea.aiSuggestedTitle && String(idea.aiSuggestedTitle).trim()) return String(idea.aiSuggestedTitle).trim();
  if (idea.subject && String(idea.subject).trim()) return String(idea.subject).trim();
  return idea.primaryUrl || "(Untitled)";
}

function sanitizeIdeaForAgent(idea) {
  return {
    id: idea.id,
    title: getDisplayTitle(idea),
    date: idea.date,
    monthKey: idea.monthKey,
    platform: idea.platform,
    domain: idea.domain,
    stage: idea.column,
    primaryUrl: idea.primaryUrl || null,
    urls: Array.isArray(idea.urls) ? idea.urls.slice(0, 5) : [],
    attachments: Array.isArray(idea.attachments) ? idea.attachments : [],
    summary: idea.aiSummary || idea.snippet || "",
    notes: idea.notes || "",
    tags: Array.isArray(idea.aiTags) ? idea.aiTags : [],
    projectId: idea.projectId || null,
    isStarred: Boolean(idea.isStarred),
    isUntitled: Boolean(idea.isUntitled),
  };
}

function buildKnowledgeGraphSummary(ideas, projects, filter = {}) {
  const conceptMap = new Map();
  const edges = new Map();
  const domainCounts = new Map();

  const registerConcept = (raw, domain, ideaId, projectId) => {
    const label = String(raw || "").trim();
    if (!label || label.length < 2) return;
    const key = label.toLowerCase();
    if (!conceptMap.has(key)) {
      conceptMap.set(key, {
        label,
        count: 0,
        domains: new Set(),
        projectIds: new Set(),
        ideaIds: new Set(),
      });
    }
    const entry = conceptMap.get(key);
    entry.count += 1;
    if (domain) entry.domains.add(domain);
    if (projectId) entry.projectIds.add(projectId);
    if (ideaId) entry.ideaIds.add(ideaId);
  };

  const addCoOccurrence = (a, b) => {
    const ka = a.toLowerCase();
    const kb = b.toLowerCase();
    if (ka === kb) return;
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    edges.set(key, (edges.get(key) || 0) + 1);
  };

  for (const idea of ideas) {
    const domain = idea.domain || "Uncategorized";
    domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    const tags = Array.isArray(idea.aiTags) ? idea.aiTags : [];
    for (const tag of tags) registerConcept(tag, domain, idea.id, idea.projectId);
    for (let i = 0; i < tags.length; i += 1) {
      for (let j = i + 1; j < tags.length; j += 1) {
        addCoOccurrence(tags[i], tags[j]);
      }
    }
  }

  for (const proj of projects) {
    const domain = proj.domain || "Uncategorized";
    const stack = Array.isArray(proj.techStack) ? proj.techStack : [];
    for (const tech of stack) registerConcept(tech, domain, null, proj.id);
    for (let i = 0; i < stack.length; i += 1) {
      for (let j = i + 1; j < stack.length; j += 1) {
        addCoOccurrence(stack[i], stack[j]);
      }
    }
  }

  const conceptQuery = filter.concept ? String(filter.concept).trim().toLowerCase() : "";
  const domainQuery = filter.domain ? String(filter.domain).trim().toLowerCase() : "";

  let concepts = Array.from(conceptMap.values()).map((c) => {
    const domains = Array.from(c.domains);
    const projectIds = Array.from(c.projectIds);
    return {
      label: c.label,
      count: c.count,
      domains,
      projectIds,
      ideaCount: c.ideaIds.size,
      isBridge: domains.length >= 2 || projectIds.length >= 2,
    };
  });

  if (domainQuery) {
    concepts = concepts.filter((c) => c.domains.some((d) => d.toLowerCase().includes(domainQuery)));
  }
  if (conceptQuery) {
    concepts = concepts.filter((c) => c.label.toLowerCase().includes(conceptQuery));
  }

  concepts.sort((a, b) => Number(b.isBridge) - Number(a.isBridge) || b.count - a.count);

  const bridges = concepts.filter((c) => c.isBridge).slice(0, 15);
  const connections = Array.from(edges.entries())
    .map(([k, weight]) => {
      const [source, target] = k.split("|");
      return { source, target, weight };
    })
    .filter((e) => !conceptQuery || e.source.includes(conceptQuery) || e.target.includes(conceptQuery))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 60);

  return {
    totalConcepts: conceptMap.size,
    totalConnections: edges.size,
    domains: Array.from(domainCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    crossDomainBridges: bridges,
    concepts: concepts.slice(0, 50),
    connections,
  };
}

async function callGeminiGenerateJson(apiKey, model, prompt, responseSchema) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model || "gemini-2.5-flash",
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        ...(responseSchema ? { responseSchema } : {}),
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini API HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(text);
}

async function classifyIdeaWithServerDecisionModel({
  apiKey,
  title,
  content,
  url,
  existingCategories = [],
  decisionModel = "gemini-decision-1",
  flashModel = "gemini-2.5-flash",
  threshold = 0.62,
}) {
  const categories = Array.from(
    new Set(
      [...existingCategories, ...DEFAULT_CATEGORIES]
        .map((c) => String(c || "").trim())
        .filter((c) => c && c !== "Uncategorized"),
    ),
  );

  const inputPayload = [
    `Title: ${title || ""}`,
    url ? `URL: ${url}` : "",
    content ? `Details: ${content}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);

  const categoryCriteria = {};
  for (const c of categories) {
    categoryCriteria[c] = `Technical ideas, repos, papers, or notes primarily about ${c}.`;
  }
  categoryCriteria[CREATE_NEW_KEY] =
    "Choose ONLY if this item introduces a genuinely distinct technical topic not covered by existing categories.";

  const platformCriteria = {};
  for (const p of SOURCE_PLATFORMS) {
    platformCriteria[p] = `Resource primarily from ${p}.`;
  }

  // 1. Primary path: Google Gemini Decisions API (gemini-decision-1)
  try {
    const res = await fetch(DECISIONS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: decisionModel,
        input: inputPayload,
        questions: {
          category_choice: {
            type: "choice",
            instructions:
              "Classify this technical item into the best existing category, or select __create_new_category__ if it belongs to a genuinely distinct new discipline.",
            criteria: categoryCriteria,
          },
          needs_new_category: {
            type: "noul",
            instructions: `Does this idea introduce a new technical discipline not already covered by: ${categories.join(", ")}?`,
          },
          platform_choice: {
            type: "choice",
            instructions: "Identify the primary source platform.",
            criteria: platformCriteria,
          },
          priority_score: {
            type: "score",
            instructions: "Rate actionable project value from 1 to 5.",
            criteria: {
              "1": "Minor reference",
              "2": "Read later",
              "3": "Useful technique",
              "4": "Strong prototype candidate",
              "5": "High-leverage immediate build",
            },
          },
        },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const catAns = data?.answers?.category_choice || {};
      const newAns = data?.answers?.needs_new_category || {};
      const platAns = data?.answers?.platform_choice || {};
      const scoreAns = data?.answers?.priority_score || {};

      const selected = catAns.choice || categories[0] || "Uncategorized";
      const confidence = Number((catAns.confidence ?? 0.78).toFixed(3));
      const newCatProb = Number((newAns.noul ?? 0.1).toFixed(3));
      const priorityScore = Math.max(1, Math.min(5, Math.round(scoreAns.score ?? 3)));
      const platform = SOURCE_PLATFORMS.includes(platAns.choice) ? platAns.choice : "Web Apps & Tools";

      if (selected === CREATE_NEW_KEY || newCatProb >= threshold || confidence < 0.45) {
        const minted = await callGeminiGenerateJson(
          apiKey,
          flashModel,
          `Propose ONE concise reusable category name (2-4 words Title Case) not in [${categories.join(", ")}], plus 2-5 extractedConcepts and a 1-sentence reasoning.\nItem:\n${inputPayload}`,
          {
            type: "OBJECT",
            properties: {
              category: { type: "STRING" },
              extractedConcepts: { type: "ARRAY", items: { type: "STRING" } },
              reasoning: { type: "STRING" },
            },
            required: ["category", "extractedConcepts", "reasoning"],
          },
        );
        return {
          action: "CREATE_NEW_CATEGORY",
          category: String(minted.category || "Emerging Tech").trim(),
          platform,
          confidence: Math.max(newCatProb, 1 - confidence),
          newCategoryProbability: newCatProb,
          priorityScore,
          extractedConcepts: Array.isArray(minted.extractedConcepts) ? minted.extractedConcepts.slice(0, 5) : [],
          reasoning: `gemini-decision-1 flagged new category (p=${Math.round(newCatProb * 100)}%). ${minted.reasoning || ""}`.trim(),
          engine: "gemini-decision-1",
          probabilities: catAns.probabilities || { [CREATE_NEW_KEY]: newCatProb },
        };
      }

      return {
        action: "ASSIGN_EXISTING",
        category: selected,
        platform,
        confidence,
        newCategoryProbability: newCatProb,
        priorityScore,
        extractedConcepts: [],
        reasoning: `Classified by gemini-decision-1 into "${selected}" with ${Math.round(confidence * 100)}% calibrated confidence (0 output tokens).`,
        engine: "gemini-decision-1",
        probabilities: catAns.probabilities || { [selected]: confidence },
      };
    }
  } catch (_) {
    // Fall through cleanly to Gemini Flash structured decision router
  }

  // 2. Fallback: Structured decision routing via Gemini Flash
  const parsed = await callGeminiGenerateJson(
    apiKey,
    flashModel,
    `You are a precision taxonomy decision engine.\nExisting categories: ${JSON.stringify(categories)}\nPlatforms: ${JSON.stringify(SOURCE_PLATFORMS)}\nDecide ASSIGN_EXISTING or CREATE_NEW_CATEGORY, return category, platform, confidence (0..1), newCategoryProbability (0..1), priorityScore (1..5), extractedConcepts (2-5 strings), and 1-sentence reasoning.\nItem:\n${inputPayload}`,
    {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", enum: ["ASSIGN_EXISTING", "CREATE_NEW_CATEGORY"] },
        category: { type: "STRING" },
        platform: { type: "STRING", enum: SOURCE_PLATFORMS },
        confidence: { type: "NUMBER" },
        newCategoryProbability: { type: "NUMBER" },
        priorityScore: { type: "NUMBER" },
        extractedConcepts: { type: "ARRAY", items: { type: "STRING" } },
        reasoning: { type: "STRING" },
      },
      required: [
        "action",
        "category",
        "platform",
        "confidence",
        "newCategoryProbability",
        "priorityScore",
        "extractedConcepts",
        "reasoning",
      ],
    },
  );

  const action = parsed.action === "CREATE_NEW_CATEGORY" ? "CREATE_NEW_CATEGORY" : "ASSIGN_EXISTING";
  const category = String(parsed.category || categories[0] || "Uncategorized").trim();
  const confidence = Math.max(0.05, Math.min(0.99, Number(parsed.confidence || 0.8)));

  return {
    action,
    category,
    platform: SOURCE_PLATFORMS.includes(parsed.platform) ? parsed.platform : "Web Apps & Tools",
    confidence,
    newCategoryProbability: Math.max(0.01, Math.min(0.99, Number(parsed.newCategoryProbability || 0.15))),
    priorityScore: Math.max(1, Math.min(5, Math.round(Number(parsed.priorityScore || 3)))),
    extractedConcepts: Array.isArray(parsed.extractedConcepts) ? parsed.extractedConcepts.slice(0, 5) : [],
    reasoning: String(parsed.reasoning || `Routed to "${category}" via server Gemini decision router.`),
    engine: "gemini-2.5-flash-fallback",
    probabilities: { [category]: confidence },
  };
}

module.exports = {
  ALLOWED_SCOPES,
  DEFAULT_CATEGORIES,
  SOURCE_PLATFORMS,
  sha256Hex,
  isSameOriginMutation,
  verifyOwnerFromCookie,
  extractBearerToken,
  verifyAgentTokenAndLoad,
  appendIdeaWithAgentToken,
  getDisplayTitle,
  sanitizeIdeaForAgent,
  buildKnowledgeGraphSummary,
  callGeminiGenerateJson,
  classifyIdeaWithServerDecisionModel,
};
