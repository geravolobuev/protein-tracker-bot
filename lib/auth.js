export function requireAuth(req, res) {
  const password = process.env.WEB_PASSWORD;
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  if (!password || token !== password) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}
