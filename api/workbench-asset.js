const fs = require("fs");
const path = require("path");
const { applySecurityHeaders, getAllowedOwnerEmails } = require("./_workbench-lib");

const DIST_ROOT = path.resolve(__dirname, "..", "private-workbench-dist");

const MIME_TYPES = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
  woff2: "font/woff2",
};

function readSessionToken(cookieHeader) {
  return (cookieHeader || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("__Host-course_session="))
    ?.slice("__Host-course_session=".length);
}

/**
 * Owner-only asset gateway for RPA! Workbench (/private-workbench/*).
 * Verifies BOTH:
 *   1. Valid Supabase JWT from HttpOnly __Host-course_session cookie
 *   2. Membership in public.course_owners (strictly owner-only, NOT invited course learners)
 */
module.exports = async function (req, res) {
  const rawPathPreview =
    typeof req.query?.path === "string" && req.query.path.trim()
      ? req.query.path.trim()
      : "index.html";
  const isHtmlPreview =
    rawPathPreview === "index.html" ||
    rawPathPreview.endsWith(".html") ||
    !rawPathPreview.split("/").filter(Boolean).slice(-1)[0]?.includes(".");
  applySecurityHeaders(res, { isHtml: isHtmlPreview });

  if (req.query && req.query.deny === "1") {
    return res.status(403).send("Forbidden.");
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).end();
  }

  const rawPath =
    typeof req.query.path === "string" && req.query.path.trim()
      ? req.query.path.trim()
      : "index.html";
  const segments = rawPath.split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some(
      (s) => s === "." || s === ".." || s.includes("\\") || /[\x00-\x1f]/.test(s),
    )
  ) {
    return res.status(400).send("Invalid path.");
  }

  const isHtmlRequest =
    rawPath === "index.html" ||
    rawPath.endsWith(".html") ||
    !segments[segments.length - 1].includes(".");

  const token = readSessionToken(req.headers.cookie);
  if (!token || !/^[A-Za-z0-9_.-]+$/.test(token)) {
    if (isHtmlRequest) {
      return res.redirect(302, "/?workbench=signin");
    }
    return res.status(401).send("Owner authentication required.");
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return res.status(503).send("Authentication service unavailable.");
  }

  try {
    const authHeaders = {
      apikey: key,
      Authorization: "Bearer " + token,
    };

    // Step 1: Verify JWT with Supabase Auth
    const userRes = await fetch(url + "/auth/v1/user", { headers: authHeaders });
    if (!userRes.ok) {
      if (isHtmlRequest) return res.redirect(302, "/?workbench=expired");
      return res.status(401).send("Session expired. Sign in on roderickperezaltamar.com.");
    }
    const user = await userRes.json();
    if (!user || typeof user.id !== "string") {
      return res.status(401).send("Invalid session.");
    }

    // Step 1b: Enforce owner email allowlist whenever user.email is present
    if (user.email) {
      const allowedEmails = getAllowedOwnerEmails();
      if (!allowedEmails.includes(String(user.email).trim().toLowerCase())) {
        return res.status(403).send("Access denied: strictly private to the site owner.");
      }
    }

    // Step 2: Strictly enforce public.course_owners membership (ONLY Roderick!)
    const ownerRes = await fetch(
      `${url}/rest/v1/course_owners?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`,
      {
        headers: {
          ...authHeaders,
          Accept: "application/json",
        },
      },
    );
    if (!ownerRes.ok) {
      return res.status(403).send("Owner authorization check failed.");
    }
    const owners = await ownerRes.json();
    if (!Array.isArray(owners) || owners.length === 0) {
      return res.status(403).send("Access denied: this workbench is strictly private to the site owner.");
    }

    // Step 3: Resolve requested file safely inside private-workbench-dist
    let targetFile = path.resolve(DIST_ROOT, ...segments);
    if (!targetFile.startsWith(DIST_ROOT + path.sep) && targetFile !== DIST_ROOT) {
      return res.status(400).send("Invalid path.");
    }

    if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
      if (!segments[segments.length - 1].includes(".")) {
        targetFile = path.resolve(DIST_ROOT, "index.html");
      } else {
        return res.status(404).send("Asset not found.");
      }
    }

    if (!fs.existsSync(targetFile)) {
      return res.status(404).send("Workbench build not deployed yet.");
    }

    const ext = path.extname(targetFile).slice(1).toLowerCase();
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    if (req.method === "HEAD") {
      return res.status(200).end();
    }

    const content = fs.readFileSync(targetFile);
    return res.status(200).send(content);
  } catch (_) {
    return res.status(503).send("Could not verify owner session.");
  }
};
