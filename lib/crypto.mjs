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

function ringKey(raw) {
  const master = loadKey(raw);
  return {
    // A short id derived from the key itself: it says which key encrypted a value, and reveals nothing of it.
    id: createHash('sha256').update(subKey(master, 'key-id-v1')).digest('base64url').slice(0, 10),
    enc: subKey(master, 'contact-encryption-v1'),
    mac: subKey(master, 'lookup-hmac-v1'),
  };
}

function open(key, iv, tag, ct) {
  const d = createDecipheriv('aes-256-gcm', key, fromB64u(iv));
  d.setAuthTag(fromB64u(tag));
  return JSON.parse(Buffer.concat([d.update(fromB64u(ct)), d.final()]).toString('utf8'));
}

/**
 * Key ring. DATA_KEY encrypts everything new; DATA_KEY_OLD (one or more old keys, separated by commas) only
 * decrypts what has not been re-encrypted yet (scripts/rotate-data-key.mjs). Values: v2.<key id>.<iv>.<tag>.<data>;
 * values written before the ring (v1, no key id) are tried with every key.
 */
export function createVault(dataKeyRaw, oldKeysRaw = '') {
  const current = ringKey(dataKeyRaw);
  const old = String(oldKeysRaw || '').split(',').map((x) => x.trim()).filter(Boolean).map(ringKey).filter((k) => k.id !== current.id);
  const ring = [current, ...old];
  return {
    keyId: current.id,
    encrypt(obj) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', current.enc, iv);
      const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
      return `v2.${current.id}.${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(ct)}`;
    },
    decrypt(s) {
      if (!s) return null;
      const parts = s.split('.');
      if (parts[0] === 'v2') {
        const key = ring.find((k) => k.id === parts[1]);
        if (!key) throw new Error('chiave di cifratura non disponibile (manca in DATA_KEY_OLD?)');
        return open(key.enc, parts[2], parts[3], parts[4]);
      }
      if (parts[0] !== 'v1') throw new Error('formato cifrato sconosciuto');
      let last;
      for (const key of ring) {
        try { return open(key.enc, parts[1], parts[2], parts[3]); } catch (err) { last = err; }
      }
      throw last;
    },
    /** True when the value is already encrypted with the current key (nothing to re-encrypt). */
    isCurrent(s) { return typeof s === 'string' && s.startsWith(`v2.${current.id}.`); },
    /** Stable keyed hash for lookups (email, IP) without storing the value. Always with the current key. */
    lookupHash(value) {
      return createHmac('sha256', current.mac).update(String(value).trim().toLowerCase()).digest('base64url');
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
