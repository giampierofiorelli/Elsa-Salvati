// Personal read-only calendar feed: /api/calendar.ics?k=<token from the agenda>
import { getDeps } from '../../lib/app.mjs';
import { buildIcs } from '../../lib/jobs.mjs';
import { sha256 } from '../../lib/crypto.mjs';

export default async (req) => {
  const deps = getDeps();
  const k = new URL(req.url).searchParams.get('k') || '';
  const user = k.length >= 24 && k.length <= 100 ? await deps.store.getUserByIcs(sha256(k)) : null;
  if (!user || !user.enrolled_at) return new Response('Not found', { status: 404 });
  // A professional sees their own agenda; an admin without a professional profile sees the whole studio.
  const professionalId = user.professional_id || (user.role === 'admin' ? null : '0');
  return new Response(await buildIcs(deps, { professionalId }), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex',
    },
  });
};

export const config = { path: '/api/calendar.ics' };
