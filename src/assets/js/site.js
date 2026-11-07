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
    document.cookie = 'nf_lang=' + lang + '; path=/; max-age=31536000; samesite=lax';
  }
  var links = document.querySelectorAll('[data-lang-switch]');
  links.forEach(function (a) {
    a.addEventListener('click', function () { remember(a.getAttribute('data-lang-switch')); });
  });
  if (!links.length || /(?:^|;\s*)nf_lang=/.test(document.cookie)) return;

  var other = links[0];
  // The notice is written in the reader's own language (from the browser).
  var reader = String((navigator.languages && navigator.languages[0]) || navigator.language || '').slice(0, 2).toLowerCase() === 'it' ? 'it' : 'en';
  var MSG = {
    it: { it: 'Questo sito è anche in inglese.', en: 'Questo sito è anche in italiano.', close: 'Chiudi', label: 'Lingua' },
    en: { it: 'This site is also available in English.', en: 'This site is also available in Italian.', close: 'Close', label: 'Language' },
  }[reader];
  var text = { msg: MSG[pageLang], close: MSG.close };
  var bar = document.createElement('div');
  bar.className = 'lang-notice';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', MSG.label);
  bar.lang = reader;
  var p = document.createElement('p');
  p.appendChild(document.createTextNode(text.msg + ' '));
  var link = document.createElement('a');
  link.href = other.getAttribute('href');
  link.lang = other.getAttribute('data-lang-switch');
  link.textContent = other.textContent;
  link.addEventListener('click', function () { remember(link.lang); });
  p.appendChild(link);
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lang-notice-close';
  btn.setAttribute('aria-label', text.close);
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
  var opts = [['a', 'Attuale', '#1F2F3A', '#CBAD85'], ['b', 'Ardesia e albicocca', '#29465A', '#F4BE96'],
    ['c', 'Salvia e rosa', '#1D3A35', '#F2AEB8'], ['d', 'Petrolio e oro', '#173F45', '#E2B05C']];
  var q = new URLSearchParams(location.search).get('palette');
  var cur = 'a';
  try { cur = q || localStorage.getItem('bl-palette') || 'a'; } catch (e) { cur = q || 'a'; }
  function apply(p) {
    document.documentElement.setAttribute('data-palette', p);
    try { localStorage.setItem('bl-palette', p); } catch (e) {}
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
  // Logo icon: the one in the settings, or the other one to compare.
  var logos = [['classico', '1'], ['fiore', '2']];
  var curLogo = null;
  try { curLogo = localStorage.getItem('bl-logo'); } catch (e) {}
  var sep = document.createElement('span'); sep.textContent = 'Logo'; panel.appendChild(sep);
  function setLogo(name) {
    document.querySelectorAll('img[src*="/assets/img/logos/"]').forEach(function (img) {
      img.src = img.getAttribute('src').replace(/\/logos\/[a-z]+\//, '/logos/' + name + '/');
    });
    try { localStorage.setItem('bl-logo', name); } catch (e) {}
    panel.querySelectorAll('button[data-logo]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.logo === name ? 'true' : 'false'); });
  }
  logos.forEach(function (l) {
    var b = document.createElement('button');
    b.type = 'button'; b.dataset.logo = l[0]; b.textContent = l[1];
    b.title = 'Logo ' + l[1] + ' (' + l[0] + ')'; b.setAttribute('aria-label', b.title);
    b.style.background = '#FAF6F0'; b.style.color = '#1F2F3A'; b.style.border = '1px solid #E6DDD2';
    b.addEventListener('click', function () { setLogo(l[0]); });
    panel.appendChild(b);
  });
  document.body.appendChild(panel);
  apply(cur);
  var inPage = (document.querySelector('img[src*="/assets/img/logos/"]') || { getAttribute: function () { return ''; } }).getAttribute('src');
  var built = (/\/logos\/([a-z]+)\//.exec(inPage || '') || [])[1] || 'classico';
  setLogo(curLogo || built);
})();
