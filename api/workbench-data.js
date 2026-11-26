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
    // GET: Load cloud snapshot + agent tokens + optional second-brain tables (rules, wiki, handoffs)
    if (req.method === "GET") {
      const [snapResWithTodos, tokRes, rulesRes, wikiRes, handoffsRes] = await Promise.all([
        fetch(
          `${url}/rest/v1/workbench_snapshots?select=ideas,projects,digests,todos,custom_categories,updated_at&owner_id=eq.${encodeURIComponent(userId)}`,
          { headers: { ...headers, Accept: "application/json" } },
        ),
        fetch(
          `${url}/rest/v1/workbench_agent_tokens?select=id,label,token_prefix,scopes,created_at,last_used_at,expires_at,revoked_at&owner_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
          { headers: { ...headers, Accept: "application/json" } },
        ),
        fetch(
          `${url}/rest/v1/workbench_memory_rules?select=*&owner_id=eq.${encodeURIComponent(userId)}&order=human_locked.desc,confidence.desc,updated_at.desc`,
          { headers: { ...headers, Accept: "application/json" } },
        ).catch(() => null),
        fetch(
          `${url}/rest/v1/workbench_wiki_pages?select=*&owner_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc`,
          { headers: { ...headers, Accept: "application/json" } },
        ).catch(() => null),
        fetch(
          `${url}/rest/v1/workbench_handoffs?select=*&owner_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=40`,
          { headers: { ...headers, Accept: "application/json" } },
        ).catch(() => null),
      ]);

      // Fallback cleanly if todos column hasn't been added via workbench_todos.sql yet
      let snapRes = snapResWithTodos;
      if (!snapRes.ok) {
        snapRes = await fetch(
          `${url}/rest/v1/workbench_snapshots?select=ideas,projects,digests,custom_categories,updated_at&owner_id=eq.${encodeURIComponent(userId)}`,
          { headers: { ...headers, Accept: "application/json" } },
        );
      }

      if (!snapRes.ok || !tokRes.ok) {
        return res.status(503).json({
          error: "Workbench Supabase tables not initialized yet. Run supabase/workbench.sql first.",
        });
      }

      const snaps = await snapRes.json();
      const tokens = await tokRes.json();
      const row = Array.isArray(snaps) && snaps.length > 0 ? snaps[0] : null;
      const secondBrainTablesReady = Boolean(
        rulesRes && rulesRes.ok && wikiRes && wikiRes.ok && handoffsRes && handoffsRes.ok,
      );
      const memoryRules = rulesRes && rulesRes.ok ? await rulesRes.json() : [];
      const wikiPages = wikiRes && wikiRes.ok ? await wikiRes.json() : [];
      const handoffs = handoffsRes && handoffsRes.ok ? await handoffsRes.json() : [];

      return res.status(200).json({
        ok: true,
        aiProxyConfigured: Boolean(process.env.GEMINI_API_KEY),
        secondBrainTablesReady,
        snapshot: row
          ? {
              ideas: Array.isArray(row.ideas) ? row.ideas : [],
              projects: Array.isArray(row.projects) ? row.projects : [],
              digests: Array.isArray(row.digests) ? row.digests : [],
              todos: Array.isArray(row.todos) ? row.todos : [],
              customCategories: Array.isArray(row.custom_categories) ? row.custom_categories : [],
              updatedAt: row.updated_at || new Date().toISOString(),
            }
          : null,
        tokens: Array.isArray(tokens) ? tokens : [],
        secondBrain: {
          rules: Array.isArray(memoryRules) ? memoryRules : [],
          wikiPages: Array.isArray(wikiPages) ? wikiPages : [],
          handoffs: Array.isArray(handoffs) ? handoffs : [],
        },
      });
    }

    // PUT: Save cloud snapshot (+ optional todos & secondBrain rules/wiki/handoffs sync)
    if (req.method === "PUT") {
      const body = req.body || {};
      const nowIso = new Date().toISOString();
      const basePayload = {
        owner_id: userId,
        ideas: Array.isArray(body.ideas) ? body.ideas : [],
        projects: Array.isArray(body.projects) ? body.projects : [],
        digests: Array.isArray(body.digests) ? body.digests.slice(0, 25) : [],
        custom_categories: Array.isArray(body.customCategories) ? body.customCategories : [],
        updated_at: nowIso,
      };
      const payloadWithTodos = {
        ...basePayload,
        todos: Array.isArray(body.todos) ? body.todos.slice(0, 200) : [],
      };

      let upsertRes = await fetch(`${url}/rest/v1/workbench_snapshots?on_conflict=owner_id`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(payloadWithTodos),
      });

      // Fallback cleanly if todos column hasn't been added yet
      if (!upsertRes.ok) {
        upsertRes = await fetch(`${url}/rest/v1/workbench_snapshots?on_conflict=owner_id`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(basePayload),
        });
      }

      if (!upsertRes.ok) {
        return res.status(502).json({ error: "Failed to save workbench snapshot to Supabase." });
      }
      const payload = basePayload;

      // Best-effort sync of second-brain tables (succeeds once supabase/workbench_second_brain.sql is run)
      const secondBrain = body.secondBrain || null;
      if (secondBrain && typeof secondBrain === "object") {
        const upsertHeaders = {
          ...headers,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        };
        const tasks = [];
        if (Array.isArray(secondBrain.rules) && secondBrain.rules.length > 0) {
          const ruleRows = secondBrain.rules.slice(0, 120).map((r) => ({
            id: String(r.id),
            owner_id: userId,
            kind: r.kind || "routing_rule",
            title: String(r.title || "Rule").slice(0, 120),
            rule_text: String(r.ruleText || r.rule_text || ""),
            pattern: r.pattern || null,
            target_domain: r.targetDomain || r.target_domain || null,
            confidence: Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : 0.75,
            evidence_count: Number(r.evidenceCount ?? r.evidence_count ?? 1),
            applied_count: Number(r.appliedCount ?? r.applied_count ?? 0),
            source: r.source || "human",
            agent_name: r.agentName || r.agent_name || null,
            status: r.status || "confirmed",
            human_locked: Boolean(r.humanLocked ?? r.human_locked),
            last_verified_at: r.lastVerifiedAt || r.last_verified_at || nowIso,
            updated_at: nowIso,
          }));
          tasks.push(
            fetch(`${url}/rest/v1/workbench_memory_rules?on_conflict=id`, {
              method: "POST",
              headers: upsertHeaders,
              body: JSON.stringify(ruleRows),
            }).catch(() => null),
          );
        }
        if (Array.isArray(secondBrain.wikiPages) && secondBrain.wikiPages.length > 0) {
          const wikiRows = secondBrain.wikiPages.slice(0, 60).map((w) => ({
            id: String(w.id || `wiki_${w.slug}`),
            owner_id: userId,
            slug: String(w.slug),
            title: String(w.title || w.slug),
            page_type: w.pageType || w.page_type || "project",
            domain: String(w.domain || "Uncategorized"),
            compiled_truth_md: String(w.compiledTruthMd ?? w.compiled_truth_md ?? ""),
            timeline_entries: Array.isArray(w.timelineEntries ?? w.timeline_entries)
              ? (w.timelineEntries ?? w.timeline_entries).slice(0, 40)
              : [],
            contradictions: Array.isArray(w.contradictions) ? w.contradictions.slice(0, 15) : [],
            source_idea_ids: Array.isArray(w.sourceIdeaIds ?? w.source_idea_ids)
              ? (w.sourceIdeaIds ?? w.source_idea_ids).slice(0, 80)
              : [],
            version_history: Array.isArray(w.versionHistory ?? w.version_history)
              ? (w.versionHistory ?? w.version_history).slice(0, 10)
              : [],
            confidence: Number.isFinite(Number(w.confidence)) ? Number(w.confidence) : 0.8,
            last_verified_at: w.lastVerifiedAt || w.last_verified_at || nowIso,
            updated_at: nowIso,
          }));
          tasks.push(
            fetch(`${url}/rest/v1/workbench_wiki_pages?on_conflict=id`, {
              method: "POST",
              headers: upsertHeaders,
              body: JSON.stringify(wikiRows),
            }).catch(() => null),
          );
        }
        if (Array.isArray(secondBrain.handoffs) && secondBrain.handoffs.length > 0) {
          const handoffRows = secondBrain.handoffs.slice(0, 40).map((h) => ({
            id: String(h.id),
            owner_id: userId,
            project_slug: String(h.projectSlug || h.project_slug || "general"),
            title: String(h.title || "Handoff"),
            from_agent: String(h.fromAgent || h.from_agent || "owner"),
            status: h.status || "open",
            claimed_by: h.claimedBy || h.claimed_by || null,
            claimed_at: h.claimedAt || h.claimed_at || null,
            summary: String(h.summary || ""),
            what_worked: Array.isArray(h.whatWorked ?? h.what_worked) ? (h.whatWorked ?? h.what_worked) : [],
            what_failed: Array.isArray(h.whatFailed ?? h.what_failed) ? (h.whatFailed ?? h.what_failed) : [],
            open_questions: Array.isArray(h.openQuestions ?? h.open_questions)
              ? (h.openQuestions ?? h.open_questions)
              : [],
            relevant_files: Array.isArray(h.relevantFiles ?? h.relevant_files)
              ? (h.relevantFiles ?? h.relevant_files)
              : [],
            next_step: String(h.nextStep ?? h.next_step ?? ""),
            updated_at: nowIso,
          }));
          tasks.push(
            fetch(`${url}/rest/v1/workbench_handoffs?on_conflict=id`, {
              method: "POST",
              headers: upsertHeaders,
              body: JSON.stringify(handoffRows),
            }).catch(() => null),
          );
        }
        if (tasks.length > 0) {
          await Promise.allSettled(tasks);
        }
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
