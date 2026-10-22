// Encryption of contact data, keyed hashes, tokens, password hashing,
// TOTP (authenticator app codes) and signed admin sessions.
// Node's built-in crypto only.

import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes,
  scryptSync, timingSafeEqual, hkdfSync,
} from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

/** Decode DATA_KEY (base64 / base64url, 32 bytes). */
export function loadKey(raw) {
  if (!raw) throw new Error('DATA_KEY mancante');
  const key = Buffer.from(raw, raw.includes('-') || raw.includes('_') ? 'base64url' : 'base64');
  if (key.length !== 32) throw new Error('DATA_KEY deve essere di 32 byte');
  return key;
}

function subKey(master, label) {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(label), 32));
}

export function createVault(dataKeyRaw) {
  const master = loadKey(dataKeyRaw);
  const encKey = subKey(master, 'contact-encryption-v1');
  const macKey = subKey(master, 'lookup-hmac-v1');
  return {
    encrypt(obj) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', encKey, iv);
      const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
      return `v1.${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(ct)}`;
    },
    decrypt(s) {
      if (!s) return null;
      const [v, iv, tag, ct] = s.split('.');
      if (v !== 'v1') throw new Error('formato cifrato sconosciuto');
      const d = createDecipheriv('aes-256-gcm', encKey, fromB64u(iv));
      d.setAuthTag(fromB64u(tag));
      return JSON.parse(Buffer.concat([d.update(fromB64u(ct)), d.final()]).toString('utf8'));
    },
    /** Stable keyed hash for lookups (email, IP) without storing the value. */
    lookupHash(value) {
      return createHmac('sha256', macKey).update(String(value).trim().toLowerCase()).digest('base64url');
    },
  };
}

export function randomToken(bytes = 32) {
  return b64u(randomBytes(bytes));
}

export function sha256(s) {
  return createHash('sha256').update(s).digest('base64url');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ---------- password (scrypt) ----------

const SCRYPT = { N: 1 << 15, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFKC'), salt, 32, { ...SCRYPT, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${b64u(salt)}$${b64u(hash)}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = fromB64u(hash);
  const got = scryptSync(password.normalize('NFKC'), fromB64u(salt), expected.length, {
    N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(expected, got);
}

// ---------- TOTP (RFC 6238, compatible with Google Authenticator, Aegis, 1Password…) ----------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s) {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpCode(secretB32, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1e6).padStart(6, '0');
}

/** Returns the matched time-step counter, or null. Accepts ±1 step of clock drift. */
export function verifyTotp(secretB32, code, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code || '').trim())) return null;
  const c = Math.floor(now / 30000);
  for (const step of [0, -1, 1]) {
    if (safeEqual(totpCode(secretB32, c + step), String(code).trim())) return c + step;
  }
  return null;
}

// ---------- admin session cookie ----------

export function signSession(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function readSession(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(mac, expected)) return null;
  try {
    const payload = JSON.parse(fromB64u(body).toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}
