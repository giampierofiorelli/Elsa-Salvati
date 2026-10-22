// Agenda professionale: weekly grid and list, manual appointments, recurring
// series, blocks, weekly hours, settings and call-back requests.
(function () {
  'use strict';

  var PX_PER_MIN = 1.1;
  var DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  var DAY_LONG = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  var KIND_LABEL = { primo_colloquio: 'Primo colloquio', seduta: 'Seduta', blocco: 'Non disponibile' };
  var MODE_LABEL = { studio: 'studio', online: 'online' };
  var SERVICE_LABEL = { psicoterapia: 'Psicoterapia', coaching: 'Coaching', aziende: 'Azienda', da_definire: 'Da definire' };
  var fmtDayMonth = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  var fmtLongDay = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

  var state = {
    today: null, weekStart: null, view: 'week', events: [], rules: [], settings: null,
    editing: null, kind: 'seduta',
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  // ---------- dates (calendar strings "YYYY-MM-DD") ----------
  function parse(d) { var p = d.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
  function iso(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(d, n) { var dt = parse(d); dt.setUTCDate(dt.getUTCDate() + n); return iso(dt); }
  function weekday(d) { var w = parse(d).getUTCDay(); return w === 0 ? 7 : w; }
  function monday(d) { return addDays(d, 1 - weekday(d)); }
  function minutes(t) { var p = t.split(':').map(Number); return p[0] * 60 + p[1]; }
  function hhmm(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------- API ----------
  function api(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', headers: { accept: 'application/json', 'x-agenda': '1' } };
    if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch('/api/admin' + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && path !== '/login') { showLogin(); }
        if (!res.ok) {
          var err = new Error(data.message || 'Errore ' + res.status);
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ---------- login ----------
  function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#l-password').focus();
  }

  $('[data-login]').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var err = $('[data-login-error]');
    err.textContent = '';
    api('POST', '/login', { password: f.password.value, code: f.code.value.trim() }).then(function () {
      f.reset();
      start();
    }).catch(function (e2) { err.textContent = e2.message; f.code.value = ''; f.code.focus(); });
  });

  $('[data-logout]').addEventListener('click', function () {
    api('POST', '/logout', {}).then(showLogin, showLogin);
  });

  function start() {
    api('GET', '/me').then(function (me) {
      state.today = me.today;
      if (!state.weekStart) state.weekStart = monday(me.today);
      $('[data-session-info]').textContent = 'Sessione attiva fino alle ' + new Date(me.expiresAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      if (me.calendarFeed) $('[data-feed]').textContent = me.calendarFeed;
      $('#login').hidden = true;
      $('#app').hidden = false;
      return Promise.all([loadRules(), loadSettings(), loadRequests()]);
    }).then(refresh).catch(function () { showLogin(); });
  }

  // ---------- tabs ----------
  $$('[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      var tab = b.getAttribute('data-tab');
      $$('[data-tab]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      $$('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== tab; });
      if (tab === 'richieste') loadRequests();
    });
  });

  // ---------- agenda ----------
  $('[data-prev]').addEventListener('click', function () { state.weekStart = addDays(state.weekStart, state.view === 'week' ? -7 : -28); refresh(); });
  $('[data-next]').addEventListener('click', function () { state.weekStart = addDays(state.weekStart, state.view === 'week' ? 7 : 28); refresh(); });
  $('[data-today]').addEventListener('click', function () { state.weekStart = monday(state.today); refresh(); });
  $$('[data-view]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.view = b.getAttribute('data-view');
      $$('[data-view]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      refresh();
    });
  });
  $('[data-new]').addEventListener('click', function () { openNew(state.today >= state.weekStart && state.today <= addDays(state.weekStart, 6) ? state.today : state.weekStart, '09:00'); });

  function range() {
    return state.view === 'week'
      ? { from: state.weekStart, to: addDays(state.weekStart, 6) }
      : { from: state.weekStart, to: addDays(state.weekStart, 41) };
  }

  function refresh() {
    var r = range();
    var label = fmtDayMonth.format(parse(r.from)) + ' – ' + fmtDayMonth.format(parse(r.to));
    if (state.weekStart === monday(state.today) && state.view === 'week') label = 'Settimana corrente · ' + label;
    $('[data-range]').textContent = label;
    return api('GET', '/events?from=' + r.from + '&to=' + r.to).then(function (res) {
      state.events = res.events;
      $('[data-week]').hidden = state.view !== 'week';
      $('[data-list]').hidden = state.view !== 'list';
      if (state.view === 'week') renderWeek(); else renderList();
    }).catch(function (e) { $('[data-week]').textContent = e.message; });
  }

  function dayPieces(ev, day) {
    if (day < ev.date || day > ev.endDate) return null;
    var from = day === ev.date ? minutes(ev.time) : 0;
    var to = day === ev.endDate ? minutes(ev.endTime) : 24 * 60;
    if (to <= from) return null;
    return { from: from, to: to };
  }

  function renderWeek() {
    var days = [];
    for (var i = 0; i < 7; i++) days.push(addDays(state.weekStart, i));
    // Weekend columns only when used.
    days = days.filter(function (d) {
      var wd = weekday(d);
      if (wd < 6) return true;
      return state.rules.some(function (r) { return r.active && Number(r.weekday) === wd; })
        || state.events.some(function (e) { return dayPieces(e, d); });
    });

    var startMin = 8 * 60, endMin = 19 * 60;
    state.rules.forEach(function (r) {
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
    for (var m = startMin; m <= endMin; m += 60) {
      var lab = el('span', { class: 'hour-label', text: hhmm(m) });
      lab.style.top = ((m - startMin) * PX_PER_MIN) + 'px';
      if (m > startMin && m < endMin) hours.appendChild(lab);
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
      state.rules.forEach(function (r) {
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
        var title = ev.kind === 'blocco' ? (ev.title || 'Non disponibile') : (ev.name || KIND_LABEL[ev.kind]);
        var sub = ev.kind === 'blocco' ? '' : (ev.service ? SERVICE_LABEL[ev.service] : KIND_LABEL[ev.kind]) + (ev.mode ? ' · ' + MODE_LABEL[ev.mode] : '');
        var b = el('button', { type: 'button', class: 'ev ' + cls, 'aria-label': title + ', ' + hhmm(p.from) + '–' + hhmm(Math.min(p.to, 1439)) }, [
          el('strong', { text: (ev.kind === 'blocco' ? '' : ev.time + ' ') + title }),
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
          el('span', {}, [label, el('span', { class: 'tag', text: KIND_LABEL[ev.kind] }), ev.service ? el('span', { class: 'tag', text: SERVICE_LABEL[ev.service] }) : null, ev.mode ? el('span', { class: 'tag', text: MODE_LABEL[ev.mode] }) : null, ev.source === 'sito' ? el('span', { class: 'tag', text: 'dal sito' }) : null]),
        ]));
      });
      box.appendChild(section);
    });
  }

  // ---------- dialog ----------
  var dlg = $('[data-dialog]');
  var form = $('[data-event-form]');

  function setKind(kind) {
    state.kind = kind;
    $$('[data-kind]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-kind') === kind)); });
    $('[data-appt-fields]').hidden = kind === 'blocco';
    $('[data-block-fields]').hidden = kind !== 'blocco';
    if (!state.editing && kind !== 'blocco' && state.settings) {
      form.durationMinutes.value = kind === 'primo_colloquio' ? state.settings.firstSessionMinutes : state.settings.sessionMinutes;
    }
  }
  $$('[data-kind]').forEach(function (b) { b.addEventListener('click', function () { setKind(b.getAttribute('data-kind')); }); });
  form.repeat.addEventListener('change', function () { $('[data-repeat-fields]').hidden = !form.repeat.checked; });
  form.allDay.addEventListener('change', function () { $$('[data-time-field]').forEach(function (f) { f.hidden = form.allDay.checked; }); });
  $('[data-close]').addEventListener('click', function () { dlg.close(); });

  function resetDialog() {
    form.reset();
    $('[data-dlg-error]').textContent = '';
    $('[data-cancel-box]').hidden = true;
    $('[data-repeat-fields]').hidden = true;
    $$('[data-time-field]').forEach(function (f) { f.hidden = true; });
    $('[data-save]').hidden = false;
  }

  function openNew(date, time) {
    state.editing = null;
    resetDialog();
    $('[data-dlg-title]').textContent = 'Nuovo';
    $('[data-kind-group]').hidden = false;
    $('[data-repeat-box]').hidden = false;
    $('[data-send-box]').hidden = false;
    $('[data-cancel]').hidden = true;
    form.date.value = date;
    form.time.value = time;
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
    $('[data-dlg-title]').textContent = ev.kind === 'blocco' ? 'Blocco' : KIND_LABEL[ev.kind] + (ev.source === 'sito' ? ' (dal sito)' : '');
    $('[data-kind-group]').hidden = true;
    $('[data-repeat-box]').hidden = true;
    $('[data-send-box]').hidden = true;
    $('[data-cancel]').hidden = false;
    $('[data-cancel]').textContent = ev.kind === 'blocco' ? 'Elimina blocco' : 'Annulla appuntamento';
    setKind(ev.kind);
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
      form.date.value = ev.date;
      form.time.value = ev.time;
      form.durationMinutes.value = Math.round((new Date(ev.end) - new Date(ev.start)) / 60000);
      form.mode.value = ev.mode || '';
      form.service.value = ev.service || '';
      form.name.value = ev.name;
      form.email.value = ev.email;
      form.phone.value = ev.phone;
      form.note.value = ev.note;
    }
    dlg.showModal();
  }

  function payload() {
    if (state.kind === 'blocco') {
      return {
        kind: 'blocco', title: form.title.value.trim(), allDay: form.allDay.checked,
        startDate: form.startDate.value, endDate: form.endDate.value || form.startDate.value,
        startTime: form.startTime.value, endTime: form.endTime.value,
      };
    }
    var p = {
      kind: state.kind, date: form.date.value, time: form.time.value,
      durationMinutes: Number(form.durationMinutes.value), mode: form.mode.value || null, service: form.service.value || null,
      name: form.name.value.trim(), email: form.email.value.trim(), phone: form.phone.value.trim(), note: form.note.value.trim(),
    };
    if (!state.editing) {
      if (form.repeat.checked) p.repeat = { count: Number(form.count.value), intervalWeeks: Number(form.intervalWeeks.value) };
      p.sendEmail = form.sendEmail.checked;
    }
    return p;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('[data-dlg-error]');
    err.textContent = '';
    var p = payload();
    var req = state.editing
      ? api('PATCH', '/events/' + state.editing.id, p)
      : api('POST', '/events', p);
    req.then(function (res) {
      dlg.close();
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
  $('[data-abort-cancel]').addEventListener('click', function () {
    $('[data-cancel-box]').hidden = true;
    $('[data-save]').hidden = false;
    $('[data-cancel]').hidden = false;
  });
  $('[data-confirm-cancel]').addEventListener('click', function () {
    var ev = state.editing;
    api('POST', '/events/' + ev.id + '/cancel', { scope: form.following.checked ? 'following' : 'one', notify: form.notify.checked })
      .then(function () { dlg.close(); refresh(); })
      .catch(function (e) { $('[data-dlg-error]').textContent = e.message; });
  });

  // ---------- rules ----------
  function loadRules() {
    return api('GET', '/rules').then(function (res) { state.rules = res.rules; renderRules(); });
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
    box.textContent = '';
    state.rules.forEach(function (r) { box.appendChild(ruleRow(r)); });
    if (!state.rules.length) box.appendChild(el('p', { class: 'hint', text: 'Nessuna fascia oraria: i pazienti non vedranno orari prenotabili finché non ne aggiungi una.' }));
  }

  $('[data-add-rule]').addEventListener('click', function () {
    var box = $('[data-rules]');
    var hint = box.querySelector('p.hint');
    if (hint) hint.remove();
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
    api('PUT', '/rules', { rules: rules }).then(function (res) {
      state.rules = res.rules;
      renderRules();
      status.className = 'status form-ok';
      status.textContent = 'Orari salvati.';
      refresh();
    }).catch(function (e2) { status.className = 'status form-error'; status.textContent = e2.message; });
  });

  // ---------- settings ----------
  function loadSettings() {
    return api('GET', '/settings').then(function (res) {
      state.settings = res.settings;
      var f = $('[data-settings-form]');
      Object.keys(res.settings).forEach(function (k) { if (f.elements[k]) f.elements[k].value = res.settings[k]; });
    });
  }
  $('[data-settings-form]').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var status = $('[data-settings-status]');
    var s = {};
    $$('input', f).forEach(function (i) { s[i.name] = Number(i.value); });
    api('PUT', '/settings', { settings: s }).then(function (res) {
      state.settings = res.settings;
      status.className = 'status form-ok';
      status.textContent = 'Impostazioni salvate.';
    }).catch(function (e2) { status.className = 'status form-error'; status.textContent = e2.message; });
  });

  // ---------- requests ----------
  function loadRequests() {
    return api('GET', '/requests').then(function (res) {
      var open = res.requests.filter(function (r) { return !r.handledAt; }).length;
      var badge = $('[data-req-count]');
      badge.hidden = open === 0;
      badge.textContent = String(open);
      var box = $('[data-requests]');
      box.textContent = '';
      if (!res.requests.length) { box.appendChild(el('p', { class: 'empty', text: 'Nessuna richiesta.' })); return; }
      res.requests.forEach(function (r) {
        var when = new Date(r.createdAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
        box.appendChild(el('div', { class: 'req' + (r.handledAt ? ' handled' : '') }, [
          el('p', {}, [el('strong', { text: r.name || '—' }), ' · ' + when]),
          r.email ? el('p', {}, [el('a', { href: 'mailto:' + r.email, text: r.email })]) : null,
          r.phone ? el('p', {}, [el('a', { href: 'tel:' + r.phone.replace(/\s/g, ''), text: r.phone })]) : null,
          el('p', { class: 'hint', text: 'Servizio: ' + (SERVICE_LABEL[r.service] || 'Da definire') + ' · Preferenza: ' + ({ studio: 'in studio', online: 'online', da_definire: 'da definire' }[r.mode] || '—') + (r.preference ? ' · ' + r.preference : '') }),
          r.message ? el('p', { text: r.message }) : null,
          el('div', { class: 'cta-row' }, [
            el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: r.handledAt ? 'Segna da gestire' : 'Segna come gestita', onclick: function () { api('POST', '/requests/' + r.id, { handled: !r.handledAt }).then(loadRequests); } }),
            el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Elimina', onclick: function () { if (window.confirm('Eliminare definitivamente la richiesta?')) api('DELETE', '/requests/' + r.id).then(loadRequests); } }),
          ]),
        ]));
      });
    });
  }

  start();
})();
