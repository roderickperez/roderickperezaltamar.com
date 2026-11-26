const crypto = require("crypto");

const ALLOWED_SCOPES = [
  "read:ideas",
  "read:projects",
  "read:graph",
  "write:ideas",
  "write:memory",
  "write:handoffs",
];
const DEFAULT_CATEGORIES = [
  "TiefWerk",
  "TiefWerk / Kosmos",
  "TiefWerk / Otto",
  "TiefWerk / Scout",
  "TiefWerk / Bauen",
  "TiefWerk / Extract",
  "TiefWerk / Welt",
  "TiefWerk / Stratum",
  "TiefWerk / Automata",
  "HandSchrift",
  "DominoLab",
  "OMV",
  "Papers",
  "Thesis",
  "Conferences",
  "Travel",
  "Books",
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

const DEFAULT_OWNER_EMAILS = [
  "roderickperezaltamar@gmail.com",
  "roderick.perezaltamar@omv.com",
];

// In-memory sliding-window rate limiter & auth-failure lockout per IP
const RATE_LIMIT_BUCKETS = new Map();
const AUTH_FAIL_BUCKETS = new Map();

function getClientIp(req) {
  const xff = req && req.headers && (req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"]);
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0].trim();
  }
  return (req && req.socket && req.socket.remoteAddress) || "unknown";
}

function checkRateLimit(req, { bucket = "default", maxRequests = 90, windowMs = 60_000 } = {}) {
  const ip = getClientIp(req);
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const timestamps = (RATE_LIMIT_BUCKETS.get(key) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    RATE_LIMIT_BUCKETS.set(key, timestamps);
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - timestamps[0])) / 1000)) };
  }
  timestamps.push(now);
  RATE_LIMIT_BUCKETS.set(key, timestamps);
  if (RATE_LIMIT_BUCKETS.size > 2000) {
    RATE_LIMIT_BUCKETS.clear();
  }
  return { allowed: true, retryAfterSec: 0 };
}

function recordAuthFailure(req, { maxFailures = 8, windowMs = 10 * 60_000 } = {}) {
  const ip = getClientIp(req);
  const now = Date.now();
  const fails = (AUTH_FAIL_BUCKETS.get(ip) || []).filter((t) => now - t < windowMs);
  fails.push(now);
  AUTH_FAIL_BUCKETS.set(ip, fails);
  return fails.length >= maxFailures;
}

function isIpAuthLocked(req, { maxFailures = 8, windowMs = 10 * 60_000 } = {}) {
  const ip = getClientIp(req);
  const now = Date.now();
  const fails = (AUTH_FAIL_BUCKETS.get(ip) || []).filter((t) => now - t < windowMs);
  if (fails.length === 0) {
    AUTH_FAIL_BUCKETS.delete(ip);
    return false;
  }
  AUTH_FAIL_BUCKETS.set(ip, fails);
  return fails.length >= maxFailures;
}

function resetSecurityBuckets() {
  RATE_LIMIT_BUCKETS.clear();
  AUTH_FAIL_BUCKETS.clear();
}

function applySecurityHeaders(res, { isHtml = false } = {}) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (isHtml) {
    // Allow Google OAuth popup flow while isolating opener context & locking down script/connect origins
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "form-action 'self'",
        "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
        "style-src 'self' 'unsafe-inline' https://accounts.google.com",
        "img-src 'self' data: blob: https://*.googleusercontent.com https://accounts.google.com",
        "font-src 'self' data:",
        "frame-src https://accounts.google.com",
        "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://gmail.googleapis.com https://generativelanguage.googleapis.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
      ].join("; "),
    );
  }
}

