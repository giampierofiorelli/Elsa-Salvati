// robots.txt. Production: everything public can be crawled, private areas can't. Anything else: nothing.
// AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot…) follow the general rule: allowed, since
// the studio wants to be found (decision for G in 05-piano/seo-ai-v1.md; to block one, add its own group here).
export const PRIVATE_PATHS = ['/admin/', '/api/', '/.netlify/', '/prenota/gestisci/', '/en/book/manage/'];

export function robotsTxt({ production, base = '' }) {
  if (!production) return 'User-agent: *\nDisallow: /\n';
  return ['User-agent: *', ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`), '', base ? `Sitemap: ${base}/sitemap.xml` : '', ''].filter((l, i, a) => l || i === a.length - 1 || a[i + 1]).join('\n');
}
