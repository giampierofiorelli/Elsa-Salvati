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
  var PX_PER_MIN = A.PX_PER_MIN;
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

  // ---------- agenda ----------
  var fmtMonth = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  function monthOf(d) { return d.slice(0, 8) + '01'; }
  function addMonths(m, n) { var dt = parse(m); dt.setUTCMonth(dt.getUTCMonth() + n); return iso(dt); }
  function monthWeeks(m) {
    var start = monday(m);
    var next = addMonths(m, 1);
    var days = Math.round((parse(next) - parse(start)) / 86400000);
    return Math.ceil(days / 7);
  }
  function setView(v) {
    if (v === state.view) return;
    if (v === 'month') state.month = monthOf(addDays(state.weekStart, 3));
    else if (state.view === 'month') state.weekStart = monthOf(state.today) === state.month ? monday(state.today) : monday(state.month);
    state.view = v;
    $$('[data-view]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-view') === v)); });
    refresh();
  }
  $('[data-prev]').addEventListener('click', function () {
    if (state.view === 'month') state.month = addMonths(state.month, -1);
    else state.weekStart = addDays(state.weekStart, state.view === 'week' ? -7 : -28);
    refresh();
  });
  $('[data-next]').addEventListener('click', function () {
    if (state.view === 'month') state.month = addMonths(state.month, 1);
    else state.weekStart = addDays(state.weekStart, state.view === 'week' ? 7 : 28);
    refresh();
  });
  $('[data-today]').addEventListener('click', function () { state.weekStart = monday(state.today); state.month = monthOf(state.today); refresh(); });
  $$('[data-view]').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
  });
  $('[data-new]').addEventListener('click', function () {
    var inWeek = state.today >= state.weekStart && state.today <= addDays(state.weekStart, 6);
    openNew(inWeek ? state.today : state.weekStart, '09:00');
  });

  function range() {
    if (state.view === 'month') {
      var from = monday(state.month);
      return { from: from, to: addDays(from, monthWeeks(state.month) * 7 - 1) };
    }
    return state.view === 'week'
      ? { from: state.weekStart, to: addDays(state.weekStart, 6) }
      : { from: state.weekStart, to: addDays(state.weekStart, 41) };
  }

  function refresh() {
    var r = range();
    var label = fmtDayMonth.format(parse(r.from)) + ' – ' + fmtDayMonth.format(parse(r.to));
    if (state.view === 'month') label = capital(fmtMonth.format(parse(state.month)));
    else if (state.weekStart === monday(state.today) && state.view === 'week') label = 'Questa settimana · ' + label;
    $('[data-range]').textContent = label;
    var q = '/events?from=' + r.from + '&to=' + r.to + (isAdmin() ? '&professional=' + (state.scope || 'all') : '');
    loadPendingCount();
    if (state.route === 'agenda/blocchi') loadBlocks();
    return api('GET', q).then(function (res) {
      state.events = res.events;
      $('[data-week]').hidden = state.view !== 'week';
      $('[data-month]').hidden = state.view !== 'month';
      $('[data-list]').hidden = state.view !== 'list';
      if (state.view === 'week') renderWeek(); else if (state.view === 'month') renderMonth(); else renderList();
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

  // ---------- month ----------
  function renderMonth() {
    var start = monday(state.month);
    var weeks = monthWeeks(state.month);
    var showPro = !singlePro();
    var grid = el('div', { class: 'month' });
    DAY_NAMES.forEach(function (n) { grid.appendChild(el('div', { class: 'month-head', text: n })); });
    for (var i = 0; i < weeks * 7; i++) {
      (function (d) {
        var inMonth = d.slice(0, 7) === state.month.slice(0, 7);
        var evs = state.events.filter(function (e) { return dayPieces(e, d); });
        var cell = el('div', { class: 'month-cell' + (inMonth ? '' : ' out') + (d === state.today ? ' today' : '') });
        cell.appendChild(el('button', { type: 'button', class: 'month-day', 'aria-label': 'Apri la settimana di ' + fmtLongDay.format(parse(d)), text: String(parse(d).getUTCDate()), onclick: function () {
          state.weekStart = monday(d); setView('week');
        } }));
        var ul = el('ul', { class: 'month-evs', role: 'list' });
        evs.slice(0, 3).forEach(function (ev) {
          var st = evState(ev);
          var cls = ev.kind === 'blocco' ? 'blocco' : (st && st.cls === 'pending' ? 'pending' : (ev.source === 'sito' ? 'sito' : 'manuale'));
          var label = ev.kind === 'blocco' ? (ev.title || 'Non disponibile') : (ev.name || KIND_LABEL[ev.kind]);
          var allDay = ev.kind === 'blocco' && (ev.date !== d || ev.time === '00:00');
          ul.appendChild(el('li', {}, [el('button', { type: 'button', class: 'mchip mchip-' + cls, title: label, onclick: function () { openEdit(ev); } }, [
            allDay ? null : el('time', { text: ev.time }),
            el('span', { text: label + (showPro && ev.kind !== 'blocco' ? ' · ' + shortName(ev.professionalName) : '') }),
          ])]));
        });
        if (evs.length > 3) ul.appendChild(el('li', {}, [el('button', { type: 'button', class: 'mmore', text: '+' + (evs.length - 3) + ' altri', onclick: function () { state.weekStart = monday(d); setView('week'); } })]));
        cell.appendChild(ul);
        if (evs.length) cell.appendChild(el('span', { class: 'mdots', 'aria-hidden': 'true', text: evs.length > 3 ? '•••' : new Array(evs.length + 1).join('•') }));
        grid.appendChild(cell);
      })(addDays(start, i));
    }
    var wrap = $('[data-month]');
    wrap.textContent = '';
    wrap.appendChild(grid);
  }

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

  function dayPieces(ev, day) {
    if (day < ev.date || day > ev.endDate) return null;
    var from = day === ev.date ? minutes(ev.time) : 0;
    var to = day === ev.endDate ? minutes(ev.endTime) : 24 * 60;
    if (to <= from) return null;
    return { from: from, to: to };
  }

  function shortName(name) {
    var parts = String(name || '').replace(/^(Dott\.ssa|Dott\.|Dr\.ssa|Dr\.)\s+/i, '').split(/\s+/);
    return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1][0] + '.' : parts[0];
  }

  function renderWeek() {
    var days = [];
    for (var i = 0; i < 7; i++) days.push(addDays(state.weekStart, i));
    var rules = singlePro() ? state.rules : [];
    days = days.filter(function (d) {
      var wd = weekday(d);
      if (wd < 6) return true;
      return rules.some(function (r) { return r.active && Number(r.weekday) === wd; })
        || state.events.some(function (e) { return dayPieces(e, d); });
    });

    var startMin = 8 * 60, endMin = 19 * 60;
    rules.forEach(function (r) {
      if (!r.active) return;
      startMin = Math.min(startMin, minutes(r.start_time));
      endMin = Math.max(endMin, minutes(r.end_time));
    });
    state.events.forEach(function (e) {
      if (e.kind === 'blocco' && e.date !== e.endDate) return;
      startMin = Math.min(startMin, minutes(e.time));
      endMin = Math.max(endMin, e.endDate === e.date ? minutes(e.endTime) : 24 * 60);
    });
    startMin = Math.floor(startMin / 60) * 60;
    endMin = Math.min(24 * 60, Math.ceil(endMin / 60) * 60);
    var height = (endMin - startMin) * PX_PER_MIN;
    var showPro = !singlePro();

    var grid = el('div', { class: 'week' });
    grid.style.setProperty('--days', String(days.length));
    grid.appendChild(el('div', { class: 'week-head' }));
    days.forEach(function (d) {
      grid.appendChild(el('div', { class: 'week-head' + (d === state.today ? ' today' : '') }, [
        DAY_NAMES[weekday(d) - 1], el('small', { text: fmtDayMonth.format(parse(d)) }),
      ]));
    });

    var hours = el('div', { class: 'hours' });
    hours.style.height = height + 'px';
    for (var m = startMin + 60; m < endMin; m += 60) {
      var lab = el('span', { class: 'hour-label', text: hhmm(m) });
      lab.style.top = ((m - startMin) * PX_PER_MIN) + 'px';
      hours.appendChild(lab);
    }
    grid.appendChild(hours);

    days.forEach(function (d) {
      var col = el('div', { class: 'day-col', 'data-date': d });
      col.style.height = height + 'px';
      for (var h = startMin + 60; h < endMin; h += 60) {
        var line = el('div', { class: 'hline' });
        line.style.top = ((h - startMin) * PX_PER_MIN) + 'px';
        col.appendChild(line);
      }
      rules.forEach(function (r) {
        if (!r.active || !r.public || Number(r.weekday) !== weekday(d)) return;
        var o = el('div', { class: 'open', title: 'Prenotabile online (' + r.start_time + '–' + r.end_time + ')' });
        o.style.top = ((minutes(r.start_time) - startMin) * PX_PER_MIN) + 'px';
        o.style.height = ((minutes(r.end_time) - minutes(r.start_time)) * PX_PER_MIN) + 'px';
        col.appendChild(o);
      });
      state.events.forEach(function (ev) {
        var p = dayPieces(ev, d);
        if (!p) return;
        var from = Math.max(p.from, startMin), to = Math.min(p.to, endMin);
        if (to <= from) return;
        var cls = ev.kind === 'blocco' ? 'ev-blocco' : (ev.source === 'sito' ? 'ev-sito' : 'ev-manuale');
        var st = evState(ev);
        if (st && st.cls === 'pending') cls += ' ev-pending';
        var title = ev.kind === 'blocco' ? (ev.title || 'Non disponibile') : (ev.name || KIND_LABEL[ev.kind]);
        var sub = ev.kind === 'blocco' ? '' : (ev.serviceName || KIND_LABEL[ev.kind]) + (ev.mode ? ' · ' + MODE_LABEL[ev.mode] : '');
        if (showPro) sub = shortName(ev.professionalName) + (sub ? ' · ' + sub : '');
        var b = el('button', { type: 'button', class: 'ev ' + cls, 'aria-label': title + ', ' + hhmm(p.from) + '–' + hhmm(Math.min(p.to, 1439)) }, [
          el('strong', { text: (ev.kind === 'blocco' ? '' : ev.time + ' ') + title }),
          st ? el('span', { class: 'ev-flag ev-flag-' + st.cls, text: st.text }) : null,
          sub ? el('span', { text: sub }) : null,
        ]);
        b.style.top = ((from - startMin) * PX_PER_MIN) + 'px';
        b.style.height = Math.max(22, (to - from) * PX_PER_MIN - 2) + 'px';
        b.addEventListener('click', function (e) { e.stopPropagation(); openEdit(ev); });
        col.appendChild(b);
      });
      if (d === state.today) {
        var now = new Date();
        var nowMin = now.getHours() * 60 + now.getMinutes();
        if (nowMin > startMin && nowMin < endMin) {
          var n = el('div', { class: 'now' });
          n.style.top = ((nowMin - startMin) * PX_PER_MIN) + 'px';
          col.appendChild(n);
        }
      }
      col.addEventListener('click', function (e) {
        var rect = col.getBoundingClientRect();
        var mins = startMin + Math.floor((e.clientY - rect.top) / PX_PER_MIN / 30) * 30;
        openNew(d, hhmm(Math.max(0, Math.min(mins, 23 * 60 + 30))));
      });
      grid.appendChild(col);
    });

    var wrap = $('[data-week]');
    wrap.textContent = '';
    wrap.appendChild(grid);
  }

  function renderList() {
    var box = $('[data-list]');
    box.textContent = '';
    if (!state.events.length) { box.appendChild(el('p', { class: 'empty', text: 'Nessun appuntamento in questo periodo.' })); return; }
    var byDay = {};
    state.events.forEach(function (e) { (byDay[e.date] = byDay[e.date] || []).push(e); });
    Object.keys(byDay).sort().forEach(function (d) {
      var section = el('div', { class: 'list-day' }, [el('h3', { text: capital(fmtLongDay.format(parse(d))) })]);
      byDay[d].forEach(function (ev) {
        var label = ev.kind === 'blocco' ? (ev.title || 'Non disponibile') : (ev.name || '—');
        section.appendChild(el('button', { type: 'button', class: 'list-item', onclick: function () { openEdit(ev); } }, [
          el('time', { text: ev.time + '–' + (ev.endDate === ev.date ? ev.endTime : '…') }),
          el('span', {}, [
            label,
            !singlePro() ? el('span', { class: 'tag', text: shortName(ev.professionalName) }) : null,
            el('span', { class: 'tag', text: ev.serviceName || KIND_LABEL[ev.kind] }),
            ev.mode ? el('span', { class: 'tag', text: MODE_LABEL[ev.mode] }) : null,
            ev.source === 'sito' ? el('span', { class: 'tag', text: 'dal sito' }) : null,
            evState(ev) ? el('span', { class: 'tag tag-' + evState(ev).cls, text: evState(ev).text }) : null,
          ]),
        ]));
      });
      box.appendChild(section);
    });
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
      renderRules();
      status.className = 'status form-ok';
      status.textContent = 'Orari salvati.';
      toast('Orari salvati.');
      refresh();
    }).catch(function (e2) { status.className = 'status form-error'; status.textContent = e2.message; });
  });

})(window.BloomingAdmin = window.BloomingAdmin || {});
