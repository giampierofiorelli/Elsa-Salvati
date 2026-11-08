// Mobile menu, header border on scroll, sticky CTA that hides near the footer and on booking pages.
(function () {
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.getElementById('menu');
  if (toggle && nav) {
    var setOpen = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? toggle.getAttribute('data-close') || 'Chiudi' : toggle.getAttribute('data-open') || 'Menu';
      nav.classList.toggle('open', open);
      document.documentElement.classList.toggle('menu-open', open);
    };
    toggle.addEventListener('click', function () { setOpen(toggle.getAttribute('aria-expanded') !== 'true'); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) { setOpen(false); toggle.focus(); }
    });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
  }

  var header = document.querySelector('.site-header');
  var cta = null; // the sticky mobile button was removed (v4)
  var footer = document.querySelector('.site-footer');

  function onScroll() {
    if (header) header.classList.toggle('scrolled', window.scrollY > 8);
    if (cta && footer) {
      var nearFooter = footer.getBoundingClientRect().top < window.innerHeight;
      cta.classList.toggle('hidden', window.scrollY < 240 || nearFooter);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

// Language. The home page sends non-Italian browsers to /en/ (Netlify rule);
// a choice made here is kept in the nf_lang cookie, which Netlify reads instead
// of the browser language. Until someone chooses, a short notice offers the
// other version of the site.
(function () {
  var pageLang = document.documentElement.lang === 'en' ? 'en' : 'it';
  // After an explicit switch to Italian (/?lang=it), keep the clean address.
  if (/[?&]lang=it\b/.test(location.search) && window.history.replaceState) {
    window.history.replaceState(null, '', location.pathname + location.hash);
  }
  function remember(lang) {
    document.cookie = 'nf_lang=' + lang + '; path=/; max-age=31536000; samesite=lax' + (location.protocol === 'https:' ? '; secure' : '');
  }
  var links = document.querySelectorAll('[data-lang-switch]');
  links.forEach(function (a) {
    a.addEventListener('click', function () { remember(a.getAttribute('data-lang-switch')); });
  });
  if (!links.length || /(?:^|;\s*)nf_lang=/.test(document.cookie)) return;

  var other = links[0];
  // The notice speaks to people who read the other language, so it is written in that language: one action,
  // the whole text is the link. Each language has its own best phrase, not a translation (G 2026-11).
  // It leads to the equivalent page, or to the other home page when there is none.
  var target = other.getAttribute('data-lang-switch') === 'en' ? 'en' : 'it';
  var exact = other.hasAttribute('data-lang-exact');
  var MSG = {
    en: { link: 'Switch to English', close: 'Close', label: 'Language' },
    it: { link: exact ? 'Leggi questa pagina in italiano' : 'Leggi il sito in italiano', close: 'Chiudi', label: 'Lingua' },
  }[target];
  var bar = document.createElement('div');
  bar.className = 'lang-notice';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', MSG.label);
  bar.lang = target;
  var p = document.createElement('p');
  var link = document.createElement('a');
  link.href = other.getAttribute('href');
  link.hreflang = target;
  link.textContent = MSG.link;
  link.addEventListener('click', function () { remember(target); });
  p.appendChild(link);
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lang-notice-close';
  btn.setAttribute('aria-label', MSG.close);
  btn.textContent = '×';
  btn.addEventListener('click', function () { remember(pageLang); bar.remove(); });
  bar.appendChild(p);
  bar.appendChild(btn);
  // Inside the (fixed) header, so it never overlaps it.
  var hdr = document.querySelector('.site-header');
  if (hdr) hdr.insertBefore(bar, hdr.firstChild); else document.body.insertBefore(bar, document.body.firstChild);
})();

// The giant "Blooming" always fits the width of the screen, whatever the
// browser's font rendering (it was cut on the right on some phones).
(function () {
  var words = document.querySelectorAll('.giant-word');
  if (!words.length) return;
  function fit() {
    words.forEach(function (el) {
      var style = getComputedStyle(el);
      var avail = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      // Measure the text's own width at 100px in an inline box.
      var probe = document.createElement('span');
      probe.textContent = el.textContent;
      // Letter spacing is computed in px for the current size: scale it to 100px.
      var ls = (parseFloat(style.letterSpacing) || 0) / parseFloat(style.fontSize) * 100;
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:100px;letter-spacing:' + ls + 'px;';
      el.appendChild(probe);
      var natural = probe.getBoundingClientRect().width;
      el.removeChild(probe);
      if (natural > 0 && avail > 0) el.style.fontSize = Math.min(352, Math.floor(100 * avail / natural * 0.98)) + 'px';
    });
  }
  fit();
  // Measure again once the title font is really loaded (it loads on first use).
  if (document.fonts && document.fonts.load) {
    document.fonts.load('600 100px "Funnel Display"', 'Blooming').then(fit, fit);
    document.fonts.ready.then(fit);
  }
  window.addEventListener('resize', fit);
})();

// Palette trial (staging only): a small panel to switch between the colour
// options; the choice is kept in this browser. Never shown on the live site.
(function () {
  var host = location.hostname;
  if (!/staging--|localhost|127\.0\.0\.1/.test(host)) return;
  document.documentElement.classList.add('is-staging');
  var opts = [['a', 'Verde profondo e menta (consigliata)', '#205A54', '#CDEFE2'], ['b', 'Salvia calda e terracotta', '#3F5F52', '#E8C9A8'],
    ['c', 'Ardesia e sabbia', '#2D5068', '#E9CFA9'], ['x', 'Colori attuali', '#1F2F3A', '#CBAD85']];
  var q = new URLSearchParams(location.search).get('palette');
  var cur = 'a';
  try { cur = q || localStorage.getItem('bl-palette2') || 'a'; } catch (e) { cur = q || 'a'; }
  function apply(p) {
    document.documentElement.setAttribute('data-palette', p);
    try { localStorage.setItem('bl-palette2', p); } catch (e) {}
    panel.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.p === p ? 'true' : 'false'); });
    window.dispatchEvent(new Event('bl-palette'));
  }
  var panel = document.createElement('div');
  panel.className = 'palette-panel';
  panel.innerHTML = '<span>Colori</span>';
  opts.forEach(function (o) {
    var b = document.createElement('button');
    b.type = 'button'; b.dataset.p = o[0]; b.textContent = o[0].toUpperCase();
    b.title = o[1]; b.setAttribute('aria-label', 'Colori ' + o[0].toUpperCase() + ': ' + o[1]);
    b.style.background = 'linear-gradient(135deg, ' + o[2] + ' 55%, ' + o[3] + ' 55%)';
    b.addEventListener('click', function () { apply(o[0]); });
    panel.appendChild(b);
  });
  // Descriptor next to the name (research 16): three options to compare.
  var desc = document.querySelectorAll('[data-descriptor]');
  if (desc.length) {
    var en = document.documentElement.lang === 'en';
    var dOpts = en ? ['Psychology for work and life', 'Therapy and coaching for work and life', 'Psychology, careers and wellbeing']
                   : ['Psicologia per la vita e il lavoro', 'Psicologia e coaching per la vita e il lavoro', 'Psicologia, carriera e benessere'];
    var dSep = document.createElement('span'); dSep.textContent = 'Etichetta'; panel.appendChild(dSep);
    var setDesc = function (i) {
      desc.forEach(function (el) { el.textContent = dOpts[i]; });
      try { localStorage.setItem('bl-desc', String(i)); } catch (e) {}
      panel.querySelectorAll('button[data-desc]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.desc === String(i) ? 'true' : 'false'); });
    };
    dOpts.forEach(function (t, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.dataset.desc = String(i); b.textContent = String(i + 1); b.title = t; b.setAttribute('aria-label', 'Etichetta ' + (i + 1) + ': ' + t);
      b.style.background = '#FAF6F0'; b.style.color = '#1F2F3A'; b.style.border = '1px solid #E6DDD2';
      b.addEventListener('click', function () { setDesc(i); });
      panel.appendChild(b);
    });
    var di = 0; try { di = parseInt(localStorage.getItem('bl-desc') || '0', 10) || 0; } catch (e) {}
    setDesc(di);
  }
  document.body.appendChild(panel);
  apply(cur);
})();

// Footer year: "2026", then "2026–2027"… If a page was cached before the new year, show the right one.
(function () {
  var el = document.querySelector('[data-year]');
  if (!el) return;
  var since = Number(el.getAttribute('data-since')) || 0;
  var year;
  try { year = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric' }).format(new Date())); } catch (e) { year = new Date().getFullYear(); }
  if (!since || !year) return;
  var text = year > since ? since + '\u2013' + year : String(since);
  if (el.textContent !== text) el.textContent = text;
})();
