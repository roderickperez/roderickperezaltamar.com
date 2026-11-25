const crypto = require("crypto");
const {
  ALLOWED_SCOPES,
  isSameOriginMutation,
  sha256Hex,
  verifyOwnerFromCookie,
} = require("./_workbench-lib");

module.exports = async function (req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  const owner = await verifyOwnerFromCookie(req);
  if (!owner.ok) {
    return res.status(owner.status).json({ error: owner.error });
  }

  const { url, userId, headers } = owner;

  if (req.method !== "GET" && !isSameOriginMutation(req)) {
    return res.status(403).json({ error: "Cross-origin mutation denied." });
  }

  try {
    // GET: Load cloud snapshot + list owner's agent tokens (never raw hashes!)
    if (req.method === "GET") {
      const [snapRes, tokRes] = await Promise.all([
        fetch(
          `${url}/rest/v1/workbench_snapshots?select=ideas,projects,digests,custom_categories,updated_at&owner_id=eq.${encodeURIComponent(userId)}`,
          { headers: { ...headers, Accept: "application/json" } },
        ),
        fetch(
          `${url}/rest/v1/workbench_agent_tokens?select=id,label,token_prefix,scopes,created_at,last_used_at,expires_at,revoked_at&owner_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
          { headers: { ...headers, Accept: "application/json" } },
        ),
      ]);

      if (!snapRes.ok || !tokRes.ok) {
        return res.status(503).json({
          error: "Workbench Supabase tables not initialized yet. Run supabase/workbench.sql first.",
        });
      }

      const snaps = await snapRes.json();
      const tokens = await tokRes.json();
      const row = Array.isArray(snaps) && snaps.length > 0 ? snaps[0] : null;

      return res.status(200).json({
        ok: true,
        aiProxyConfigured: Boolean(process.env.GEMINI_API_KEY),
        snapshot: row
          ? {
              ideas: Array.isArray(row.ideas) ? row.ideas : [],
              projects: Array.isArray(row.projects) ? row.projects : [],
              digests: Array.isArray(row.digests) ? row.digests : [],
              customCategories: Array.isArray(row.custom_categories) ? row.custom_categories : [],
              updatedAt: row.updated_at || new Date().toISOString(),
            }
          : null,
        tokens: Array.isArray(tokens) ? tokens : [],
      });
    }

    // PUT: Save cloud snapshot (ideas, projects, digests, customCategories)
    if (req.method === "PUT") {
      const body = req.body || {};
      const payload = {
        owner_id: userId,
        ideas: Array.isArray(body.ideas) ? body.ideas : [],
        projects: Array.isArray(body.projects) ? body.projects : [],
        digests: Array.isArray(body.digests) ? body.digests.slice(0, 25) : [],
        custom_categories: Array.isArray(body.customCategories) ? body.customCategories : [],
        updated_at: new Date().toISOString(),
      };

      const upsertRes = await fetch(`${url}/rest/v1/workbench_snapshots?on_conflict=owner_id`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(payload),
      });

      if (!upsertRes.ok) {
        return res.status(502).json({ error: "Failed to save workbench snapshot to Supabase." });
      }
      return res.status(200).json({ ok: true, updatedAt: payload.updated_at });
    }

    // POST: Mint a new scoped agent Bearer token (returns plaintext ONCE; stores only SHA-256 hash)
    if (req.method === "POST") {
      const body = req.body || {};
      const label = String(body.label || "").trim().slice(0, 80);
      if (!label) {
        return res.status(400).json({ error: "Token label is required." });
      }
      const rawScopes = Array.isArray(body.scopes) ? body.scopes : ["read:ideas", "read:projects", "read:graph"];
      const scopes = rawScopes.filter((s) => ALLOWED_SCOPES.includes(s));
      if (scopes.length === 0) {
        return res.status(400).json({ error: "Select at least one valid scope." });
      }

      const expiresInDays = Number(body.expiresInDays || 0);
      const expiresAt =
        expiresInDays > 0 && expiresInDays <= 3650
          ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
          : null;

      const rawToken = "rpa_ag_" + crypto.randomBytes(32).toString("hex");
      const tokenHash = sha256Hex(rawToken);
      const tokenPrefix = rawToken.slice(0, 15) + "…";

      const insertRes = await fetch(`${url}/rest/v1/workbench_agent_tokens`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          owner_id: userId,
          label,
          token_prefix: tokenPrefix,
          token_hash: tokenHash,
          scopes,
          expires_at: expiresAt,
        }),
      });

      if (!insertRes.ok) {
        return res.status(502).json({ error: "Failed to mint agent token." });
      }
      const rows = await insertRes.json();
      const created = Array.isArray(rows) ? rows[0] : rows;

      return res.status(201).json({
        ok: true,
        token: rawToken, // Returned ONCE only!
        record: {
          id: created.id,
          label: created.label,
          token_prefix: created.token_prefix,
          scopes: created.scopes,
          created_at: created.created_at,
          last_used_at: created.last_used_at || null,
          expires_at: created.expires_at || null,
          revoked_at: created.revoked_at || null,
        },
      });
    }

    // DELETE: Revoke an agent token immediately by ?tokenId=<uuid>
    if (req.method === "DELETE") {
      const tokenId = typeof req.query.tokenId === "string" ? req.query.tokenId.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(tokenId)) {
        return res.status(400).json({ error: "Valid tokenId UUID is required." });
      }

      const revokeRes = await fetch(
        `${url}/rest/v1/workbench_agent_tokens?id=eq.${encodeURIComponent(tokenId)}&owner_id=eq.${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ revoked_at: new Date().toISOString() }),
        },
      );
      if (!revokeRes.ok) {
        return res.status(502).json({ error: "Failed to revoke agent token." });
      }
      return res.status(200).json({ ok: true, revokedId: tokenId });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Workbench cloud operation failed.",
    });
  }
};