function redactSecretsInText(value) {
  if (typeof value !== "string" || !value) return "";
  return value
    .replace(/\brpa_ag_[a-f0-9]{16,128}\b/gi, "[REDACTED_WORKBENCH_TOKEN]")
    .replace(/\bAIza[0-9A-Za-z\-_]{20,60}\b/g, "[REDACTED_GOOGLE_KEY]")
    .replace(/\bsk-(?:proj-|live-|test-)?[0-9A-Za-z\-_]{20,120}\b/g, "[REDACTED_OPENAI_KEY]")
    .replace(/\bgh[pousr]_[0-9A-Za-z]{20,80}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_JWT]");
}

function getAllowedOwnerEmails() {
  const envRaw = process.env.WORKBENCH_OWNER_EMAILS || process.env.WORKBENCH_OWNER_EMAIL || "";
  if (envRaw.trim()) {
    return envRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return DEFAULT_OWNER_EMAILS;
}

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
  const secFetchSite = req.headers && (req.headers["sec-fetch-site"] || req.headers["Sec-Fetch-Site"]);
  if (secFetchSite && String(secFetchSite).toLowerCase() === "cross-site") {
    return false;
  }
  if (!origin || !host) return false;
  if (process.env.VERCEL_ENV === "production") {
    return origin === "https://" + host;
  }
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

    // Extra Layer: Enforce owner email allowlist whenever user.email is present
    if (user.email) {
      const allowedEmails = getAllowedOwnerEmails();
      if (!allowedEmails.includes(String(user.email).trim().toLowerCase())) {
        return {
          ok: false,
          status: 403,
          error: "Access denied: email is not authorized for this private workbench.",
        };
      }
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
  if (isIpAuthLocked(req)) {
    return {
      ok: false,
      status: 429,
      error: "Too many failed authentication attempts. Temporarily locked for 10 minutes.",
    };
  }
  const rl = checkRateLimit(req, { bucket: "agent", maxRequests: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s.`,
    };
  }
  const rawToken = extractBearerToken(req);
  if (!rawToken) {
    recordAuthFailure(req);
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
      if (Number(payload && payload.status) === 401) {
        recordAuthFailure(req);
      }
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
      todos: Array.isArray(payload.todos) ? payload.todos : [],
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
    title: redactSecretsInText(getDisplayTitle(idea)),
    date: idea.date,
    monthKey: idea.monthKey,
    platform: idea.platform,
    domain: idea.domain,
    stage: idea.column,
    dueDate: idea.dueDate || null,
    primaryUrl: idea.primaryUrl || null,
    urls: Array.isArray(idea.urls) ? idea.urls.slice(0, 5) : [],
    attachments: Array.isArray(idea.attachments) ? idea.attachments : [],
    summary: redactSecretsInText(idea.aiSummary || idea.snippet || ""),
    notes: redactSecretsInText(idea.notes || ""),
    connectionNote: redactSecretsInText(idea.aiConnectionNote || ""),
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

const DEFAULT_GEMINI_MODEL = "gemini-4-hydrogen";
const STATIC_FALLBACK_GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.5-flash-lite",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3-flash-preview",
  "gemini-4-argon",
];

let cachedDiscoveredModels = { keyHash: "", models: [], fetchedAt: 0 };
let lastHealthyGeminiModel = { keyHash: "", model: "", at: 0 };

function resolveActiveGeminiModel(rawModel) {
  const clean = String(rawModel || "").trim();
  if (!clean || /^gemini-(1\.5|2\.0|2\.5)-/i.test(clean)) {
    return DEFAULT_GEMINI_MODEL;
  }
  return clean;
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scoreDiscoveredGeminiModel(name) {
  const n = name.toLowerCase();
  if (n === "gemini-4-hydrogen") return 100;
  if (n.includes("hydrogen")) return 96;
  // Prioritize fast Flash & Flash-Lite pools ahead of heavyweight reasoning models
  if (n === "gemini-3.8-flash") return 93;
  if (n === "gemini-3.1-flash-lite-preview") return 91;
  if (n === "gemini-3.5-flash-lite") return 90;
  if (n.includes("flash-lite")) return 89;
  if (n === "gemini-3.7-flash") return 86;
  if (n === "gemini-3.6-flash") return 84;
  if (n === "gemini-3-flash-preview") return 82;
  if (n.startsWith("gemini-3") && n.includes("flash")) return 78;
  if (n === "gemini-4-argon") return 72;
  if (n === "gemini-4-neon") return 68;
  if (n === "gemini-4-carbon") return 64;
  if (n.startsWith("gemini-4")) return 60;
  if (n.startsWith("gemini-3")) return 52;
  if (n.includes("flash")) return 40;
  return 20;
}

function extractJsonFromText(raw) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!cleaned) return {};
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstObj = cleaned.indexOf("{");
    const firstArr = cleaned.indexOf("[");
    let start = -1;
    let end = -1;
    if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
      start = firstArr;
      end = cleaned.lastIndexOf("]");
    } else if (firstObj !== -1) {
      start = firstObj;
      end = cleaned.lastIndexOf("}");
    }
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("Gemini returned non-JSON output.");
  }
}

async function discoverLiveGeminiModels(apiKey) {
  const keyHash = sha256Hex(apiKey).slice(0, 16);
  const now = Date.now();
  if (
    cachedDiscoveredModels.keyHash === keyHash &&
    cachedDiscoveredModels.models.length > 0 &&
    now - cachedDiscoveredModels.fetchedAt < 10 * 60_000
  ) {
    return cachedDiscoveredModels.models;
  }
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${encodeURIComponent(apiKey)}`,
      { signal: controller.signal },
    );
    clearTimeout(tid);
    if (!res.ok) return [];
    const data = await res.json();
    const list = (Array.isArray(data.models) ? data.models : [])
      .filter((m) => {
        const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
        if (!methods.includes("generateContent")) return false;
        const id = String(m.name || "").replace(/^models\//, "").toLowerCase();
        if (!id.startsWith("gemini-")) return false;
        if (/(embedding|imagen|veo|lyria|tts|audio|robotics|aqa|vision-only|live|exp-image|image-gen|2\.5|2\.0|1\.5|1\.0)/.test(id)) {
          return false;
        }
        return true;
      })
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .sort((a, b) => scoreDiscoveredGeminiModel(b) - scoreDiscoveredGeminiModel(a));

    cachedDiscoveredModels = { keyHash, models: list, fetchedAt: now };
    return list;
  } catch {
    clearTimeout(tid);
    return [];
  }
}

async function callGeminiGenerateJsonWithMeta(apiKey, model, prompt, responseSchema, options = {}) {
  const keyHash = sha256Hex(apiKey).slice(0, 16);
  const requestedPrimary = resolveActiveGeminiModel(model);
  const now = Date.now();
  const stickyModel =
    lastHealthyGeminiModel.keyHash === keyHash &&
    lastHealthyGeminiModel.model &&
    now - lastHealthyGeminiModel.at < 5 * 60_000
      ? lastHealthyGeminiModel.model
      : null;
  const primaryModel = stickyModel || requestedPrimary;
  const overallDeadline = Date.now() + 52_000;
  const attemptsLog = [];

  const attemptSingleModel = async (targetModel, retries, maxSingleMs) => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      targetModel,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const isThinkingModel = /^gemini-(4|3\.[6-9])/i.test(targetModel) && !/lite/i.test(targetModel);
    // IMPORTANT:
    // 1. On Gemini 4 and Gemini 3.6–3.8 thinking models, default thinkingLevel is HIGH/MEDIUM,
    //    so always set thinkingLevel: "LOW" for fast latency.
    // 2. Never pass a low maxOutputTokens cap (thinking tokens share maxOutputTokens and low caps
    //    can stall or truncate thinking models).
    // 3. Omit strict responseSchema (constrained decoding + thinkingConfig frequently hangs);
    //    keep responseMimeType: "application/json" + explicit prompt schema + extractJsonFromText.
    const generationConfig = {
      responseMimeType: "application/json",
      temperature: 0.2,
      ...(isThinkingModel ? { thinkingConfig: { thinkingLevel: "LOW" } } : {}),
    };

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const remaining = overallDeadline - Date.now();
      if (remaining < 4000) {
        return { ok: false, fatal: false, error: `Server time budget reached before ${targetModel}` };
      }
      const perAttemptMs = Math.min(maxSingleMs, remaining - 1500);
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), perAttemptMs);
      let res;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig,
          }),
        });
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
        const isAbort = fetchErr && (fetchErr.name === "AbortError" || /abort/i.test(String(fetchErr.message || "")));
        const tag = isAbort ? `timeout(${elapsedSec}s)` : `net(${fetchErr instanceof Error ? fetchErr.message.slice(0, 40) : "err"})`;
        attemptsLog.push(`${targetModel}:${tag}`);
        if (attempt < retries) {
          await sleepMs(400);
          continue;
        }
        return { ok: false, fatal: false, error: `${tag} on ${targetModel}` };
      }
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const parts = Array.isArray(data?.candidates?.[0]?.content?.parts)
          ? data.candidates[0].content.parts
          : [];
        const answerPart = [...parts].reverse().find((p) => p && !p.thought && typeof p.text === "string" && p.text.trim());
        const rawText = answerPart?.text || parts[0]?.text || "";
        if (!rawText.trim()) {
          attemptsLog.push(`${targetModel}:empty`);
          return { ok: false, fatal: false, error: `Empty response from ${targetModel}` };
        }
        try {
          const parsed = extractJsonFromText(rawText);
          lastHealthyGeminiModel = { keyHash, model: targetModel, at: Date.now() };
          return { ok: true, value: parsed, usedModel: targetModel };
        } catch (parseErr) {
          attemptsLog.push(`${targetModel}:bad_json`);
          return {
            ok: false,
            fatal: false,
            error: `Invalid JSON from ${targetModel}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          };
        }
      }

      const errBody = (await res.text()).slice(0, 260);
      attemptsLog.push(`${targetModel}:${res.status}`);
      const errorMsg = `Gemini API HTTP ${res.status} (${targetModel}): ${errBody}`;

      if (res.status === 503 || res.status === 429 || res.status === 500 || res.status === 502) {
        if (attempt < retries) {
          await sleepMs(500);
          continue;
        }
        return { ok: false, fatal: false, error: errorMsg };
      }
      if (res.status === 404 || res.status === 400) {
        return { ok: false, fatal: false, error: errorMsg };
      }
      return { ok: false, fatal: true, error: errorMsg };
    }
    return { ok: false, fatal: false, error: `Failed on ${targetModel}` };
  };

  // 1. Try primary (gemini-4-hydrogen) with a 22s window (LOW thinking, no schema hang, no token cap)
  const first = await attemptSingleModel(primaryModel, 1, 22_000);
  if (first.ok) return { value: first.value, usedModel: first.usedModel };
  if (first.fatal) throw new Error(first.error);

  // 2. Discover live models enabled on this API key & walk fast Flash/Flash-Lite pools
  const discovered = await discoverLiveGeminiModels(apiKey);
  const candidates = Array.from(
    new Set(
      [requestedPrimary, ...discovered, ...STATIC_FALLBACK_GEMINI_MODELS].filter(
        (m) => m && m !== primaryModel,
      ),
    ),
  )
    .sort((a, b) => scoreDiscoveredGeminiModel(b) - scoreDiscoveredGeminiModel(a))
    .slice(0, 6);

  let lastError = first.error;
  for (const candidate of candidates) {
    const budgetMs = /lite/i.test(candidate) ? 9_000 : 11_000;
    const res = await attemptSingleModel(candidate, 1, budgetMs);
    if (res.ok) return { value: res.value, usedModel: res.usedModel };
    if (res.fatal) throw new Error(res.error);
    lastError = res.error;
  }

  throw new Error(
    `All available Gemini models returned temporary errors [${attemptsLog.join(", ")}]. Last: ${lastError}`,
  );
}

async function callGeminiGenerateJson(apiKey, model, prompt, responseSchema, options = {}) {
  const { value } = await callGeminiGenerateJsonWithMeta(apiKey, model, prompt, responseSchema, options);
  return value;
}

async function classifyIdeaWithServerDecisionModel({
  apiKey,
  title,
  content,
  url,
  existingCategories = [],
  decisionModel = "gemini-decision-1",
  flashModel = DEFAULT_GEMINI_MODEL,
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

async function callAgentSecondBrainRpc(rpcName, payload) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return { ok: false, status: 503, error: "Supabase backend not configured." };
  }
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${rpcName}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status === 404 ? 501 : 503,
        error:
          res.status === 404
            ? "Second-brain Supabase tables not initialized yet. Run supabase/workbench_second_brain.sql."
            : `Second-brain RPC ${rpcName} failed (HTTP ${res.status}).`,
      };
    }
    return await res.json();
  } catch (_) {
    return { ok: false, status: 503, error: `Second-brain RPC ${rpcName} unreachable.` };
  }
}

async function loadSecondBrainWithAgentToken(tokenHash, requiredScope = "read:ideas") {
  const res = await callAgentSecondBrainRpc("agent_get_second_brain", {
    p_token_hash: tokenHash,
    p_required_scope: requiredScope,
  });
  if (!res || res.ok !== true) {
    return {
      ok: false,
      tablesMissing: res && res.status === 501,
      status: (res && res.status) || 503,
      error: (res && res.error) || "Second-brain store unavailable.",
      rules: [],
      wikiPages: [],
      handoffs: [],
    };
  }
  return {
    ok: true,
    tablesMissing: false,
    rules: Array.isArray(res.rules) ? res.rules : [],
    wikiPages: Array.isArray(res.wiki_pages) ? res.wiki_pages : [],
    handoffs: Array.isArray(res.handoffs) ? res.handoffs : [],
  };
}

function createHandoffWithAgentToken(tokenHash, handoff) {
  return callAgentSecondBrainRpc("agent_create_handoff", {
    p_token_hash: tokenHash,
    p_handoff: handoff,
  });
}

function claimHandoffWithAgentToken(tokenHash, handoffId, claimer) {
  return callAgentSecondBrainRpc("agent_claim_handoff", {
    p_token_hash: tokenHash,
    p_handoff_id: handoffId,
    p_claimer: claimer || null,
  });
}

function rememberRuleWithAgentToken(tokenHash, rule) {
  return callAgentSecondBrainRpc("agent_remember_rule", {
    p_token_hash: tokenHash,
    p_rule: rule,
  });
}

function upsertWikiPageWithAgentToken(tokenHash, page) {
  return callAgentSecondBrainRpc("agent_upsert_wiki_page", {
    p_token_hash: tokenHash,
    p_page: page,
  });
}

function saveTodosWithAgentToken(tokenHash, todos) {
  return callAgentSecondBrainRpc("agent_save_todos", {
    p_token_hash: tokenHash,
    p_todos: todos,
  });
}

function buildCalendarDeadlinesFeed({ todos = [], ideas = [], projects = [] }) {
  const events = [];
  for (const t of todos) {
    if (!t || !t.dueDate) continue;
    events.push({
      id: `todo:${t.id}`,
      kind: "todo",
      date: String(t.dueDate).slice(0, 10),
      title: t.title,
      domain: t.domain || "Uncategorized",
      status: t.status || "open",
      priority: t.priority || "medium",
      rankScore: Number(t.rankScore || 50),
    });
  }
  for (const p of projects) {
    if (!p || !p.dueDate) continue;
    events.push({
      id: `project:${p.id}`,
      kind: "project",
      date: String(p.dueDate).slice(0, 10),
      title: p.title,
      domain: p.domain || "Uncategorized",
      status: "open",
      priority: Number(p.priorityScore || 50) >= 75 ? "high" : "medium",
    });
  }
  for (const i of ideas) {
    if (!i || i.isSelfSent === false || !i.dueDate) continue;
    events.push({
      id: `idea:${i.id}`,
      kind: "idea",
      date: String(i.dueDate).slice(0, 10),
      title: getDisplayTitle(i),
      domain: i.domain || "Uncategorized",
      status: i.column === "processed_archived" ? "done" : i.column === "in_progress" ? "in_progress" : "open",
      priority: i.isStarred ? "high" : "medium",
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return events;
}

function tokenizeQuery(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 2);
}

/**
 * GBrain-inspired hybrid Reciprocal Rank Fusion (RRF) search combining
 * exact phrase match, BM25-style token overlap, recency, and access-weighted retention.
 */
function hybridRankIdeas(ideas, query, limit = 20) {
  const qRaw = String(query || "").trim().toLowerCase();
  const terms = tokenizeQuery(qRaw);
  const nowMs = Date.now();

  if (terms.length === 0) {
    return [...ideas]
      .sort((a, b) => {
        const rankDiff = (Number(b.dailyRankScore) || 0) - (Number(a.dailyRankScore) || 0);
        if (rankDiff !== 0) return rankDiff;
        return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
      })
      .slice(0, limit);
  }

  const scored = [];
  for (const item of ideas) {
    const title = getDisplayTitle(item).toLowerCase();
    const domain = String(item.domain || "").toLowerCase();
    const labels = (Array.isArray(item.gmailLabels) ? item.gmailLabels : []).join(" ").toLowerCase();
    const tags = (Array.isArray(item.aiTags) ? item.aiTags : []).join(" ").toLowerCase();
    const body = [item.snippet, item.notes, item.aiSummary, ...(item.urls || [])]
      .join(" ")
      .toLowerCase();

    let lexicalScore = 0;
    if (title.includes(qRaw)) lexicalScore += 14;
    if (domain.includes(qRaw) || labels.includes(qRaw)) lexicalScore += 10;
    if (body.includes(qRaw)) lexicalScore += 6;

    let matchedTerms = 0;
    for (const term of terms) {
      let hit = false;
      if (title.includes(term)) {
        lexicalScore += 5;
        hit = true;
      }
      if (domain.includes(term) || labels.includes(term) || tags.includes(term)) {
        lexicalScore += 4;
        hit = true;
      }
      if (body.includes(term)) {
        lexicalScore += 2;
        hit = true;
      }
      if (hit) matchedTerms += 1;
    }

    if (lexicalScore <= 0) continue;

    const coverageBonus = (matchedTerms / terms.length) * 6;
    const ageDays = Math.max(0, (nowMs - (Date.parse(item.date) || nowMs)) / 86400000);
    const recencyBoost = Math.max(0, 4 - ageDays / 30);
    const accessBoost = Math.min(4, Math.log1p(Number(item.accessCount) || 0) * 1.6);
    const priorityBoost = ((Number(item.dailyRankScore) || 50) / 100) * 3;
    const totalScore = lexicalScore + coverageBonus + recencyBoost + accessBoost + priorityBoost;

    scored.push({ item, score: totalScore });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.item);
}

function toSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildContextPack({ query, projectSlug, ideas, projects, todos = [], rules, wikiPages, handoffs }) {
  const activeRules = (rules || []).filter((r) => r.status !== "retired");
  const profileRules = activeRules.filter((r) => r.kind === "profile");
  const routingRules = activeRules.filter((r) => r.kind !== "profile" && r.status === "confirmed");

  const slugFilter = toSlug(projectSlug);
  const openHandoffs = (handoffs || []).filter(
    (h) => h.status === "open" && (!slugFilter || toSlug(h.project_slug).includes(slugFilter)),
  );

  const matchingWiki = (wikiPages || [])
    .filter((w) => {
      if (slugFilter && !toSlug(w.slug).includes(slugFilter) && !toSlug(w.domain).includes(slugFilter)) {
        return false;
      }
      if (query) {
        const hay = `${w.title} ${w.domain} ${w.compiled_truth_md}`.toLowerCase();
        return tokenizeQuery(query).some((t) => hay.includes(t));
      }
      return true;
    })
    .slice(0, 6)
    .map((w) => ({
      slug: w.slug,
      title: w.title,
      domain: w.domain,
      compiledTruth: w.compiled_truth_md,
      lastVerifiedAt: w.last_verified_at || null,
      contradictions: Array.isArray(w.contradictions) ? w.contradictions : [],
    }));

  const selfIdeas = (ideas || []).filter((i) => i.isSelfSent !== false);
  const topIdeas = hybridRankIdeas(
    slugFilter
      ? selfIdeas.filter((i) => toSlug(i.domain).includes(slugFilter))
      : selfIdeas,
    query || "",
    12,
  ).map(sanitizeIdeaForAgent);

  const relevantProjects = (projects || [])
    .filter((p) => !slugFilter || toSlug(p.title).includes(slugFilter) || toSlug(p.domain).includes(slugFilter))
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      title: p.title,
      domain: p.domain,
      effortTier: p.effortTier,
      priorityScore: p.priorityScore,
      objective: p.objective,
      mvpScope: p.mvpScope,
      linkedCount: Array.isArray(p.ideaIds) ? p.ideaIds.length : 0,
    }));

  const upcomingDeadlines = buildCalendarDeadlinesFeed({
    todos,
    ideas: selfIdeas,
    projects,
  })
    .filter((e) => !slugFilter || toSlug(e.domain).includes(slugFilter))
    .slice(0, 15);

  const activeTodos = (todos || [])
    .filter((t) => t && t.status !== "done" && (!slugFilter || toSlug(t.domain).includes(slugFilter)))
    .sort((a, b) => (Number(b.rankScore) || 50) - (Number(a.rankScore) || 50))
    .slice(0, 15);

  return {
    owner: "Roderick Perez Altamar",
    canonicalProjects: DEFAULT_CATEGORIES,
    profile: profileRules.map((r) => ({ title: r.title, rule: r.rule_text, locked: Boolean(r.human_locked) })),
    confirmedRules: routingRules.slice(0, 20).map((r) => ({
      id: r.id,
      title: r.title,
      rule: r.rule_text,
      pattern: r.pattern || null,
      targetDomain: r.target_domain || null,
      confidence: Number(r.confidence || 0.8),
      humanLocked: Boolean(r.human_locked),
    })),
    openHandoffs: openHandoffs.slice(0, 8),
    wikiPages: matchingWiki,
    projects: relevantProjects,
    activeTodos,
    upcomingDeadlines,
    topIdeas,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  ALLOWED_SCOPES,
  DEFAULT_CATEGORIES,
  SOURCE_PLATFORMS,
  sha256Hex,
  applySecurityHeaders,
  checkRateLimit,
  isIpAuthLocked,
  recordAuthFailure,
  resetSecurityBuckets,
  redactSecretsInText,
  getAllowedOwnerEmails,
  isSameOriginMutation,
  verifyOwnerFromCookie,
  extractBearerToken,
  verifyAgentTokenAndLoad,
  appendIdeaWithAgentToken,
  loadSecondBrainWithAgentToken,
  createHandoffWithAgentToken,
  claimHandoffWithAgentToken,
  rememberRuleWithAgentToken,
  upsertWikiPageWithAgentToken,
  saveTodosWithAgentToken,
  buildCalendarDeadlinesFeed,
  hybridRankIdeas,
  buildContextPack,
  getDisplayTitle,
  sanitizeIdeaForAgent,
  buildKnowledgeGraphSummary,
  callGeminiGenerateJson,
  callGeminiGenerateJsonWithMeta,
  classifyIdeaWithServerDecisionModel,
};
