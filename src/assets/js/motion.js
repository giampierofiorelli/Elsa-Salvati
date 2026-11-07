// Motion layer (v4). Techniques inspired by editorial sites, written from the
// GSAP documentation. Everything is opt-in through data attributes:
//   data-reveal="lines"  headings rise line by line from a mask
//   data-reveal="fade"   soft rise and fade
//   data-reveal="light"  text lights up word by word while scrolling
//   data-giant           giant word rising at the bottom of the opening
//   data-parallax        gentle vertical parallax
//   data-roll            links and buttons whose text rolls on hover
//   data-theme-section   "light" | "dark": the header follows the section under it
// With "reduce motion", or if a library fails to load, nothing is hidden or moved.
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  // Hide what is about to animate until the tweens are in place (no flash);
  // released after at most 2.5 s whatever happens.
  if (!reduce) {
    root.classList.add('motion-pending');
    setTimeout(function () { root.classList.remove('motion-pending'); }, 2500);
  }

  // Rolling text on links and buttons (pure CSS once the text is wrapped).
  document.querySelectorAll('[data-roll]').forEach(function (el) {
    // Buttons keep their own style; the rolling text is for secondary links.
    if (el.querySelector('.roll') || el.classList.contains('btn')) return;
    var text = el.textContent.trim();
    el.setAttribute('aria-label', el.getAttribute('aria-label') || text);
    var wrap = document.createElement('span');
    wrap.className = 'roll';
    wrap.setAttribute('aria-hidden', 'true');
    var a = document.createElement('span'); a.className = 'roll-a'; a.textContent = text;
    var b = document.createElement('span'); b.className = 'roll-b'; b.textContent = text;
    wrap.appendChild(a); wrap.appendChild(b);
    // Keep any icon that follows the text (e.g. the arrow circle of primary buttons).
    var icons = Array.prototype.filter.call(el.children, function (c) { return c.tagName === 'svg' || c.classList.contains('circle-arrow'); });
    el.textContent = '';
    el.appendChild(wrap);
    icons.forEach(function (i) { el.appendChild(i); });
  });

  if (reduce || !window.gsap || !window.ScrollTrigger) { root.classList.remove('motion-pending'); root.classList.add('motion-off'); return; }
  var gsap = window.gsap;
  gsap.registerPlugin(window.ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(window.SplitText);
  root.classList.add('motion-on');

  // Smooth scrolling, tied to ScrollTrigger.
  var lenis = null;
  if (window.Lenis) {
    lenis = new window.Lenis({ duration: 1.1, smoothWheel: true });
    lenis.on('scroll', window.ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    // In-page anchors go through Lenis too.
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || a.getAttribute('href').length < 2) return;
      var target = document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); lenis.scrollTo(target, { offset: -90 }); }
    });
  }

  // Same treatment everywhere: every large heading rises line by line, every
  // smaller heading fades up, unless it opts out (data-reveal="none") or sits in
  // a part of the page that starts hidden (booking steps, menu).
  function autoReveal() {
    var skip = '.booking, .hdr-nav, [hidden], .loader, .lang-notice, .site-footer, form';
    document.querySelectorAll('main h1, main h2').forEach(function (el) {
      if (!el.hasAttribute('data-reveal') && !el.closest(skip)) el.setAttribute('data-reveal', 'lines');
    });
    document.querySelectorAll('main h3').forEach(function (el) {
      if (!el.hasAttribute('data-reveal') && !el.closest(skip)) el.setAttribute('data-reveal', 'fade');
    });
  }

  function reveals() {
    autoReveal();
    document.querySelectorAll('[data-reveal="lines"]').forEach(function (el) {
      if (!window.SplitText) {
        gsap.from(el, { autoAlpha: 0, y: 24, duration: 0.8, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
        return;
      }
      window.SplitText.create(el, {
        type: 'lines', mask: 'lines', linesClass: 'sl', autoSplit: true, aria: 'auto',
        onSplit: function (self) {
          return gsap.from(self.lines, {
            yPercent: 110, duration: 0.9, ease: 'expo.out', stagger: 0.08,
            scrollTrigger: { trigger: el, start: 'top 85%', once: true },
          });
        },
      });
    });
    document.querySelectorAll('[data-reveal="fade"]').forEach(function (el) {
      gsap.from(el, { autoAlpha: 0, y: 18, duration: 0.9, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
    });
    document.querySelectorAll('[data-reveal="light"]').forEach(function (el) {
      if (!window.SplitText) return;
      var split = window.SplitText.create(el, { type: 'words', aria: 'auto' });
      gsap.fromTo(split.words, { opacity: 0.18 }, {
        opacity: 1, ease: 'none', stagger: 0.1,
        scrollTrigger: { trigger: el, start: 'top 85%', end: 'bottom 45%', scrub: true },
      });
    });
    document.querySelectorAll('[data-giant]').forEach(function (el) {
      gsap.from(el, { yPercent: 60, autoAlpha: 0, duration: 1.4, ease: 'expo.out', delay: 0.15 });
    });
    document.querySelectorAll('[data-parallax]').forEach(function (el) {
      gsap.fromTo(el, { yPercent: 12 }, { yPercent: -12, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
  }

  // The header turns dark over dark sections.
  function headerTheme() {
    var header = document.querySelector('.site-header');
    if (!header) return;
    document.querySelectorAll('[data-theme-section="dark"]').forEach(function (sec) {
      window.ScrollTrigger.create({
        trigger: sec, start: 'top 60px', end: 'bottom 60px',
        onToggle: function (self) { header.classList.toggle('on-dark', self.isActive); },
      });
    });
  }

  // Short loader with the lotus, at most ~1.4 s.
  // Test phase (G, 7/11): shown on every page load. To go back to first visit
  // only, set EVERY_LOAD to false.
  var EVERY_LOAD = true;
  function loader(done) {
    var seen = false;
    try { seen = localStorage.getItem('bl-loader') === '1'; localStorage.setItem('bl-loader', '1'); } catch (e) { seen = true; }
    if (EVERY_LOAD) seen = false;
    if (seen || !document.querySelector('.hero-v4')) { done(); return; }
    var el = document.createElement('div');
    el.className = 'loader';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<img class="loader-mark" src="/assets/img/logo-icon.webp" width="293" height="224" alt=""><p class="loader-word">Blooming</p>';
    document.body.appendChild(el);
    var tl = gsap.timeline({ onComplete: function () { el.remove(); done(); } });
    tl.from('.loader-mark', { clipPath: 'inset(100% 0 0 0)', duration: 0.6, ease: 'power3.out' })
      .from('.loader-word', { yPercent: 110, autoAlpha: 0, duration: 0.5, ease: 'expo.out' }, '-=0.25')
      .to(el, { yPercent: -101, duration: 0.6, ease: 'power3.inOut' }, '+=0.25');
  }

  function start() {
    loader(function () {
      reveals();
      root.classList.remove('motion-pending');
      headerTheme();
      window.ScrollTrigger.refresh();
    });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
})();
