module.exports = async function (req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();
  const path = typeof req.query.path === "string" ? req.query.path : "";
  const segments = path.split("/");
  const courses = ["python-renewable","eage-python-course","fault-segmentation","energy-decision-ai"];
  if (!courses.includes(segments[0]) || segments.length < 2 || segments.some(s => !s || s === "." || s === ".." || s.includes("\\") || /[\x00-\x1f]/.test(s))) return res.status(400).end();
  const token = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("__Host-course_session="))?.slice("__Host-course_session=".length);
  if (!token || !/^[A-Za-z0-9_.-]+$/.test(token)) return res.status(401).send("Please return to the course page and sign in.");
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return res.status(503).end();
  try {
    const headers = { apikey: key, Authorization: "Bearer " + token };
    const prefix = url + "/storage/v1/object/authenticated/private-courses/";
    const pointer = await fetch(prefix + encodeURIComponent(segments[0]) + "/current.json", { headers });
    let objectSegments = segments;
    if (pointer.ok) {
      const manifest = await pointer.json();
      const requested = segments.slice(1).join("/");
      const digest = manifest?.version === 1 && manifest?.files?.[requested];
      if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) return res.status(404).send("Course file not found.");
      objectSegments = [segments[0], "objects", digest];
    } else {
      let body = {};
      try { body = await pointer.json(); } catch (_) {}
      if (pointer.status !== 404 && !(pointer.status === 400 && String(body.statusCode) === "404")) {
        return res.status(403).send("Course file unavailable or access denied.");
      }
    }
    const target = prefix + objectSegments.map(encodeURIComponent).join("/");
    const response = await fetch(target, { headers });
    if (!response.ok) return res.status(response.status === 404 ? 404 : 403).send("Course file unavailable or access denied.");
    const size = Number(response.headers.get("content-length") || 0);
    if (size > 4 * 1024 * 1024) {
      const signed = await fetch(url + "/storage/v1/object/sign/private-courses/" + objectSegments.map(encodeURIComponent).join("/"), {
        method: "POST",
        headers: { apikey: key, Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 60 })
      });
      if (!signed.ok) return res.status(403).send("Course file unavailable or access denied.");
      const data = await signed.json();
      if (typeof data.signedURL !== "string" || !data.signedURL.startsWith("/object/sign/private-courses/")) return res.status(502).end();
      res.setHeader("Referrer-Policy", "no-referrer");
      return res.redirect(302, url + "/storage/v1" + data.signedURL);
    }
    const extension = segments[segments.length - 1].split(".").pop().toLowerCase();
    const types = {html:"text/html; charset=utf-8", js:"text/javascript; charset=utf-8", mjs:"text/javascript; charset=utf-8", css:"text/css; charset=utf-8", json:"application/json; charset=utf-8", svg:"image/svg+xml", jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", csv:"text/csv; charset=utf-8", pdf:"application/pdf", wasm:"application/wasm", ipynb:"application/json; charset=utf-8"};
    res.setHeader("Content-Type", types[extension] || response.headers.get("content-type") || "application/octet-stream");
    if (req.method === "HEAD") return res.status(200).end();
    let content = Buffer.from(await response.arrayBuffer());
    if (path === "eage-python-course/app.js") {
      const source = content.toString("utf8")
        .replace("const STORAGE = 'eage.sandbox.v2'", "const STORAGE = 'eage.python-course.v2'")
        .replace("const LAYOUT_STORAGE = 'eage.sandbox.layout'", "const LAYOUT_STORAGE = 'eage.python-course.layout'");
      content = Buffer.from(source);
    }
    return res.status(200).send(content);
  } catch (_) { return res.status(503).end(); }
};
