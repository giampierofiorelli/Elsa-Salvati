// Area riservata: calendario, richieste da accettare, orari settimanali, giorni bloccati, appuntamenti.
// Tutti i file dell'area condividono un solo oggetto: window.BloomingAdmin (A).
(function (A) {
  'use strict';
  // dai file caricati prima
  var $ = A.$;
  var $$ = A.$$;
  var DAY_LONG = A.DAY_LONG;
  var DAY_NAMES = A.DAY_NAMES;
  var KIND_LABEL = A.KIND_LABEL;
  var MODE_LABEL = A.MODE_LABEL;
  var addDays = A.addDays;
  var api = A.api;
  var capital = A.capital;
  var el = A.el;
  var fmtDayMonth = A.fmtDayMonth;
  var fmtLongDay = A.fmtLongDay;
  var hhmm = A.hhmm;
  var icon = A.icon;
  var isAdmin = A.isAdmin;
  var iso = A.iso;
  var minutes = A.minutes;
  var monday = A.monday;
  var myPro = A.myPro;
  var parse = A.parse;
  var proName = A.proName;
  var servicesOf = A.servicesOf;
  var singlePro = A.singlePro;
  var state = A.state;
  var toast = A.toast;
  var weekday = A.weekday;
  // usati da altri file
  A.emptyState = emptyState;
  A.loadBlocks = loadBlocks;
  A.loadPendingCount = loadPendingCount;
  A.loadRules = loadRules;
  A.pill = pill;
  A.refresh = refresh;

  // ---------- agenda: calendar ----------
  // Views: day, week (computer), month, agenda list. One anchor date (state.day) drives them all.
  // On phones (≤ 700px) the week becomes a day view with a strip of the week's days.
  var fmtMonth = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  var fmtShortMonth = new Intl.DateTimeFormat('it-IT', { month: 'short', timeZone: 'UTC' });
  var CAL_PX = 0.8; // pixels per minute: 48px per hour
  var mqPhone = window.matchMedia('(max-width: 700px)');
  function monthOf(d) { return d.slice(0, 8) + '01'; }
  function addMonths(m, n) { var dt = parse(m); dt.setUTCMonth(dt.getUTCMonth() + n); return iso(dt); }
  function monthWeeks(m) {
    var start = monday(m);
    var next = addMonths(m, 1);
    var days = Math.round((parse(next) - parse(start)) / 86400000);
    return Math.ceil(days / 7);
  }
  function anchor() { return state.day || state.today; }
  function viewNow() { return state.view === 'week' && mqPhone.matches ? 'day' : state.view; }
  function setView(v) {
    if (v === state.view) return;
    // From month back to a day or week: stay in that month (today if it is the current one).
    if (state.view === 'month' && v !== 'month') state.day = monthOf(state.today) === monthOf(anchor()) ? state.today : monthOf(anchor());
    state.view = v;
    refresh();
  }
  function step(dir) {
    var v = viewNow(), d = anchor();
    if (v === 'day') state.day = addDays(d, dir);
    else if (v === 'week') state.day = addDays(d, 7 * dir);
    else if (v === 'month') state.day = addMonths(monthOf(d), dir);
    else state.day = addDays(d, 14 * dir);
    refresh();
  }
  $('[data-prev]').addEventListener('click', function () { step(-1); });
  $('[data-next]').addEventListener('click', function () { step(1); });
  $('[data-today]').addEventListener('click', function () { state.day = state.today; refresh(); });
  $$('[data-view]').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
  });
  mqPhone.addEventListener('change', function () { if (state.route === 'agenda/calendario' && state.view === 'week') refresh(); });
  $('[data-new]').addEventListener('click', function () {
    var d = anchor();
    var v = viewNow();
    if (v === 'week') d = state.today >= monday(d) && state.today <= addDays(monday(d), 6) ? state.today : monday(d);
    openNew(d, '09:00');
  });

  function range() {
    var v = viewNow(), d = anchor();
    if (v === 'month') {
      var from = monday(monthOf(d));
      return { from: from, to: addDays(from, monthWeeks(monthOf(d)) * 7 - 1) };
    }
    if (v === 'list') return { from: d, to: addDays(d, 27) };
    return { from: monday(d), to: addDays(monday(d), 6) }; // day view loads the week for the day strip
  }

  function rangeLabel() {
    var v = viewNow(), d = anchor();
    if (v === 'month') return capital(fmtMonth.format(parse(monthOf(d))));
    if (v === 'day') return mqPhone.matches ? DAY_NAMES[weekday(d) - 1] + ' ' + parse(d).getUTCDate() + ' ' + fmtShortMonth.format(parse(d)) + ' ' + parse(d).getUTCFullYear() : capital(fmtLongDay.format(parse(d)));
    var from = v === 'week' ? monday(d) : d;
    var to = addDays(from, v === 'week' ? 6 : 27);
    var a = parse(from), b = parse(to);
    var label = a.getUTCMonth() === b.getUTCMonth()
      ? a.getUTCDate() + ' – ' + b.getUTCDate() + ' ' + fmtShortMonth.format(b) + ' ' + b.getUTCFullYear()
      : fmtDayMonth.format(a) + ' – ' + fmtDayMonth.format(b) + ' ' + b.getUTCFullYear();
    return label;
  }

  // Working hours of the professionals shown: from the weekly hours, cached per professional.
  function calPros() {
    var one = singlePro() || (!isAdmin() ? myPro() : null);
    if (one) return [one];
    return ((state.catalog && state.catalog.professionals) || state.me.professionals || [])
      .filter(function (p) { return p.active !== false; }).map(function (p) { return p.id; });
  }
  function ensureRules() {
    state.rulesCache = state.rulesCache || {};
    var missing = calPros().filter(function (id) { return !state.rulesCache[id]; });
    return Promise.all(missing.map(function (id) {
      return api('GET', '/rules' + (isAdmin() ? '?professional=' + id : '')).then(function (res) { state.rulesCache[id] = res.rules; })
        .catch(function () { state.rulesCache[id] = []; });
    }));
  }
  function calRules() {
    var out = [];
    calPros().forEach(function (id) { (state.rulesCache[id] || []).forEach(function (r) { if (r.active) out.push(r); }); });
    return out;
  }

  function refresh() {
    if (!state.day) state.day = state.today;
    var v = viewNow();
    state.weekStart = monday(anchor());
    state.month = monthOf(anchor());
    $$('[data-view]').forEach(function (x) {
      var on = x.getAttribute('data-view') === v;
      x.setAttribute('aria-pressed', String(on));
    });
    var r = range();
    $('[data-range]').textContent = rangeLabel();
    var q = '/events?cancelled=1&from=' + r.from + '&to=' + r.to + (isAdmin() ? '&professional=' + (state.scope || 'all') : '');
    loadPendingCount();
    if (state.route === 'agenda/blocchi') loadBlocks();
    return Promise.all([api('GET', q), ensureRules()]).then(function (all) {
      // Declined requests and requests that expired are not shown; cancelled appointments are, greyed.
      state.events = all[0].events.filter(function (e) { return e.status !== 'rifiutato'; });
      $('[data-week]').hidden = v !== 'week' && v !== 'day';
      $('[data-month]').hidden = v !== 'month';
      $('[data-list]').hidden = v !== 'list';
      if (v === 'week') renderWeek(); else if (v === 'day') renderDay(); else if (v === 'month') renderMonth(); else renderList();
      if (panelEv) {
        var again = state.events.find(function (e) { return e.id === panelEv.id; });
        if (again) openPanel(again); else closePanel();
      }
    }).catch(function (e) { $('[data-week]').textContent = e.message; });
  }

  // Requests from the website waiting for approval: count in the menu and the "Da accettare" list.
  function loadPendingCount() {
    return api('GET', '/events/pending').then(function (res) {
      state.pending = res.events;
      var badge = $('[data-pending-count]');
      if (badge) { badge.hidden = !res.events.length; badge.textContent = String(res.events.length); }
      if (state.route === 'agenda/da-accettare') renderPending();
    }).catch(function () { /* the agenda still works */ });
  }

  function whenText(ev) {
    return capital(fmtLongDay.format(parse(ev.date))) + ' · ' + ev.time + '–' + (ev.endDate === ev.date ? ev.endTime : '…');
  }
  function dateTile(d) {
    var dt = parse(d);
    return el('span', { class: 'date-tile', 'aria-hidden': 'true' }, [
      el('small', { text: DAY_NAMES[weekday(d) - 1] }),
      el('strong', { text: String(dt.getUTCDate()) }),
      el('small', { text: new Intl.DateTimeFormat('it-IT', { month: 'short', timeZone: 'UTC' }).format(dt) }),
    ]);
  }
  function pill(text, cls) { return el('span', { class: 'pill' + (cls ? ' pill-' + cls : ''), text: text }); }

  function renderPending() {
    var box = $('[data-pending-list]');
    box.textContent = '';
    var list = (state.pending || []).slice().sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    if (!list.length) {
      box.appendChild(emptyState('check', 'Nessuna richiesta da accettare', 'Quando qualcuno chiede un primo colloquio dal sito, la richiesta compare qui e ricevi un\'email.'));
      return;
    }
    var ul = el('ul', { class: 'rows', role: 'list' });
    list.forEach(function (ev) {
      var others = ((state.catalog && state.catalog.professionals) || state.me.professionals || []).filter(function (p) { return p.id !== ev.professionalId && p.active !== false; });
      var actions = el('div', { class: 'row-actions' }, [
        el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Accetta', onclick: function (e) {
          e.target.disabled = true;
          api('POST', '/events/' + ev.id + '/approve', {}).then(function () { toast('Richiesta accettata: la persona riceve un\'email di conferma.'); refresh(); })
            .catch(function (e2) { e.target.disabled = false; toast(e2.message, 'error'); });
        } }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Rifiuta', onclick: function () {
          if (!window.confirm('Rifiutare la richiesta? La persona riceverà un\'email per scegliere un altro orario.')) return;
          api('POST', '/events/' + ev.id + '/decline', {}).then(function () { toast('Richiesta rifiutata: la persona riceve un\'email per scegliere un altro orario.'); refresh(); })
            .catch(function (e2) { toast(e2.message, 'error'); });
        } }),
        others.length ? el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Passa alla collega', onclick: function () { openEdit(ev); } }) : null,
      ]);
      ul.appendChild(el('li', { class: 'row' }, [
        dateTile(ev.date),
        el('button', { type: 'button', class: 'row-main', onclick: function () { openEdit(ev); }, 'aria-label': 'Dettagli della richiesta di ' + (ev.name || 'persona senza nome') }, [
          el('span', { class: 'row-title' }, [el('strong', { text: ev.name || '—' }), pill('Da accettare', 'pending'), ev.lang === 'en' ? pill('EN', 'muted') : null]),
          el('span', { class: 'row-sub', text: whenText(ev) + ' · ' + (ev.serviceName || KIND_LABEL[ev.kind]) + (ev.mode ? ' · ' + MODE_LABEL[ev.mode] : '') + (isAdmin() ? ' · ' + ev.professionalName : '') }),
        ]),
        actions,
      ]));
    });
    box.appendChild(ul);
  }

  function emptyState(ic, title, text, action) {
    return el('div', { class: 'empty-state' }, [el('div', { class: 'es-icon' }, [icon(ic, 28)]), el('h2', { text: title }), text ? el('p', { class: 'hint', text: text }) : null, action || null]);
  }

  // ---------- blocked days and hours ----------
  function blockWhen(ev) {
    var allDay = ev.time === '00:00' && ev.endTime === '00:00';
    function day(d) { return fmtLongDay.format(parse(d)); }
    if (allDay) {
      var last = addDays(ev.endDate, -1);
      if (last === ev.date) return capital(day(ev.date)) + ' · giornata intera';
      var n = Math.round((parse(ev.endDate) - parse(ev.date)) / 86400000);
      return 'Da ' + day(ev.date) + ' a ' + day(last) + ' · ' + n + ' giorni';
    }
    if (ev.date === ev.endDate) return capital(day(ev.date)) + ' · ' + ev.time + '–' + ev.endTime;
    return 'Da ' + day(ev.date) + ', ' + ev.time + ' a ' + day(ev.endDate) + ', ' + ev.endTime;
  }
  function loadBlocks() {
    var from = state.today, to = addDays(state.today, 365);
    var q = '/events?from=' + from + '&to=' + to + (isAdmin() ? '&professional=' + (state.scope || 'all') : '');
    return api('GET', q).then(function (res) {
      var list = res.events.filter(function (e) { return e.kind === 'blocco'; });
      var box = $('[data-blocks-list]');
      box.textContent = '';
      if (!list.length) {
        box.appendChild(emptyState('calendar', 'Nessun giorno bloccato', 'Blocca le ferie o un impegno: in quel periodo nessuno potrà prenotare online.'));
        return;
      }
      var ul = el('ul', { class: 'rows', role: 'list' });
      list.forEach(function (ev) {
        ul.appendChild(el('li', { class: 'row' }, [
          dateTile(ev.date),
          el('button', { type: 'button', class: 'row-main', onclick: function () { openEdit(ev); } }, [
            el('span', { class: 'row-title' }, [el('strong', { text: ev.title || 'Non disponibile' }), !singlePro() ? pill(shortName(ev.professionalName), 'muted') : null]),
            el('span', { class: 'row-sub', text: blockWhen(ev) }),
          ]),
          el('div', { class: 'row-actions' }, [el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Modifica', onclick: function () { openEdit(ev); } })]),
        ]));
      });
      box.appendChild(ul);
    });
  }
  $('[data-new-block]').addEventListener('click', function () {
    openNew(state.today, '09:00');
    setKind('blocco');
    $('[data-dlg-title]').textContent = 'Blocca giorni o ore';
  });

  // ---------- calendar: shared pieces ----------
  // Short state shown on an appointment: request to approve, or whether the person confirmed.
  function evState(ev) {
    if (ev.kind === 'blocco') return null;
    if (ev.pending) return { cls: 'pending', text: 'Da accettare' };
    if (ev.status === 'annullato' && ev.cancelReason === 'tardivo') return { cls: 'late', text: 'Annullato dalla persona all\'ultimo momento' };
    if (ev.status === 'annullato' && ev.cancelReason === 'non_confermato') return { cls: 'late', text: 'Orario liberato: presenza non confermata' };
    if (ev.status !== 'confermato') return null;
    if (ev.clientConfirmedAt) return { cls: 'ok', text: 'Confermato dalla persona' };
    if ((ev.source === 'sito' || ev.notifyClient) && new Date(ev.start) > new Date()) return { cls: 'wait', text: 'In attesa di conferma' };
    return null;
  }

  // Colour class of an event: by state first, then by type.
  function evTone(ev) {
    if (ev.status === 'annullato' || ev.status === 'rifiutato') return 'off';
    if (ev.kind === 'blocco') return 'block';
    if (ev.pending) return 'pending';
    return ev.kind === 'primo_colloquio' ? 'first' : 'session';
  }
  function evStatusText(ev) {
    if (ev.status === 'annullato') { var st = evState(ev); return st ? st.text : 'Annullato'; }
    if (ev.status === 'rifiutato') return 'Rifiutata';
    if (ev.kind === 'blocco') return 'Bloccato';
    var s = evState(ev);
    return s ? s.text : 'Confermato';
  }
  function evTitle(ev) { return ev.kind === 'blocco' ? (ev.title || 'Non disponibile') : (ev.name || KIND_LABEL[ev.kind]); }
  function evOutlined(ev) { var s = evState(ev); return !!(s && s.cls === 'wait'); }

  function dayPieces(ev, day) {
    if (day < ev.date || day > ev.endDate) return null;
    var from = day === ev.date ? minutes(ev.time) : 0;
    var to = day === ev.endDate ? minutes(ev.endTime) : 24 * 60;
    if (to <= from) return null;
    return { from: from, to: to };
  }
  function isAllDay(p) { return p.from === 0 && p.to === 24 * 60; }

  function shortName(name) {
    var parts = String(name || '').replace(/^(Dott\.ssa|Dott\.|Dr\.ssa|Dr\.)\s+/i, '').split(/\s+/);
    return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1][0] + '.' : parts[0];
  }

  // Current date and minute in the studio's time zone (Europe/Rome), whatever the computer's zone.
  var fmtRome = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function romeNow() {
    var p = {};
    fmtRome.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, min: Number(p.hour) * 60 + Number(p.minute) };
  }

  // Side-by-side columns for events that overlap (like Google Calendar).
  function layoutPieces(items) {
    items.sort(function (a, b) { return a.from - b.from || b.to - a.to; });
    var cluster = [], clusterEnd = -1, cols = [];
    function flush() {
      cluster.forEach(function (it) { it.cols = cols.length; });
      cluster = []; cols = [];
    }
    items.forEach(function (it) {
      if (it.from >= clusterEnd) { flush(); clusterEnd = -1; }
      var c = 0;
      while (cols[c] !== undefined && cols[c] > it.from) c++;
      cols[c] = it.to;
      it.col = c;
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.to);
    });
    flush();
    return items;
  }

  function hoursRange(days) {
    var rules = calRules();
    var startMin = Infinity, endMin = -Infinity;
    rules.forEach(function (r) { startMin = Math.min(startMin, minutes(r.start_time)); endMin = Math.max(endMin, minutes(r.end_time)); });
    state.events.forEach(function (e) {
      if (e.status === 'annullato' && e.kind === 'blocco') return;
      days.forEach(function (d) {
        var p = dayPieces(e, d);
        if (!p || isAllDay(p)) return;
        startMin = Math.min(startMin, p.from);
        endMin = Math.max(endMin, p.to);
      });
    });
    if (startMin === Infinity) { startMin = 9 * 60; endMin = 18 * 60; }
    startMin = Math.floor(startMin / 60) * 60;
    endMin = Math.min(24 * 60, Math.max(startMin + 60, Math.ceil(endMin / 60) * 60));
    return { start: startMin, end: endMin };
  }

  function evButton(ev, p, compact) {
    var tone = evTone(ev);
    var title = evTitle(ev);
    var showPro = !singlePro();
    var sub = ev.kind === 'blocco' ? '' : (ev.serviceName || KIND_LABEL[ev.kind]) + (ev.mode ? ' · ' + MODE_LABEL[ev.mode] : '');
    if (showPro && ev.kind !== 'blocco') sub = shortName(ev.professionalName) + (sub ? ' · ' + sub : '');
    var timeText = p && !isAllDay(p) ? hhmm(p.from) : '';
    var b = el('button', {
      type: 'button',
      class: 'ev ev-' + tone + (evOutlined(ev) ? ' ev-outline' : '') + (compact ? ' ev-tight' : ''),
      'aria-label': title + ', ' + (timeText ? hhmm(p.from) + '–' + hhmm(Math.min(p.to, 1439)) + ', ' : '') + evStatusText(ev),
      title: title + (timeText ? ' · ' + hhmm(p.from) + '–' + hhmm(Math.min(p.to, 1439)) : '') + ' · ' + evStatusText(ev),
    }, [
      el('span', { class: 'ev-line' }, [timeText ? el('time', { text: timeText }) : null, el('strong', { text: title })]),
      sub ? el('span', { class: 'ev-sub', text: sub }) : null,
    ]);
    b.addEventListener('click', function (e) { e.stopPropagation(); openPanel(ev); });
    return b;
  }

  // ---------- time grid: week and day ----------
  function weekDays() {
    var start = monday(anchor());
    var days = [];
    for (var i = 0; i < 7; i++) days.push(addDays(start, i));
    var rules = calRules();
    return days.filter(function (d) {
      var wd = weekday(d);
      if (wd < 6 || d === state.today) return true;
      return rules.some(function (r) { return Number(r.weekday) === wd; })
        || state.events.some(function (e) { return e.status !== 'annullato' && dayPieces(e, d); });
    });
  }

  function renderWeek() { renderGrid(weekDays(), null); }

  function renderDay() {
    var d = anchor();
    var strip = el('div', { class: 'day-strip', role: 'group', 'aria-label': 'Giorni della settimana' });
    for (var i = 0; i < 7; i++) {
      (function (day) {
        var n = state.events.filter(function (e) { return e.status !== 'annullato' && dayPieces(e, day); }).length;
        strip.appendChild(el('button', {
          type: 'button', class: 'ds-day' + (day === d ? ' on' : '') + (day === state.today ? ' today' : ''),
          'aria-pressed': String(day === d), 'aria-label': capital(fmtLongDay.format(parse(day))) + (n ? ', ' + n + (n === 1 ? ' impegno' : ' impegni') : ''),
          onclick: function () { state.day = day; refresh(); },
        }, [
          el('small', { text: DAY_NAMES[weekday(day) - 1].charAt(0) }),
          el('strong', { text: String(parse(day).getUTCDate()) }),
          el('i', { class: n ? 'ds-dot' : 'ds-dot ds-none', 'aria-hidden': 'true' }),
        ]));
      })(addDays(monday(d), i));
    }
    renderGrid([d], strip);
  }

  var nowTimer = null;
  function renderGrid(days, before) {
    var hr = hoursRange(days);
    var startMin = hr.start, endMin = hr.end;
    var height = (endMin - startMin) * CAL_PX;
    var rules = calRules();
    var single = days.length === 1;

    var cal = el('div', { class: 'cal' + (single ? ' cal-single' : '') });
    cal.style.setProperty('--days', String(days.length));

    // Header: weekday and date (today in a filled circle), then the row of all-day blocks.
    var head = el('div', { class: 'cal-head' });
    head.appendChild(el('div', { class: 'cal-corner' }));
    days.forEach(function (d) {
      head.appendChild(el('div', { class: 'cal-dh' + (d === state.today ? ' today' : '') }, [
        el('small', { text: DAY_NAMES[weekday(d) - 1] }),
        el('span', { class: 'cal-num', text: String(parse(d).getUTCDate()) }),
      ]));
    });
    var allDay = days.map(function (d) {
      return state.events.filter(function (e) { var p = dayPieces(e, d); return p && isAllDay(p); });
    });
    if (allDay.some(function (l) { return l.length; })) {
      head.appendChild(el('div', { class: 'cal-corner cal-ad-label', text: 'Tutto il giorno' }));
      allDay.forEach(function (list, i) {
        var cell = el('div', { class: 'cal-ad' });
        list.forEach(function (ev) { cell.appendChild(evButton(ev, dayPieces(ev, days[i]), true)); });
        head.appendChild(cell);
      });
    }
    cal.appendChild(head);

    var body = el('div', { class: 'cal-body' });
    var gutter = el('div', { class: 'cal-gutter' });
    gutter.style.height = height + 'px';
    for (var m = startMin + 60; m < endMin; m += 60) {
      var lab = el('span', { class: 'cal-hour', text: hhmm(m) });
      lab.style.top = ((m - startMin) * CAL_PX) + 'px';
      gutter.appendChild(lab);
    }
    body.appendChild(gutter);

    days.forEach(function (d) {
      var col = el('div', { class: 'cal-col' + (d === state.today ? ' today' : ''), 'data-date': d });
      col.style.height = height + 'px';
      // Working hours: white; outside them the column stays shaded. Online booking: thin green edge.
      rules.forEach(function (r) {
        if (Number(r.weekday) !== weekday(d)) return;
        var a = Math.max(minutes(r.start_time), startMin), z = Math.min(minutes(r.end_time), endMin);
        if (z <= a) return;
        var w = el('div', { class: 'cal-work' + (r.public ? ' cal-public' : ''), title: (r.public ? 'Prenotabile online ' : 'Orario di lavoro ') + r.start_time + '–' + r.end_time });
        w.style.top = ((a - startMin) * CAL_PX) + 'px';
        w.style.height = ((z - a) * CAL_PX) + 'px';
        col.appendChild(w);
      });
      for (var h = startMin + 30; h < endMin; h += 30) {
        var line = el('div', { class: h % 60 ? 'cal-half' : 'cal-line' });
        line.style.top = ((h - startMin) * CAL_PX) + 'px';
        col.appendChild(line);
      }
      var items = [];
      state.events.forEach(function (ev) {
        var p = dayPieces(ev, d);
        if (!p || isAllDay(p)) return;
        var from = Math.max(p.from, startMin), to = Math.min(p.to, endMin);
        if (to <= from) return;
        items.push({ ev: ev, p: p, from: from, to: to });
      });
      layoutPieces(items).forEach(function (it) {
        var hPx = Math.max(18, (it.to - it.from) * CAL_PX - 2);
        var b = evButton(it.ev, it.p, hPx < 34);
        b.style.top = ((it.from - startMin) * CAL_PX + 1) + 'px';
        b.style.height = hPx + 'px';
        var wPct = 100 / it.cols;
        b.style.left = 'calc(' + (it.col * wPct) + '% + 2px)';
        b.style.width = 'calc(' + wPct + '% - 4px)';
        col.appendChild(b);
      });
      col.addEventListener('click', function (e) {
        var rect = col.getBoundingClientRect();
        var mins = startMin + Math.floor((e.clientY - rect.top) / CAL_PX / 30) * 30;
        openNew(d, hhmm(Math.max(0, Math.min(mins, 23 * 60 + 30))));
      });
      body.appendChild(col);
    });
    cal.appendChild(body);

    var wrap = $('[data-week]');
    wrap.textContent = '';
    if (before) wrap.appendChild(before);
    wrap.appendChild(cal);

    // The red line at the current time in Rome, moved every minute.
    function placeNow() {
      var old = $('.cal-now', cal);
      if (old) old.remove();
      var now = romeNow();
      var col = $('.cal-col[data-date="' + now.date + '"]', cal);
      if (!col || now.min < startMin || now.min > endMin) return;
      var n = el('div', { class: 'cal-now', 'aria-hidden': 'true' });
      n.style.top = ((now.min - startMin) * CAL_PX) + 'px';
      col.appendChild(n);
    }
    placeNow();
    clearInterval(nowTimer);
    nowTimer = setInterval(function () { if (document.body.contains(cal)) placeNow(); else clearInterval(nowTimer); }, 60000);
  }

  // Swipe left or right on the day view to change day.
  (function () {
    var wrap = $('[data-week]'), x0 = null, y0 = 0;
    wrap.addEventListener('touchstart', function (e) { if (viewNow() !== 'day' || e.touches.length !== 1) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    wrap.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    }, { passive: true });
  })();

  // ---------- month ----------
  function renderMonth() {
    var m = monthOf(anchor());
    var start = monday(m);
    var weeks = monthWeeks(m);
    var grid = el('div', { class: 'month' });
    DAY_NAMES.forEach(function (n) { grid.appendChild(el('div', { class: 'month-head', text: n })); });
    for (var i = 0; i < weeks * 7; i++) {
      (function (d) {
        var inMonth = d.slice(0, 7) === m.slice(0, 7);
        var evs = state.events.filter(function (e) { return dayPieces(e, d); });
        var live = evs.filter(function (e) { return e.status !== 'annullato'; });
        var cell = el('div', { class: 'month-cell' + (inMonth ? '' : ' out') + (d === state.today ? ' today' : '') });
        var open = function () { state.day = d; setView('day'); };
        cell.appendChild(el('button', {
          type: 'button', class: 'month-day', onclick: open,
          'aria-label': capital(fmtLongDay.format(parse(d))) + (live.length ? ', ' + live.length + (live.length === 1 ? ' impegno' : ' impegni') : ''),
        }, [el('span', { class: 'cal-num', text: String(parse(d).getUTCDate()) })]));
        var ul = el('ul', { class: 'month-evs', role: 'list' });
        evs.slice(0, 3).forEach(function (ev) {
          var p = dayPieces(ev, d);
          ul.appendChild(el('li', {}, [el('button', {
            type: 'button', class: 'mchip mchip-' + evTone(ev) + (evOutlined(ev) ? ' mchip-outline' : ''), title: evTitle(ev) + ' · ' + evStatusText(ev),
            onclick: function () { openPanel(ev); },
          }, [
            el('i', { class: 'mdot', 'aria-hidden': 'true' }),
            isAllDay(p) ? null : el('time', { text: hhmm(p.from) }),
            el('span', { text: evTitle(ev) }),
          ])]));
        });
        if (evs.length > 3) ul.appendChild(el('li', {}, [el('button', { type: 'button', class: 'mmore', text: '+' + (evs.length - 3) + ' altri', onclick: open })]));
        cell.appendChild(ul);
        // Phones: coloured dots and the number of appointments instead of the list.
        if (live.length) {
          var dots = el('span', { class: 'mdots', 'aria-hidden': 'true' });
          live.slice(0, 3).forEach(function (ev) { dots.appendChild(el('i', { class: 'mdot mdot-' + evTone(ev) })); });
          if (live.length > 3) dots.appendChild(el('b', { text: String(live.length) }));
          cell.appendChild(dots);
        }
        cell.addEventListener('click', function (e) { if (e.target === cell) open(); });
        grid.appendChild(cell);
      })(addDays(start, i));
    }
    var wrap = $('[data-month]');
    wrap.textContent = '';
    wrap.appendChild(grid);
  }

  // ---------- agenda list: the next four weeks, grouped by day ----------
  function renderList() {
    var box = $('[data-list]');
    box.textContent = '';
    if (!state.events.length) { box.appendChild(el('p', { class: 'empty', text: 'Nessun impegno in queste quattro settimane.' })); return; }
    var byDay = {};
    var r = range();
    state.events.forEach(function (e) {
      for (var d = e.date < r.from ? r.from : e.date; d <= e.endDate && d <= r.to; d = addDays(d, 1)) {
        if (dayPieces(e, d)) (byDay[d] = byDay[d] || []).push(e);
      }
    });
    Object.keys(byDay).sort().forEach(function (d) {
      var dt = parse(d);
      var section = el('section', { class: 'ag-day' + (d === state.today ? ' today' : '') }, [
        el('h3', { class: 'ag-h' }, [
          el('span', { class: 'cal-num', text: String(dt.getUTCDate()) }),
          el('span', { text: (d === state.today ? 'Oggi · ' : '') + DAY_LONG[weekday(d) - 1] + ' · ' + new Intl.DateTimeFormat('it-IT', { month: 'long', timeZone: 'UTC' }).format(dt) }),
        ]),
      ]);
      var ul = el('ul', { class: 'ag-list', role: 'list' });
      byDay[d].forEach(function (ev) {
        var p = dayPieces(ev, d);
        var sub = ev.kind === 'blocco' ? '' : [!singlePro() ? shortName(ev.professionalName) : null, ev.serviceName || KIND_LABEL[ev.kind], ev.mode ? MODE_LABEL[ev.mode] : null].filter(Boolean).join(' · ');
        ul.appendChild(el('li', {}, [el('button', { type: 'button', class: 'ag-item ag-' + evTone(ev) + (evOutlined(ev) ? ' ag-outline' : ''), onclick: function () { openPanel(ev); } }, [
          el('time', { text: isAllDay(p) ? 'Tutto il giorno' : hhmm(p.from) + '–' + hhmm(Math.min(p.to, 1439)) }),
          el('i', { class: 'ag-bar', 'aria-hidden': 'true' }),
          el('span', { class: 'ag-main' }, [el('strong', { text: evTitle(ev) }), sub ? el('span', { text: sub }) : null]),
          el('span', { class: 'ag-st', text: evStatusText(ev) }),
        ])]));
      });
      section.appendChild(ul);
      box.appendChild(section);
    });
  }

  // ---------- side panel: details and actions of one appointment ----------
  var panelEv = null;
  var panel = el('aside', { class: 'ev-panel', 'data-ev-panel': true, hidden: true, 'aria-labelledby': 'evp-title', tabindex: '-1' });
  document.body.appendChild(panel);
  function closePanel() {
    panelEv = null;
    panel.hidden = true;
    document.body.classList.remove('evp-open');
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden && !document.querySelector('dialog[open]')) closePanel(); });
  window.addEventListener('hashchange', closePanel);

  function panelAction(btn, call, okText) {
    btn.disabled = true;
    call().then(function () { toast(okText); closePanel(); refresh(); })
      .catch(function (e) { btn.disabled = false; toast(e.message, 'error'); });
  }

  function openPanel(ev) {
    panelEv = ev;
    var tone = evTone(ev);
    var off = tone === 'off';
    var st = evState(ev);
    var facts = el('dl', { class: 'evp-facts' });
    function fact(label, value) { if (value) facts.appendChild(el('div', {}, [el('dt', { text: label }), el('dd', {}, [value])])); }
    var when = capital(fmtLongDay.format(parse(ev.date))) + (ev.kind === 'blocco' && ev.time === '00:00' && ev.endTime === '00:00'
      ? (addDays(ev.date, 1) === ev.endDate ? ', tutto il giorno' : ' – ' + fmtLongDay.format(parse(addDays(ev.endDate, -1))))
      : ' · ' + ev.time + '–' + (ev.endDate === ev.date ? ev.endTime : fmtDayMonth.format(parse(ev.endDate)) + ' ' + ev.endTime));
    fact('Quando', when);
    if (!singlePro() || isAdmin()) fact('Professionista', ev.professionalName);
    if (ev.kind !== 'blocco') {
      fact('Servizio', ev.serviceName || KIND_LABEL[ev.kind]);
      fact('Modalità', ev.mode ? MODE_LABEL[ev.mode] : '');
      fact('Arrivato da', ev.source === 'sito' ? 'Prenotazione dal sito' : 'Fissato in agenda');
      fact('Email', ev.email ? el('a', { href: 'mailto:' + ev.email, text: ev.email }) : '');
      fact('Telefono', ev.phone ? el('a', { href: 'tel:' + ev.phone.replace(/\s+/g, ''), text: ev.phone }) : '');
      fact('Nota', ev.note);
      if (ev.clientConfirmedAt) fact('Presenza confermata', new Date(ev.clientConfirmedAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }));
    }

    var actions = el('div', { class: 'evp-actions' });
    var extra = el('div', { class: 'evp-extra' });
    if (!off && ev.pending) {
      var acc = el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Accetta' });
      acc.onclick = function () { panelAction(acc, function () { return api('POST', '/events/' + ev.id + '/approve', {}); }, 'Richiesta accettata: la persona riceve un\'email di conferma.'); };
      var dec = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Rifiuta' });
      dec.onclick = function () {
        if (!window.confirm('Rifiutare la richiesta? La persona riceverà un\'email per scegliere un altro orario.')) return;
        panelAction(dec, function () { return api('POST', '/events/' + ev.id + '/decline', {}); }, 'Richiesta rifiutata.');
      };
      actions.appendChild(acc);
      actions.appendChild(dec);
      var others = ((state.catalog && state.catalog.professionals) || state.me.professionals || []).filter(function (p) { return p.id !== ev.professionalId && p.active !== false; });
      if (others.length) {
        var sel = el('select', { 'aria-label': 'Collega a cui passare la richiesta' });
        others.forEach(function (p) { sel.appendChild(el('option', { value: p.id, text: p.name })); });
        var pass = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Passa alla collega' });
        pass.onclick = function () { panelAction(pass, function () { return api('POST', '/events/' + ev.id + '/reassign', { professionalId: sel.value }); }, 'Richiesta passata alla collega.'); };
        extra.appendChild(el('div', { class: 'evp-pass' }, [sel, pass]));
      }
      extra.appendChild(el('p', { class: 'hint', text: 'Se non la accetti entro le ' + ((state.settings && state.settings.approvalDeadline) || '18:00') + ' dell\'ultimo giorno lavorativo prima, scade e la persona riceve un\'email per scegliere un altro orario.' }));
    }
    if (!off && st && st.cls === 'wait' && ev.confirmRequested) {
      if (ev.email) {
        actions.appendChild(el('a', {
          class: 'btn btn-ghost btn-small', text: 'Scrivi alla persona',
          href: 'mailto:' + encodeURIComponent(ev.email).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(ev.lang === 'en' ? 'Your appointment – Blooming' : 'Il tuo appuntamento – Blooming'),
        }));
      }
      var free = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Libera l\'orario' });
      free.onclick = function () {
        if (!window.confirm('Liberare l\'orario? L\'appuntamento viene annullato e la persona riceve un\'email che le spiega cosa fare se non aveva confermato per errore.')) return;
        panelAction(free, function () { return api('POST', '/events/' + ev.id + '/cancel', { scope: 'one', reason: 'non_confermato' }); }, 'Orario liberato.');
      };
      actions.appendChild(free);
    }
    if (!off) {
      actions.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Modifica', onclick: function () { closePanel(); openEdit(ev); } }));
      actions.appendChild(el('button', {
        type: 'button', class: 'btn btn-danger btn-small',
        text: ev.kind === 'blocco' ? 'Elimina blocco' : (ev.pending ? 'Annulla la richiesta' : 'Annulla'),
        onclick: function () { closePanel(); openEdit(ev); $('[data-cancel]').click(); },
      }));
    }

    panel.textContent = '';
    panel.appendChild(el('div', { class: 'evp-head' }, [
      el('span', { class: 'evp-kind', text: ev.kind === 'blocco' ? 'Blocco' : KIND_LABEL[ev.kind] }),
      el('button', { type: 'button', class: 'icon-btn evp-close', 'aria-label': 'Chiudi i dettagli', onclick: closePanel }, [icon('x', 18)]),
    ]));
    panel.appendChild(el('div', { class: 'evp-body' }, [
      el('h2', { id: 'evp-title', class: off ? 'evp-off' : '', text: evTitle(ev) }),
      el('p', { class: 'evp-status evp-' + tone + (evOutlined(ev) ? ' evp-outline' : '') }, [el('i', { 'aria-hidden': 'true' }), evStatusText(ev)]),
      facts,
      actions.childNodes.length ? actions : null,
      extra.childNodes.length ? extra : null,
    ]));
    panel.hidden = false;
    document.body.classList.add('evp-open');
    panel.focus({ preventScroll: true });
  }

  // ---------- appointment dialog ----------
  var dlg = $('[data-dialog]');
  var form = $('[data-event-form]');

  function fillServiceSelect(proId, selected) {
    var sel = form.serviceId;
    sel.textContent = '';
    sel.appendChild(el('option', { value: '', text: '—' }));
    servicesOf(proId).forEach(function (s) { sel.appendChild(el('option', { value: s.id, text: s.name })); });
    sel.value = selected || '';
  }

  function setKind(kind) {
    state.kind = kind;
    $$('[data-kind]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-kind') === kind)); });
    $('[data-appt-fields]').hidden = kind === 'blocco';
    $('[data-block-fields]').hidden = kind !== 'blocco';
  }
  $$('[data-kind]').forEach(function (b) { b.addEventListener('click', function () { setKind(b.getAttribute('data-kind')); }); });
  form.repeat.addEventListener('change', function () { $('[data-repeat-fields]').hidden = !form.repeat.checked; });
  form.allDay.addEventListener('change', function () { $$('[data-time-field]').forEach(function (f) { f.hidden = form.allDay.checked; }); });
  form.professionalId.addEventListener('change', function () { fillServiceSelect(form.professionalId.value); });
  form.serviceId.addEventListener('change', function () {
    var s = state.catalog.services.find(function (x) { return x.id === form.serviceId.value; });
    if (s && !state.editing) form.durationMinutes.value = s.durationMinutes;
  });
  $('[data-close]').addEventListener('click', function () { dlg.close(); });

  function resetDialog() {
    form.reset();
    $('[data-dlg-error]').textContent = '';
    $('[data-cancel-box]').hidden = true;
    $('[data-repeat-fields]').hidden = true;
    $$('[data-time-field]').forEach(function (f) { f.hidden = true; });
    $('[data-save]').hidden = false;
    $('[data-approve]').hidden = true;
    $('[data-decline]').hidden = true;
    $('[data-write-person]').hidden = true;
    $('[data-free-slot]').hidden = true;
    $('[data-reassign-box]').hidden = true;
    $('[data-ev-status]').hidden = true;
  }

  function openNew(date, time) {
    var proId = singlePro() || myPro() || (state.me.professionals[0] && state.me.professionals[0].id);
    if (!proId) { window.alert('Crea prima una professionista in Studio → Professioniste.'); return; }
    state.editing = null;
    resetDialog();
    $('[data-dlg-title]').textContent = 'Nuovo';
    $('[data-kind-group]').hidden = false;
    $('[data-repeat-box]').hidden = false;
    $('[data-send-box]').hidden = false;
    $('[data-cancel]').hidden = true;
    var pf = $('[data-ev-pro-field]');
    pf.hidden = !isAdmin();
    if (isAdmin()) {
      form.professionalId.textContent = '';
      state.me.professionals.forEach(function (p) { form.professionalId.appendChild(el('option', { value: p.id, text: p.name })); });
      form.professionalId.value = proId;
    }
    fillServiceSelect(proId);
    form.date.value = date;
    form.time.value = time;
    form.durationMinutes.value = state.settings ? state.settings.sessionMinutes : 50;
    form.startDate.value = date;
    form.endDate.value = date;
    form.startTime.value = time;
    form.endTime.value = hhmm(Math.min(minutes(time) + 60, 23 * 60 + 55));
    setKind('seduta');
    dlg.showModal();
  }

  function openEdit(ev) {
    state.editing = ev;
    resetDialog();
    $('[data-dlg-title]').textContent = (ev.kind === 'blocco' ? 'Blocco' : KIND_LABEL[ev.kind] + (ev.source === 'sito' ? ' (dal sito)' : ''))
      + (isAdmin() ? ' · ' + ev.professionalName : '');
    $('[data-kind-group]').hidden = true;
    $('[data-repeat-box]').hidden = true;
    $('[data-send-box]').hidden = true;
    $('[data-ev-pro-field]').hidden = true;
    $('[data-cancel]').hidden = false;
    $('[data-cancel]').textContent = ev.kind === 'blocco' ? 'Elimina blocco' : (ev.pending ? 'Annulla la richiesta' : 'Annulla appuntamento');
    setKind(ev.kind);
    // Emails to the person can be turned on for appointments set by hand.
    $('[data-send-box]').hidden = ev.kind === 'blocco' || ev.source !== 'manuale';
    form.sendEmail.checked = !!ev.notifyClient;
    form.emailLang.value = ev.lang || 'it';
    var st = evState(ev);
    var stBox = $('[data-ev-status]');
    if (ev.pending) {
      stBox.textContent = 'Richiesta dal sito, da accettare. Se non la accetti entro le ' + ((state.settings && state.settings.approvalDeadline) || '18:00') + ' dell\'ultimo giorno lavorativo prima, scade e la persona riceve un\'email per scegliere un altro orario.';
      stBox.hidden = false;
      $('[data-approve]').hidden = false;
      $('[data-decline]').hidden = false;
      // "Passa alla collega": the other active professionals.
      var others = ((state.catalog && state.catalog.professionals) || state.me.professionals || []).filter(function (p) { return p.id !== ev.professionalId && p.active !== false; });
      var sel = $('[data-reassign-to]');
      sel.textContent = '';
      others.forEach(function (p) { sel.appendChild(el('option', { value: p.id, text: p.name })); });
      $('[data-reassign-box]').hidden = !others.length;
      $('[data-save]').hidden = true;
    } else if (st) {
      // Asked to confirm and not confirmed yet: write to the person, or free the time (she gets an email
      // explaining what to do if it was a mistake). Nothing is cancelled automatically.
      if (st.cls === 'wait' && ev.confirmRequested) {
        if (ev.email) {
          var w = $('[data-write-person]');
          w.href = 'mailto:' + encodeURIComponent(ev.email).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(ev.lang === 'en' ? 'Your appointment – Blooming' : 'Il tuo appuntamento – Blooming');
          w.hidden = false;
        }
        $('[data-free-slot]').hidden = false;
      }
      stBox.textContent = st.text + (ev.clientConfirmedAt ? ' il ' + new Date(ev.clientConfirmedAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) : '') + '.';
      stBox.hidden = false;
    }
    if (ev.kind === 'blocco') {
      form.title.value = ev.title;
      var allDay = ev.time === '00:00' && ev.endTime === '00:00';
      form.allDay.checked = allDay;
      $$('[data-time-field]').forEach(function (f) { f.hidden = allDay; });
      form.startDate.value = ev.date;
      form.endDate.value = allDay ? addDays(ev.endDate, -1) : ev.endDate;
      form.startTime.value = ev.time;
      form.endTime.value = ev.endTime;
    } else {
      fillServiceSelect(ev.professionalId, ev.serviceId);
      form.date.value = ev.date;
      form.time.value = ev.time;
      form.durationMinutes.value = Math.round((new Date(ev.end) - new Date(ev.start)) / 60000);
      form.mode.value = ev.mode || '';
      form.name.value = ev.name;
      form.email.value = ev.email;
      form.phone.value = ev.phone;
      form.note.value = ev.note;
    }
    dlg.showModal();
  }

  function eventPayload() {
    if (state.kind === 'blocco') {
      return {
        kind: 'blocco', title: form.title.value.trim(), allDay: form.allDay.checked,
        startDate: form.startDate.value, endDate: form.endDate.value || form.startDate.value,
        startTime: form.startTime.value, endTime: form.endTime.value,
        professionalId: isAdmin() && !state.editing ? form.professionalId.value : undefined,
      };
    }
    var p = {
      kind: state.kind, date: form.date.value, time: form.time.value,
      durationMinutes: Number(form.durationMinutes.value), mode: form.mode.value || null, serviceId: form.serviceId.value || null,
      name: form.name.value.trim(), email: form.email.value.trim(), phone: form.phone.value.trim(), note: form.note.value.trim(),
    };
    if (!state.editing) {
      if (isAdmin()) p.professionalId = form.professionalId.value;
      if (form.repeat.checked) p.repeat = { count: Number(form.count.value), intervalWeeks: Number(form.intervalWeeks.value) };
    }
    if (!state.editing || state.editing.source === 'manuale') {
      p.sendEmail = form.sendEmail.checked;
      p.emailLang = form.emailLang.value;
    }
    return p;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('[data-dlg-error]');
    err.textContent = '';
    var p = eventPayload();
    var req = state.editing ? api('PATCH', '/events/' + state.editing.id, p) : api('POST', '/events', p);
    req.then(function (res) {
      dlg.close();
      toast(state.editing ? 'Modifiche salvate.' : (state.kind === 'blocco' ? 'Periodo bloccato.' : 'Appuntamento creato.'));
      if (res.skipped && res.skipped.length) {
        window.alert('Creati ' + res.created.length + ' incontri. Saltati per sovrapposizione: ' + res.skipped.map(function (s) { return s.date; }).join(', '));
      }
      refresh();
    }).catch(function (e2) {
      var msg = e2.message;
      if (e2.data && e2.data.conflicts) msg += ' (' + e2.data.conflicts.length + ' appuntamenti nel periodo)';
      err.textContent = msg;
    });
  });

  $('[data-cancel]').addEventListener('click', function () {
    var ev = state.editing;
    $('[data-cancel-box]').hidden = false;
    $('[data-scope-box]').hidden = !ev.seriesId;
    $('[data-notify-box]').hidden = ev.kind === 'blocco' || !ev.email;
    $('[data-save]').hidden = true;
    this.hidden = true;
  });
  $('[data-reassign]').addEventListener('click', function () {
    var ev = state.editing;
    var to = $('[data-reassign-to]').value;
    if (!to) return;
    api('POST', '/events/' + ev.id + '/reassign', { professionalId: to }).then(function () { dlg.close(); toast('Richiesta passata alla collega.'); refresh(); })
      .catch(function (e) { $('[data-dlg-error]').textContent = e.message; });
  });
  $('[data-free-slot]').addEventListener('click', function () {
    var ev = state.editing;
    if (!window.confirm('Liberare l\'orario? L\'appuntamento viene annullato e la persona riceve un\'email che le spiega cosa fare se non aveva confermato per errore.')) return;
    api('POST', '/events/' + ev.id + '/cancel', { scope: 'one', reason: 'non_confermato' }).then(function () { dlg.close(); toast('Orario liberato.'); refresh(); })
      .catch(function (e) { $('[data-dlg-error]').textContent = e.message; });
  });
  $('[data-approve]').addEventListener('click', function () {
    var ev = state.editing;
    api('POST', '/events/' + ev.id + '/approve', {}).then(function () { dlg.close(); toast('Richiesta accettata: la persona riceve un\'email di conferma.'); refresh(); })
      .catch(function (e) { $('[data-dlg-error]').textContent = e.message; });
  });
  $('[data-decline]').addEventListener('click', function () {
    var ev = state.editing;
    if (!window.confirm('Rifiutare la richiesta? La persona riceverà un\'email per scegliere un altro orario.')) return;
    api('POST', '/events/' + ev.id + '/decline', {}).then(function () { dlg.close(); toast('Richiesta rifiutata.'); refresh(); })
      .catch(function (e) { $('[data-dlg-error]').textContent = e.message; });
  });
  $('[data-abort-cancel]').addEventListener('click', function () {
    $('[data-cancel-box]').hidden = true;
    $('[data-save]').hidden = false;
    $('[data-cancel]').hidden = false;
  });
  $('[data-confirm-cancel]').addEventListener('click', function () {
    var ev = state.editing;
    api('POST', '/events/' + ev.id + '/cancel', { scope: form.following.checked ? 'following' : 'one', notify: form.notify.checked })
      .then(function () { dlg.close(); toast(ev.kind === 'blocco' ? 'Blocco eliminato.' : 'Appuntamento annullato.'); refresh(); })
      .catch(function (e) { $('[data-dlg-error]').textContent = e.message; });
  });

  // ---------- weekly hours ----------
  function loadRules() {
    var pro = singlePro();
    if (!pro) { state.rules = []; renderRules(); return Promise.resolve(); }
    return api('GET', '/rules' + (isAdmin() ? '?professional=' + pro : '')).then(function (res) { state.rules = res.rules; renderRules(); });
  }

  function ruleRow(r) {
    var row = el('div', { class: 'rule' });
    var daySel = el('select', { 'aria-label': 'Giorno', name: 'weekday' });
    DAY_LONG.forEach(function (n, i) {
      var o = el('option', { value: String(i + 1), text: n });
      if (Number(r.weekday) === i + 1) o.selected = true;
      daySel.appendChild(o);
    });
    var modeSel = el('select', { 'aria-label': 'Modalità', name: 'mode' });
    [['entrambi', 'Studio e online'], ['studio', 'Solo studio'], ['online', 'Solo online']].forEach(function (m) {
      var o = el('option', { value: m[0], text: m[1] });
      if (r.mode === m[0]) o.selected = true;
      modeSel.appendChild(o);
    });
    var pub = el('input', { type: 'checkbox', name: 'public' }); pub.checked = r.public !== false;
    var act = el('input', { type: 'checkbox', name: 'active' }); act.checked = r.active !== false;
    row.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Giorno' }), daySel]));
    row.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Dalle' }), el('input', { type: 'time', name: 'start_time', value: r.start_time, step: '300' })]));
    row.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Alle' }), el('input', { type: 'time', name: 'end_time', value: r.end_time, step: '300' })]));
    row.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Modalità' }), modeSel]));
    row.appendChild(el('label', { class: 'check' }, [pub, el('span', { text: 'Prenotabile online' })]));
    row.appendChild(el('label', { class: 'check' }, [act, el('span', { text: 'Attiva' })]));
    row.appendChild(el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Rimuovi', onclick: function () { row.remove(); } }));
    return row;
  }

  function renderRules() {
    var box = $('[data-rules]');
    var form2 = $('[data-rules-form]');
    box.textContent = '';
    var pro = singlePro();
    $('[data-rules-who]').textContent = pro ? '· ' + proName(pro) : '';
    form2.hidden = !pro;
    if (!pro) {
      var p = $('[data-panel="orari"] .pick-hint') || el('p', { class: 'note pick-hint', text: 'Scegli una professionista in alto, in “Agenda di”, per vedere e modificare i suoi orari.' });
      form2.parentNode.appendChild(p);
      p.hidden = false;
      return;
    }
    var hint = $('[data-panel="orari"] .pick-hint');
    if (hint) hint.hidden = true;
    state.rules.forEach(function (r) { box.appendChild(ruleRow(r)); });
    if (!state.rules.length) box.appendChild(el('p', { class: 'hint', text: 'Nessuna fascia oraria: i pazienti non vedranno orari prenotabili finché non ne aggiungi una.' }));
  }

  $('[data-add-rule]').addEventListener('click', function () {
    var box = $('[data-rules]');
    var h = box.querySelector('p.hint');
    if (h) h.remove();
    box.appendChild(ruleRow({ weekday: 1, start_time: '09:00', end_time: '13:00', mode: 'entrambi', public: true, active: true }));
  });

  $('[data-rules-form]').addEventListener('submit', function (e) {
    e.preventDefault();
    var status = $('[data-rules-status]');
    var rules = $$('.rule', $('[data-rules]')).map(function (row) {
      return {
        weekday: Number(row.querySelector('[name=weekday]').value),
        start_time: row.querySelector('[name=start_time]').value,
        end_time: row.querySelector('[name=end_time]').value,
        mode: row.querySelector('[name=mode]').value,
        public: row.querySelector('[name=public]').checked,
        active: row.querySelector('[name=active]').checked,
      };
    });
    api('PUT', '/rules', { professionalId: singlePro(), rules: rules }).then(function (res) {
      state.rules = res.rules;
      state.rulesCache = {};
      renderRules();
      status.className = 'status form-ok';
      status.textContent = 'Orari salvati.';
      toast('Orari salvati.');
      refresh();
    }).catch(function (e2) { status.className = 'status form-error'; status.textContent = e2.message; });
  });

})(window.BloomingAdmin = window.BloomingAdmin || {});
