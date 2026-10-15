const { fail } = require('./workflow');
let cache, inflight;
async function locations() {
  if (cache && Date.now() - cache.at < 86400000) return { ...cache, stale: false };
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const response = await fetch('https://psgc.gitlab.io/api/cities-municipalities/', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Unavailable');
      const rows = await response.json();
      if (!Array.isArray(rows) || !rows.length || !rows.every(c => typeof c.code === 'string' && typeof c.name === 'string')) throw new Error('Invalid data');
      // PSGC names can be 'City of Cebu', while local profiles use 'Cebu City'. Retain both for lookup.
      cache = { at: Date.now(), data: rows.map(c => ({ code: c.code, name: c.name, provinceCode: c.provinceCode || null, alias: c.name.startsWith('City of ') ? `${c.name.slice(8)} City` : c.name })).sort((a,b) => a.name.localeCompare(b.name)) };
      return { ...cache, stale: false };
    } catch {
      if (cache) return { ...cache, stale: true };
      throw fail('City suggestions are temporarily unavailable. You can still type your city and province manually.', 502);
    } finally { inflight = null; }
  })();
  return inflight;
}
module.exports = { locations };
