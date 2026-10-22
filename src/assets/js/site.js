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
  if (cta && /^\/(prenota|contatti)\//.test(location.pathname)) { cta.remove(); cta = null; }

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
