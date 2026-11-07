// Texts of the emails editable from the admin: every default and every override render completely,
// values are escaped, the rules are enforced and a broken override never blocks an email.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMAILS, EMAIL_BY_KEY, VARS, checkText, renderText } from '../lib/email-texts.mjs';
import { templates, createMailer, sampleValues, previewEmail } from '../lib/email.mjs';

const site = { professionalName: 'Blooming', cancelHours: 24, siteUrl: 'https://www.example.it' };
const LEFT = /\{[A-Za-z_]+\}/;
const opts = (def, lang) => (def.audience === 'persona' ? { brand: 'Blooming', footer: ['riga emergenze', 'Blooming'] } : {});
const rich = (...paras) => ({ p: paras.map((t) => (Array.isArray(t) ? t : [{ t }])) });

// An override that uses every placeholder of the email: inline ones in a sentence (also with a capital), block ones alone.
function fullOverride(def) {
  const inline = def.vars.filter((v) => !['dettagli', 'tariffa', 'link', 'elenco'].includes(v));
  const paras = [inline.length ? inline.map((v) => `{${v}} {${v.charAt(0).toUpperCase() + v.slice(1)}}`).join(', ') : 'Testo'];
  for (const v of ['dettagli', 'tariffa', 'elenco', 'link']) if (def.vars.includes(v)) paras.push(`{${v}}`);
  return { subject: def.vars.includes('tipo') ? 'Il tuo {tipo}' : 'Aggiornamento', body: rich(...paras), button: def.link ? 'Apri' : '' };
}

test('every default and every override render with all placeholders resolved', () => {
  assert.ok(EMAILS.length >= 30);
  for (const def of EMAILS) {
    for (const lang of def.langs) {
      const v = sampleValues(def, lang, site);
      for (const [what, input] of [['default', def.defaults[lang]], ['override', fullOverride(def)]]) {
        const txt = checkText(def, lang, input);
        const out = renderText(def, lang, txt, v, opts(def, lang));
        const where = `${def.key}/${lang} ${what}`;
        assert.doesNotMatch(out.subject, LEFT, where);
        assert.doesNotMatch(out.text, LEFT, where);
        assert.doesNotMatch(out.html, LEFT, where);
        assert.match(out.subject, / – Blooming$/, `${where}: neutral subject ending`);
        if (def.required.includes('link')) {
          assert.equal((out.html.match(/<a /g) || []).length, 1, `${where}: one main link`);
          assert.ok(out.text.includes(v.link), `${where}: link in the text version`);
        }
        if (def.audience === 'persona') assert.match(out.text, /riga emergenze\nBlooming$/, `${where}: footer always added`);
      }
    }
  }
});

