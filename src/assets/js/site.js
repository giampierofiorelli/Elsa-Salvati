// Mobile menu, header border on scroll, sticky CTA that hides near the footer and on booking pages.
(function () {
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.getElementById('menu');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      nav.classList.toggle('open', !open);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        toggle.setAttribute('aria-expanded', 'false');
        nav.classList.remove('open');
        toggle.focus();
      }
    });
  }

  var header = document.querySelector('.site-header');
  var cta = document.querySelector('.mobile-cta');
  var footer = document.querySelector('.site-footer');
  if (cta && /^\/(prenota|contatti|en\/book|en\/contact)\//.test(location.pathname)) { cta.remove(); cta = null; }

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
  document.body.insertBefore(bar, document.body.firstChild);
})();
