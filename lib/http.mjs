// Small HTTP helpers for Netlify Functions (Web Request/Response API).

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

export async function readJson(req, maxBytes = 8192) {
  const ct = req.headers.get('content-type') || '';
  if (ct.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'json_required', 'Formato richiesta non valido');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large', 'Richiesta troppo grande');
  try {
    const v = JSON.parse(text || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'bad_json', 'Richiesta non valida');
  }
}

/** Path after a prefix, e.g. "/api/public/slots" -> "/slots". */
export function subPath(req, prefix) {
  const p = new URL(req.url).pathname;
  return p.startsWith(prefix) ? p.slice(prefix.length) || '/' : p;
}

/** Key used to find one person's data by email (lower case, so the same address always matches). */
export function contactKey(email) {
  return `email:${String(email).trim().toLowerCase()}`;
}

export function clientIp(req, context) {
  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip')
    || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  return ipKey(ip);
}

/** IPv6 addresses are grouped by /64, the block one connection usually gets, so limits can't be dodged. */
export function ipKey(ip) {
  if (!ip.includes(':') || ip.includes('.')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/** Convert thrown errors into JSON responses without leaking internals. */
export async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.code, message: err.message });
    if (err && err.code === 'conflict') return json(409, { error: 'conflict', message: err.message });
    if (err instanceof RangeError || err instanceof TypeError) {
      console.error('[api] invalid input', err && err.message);
      return json(400, { error: 'invalid', message: 'Richiesta non valida' });
    }
    console.error('[api] unexpected error', err && err.stack ? err.stack : err);
    // DEBUG_ERRORS=true (preview only) shows the technical cause to help setup.
    const detail = process.env.DEBUG_ERRORS === 'true' ? { detail: `${err && err.code ? `${err.code}: ` : ''}${err && err.message}` } : {};
    return json(500, { error: 'server', message: 'Si è verificato un errore. Riprova tra qualche minuto.', ...detail });
  }
}

// ---------- input validation ----------

// Local part without characters that change a mailto: link; domain made of plain labels.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"?&=%/#]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

export function cleanText(v, { field, min = 0, max = 200, required = false } = {}) {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
  if (!s) {
    if (required) throw new HttpError(400, 'invalid', `${field}: campo obbligatorio`);
    return '';
  }
  if (s.length < min || s.length > max) throw new HttpError(400, 'invalid', `${field}: lunghezza non valida`);
  return s;
}

export function cleanMultiline(v, { field, max = 1000 } = {}) {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim() : '';
  if (s.length > max) throw new HttpError(400, 'invalid', `${field}: testo troppo lungo`);
  return s;
}

export function cleanEmail(v, { required = false } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) {
    if (required) throw new HttpError(400, 'invalid', 'Email: campo obbligatorio');
    return '';
  }
  if (s.length > 254 || !EMAIL_RE.test(s)) throw new HttpError(400, 'invalid', 'Email non valida');
  return s;
}

export function cleanPhone(v, { required = false } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) {
    if (required) throw new HttpError(400, 'invalid', 'Telefono: campo obbligatorio');
    return '';
  }
  if (!/^\+?[0-9 ().-]{6,20}$/.test(s)) throw new HttpError(400, 'invalid', 'Telefono non valido');
  return s;
}

export function oneOf(v, allowed, field) {
  if (!allowed.includes(v)) throw new HttpError(400, 'invalid', `${field}: valore non valido`);
  return v;
}