test('every template still renders without leftovers (IT and EN, first meeting and session)', () => {
  const base = { start_at: '2026-11-10T14:00:00Z', end_at: '2026-11-10T14:50:00Z', mode: 'studio', professional_name: 'Elsa Salvati', status: 'confermato', service_price: '80 €' };
  const s = { ...site, address: 'Via Roma 1, Bologna' };
  for (const lang of ['it', 'en']) {
    for (const kind of ['primo_colloquio', 'seduta']) {
      const ev = { ...base, kind, lang };
      const a = { ev, name: 'Anna', manageUrl: 'https://x/m#t=1', bookUrl: 'https://x/b/', tz: 'Europe/Rome', site: s, lang };
      const mails = [
        templates.confirmation(a), templates.rescheduled(a), templates.cancelled(a), templates.cancelled({ ...a, ev: { ...ev, status: 'in_attesa' } }),
        templates.reminder(a), templates.reminderConfirm(a), templates.reminderConfirm({ ...a, nudge: true }), templates.requestReceived(a),
        templates.approved(a), templates.approved({ ...a, askConfirm: true }), templates.declined(a), templates.declined({ ...a, expired: true }),
        templates.reminderSoon(a), templates.cancelledByStudio(a), templates.cancelledByStudio({ ...a, unconfirmed: true }),
      ];
      for (const m of mails) {
        assert.doesNotMatch(m.subject + m.text + m.html, LEFT, `${m.tpl.key}/${lang}`);
        assert.equal(m.tpl.lang, lang);
      }
    }
  }
  for (const action of ['requested', 'reassigned', 'expired', 'booked', 'confirmed', 'cancelled', 'lateCancelled', 'rescheduled', 'request']) {
    const m = templates.studioNotice({ ev: { start_at: '2026-11-10T14:00:00Z', assigned: true }, action, tz: 'Europe/Rome', adminUrl: 'https://x/admin/' });
    assert.doesNotMatch(m.subject + m.text, LEFT, action);
    assert.match(m.text, /Apri l'agenda: https:\/\/x\/admin\//);
  }
  const u = templates.unconfirmedNotice({ list: [{ start_at: '2026-11-10T14:00:00Z' }], tz: 'Europe/Rome', adminUrl: 'https://x/admin/' });
  assert.match(u.text, /confermato la presenza: 1\.\n• martedì 10 novembre 2026/);
});

test('values and texts are escaped in the HTML; only bold and italic come through', () => {
  const def = EMAIL_BY_KEY['richiesta-ricevuta'];
  const txt = checkText(def, 'it', {
    subject: 'Richiesta <ricevuta>',
    body: rich('Gentile {nome},', [{ t: 'Testo ', b: true }, { t: '<script>alert(1)</script>', i: true }], '{dettagli}', '{link}'),
    button: 'Annulla & "chiudi"',
  });
  const v = { ...sampleValues(def, 'it', site), nome: '<img src=x onerror=alert(1)> & "Anna"', link: 'https://x/m#t=1&e="x"' };
  const out = renderText(def, 'it', txt, v, opts(def, 'it'));
  assert.ok(!out.html.includes('<img'), 'name escaped');
  assert.ok(!out.html.includes('<script>'), 'text escaped');
  assert.match(out.html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;Anna&quot;/);
  assert.match(out.html, /<strong>Testo <\/strong><em>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/em>/);
  assert.match(out.html, /href="https:\/\/x\/m#t=1&amp;e=&quot;x&quot;"/);
  assert.match(out.html, />Annulla &amp; &quot;chiudi&quot;<\/a>/);
  assert.equal(out.subject, 'Richiesta <ricevuta> – Blooming', 'the subject is plain text');
});

test('the rules: required link and details, known placeholders, neutral subject, one link', () => {
  const def = EMAIL_BY_KEY['conferma-48h'];
  const ok = { subject: 'Conferma la presenza', body: rich('Ciao {nome}', '{dettagli}', '{link}'), button: 'Confermo' };
  assert.doesNotThrow(() => checkText(def, 'it', ok));
  const bad = (patch, re) => assert.throws(() => checkText(def, 'it', { ...ok, ...patch }), re);
  bad({ body: rich('Ciao {nome}', '{dettagli}') }, /Manca il pulsante \{link\}: serve per il link per confermare la presenza/);
  bad({ body: rich('Ciao {nome}', '{link}') }, /Manca \{dettagli\}/);
  bad({ body: rich('Ciao {nome} {colore}', '{dettagli}', '{link}') }, /\{colore\} non esiste/);
  bad({ body: rich('Ciao {nome}', '{dettagli}', '{link}', '{link}') }, /una sola volta/);
  bad({ body: rich('Clicca {link} qui', '{dettagli}') }, /va da solo/);
  bad({ body: rich('Ciao', '{dettagli}', [{ t: 'qui', href: 'https://evil.example' }], '{link}') }, /un solo pulsante/);
  bad({ subject: 'Ciao {nome}' }, /l'oggetto resta neutro/);
  bad({ subject: 'La tua seduta di psicoterapia' }, /neutro/);
  bad({ subject: '' }, /oggetto non può essere vuoto/);
  bad({ button: '' }, /pulsante non può essere vuoto/);
  bad({ button: 'Vai {nome}' }, /pulsante non si usano segnaposti/);
  assert.equal(checkText(def, 'it', { ...ok, subject: 'Conferma – Blooming' }).subject, 'Conferma', 'the brand is added by the site');
  assert.throws(() => checkText(EMAIL_BY_KEY['studio-passata'], 'en', ok), /Lingua non prevista/);
  // The person's cancellation of a later appointment: the button is optional (the English default has none).
  assert.doesNotThrow(() => checkText(EMAIL_BY_KEY['annullato-seduta'], 'en', { subject: 'Cancelled', body: rich('Dear {nome}, {data}'), button: 'x' }));
  for (const v of Object.keys(VARS)) assert.ok(EMAILS.some((e) => e.vars.includes(v)), `${v} is used somewhere`);
});

test('the mailer uses a saved override, and the default when the override is broken', async () => {
  const ev = { start_at: '2026-11-10T14:00:00Z', end_at: '2026-11-10T14:30:00Z', kind: 'primo_colloquio', mode: 'online', professional_name: 'Elsa Salvati', lang: 'it' };
  const mail = () => templates.reminderConfirm({ ev, name: 'Anna', manageUrl: 'https://x/m#t=1', tz: 'Europe/Rome', site });
  let row = { subject: 'Ci vediamo', body: rich('Ciao **{nome}**', '{dettagli}', '{link}'), button: 'Sì, ci sarò' };
  const asked = [];
  const mailer = createMailer({ EMAIL_PROVIDER: 'test' }, null, null, { get: async (key, lang) => { asked.push(`${key}/${lang}`); return row; } });
  await mailer.send({ to: 'a@example.it', ...mail() });
  assert.deepEqual(asked, ['conferma-48h/it']);
  assert.equal(mailer.sent[0].subject, 'Ci vediamo – Blooming');
  assert.match(mailer.sent[0].text, /Ciao \*\*Anna\*\*/);
  assert.match(mailer.sent[0].text, /Sì, ci sarò: https:\/\/x\/m#t=1&e=conferma/, 'the link keeps its email type');
  assert.ok(!('tpl' in mailer.sent[0]));
  row = { subject: 'Ci vediamo', body: rich('Ciao {nome}', '{dettagli}'), button: 'Sì' }; // the link was lost
  await mailer.send({ to: 'a@example.it', ...mail() });
  assert.equal(mailer.sent[1].subject, 'Conferma la presenza – Blooming', 'invalid override: the default is sent');
  row = null;
  await mailer.send({ to: 'a@example.it', ...mail() });
  assert.equal(mailer.sent[2].subject, 'Conferma la presenza – Blooming');
  const failing = createMailer({ EMAIL_PROVIDER: 'test' }, null, null, { get: async () => { throw new Error('db down'); } });
  await failing.send({ to: 'a@example.it', ...mail() });
  assert.equal(failing.sent[0].subject, 'Conferma la presenza – Blooming', 'database trouble: the default is sent');
});

test('preview with sample data', () => {
  const p = previewEmail('richiesta-accettata', 'en', EMAIL_BY_KEY['richiesta-accettata'].defaults.en, site);
  assert.match(p.text, /Dear Anna,/);
  assert.match(p.text, /Fee: Free/);
  assert.match(p.text, /https:\/\/www\.example\.it\/en\/book\/manage\/#t=esempio/);
  assert.throws(() => previewEmail('richiesta-accettata', 'it', { subject: 'x', body: rich('ciao'), button: 'x' }, site), /Manca/);
});
