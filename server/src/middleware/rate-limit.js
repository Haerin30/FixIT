// Single-process limits for the university deployment. Use a shared store when scaling instances.
function rateLimit({ limit = 30, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const time = now(), key = req.ip || req.socket?.remoteAddress || 'unknown';
    if (buckets.size > 10000) for (const [ip, bucket] of buckets) if (bucket.until <= time) buckets.delete(ip);
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= time) { bucket = { count: 0, until: time + windowMs }; buckets.set(key, bucket); }
    bucket.count++;
    if (bucket.count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.until - time) / 1000))));
      return res.status(429).json({ success: false, message: 'Too many attempts. Please wait before trying again.' });
    }
    next();
  };
}
module.exports = { rateLimit };
