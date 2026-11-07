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
      $('[data-privacy-admin]').hidden = !isAdmin();
      return Promise.all([loadCatalog(), loadSettings(), loadRequests()]);
    }).then(function () { return Promise.all([loadRules(), refresh()]); })
      .catch(function () { showLogin(); });
  }

  // ---------- navigation ----------
  function buildTabs() {
    var tabs = [['agenda', 'Agenda'], ['richieste', 'Richieste'], ['orari', 'Orari']];
    if (myPro()) tabs.push(['profilo', 'Profilo']);
    if (isAdmin()) tabs.push(['servizi', 'Servizi'], ['professionisti', 'Professionisti'], ['account', 'Account']);
    if (state.me.user.canEditSite) tabs.push(['sito', 'Sito']);
    tabs.push(['impostazioni', 'Impostazioni']);
    var nav = $('[data-tabs]');
    nav.textContent = '';
    tabs.forEach(function (t, i) {
      var b = el('button', { type: 'button', 'data-tab': t[0], 'aria-pressed': String(i === 0) }, [t[1]]);
      if (t[0] === 'richieste') b.appendChild(el('span', { class: 'badge', 'data-req-count': true, hidden: true }));
      if (t[0] === 'agenda') b.appendChild(el('span', { class: 'badge', 'data-pending-count': true, hidden: true, title: 'Richieste da approvare' }));
      b.addEventListener('click', function () { openTab(t[0]); });
      nav.appendChild(b);
    });
    nav.appendChild(el('button', { type: 'button', text: 'Esci', onclick: function () { api('POST', '/logout', {}).then(showLogin, showLogin); } }));
    openTab('agenda');
  }

  function openTab(tab) {
    $$('[data-tab]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-tab') === tab)); });
    $$('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== tab; });
    var job = null;
    if (tab === 'richieste') job = loadRequests();
    if (tab === 'orari') job = loadRules();
    if (tab === 'profilo') job = renderProfile();
    if (tab === 'servizi') job = renderServices();
    if (tab === 'professionisti') job = renderPros();
    if (tab === 'account') job = loadUsers();
    if (tab === 'sito') job = se.loaded ? null : loadSitePages();
    if (tab === 'sito') setTimeout(fitFrame, 0);
    if (job && job.catch) job.catch(function () { /* the api() helper already shows the login when the session is over */ });
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
    loadPendingCount();
    return api('GET', q).then(function (res) {
      state.events = res.events;
      $('[data-week]').hidden = state.view !== 'week';
      $('[data-list]').hidden = state.view !== 'list';
      if (state.view === 'week') renderWeek(); else renderList();
    }).catch(function (e) { $('[data-week]').textContent = e.message; });
  }

  // Requests from the website waiting for approval: count on the Agenda tab.
  function loadPendingCount() {
    api('GET', '/events/pending').then(function (res) {
      var badge = $('[data-pending-count]');
      if (badge) { badge.hidden = !res.events.length; badge.textContent = String(res.events.length); }
    }).catch(function () { /* the agenda still works */ });
  }

  // Short state shown on an appointment: request to approve, or whether the person confirmed.
  function evState(ev) {
    if (ev.kind === 'blocco') return null;
    if (ev.pending) return { cls: 'pending', text: 'Da approvare' };
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
    $('[data-ev-status]').hidden = true;
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
    $('[data-cancel]').textContent = ev.kind === 'blocco' ? 'Elimina blocco' : (ev.pending ? 'Annulla la richiesta' : 'Annulla appuntamento');
    setKind(ev.kind);
    // Emails to the person can be turned on for appointments set by hand.
    $('[data-send-box]').hidden = ev.kind === 'blocco' || ev.source !== 'manuale';
    form.sendEmail.checked = !!ev.notifyClient;
    form.emailLang.value = ev.lang || 'it';
    var st = evState(ev);
    var stBox = $('[data-ev-status]');
    if (ev.pending) {
      stBox.textContent = 'Richiesta dal sito, da approvare. Se non la approvi entro le ' + ((state.settings && state.settings.approvalDeadline) || '18:00') + ' del giorno prima, scade e la persona riceve un\'email per scegliere un altro orario.';
      stBox.hidden = false;
      $('[data-approve]').hidden = false;
      $('[data-decline]').hidden = false;
      $('[data-save]').hidden = true;
    } else if (st) {
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
  $('[data-approve]').addEventListener('click', function () {
    var ev = state.editing;
    api('POST', '/events/' + ev.id + '/approve', {}).then(function () { dlg.close(); refresh(); })
      .catch(function (e) { $('[data-dlg-error]').textContent = e.message; });
  });
  $('[data-decline]').addEventListener('click', function () {
    var ev = state.editing;
    if (!window.confirm('Rifiutare la richiesta? La persona riceverà un\'email per scegliere un altro orario.')) return;
    api('POST', '/events/' + ev.id + '/decline', {}).then(function () { dlg.close(); refresh(); })
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
      { name: 'nameEn', label: 'Nome in inglese (sito inglese)', max: 80 },
      { name: 'descriptionEn', label: 'Descrizione in inglese', type: 'textarea' },
      { name: 'priceEn', label: 'Tariffa in inglese (es. €70)', max: 60 },
      { name: 'firstMeeting', label: 'Primo colloquio gratuito dell\'area (usato da «Aiutami a scegliere»)', type: 'checkbox' },
      { name: 'sort', label: 'Ordine nell\'elenco', type: 'number' },
      { name: 'active', label: 'Attivo (visibile e prenotabile)', type: 'checkbox' },
    ], s ? Object.assign({}, s, { firstMeeting: s.firstMeeting === true }) : { categoryId: cats[0] && cats[0][0], durationMinutes: 50, sort: 0, active: true, firstMeeting: false }, function (v) {
      return (s ? api('PATCH', '/services/' + s.id, v) : api('POST', '/services', v)).then(loadCatalog).then(renderServices);
    });
  }

  function categoryDialog(c) {
    formDialog('Area: ' + c.name, [
      { name: 'name', label: 'Nome', max: 60 },
      { name: 'intro', label: 'Introduzione (compare sul sito)', type: 'textarea', max: 600 },
      { name: 'nameEn', label: 'Nome in inglese (sito inglese)', max: 60 },
      { name: 'introEn', label: 'Introduzione in inglese', type: 'textarea', max: 600 },
      { name: 'active', label: 'Visibile sul sito', type: 'checkbox' },
    ], Object.assign({}, c, { nameEn: c.nameEn !== undefined ? c.nameEn : c.name_en, introEn: c.introEn !== undefined ? c.introEn : c.intro_en }), function (v) { return api('PATCH', '/categories/' + c.id, v).then(loadCatalog).then(renderServices); });
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
      { name: 'titleEn', label: 'Titolo in inglese (es. Psychologist and psychotherapist)', max: 80 },
      { name: 'bioEn', label: 'Presentazione breve in inglese', type: 'textarea' },
      { name: 'langIt', label: 'Fa colloqui in italiano', type: 'checkbox' },
      { name: 'langEn', label: 'Fa colloqui in inglese (compare sul sito inglese e in «Help me choose»)', type: 'checkbox' },
      { name: 'albo', label: 'Iscrizione all\'Albo (es. Ordine degli Psicologi dell\'Emilia-Romagna n. 1234)', max: 120 },
      { name: 'notifyEmail', label: 'Email per gli avvisi di prenotazione', type: 'email' },
      { name: 'photo', label: 'Foto (nome del file, es. elsa-salvati)', max: 60, hint: 'Le foto si aggiungono al sito su richiesta; lascia vuoto per usare il logo.' },
      { name: 'sort', label: 'Ordine nell\'elenco', type: 'number' },
      { name: 'active', label: 'Attivo (visibile e prenotabile)', type: 'checkbox' },
    ], p ? Object.assign({}, p, { langIt: (p.languages || ['it']).indexOf('it') >= 0, langEn: (p.languages || []).indexOf('en') >= 0 })
      : { sort: 0, active: true, langIt: true, langEn: false }, function (v) {
      var offerings = v.__extra;
      delete v.__extra;
      v.languages = [v.langIt ? 'it' : null, v.langEn ? 'en' : null].filter(Boolean);
      if (!v.languages.length) v.languages = ['it'];
      delete v.langIt; delete v.langEn;
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
      { name: 'canEditSite', label: 'Può modificare il sito (testi e immagini delle pagine; gli amministratori possono sempre)', type: 'checkbox' },
    ];
    if (!u) specs.splice(1, 0, { name: 'email', label: 'Email', type: 'email' });
    formDialog(u ? 'Modifica account' : 'Nuovo account', specs, u ? Object.assign({}, u, { canEditSite: u.canEditSite === true }) : { role: 'professionista', canEditSite: false }, function (v) {
      if (u) return api('PATCH', '/users/' + u.id, v).then(loadUsers);
      var canEdit = v.canEditSite;
      delete v.canEditSite;
      return api('POST', '/users', v).then(function (r) {
        return canEdit && r.id ? api('PATCH', '/users/' + r.id, { canEditSite: true }).then(function () { return r; }) : r;
      }).then(function (r) {
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
            el('p', { class: 'hint', text: u.email + ' · ' + (u.role === 'admin' ? 'amministratore' : 'professionista') + (u.professionalName ? ' · ' + u.professionalName : '') + (u.role !== 'admin' && u.canEditSite ? ' · modifica il sito' : '') + ' · ' + status }),
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
    $$('input', e.target).forEach(function (i) { if (i.value.trim() !== '') s[i.name] = i.type === 'time' ? i.value : Number(i.value); });
    api('PUT', '/settings', { settings: s }).then(function (res) {
      state.settings = res.settings;
      status.className = 'status form-ok';
      status.textContent = 'Impostazioni salvate.';
    }).catch(function (e2) { status.className = 'status form-error'; status.textContent = e2.message; });
  });
  // ---------- people's rights: find, export, erase one person's data ----------
  function saveJson(data, name) {
    var url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  $('[data-people-form]').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = e.target.email.value.trim();
    var status = $('[data-people-status]');
    var box = $('[data-people-result]');
    box.textContent = '';
    status.textContent = 'Ricerca…';
    api('GET', '/people?email=' + encodeURIComponent(email)).then(function (res) {
      status.textContent = '';
      var n = res.events.length + res.requests.length;
      if (!n) { box.appendChild(el('p', { class: 'hint', text: 'Nessun dato trovato per questa email.' })); return; }
      var list = el('ul', { class: 'plain-list' });
      res.events.forEach(function (ev) {
        list.appendChild(el('li', { text: 'Appuntamento ' + (ev.date || '') + ' ' + (ev.time || '') + ' · ' + (ev.professionalName || '') + ' · ' + (ev.status || '') }));
      });
      res.requests.forEach(function (r) {
        list.appendChild(el('li', { text: 'Richiesta del ' + new Date(r.createdAt).toLocaleDateString('it-IT') + ' · ' + (r.category || '') }));
      });
      box.appendChild(el('p', { text: n + (n === 1 ? ' elemento trovato.' : ' elementi trovati.') }));
      box.appendChild(list);
      box.appendChild(el('div', { class: 'cta-row' }, [
        el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Scarica i dati (per inviarli alla persona)', onclick: function () {
          saveJson(res, 'dati-' + email.replace(/[^a-z0-9]+/gi, '-') + '.json');
        } }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Cancella i recapiti di questa persona', onclick: function () {
          if (!window.confirm('Cancellare nome, email, telefono e messaggi di ' + email + '? Gli appuntamenti restano in agenda senza nome. L\'operazione non si può annullare.')) return;
          api('POST', '/people/forget', { email: email, confirm: true }).then(function (r2) {
            box.textContent = '';
            status.textContent = 'Cancellati: recapiti di ' + r2.events + ' appuntamenti e ' + r2.requests + ' richieste.';
            refresh();
          }).catch(function (e2) { status.textContent = e2.message; });
        } }),
      ]));
    }).catch(function (e2) { status.textContent = e2.message; });
  });
  $('[data-audit-load]').addEventListener('click', function () {
    var box = $('[data-audit]');
    api('GET', '/audit').then(function (res) {
      box.textContent = '';
      if (!res.entries.length) { box.appendChild(el('p', { class: 'hint', text: 'Il registro è vuoto.' })); return; }
      var list = el('ul', { class: 'plain-list' });
      res.entries.forEach(function (x) {
        list.appendChild(el('li', { text: new Date(x.at).toLocaleString('it-IT') + ' · ' + (x.user_name || 'account rimosso') + ' · ' + x.action + (x.detail ? ' (' + x.detail + ')' : '') }));
      });
      box.appendChild(list);
    }).catch(function (e2) { box.textContent = e2.message; });
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
          el('p', {}, [el('strong', { text: r.name || '—' }), (r.organization ? ' · ' + r.organization : '') + ' · ' + when]),
          r.email ? el('p', {}, [el('a', { href: 'mailto:' + encodeURIComponent(r.email).replace(/%40/g, '@'), text: r.email })]) : null,
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

  // =====================================================================
  // ---------- page editor ("Sito") ----------
  // Pages are lists of blocks. Every change is saved as a draft after a short pause;
  // "Pubblica" puts the draft online. Text is kept as data (bold, italic, links only).
  // =====================================================================
  var PAGE_NAMES = {
    index: 'Home', servizi: 'Come possiamo aiutarti', lavoro: 'Orientamento e carriera', coaching: 'Coaching',
    sostegno: 'Sostegno psicologico', psicoterapia: 'Psicoterapia', differenze: 'Le differenze', team: 'Team',
    'costi-e-faq': 'Tariffe e prenotazioni', aziende: 'Aziende', contatti: 'Contatti', prenota: 'Prenotazione',
    privacy: 'Privacy', cookie: 'Cookie',
  };
  var PAGE_ORDER = ['index', 'servizi', 'lavoro', 'coaching', 'sostegno', 'psicoterapia', 'differenze', 'team', 'costi-e-faq', 'aziende', 'contatti', 'prenota'];
  var BG_LABEL = { light: 'Chiaro', soft: 'Tenue (menta)', dark: 'Scuro' };
  var STYLE_LABEL = { primary: 'Principale', ghost: 'Secondario', light: 'Chiaro (su fondo scuro)', 'outline-light': 'Bordato (su fondo scuro)' };
  var KIND_NAMES = { p: 'Paragrafo', lead: 'Paragrafo in evidenza', stat: 'Dato con fonte', arrow: 'Link con freccia' };
  var VERSION_KIND = { pubblicazione: 'Pubblicata', ripristino: 'Ripristino', iniziale: 'Versione iniziale' };
  var LANG_NAME = { it: 'Italiano', en: 'Inglese' };

  var se = {
    pages: [], page: null, draft: null, expected: null, library: {}, linkTargets: [], pros: [],
    selected: -1, dirty: false, saving: false, again: false, timer: null, previewTimer: null,
    device: 'desktop', refOpen: false, refPage: null, loaded: false, tab: 'blocks',
    // Header, footer and studio details ("globals"): mode 'global', scope it | en | studio.
    mode: 'page', globals: null, gscope: null, gdata: null, gexpected: null, gpreview: null,
  };
  var GLOBAL_NAMES = { it: 'Intestazione e piè di pagina', en: 'Intestazione e piè di pagina', studio: 'Dati dello studio' };

  function pageName(key) { return PAGE_NAMES[key] || key; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function timeNow() { return new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
  function pathOf(key, lang) {
    var p = se.pages.find(function (x) { return x.key === key && x.lang === lang; });
    return p ? p.path : null;
  }
  function safeHref(h) {
    return typeof h === 'string' && (/^\/media\/[a-f0-9]{24}\.pdf$/.test(h) || /^\/(?!\/)[a-z0-9\-/]*(#[a-z0-9-]+)?(\?[a-z0-9=&_-]+)?$/i.test(h) || /^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(h) || /^mailto:[^\s<>"'?&]+@/i.test(h) || /^tel:\+?[0-9 ]{6,20}$/.test(h));
  }
  function isExternalOk(h) { return /^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(\/[^\s<>"']*)?$/i.test(h) || /^mailto:[^\s<>"'?&]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(h) || /^tel:\+?[0-9 ]{6,20}$/.test(h); }

  // ---------- rich text: editable DOM <-> { p: [[{ t, b, i, href }]] } ----------
  function richToDom(value, box) {
    box.textContent = '';
    var paras = value && value.p && value.p.length ? value.p : [[]];
    paras.forEach(function (para) {
      var p = el('p');
      para.forEach(function (r) {
        var node = document.createTextNode(r.t);
        if (r.i) { var em = el('em'); em.appendChild(node); node = em; }
        if (r.b) { var st = el('strong'); st.appendChild(node); node = st; }
        if (r.href && safeHref(r.href)) { var a = el('a', { href: r.href }); a.appendChild(node); node = a; }
        p.appendChild(node);
      });
      if (!p.childNodes.length) p.appendChild(el('br'));
      box.appendChild(p);
    });
  }

  function isBoldEl(n) {
    if (n.nodeName === 'B' || n.nodeName === 'STRONG') return true;
    var w = n.style && n.style.fontWeight;
    return w === 'bold' || w === 'bolder' || Number(w) >= 600;
  }
  function isItalicEl(n) { return n.nodeName === 'I' || n.nodeName === 'EM' || (n.style && n.style.fontStyle === 'italic'); }
  var BLOCK_TAGS = { P: 1, DIV: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, BLOCKQUOTE: 1, TR: 1, SECTION: 1, ARTICLE: 1, UL: 1, OL: 1, TABLE: 1 };

  // Walks any DOM (the editor's, or pasted HTML) and keeps only text with bold, italic and, if asked, links.
  function domToRuns(root, keepLinks) {
    var paras = [[]];
    function br() { if (paras[paras.length - 1].length) paras.push([]); }
    function walk(n, fmt) {
      if (n.nodeType === 3) {
        var t = n.nodeValue.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ');
        if (t) {
          var r = { t: t };
          if (fmt.b) r.b = true;
          if (fmt.i) r.i = true;
          if (fmt.href) r.href = fmt.href;
          paras[paras.length - 1].push(r);
        }
        return;
      }
      if (n.nodeType !== 1) return;
      var tag = n.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'HEAD' || tag === 'META' || tag === 'TITLE' || tag === 'IMG' || tag === 'SVG' || tag === 'IFRAME' || tag === 'OBJECT') return;
      if (tag === 'BR') { br(); return; }
      var f = { b: fmt.b || isBoldEl(n), i: fmt.i || isItalicEl(n), href: fmt.href };
      if (keepLinks && tag === 'A') { var h = n.getAttribute('href'); if (safeHref(h)) f.href = h; }
      var block = BLOCK_TAGS[tag];
      if (block) br();
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c, f);
      if (block) br();
    }
    walk(root, {});
    // Merge runs with the same format, trim each paragraph, drop empty ones.
    return paras.map(function (para) {
      var out = [];
      para.forEach(function (r) {
        var prev = out[out.length - 1];
        if (prev && !!prev.b === !!r.b && !!prev.i === !!r.i && prev.href === r.href) prev.t += r.t;
        else out.push(Object.assign({}, r));
      });
      if (out.length) { out[0].t = out[0].t.replace(/^ /, ''); out[out.length - 1].t = out[out.length - 1].t.replace(/ $/, ''); }
      return out.filter(function (r) { return r.t; });
    }).filter(function (p) { return p.length; });
  }

  function escText(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Paste: only the text, with bold and italic. Links, styles, images and scripts are dropped.
  function pastedHtml(e, multiline) {
    var cd = e.clipboardData || window.clipboardData;
    if (!cd) return null;
    var html = cd.getData('text/html');
    var paras;
    if (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      paras = domToRuns(doc.body, false);
    } else {
      paras = String(cd.getData('text/plain') || '').split(/\r?\n/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
        .filter(Boolean).map(function (t) { return [{ t: t }]; });
    }
    var parts = paras.map(function (para) {
      return para.map(function (r) {
        var s = escText(r.t);
        if (r.i) s = '<i>' + s + '</i>';
        if (r.b) s = '<b>' + s + '</b>';
        return s;
      }).join('');
    });
    return parts.join(multiline ? '<br>' : ' ');
  }

  var savedRange = null;
  function rememberSelection(box) {
    var sel = window.getSelection();
    if (sel.rangeCount && box.contains(sel.getRangeAt(0).commonAncestorContainer)) savedRange = sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection() {
    if (!savedRange) return;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  function richEditor(value, opts, onChange) {
    var multiline = opts.multiline !== false;
    var box = el('div', { class: 'rte-box', contenteditable: 'true', role: 'textbox', 'aria-multiline': multiline ? 'true' : 'false', 'aria-label': opts.label || 'Testo', spellcheck: 'true' });
    richToDom(value, box);
    var counter = opts.max ? el('span', { class: 'se-count' }) : null;
    function update() {
      var model = { p: domToRuns(box, true) };
      if (!multiline && model.p.length > 1) model.p = [model.p.reduce(function (a, p) { return a.concat(a.length ? [{ t: ' ' }] : [], p); }, [])];
      if (counter) {
        var n = model.p.reduce(function (s, p) { return s + p.reduce(function (t, r) { return t + r.t.length; }, 0); }, 0);
        counter.textContent = n + ' / ' + opts.max;
        counter.classList.toggle('over', n > opts.max);
      }
      onChange(model);
    }
    function cmd(name, arg) { box.focus(); restoreSelection(); document.execCommand(name, false, arg); update(); }
    function link() {
      rememberSelection(box);
      var sel = window.getSelection();
      if (!savedRange || savedRange.collapsed) { window.alert('Seleziona prima le parole da trasformare in link.'); return; }
      linkDialog(function (href) { cmd('createLink', href); });
      void sel;
    }
    var bar = el('div', { class: 'rte-bar', role: 'toolbar', 'aria-label': 'Formato del testo' }, [
      el('button', { type: 'button', class: 'rte-btn', title: 'Grassetto (Ctrl/Cmd+B)', 'aria-label': 'Grassetto', onmousedown: function (e) { e.preventDefault(); }, onclick: function () { cmd('bold'); } }, [el('strong', { text: 'B' })]),
      el('button', { type: 'button', class: 'rte-btn', title: 'Corsivo (Ctrl/Cmd+I)', 'aria-label': 'Corsivo', onmousedown: function (e) { e.preventDefault(); }, onclick: function () { cmd('italic'); } }, [el('em', { text: 'I' })]),
      el('button', { type: 'button', class: 'rte-btn', title: 'Link (Ctrl/Cmd+K)', 'aria-label': 'Aggiungi link', onmousedown: function (e) { e.preventDefault(); }, onclick: link, text: 'Link' }),
      el('button', { type: 'button', class: 'rte-btn', title: 'Togli il link', 'aria-label': 'Togli il link', onmousedown: function (e) { e.preventDefault(); }, onclick: function () { cmd('unlink'); }, text: 'Togli link' }),
    ]);
    box.addEventListener('input', update);
    box.addEventListener('keyup', function () { rememberSelection(box); });
    box.addEventListener('mouseup', function () { rememberSelection(box); });
    box.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); link(); }
      if (e.key === 'Enter' && !multiline) e.preventDefault();
      if (mod && /^[uU]$/.test(e.key)) e.preventDefault(); // no underline
    });
    box.addEventListener('paste', function (e) {
      e.preventDefault();
      var html = pastedHtml(e, multiline);
      if (html) document.execCommand('insertHTML', false, html);
      // The browser may add inline styles while inserting: remove them so only bold and italic stay.
      Array.prototype.forEach.call(box.querySelectorAll('[style],[class],[color],[face]'), function (n) {
        n.removeAttribute('style'); n.removeAttribute('class'); n.removeAttribute('color'); n.removeAttribute('face');
      });
      Array.prototype.forEach.call(box.querySelectorAll('span,font'), function (n) {
        while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n);
        n.parentNode.removeChild(n);
      });
      update();
    });
    box.addEventListener('drop', function (e) { e.preventDefault(); });
    if (counter) { var n0 = (value && value.p || []).reduce(function (s, p) { return s + p.reduce(function (t, r) { return t + r.t.length; }, 0); }, 0); counter.textContent = n0 + ' / ' + opts.max; }
    return el('div', { class: 'rte' }, [bar, box, counter]);
  }

  // Link inside a text: a page of the site (same tab) or an outside address (new tab, decided by the site).
  function linkDialog(onPick) {
    var lang = se.page.lang;
    var own = se.pages.filter(function (p) { return p.lang === lang; });
    var dlg = el('dialog', { class: 'dlg' });
    var sel = el('select', { id: 'ld-page' }, own.map(function (p) { return el('option', { value: p.path, text: pageName(p.key) + ' (' + p.path + ')' }); }));
    var url = el('input', { id: 'ld-url', type: 'url', placeholder: 'https://…', maxlength: 500 });
    var kindPage = el('input', { type: 'radio', name: 'ld-kind', value: 'page', checked: true });
    var kindUrl = el('input', { type: 'radio', name: 'ld-kind', value: 'url' });
    var kindPdf = el('input', { type: 'radio', name: 'ld-kind', value: 'pdf' });
    var pdfSel = el('select', { id: 'ld-pdf' }, [el('option', { value: '', text: 'Carico i PDF della libreria…' })]);
    api('GET', '/site/media').then(function (res) {
      var pdfs = res.media.filter(function (m) { return m.kind === 'pdf'; });
      pdfSel.textContent = '';
      if (!pdfs.length) { pdfSel.appendChild(el('option', { value: '', text: 'Nessun PDF: caricali da «Media»' })); return; }
      pdfs.forEach(function (m) { pdfSel.appendChild(el('option', { value: m.url, text: m.name + ' (' + kb(m.bytes) + ')' })); });
    }).catch(function () { pdfSel.textContent = ''; pdfSel.appendChild(el('option', { value: '', text: 'Libreria non disponibile' })); });
    var err = el('p', { class: 'status form-error', role: 'alert' });
    var form = el('form', { class: 'dlg-inner', method: 'dialog' }, [
      el('div', { class: 'dlg-head' }, [el('h2', { text: 'Aggiungi un link' })]),
      el('label', { class: 'check' }, [kindPage, el('span', { text: 'Pagina del sito (si apre nella stessa scheda)' })]),
      el('div', { class: 'field' }, [el('label', { for: 'ld-page', text: 'Pagina' }), sel]),
      el('label', { class: 'check' }, [kindUrl, el('span', { text: 'Indirizzo esterno (si apre in una nuova scheda)' })]),
      el('div', { class: 'field' }, [el('label', { for: 'ld-url', text: 'Indirizzo (https://…, mailto:… o tel:…)' }), url]),
      el('label', { class: 'check' }, [kindPdf, el('span', { text: 'Documento PDF della libreria (si apre in una nuova scheda)' })]),
      el('div', { class: 'field' }, [el('label', { for: 'ld-pdf', text: 'Documento' }), pdfSel]),
      err,
      el('div', { class: 'cta-row dlg-actions' }, [
        el('button', { type: 'submit', class: 'btn btn-primary btn-small', text: 'Aggiungi' }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Annulla', onclick: function () { dlg.close(); } }),
      ]),
    ]);
    url.addEventListener('focus', function () { kindUrl.checked = true; });
    sel.addEventListener('focus', function () { kindPage.checked = true; });
    pdfSel.addEventListener('focus', function () { kindPdf.checked = true; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var href;
      if (kindUrl.checked) {
        href = url.value.trim();
        if (/^www\./i.test(href)) href = 'https://' + href;
        if (!isExternalOk(href)) { err.textContent = 'Scrivi un indirizzo completo, che inizi con https://, mailto: o tel:'; return; }
      } else if (kindPdf.checked) {
        href = pdfSel.value;
        if (!/^\/media\/[a-f0-9]{24}\.pdf$/.test(href)) { err.textContent = 'Scegli un PDF dalla libreria.'; return; }
      } else href = sel.value;
      dlg.close();
      onPick(href);
    });
    dlg.appendChild(form);
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- small form pieces ----------
  var uid = 0;
  function nextId() { uid += 1; return 'se-' + uid; }

  function textInput(label, value, max, onChange, opts) {
    opts = opts || {};
    var id = nextId();
    var input = el(opts.area ? 'textarea' : 'input', { id: id, type: opts.area ? null : (opts.type || 'text'), maxlength: max || 200, rows: opts.area ? 3 : null, placeholder: opts.placeholder || null });
    input.value = value || '';
    var counter = max ? el('span', { class: 'se-count' }) : null;
    function count() {
      if (!counter) return;
      var n = input.value.length;
      counter.textContent = n + ' / ' + (opts.recommended ? opts.recommended + ' consigliati' : max);
      counter.classList.toggle('over', opts.recommended ? n > opts.recommended : n >= max);
    }
    count();
    input.addEventListener('input', function () { count(); onChange(input.value); });
    return el('div', { class: 'field se-field' }, [el('label', { for: id, text: label + (opts.required ? ' *' : '') }), input, counter, opts.hint ? el('span', { class: 'hint', text: opts.hint }) : null]);
  }

  function selectInput(label, options, value, onChange) {
    var id = nextId();
    var s = el('select', { id: id }, options.map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    s.value = value;
    if (s.value !== value && options[0]) s.value = options[0][0];
    s.addEventListener('change', function () { onChange(s.value); });
    return el('div', { class: 'field se-field' }, [el('label', { for: id, text: label }), s]);
  }

  function checkInput(label, value, onChange) {
    var c = el('input', { type: 'checkbox' });
    c.checked = !!value;
    c.addEventListener('change', function () { onChange(c.checked); });
    return el('label', { class: 'check se-check' }, [c, el('span', { text: label })]);
  }

  function moveItem(arr, i, d) {
    var j = i + d;
    if (j < 0 || j >= arr.length) return false;
    var x = arr[i]; arr[i] = arr[j]; arr[j] = x;
    return true;
  }

  function itemTools(arr, i, rerender, opts) {
    opts = opts || {};
    var label = opts.label || 'voce';
    return el('div', { class: 'se-tools' }, [
      el('button', { type: 'button', class: 'se-icon', 'aria-label': 'Sposta su ' + label + ' ' + (i + 1), title: 'Sposta su', disabled: i === 0, onclick: function () { if (moveItem(arr, i, -1)) { changed(); rerender(); } }, text: '↑' }),
      el('button', { type: 'button', class: 'se-icon', 'aria-label': 'Sposta giù ' + label + ' ' + (i + 1), title: 'Sposta giù', disabled: i === arr.length - 1, onclick: function () { if (moveItem(arr, i, 1)) { changed(); rerender(); } }, text: '↓' }),
      opts.noRemove ? null : el('button', { type: 'button', class: 'se-icon se-danger', 'aria-label': 'Elimina ' + label + ' ' + (i + 1), title: 'Elimina', onclick: function () {
        if (opts.min !== undefined && arr.length <= opts.min) { window.alert('Servono almeno ' + opts.min + ' elementi.'); return; }
        if (!window.confirm('Eliminare questo elemento?')) return;
        arr.splice(i, 1); changed(); rerender();
      }, text: '✕' }),
    ]);
  }

  // Where a button or link goes: page of the site, place in this page, booking, outside address.
  function targetEditor(to, onChange) {
    to = to || { kind: 'page', key: '' };
    var wrap = el('div', { class: 'se-target' });
    function render() {
      wrap.textContent = '';
      var isPdf = to.kind === 'url' && /^\/media\/[a-f0-9]{24}\.pdf$/.test(to.href || '');
      wrap.appendChild(selectInput('Destinazione', [['page', 'Pagina del sito'], ['anchor', 'Punto di questa pagina'], ['book', 'Prenotazione'], ['url', 'Indirizzo esterno'], ['pdf', 'Documento PDF della libreria']], isPdf ? 'pdf' : to.kind, function (k) {
        if (k === 'pdf') { pickMedia({ kind: 'pdf' }, function (m) { to = { kind: 'url', href: m.url }; onChange(to); render(); }); return; }
        to = k === 'page' ? { kind: 'page', key: (se.linkTargets[0] || {}).key || '' } : k === 'anchor' ? { kind: 'anchor', anchor: '' } : k === 'book' ? { kind: 'book' } : { kind: 'url', href: 'https://' };
        onChange(to); render();
      }));
      if (to.kind === 'page') {
        var lang = se.page.lang;
        var opts = se.linkTargets.map(function (t) {
          var here = t[lang];
          return [t.key, pageName(t.key) + (here ? '' : ' (manca in ' + (lang === 'en' ? 'inglese' : 'italiano') + ')')];
        });
        if (to.key && !opts.some(function (o) { return o[0] === to.key; })) opts.push([to.key, to.key]);
        wrap.appendChild(selectInput('Pagina', opts, to.key, function (v) { to.key = v; onChange(to); }));
        wrap.appendChild(textInput('Punto della pagina (facoltativo, es. come-funziona)', to.anchor || '', 40, function (v) {
          v = v.trim().replace(/^#/, ''); if (v) to.anchor = v; else delete to.anchor; onChange(to);
        }));
      } else if (to.kind === 'anchor') {
        wrap.appendChild(textInput('Nome del punto (es. contatto)', to.anchor || '', 40, function (v) { to.anchor = v.trim().replace(/^#/, ''); onChange(to); }));
      } else if (to.kind === 'book') {
        wrap.appendChild(selectInput('Con la professionista già scelta', [['', 'Nessuna (sceglie chi prenota)']].concat(se.pros.map(function (p) { return [p.slug, p.name]; })), to.pro || '', function (v) {
          if (v) to.pro = v; else delete to.pro; onChange(to);
        }));
      } else if (isPdf) {
        wrap.appendChild(el('p', { class: 'hint', text: 'Documento: ' + to.href + ' (si apre in una nuova scheda).' }));
        wrap.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Scegli un altro PDF', onclick: function () { pickMedia({ kind: 'pdf' }, function (m) { to = { kind: 'url', href: m.url }; onChange(to); render(); }); } }));
      } else {
        var hint = el('span', { class: 'hint' });
        var f = textInput('Indirizzo (si apre in una nuova scheda)', to.href || '', 500, function (v) {
          to.href = v.trim(); hint.textContent = isExternalOk(to.href) ? '' : 'Deve iniziare con https://, mailto: o tel:'; onChange(to);
        }, { type: 'url' });
        f.appendChild(hint);
        wrap.appendChild(f);
      }
    }
    render();
    return wrap;
  }

  // A link or a button. Optional ones can be switched off.
  function linkEditor(value, opts, onChange) {
    var box = el('div', { class: 'se-link' });
    function render() {
      box.textContent = '';
      if (opts.optional) {
        box.appendChild(checkInput(opts.label, !!value, function (on) {
          value = on ? { label: '', to: { kind: 'page', key: (se.linkTargets[0] || {}).key || '' } } : null;
          if (value && opts.styles) value.style = opts.styles[0];
          onChange(value); render();
        }));
        if (!value) return;
      } else if (opts.label) box.appendChild(el('p', { class: 'se-sub', text: opts.label }));
      box.appendChild(textInput('Testo', value.label, 120, function (v) { value.label = v; onChange(value); }, { required: true }));
      box.appendChild(targetEditor(value.to, function (to) { value.to = to; onChange(value); }));
      if (opts.styles && opts.styles.length > 1) {
        box.appendChild(selectInput('Stile', opts.styles.map(function (s) { return [s, STYLE_LABEL[s] || s]; }), value.style || opts.styles[0], function (s) { value.style = s; onChange(value); }));
      }
    }
    render();
    return box;
  }

  function listEditor(arr, opts, renderItem) {
    var box = el('div', { class: 'se-list' });
    function render() {
      box.textContent = '';
      arr.forEach(function (item, i) {
        var card = el('div', { class: 'se-item' }, [
          el('div', { class: 'se-item-head' }, [el('strong', { text: (opts.itemLabel || 'Voce') + ' ' + (i + 1) }), itemTools(arr, i, render, { label: (opts.itemLabel || 'voce').toLowerCase(), min: opts.min })]),
        ]);
        card.appendChild(renderItem(item, i, function (v) { arr[i] = v; }));
        box.appendChild(card);
      });
      if (arr.length < (opts.max || 12)) {
        box.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small se-add', text: '+ Aggiungi ' + (opts.itemLabel || 'voce').toLowerCase(), onclick: function () { arr.push(opts.make()); changed(); render(); } }));
      }
    }
    render();
    return box;
  }

  // ---------- default values for new blocks and items ----------
  function emptyValue(f) {
    switch (f.type) {
      case 'text': return f.required ? 'Testo da scrivere' : '';
      case 'note': case 'anchor': return '';
      case 'rich': return f.required ? { p: [[{ t: 'Testo da scrivere' }]] } : { p: [] };
      case 'flow': case 'links': case 'buttons': case 'textlist': return [];
      case 'select': return f.options[0][0];
      case 'bool': return false;
      case 'link': case 'button': case 'image': return null;
      case 'list': { var out = []; for (var i = 0; i < (f.min || 0); i++) out.push(emptyData(f.fields)); return out; }
      default: return null;
    }
  }
  function emptyData(fields) { var d = {}; fields.forEach(function (f) { d[f.name] = emptyValue(f); }); return d; }

  // ---------- media: photos converted in the browser (the original never leaves the computer) ----------
  // Research 20: WebP q 0.80 + JPEG q 0.82; widths per use; never wider than the photo itself.
  var ROLE_WIDTHS = { content: [480, 800, 1200], wide: [640, 960, 1280, 1920, 2560] };
  var ROLE_FALLBACK = { content: 800, wide: 1280 };
  var ROLE_NAMES = { content: 'Foto o immagine nel testo', wide: 'Immagine a tutta larghezza', social: 'Immagine per i social' };
  var WEBP_Q = 0.80;
  var JPEG_Q = 0.82;
  var MAX_INPUT = 40 * 1024 * 1024;
  // Test switch: ?webp=wasm forces the WebAssembly encoder (what Safari uses).
  var FORCE_WASM = /[?&]webp=wasm\b/.test(location.search);

  /** Thumbnail URL of an image value stored in a block (library, older uploads, files in /assets/img). */
  function thumbUrl(v) {
    if (!v || !v.id) return '';
    if (v.id.indexOf('static-') === 0) return '/assets/img/' + v.id.slice(7) + '-480.webp';
    if (v.social) return '/media/' + v.id + '-1200x630.jpg';
    if (v.variants && v.variants.length) return '/media/' + v.id + '-' + v.variants[0] + '.' + (v.format === 'jpg' ? 'jpg' : 'webp');
    return '/media/' + v.id + '-480.webp';
  }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  // Decode the photo with the right rotation (EXIF). Big phone photos are reduced right away to the widest
  // version needed (sizes depend on the width), so the browser never holds the full 12–48 MP picture.
  function decodePhoto(file, maxWidth) {
    if (!window.createImageBitmap) return Promise.reject(new Error('Questo browser è troppo vecchio per preparare le foto. Aggiornalo e riprova.'));
    return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
      if (bmp.width <= maxWidth) return bmp;
      var k = maxWidth / bmp.width;
      var opts = { imageOrientation: 'from-image', resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' };
      bmp.close && bmp.close();
      return createImageBitmap(file, opts);
    }).catch(function () {
      throw new Error('Non riesco ad aprire questa foto. Se viene dall\'iPhone (HEIC), esportala in JPG e riprova.');
    });
  }

  // Resize with good quality everywhere: halve step by step, then draw at the final size.
  function drawScaled(src, sx, sy, sw, sh, w, h, jpeg) {
    var cur = src; var cx = sx; var cy = sy; var cw = sw; var ch = sh;
    while (cw / 2 >= w && ch / 2 >= h) {
      var half = document.createElement('canvas');
      half.width = Math.round(cw / 2); half.height = Math.round(ch / 2);
      var hc = half.getContext('2d');
      hc.imageSmoothingEnabled = true; hc.imageSmoothingQuality = 'high';
      hc.drawImage(cur, cx, cy, cw, ch, 0, 0, half.width, half.height);
      cur = half; cx = 0; cy = 0; cw = half.width; ch = half.height;
    }
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (jpeg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(cur, cx, cy, cw, ch, 0, 0, w, h);
    return c;
  }

  function toBlob(canvas, type, q) {
    return new Promise(function (resolve) { canvas.toBlob(function (b) { resolve(b); }, type, q); });
  }
  function blobToBase64(b) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1]); };
      fr.onerror = function () { reject(new Error('Lettura del file non riuscita')); };
      fr.readAsDataURL(b);
    });
  }

  // WebP: the browser's own encoder when it really makes WebP; otherwise libwebp in a worker (Safari).
  var nativeWebp = null;
  function canNativeWebp() {
    if (FORCE_WASM) return Promise.resolve(false);
    if (nativeWebp !== null) return Promise.resolve(nativeWebp);
    var c = document.createElement('canvas'); c.width = 2; c.height = 2;
    return toBlob(c, 'image/webp', 0.8).then(function (b) { nativeWebp = !!(b && b.type === 'image/webp'); return nativeWebp; });
  }
  var worker = null; var jobs = {}; var jobId = 0;
  function wasmWebp(canvas, q) {
    return new Promise(function (resolve, reject) {
      try {
        if (!worker) {
          worker = new Worker('/admin/vendor/jsquash/webp-worker.js', { type: 'module' });
          worker.onmessage = function (e) {
            var j = jobs[e.data.id]; delete jobs[e.data.id];
            if (!j) return;
            if (e.data.error) j.reject(new Error(e.data.error)); else j.resolve(new Blob([e.data.buffer], { type: 'image/webp' }));
          };
          worker.onerror = function (e) {
            Object.keys(jobs).forEach(function (k) { jobs[k].reject(new Error(e.message || 'convertitore non disponibile')); delete jobs[k]; });
            worker = null;
          };
        }
        var img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        jobId += 1;
        jobs[jobId] = { resolve: resolve, reject: reject };
        worker.postMessage({ id: jobId, data: img.data, width: img.width, height: img.height, quality: q * 100 }, [img.data.buffer]);
      } catch (err) { reject(err); }
    });
  }
  function encodeWebp(canvas, q) {
    return canNativeWebp().then(function (ok) {
      if (ok) return toBlob(canvas, 'image/webp', q).then(function (b) { if (b && b.type === 'image/webp') return b; return wasmWebp(canvas, q); });
      return wasmWebp(canvas, q);
    });
  }
  // A version over 1.4 MB is encoded again a little lighter.
  function encodeFit(canvas, type, q) {
    var job = type === 'image/webp' ? encodeWebp(canvas, q) : toBlob(canvas, 'image/jpeg', q);
    return job.then(function (b) {
      if (!b) throw new Error('Preparazione della foto non riuscita');
      if (b.size > 1400000 && q > 0.5) return encodeFit(canvas, type, q - 0.12);
      return b;
    });
  }

  /**
   * Prepare every version for a use ("role") and upload them. onStep(text) shows the progress.
   * Returns the library item from the server.
   */
  function uploadPhoto(file, role, onStep) {
    onStep = onStep || function () {};
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || '') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) return Promise.reject(new Error('Usa una foto JPG, PNG o WebP.'));
    if (file.size > MAX_INPUT) return Promise.reject(new Error('La foto è troppo grande (massimo 40 MB).'));
    var social = role === 'social';
    var widths = social ? [] : ROLE_WIDTHS[role];
    onStep('Apro la foto…');
    return decodePhoto(file, social ? 2400 : Math.max.apply(null, widths)).then(function (bmp) {
      var W = bmp.width; var H = bmp.height;
      var files = {}; var plan = [];
      if (social) {
        if (W < 600 || H < 315) throw new Error('Per i social serve una foto di almeno 600 × 315 pixel.');
        // Centre crop to 1200 × 630 (1.91:1).
        var r = 1200 / 630; var cw = W; var ch = Math.round(W / r);
        if (ch > H) { ch = H; cw = Math.round(H * r); }
        plan.push({ name: '1200x630.jpg', type: 'image/jpeg', q: JPEG_Q, canvas: function () { return drawScaled(bmp, Math.round((W - cw) / 2), Math.round((H - ch) / 2), cw, ch, 1200, 630, true); } });
      } else {
        var usable = widths.filter(function (w) { return w <= W; });
        if (!usable.length) throw new Error('La foto è troppo piccola: serve almeno ' + widths[0] + ' pixel di larghezza.');
        var fb = usable.indexOf(ROLE_FALLBACK[role]) >= 0 ? ROLE_FALLBACK[role] : usable[usable.length - 1];
        usable.forEach(function (w) {
          plan.push({ name: w + '.webp', w: w, type: 'image/webp', q: WEBP_Q });
        });
        plan.push({ name: fb + '.jpg', w: fb, type: 'image/jpeg', q: JPEG_Q });
        plan.forEach(function (x) { var h = Math.round(H * x.w / W); x.canvas = function () { return drawScaled(bmp, 0, 0, W, H, x.w, h, x.type === 'image/jpeg'); }; });
      }
      var n = 0; var total = 0; var noWebp = false;
      function step(i) {
        if (i >= plan.length) return Promise.resolve();
        var x = plan[i];
        n += 1;
        onStep('Preparo la versione ' + n + ' di ' + plan.length + ' (' + x.name.replace('.', ' ') + ')…');
        var c = x.canvas();
        var job = encodeFit(c, x.type, x.q).catch(function (err) {
          if (x.type !== 'image/webp') throw err;
          // No WebP encoder at all (e.g. WebAssembly blocked): JPEG versions instead, the page still gets every size.
          noWebp = true;
          return encodeFit(c, 'image/jpeg', JPEG_Q).then(function (b) { x.name = x.w + '.jpg'; return b; });
        });
        return job.then(function (b) {
          total += b.size;
          return blobToBase64(b).then(function (data) { files[x.name] = data; return step(i + 1); });
        });
      }
      return step(0).then(function () {
        bmp.close && bmp.close();
        // Keep the upload under the server's limit: drop the widest versions if needed.
        var order = Object.keys(files).filter(function (k) { return /\.webp$/.test(k); }).sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });
        function size() { return Object.keys(files).reduce(function (t, k) { return t + files[k].length * 0.75; }, 0); }
        while (size() > 4200000 && order.length > 1) delete files[order.shift()];
        onStep('Carico ' + kb(size()) + (noWebp ? ' (versioni JPEG)' : '') + '…');
        return api('POST', '/site/media', { role: role, name: file.name, files: files });
      });
    }).then(function (res) { return res.media; });
  }

  function uploadPdf(file, onStep) {
    if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') return Promise.reject(new Error('Scegli un file PDF.'));
    if (file.size > 4 * 1024 * 1024) return Promise.reject(new Error('Il PDF è troppo grande (massimo 4 MB). Prova a esportarlo con una qualità inferiore.'));
    (onStep || function () {})('Carico il PDF…');
    return blobToBase64(file).then(function (data) { return api('POST', '/site/media', { kind: 'pdf', name: file.name, data: data }); })
      .then(function (res) { return res.media; });
  }

  function usedText(m) {
    if (!m.usedIn || !m.usedIn.length) return 'Non usato in nessuna pagina';
    return 'Usato in: ' + m.usedIn.map(function (u) {
      var where = u.type === 'page' ? pageName(u.key) + (u.lang ? ' (' + u.lang.toUpperCase() + ')' : '') : u.title + (u.lang ? ' (' + u.lang.toUpperCase() + ')' : '');
      return where + (u.published ? '' : ' – solo bozza');
    }).join(', ');
  }

  function mediaCard(m, actions) {
    var visual = m.kind === 'pdf'
      ? el('div', { class: 'md-pdf', 'aria-hidden': 'true', text: 'PDF' })
      : el('img', { class: 'md-thumb', src: m.thumb, alt: '', loading: 'lazy' });
    var meta = m.kind === 'pdf' ? 'PDF · ' + kb(m.bytes) : ROLE_NAMES[m.role] + ' · ' + m.width + ' × ' + m.height + ' · ' + kb(m.bytes) + ' in ' + m.variants.length + (m.variants.length === 1 ? ' versione' : ' versioni');
    return el('li', { class: 'md-card' }, [visual, el('div', { class: 'md-body' }, [
      el('strong', { class: 'md-name', text: m.name || '(senza nome)' }),
      el('span', { class: 'hint', text: meta }),
      el('span', { class: 'hint md-used', text: usedText(m) }),
      actions ? el('div', { class: 'md-actions' }, actions) : null,
    ])]);
  }

  /** Choose a file from the library. filter: { kind: 'image'|'pdf', role? } */
  function pickMedia(filter, onPick) {
    var dlg = el('dialog', { class: 'dlg md-dialog' });
    var list = el('ul', { class: 'md-grid', role: 'list' }, [el('li', { class: 'hint', text: 'Carico la libreria…' })]);
    dlg.appendChild(el('div', { class: 'dlg-inner' }, [
      el('div', { class: 'dlg-head' }, [el('h2', { text: filter.kind === 'pdf' ? 'Scegli un PDF' : 'Scegli un\'immagine' }),
        el('button', { type: 'button', class: 'round', 'aria-label': 'Chiudi', text: '×', onclick: function () { dlg.close(); } })]),
      filter.role ? el('p', { class: 'hint', text: 'Solo i file caricati come «' + ROLE_NAMES[filter.role] + '».' }) : null,
      list,
    ]));
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    api('GET', '/site/media').then(function (res) {
      var items = res.media.filter(function (m) { return m.kind === filter.kind && (!filter.role || m.role === filter.role); });
      list.textContent = '';
      if (!items.length) { list.appendChild(el('li', { class: 'hint', text: 'Nessun file adatto nella libreria. Caricane uno nuovo.' })); return; }
      items.forEach(function (m) {
        list.appendChild(mediaCard(m, [el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Usa questo', onclick: function () { dlg.close(); onPick(m); } })]));
      });
    }).catch(function (e) { list.textContent = ''; list.appendChild(el('li', { class: 'form-error', text: e.message })); });
  }

  /** Image field: choose from the library or upload a new one; then the description for who can't see it. */
  function imageEditor(value, onChange, opts) {
    opts = opts || {};
    var role = opts.role || 'content';
    var lang = se.page ? se.page.lang : 'it';
    var box = el('div', { class: 'se-image' });
    function useItem(m) {
      var v = Object.assign({}, m.value);
      v.alt = (value && value.alt) || (lang === 'en' ? m.altEn : m.altIt) || '';
      v.decorative = value ? !!value.decorative : false;
      value = v; onChange(value); render();
    }
    function render() {
      box.textContent = '';
      var status = el('p', { class: 'status', role: 'status' });
      var file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'se-file', 'aria-label': 'Carica una nuova foto' });
      file.addEventListener('change', function () {
        if (!file.files[0]) return;
        status.className = 'status';
        uploadPhoto(file.files[0], role, function (t) { status.textContent = t; }).then(function (m) {
          status.textContent = 'Fatto: ' + m.variants.length + ' versioni, ' + kb(m.bytes) + ' in tutto.';
          useItem(m);
        }).catch(function (e) { status.className = 'status form-error'; status.textContent = e.message; });
      });
      var pick = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Scegli dalla libreria', onclick: function () { pickMedia({ kind: 'image', role: role }, useItem); } });
      var upload = el('label', { class: 'btn btn-ghost btn-small se-file-label' }, [value && value.id ? 'Carica un\'altra foto' : 'Carica nuova', file]);
      if (value && value.id) {
        box.appendChild(el('img', { class: 'se-thumb', src: thumbUrl(value), alt: '' }));
        if (!value.social) {
          box.appendChild(textInput('Descrizione per chi non vede l\'immagine (testo alternativo)', value.alt, 200, function (v) { value.alt = v; onChange(value); }, { required: !value.decorative, hint: 'Per esempio: «Elsa Salvati sorride, seduta alla scrivania».' }));
          box.appendChild(checkInput('Immagine decorativa (non serve descriverla)', value.decorative, function (on) { value.decorative = on; onChange(value); render(); }));
        }
        box.appendChild(el('div', { class: 'cta-row' }, [pick, upload,
          el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Togli', onclick: function () { if (window.confirm('Togliere l\'immagine da qui? Resta nella libreria.')) { value = null; onChange(null); render(); } } }),
        ]));
      } else {
        box.appendChild(el('div', { class: 'cta-row' }, [pick, upload]));
        box.appendChild(el('p', { class: 'hint', text: role === 'social'
          ? 'Viene tagliata al centro a 1200 × 630 pixel, la misura chiesta da Facebook, LinkedIn e WhatsApp.'
          : 'JPG, PNG o WebP. Il sito crea da solo le misure giuste per ogni schermo; l\'originale non viene caricato.' }));
      }
      box.appendChild(status);
    }
    render();
    return box;
  }

  // ---------- one field of a block, generated from the library ----------
  function fieldEditor(f, data, lang) {
    var set = function (v) { data[f.name] = v; changed(); };
    var v = data[f.name];
    switch (f.type) {
      case 'text': return textInput(f.label, v, f.max, set, { required: f.required });
      case 'note': return textInput(f.label, v, f.max || 1500, set, { area: true, hint: 'Visibile solo qui e nell\'anteprima, mai sul sito pubblicato.' });
      case 'anchor': return textInput(f.label, v, 40, function (x) { set(x.trim().replace(/^#/, '').toLowerCase()); }, { hint: 'Solo lettere minuscole, numeri e trattini.' });
      case 'select': return selectInput(f.label, f.options, v, set);
      case 'bool': return checkInput(f.label, v, set);
      case 'rich': return el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: f.label + (f.required ? ' *' : '') }), richEditor(v, { multiline: f.multiline !== false, max: f.max, label: f.label }, set)]);
      case 'image': return el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: f.label }), imageEditor(v, set, { role: f.role || 'content' })]);
      case 'link': return linkEditor(v, { optional: true, label: f.label }, set);
      case 'button': return linkEditor(v, { optional: true, label: f.label, styles: f.styles }, set);
      case 'links': case 'buttons': {
        if (!Array.isArray(v)) { v = []; data[f.name] = v; }
        var isBtn = f.type === 'buttons';
        return el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: f.label }), listEditor(v, {
          itemLabel: isBtn ? 'Pulsante' : 'Link', max: f.max || 3,
          make: function () { var x = { label: '', to: { kind: 'page', key: (se.linkTargets[0] || {}).key || '' } }; if (isBtn) x.style = (f.styles || ['primary'])[0]; return x; },
        }, function (item) { return linkEditor(item, { styles: isBtn ? f.styles : null }, function () { changed(); }); })]);
      }
      case 'textlist': {
        if (!Array.isArray(v)) { v = []; data[f.name] = v; }
        return el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: f.label }), listEditor(v, { itemLabel: 'Punto', max: f.max || 6, make: function () { return ''; } },
          function (item, i) { return textInput('Testo', item, f.itemMax || 200, function (x) { v[i] = x; changed(); }); })]);
      }
      case 'flow': {
        if (!Array.isArray(v)) { v = []; data[f.name] = v; }
        return el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: f.label }), flowEditor(v, f)]);
      }
      case 'list': {
        if (!Array.isArray(v)) { v = []; data[f.name] = v; }
        return el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: f.label }), listEditor(v, {
          itemLabel: f.itemLabel || 'Voce', max: f.max, min: f.min, make: function () { return emptyData(f.fields); },
        }, function (item) {
          var wrap = el('div', { class: 'se-fields' });
          f.fields.forEach(function (sub) { wrap.appendChild(fieldEditor(sub, item, lang)); });
          return wrap;
        })]);
      }
      default: return el('p', { class: 'hint', text: f.label });
    }
  }

  // Paragraphs, highlighted paragraphs, figures with a source and arrow links, in any order.
  function flowEditor(arr, f) {
    var kinds = f.kinds || ['p', 'lead', 'stat', 'arrow'];
    var box = el('div', { class: 'se-list' });
    function render() {
      box.textContent = '';
      arr.forEach(function (elx, i) {
        var card = el('div', { class: 'se-item' }, [el('div', { class: 'se-item-head' }, [el('strong', { text: KIND_NAMES[elx.kind] || elx.kind }), itemTools(arr, i, render, { label: 'elemento' })])]);
        if (elx.kind === 'arrow') {
          if (!elx.link) elx.link = { label: '', to: { kind: 'page', key: (se.linkTargets[0] || {}).key || '' } };
          card.appendChild(linkEditor(elx.link, {}, function () { changed(); }));
        } else {
          card.appendChild(richEditor(elx.text, { multiline: true, max: 1500, label: KIND_NAMES[elx.kind] }, function (m) { elx.text = m; changed(); }));
          if (elx.kind === 'stat') card.appendChild(textInput('Fonte (es. Censis-Eudaimon, 2026)', elx.source, 120, function (x) { elx.source = x; changed(); }));
        }
        box.appendChild(card);
      });
      if (arr.length < (f.max || 10)) {
        box.appendChild(el('div', { class: 'se-addrow' }, kinds.map(function (k) {
          return el('button', { type: 'button', class: 'btn btn-ghost btn-small se-add', text: '+ ' + KIND_NAMES[k], onclick: function () {
            arr.push(k === 'arrow' ? { kind: 'arrow', link: { label: '', to: { kind: 'page', key: (se.linkTargets[0] || {}).key || '' } } } : k === 'stat' ? { kind: 'stat', text: { p: [] }, source: '' } : { kind: k, text: { p: [] } });
            changed(); render();
          } });
        })));
      }
    }
    render();
    return box;
  }

  // ---------- page list ----------
  function siteGroups() {
    var groups = {};
    se.pages.forEach(function (p) { (groups[p.key] = groups[p.key] || {})[p.lang] = p; });
    return Object.keys(groups).sort(function (a, b) {
      var ia = PAGE_ORDER.indexOf(a); var ib = PAGE_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    }).map(function (k) { return { key: k, it: groups[k].it, en: groups[k].en }; });
  }

  function renderPageList() {
    var box = $('[data-se-pages]');
    box.textContent = '';
    // Parts shared by every page: header and footer (per language) and the studio's details.
    var gl = el('ul', { class: 'se-pagelist se-globallist', role: 'list' });
    var scopes = se.globals ? se.globals.scopes : null;
    function gBtn(scope, text, aria) {
      var current = se.mode === 'global' && se.gscope === scope;
      var changes = scopes && scopes[scope] && scopes[scope].hasChanges;
      return el('button', {
        type: 'button', class: 'se-lang' + (current ? ' current' : ''), 'aria-current': current ? 'page' : null, disabled: !scopes,
        'aria-label': aria + (changes ? ', modifiche non pubblicate' : ''), title: scopes ? '' : 'Non ancora disponibile',
        onclick: function () { openGlobal(scope); },
      }, [text, changes ? el('span', { class: 'se-dot', 'aria-hidden': 'true' }) : null]);
    }
    gl.appendChild(el('li', { class: 'se-pageitem' }, [el('span', { class: 'se-pagename', text: 'Intestazione e piè di pagina' }),
      el('span', { class: 'se-langs' }, [gBtn('it', 'IT', 'Intestazione e piè di pagina, italiano'), gBtn('en', 'EN', 'Intestazione e piè di pagina, inglese')])]));
    gl.appendChild(el('li', { class: 'se-pageitem' }, [el('span', { class: 'se-pagename', text: 'Dati dello studio' }),
      el('span', { class: 'se-langs' }, [gBtn('studio', 'Apri', 'Dati dello studio')])]));
    var mediaCurrent = se.mode === 'media';
    gl.appendChild(el('li', { class: 'se-pageitem' }, [el('span', { class: 'se-pagename', text: 'Immagini e PDF' }),
      el('span', { class: 'se-langs' }, [el('button', { type: 'button', class: 'se-lang' + (mediaCurrent ? ' current' : ''), 'aria-current': mediaCurrent ? 'page' : null, 'aria-label': 'Libreria di immagini e PDF', onclick: openMedia, text: 'Apri' })])]));
    box.appendChild(el('h2', { class: 'se-h', text: 'Tutto il sito' }));
    box.appendChild(gl);
    box.appendChild(el('h2', { class: 'se-h', text: 'Pagine' }));
    var ul = el('ul', { class: 'se-pagelist', role: 'list' });
    siteGroups().forEach(function (g) {
      var langs = el('span', { class: 'se-langs' });
      ['it', 'en'].forEach(function (l) {
        var p = g[l];
        if (!p) return;
        var current = se.mode === 'page' && se.page && se.page.id === p.id;
        langs.appendChild(el('button', {
          type: 'button', class: 'se-lang' + (current ? ' current' : ''), 'aria-current': current ? 'page' : null,
          'aria-label': pageName(g.key) + ', ' + LANG_NAME[l] + (p.hasChanges ? ', modifiche non pubblicate' : ''),
          title: p.hasChanges ? 'Modifiche non pubblicate' : 'Pubblicata',
          onclick: function () { openSitePage(p.id); },
        }, [l.toUpperCase(), p.hasChanges ? el('span', { class: 'se-dot', 'aria-hidden': 'true' }) : null]));
      });
      ul.appendChild(el('li', { class: 'se-pageitem' }, [el('span', { class: 'se-pagename', text: pageName(g.key) }), langs]));
    });
    box.appendChild(ul);
    box.appendChild(el('p', { class: 'hint se-legend' }, [el('span', { class: 'se-dot', 'aria-hidden': 'true' }), ' modifiche non ancora pubblicate']));
    // Phones: a simple select.
    var sel = $('[data-se-pagesel]');
    sel.textContent = '';
    sel.appendChild(el('option', { value: '', text: 'Scegli la pagina…' }));
    if (scopes) {
      sel.appendChild(el('option', { value: 'g:it', text: 'Intestazione e piè di pagina · IT' }));
      sel.appendChild(el('option', { value: 'g:en', text: 'Intestazione e piè di pagina · EN' }));
      sel.appendChild(el('option', { value: 'g:studio', text: 'Dati dello studio' }));
    }
    sel.appendChild(el('option', { value: 'media', text: 'Immagini e PDF' }));
    siteGroups().forEach(function (g) {
      ['it', 'en'].forEach(function (l) { if (g[l]) sel.appendChild(el('option', { value: g[l].id, text: pageName(g.key) + ' · ' + l.toUpperCase() + (g[l].hasChanges ? ' •' : '') })); });
    });
    sel.value = se.mode === 'media' ? 'media' : se.mode === 'global' ? 'g:' + se.gscope : (se.page ? se.page.id : '');
  }

  function loadGlobals() {
    return api('GET', '/site/globals').then(function (res) { se.globals = res; }).catch(function () { se.globals = null; });
  }

  function loadSitePages() {
    return Promise.all([api('GET', '/site/pages'), loadGlobals()]).then(function (all) {
      var res = all[0];
      se.pages = res.pages;
      se.loaded = true;
      renderPageList();
      if (!se.page) {
        var home = se.pages.find(function (p) { return p.key === 'index' && p.lang === 'it'; }) || se.pages[0];
        if (home) return openSitePage(home.id);
      }
    }).catch(function (e) { showBanner(e.message); });
  }

  function openSitePage(id) {
    return flushSave().then(function () {
      return api('GET', '/site/pages/' + id);
    }).then(function (res) {
      se.mode = 'page';
      se.page = res.page;
      se.draft = clone(res.page.draft);
      if (!se.draft.seo || typeof se.draft.seo !== 'object') se.draft.seo = { image: null, noindex: false };
      se.expected = res.page.draftUpdatedAt;
      se.linkTargets = res.linkTargets || [];
      se.pros = res.professionals || [];
      se.library = {};
      (res.library || []).forEach(function (b) { se.library[b.type] = b; });
      se.selected = -1;
      se.dirty = false;
      se.refPage = null;
      hideBanner();
      setStatus(res.page.draftUpdatedBy ? 'Ultima modifica: ' + res.page.draftUpdatedBy + ', ' + new Date(res.page.draftUpdatedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '');
      renderEditor();
      renderPageList();
      if (se.refOpen) loadReference();
      schedulePreview(0);
    }).catch(function (e) { showBanner(e.message); });
  }

  // ---------- editor ----------
  function setStatus(t, cls) {
    var s = $('[data-se-status]');
    s.textContent = t;
    s.className = 'se-status' + (cls ? ' ' + cls : '');
  }
  function showBanner(msg, action) {
    var b = $('[data-se-banner]');
    b.textContent = '';
    b.appendChild(el('span', { text: msg }));
    if (action) b.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: action.label, onclick: action.run }));
    b.hidden = false;
  }
  function hideBanner() { $('[data-se-banner]').hidden = true; }

  function updateBadge() {
    var badge = $('[data-se-badge]');
    if (se.mode === 'global') {
      var s = se.globals && se.globals.scopes[se.gscope];
      var ch = se.dirty || (s && s.hasChanges);
      badge.textContent = ch ? 'Modifiche non pubblicate' : 'Pubblicato';
      badge.className = 'se-badge' + (ch ? ' changes' : ' ok');
      return;
    }
    var p = se.page;
    var changes = p && (se.dirty || p.hasChanges);
    badge.textContent = changes ? 'Modifiche non pubblicate' : 'Pubblicata';
    badge.className = 'se-badge' + (changes ? ' changes' : ' ok');
  }

  function blockSummary(b) {
    var d = b.data || {};
    var t = d.title || d.eyebrow || d.descriptor || '';
    if (!t && d.items && d.items[0]) t = d.items[0].title || d.items[0].q || d.items[0].term || '';
    if (typeof t === 'object' && t && t.p) t = t.p.map(function (p) { return p.map(function (r) { return r.t; }).join(''); }).join(' ');
    return String(t || '');
  }

  function setTab(tab) {
    se.tab = tab;
    $$('[data-se-tab]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-se-tab') === tab)); });
    $('[data-se-tab-blocks]').hidden = tab !== 'blocks';
    $('[data-se-tab-seo]').hidden = tab !== 'seo';
    if (tab === 'seo') renderSeo();
  }

  function renderEditor() {
    var p = se.page;
    var global = se.mode === 'global';
    $('[data-se-media]').hidden = true;
    $('[data-se-empty]').hidden = !!(p || global);
    $('[data-se-editor]').hidden = !(p || global);
    $('[data-se-tabs]').hidden = global;
    $('[data-se-history]').hidden = global;
    $('[data-se-ref]').hidden = global;
    $('[data-se-tab-global]').hidden = !global;
    if (global) { $('[data-se-tab-blocks]').hidden = true; $('[data-se-tab-seo]').hidden = true; renderGlobalEditor(); return; }
    if (!p) return;
    setTab(se.tab);
    $('[data-se-title]').textContent = pageName(p.key);
    $('[data-se-path]').textContent = p.path;
    var other = se.pages.find(function (x) { return x.key === p.key && x.lang !== p.lang; });
    var sw = $('[data-se-langswitch]');
    sw.textContent = '';
    ['it', 'en'].forEach(function (l) {
      var target = l === p.lang ? p : (other && other.lang === l ? other : null);
      sw.appendChild(el('button', { type: 'button', 'aria-pressed': String(l === p.lang), disabled: !target, title: target ? '' : 'Questa pagina non esiste in ' + LANG_NAME[l].toLowerCase(),
        text: LANG_NAME[l], onclick: function () { if (target && target.id !== p.id) openSitePage(target.id); } }));
    });
    $('[data-se-ref]').disabled = !other;
    updateBadge();
    renderBlocks();
  }

  // ---------- SEO and sharing ----------
  function renderSeo() {
    var box = $('[data-se-tab-seo]');
    box.textContent = '';
    var seo = se.draft.seo;
    var domain = location.host;
    var gTitle = el('span', { class: 'se-g-title' });
    var gDesc = el('span', { class: 'se-g-desc' });
    var cTitle = el('strong');
    var cDesc = el('span', { class: 'hint' });
    var cImg = el('div', { class: 'se-card-img' });
    function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
    function refresh() {
      gTitle.textContent = cut(se.draft.title || pageName(se.page.key), 62);
      gDesc.textContent = cut(se.draft.description || 'Google sceglierà un pezzo di testo della pagina.', 158);
      cTitle.textContent = cut(se.draft.title, 80);
      cDesc.textContent = cut(se.draft.description, 120);
      cImg.textContent = '';
      if (seo.image && seo.image.id) cImg.appendChild(el('img', { src: thumbUrl(seo.image), alt: '' }));
      else cImg.appendChild(el('span', { class: 'hint', text: 'Nessuna immagine: i social useranno quella predefinita del sito.' }));
    }
    box.appendChild(el('p', { class: 'hint', text: 'Come la pagina compare su Google e quando qualcuno la condivide. L\'indirizzo ' + se.page.path + ' non si cambia da qui.' }));
    box.appendChild(textInput('Titolo per Google', se.draft.title, 120, function (v) { se.draft.title = v; refresh(); changed(); }, { recommended: 60, required: true, hint: 'Compare nella scheda del browser e nei risultati di Google. Meglio sotto i 60 caratteri.' }));
    box.appendChild(textInput('Descrizione', se.draft.description, 300, function (v) { se.draft.description = v; refresh(); changed(); }, { area: true, recommended: 155, hint: 'Una o due frasi su cosa trova chi apre la pagina.' }));
    box.appendChild(el('p', { class: 'se-sub', text: 'Anteprima su Google' }));
    box.appendChild(el('div', { class: 'se-google', 'aria-label': 'Anteprima del risultato su Google' }, [
      el('span', { class: 'se-g-url', text: domain + se.page.path }), gTitle, gDesc,
    ]));
    box.appendChild(el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: 'Immagine per la condivisione sui social' }),
      imageEditor(seo.image, function (v) { seo.image = v; refresh(); changed(); }, { role: 'social' })]));
    box.appendChild(el('p', { class: 'se-sub', text: 'Anteprima della condivisione' }));
    box.appendChild(el('div', { class: 'se-card' }, [cImg, el('div', { class: 'se-card-text' }, [el('span', { class: 'se-g-url', text: domain }), cTitle, cDesc])]));
    var warn = el('p', { class: 'status form-error', role: 'status' });
    function warnNoindex() { warn.textContent = seo.noindex ? 'Attenzione: con questa scelta la pagina sparisce da Google e dagli altri motori di ricerca.' : ''; }
    box.appendChild(checkInput('Non mostrare nei motori di ricerca', seo.noindex, function (on) { seo.noindex = on; warnNoindex(); changed(); }));
    box.appendChild(warn);
    warnNoindex();
    refresh();
  }

  // ---------- media library: every image and PDF, reusable on any page ----------
  function openMedia() {
    return flushSave().then(function () {
      se.mode = 'media';
      hideBanner();
      $('[data-se-empty]').hidden = true;
      $('[data-se-editor]').hidden = true;
      $('[data-se-media]').hidden = false;
      renderPageList();
      return renderMedia();
    });
  }

  function renderMedia() {
    var box = $('[data-se-media]');
    box.textContent = '';
    var status = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    var roleSel = el('select', { id: 'md-role' }, ['content', 'wide', 'social'].map(function (r) { return el('option', { value: r, text: ROLE_NAMES[r] }); }));
    var photo = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'se-file', 'aria-label': 'Carica un\'immagine' });
    var pdf = el('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'se-file', 'aria-label': 'Carica un PDF' });
    function done(m) { status.className = 'status form-ok'; status.textContent = 'Caricato: ' + m.name + (m.kind === 'image' ? ' (' + m.variants.length + ' versioni, ' + kb(m.bytes) + ')' : ''); load(); }
    function fail(e) { status.className = 'status form-error'; status.textContent = e.message; }
    photo.addEventListener('change', function () {
      if (!photo.files[0]) return;
      status.className = 'status';
      uploadPhoto(photo.files[0], roleSel.value, function (t) { status.textContent = t; }).then(done).catch(fail);
      photo.value = '';
    });
    pdf.addEventListener('change', function () {
      if (!pdf.files[0]) return;
      status.className = 'status';
      uploadPdf(pdf.files[0], function (t) { status.textContent = t; }).then(done).catch(fail);
      pdf.value = '';
    });
    box.appendChild(el('div', { class: 'se-bar' }, [el('div', { class: 'se-bar-title' }, [
      el('h2', { text: 'Immagini e PDF' }),
      el('p', { class: 'hint', text: 'Carichi un file una volta e lo usi in tutte le pagine che vuoi. Delle foto il sito tiene solo le misure che servono a ogni schermo.' }),
    ])]));
    box.appendChild(el('div', { class: 'md-upload' }, [
      el('div', { class: 'field' }, [el('label', { for: 'md-role', text: 'Dove userai la foto' }), roleSel]),
      el('label', { class: 'btn btn-primary btn-small se-file-label' }, ['Carica un\'immagine', photo]),
      el('label', { class: 'btn btn-ghost btn-small se-file-label' }, ['Carica un PDF (massimo 4 MB)', pdf]),
    ]));
    box.appendChild(status);
    var grid = el('ul', { class: 'md-grid', role: 'list' }, [el('li', { class: 'hint', text: 'Carico la libreria…' })]);
    box.appendChild(grid);
    function rename(m) {
      var name = window.prompt('Nome del file', m.name);
      if (name === null) return;
      api('PATCH', '/site/media/' + m.id, { name: name }).then(load).catch(fail);
    }
    function altDialog(m) {
      var dlg = el('dialog', { class: 'dlg' });
      var it = el('input', { id: 'md-alt-it', maxlength: 200 }); it.value = m.altIt || '';
      var en = el('input', { id: 'md-alt-en', maxlength: 200 }); en.value = m.altEn || '';
      var form = el('form', { class: 'dlg-inner', method: 'dialog' }, [
        el('div', { class: 'dlg-head' }, [el('h2', { text: 'Descrizione predefinita' })]),
        el('p', { class: 'hint', text: 'Proposta quando inserisci l\'immagine in una pagina; lì puoi sempre cambiarla.' }),
        el('div', { class: 'field' }, [el('label', { for: 'md-alt-it', text: 'In italiano' }), it]),
        el('div', { class: 'field' }, [el('label', { for: 'md-alt-en', text: 'In inglese' }), en]),
        el('div', { class: 'cta-row dlg-actions' }, [
          el('button', { type: 'submit', class: 'btn btn-primary btn-small', text: 'Salva' }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Annulla', onclick: function () { dlg.close(); } }),
        ]),
      ]);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        api('PATCH', '/site/media/' + m.id, { alt_it: it.value, alt_en: en.value }).then(function () { dlg.close(); load(); }).catch(fail);
      });
      dlg.appendChild(form);
      dlg.addEventListener('close', function () { dlg.remove(); });
      document.body.appendChild(dlg);
      dlg.showModal();
    }
    function remove(m) {
      if (m.usedIn && m.usedIn.length) { window.alert('Non si può cancellare: ' + usedText(m).replace('Usato in: ', 'è usato in ') + '. Toglilo prima da quelle pagine.'); return; }
      if (!window.confirm('Cancellare «' + m.name + '»? Non si può annullare.')) return;
      api('DELETE', '/site/media/' + m.id).then(function () { status.className = 'status form-ok'; status.textContent = 'Cancellato.'; load(); })
        .catch(fail);
    }
    function load() {
      return api('GET', '/site/media').then(function (res) {
        grid.textContent = '';
        if (!res.media.length) { grid.appendChild(el('li', { class: 'hint', text: 'La libreria è vuota.' })); return; }
        res.media.forEach(function (m) {
          var actions = [el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Rinomina', onclick: function () { rename(m); } })];
          if (m.kind === 'image' && m.role !== 'social') actions.push(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Descrizione', onclick: function () { altDialog(m); } }));
          if (m.kind === 'pdf') actions.push(el('a', { class: 'btn btn-ghost btn-small', href: m.url, target: '_blank', rel: 'noopener', text: 'Apri' }));
          actions.push(el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Cancella', onclick: function () { remove(m); } }));
          grid.appendChild(mediaCard(m, actions));
        });
      }).catch(function (e) { grid.textContent = ''; grid.appendChild(el('li', { class: 'form-error', text: e.message })); });
    }
    return load();
  }

  // ---------- header, footer and studio details ----------
  function openGlobal(scope) {
    return flushSave().then(function () { return loadGlobals(); }).then(function () {
      if (!se.globals || !se.globals.scopes[scope]) { showBanner('Questa parte non è ancora disponibile.'); return null; }
      var s = se.globals.scopes[scope];
      se.mode = 'global';
      se.gscope = scope;
      se.gdata = clone(s.draft || {});
      se.gexpected = s.draftUpdatedAt;
      se.linkTargets = se.globals.linkTargets || se.linkTargets;
      se.pros = se.globals.professionals || se.pros;
      se.dirty = false;
      hideBanner();
      setStatus('');
      // The preview shows a page of that language (the last one opened, else the home) with these header and footer.
      var lang = scope === 'en' ? 'en' : 'it';
      var target = se.page && se.page.lang === lang ? se.page : (se.pages.find(function (p) { return p.key === 'index' && p.lang === lang; }) || se.pages.find(function (p) { return p.lang === lang; }));
      renderEditor();
      renderPageList();
      if (!target) return null;
      return api('GET', '/site/pages/' + target.id).then(function (res) {
        se.gpreview = { id: res.page.id, draft: res.page.draft };
        schedulePreview(0);
      });
    }).catch(function (e) { showBanner(e.message); });
  }

  function renderGlobalEditor() {
    var scope = se.gscope;
    var studio = scope === 'studio';
    $('[data-se-title]').textContent = GLOBAL_NAMES[scope];
    $('[data-se-path]').textContent = studio ? 'Usati in tutte le pagine' : 'Tutte le pagine in ' + LANG_NAME[scope].toLowerCase();
    var sw = $('[data-se-langswitch]');
    sw.textContent = '';
    if (!studio) {
      ['it', 'en'].forEach(function (l) {
        sw.appendChild(el('button', { type: 'button', 'aria-pressed': String(l === scope), text: LANG_NAME[l], onclick: function () { if (l !== scope) openGlobal(l); } }));
      });
    }
    var s = se.globals.scopes[scope];
    var badge = $('[data-se-badge]');
    var changes = se.dirty || s.hasChanges;
    badge.textContent = changes ? 'Modifiche non pubblicate' : 'Pubblicato';
    badge.className = 'se-badge' + (changes ? ' changes' : ' ok');
    var box = $('[data-se-tab-global]');
    box.textContent = '';
    box.appendChild(el('p', { class: 'hint', text: studio
      ? 'Telefono, email e WhatsApp compaiono in automatico nelle pagine e nel piè di pagina: cambiandoli qui cambiano ovunque.'
      : 'Il menu in alto e il piè di pagina sono uguali in tutte le pagine di questa lingua. L\'ordine delle voci è l\'ordine del menu.' }));
    var schema = se.globals.schema || {};
    var sections = studio ? [['studio', 'Dati dello studio']] : [['header', 'Intestazione (menu in alto)'], ['footer', 'Piè di pagina']];
    sections.forEach(function (sec) {
      var data = studio ? se.gdata : (se.gdata[sec[0]] = se.gdata[sec[0]] || {});
      var fields = schema[sec[0]] || [];
      var part = el('details', { class: 'se-global-part', open: true }, [el('summary', { text: sec[1] })]);
      var wrap = el('div', { class: 'se-fields' });
      fields.forEach(function (f) {
        if (data[f.name] === undefined) data[f.name] = emptyValue(f);
        wrap.appendChild(fieldEditor(f, data, scope === 'en' ? 'en' : 'it'));
      });
      if (!fields.length) wrap.appendChild(el('p', { class: 'hint', text: 'Nessun campo.' }));
      part.appendChild(wrap);
      box.appendChild(part);
    });
  }

  function renderBlocks() {
    var box = $('[data-se-blocks]');
    box.textContent = '';
    var blocks = se.draft.blocks;
    blocks.forEach(function (b, i) {
      var def = se.library[b.type] || { label: b.type, fields: [], bg: ['light'] };
      var open = se.selected === i;
      var locked = def.fixed || def.special;
      var head = el('div', { class: 'se-block-head' }, [
        el('button', { type: 'button', class: 'se-block-pick', 'aria-expanded': String(open), onclick: function () { selectBlock(open ? -1 : i); } }, [
          el('span', { class: 'se-block-n', text: String(i + 1) }),
          el('span', { class: 'se-block-text' }, [el('strong', { text: def.label }), el('span', { class: 'hint', text: blockSummary(b) || (def.special ? 'Parte fissa del sito' : '') })]),
        ]),
        el('div', { class: 'se-tools' }, [
          el('button', { type: 'button', class: 'se-icon', title: 'Sposta su', 'aria-label': 'Sposta su il blocco ' + (i + 1), disabled: i === 0, onclick: function () { moveBlock(i, -1); }, text: '↑' }),
          el('button', { type: 'button', class: 'se-icon', title: 'Sposta giù', 'aria-label': 'Sposta giù il blocco ' + (i + 1), disabled: i === blocks.length - 1, onclick: function () { moveBlock(i, 1); }, text: '↓' }),
          locked || def.once ? null : el('button', { type: 'button', class: 'se-icon', title: 'Duplica', 'aria-label': 'Duplica il blocco ' + (i + 1), onclick: function () { duplicateBlock(i); }, text: '⧉' }),
          locked ? null : el('button', { type: 'button', class: 'se-icon se-danger', title: 'Elimina', 'aria-label': 'Elimina il blocco ' + (i + 1), onclick: function () { deleteBlock(i); }, text: '✕' }),
        ]),
      ]);
      var item = el('li', { class: 'se-block' + (open ? ' open' : '') + (b.__error ? ' error' : ''), 'data-se-block': String(i) }, [head]);
      if (open) item.appendChild(inspector(b, def));
      box.appendChild(item);
    });
    if (!blocks.length) box.appendChild(el('li', { class: 'empty', text: 'Nessun blocco. Aggiungine uno.' }));
  }

  function inspector(b, def) {
    var box = el('div', { class: 'se-inspector' });
    if (def.help) box.appendChild(el('p', { class: 'hint', text: def.help }));
    if (b.__error) box.appendChild(el('p', { class: 'status form-error', role: 'alert', text: b.__error }));
    var fields = el('div', { class: 'se-fields' });
    def.fields.forEach(function (f) {
      if (!b.data) b.data = {};
      if (b.data[f.name] === undefined) b.data[f.name] = emptyValue(f);
      fields.appendChild(fieldEditor(f, b.data, se.page.lang));
    });
    if (!def.fields.length) fields.appendChild(el('p', { class: 'hint', text: 'Questo blocco non ha testi da modificare qui: si può solo spostare.' }));
    box.appendChild(fields);
    var settings = el('details', { class: 'se-settings' }, [el('summary', { text: 'Impostazioni del blocco' })]);
    if (def.bg && def.bg.length > 1) settings.appendChild(selectInput('Sfondo', def.bg.map(function (x) { return [x, BG_LABEL[x] || x]; }), b.bg || def.bg[0], function (v) { b.bg = v; changed(); }));
    if (def.numbered) settings.appendChild(checkInput('Numero nell\'occhiello (01 · …)', b.numbered !== false, function (on) { if (on) delete b.numbered; else b.numbered = false; changed(); }));
    settings.appendChild(textInput('Ancora (per link come #come-funziona)', b.anchor || '', 40, function (v) { v = v.trim().replace(/^#/, '').toLowerCase(); if (v) b.anchor = v; else delete b.anchor; changed(); }, { hint: 'Facoltativa. Solo lettere minuscole, numeri e trattini.' }));
    settings.appendChild(textInput('Nota interna', b.note || '', 1500, function (v) { if (v.trim()) b.note = v; else delete b.note; changed(); }, { area: true, hint: 'Visibile solo qui e nell\'anteprima, mai sul sito pubblicato.' }));
    var otherLang = se.page.lang === 'it' ? 'en' : 'it';
    if (se.pages.some(function (x) { return x.key === se.page.key && x.lang === otherLang; }) && !def.once) {
      settings.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Copia questo blocco nella versione ' + (otherLang === 'en' ? 'inglese' : 'italiana'), onclick: function () { copyToOther(b); } }));
    }
    box.appendChild(settings);
    return box;
  }

  function selectBlock(i) {
    se.selected = i;
    renderBlocks();
    if (i >= 0) {
      var li = $('[data-se-block="' + i + '"]');
      if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
      scrollPreviewTo(i);
    }
  }
  function moveBlock(i, d) {
    if (!moveItem(se.draft.blocks, i, d)) return;
    if (se.selected === i) se.selected = i + d; else if (se.selected === i + d) se.selected = i;
    changed(); renderBlocks();
  }
  function duplicateBlock(i) {
    var c = clone(se.draft.blocks[i]);
    delete c.id; delete c.__error;
    se.draft.blocks.splice(i + 1, 0, c);
    se.selected = i + 1;
    changed(); renderBlocks();
  }
  function deleteBlock(i) {
    var def = se.library[se.draft.blocks[i].type] || {};
    if (!window.confirm('Eliminare il blocco «' + (def.label || '') + '»? Puoi recuperarlo dallo Storico finché non pubblichi.')) return;
    se.draft.blocks.splice(i, 1);
    se.selected = -1;
    changed(); renderBlocks();
  }

  function addBlockDialog() {
    var dlg = el('dialog', { class: 'dlg se-library' });
    var list = el('ul', { class: 'se-libgrid', role: 'list' });
    Object.keys(se.library).forEach(function (type) {
      var def = se.library[type];
      var present = se.draft.blocks.some(function (b) { return b.type === type; });
      var disabled = (def.once && present) || type === 'home-hero' && se.page.key !== 'index';
      list.appendChild(el('li', {}, [el('button', { type: 'button', class: 'se-libitem', disabled: disabled, onclick: function () {
        var b = { type: type, bg: def.bg[0], data: emptyData(def.fields) };
        var at = se.selected >= 0 ? se.selected + 1 : se.draft.blocks.length;
        se.draft.blocks.splice(at, 0, b);
        se.selected = at;
        dlg.close();
        changed(); renderBlocks(); scrollPreviewTo(at);
      } }, [el('strong', { text: def.label }), el('span', { class: 'hint', text: disabled && present ? 'Già presente in questa pagina' : def.help })])]));
    });
    dlg.appendChild(el('div', { class: 'dlg-inner' }, [
      el('div', { class: 'dlg-head' }, [el('h2', { text: 'Aggiungi un blocco' }), el('button', { type: 'button', class: 'round', 'aria-label': 'Chiudi', text: '×', onclick: function () { dlg.close(); } })]),
      el('p', { class: 'hint', text: se.selected >= 0 ? 'Il blocco verrà aggiunto dopo quello selezionato.' : 'Il blocco verrà aggiunto in fondo alla pagina.' }),
      list,
    ]));
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function copyToOther(b) {
    var other = se.pages.find(function (x) { return x.key === se.page.key && x.lang !== se.page.lang; });
    if (!other) return;
    var copy = clone(b);
    delete copy.id; delete copy.__error;
    api('GET', '/site/pages/' + other.id).then(function (res) {
      var d = res.page.draft;
      return api('PUT', '/site/pages/' + other.id, { title: d.title, description: d.description, blocks: d.blocks.concat([copy]), expected: res.page.draftUpdatedAt });
    }).then(function () {
      setStatus('Blocco copiato in fondo alla versione ' + (other.lang === 'en' ? 'inglese' : 'italiana') + ': va tradotto.', 'ok');
      other.hasChanges = true;
      renderPageList();
    }).catch(function (e) { showBanner('Copia non riuscita: ' + e.message); });
  }

  // ---------- reference: the other language, read only ----------
  function loadReference() {
    var box = $('[data-se-refbox]');
    var other = se.pages.find(function (x) { return x.key === se.page.key && x.lang !== se.page.lang; });
    box.textContent = '';
    if (!other) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(el('p', { class: 'se-sub', text: 'Riferimento: versione ' + (other.lang === 'en' ? 'inglese' : 'italiana') + ' (sola lettura)' }));
    api('GET', '/site/pages/' + other.id).then(function (res) {
      var ol = el('ol', { class: 'se-reflist' });
      res.page.draft.blocks.forEach(function (b) {
        var def = se.library[b.type] || { label: b.type };
        ol.appendChild(el('li', {}, [el('strong', { text: def.label }), el('span', { class: 'hint', text: blockSummary(b) })]));
      });
      box.appendChild(ol);
    }).catch(function (e) { box.appendChild(el('p', { class: 'form-error', text: e.message })); });
  }

  // ---------- saving ----------
  function changed() {
    se.dirty = true;
    setStatus('Modifiche da salvare…');
    updateBadge();
    clearTimeout(se.timer);
    se.timer = setTimeout(saveDraft, 1500);
    schedulePreview(900);
  }

  function payload() {
    return {
      title: se.draft.title, description: se.draft.description, seo: se.draft.seo,
      blocks: se.draft.blocks.map(function (b) { var c = Object.assign({}, b); delete c.__error; return c; }),
    };
  }

  function saveGlobal() {
    var scope = se.gscope;
    se.dirty = false;
    setStatus('Salvataggio…');
    se.saving = api('PUT', '/site/globals/' + scope, { data: se.gdata, expected: se.gexpected }).then(function (res) {
      if (se.mode !== 'global' || se.gscope !== scope) return;
      se.gexpected = res.draftUpdatedAt;
      var s = se.globals.scopes[scope];
      s.draftUpdatedAt = res.draftUpdatedAt;
      if (!s.hasChanges) { s.hasChanges = true; renderPageList(); }
      hideBanner();
      setStatus(se.dirty ? 'Modifiche da salvare…' : 'Bozza salvata alle ' + timeNow(), se.dirty ? '' : 'ok');
      updateBadge();
    }).catch(function (e) {
      se.dirty = true;
      if (e.data && e.data.error === 'conflict') {
        setStatus('Non salvato', 'error');
        showBanner(e.message, { label: 'Ricarica', run: function () { se.dirty = false; openGlobal(scope); } });
        return;
      }
      setStatus('Non salvato: ' + e.message, 'error');
      showBanner('La bozza non è stata salvata: ' + e.message);
    }).then(function () {
      se.saving = false;
      if (se.again) { se.again = false; if (se.dirty) return saveDraft(); }
    });
    return se.saving;
  }

  function saveDraft() {
    clearTimeout(se.timer);
    if (!se.dirty) return Promise.resolve();
    if (se.saving) { se.again = true; return se.saving; }
    if (se.mode === 'global') return saveGlobal();
    if (!se.page) return Promise.resolve();
    var pageId = se.page.id;
    var body = payload();
    body.expected = se.expected;
    se.dirty = false;
    setStatus('Salvataggio…');
    se.saving = api('PUT', '/site/pages/' + pageId, body).then(function (res) {
      if (!se.page || se.page.id !== pageId) return;
      se.expected = res.draftUpdatedAt;
      // Keep the ids the server gave to new blocks.
      (res.draft.blocks || []).forEach(function (sb, i) { if (se.draft.blocks[i]) se.draft.blocks[i].id = sb.id; });
      var hadError = se.draft.blocks.some(function (b) { return b.__error; });
      se.draft.blocks.forEach(function (b) { delete b.__error; });
      se.page.hasChanges = true;
      var listed = se.pages.find(function (p) { return p.id === pageId; });
      if (listed && !listed.hasChanges) { listed.hasChanges = true; renderPageList(); }
      hideBanner();
      if (hadError) renderBlocks();
      setStatus(se.dirty ? 'Modifiche da salvare…' : 'Bozza salvata alle ' + timeNow(), se.dirty ? '' : 'ok');
      updateBadge();
    }).catch(function (e) {
      se.dirty = true;
      if (e.data && e.data.error === 'conflict') {
        setStatus('Non salvato', 'error');
        showBanner(e.message, { label: 'Ricarica la pagina', run: function () { se.dirty = false; openSitePage(pageId); } });
        return;
      }
      var m = /^Blocco (\d+)/.exec(e.message || '');
      if (m && se.draft.blocks[Number(m[1]) - 1]) {
        var idx = Number(m[1]) - 1;
        se.draft.blocks[idx].__error = e.message.replace(/^Blocco \d+ \([^)]*\)\s*–?\s*/, '');
        if (se.selected !== idx) se.selected = idx;
        renderBlocks();
      }
      setStatus('Non salvato: ' + e.message, 'error');
      showBanner('La bozza non è stata salvata: ' + e.message);
    }).then(function () {
      se.saving = false;
      if (se.again) { se.again = false; if (se.dirty) return saveDraft(); }
    });
    return se.saving;
  }

  function flushSave() {
    clearTimeout(se.timer);
    if (se.saving) return se.saving.then(flushSave);
    if (se.dirty) return saveDraft();
    return Promise.resolve();
  }

  // ---------- preview: the server's HTML, without scripts, in a sandboxed frame ----------
  function schedulePreview(ms) {
    clearTimeout(se.previewTimer);
    se.previewTimer = setTimeout(renderPreview, ms === undefined ? 900 : ms);
  }

  function renderPreview() {
    var body;
    if (se.mode === 'media') return;
    if (se.mode === 'global') {
      if (!se.gpreview) return;
      var d = se.gpreview.draft;
      body = { pageId: se.gpreview.id, title: d.title, description: d.description, seo: d.seo, blocks: d.blocks };
      if (se.gscope === 'studio') body.studio = se.gdata;
      else body.globals = { header: se.gdata.header, footer: se.gdata.footer };
    } else {
      if (!se.page) return;
      body = payload();
      body.pageId = se.page.id;
    }
    var frames = $$('[data-se-frame]');
    api('POST', '/site/preview', body).then(function (res) {
      var html = String(res.html)
        .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
        .replace(/<html([^>]*)>/i, function (all, attrs) { return /class=/.test(attrs) ? all.replace(/class="/, 'class="is-staging is-preview ') : '<html' + attrs + ' class="is-staging is-preview">'; });
      frames.forEach(function (f) {
        var y = 0;
        try { y = f.contentWindow ? f.contentWindow.scrollY : 0; } catch (e) { y = 0; }
        f.onload = function () {
          try { f.contentWindow.scrollTo(0, y); } catch (e2) { /* ignore */ }
          // Clicking links inside the preview does nothing: it is only a picture of the page.
          try { f.contentDocument.addEventListener('click', function (ev) { if (ev.target.closest && ev.target.closest('a,button')) ev.preventDefault(); }, true); } catch (e3) { /* ignore */ }
          fitFrame();
        };
        f.srcdoc = html;
      });
      $('[data-se-preview-msg]').textContent = '';
    }).catch(function (e) { $('[data-se-preview-msg]').textContent = 'Anteprima non aggiornata: ' + e.message; });
  }

  function scrollPreviewTo(i) {
    $$('[data-se-frame]').forEach(function (f) {
      try {
        var main = f.contentDocument.querySelector('main') || f.contentDocument.body;
        var secs = Array.prototype.filter.call(main.children, function (n) { return n.nodeName === 'SECTION'; });
        if (secs[i]) secs[i].scrollIntoView({ block: 'start' });
      } catch (e) { /* not loaded yet */ }
    });
  }

  function fitFrame() {
    var wrap = $('[data-se-framewrap]');
    var f = $('[data-se-frame]', wrap);
    if (!wrap || !f) return;
    if (se.device === 'phone') {
      f.style.width = '390px'; f.style.transform = 'none'; f.style.height = '100%';
      wrap.classList.add('phone');
    } else {
      wrap.classList.remove('phone');
      var scale = Math.min(1, wrap.clientWidth / 1280);
      f.style.width = '1280px';
      f.style.transform = 'scale(' + scale + ')';
      f.style.height = (wrap.clientHeight / scale) + 'px';
    }
  }

  // ---------- publish and history ----------
  function publishGlobalDialog() {
    flushSave().then(function () {
      if (se.dirty) return;
      var scope = se.gscope;
      var dlg = el('dialog', { class: 'dlg' });
      var err = el('p', { class: 'status form-error', role: 'alert' });
      dlg.appendChild(el('div', { class: 'dlg-inner' }, [
        el('div', { class: 'dlg-head' }, [el('h2', { text: 'Pubblica: ' + GLOBAL_NAMES[scope] })]),
        el('p', { class: 'se-warn', text: 'Cambia tutte le pagine del sito' + (scope === 'studio' ? '.' : ' in ' + LANG_NAME[scope].toLowerCase() + '.') }),
        el('p', { class: 'hint', text: 'Controlla l\'anteprima prima di confermare.' }),
        err,
        el('div', { class: 'cta-row dlg-actions' }, [
          el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Pubblica su tutto il sito', onclick: function (e) {
            e.target.disabled = true;
            api('POST', '/site/globals/' + scope + '/publish', {}).then(function () {
              dlg.close();
              if (se.globals.scopes[scope]) se.globals.scopes[scope].hasChanges = false;
              renderPageList(); updateBadge();
              setStatus('Pubblicato alle ' + timeNow() + '.', 'ok');
            }).catch(function (e2) { e.target.disabled = false; err.textContent = e2.message; });
          } }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Annulla', onclick: function () { dlg.close(); } }),
        ]),
      ]));
      dlg.addEventListener('close', function () { dlg.remove(); });
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  function publishDialog() {
    if (se.mode === 'global') { publishGlobalDialog(); return; }
    flushSave().then(function () {
      if (se.dirty) return;
      var dlg = el('dialog', { class: 'dlg' });
      var err = el('p', { class: 'status form-error', role: 'alert' });
      dlg.appendChild(el('div', { class: 'dlg-inner' }, [
        el('div', { class: 'dlg-head' }, [el('h2', { text: 'Pubblica la pagina' })]),
        el('p', { text: '«' + pageName(se.page.key) + '» in ' + LANG_NAME[se.page.lang].toLowerCase() + ' andrà online così come la vedi nell\'anteprima.' }),
        el('p', { class: 'hint', text: 'Le note interne non vengono pubblicate. Potrai tornare a una versione precedente dallo Storico.' }),
        err,
        el('div', { class: 'cta-row dlg-actions' }, [
          el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Pubblica adesso', onclick: function (e) {
            e.target.disabled = true;
            api('POST', '/site/pages/' + se.page.id + '/publish', {}).then(function (r) {
              dlg.close();
              se.page.hasChanges = false;
              var listed = se.pages.find(function (p) { return p.id === se.page.id; });
              if (listed) listed.hasChanges = false;
              renderPageList(); updateBadge();
              setStatus(r.purged === false ? 'Pubblicata. Potrebbe servire qualche minuto prima di vederla online.' : 'Pubblicata alle ' + timeNow() + '.', 'ok');
            }).catch(function (e2) { e.target.disabled = false; err.textContent = e2.message; });
          } }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Annulla', onclick: function () { dlg.close(); } }),
        ]),
      ]));
      dlg.addEventListener('close', function () { dlg.remove(); });
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  function historyDialog() {
    var dlg = el('dialog', { class: 'dlg' });
    var list = el('ul', { class: 'se-history', role: 'list' }, [el('li', { class: 'hint', text: 'Caricamento…' })]);
    dlg.appendChild(el('div', { class: 'dlg-inner' }, [
      el('div', { class: 'dlg-head' }, [el('h2', { text: 'Storico della pagina' }), el('button', { type: 'button', class: 'round', 'aria-label': 'Chiudi', text: '×', onclick: function () { dlg.close(); } })]),
      el('p', { class: 'hint', text: 'Ogni pubblicazione resta qui. «Ripristina come bozza» rimette quella versione nell\'editor: va poi pubblicata.' }),
      list,
    ]));
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    flushSave().then(function () { return api('GET', '/site/pages/' + se.page.id + '/versions'); }).then(function (res) {
      list.textContent = '';
      if (!res.versions.length) list.appendChild(el('li', { class: 'hint', text: 'Nessuna versione.' }));
      res.versions.forEach(function (v) {
        list.appendChild(el('li', { class: 'row-card' }, [
          el('div', {}, [
            el('strong', { text: VERSION_KIND[v.kind] || v.kind }),
            el('p', { class: 'hint', text: new Date(v.createdAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) + (v.by ? ' · ' + v.by : '') }),
          ]),
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Ripristina come bozza', onclick: function () {
            if (!window.confirm('Sostituire la bozza attuale con questa versione? Le modifiche non pubblicate andranno perse.')) return;
            api('POST', '/site/pages/' + se.page.id + '/versions/' + v.id + '/restore', {}).then(function () {
              dlg.close();
              openSitePage(se.page.id).then(function () { setStatus('Versione ripristinata come bozza. Controlla l\'anteprima e pubblica.', 'ok'); });
            }).catch(function (e) { window.alert(e.message); });
          } }),
        ]));
      });
    }).catch(function (e) { list.textContent = ''; list.appendChild(el('li', { class: 'form-error', text: e.message })); });
  }

  // ---------- wiring ----------
  (function wireSiteEditor() {
    var root = $('[data-panel="sito"]');
    if (!root) return;
    $('[data-se-pagesel]').addEventListener('change', function (e) {
      var v = e.target.value;
      if (!v) return;
      if (v === 'media') openMedia(); else if (v.indexOf('g:') === 0) openGlobal(v.slice(2)); else openSitePage(v);
    });
    $$('[data-se-tab]').forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-se-tab')); }); });
    $('[data-se-add]').addEventListener('click', addBlockDialog);
    $('[data-se-publish]').addEventListener('click', publishDialog);
    $('[data-se-history]').addEventListener('click', historyDialog);
    $('[data-se-ref]').addEventListener('click', function (e) {
      se.refOpen = !se.refOpen;
      e.currentTarget.setAttribute('aria-pressed', String(se.refOpen));
      if (se.refOpen) loadReference(); else $('[data-se-refbox]').hidden = true;
    });
    $$('[data-se-device]').forEach(function (b) {
      b.addEventListener('click', function () {
        se.device = b.getAttribute('data-se-device');
        $$('[data-se-device]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        fitFrame();
      });
    });
    $('[data-se-openpreview]').addEventListener('click', function () {
      var dlg = $('[data-se-fullpreview]');
      dlg.showModal();
      schedulePreview(0);
    });
    $('[data-se-closepreview]').addEventListener('click', function () { $('[data-se-fullpreview]').close(); });
    window.addEventListener('resize', fitFrame);
    window.addEventListener('beforeunload', function (e) {
      if (se.dirty || se.saving) { e.preventDefault(); e.returnValue = ''; }
    });
  })();

  // ---------- boot ----------
  var invite = (location.hash.match(/invito=([\w-]+)/) || [])[1];
  if (invite) startInvite(invite); else start();
})();
