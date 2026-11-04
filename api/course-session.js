module.exports = async function (req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  if (req.headers.origin !== "https://" + req.headers.host) return res.status(403).end();
  if (req.body && req.body.clear === true) {
    res.setHeader("Set-Cookie", "__Host-course_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0");
    return res.status(204).end();
  }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const token = req.body && req.body.token;
  if (!url || !key || typeof token !== "string" || token.length > 8192 || !/^[A-Za-z0-9_.-]+$/.test(token)) return res.status(400).end();
  try {
    const result = await fetch(url + "/auth/v1/user", { headers: { apikey: key, Authorization: "Bearer " + token } });
    if (!result.ok) return res.status(401).end();
    res.setHeader("Set-Cookie", "__Host-course_session=" + token + "; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600");
    return res.status(204).end();
  } catch (_) { return res.status(503).end(); }
};
