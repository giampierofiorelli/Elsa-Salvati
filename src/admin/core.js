// Area riservata, parte comune: utilità, chiamate al server, menu e percorsi, accesso e attivazione.
// Tutti i file dell'area condividono un solo oggetto: window.BloomingAdmin (A).
(function (A) {
  'use strict';
  // usati da altri file
  A.$ = $;
  A.$$ = $$;
  A.addDays = addDays;
  A.api = api;
  A.buildProSwitch = buildProSwitch;
  A.capital = capital;
  A.el = el;
  A.field = field;
  A.formDialog = formDialog;
  A.hhmm = hhmm;
  A.icon = icon;
  A.isAdmin = isAdmin;
  A.iso = iso;
  A.loadCatalog = loadCatalog;
  A.minutes = minutes;
  A.monday = monday;
  A.myPro = myPro;
  A.parse = parse;
  A.proName = proName;
  A.routeKey = routeKey;
  A.servicesOf = servicesOf;
  A.showPanel = showPanel;
  A.singlePro = singlePro;
  A.toast = toast;
  A.weekday = weekday;

  var DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']; A.DAY_NAMES = DAY_NAMES;
  var DAY_LONG = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']; A.DAY_LONG = DAY_LONG;
  var KIND_LABEL = { primo_colloquio: 'Primo colloquio', seduta: 'Seduta', blocco: 'Non disponibile' }; A.KIND_LABEL = KIND_LABEL;
  var MODE_LABEL = { studio: 'studio', online: 'online' }; A.MODE_LABEL = MODE_LABEL;
  var CATEGORY_LABEL = { carriera: 'Orientamento e carriera', coaching: 'Coaching', psicologia: 'Psicologia', psicoterapia: 'Psicoterapia', aziende: 'Azienda', da_definire: 'Da definire' }; A.CATEGORY_LABEL = CATEGORY_LABEL;
  var fmtDayMonth = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' }); A.fmtDayMonth = fmtDayMonth;
  var fmtLongDay = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); A.fmtLongDay = fmtLongDay;

  var state = {
    me: null, today: null, weekStart: null, view: 'week', events: [], rules: [], settings: null,
    catalog: null, scope: null, editing: null, kind: 'seduta',
    month: null, route: null, lastShellRoute: null, pending: [], reqShow: 'open',
  }; A.state = state;

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
      if (!state.month) state.month = me.today.slice(0, 8) + '01';
      if (!state.scope) state.scope = myPro() || (isAdmin() ? 'all' : null);
      fillUser();
      showOnly('app');
      buildNav();
      buildProSwitch();
      return Promise.all([loadCatalog(), A.loadSettings(), A.loadRequests()]);
    }).then(function () {
      if (!/^#\//.test(location.hash)) history.replaceState(null, '', location.pathname + '#/agenda/calendario');
      onRoute();
      A.loadPendingCount();
    }).catch(function () { showLogin(); });
  }

  // ---------- icons (inline SVG, no external files) ----------
  var ICONS = {
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    block: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
    mail: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m21.5 7.5-9.5 6-9.5-6"/>',
    pages: '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h4.5"/>',
    layout: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 8.5h18M3 15.5h18"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    building: '<path d="M3 21h18M5 21V8l7-4.5L19 8v13M9.5 21v-5.5h5V21"/>',
    bell: '<path d="M6 8.5a6 6 0 0 1 12 0c0 6.5 3 8.5 3 8.5H3s3-2 3-8.5"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14.5 8.5l2 2"/>',
    shield: '<path d="M12 21.5s8-3.8 8-10V5l-8-3-8 3v6.5c0 6.2 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18h2"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7.5 16v-4M12 16V8M16.5 16v-6"/>',
    back: '<path d="M19 12H5M11.5 18.5 5 12l6.5-6.5"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
    collapse: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M9 3v18"/><path class="ic-chev" d="M16 9.5 13.5 12l2.5 2.5"/>',
    desktop: '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8 20.5h8M12 16.5v4"/>',
    mobile: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18h2"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    cursor: '<path d="m4 4 7 16 2.5-6.5L20 11z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  };
  function svg(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
  }
  function icon(name, size) {
    var s = el('span', { class: 'ic' });
    s.innerHTML = svg(name, size);
    return s;
  }
  function paintIcons(root) {
    $$('[data-icon]', root).forEach(function (n) { if (!n.firstChild) n.innerHTML = svg(n.getAttribute('data-icon')); });
  }

  // ---------- toasts ----------
  var toastBox = null;
  function toast(msg, kind) {
    if (!toastBox) { toastBox = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastBox); }
    var t = el('div', { class: 'toast' + (kind ? ' toast-' + kind : '') }, [icon(kind === 'error' ? 'block' : 'check', 18), el('span', { text: msg })]);
    toastBox.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 3600);
    setTimeout(function () { t.remove(); }, 4100);
  }

  // ---------- navigation: sidebar, top bar, routes in the address (#/agenda/calendario) ----------
  var ROUTES = {
    'agenda/calendario': { title: 'Calendario', crumb: 'Agenda', panel: 'agenda', nav: 'Calendario', icon: 'calendar', proSwitch: true, wide: true },
    'agenda/da-accettare': { title: 'Da accettare', crumb: 'Agenda', panel: 'pending', nav: 'Da accettare', icon: 'inbox', badge: 'pending' },
    'agenda/orari': { title: 'Orari settimanali', crumb: 'Agenda', panel: 'orari', nav: 'Orari settimanali', icon: 'clock', proSwitch: true },
    'agenda/blocchi': { title: 'Giorni e ore bloccati', crumb: 'Agenda', panel: 'blocchi', nav: 'Giorni e ore bloccati', icon: 'block', proSwitch: true },
    richieste: { title: 'Richieste di contatto', crumb: 'Richieste', panel: 'richieste', nav: 'Contatti e organizzazioni', icon: 'mail', badge: 'req' },
    'sito/pagine': { title: 'Pagine', crumb: 'Sito', editor: 'page', nav: 'Pagine', icon: 'pages', perm: 'site' },
    'sito/intestazione': { title: 'Intestazione e piè di pagina', crumb: 'Sito', editor: 'global', nav: 'Intestazione e piè di pagina', icon: 'layout', perm: 'site' },
    'sito/media': { title: 'Immagini e PDF', crumb: 'Sito', editor: 'media', nav: 'Immagini e PDF', icon: 'image', perm: 'site' },
    'studio/professioniste': { title: 'Professioniste', crumb: 'Studio', panel: 'professionisti', nav: 'Professioniste', icon: 'users', perm: 'admin' },
    'studio/servizi': { title: 'Servizi', crumb: 'Studio', panel: 'servizi', nav: 'Servizi', icon: 'grid', perm: 'admin' },
    'studio/dati': { title: 'Dati dello studio', crumb: 'Studio', editor: 'studio', nav: 'Dati dello studio', icon: 'building', perm: 'site' },
    'impostazioni/prenotazione': { title: 'Prenotazione e promemoria', crumb: 'Impostazioni', panel: 'imp-prenotazione', nav: 'Prenotazione e promemoria', icon: 'bell', perm: 'admin' },
    'impostazioni/account': { title: 'Account e permessi', crumb: 'Impostazioni', panel: 'account', nav: 'Account e permessi', icon: 'key', perm: 'admin' },
    'impostazioni/sicurezza': { title: 'Sicurezza e registro accessi', crumb: 'Impostazioni', panel: 'imp-sicurezza', nav: 'Sicurezza e registro accessi', icon: 'shield', perm: 'admin' },
    'impostazioni/privacy': { title: 'Dati delle persone', crumb: 'Impostazioni', panel: 'imp-privacy', nav: 'Dati delle persone', icon: 'person', perm: 'admin' },
    'impostazioni/calendario': { title: 'Calendario sul telefono', crumb: 'Impostazioni', panel: 'imp-calendario', nav: 'Calendario sul telefono', icon: 'phone' },
    profilo: { title: 'Il mio profilo', crumb: 'Il mio account', panel: 'profilo', nav: 'Il mio profilo', icon: 'person', perm: 'pro' },
    statistiche: { title: 'Statistiche', crumb: '', panel: 'statistiche', nav: 'Statistiche', icon: 'chart', proSwitch: true },
  };
  var NAV = [
    { label: 'Agenda', items: ['agenda/calendario', 'agenda/da-accettare', 'agenda/orari', 'agenda/blocchi'] },
    { label: 'Richieste', items: ['richieste'] },
    { label: 'Sito', perm: 'site', items: ['sito/pagine', 'sito/intestazione', 'sito/media'] },
    { label: 'Studio', perm: 'admin', items: ['studio/professioniste', 'studio/servizi', 'studio/dati'] },
    { label: 'Impostazioni', perm: 'admin', items: ['impostazioni/prenotazione', 'impostazioni/account', 'impostazioni/sicurezza', 'impostazioni/privacy', 'impostazioni/calendario'] },
    { label: 'Il mio account', perm: 'staff', items: ['profilo', 'impostazioni/calendario'] },
    { label: '', items: ['statistiche'] },
  ];
  function allowed(perm) {
    if (!perm) return true;
    if (perm === 'admin') return isAdmin();
    if (perm === 'site') return !!state.me.user.canEditSite;
    if (perm === 'pro') return !!myPro();
    if (perm === 'staff') return !isAdmin();
    return false;
  }

  function fillUser() {
    var u = state.me.user;
    var initials = u.name.replace(/^(Dott\.ssa|Dott\.|Dr\.ssa|Dr\.)\s+/i, '').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
    $('[data-user-initials]').textContent = initials;
    $('[data-user-name]').textContent = u.name;
    $('[data-user-name2]').textContent = u.name;
    $('[data-user-role]').textContent = isAdmin() ? 'Amministratore' : (u.canEditSite ? 'Professionista · sito' : 'Professionista');
    $('[data-session-info]').textContent = (isAdmin() ? 'Amministratore' : 'Professionista') + ' · accesso valido fino alle '
      + new Date(state.me.expiresAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    $('[data-user-profile]').hidden = !myPro();
  }

  function buildNav() {
    var nav = $('[data-nav]');
    nav.textContent = '';
    NAV.forEach(function (g) {
      if (!allowed(g.perm)) return;
      var items = g.items.filter(function (r) { return allowed(ROUTES[r].perm); });
      if (!items.length) return;
      var ul = el('ul', { class: 'sb-list', role: 'list' });
      items.forEach(function (r) {
        var meta = ROUTES[r];
        var a = el('a', { href: '#/' + r, class: 'sb-item', 'data-route': r, title: meta.nav, 'aria-label': meta.nav + (meta.crumb && meta.crumb !== meta.nav ? ' (' + meta.crumb + ')' : '') }, [icon(meta.icon), el('span', { class: 'sb-label', text: meta.nav })]);
        if (meta.badge === 'req') a.appendChild(el('span', { class: 'badge', 'data-req-count': true, hidden: true, title: 'Richieste da gestire' }));
        if (meta.badge === 'pending') a.appendChild(el('span', { class: 'badge', 'data-pending-count': true, hidden: true, title: 'Richieste da accettare' }));
        if (meta.soon) a.appendChild(el('span', { class: 'sb-soon', text: 'presto' }));
        ul.appendChild(el('li', {}, [a]));
      });
      nav.appendChild(el('div', { class: 'sb-group' }, [g.label ? el('p', { class: 'sb-h', text: g.label }) : null, ul]));
    });
    paintIcons(document);
  }

  function showPanel(name) {
    $$('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
  }

  function routeKey() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/');
    var two = parts.slice(0, 2).join('/');
    if (ROUTES[two]) return { key: two, arg: parts.slice(2).join('/') };
    if (ROUTES[parts[0]]) return { key: parts[0], arg: parts.slice(1).join('/') };
    return { key: null, arg: '' };
  }

  function onRoute() {
    if (!state.me || document.getElementById('app').hidden) return;
    var r = routeKey();
    if (!r.key || !allowed(ROUTES[r.key].perm)) { location.replace('#/agenda/calendario'); return; }
    var meta = ROUTES[r.key];
    var wasRoute = state.route;
    state.route = r.key;
    closeNav();
    closeUserMenu();
    $$('[data-route]').forEach(function (a) {
      var on = a.getAttribute('data-route') === r.key;
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (meta.editor) { A.enterEditor(meta.editor, r.arg); return; }
    if (document.body.classList.contains('is-editor')) { document.body.classList.remove('is-editor'); A.flushSave(); }
    state.lastShellRoute = r.key;
    showPanel(meta.panel);
    document.body.classList.toggle('route-wide', !!meta.wide);
    $('[data-page-title]').textContent = meta.title;
    var crumbs = $('[data-crumbs]');
    crumbs.textContent = '';
    var crumb = r.key === 'impostazioni/calendario' && !isAdmin() ? 'Il mio account' : meta.crumb;
    if (crumb) { crumbs.appendChild(el('li', { text: crumb })); crumbs.appendChild(el('li', { 'aria-current': 'page', text: meta.title })); }
    document.title = meta.title + ' – Area riservata Blooming';
    $('[data-pro-switch]').hidden = !(isAdmin() && meta.proSwitch);
    if (wasRoute && wasRoute !== r.key) { var c = $('#content'); c.scrollTop = 0; window.scrollTo(0, 0); }
    var job = null;
    var p = meta.panel;
    if (p === 'agenda') job = A.refresh();
    if (p === 'pending') job = A.loadPendingCount();
    if (p === 'orari') job = A.loadRules();
    if (p === 'blocchi') job = A.loadBlocks();
    if (p === 'richieste') job = A.loadRequests();
    if (p === 'profilo') job = A.renderProfile();
    if (p === 'servizi') job = A.renderServices();
    if (p === 'professionisti') job = A.renderPros();
    if (p === 'account') job = A.loadUsers();
    if (p === 'imp-prenotazione') job = A.loadSettings();
    if (p === 'statistiche') job = A.renderStats();
    if (job && job.catch) job.catch(function () { /* the api() helper already shows the login when the session is over */ });
  }
  window.addEventListener('hashchange', onRoute);

  // Sidebar: off-canvas on phones, icon rail on tablets (expandable), collapsible on computers.
  var mqTablet = window.matchMedia('(max-width: 1200px)');
  function closeNav() {
    document.body.classList.remove('nav-open', 'sb-wide');
    $('[data-menu-toggle]').setAttribute('aria-expanded', 'false');
    $('[data-ed-menu]').setAttribute('aria-expanded', 'false');
    $('[data-scrim]').hidden = true;
  }
  // The same drawer opens from the top bar and, inside the site editor, from the editor's bar.
  function toggleDrawer() {
    var open = !document.body.classList.contains('nav-open');
    document.body.classList.toggle('nav-open', open);
    $('[data-menu-toggle]').setAttribute('aria-expanded', String(open));
    $('[data-ed-menu]').setAttribute('aria-expanded', String(open));
    $('[data-scrim]').hidden = !open;
    if (open) { var first = $('.sb-item'); if (first) first.focus(); }
  }
  $('[data-menu-toggle]').addEventListener('click', toggleDrawer);
  $('[data-ed-menu]').addEventListener('click', toggleDrawer);
  $('[data-scrim]').addEventListener('click', closeNav);
  $('[data-sb-collapse]').addEventListener('click', function () {
    // In the site editor the menu is an icon rail: the button opens it over the editor.
    if (mqTablet.matches || document.body.classList.contains('is-editor')) {
      var wide = !document.body.classList.contains('sb-wide');
      document.body.classList.toggle('sb-wide', wide);
      $('[data-scrim]').hidden = !wide;
      return;
    }
    var mini = !document.body.classList.contains('sb-mini');
    document.body.classList.toggle('sb-mini', mini);
    try { localStorage.setItem('blooming-admin-mini', mini ? '1' : ''); } catch (e) { /* not available */ }
  });
  try { if (localStorage.getItem('blooming-admin-mini')) document.body.classList.add('sb-mini'); } catch (e) { /* not available */ }
  // The arrow points the way the menu will move: right to open it, left to close it.
  function syncCollapse() {
    var b = document.body.classList;
    var closed = (mqTablet.matches || b.contains('is-editor')) ? !b.contains('sb-wide') : b.contains('sb-mini');
    var btn = $('[data-sb-collapse]');
    btn.classList.toggle('is-closed', closed);
    var t = closed ? 'Espandi il menu' : 'Riduci il menu';
    btn.setAttribute('aria-label', t); btn.title = t;
    btn.setAttribute('aria-expanded', String(!closed));
    // Collapsed rail (not the phone drawer): the logo box is exactly as tall as the bar next to it, so the lines meet.
    var drawer = mqPhoneNav.matches || (b.contains('is-editor') && mqEditorDrawer.matches);
    var rail = closed && !drawer;
    if (b.contains('sb-rail') !== rail) b.toggle('sb-rail', rail);
    var brand = $('.sb-brand');
    var bar = b.contains('is-editor') ? $('.ed-top') : $('.topbar');
    brand.style.height = rail && bar && bar.offsetHeight ? bar.offsetHeight + 'px' : '';
  }
  var mqPhoneNav = window.matchMedia('(max-width: 900px)');
  var mqEditorDrawer = window.matchMedia('(max-width: 1180px)');
  window.addEventListener('resize', function () { clearTimeout(syncCollapse.t); syncCollapse.t = setTimeout(syncCollapse, 100); });
  new MutationObserver(syncCollapse).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (mqTablet.addEventListener) mqTablet.addEventListener('change', syncCollapse);
  syncCollapse();

  // User menu
  function closeUserMenu() {
    $('[data-user-pop]').hidden = true;
    $('[data-user-btn]').setAttribute('aria-expanded', 'false');
  }
  $('[data-user-btn]').addEventListener('click', function (e) {
    e.stopPropagation();
    var pop = $('[data-user-pop]');
    pop.hidden = !pop.hidden;
    this.setAttribute('aria-expanded', String(!pop.hidden));
    if (!pop.hidden) { var f = $('a:not([hidden]), button', pop); if (f) f.focus(); }
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.usermenu')) closeUserMenu();
    if (!e.target.closest('.ed-picker')) A.closePicker();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('[data-user-pop]').hidden) { closeUserMenu(); $('[data-user-btn]').focus(); }
    if (document.body.classList.contains('nav-open') || document.body.classList.contains('sb-wide')) closeNav();
    if (!$('[data-ed-pop]').hidden) { A.closePicker(); $('[data-ed-pick]').focus(); }
  });
  $('[data-logout]').addEventListener('click', function () {
    A.flushSave().then(function () { return api('POST', '/logout', {}); }).then(showLogin, showLogin);
  });

  function buildProSwitch() {
    var box = $('[data-pro-switch]');
    var sel = $('[data-pro-select]');
    box.hidden = true;
    if (!isAdmin()) return;
    sel.textContent = '';
    sel.appendChild(el('option', { value: 'all', text: 'Tutte le professioniste' }));
    state.me.professionals.forEach(function (p) {
      sel.appendChild(el('option', { value: p.id, text: p.name + (p.active ? '' : ' (non attiva)') }));
    });
    sel.value = state.scope;
    sel.onchange = function () {
      state.scope = sel.value;
      A.loadRules().then(function () {
        if (state.route === 'agenda/blocchi') return A.loadBlocks();
        if (state.route === 'statistiche') return A.renderStats();
        return A.refresh();
      });
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


  // ---------- boot (after every admin file has loaded) ----------
  document.addEventListener('DOMContentLoaded', function () {
    paintIcons(document);
    var invite = (location.hash.match(/invito=([\w-]+)/) || [])[1];
    if (invite) startInvite(invite); else start();
  });
})(window.BloomingAdmin = window.BloomingAdmin || {});
