module.exports = function (req, res) {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || "";
  let legacyAnon = false;
  try {
    legacyAnon = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "anon";
  } catch (_) {}
  const safe = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && (key.startsWith("sb_publishable_") || legacyAnon);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(safe ? { url, key } : {});
};
