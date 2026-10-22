// Area riservata: agenda per professionista, richieste, orari, profilo,
// e per gli amministratori servizi, professionisti e account.
// Attivazione degli account con QR code per l'app di autenticazione.
(function () {
  'use strict';

  var PX_PER_MIN = 1.1;
  var DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  var DAY_LONG = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  var KIND_LABEL = { primo_colloquio: 'Primo colloquio', seduta: 'Seduta', blocco: 'Non disponibile' };
  var MODE_LABEL = { studio: 'studio', online: 'online' };
  var CATEGORY_LABEL = { coaching: 'Coaching', psicologia: 'Psicologia', psicoterapia: 'Psicoterapia', aziende: 'Azienda', da_definire: 'Da definire' };
  var fmtDayMonth = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  var fmtLongDay = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

  var state = {
    me: null, today: null, weekStart: null, view: 'week', events: [], rules: [], settings: null,
    catalog: null, scope: null, editing: null, kind: 'seduta',
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] === undefined || attrs[k] === null || attrs[k] === false) return;
      if (k === 'text') n.textContent = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function isAdmin() { return state.me && state.me.user.role === 'admin'; }
  function myPro() { return state.me && state.me.user.professionalId; }

  // ---------- dates ----------
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
        if (res.status === 401 && path !== '/login' && path.indexOf('/invite') !== 0) showLogin();
        if (!res.ok) {
          var err = new Error(data.message || 'Errore ' + res.status);
          err.data = data;
          throw err;
        }
        return data;
      });
    }, function () { throw new Error('Connessione non riuscita'); });
  }

  // ---------- login and activation ----------
  function showOnly(id) {
    ['login', 'invite', 'app'].forEach(function (x) { document.getElementById(x).hidden = x !== id; });
  }
  function showLogin() {
    showOnly('login');
    $('#l-email').focus();
  }

  $('[data-login]').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var err = $('[data-login-error]');
    err.textContent = '';
    api('POST', '/login', { email: f.email.value.trim(), password: f.password.value, code: f.code.value.trim() }).then(function () {
      f.reset();
      start();
    }).catch(function (e2) { err.textContent = e2.message; f.code.value = ''; f.code.focus(); });
  });

  function startInvite(token) {
    showOnly('invite');
    var err = $('[data-invite-error]');
    api('POST', '/invite/info', { t: token }).then(function (info) {
      $('[data-invite-who]').textContent = 'Ciao ' + info.name + ', stai attivando l\'accesso per ' + info.email + '.';
      var box = $('[data-qr]');
      box.textContent = '';
      if (window.qrcode) {
        var qr = window.qrcode(0, 'M');
        qr.addData(info.otpauth);
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true, alt: 'QR code per l\'app di autenticazione' });
      }
      $('[data-otpauth]').href = info.otpauth;
      $('[data-key]').textContent = info.secret.match(/.{1,4}/g).join(' ');
      $('[data-copy-key]').onclick = function () {
        navigator.clipboard.writeText(info.secret).then(function () { $('[data-copy-key]').textContent = 'Chiave copiata'; });
      };
    }).catch(function (e2) {
      err.textContent = e2.message + ' Chiedi all\'amministratore un nuovo link.';
      $('[data-invite] button[type="submit"]').disabled = true;
    });
    $('[data-invite]').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target;
      err.textContent = '';
      if (f.password.value.length < 12) { err.textContent = 'La password deve avere almeno 12 caratteri.'; return; }
      if (f.password.value !== f.password2.value) { err.textContent = 'Le due password non coincidono.'; return; }
      api('POST', '/invite/accept', { t: token, password: f.password.value, code: f.code.value.trim() }).then(function () {
        history.replaceState(null, '', location.pathname);
        start();
      }).catch(function (e2) { err.textContent = e2.message; f.code.value = ''; });
    };
  }

  function start() {
    api('GET', '/me').then(function (me) {
      state.me = me;
      state.today = me.today;
      if (!state.weekStart) state.weekStart = monday(me.today);
      if (!state.scope) state.scope = myPro() || (isAdmin() ? 'all' : null);
      $('[data-session-info]').textContent = me.user.name + ' · ' + (isAdmin() ? 'amministratore' : 'professionista')
        + ' · fino alle ' + new Date(me.expiresAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      showOnly('app');
      buildTabs();
      buildProSwitch();
      $('[data-settings-admin]').hidden = !isAdmin();
      return Promise.all([loadCatalog(), loadSettings(), loadRequests()]);
    }).then(function () { return Promise.all([loadRules(), refresh()]); })
      .catch(function () { showLogin(); });
  }

  // ---------- navigation ----------
  function buildTabs() {
    var tabs = [['agenda', 'Agenda'], ['richieste', 'Richieste'], ['orari', 'Orari']];
    if (myPro()) tabs.push(['profilo', 'Profilo']);
    if (isAdmin()) tabs.push(['servizi', 'Servizi'], ['professionisti', 'Professionisti'], ['account', 'Account']);
    tabs.push(['impostazioni', 'Impostazioni']);
    var nav = $('[data-tabs]');
    nav.textContent = '';
    tabs.forEach(function (t, i) {
      var b = el('button', { type: 'button', 'data-tab': t[0], 'aria-pressed': String(i === 0) }, [t[1]]);
      if (t[0] === 'richieste') b.appendChild(el('span', { class: 'badge', 'data-req-count': true, hidden: true }));
      b.addEventListener('click', function () { openTab(t[0]); });
      nav.appendChild(b);
    });
    nav.appendChild(el('button', { type: 'button', text: 'Esci', onclick: function () { api('POST', '/logout', {}).then(showLogin, showLogin); } }));
    openTab('agenda');
  }

  function openTab(tab) {
    $$('[data-tab]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-tab') === tab)); });
    $$('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== tab; });
    if (tab === 'richieste') loadRequests();
    if (tab === 'orari') loadRules();
    if (tab === 'profilo') renderProfile();
    if (tab === 'servizi') renderServices();
    if (tab === 'professionisti') renderPros();
    if (tab === 'account') loadUsers();
  }

  function buildProSwitch() {
    var box = $('[data-pro-switch]');
    var sel = $('[data-pro-select]');
    box.hidden = !isAdmin();
    if (!isAdmin()) return;
    sel.textContent = '';
    sel.appendChild(el('option', { value: 'all', text: 'Tutti i professionisti' }));
    state.me.professionals.forEach(function (p) {
      sel.appendChild(el('option', { value: p.id, text: p.name + (p.active ? '' : ' (non attivo)') }));
    });
    sel.value = state.scope;
    sel.onchange = function () {
      state.scope = sel.value;
      loadRules().then(refresh);
    };
  }

  function proName(id) {
    var p = (state.catalog ? state.catalog.professionals : state.me.professionals).find(function (x) { return x.id === id; });
    return p ? p.name : '';
  }
  function singlePro() { return state.scope && state.scope !== 'all' ? state.scope : null; }

  // ---------- catalogue ----------
  function loadCatalog() {
    return api('GET', '/catalog').then(function (c) { state.catalog = c; });
  }
  function servicesOf(proId) {
    var p = state.catalog.professionals.find(function (x) { return x.id === proId; });
    if (!p) return [];
    return p.offerings.map(function (o) {
      var s = state.catalog.services.find(function (x) { return x.id === o.serviceId; });
      return s ? Object.assign({}, s, { inStudio: o.inStudio, online: o.online }) : null;
    }).filter(Boolean);
  }

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
  $('[data-new]').addEventListener('click', function () {
    var inWeek = state.today >= state.weekStart && state.today <= addDays(state.weekStart, 6);
    openNew(inWeek ? state.today : state.weekStart, '09:00');
  });

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
    var q = '/events?from=' + r.from + '&to=' + r.to + (isAdmin() ? '&professional=' + (state.scope || 'all') : '');
    return api('GET', q).then(function (res) {
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
        var title = ev.kind === 'blocco' ? (ev.title || 'Non disponibile') : (ev.name || KIND_LABEL[ev.kind]);
        var sub = ev.kind === 'blocco' ? '' : (ev.serviceName || KIND_LABEL[ev.kind]) + (ev.mode ? ' · ' + MODE_LABEL[ev.mode] : '');
        if (showPro) sub = shortName(ev.professionalName) + (sub ? ' · ' + sub : '');
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
          el('span', {}, [
            label,
            !singlePro() ? el('span', { class: 'tag', text: shortName(ev.professionalName) }) : null,
            el('span', { class: 'tag', text: ev.serviceName || KIND_LABEL[ev.kind] }),
            ev.mode ? el('span', { class: 'tag', text: MODE_LABEL[ev.mode] }) : null,
            ev.source === 'sito' ? el('span', { class: 'tag', text: 'dal sito' }) : null,
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
  }

  function openNew(date, time) {
    var proId = singlePro() || myPro() || (state.me.professionals[0] && state.me.professionals[0].id);
    if (!proId) { window.alert('Crea prima un professionista nella sezione Professionisti.'); return; }
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

  function payload() {
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
      p.sendEmail = form.sendEmail.checked;
    }
    return p;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('[data-dlg-error]');
    err.textContent = '';
    var p = payload();
    var req = state.editing ? api('PATCH', '/events/' + state.editing.id, p) : api('POST', '/events', p);
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
      var p = $('[data-panel="orari"] .pick-hint') || el('p', { class: 'note pick-hint', text: 'Scegli un professionista in alto (“Agenda di”) per vedere e modificare i suoi orari.' });
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
      refresh();
    }).catch(function (e2) { status.className = 'status form-error'; status.textContent = e2.message; });
  });

  // ---------- generic form dialog ----------
  var fdlg = $('[data-form-dialog]');
  $('[data-form-close]').addEventListener('click', function () { fdlg.close(); });

  function field(spec, value) {
    var id = 'f-' + spec.name;
    var input;
    if (spec.type === 'textarea') input = el('textarea', { id: id, name: spec.name, maxlength: spec.max || 1500, rows: 4 });
    else if (spec.type === 'select') {
      input = el('select', { id: id, name: spec.name });
      spec.options.forEach(function (o) { input.appendChild(el('option', { value: o[0], text: o[1] })); });
    } else if (spec.type === 'checkbox') {
      input = el('input', { type: 'checkbox', id: id, name: spec.name });
      input.checked = value !== false;
      return el('label', { class: 'check' }, [input, el('span', { text: spec.label })]);
    } else input = el('input', { id: id, name: spec.name, type: spec.type || 'text', maxlength: spec.max || 200, min: spec.min, max: spec.maxValue });
    if (spec.type !== 'checkbox') input.value = value === undefined || value === null ? '' : value;
    return el('div', { class: 'field' }, [el('label', { for: id, text: spec.label }), input, spec.hint ? el('span', { class: 'hint', text: spec.hint }) : null]);
  }

  function formDialog(title, specs, values, onSave, extra) {
    $('[data-form-title]').textContent = title;
    var body = $('[data-form-body]');
    body.textContent = '';
    $('[data-form-error]').textContent = '';
    specs.forEach(function (s) { body.appendChild(field(s, values[s.name])); });
    if (extra) body.appendChild(extra.node);
    var f = fdlg.querySelector('form');
    f.onsubmit = function (e) {
      e.preventDefault();
      var out = {};
      specs.forEach(function (s) {
        var input = f.elements[s.name];
        out[s.name] = s.type === 'checkbox' ? input.checked : (s.type === 'number' ? Number(input.value) : input.value.trim());
      });
      if (extra) out.__extra = extra.read();
      onSave(out).then(function () { fdlg.close(); }).catch(function (err) { $('[data-form-error]').textContent = err.message; });
    };
    fdlg.showModal();
  }

  // ---------- services (admin) ----------
  function categoryName(id) {
    var c = state.catalog.categories.find(function (x) { return x.id === id; });
    return c ? c.name : '';
  }

  function serviceDialog(s) {
    var cats = state.catalog.categories.map(function (c) { return [c.id, c.name]; });
    formDialog(s ? 'Modifica servizio' : 'Nuovo servizio', [
      { name: 'name', label: 'Nome del servizio', max: 80 },
      { name: 'categoryId', label: 'Area', type: 'select', options: cats },
      { name: 'description', label: 'Descrizione (compare sul sito)', type: 'textarea' },
      { name: 'durationMinutes', label: 'Durata (minuti)', type: 'number', min: 15, maxValue: 240 },
      { name: 'price', label: 'Tariffa (es. €70)', max: 60 },
      { name: 'sort', label: 'Ordine nell\'elenco', type: 'number' },
      { name: 'active', label: 'Attivo (visibile e prenotabile)', type: 'checkbox' },
    ], s || { categoryId: cats[0] && cats[0][0], durationMinutes: 50, sort: 0, active: true }, function (v) {
      return (s ? api('PATCH', '/services/' + s.id, v) : api('POST', '/services', v)).then(loadCatalog).then(renderServices);
    });
  }

  function categoryDialog(c) {
    formDialog('Area: ' + c.name, [
      { name: 'name', label: 'Nome', max: 60 },
      { name: 'intro', label: 'Introduzione (compare sul sito)', type: 'textarea', max: 600 },
      { name: 'active', label: 'Visibile sul sito', type: 'checkbox' },
    ], c, function (v) { return api('PATCH', '/categories/' + c.id, v).then(loadCatalog).then(renderServices); });
  }

  function renderServices() {
    var box = $('[data-services]');
    box.textContent = '';
    state.catalog.categories.forEach(function (c) {
      var list = state.catalog.services.filter(function (s) { return s.categoryId === c.id; });
      var section = el('div', { class: 'cat-admin' }, [
        el('div', { class: 'section-toolbar' }, [
          el('h3', { text: c.name + (c.active ? '' : ' (nascosta)') }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Modifica area', onclick: function () { categoryDialog(c); } }),
        ]),
      ]);
      if (!list.length) section.appendChild(el('p', { class: 'hint', text: 'Nessun servizio in quest\'area.' }));
      list.forEach(function (s) {
        var pros = state.catalog.professionals.filter(function (p) { return p.offerings.some(function (o) { return o.serviceId === s.id; }); });
        section.appendChild(el('div', { class: 'row-card' + (s.active ? '' : ' inactive') }, [
          el('div', {}, [
            el('strong', { text: s.name }),
            el('p', { class: 'hint', text: s.durationMinutes + ' min' + (s.price ? ' · ' + s.price : '') + ' · ' + (pros.length ? pros.map(function (p) { return p.name; }).join(', ') : 'nessun professionista') + (s.active ? '' : ' · non attivo') }),
          ]),
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Modifica', onclick: function () { serviceDialog(s); } }),
        ]));
      });
      box.appendChild(section);
    });
    var pb = $('[data-publish-box]');
    pb.textContent = '';
    pb.appendChild(el('p', { class: 'hint', text: 'Le prenotazioni usano subito i dati aggiornati. Le pagine del sito (elenco servizi, team) si aggiornano con il pulsante qui sotto.' }));
    var status = el('p', { class: 'status', role: 'status' });
    pb.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Aggiorna le pagine del sito', onclick: function () {
      status.textContent = 'Aggiornamento in corso…';
      api('POST', '/publish', {}).then(function () { status.className = 'status form-ok'; status.textContent = 'Fatto: il sito sarà aggiornato entro un paio di minuti.'; })
        .catch(function (e) { status.className = 'status form-error'; status.textContent = e.message; });
    } }));
    pb.appendChild(status);
  }
  $('[data-new-service]').addEventListener('click', function () { serviceDialog(null); });

  // ---------- professionals ----------
  function offeringsEditor(current, { canAddRemove }) {
    var table = el('div', { class: 'offerings' }, [el('p', { class: 'label', text: 'Servizi offerti e modalità' })]);
    state.catalog.services.forEach(function (s) {
      var o = current.find(function (x) { return x.serviceId === s.id; });
      if (!o && !canAddRemove) return;
      var on = el('input', { type: 'checkbox', 'data-svc': s.id }); on.checked = !!o; on.disabled = !canAddRemove;
      var st = el('input', { type: 'checkbox', 'data-studio': s.id }); st.checked = o ? o.inStudio : true;
      var ol = el('input', { type: 'checkbox', 'data-online': s.id }); ol.checked = o ? o.online : false;
      table.appendChild(el('div', { class: 'offering' }, [
        el('label', { class: 'check' }, [on, el('span', { text: s.name + ' · ' + categoryName(s.categoryId) })]),
        el('label', { class: 'check' }, [st, el('span', { text: 'In studio' })]),
        el('label', { class: 'check' }, [ol, el('span', { text: 'Online' })]),
      ]));
    });
    if (table.children.length === 1) table.appendChild(el('p', { class: 'hint', text: 'Nessun servizio assegnato.' }));
    return {
      node: table,
      read: function () {
        return $$('[data-svc]', table).filter(function (c) { return c.checked; }).map(function (c) {
          var id = c.getAttribute('data-svc');
          return { serviceId: id, inStudio: $('[data-studio="' + id + '"]', table).checked, online: $('[data-online="' + id + '"]', table).checked };
        });
      },
    };
  }

  function proDialog(p) {
    var editor = offeringsEditor(p ? p.offerings : [], { canAddRemove: true });
    formDialog(p ? 'Modifica professionista' : 'Nuovo professionista', [
      { name: 'name', label: 'Nome (come appare sul sito)', max: 80 },
      { name: 'title', label: 'Titolo (es. Psicologa psicoterapeuta)', max: 80 },
      { name: 'bio', label: 'Presentazione breve', type: 'textarea' },
      { name: 'albo', label: 'Iscrizione all\'Albo (es. Ordine degli Psicologi dell\'Emilia-Romagna n. 1234)', max: 120 },
      { name: 'notifyEmail', label: 'Email per gli avvisi di prenotazione', type: 'email' },
      { name: 'photo', label: 'Foto (nome del file, es. elsa-salvati)', max: 60, hint: 'Le foto si aggiungono al sito su richiesta; lascia vuoto per usare il logo.' },
      { name: 'sort', label: 'Ordine nell\'elenco', type: 'number' },
      { name: 'active', label: 'Attivo (visibile e prenotabile)', type: 'checkbox' },
    ], p || { sort: 0, active: true }, function (v) {
      var offerings = v.__extra;
      delete v.__extra;
      var save = p ? api('PATCH', '/professionals/' + p.id, v).then(function () { return p.id; })
        : api('POST', '/professionals', v).then(function (r) { return r.id; });
      return save.then(function (id) { return api('PUT', '/professionals/' + id + '/services', { offerings: offerings }); })
        .then(loadCatalog).then(function () { return api('GET', '/me'); })
        .then(function (me) { state.me = me; buildProSwitch(); renderPros(); });
    }, editor);
  }

  function renderPros() {
    var box = $('[data-pros]');
    box.textContent = '';
    if (!state.catalog.professionals.length) box.appendChild(el('p', { class: 'hint', text: 'Nessun professionista: aggiungine uno.' }));
    state.catalog.professionals.forEach(function (p) {
      var services = servicesOf(p.id).map(function (s) {
        return s.name + ' (' + [s.inStudio && 'studio', s.online && 'online'].filter(Boolean).join(' + ') + ')';
      });
      box.appendChild(el('div', { class: 'row-card' + (p.active ? '' : ' inactive') }, [
        el('div', {}, [
          el('strong', { text: p.name }),
          el('p', { class: 'hint', text: (p.title || '') + (p.active ? '' : ' · non attivo') }),
          el('p', { class: 'hint', text: services.length ? services.join(' · ') : 'Nessun servizio' }),
        ]),
        el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Modifica', onclick: function () { proDialog(p); } }),
      ]));
    });
  }
  $('[data-new-pro]').addEventListener('click', function () { proDialog(null); });

  // ---------- own profile (professional) ----------
  function renderProfile() {
    var box = $('[data-profile]');
    box.textContent = '';
    var p = state.catalog.professionals.find(function (x) { return x.id === myPro(); });
    if (!p) { box.appendChild(el('p', { class: 'hint', text: 'Profilo non trovato.' })); return; }
    var f = el('form', { class: 'panel profile-form' });
    [{ name: 'title', label: 'Titolo', max: 80 }, { name: 'bio', label: 'Presentazione breve', type: 'textarea' },
      { name: 'notifyEmail', label: 'Email per gli avvisi di prenotazione', type: 'email' }].forEach(function (s) { f.appendChild(field(s, p[s.name])); });
    var editor = offeringsEditor(p.offerings, { canAddRemove: isAdmin() });
    f.appendChild(editor.node);
    var status = el('p', { class: 'status', role: 'status' });
    f.appendChild(status);
    f.appendChild(el('button', { type: 'submit', class: 'btn btn-primary btn-small', text: 'Salva profilo' }));
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      api('PATCH', '/professionals/' + p.id, { title: f.elements.title.value.trim(), bio: f.elements.bio.value.trim(), notifyEmail: f.elements.notifyEmail.value.trim() })
        .then(function () { return api('PUT', '/professionals/' + p.id + '/services', { offerings: editor.read() }); })
        .then(loadCatalog)
        .then(function () { status.className = 'status form-ok'; status.textContent = 'Profilo salvato.'; })
        .catch(function (err) { status.className = 'status form-error'; status.textContent = err.message; });
    });
    box.appendChild(f);
  }

  // ---------- accounts (admin) ----------
  function showInviteLink(name, url) {
    var box = el('div', { class: 'invite-share' }, [
      el('p', { text: 'Invia questo link a ' + name + ': servirà per scegliere la password e collegare l\'app di autenticazione. Vale 7 giorni e si usa una sola volta.' }),
      el('code', { text: url }),
    ]);
    var qrBox = el('div', { class: 'qr qr-small' });
    if (window.qrcode) {
      var qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'QR code del link di attivazione' });
    }
    box.appendChild(el('p', { class: 'hint', text: 'Se siete insieme, può inquadrare questo QR con la fotocamera del telefono:' }));
    box.appendChild(qrBox);
    var copy = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Copia il link', onclick: function () {
      navigator.clipboard.writeText(url).then(function () { copy.textContent = 'Link copiato'; });
    } });
    var actions = el('div', { class: 'cta-row' }, [copy]);
    if (navigator.share) {
      actions.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Condividi…', onclick: function () {
        navigator.share({ title: 'Attiva il tuo accesso a Blooming', url: url }).catch(function () {});
      } }));
    }
    box.appendChild(actions);
    formDialog('Link di attivazione', [], {}, function () { return Promise.resolve(); }, { node: box, read: function () {} });
    $('[data-form-save]').textContent = 'Chiudi';
  }

  function userDialog(u) {
    var pros = [['', '— nessuno —']].concat(state.catalog.professionals.map(function (p) { return [p.id, p.name]; }));
    var specs = [
      { name: 'name', label: 'Nome', max: 80 },
      { name: 'role', label: 'Ruolo', type: 'select', options: [['professionista', 'Professionista (vede solo la sua agenda)'], ['admin', 'Amministratore (gestisce tutto)']] },
      { name: 'professionalId', label: 'Collegato al professionista', type: 'select', options: pros },
    ];
    if (!u) specs.splice(1, 0, { name: 'email', label: 'Email', type: 'email' });
    formDialog(u ? 'Modifica account' : 'Nuovo account', specs, u || { role: 'professionista' }, function (v) {
      if (u) return api('PATCH', '/users/' + u.id, v).then(loadUsers);
      return api('POST', '/users', v).then(function (r) {
        loadUsers();
        setTimeout(function () { showInviteLink(v.name, r.inviteUrl); }, 50);
      });
    });
    $('[data-form-save]').textContent = u ? 'Salva' : 'Crea e genera il link';
  }

  function loadUsers() {
    return api('GET', '/users').then(function (res) {
      var box = $('[data-users]');
      box.textContent = '';
      res.users.forEach(function (u) {
        var status = !u.active ? 'disattivato' : (u.enrolled ? 'attivo' : (u.invitePending ? 'invito in attesa' : 'invito scaduto'));
        var actions = el('div', { class: 'cta-row' }, [
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Modifica', onclick: function () { userDialog(u); } }),
        ]);
        if (u.id !== state.me.user.id) {
          actions.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: u.enrolled ? 'Reimposta accesso' : 'Nuovo link', onclick: function () {
            if (u.enrolled && !window.confirm('Il vecchio accesso di ' + u.name + ' smetterà di funzionare. Continuare?')) return;
            api('POST', '/users/' + u.id + '/invite', {}).then(function (r) { loadUsers(); showInviteLink(u.name, r.inviteUrl); })
              .catch(function (e) { window.alert(e.message); });
          } }));
          actions.appendChild(el('button', { type: 'button', class: 'btn btn-danger btn-small', text: u.active ? 'Disattiva' : 'Riattiva', onclick: function () {
            api('PATCH', '/users/' + u.id, { active: !u.active }).then(loadUsers).catch(function (e) { window.alert(e.message); });
          } }));
        }
        box.appendChild(el('div', { class: 'row-card' + (u.active ? '' : ' inactive') }, [
          el('div', {}, [
            el('strong', { text: u.name }),
            el('p', { class: 'hint', text: u.email + ' · ' + (u.role === 'admin' ? 'amministratore' : 'professionista') + (u.professionalName ? ' · ' + u.professionalName : '') + ' · ' + status }),
          ]),
          actions,
        ]));
      });
    });
  }
  $('[data-new-user]').addEventListener('click', function () { userDialog(null); });

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
    var status = $('[data-settings-status]');
    var s = {};
    $$('input', e.target).forEach(function (i) { s[i.name] = Number(i.value); });
    api('PUT', '/settings', { settings: s }).then(function (res) {
      state.settings = res.settings;
      status.className = 'status form-ok';
      status.textContent = 'Impostazioni salvate.';
    }).catch(function (e2) { status.className = 'status form-error'; status.textContent = e2.message; });
  });
  $('[data-make-feed]').addEventListener('click', function () {
    api('POST', '/me/calendar', {}).then(function (r) {
      var c = $('[data-feed]');
      c.textContent = r.url;
      c.hidden = false;
    }).catch(function (e) { window.alert(e.message); });
  });

  // ---------- requests ----------
  function loadRequests() {
    return api('GET', '/requests').then(function (res) {
      var open = res.requests.filter(function (r) { return !r.handledAt; }).length;
      var badge = $('[data-req-count]');
      if (badge) { badge.hidden = open === 0; badge.textContent = String(open); }
      var box = $('[data-requests]');
      box.textContent = '';
      if (!res.requests.length) { box.appendChild(el('p', { class: 'empty', text: 'Nessuna richiesta.' })); return; }
      res.requests.forEach(function (r) {
        var when = new Date(r.createdAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
        box.appendChild(el('div', { class: 'req' + (r.handledAt ? ' handled' : '') }, [
          el('p', {}, [el('strong', { text: r.name || '—' }), ' · ' + when]),
          r.email ? el('p', {}, [el('a', { href: 'mailto:' + r.email, text: r.email })]) : null,
          r.phone ? el('p', {}, [el('a', { href: 'tel:' + r.phone.replace(/\s/g, ''), text: r.phone })]) : null,
          el('p', { class: 'hint', text: 'Area: ' + (CATEGORY_LABEL[r.category] || 'Da definire')
            + (r.professionalName ? ' · Professionista: ' + r.professionalName : '')
            + ' · Preferenza: ' + ({ studio: 'in studio', online: 'online', da_definire: 'da definire' }[r.mode] || '—')
            + (r.preference ? ' · ' + r.preference : '') }),
          r.message ? el('p', { text: r.message }) : null,
          el('div', { class: 'cta-row' }, [
            el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: r.handledAt ? 'Segna da gestire' : 'Segna come gestita', onclick: function () { api('POST', '/requests/' + r.id, { handled: !r.handledAt }).then(loadRequests); } }),
            el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Elimina', onclick: function () { if (window.confirm('Eliminare definitivamente la richiesta?')) api('DELETE', '/requests/' + r.id).then(loadRequests); } }),
          ]),
        ]));
      });
    });
  }

  // ---------- boot ----------
  var invite = (location.hash.match(/invito=([\w-]+)/) || [])[1];
  if (invite) startInvite(invite); else start();
})();
