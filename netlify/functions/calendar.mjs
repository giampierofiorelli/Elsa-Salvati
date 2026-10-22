// Read-only calendar feed: /api/calendar.ics?k=ICAL_TOKEN
import { getDeps } from '../../lib/app.mjs';
import { buildIcs } from '../../lib/jobs.mjs';
import { safeEqual } from '../../lib/crypto.mjs';

export default async (req) => {
  const deps = getDeps();
  const k = new URL(req.url).searchParams.get('k') || '';
  if (!deps.env.ICAL_TOKEN || deps.env.ICAL_TOKEN.length < 24 || !safeEqual(k, deps.env.ICAL_TOKEN)) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(await buildIcs(deps), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex',
    },
  });
};

export const config = { path: '/api/calendar.ics' };
