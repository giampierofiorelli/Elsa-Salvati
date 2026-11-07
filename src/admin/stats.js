// Area riservata: statistiche (Studio · Sito · Email). Solo numeri aggregati; ogni professionista vede i propri.
// Tutti i file dell'area condividono un solo oggetto: window.BloomingAdmin (A).
(function (A) {
  'use strict';
  var $ = A.$;
  var el = A.el;
  var api = A.api;
  var state = A.state;
  var isAdmin = A.isAdmin;
  var myPro = A.myPro;
  A.renderStats = renderStats;

  var st = { tab: 'studio', period: '30', data: null };
  var fmtDay = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  var fmtLong = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  function isoDay(d) { return d.toISOString().slice(0, 10); }
  function plusDays(s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDay(d); }
  function today() { return state.today || isoDay(new Date()); }
  function periodRange() {
    var t = today();
    if (st.period === 'mese') return { from: t.slice(0, 8) + '01', to: t };
    if (st.period === 'mese-scorso') {
      var first = t.slice(0, 8) + '01';
      var last = plusDays(first, -1);
      return { from: last.slice(0, 8) + '01', to: last };
    }
    if (st.period === 'anno') return { from: plusDays(t, -364), to: t };
    return { from: plusDays(t, -(Number(st.period) - 1)), to: t };
  }
  function periodLabel(d) { return fmtLong.format(new Date(d.from + 'T00:00:00Z')) + ' – ' + fmtLong.format(new Date(d.to + 'T00:00:00Z')); }

  // ---------- numbers in plain words ----------
  function n(v) { return v === -1 ? 'meno di 5' : (v == null ? '—' : String(v).replace('.', ',')); }
  // Wilson interval at 95% (Brown, Cai, DasGupta 2001): honest with few cases.
  function wilson(k, m) {
    var z = 1.96, p = k / m, d = 1 + z * z / m, c = p + z * z / (2 * m);
    var h = z * Math.sqrt(p * (1 - p) / m + z * z / (4 * m * m));
    return { p: p, lo: Math.max(0, (c - h) / d), hi: Math.min(1, (c + h) / d) };
  }
  var pct = function (x) { return Math.round(x * 100); };
  // Rules (research 25, A3/B3): under 10 cases "6 su 8"; 10–29 percentage + interval, "indicativo"; 30+ percentage + interval.
  function rate(part, whole) {
    if (part === -1 || whole === -1) return { main: 'meno di 5', sub: '' };
    if (!whole) return { main: '—', sub: '' };
    if (whole < 10) return { main: part + ' su ' + whole, sub: 'dati ancora insufficienti per una percentuale: servono almeno 10 casi (ora: ' + whole + ')' };
    var w = wilson(part, whole);
    return { main: pct(w.p) + '%', sub: 'tra ' + pct(w.lo) + '% e ' + pct(w.hi) + '% · ' + part + ' su ' + whole + (whole < 30 ? ' · indicativo' : '') };
  }
  function share(part, whole) { var r = rate(part, whole); return r.main; }
  function shareCell(part, whole) { var r = rate(part, whole); return r.sub && whole >= 10 && part !== -1 && whole !== -1 ? r.main + ' (' + r.sub.split(' · ')[0] + ')' : r.main; }
  // Two groups: "sembra diverso" only when the intervals don't overlap; with fewer than 20 cases each, say so.
  function compare(labelA, a, labelB, b, what) {
    if (a.n === -1 || b.n === -1 || a.k === -1 || b.k === -1 || a.n < 20 || b.n < 20) {
      return 'Dati ancora insufficienti per confrontare ' + labelA + ' e ' + labelB + ': servono almeno 20 casi per gruppo (ora: ' + n(a.n) + ' e ' + n(b.n) + ').';
    }
    var x = wilson(a.k, a.n), y = wilson(b.k, b.n);
    if (x.hi < y.lo || y.hi < x.lo) return 'Sembra diverso: ' + what + ' ' + pct(x.p) + '% con ' + labelA + ', ' + pct(y.p) + '% con ' + labelB + '.';
    return 'Nessuna differenza visibile con questi numeri tra ' + labelA + ' e ' + labelB + '.';
  }
  function delta(cur, prev, unit) {
    if (cur == null || prev == null || cur === -1 || prev === -1) return '';
    var d = Math.round((cur - prev) * 10) / 10;
    var days = st.data ? Math.round((Date.parse(st.data.to) - Date.parse(st.data.from)) / 86400000) + 1 : 30;
    if (d === 0) return 'uguale ai ' + days + ' giorni prima';
    return (d > 0 ? '↑ ' : '↓ ') + String(Math.abs(d)).replace('.', ',') + (unit || '') + ' rispetto ai ' + days + ' giorni prima';
  }

  function card(title, value, def, cmp) {
    var sub = '';
    if (value && typeof value === 'object') { sub = value.sub; value = value.main; }
    return el('article', { class: 'stat-card' }, [
      el('h3', { text: title }),
      el('p', { class: 'stat-value', text: value }),
      sub ? el('p', { class: 'stat-ci', text: sub }) : null,
      cmp ? el('p', { class: 'stat-delta', text: cmp }) : null,
      el('p', { class: 'stat-def', text: def }),
    ]);
  }
  function section(title, hint, children) {
    return el('section', { class: 'stat-section' }, [el('h2', { text: title }), hint ? el('p', { class: 'hint', text: hint }) : null].concat(children));
  }
  function table(head, rows, opts) {
    opts = opts || {};
    if (!rows.length) return el('p', { class: 'empty', text: opts.empty || 'Nessun dato nel periodo.' });
    var t = el('table', { class: 'stat-table' });
    t.appendChild(el('thead', {}, [el('tr', {}, head.map(function (h, i) { return el('th', { scope: 'col', class: i ? 'num' : '', text: h }); }))]));
    var tb = el('tbody');
    rows.forEach(function (r) { tb.appendChild(el('tr', {}, r.map(function (c, i) { return el(i ? 'td' : 'th', { scope: i ? null : 'row', class: i ? 'num' : '', text: typeof c === 'number' ? n(c) : c }); }))); });
    t.appendChild(tb);
    return el('div', { class: 'stat-table-wrap' }, [t]);
  }
  // Calm horizontal bars: label, bar, number.
  function bars(items) {
    if (!items.length) return el('p', { class: 'empty', text: 'Nessun dato nel periodo.' });
    var max = Math.max.apply(null, items.map(function (x) { return x.v > 0 ? x.v : 0; })) || 1;
    return el('ul', { class: 'stat-bars', role: 'list' }, items.map(function (x) {
      var b = el('span', { class: 'stat-bar' });
      b.style.width = (x.v > 0 ? Math.max(2, x.v / max * 100) : 0) + '%';
      return el('li', {}, [el('span', { class: 'stat-bar-label', text: x.label }), el('span', { class: 'stat-bar-track' }, [b]), el('span', { class: 'stat-bar-n', text: n(x.v) })]);
    }));
  }
  // Columns per day (site views), with the first and last date under the chart.
  function columns(days, from, to) {
    var byDay = {};
    days.forEach(function (d) { byDay[d.day] = d.n; });
    var list = [];
    for (var d = from; d <= to; d = plusDays(d, 1)) list.push({ day: d, n: byDay[d] || 0 });
    if (list.length > 120) return el('p', { class: 'hint', text: 'Grafico giornaliero disponibile per periodi fino a 120 giorni.' });
    var max = Math.max.apply(null, list.map(function (x) { return x.n; })) || 1;
    var wrap = el('div', { class: 'stat-cols', role: 'img', 'aria-label': 'Pagine viste per giorno, dal ' + fmtDay.format(new Date(from + 'T00:00:00Z')) + ' al ' + fmtDay.format(new Date(to + 'T00:00:00Z')) });
    list.forEach(function (x) {
      var c = el('span', { class: 'stat-col', title: fmtDay.format(new Date(x.day + 'T00:00:00Z')) + ': ' + x.n });
      c.style.height = (x.n ? Math.max(3, x.n / max * 100) : 0) + '%';
      wrap.appendChild(c);
    });
    return el('figure', { class: 'stat-chart' }, [wrap, el('figcaption', {}, [
      el('span', { text: fmtDay.format(new Date(from + 'T00:00:00Z')) }), el('span', { text: 'massimo ' + max + ' al giorno' }), el('span', { text: fmtDay.format(new Date(to + 'T00:00:00Z')) }),
    ])]);
  }

  var AREA = { carriera: 'Orientamento e carriera', coaching: 'Coaching', psicologia: 'Sostegno psicologico', psicoterapia: 'Psicoterapia', aziende: 'Organizzazioni', da_definire: 'Non so ancora', 'da-scegliere': 'Non so ancora' };
  var HEARD = { passaparola: 'Passaparola', professionista: 'Un medico o un altro professionista', ricerca: 'Ricerca su internet', instagram: 'Instagram', linkedin: 'LinkedIn', azienda: 'La sua azienda', altro: 'Altro' };
  var SRC = { diretto: 'Diretto (indirizzo scritto, preferiti, app)', google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', altro: 'Altri siti' };
  var EMAIL = {
    'richiesta-ricevuta': 'Richiesta ricevuta (alla persona)', accettata: 'Richiesta accettata', rifiutata: 'Richiesta rifiutata', scaduta: 'Richiesta scaduta',
    fissato: 'Appuntamento fissato dalla professionista', confermato: 'Appuntamento confermato', spostato: 'Appuntamento spostato', disdetta: 'Disdetta confermata',
    promemoria: 'Promemoria', conferma: 'Richiesta di conferma', 'conferma-2': 'Secondo invito a confermare', 'promemoria-2h': 'Promemoria 2 ore prima',
    'annullato-studio': 'Annullato dallo studio', liberato: 'Orario liberato (non confermato)', 'studio-avviso': 'Avvisi alle professioniste',
    'studio-non-confermati': 'Elenco dei non confermati', altro: 'Altre',
  };
  var ACTION = { conferma: 'Conferme', disdetta: 'Disdette', 'disdetta-tardiva': 'Disdette all\'ultimo momento', spostamento: 'Spostamenti' };
  var STEP = ['Pagina aperta', 'Area scelta', 'Professionista o «Aiutami a scegliere»', 'Orario scelto', 'Dati inseriti', 'Richiesta inviata'];
  var FORM = { prenotazione: 'Prenotazione', contatto: 'Contatto', aziende: 'Organizzazioni', ricontatto: 'Ricontatto' };

  // ---------- loading ----------
  function renderStats() {
    var box = $('[data-panel="statistiche"]');
    var allTabs = isAdmin() || A.isTech();
    if (!allTabs && st.tab !== 'studio') st.tab = 'studio';
    box.textContent = '';
    var tabs = el('div', { class: 'seg', role: 'group', 'aria-label': 'Sezione' }, [['studio', 'Studio'], ['site', 'Sito'], ['email', 'Email']]
      .filter(function (t) { return t[0] === 'studio' || allTabs; })
      .map(function (t) { return el('button', { type: 'button', 'aria-pressed': String(st.tab === t[0]), 'data-stat-tab': t[0], text: t[1], onclick: function () { st.tab = t[0]; renderStats(); } }); }));
    var period = el('select', { 'aria-label': 'Periodo', 'data-stat-period': true }, [['7', 'Ultimi 7 giorni'], ['30', 'Ultimi 30 giorni'], ['90', 'Ultimi 90 giorni'], ['mese', 'Questo mese'], ['mese-scorso', 'Mese scorso'], ['anno', 'Ultimi 12 mesi']]
      .map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    period.value = st.period;
    period.onchange = function () { st.period = period.value; renderStats(); };
    var exportBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-small', 'data-stat-export': true, text: 'Scarica CSV', onclick: exportCsv });
    box.appendChild(el('div', { class: 'toolbar stat-toolbar' }, [tabs, el('div', { class: 'stat-tools' }, [period, exportBtn])]));
    var body = el('div', { class: 'stat-body', 'aria-live': 'polite' }, [el('p', { class: 'hint', text: 'Carico i numeri…' })]);
    box.appendChild(body);
    var r = periodRange();
    var q = '/stats/' + st.tab + '?from=' + r.from + '&to=' + r.to;
    if (st.tab === 'studio' && isAdmin()) q += '&professional=' + (state.scope || 'all');
    return api('GET', q).then(function (d) {
      st.data = d;
      body.textContent = '';
      body.appendChild(el('p', { class: 'stat-period' }, [periodLabel(d), el('span', { class: 'hint', text: ' · confronto con ' + periodLabel({ from: d.prevFrom, to: d.prevTo }) })]));
      if (st.tab === 'studio') studio(body, d);
      else if (st.tab === 'site') site(body, d);
      else email(body, d);
    }).catch(function (e) { body.textContent = ''; body.appendChild(el('p', { class: 'form-error', text: e.message })); });
  }

  // ---------- Studio ----------
  function studio(box, d) {
    var c = d.current;
    var p = d.previous;
    var who = A.isTech() ? 'Tutto lo studio.' : !isAdmin() ? 'I tuoi numeri.' : (d.professional ? (String(d.professional) === String(myPro()) ? 'I tuoi numeri.' : 'I numeri della professionista scelta.') : 'Tutto lo studio.');
    box.appendChild(el('p', { class: 'hint', text: who + (d.shared ? ' Nei dettagli, i gruppi con meno di 5 casi sono nascosti (anche quelli che si potrebbero ricavare per sottrazione).' : '') }));
    var rq = c.requests;
    if (d.insights) box.appendChild(attention(d.insights.alerts));
    box.appendChild(summary(d));
    var grid = el('div', { class: 'stat-grid' }, [
      card('Richieste di primo colloquio', n(rq.total), 'Richieste arrivate dal sito nel periodo.', delta(rq.total, p.requests.total)),
      card('Accettate', rate(rq.accepted, rq.total), 'Su tutte le richieste, quante sono state accettate. Rifiutate ' + rq.declined + ' · scadute ' + rq.expired + ' · in attesa ' + rq.waiting + '.'),
      card('Tempo di risposta', c.response.medianHours == null ? '—' : n(c.response.medianHours) + ' ore', 'Metà delle richieste ha avuto risposta entro questo tempo. Entro 24 ore: ' + share(c.response.within24, c.response.answered) + '.', delta(c.response.medianHours, p.response.medianHours, ' ore')),
      card('Anticipo', c.lead.medianDays == null ? '—' : n(c.lead.medianDays) + ' giorni', 'Giorni tra la richiesta e il primo colloquio (valore centrale). Se cresce, l\'agenda è piena.'),
      (function () {
        // Mature groups only (first meetings of at least 60 days ago, last 12 months): the period alone would undercount.
        var T = d.insights ? d.insights.contTotal : null;
        var k = T ? T.k : c.continuity.yes;
        var m = T ? T.n : c.continuity.base;
        return card('Continuità dopo il primo colloquio', rate(k, m), 'Ultimi 12 mesi: primi colloqui di almeno 60 giorni fa seguiti da almeno una seduta entro 60 giorni. Un colloquio che non prosegue può essere un buon risultato.');
      })(),
      card('Disdette della persona', rate(c.cancellations.byPerson, c.cancellations.scheduled), 'Appuntamenti annullati dalla persona, su quelli in agenda. All\'ultimo momento: ' + c.cancellations.late + '. Orari liberati per mancata conferma: ' + c.cancellations.unconfirmed + '.'),
      card('Assenze senza avviso', rate(c.noShow.absent, c.noShow.past), 'Persone che non si sono presentate, segnate dall\'agenda con «Non si è presentata».', delta(c.noShow.absent, p.noShow.absent)),
      card('Occupazione dell\'agenda', c.occupancy.availableHours ? Math.round(c.occupancy.bookedHours / c.occupancy.availableHours * 100) + '%' : '—', 'Ore prenotate (' + n(c.occupancy.bookedHours) + ') sulle ore di lavoro (' + n(c.occupancy.availableHours) + '), tolti i blocchi.'),
      card('Orari liberi nelle prossime 2 settimane', n(c.freeSlots), 'Orari da primo colloquio ancora prenotabili online. Se sono tanti, può valere la pena farsi sentire (un post, un messaggio).'),
    ]);
    box.appendChild(grid);
    if (d.insights) insights(box, d.insights);
    if (d.professional) return; // contacts, sources and the fairness check belong to the studio's totals
    var contacts = Object.keys(c.contacts).map(function (k) { return [AREA[k] || k, c.contacts[k], p.contacts[k] || 0]; });
    box.appendChild(section('Richieste di contatto', 'Moduli di contatto e organizzazioni, per area. Le richieste si cancellano dopo pochi mesi: qui restano solo i totali.', [table(['Area', 'Periodo', 'Prima'], contacts)]));
    var heard = Object.keys(HEARD).map(function (k) { return { label: HEARD[k], v: c.heard[k] || 0 }; }).filter(function (x) { return x.v; });
    box.appendChild(section('Come ci hanno conosciuto', 'Risposte alla domanda facoltativa nei moduli. Dato utile ma impreciso: ognuno ricorda l\'ultima cosa vista.', [bars(heard)]));
    if (isAdmin()) {
      var pros = (state.me.professionals || []);
      var per = (c.perPro || []).map(function (r) { var pr = pros.find(function (x) { return String(x.id) === String(r.id); }); return [pr ? pr.name : 'Professionista', r.requests, r.assigned]; });
      box.appendChild(section('«Aiutami a scegliere»', 'Richieste per professionista e quante assegnate in automatico; «Passa alla collega» nel periodo: ' + n(c.passed) + '. Serve a controllare che la regola sia equa.', [table(['Professionista', 'Richieste', 'Assegnate'], per)]));
    }
  }

  // ---------- Sito ----------
  function sum(rows, f) { return rows.filter(f).reduce(function (s, r) { return s + (r.n > 0 ? r.n : 0); }, 0); }
  function site(box, d) {
    var R = d.current.rows;
    var P = d.previous.rows;
    var isBook = function (page) { return page === '/prenota/' || page === '/en/book/'; };
    var views = sum(R, function (r) { return r.metric === 'view'; });
    var goals = R.filter(function (r) { return r.metric === 'goal'; });
    var bookings = goals.filter(function (r) { return /^prenotazione\|/.test(r.key); });
    var bookingsN = bookings.some(function (r) { return r.n === -1; }) ? -1 : sum(bookings, function () { return true; });
    var formsSent = sum(R, function (r) { return r.metric === 'form' && /:inviato$/.test(r.key) && !/^prenotazione/.test(r.key); });
    box.appendChild(el('p', { class: 'hint stat-note', text: 'Numeri stimati: non contiamo chi blocca le statistiche o chiede di non essere tracciato. Nessun cookie, nessun identificativo, nessun indirizzo IP.' }));
    box.appendChild(el('div', { class: 'stat-grid' }, [
      card('Pagine viste', n(views), 'Quante volte sono state aperte le pagine del sito.', delta(views, sum(P, function (r) { return r.metric === 'view'; }))),
      card('Ingressi', n(sum(R, function (r) { return r.metric === 'entry'; })), 'Visite arrivate da fuori (motori di ricerca, social, indirizzo scritto).'),
      card('Prenotazioni inviate', n(bookingsN), 'Richieste di primo colloquio inviate dal sito.'),
      card('Moduli inviati', n(formsSent), 'Moduli di contatto, organizzazioni e ricontatto inviati.'),
    ]));
    box.appendChild(section('Pagine viste per giorno', null, [columns(d.current.daily, d.from, d.to)]));

    // Booking page funnel
    var opened = sum(R, function (r) { return r.metric === 'view' && isBook(r.page); });
    var steps = [opened].concat([1, 2, 3, 4, 5].map(function (k) { return sum(R, function (r) { return r.metric === 'step' && r.key === String(k); }); }));
    box.appendChild(section('Percorso nella pagina di prenotazione', 'Quante volte la pagina è stata aperta e fin dove si è arrivati. Mostra dove le persone si fermano.',
      [table(['Passo', 'Volte', 'Sull\'apertura'], steps.map(function (v, i) { return [STEP[i], v, i ? share(v, opened) : '']; }))]));

    // Pages
    var pages = {};
    R.forEach(function (r) {
      if (r.page === '*' || r.metric === 'goal') return;
      var x = pages[r.page] = pages[r.page] || { views: 0, entries: 0, book: 0, goals: 0 };
      if (r.metric === 'view') x.views += r.n;
      if (r.metric === 'entry') x.entries += r.n;
      if (r.metric === 'cta' && /-prenota$/.test(r.key)) x.book += r.n;
    });
    bookings.forEach(function (r) { var x = pages[r.page] = pages[r.page] || { views: 0, entries: 0, book: 0, goals: 0 }; x.goals = x.goals === -1 || r.n === -1 ? -1 : x.goals + r.n; });
    var prow = Object.keys(pages).map(function (k) { var x = pages[k]; return [k === '(nessuna)' ? 'Nessuna pagina precedente' : k, x.views, x.entries, x.book, x.views ? share(x.book, x.views) : '—', x.goals]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    box.appendChild(section('Pagine', 'Per ogni pagina: viste, ingressi, clic su un pulsante «Prenota», e prenotazioni inviate subito dopo averla letta (meno di 5 = nascosto).', [table(['Pagina', 'Viste', 'Ingressi', 'Clic «Prenota»', 'Tasso di clic', 'Prenotazioni'], prow)]));

    // Sources
    var src = Object.keys(SRC).map(function (k) { return { label: SRC[k], v: sum(R, function (r) { return r.metric === 'entry' && r.key === k; }) }; }).filter(function (x) { return x.v; });
    box.appendChild(section('Da dove arrivano', 'Fonte degli ingressi, dal sito di provenienza (solo il nome del sito, mai l\'indirizzo completo).', [bars(src)]));

    // Buttons
    var header = R.filter(function (r) { return r.metric === 'cta' && r.key === 'header-prenota'; }).sort(function (a, b) { return b.n - a.n; });
    box.appendChild(section('«Prenota» nel menu', 'Clic sul pulsante in alto, pagina per pagina.', [table(['Pagina', 'Clic'], header.map(function (r) { return [r.page, r.n]; }))]));
    var ctas = R.filter(function (r) { return r.metric === 'cta'; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 60);
    box.appendChild(section('Tutti i pulsanti', 'Nome del pulsante = dove si trova (menu, apertura, sezione 3, piè di pagina) e dove porta.', [table(['Pagina', 'Pulsante', 'Clic'], ctas.map(function (r) { return [r.page, r.key, r.n]; }))]));

    // Forms
    var forms = Object.keys(FORM).map(function (f) {
      var g = function (s) { return sum(R, function (r) { return r.metric === 'form' && r.key === f + ':' + s; }); };
      return [FORM[f], g('avviato'), g('inviato'), g('errore')];
    }).filter(function (r) { return r[1] || r[2] || r[3]; });
    box.appendChild(section('Moduli', 'Avviati = qualcuno ha iniziato a compilarli.', [table(['Modulo', 'Avviati', 'Inviati', 'Errori'], forms)]));
    var dev = ['telefono', 'computer'].map(function (k) { return { label: k === 'telefono' ? 'Telefono' : 'Computer e tablet', v: sum(R, function (r) { return r.metric === 'device' && r.key === k; }) }; });
    box.appendChild(section('Dispositivo', null, [bars(dev.filter(function (x) { return x.v; }))]));

    // This device
    var flag = false;
    try { flag = localStorage.getItem('blooming-no-stats') === '1'; } catch (e) { flag = false; }
    var cb = el('input', { type: 'checkbox', id: 'no-stats', checked: flag });
    cb.onchange = function () { try { if (cb.checked) localStorage.setItem('blooming-no-stats', '1'); else localStorage.removeItem('blooming-no-stats'); A.toast(cb.checked ? 'Questo dispositivo non viene più contato.' : 'Questo dispositivo viene contato di nuovo.'); } catch (e) { A.toast('Il browser non permette di salvare questa scelta.', 'error'); } };
    box.appendChild(section('Questo dispositivo', null, [el('label', { class: 'check', for: 'no-stats' }, [cb, el('span', { text: 'Non contare le mie visite al sito da questo browser (la scelta resta qui e non viene inviata).' })])]));
  }

  // ---------- Email ----------
  function email(box, d) {
    var c = d.current;
    box.appendChild(el('p', { class: 'hint stat-note', text: 'Il fornitore (Brevo) ci dice se un\'email è stata consegnata o respinta. Non misuriamo le aperture né i clic: nessun pixel, nessun link tracciato.' }));
    var tot = c.types.reduce(function (s, t) { s.sent += t.sent; s.delivered += t.delivered; s.bounced += t.soft_bounce + t.hard_bounce; s.errors += t.api_errors; return s; }, { sent: 0, delivered: 0, bounced: 0, errors: 0 });
    var ptot = d.previous.types.reduce(function (s, t) { return s + t.sent; }, 0);
    box.appendChild(el('div', { class: 'stat-grid' }, [
      card('Email inviate', n(tot.sent), 'Tutte le email partite dal sito.', delta(tot.sent, ptot)),
      card('Consegnate', share(tot.delivered, tot.sent), 'Confermate dal fornitore. Servono le impostazioni del webhook di Brevo.'),
      card('Respinte', n(tot.bounced), 'Indirizzo inesistente o casella piena.'),
      card('Errori di invio', n(tot.errors), 'Il fornitore non ha accettato l\'invio.'),
    ]));
    box.appendChild(section('Per tipo di email', null, [table(['Tipo', 'Inviate', 'Consegnate', 'Respinte', 'Spam', 'Bloccate', 'Errori'],
      c.types.map(function (t) { return [EMAIL[t.email_type] || t.email_type, t.sent, t.delivered, t.soft_bounce + t.hard_bounce, t.spam, t.blocked, t.api_errors]; }))]));
    box.appendChild(section('Cosa fanno le persone dai link delle email', 'Azioni fatte dalla pagina dell\'appuntamento, per email di partenza.', [table(['Email', 'Azione', 'Volte'],
      c.actions.map(function (a) { return [EMAIL[a.email_type] || a.email_type, ACTION[a.action] || a.action, a.n]; }))]));
    var k = c.confirmations;
    box.appendChild(section('Conferma della presenza', 'Appuntamenti del periodo per cui abbiamo chiesto di confermare.', [el('div', { class: 'stat-grid' }, [
      card('Confermate al primo invito', share(k.first, k.asked), 'Su ' + k.asked + ' richieste di conferma.'),
      card('Al secondo invito', share(k.second, k.asked), 'Dopo il promemoria del giorno prima.'),
      card('Mai confermate', share(k.never, k.asked), 'Nessuna conferma prima dell\'appuntamento.'),
      card('Tempo per confermare', k.medianHours == null ? '—' : n(k.medianHours) + ' ore', 'Valore centrale tra la richiesta e il clic su «Confermo».'),
    ])]));
  }

  // ---------- "Cosa richiede attenzione" ----------
  function attention(alerts) {
    var sec = el('section', { class: 'stat-attention', 'aria-labelledby': 'stat-att-h' }, [el('h2', { id: 'stat-att-h', text: 'Cosa richiede attenzione' })]);
    if (!alerts.length) { sec.appendChild(el('p', { class: 'stat-ok', text: 'Niente da segnalare.' })); return sec; }
    sec.appendChild(el('ul', { role: 'list' }, alerts.map(function (a) {
      return el('li', { class: 'att-' + a.kind }, [el('span', { class: 'att-mark', 'aria-hidden': 'true', text: a.kind === 'idea' ? '○' : a.kind === 'trend' ? '◇' : '•' }), el('span', { text: a.text })]);
    })));
    sec.appendChild(el('p', { class: 'hint', text: 'Le segnalazioni partono solo da conteggi semplici o con abbastanza casi: mai da percentuali di pochi casi.' }));
    return sec;
  }

  // ---------- summary in words (fixed, prudent rules) + note of the month ----------
  function summary(d) {
    var c = d.current, p = d.previous;
    var days = Math.round((Date.parse(d.to) - Date.parse(d.from)) / 86400000) + 1;
    var a = c.requests.total, b = p.requests.total;
    var trend = (a + b) < 10 || Math.abs(a - b) <= 2 * Math.sqrt(a + b) ? 'una differenza nella normale oscillazione' : (a > b ? 'più del solito' : 'meno del solito');
    var parts = ['Negli ultimi ' + days + ' giorni: ' + a + (a === 1 ? ' richiesta' : ' richieste') + ' di primo colloquio (nei ' + days + ' giorni prima ' + b + '), ' + trend + '.'];
    if (c.response.medianHours != null) parts.push('Risposta in circa ' + n(c.response.medianHours) + ' ore (valore centrale).');
    if (c.noShow.past) parts.push('Assenze senza avviso: ' + n(c.noShow.absent) + ' su ' + n(c.noShow.past) + ' appuntamenti.');
    var box = el('section', { class: 'stat-summary' }, [el('p', { text: parts.join(' ') }), el('p', { class: 'hint', text: 'Il riassunto dice quando qualcosa cambia, non perché: il perché lo sa chi conosce lo studio.' })]);
    var month = (d.to || today()).slice(0, 8) + '01';
    var cur = (d.notes || []).find(function (x) { return x.month === month; });
    var older = (d.notes || []).filter(function (x) { return x.month !== month && x.note; });
    var noteBox = el('div', { class: 'stat-note-month' }, [el('h3', { text: 'Nota del mese' })]);
    var show = el('p', { class: 'stat-note-text', text: cur && cur.note ? cur.note : 'Nessuna nota per questo mese.' });
    noteBox.appendChild(show);
    older.forEach(function (x) { noteBox.appendChild(el('p', { class: 'hint', text: fmtLong.format(new Date(x.month + 'T00:00:00Z')).replace(/^1 /, '') + ': ' + x.note })); });
    if (isAdmin()) {
      var ta = el('textarea', { maxlength: '600', rows: '3', 'aria-label': 'Nota del mese', 'data-stat-note': true });
      ta.value = cur ? cur.note : '';
      var save = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Salva la nota', onclick: function () {
        api('PUT', '/stats/note', { month: month, note: ta.value }).then(function (r) { show.textContent = r.note || 'Nessuna nota per questo mese.'; A.toast('Nota salvata.'); })
          .catch(function (e) { A.toast(e.message, 'error'); });
      } });
      noteBox.appendChild(el('details', { class: 'stat-note-edit' }, [el('summary', { text: 'Scrivi o cambia la nota' }), el('p', { class: 'hint', text: 'Il contesto che i numeri non sanno: ferie, un post, un cambio di orari. Niente nomi né dati delle persone.' }), ta, save]));
    }
    box.appendChild(noteBox);
    return box;
  }

  // ---------- crossings, demand × capacity, cohorts ----------
  var LEAD = { '0-3': '0–3 giorni', '4-7': '4–7 giorni', '8-14': '8–14 giorni', '15+': 'oltre 14 giorni' };
  var RESP = { '<4': 'entro 4 ore', '4-24': 'tra 4 e 24 ore', '>24': 'oltre 24 ore' };
  var CONF = { '48h': 'Confermato al primo invito (48 ore prima)', '24h': 'Confermato al secondo invito (il giorno prima)', mai: 'Mai confermato', liberato: 'Orario liberato per mancata conferma' };
  var SOURCE = { passaparola: 'Passaparola e professionisti', internet: 'Internet e social', azienda: 'Azienda', altro: 'Altro o nessuna risposta' };
  var monthName = function (m) { return new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(m + 'T00:00:00Z')); };
  function insights(box, I) {
    // Demand × capacity
    var cap = I.capacity.areas.map(function (a) {
      var weeks = a.weeksCovered == null ? (a.freeAll ? 'nessuna richiesta di recente' : '—') : (a.weeksCovered > 8 ? 'più di 8 settimane' : 'circa ' + String(Math.max(0, Math.round(a.weeksCovered))) + (Math.round(a.weeksCovered) === 1 ? ' settimana' : ' settimane'));
      return [a.name, String(a.rate).replace('.', ',') + ' (da ' + a.weekMin + ' a ' + a.weekMax + ')', a.free14, a.freeAll, a.leadMedian == null ? '—' : Math.round(a.leadMedian) + ' giorni', weeks];
    });
    box.appendChild(section('Richieste e posti, per area', 'Ritmo delle richieste delle ultime 8 settimane contro gli orari da primo colloquio ancora liberi (entro ' + ((I.capacity.areas[0] || {}).horizonDays || 60) + ' giorni). «I posti bastano per circa N settimane» se le richieste continuano a questo ritmo: è una stima, non una previsione.',
      [table(['Area', 'Richieste a settimana', 'Liberi in 2 settimane', 'Liberi in tutto', 'Anticipo', 'I posti bastano per'], cap, { empty: 'Nessun primo colloquio prenotabile online.' })]));

    // Lead time × presence and continuity (I2)
    var lead = I.lead.map(function (r) { return [LEAD[r.band], r.n, shareCell(r.presented, r.n), r.absent, r.cancelled, r.freed, shareCell(r.cont, r.contBase)]; });
    var first = I.lead[0], last = I.lead[3];
    box.appendChild(section('Anticipo e presenza al primo colloquio', 'Ultimi 12 mesi. Tempo tra la richiesta e il primo colloquio, e cosa è successo. Continuità = almeno una seduta entro 60 giorni (solo colloqui di almeno 60 giorni fa).', [
      table(['Anticipo', 'Primi colloqui', 'Presentate', 'Assenze', 'Disdette', 'Liberati', 'Continuità 60 gg'], lead.filter(function (r) { return r[1]; })),
      el('p', { class: 'stat-compare', text: compare('meno di 4 giorni', { k: first.presented, n: first.n }, 'oltre 14 giorni', { k: last.presented, n: last.n }, 'presenza') }),
    ]));

    // Response time × outcome (I1)
    var resp = I.resp.map(function (r) { return [RESP[r.band], r.n, shareCell(r.accepted, r.n), shareCell(r.presented, r.pastBase), shareCell(r.cont, r.contBase)]; });
    box.appendChild(section('Tempo di risposta ed esito', 'Ultimi 12 mesi, richieste dal sito. Le richieste rifiutate perché l\'agenda era piena non contano per la presenza. Scadute senza risposta: ' + n(I.expired) + '.', [
      table(['Risposta', 'Richieste', 'Accettate', 'Presentate', 'Continuità 60 gg'], resp.filter(function (r) { return r[1]; })),
      el('p', { class: 'stat-compare', text: compare('risposta entro 4 ore', { k: I.resp[0].presented, n: I.resp[0].pastBase }, 'risposta oltre 4 ore', { k: (I.resp[1].presented > 0 ? I.resp[1].presented : 0) + (I.resp[2].presented > 0 ? I.resp[2].presented : 0), n: (I.resp[1].pastBase > 0 ? I.resp[1].pastBase : 0) + (I.resp[2].pastBase > 0 ? I.resp[2].pastBase : 0) }, 'presenza') }),
    ]));

    // Which invitation led to the confirmation × attendance (I6)
    var conf = I.conf.map(function (r) { return [CONF[r.group], r.n, r.held, shareCell(r.absent, r.n), r.late]; });
    box.appendChild(section('Conferma della presenza e assenze', 'Ultimi 12 mesi, appuntamenti per cui abbiamo chiesto di confermare. Confronto descrittivo: chi conferma subito è in media più motivato, quindi non prova che l\'email funzioni.', [
      table(['Conferma', 'Appuntamenti', 'Svolti', 'Assenze', 'Disdette tardive'], conf.filter(function (r) { return r[1]; })),
    ]));

    // Mature cohorts
    var coh = I.cohorts.map(function (r) {
      var cell = function (k, mature) { return mature ? shareCell(r[k], r.presented) : 'in corso'; };
      return [monthName(r.month), r.base, r.presented, cell('c30', r.mature30), cell('c60', r.mature60), cell('c90', r.mature90)];
    }).filter(function (r) { return r[1]; });
    box.appendChild(section('Continuità per mese del primo colloquio', 'Dei primi colloqui di ogni mese, quanti sono stati seguiti da una seduta entro 30, 60 e 90 giorni. «In corso» finché il tempo non è passato. Un colloquio che non prosegue può essere un buon risultato.', [
      table(['Mese', 'Primi colloqui', 'Presentate', '30 giorni', '60 giorni', '90 giorni'], coh.reverse()),
    ]));
    var AREA_N = {};
    I.capacity.areas.forEach(function (a) { AREA_N[a.slug] = a.name; });
    var dim = function (rows, names) { return rows.map(function (r) { return [names[r.key] || AREA[r.key] || r.key, r.base, r.presented, shareCell(r.cont, r.contBase)]; }).filter(function (r) { return r[1]; }); };
    box.appendChild(section('Continuità per area e per fonte', 'Ultimi 12 mesi. Due tabelle separate: mai area e fonte insieme. Fonte = risposta a «Come ci hai conosciuto?», raggruppata.', [
      el('h3', { class: 'stat-sub', text: 'Per area' }),
      table(['Area', 'Primi colloqui', 'Presentate', 'Continuità 60 gg'], dim(I.byArea, AREA_N)),
      el('h3', { class: 'stat-sub', text: 'Per fonte' }),
      table(['Fonte', 'Primi colloqui', 'Presentate', 'Continuità 60 gg'], dim(I.bySource, SOURCE)),
    ]));
  }

  // ---------- CSV: the figures on screen, small groups already hidden ----------
  function exportCsv() {
    if (!st.data) return;
    // The export always follows the shared rules (small groups hidden), also for one's own figures.
    var r = periodRange();
    var q = '/stats/' + st.tab + '?export=1&from=' + r.from + '&to=' + r.to;
    if (st.tab === 'studio' && isAdmin()) q += '&professional=' + (state.scope || 'all');
    api('GET', q).then(function (d) {
      var off = el('div');
      var saved = st.data;
      st.data = d;
      if (st.tab === 'studio') studio(off, d); else if (st.tab === 'site') site(off, d); else email(off, d);
      st.data = saved;
      writeCsv(off, d);
    }).catch(function (e) { A.toast(e.message, 'error'); });
  }
  function writeCsv(box, data) {
    var stData = data;
    var lines = [['Sezione', 'Voce', 'Valore', 'Dettaglio'].join(';')];
    var q = function (s) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    lines.push([q('Periodo'), q(stData.from + ' – ' + stData.to), '', q('confronto ' + stData.prevFrom + ' – ' + stData.prevTo)].join(';'));
    box.querySelectorAll('.stat-attention li').forEach(function (li) { lines.push([q('Cosa richiede attenzione'), q(li.textContent.replace(/^[•○◇]\s*/, '')), '', ''].join(';')); });
    box.querySelectorAll('.stat-summary > p:first-child').forEach(function (p) { lines.push([q('Riassunto'), q(p.textContent), '', ''].join(';')); });
    box.querySelectorAll('.stat-compare').forEach(function (p) { lines.push([q(p.closest('.stat-section').querySelector('h2').textContent), q('Confronto'), q(p.textContent), ''].join(';')); });
    box.querySelectorAll('.stat-card').forEach(function (c) {
      var sec = c.closest('.stat-section');
      lines.push([q(sec ? sec.querySelector('h2').textContent : 'Indicatori'), q(c.querySelector('h3').textContent), q(c.querySelector('.stat-value').textContent), q([((c.querySelector('.stat-ci') || {}).textContent || ''), ((c.querySelector('.stat-delta') || {}).textContent || '')].filter(Boolean).join(' · '))].join(';'));
    });
    box.querySelectorAll('.stat-section').forEach(function (s) {
      var title = s.querySelector('h2').textContent;
      s.querySelectorAll('.stat-table tbody tr').forEach(function (tr) {
        var cells = [].map.call(tr.children, function (td) { return td.textContent; });
        lines.push([q(title), q(cells[0]), q(cells[1]), q(cells.slice(2).join(' · '))].join(';'));
      });
      s.querySelectorAll('.stat-bars li').forEach(function (li) {
        lines.push([q(title), q(li.querySelector('.stat-bar-label').textContent), q(li.querySelector('.stat-bar-n').textContent), ''].join(';'));
      });
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'statistiche-' + st.tab + '-' + stData.from + '-' + stData.to + '.csv' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
})(window.BloomingAdmin = window.BloomingAdmin || {});
