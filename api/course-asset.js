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
    const target = url + "/storage/v1/object/authenticated/private-courses/" + segments.map(encodeURIComponent).join("/");
    const response = await fetch(target, { headers: { apikey: key, Authorization: "Bearer " + token } });
    if (!response.ok) return res.status(response.status === 404 ? 404 : 403).send("Course file unavailable or access denied.");
    const extension = segments[segments.length - 1].split(".").pop().toLowerCase();
    const types = {html:"text/html; charset=utf-8", js:"text/javascript; charset=utf-8", mjs:"text/javascript; charset=utf-8", css:"text/css; charset=utf-8", json:"application/json; charset=utf-8", svg:"image/svg+xml", jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", csv:"text/csv; charset=utf-8", pdf:"application/pdf", wasm:"application/wasm", ipynb:"application/json; charset=utf-8"};
    res.setHeader("Content-Type", types[extension] || response.headers.get("content-type") || "application/octet-stream");
    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(Buffer.from(await response.arrayBuffer()));
  } catch (_) { return res.status(503).end(); }
};
