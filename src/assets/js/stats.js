// Site statistics without cookies or identifiers (research 23, §6–§12).
// One message per page view, sent when the page is hidden or left: the page, where the visit came from
// (a fixed list of sources), the previous page of this site, button clicks, form steps, the device size.
// Nothing is written on the device, no IP or identifier is kept, and nothing is sent when the browser asks
// not to be tracked (Global Privacy Control, Do Not Track). The server only adds +1 to daily counters.
(function () {
  'use strict';
  try {
    var nav = navigator;
    if (nav.globalPrivacyControl === true || nav.doNotTrack === '1' || window.doNotTrack === '1') return;
    if (/bot|crawl|spider|slurp|headlesschrome|lighthouse/i.test(nav.userAgent || '')) return;
    // "Non contare questo dispositivo" (set from the admin): read here, never sent.
    try { if (window.localStorage && localStorage.getItem('blooming-no-stats') === '1') return; } catch (e) { /* storage blocked */ }
    if (/^\/admin\//.test(location.pathname)) return;

    var MANAGE = /^\/(prenota\/gestisci|en\/book\/manage)\//;
    var BOOK = /^\/(prenota|en\/book)\/$/;
    function pageOf(path) { return MANAGE.test(path) ? 'gestione' : path; }
    var page = pageOf(location.pathname);
    var src = 'diretto';
    var prev = '';
    if (document.referrer) {
      try {
        var r = new URL(document.referrer);
        if (r.host === location.host) { src = 'interno'; prev = pageOf(r.pathname); }
        else {
          var h = r.hostname.replace(/^www\./, '');
          src = /(^|\.)google\./.test(h) ? 'google' : /(^|\.)bing\.com$/.test(h) ? 'bing' : /duckduckgo\.com$/.test(h) ? 'duckduckgo'
            : /instagram\.com$/.test(h) ? 'instagram' : /(facebook\.com|fb\.com|fb\.me)$/.test(h) ? 'facebook'
            : /(linkedin\.com|lnkd\.in)$/.test(h) ? 'linkedin' : 'altro';
        }
      } catch (e) { src = 'altro'; }
    }
    // Label of the button that led here (?da=…): read, then removed from the address.
    var da = '';
    var m = location.search.match(/[?&]da=([a-z0-9-]{1,48})/);
    if (m) {
      da = m[1];
      try { history.replaceState(history.state, '', location.pathname + location.search.replace(/([?&])da=[a-z0-9-]+&?/, '$1').replace(/[?&]$/, '') + location.hash); } catch (e) { /* ignore */ }
    }

    var data = { page: page, src: src, prev: prev, device: (window.innerWidth || 1024) < 760 ? 'telefono' : 'computer', cta: {}, form: {}, steps: [], reached: 0, goal: '', da: da };
    var dirty = true;

    // Clicks on buttons and important links. A fixed key: data-cta, or where it is + where it goes.
    function ctaKey(a) {
      var k = a.getAttribute('data-cta');
      if (k) return k;
      var href = a.getAttribute('href') || '';
      var to = /^tel:/.test(href) ? 'telefono' : /^mailto:/.test(href) ? 'email' : /wa\.me|whatsapp/.test(href) ? 'whatsapp'
        : /^\/(prenota|en\/book)\//.test(href) ? 'prenota' : /^\/(contatti|en\/contact)\//.test(href) ? 'contatti' : '';
      if (!to && !a.classList.contains('btn')) return '';
      if (!to) to = (href.replace(/^\/(en\/)?/, '').split(/[/?#]/)[0] || 'home').replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'pulsante';
      var zone = a.closest('header, .site-header') ? 'header' : a.closest('footer, .site-footer') ? 'footer' : '';
      if (!zone) {
        var sec = a.closest('main > *');
        var i = sec ? Array.prototype.indexOf.call(sec.parentNode.children, sec) : -1;
        zone = sec && /hero/.test(sec.className) ? 'hero' : (i >= 0 ? 's' + (i + 1) : 'pagina');
      }
      return (zone + '-' + to).slice(0, 48);
    }
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a[href], button[data-cta]');
      if (!a) return;
      var key = ctaKey(a);
      if (!/^[a-z0-9-]{1,48}$/.test(key)) return;
      data.cta[key] = (data.cta[key] || 0) + 1;
      dirty = true;
      // Links to the booking page carry the button's label, so the booking page knows where it came from.
      var href = a.getAttribute('href') || '';
      if (a.tagName === 'A' && /^\/(prenota|en\/book)\/(\?|#|$)/.test(href) && !/[?&]da=/.test(href)) {
        a.setAttribute('href', href.replace(/^([^?#]*)(\?[^#]*)?/, function (all, p, q) { return p + (q ? q + '&' : '?') + 'da=' + key; }));
      }
    }, true);

    // Forms: started (first field touched), sent, error. The booking page also reports its furthest step.
    function formName(f) {
      if (!f) return '';
      if (f.getAttribute('data-stat-form')) return f.getAttribute('data-stat-form');
      if (f.closest('#booking')) return 'prenotazione';
      return '';
    }
    document.addEventListener('focusin', function (e) {
      var f = e.target && e.target.closest && e.target.closest('form');
      var name = formName(f);
      if (!name || data.form[name + ':avviato']) return;
      data.form[name + ':avviato'] = 1;
      dirty = true;
    });
    window.addEventListener('blooming:stat', function (e) {
      var d = e.detail || {};
      // Steps of the booking page reached in this page view, each counted once.
      while (d.step && data.reached < d.step && data.reached < 5) { data.reached += 1; data.steps.push(data.reached); }
      if (d.form && d.state) data.form[d.form + ':' + d.state] = 1;
      if (d.goal) data.goal = d.goal;
      dirty = true;
    });

    var sentOnce = false;
    function send() {
      if (!dirty) return;
      var msg = { page: data.page, src: data.src, device: data.device, cta: data.cta, form: data.form, steps: BOOK.test(location.pathname) ? data.steps : [] };
      if (sentOnce) msg.again = 1; // page shown again: only what happened since
      if (data.goal) { msg.goal = data.goal; msg.prev = data.prev; msg.da = data.da; }
      var body = JSON.stringify(msg);
      var ok = false;
      try { ok = nav.sendBeacon && nav.sendBeacon('/api/public/s', body); } catch (e) { ok = false; }
      if (!ok) { try { fetch('/api/public/s', { method: 'POST', body: body, keepalive: true, credentials: 'omit' }); } catch (e) { /* lost: numbers are estimates */ } }
      sentOnce = true;
      dirty = false;
      data.cta = {}; data.form = {}; data.steps = []; data.goal = '';
    }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') send(); });
    window.addEventListener('pagehide', send);
  } catch (e) { /* statistics never break the page */ }
})();
