// Area riservata: richieste di contatto (persone e organizzazioni).
// Tutti i file dell'area condividono un solo oggetto: window.BloomingAdmin (A).
(function (A) {
  'use strict';
  // dai file caricati prima
  var $ = A.$;
  var $$ = A.$$;
  var CATEGORY_LABEL = A.CATEGORY_LABEL;
  var api = A.api;
  var el = A.el;
  var emptyState = A.emptyState;
  var pill = A.pill;
  var state = A.state;
  var toast = A.toast;
  // usati da altri file
  A.loadRequests = loadRequests;

  // ---------- requests ----------
  function loadRequests() {
    return api('GET', '/requests').then(function (res) {
      var open = res.requests.filter(function (r) { return !r.handledAt; }).length;
      var badge = $('[data-req-count]');
      if (badge) { badge.hidden = open === 0; badge.textContent = String(open); }
      $$('[data-req-show]').forEach(function (b) {
        var v = b.getAttribute('data-req-show');
        b.setAttribute('aria-pressed', String(v === state.reqShow));
        b.textContent = v === 'open' ? 'Da gestire' + (open ? ' (' + open + ')' : '') : 'Tutte (' + res.requests.length + ')';
      });
      var box = $('[data-requests]');
      box.textContent = '';
      var list = state.reqShow === 'open' ? res.requests.filter(function (r) { return !r.handledAt; }) : res.requests;
      if (!list.length) {
        box.appendChild(state.reqShow === 'open' && res.requests.length
          ? emptyState('check', 'Tutto gestito', 'Nessuna richiesta in attesa. Quelle già gestite sono in “Tutte”.')
          : emptyState('mail', 'Nessuna richiesta', 'Quando qualcuno chiede di essere ricontattato dal sito, la richiesta compare qui.'));
        return;
      }
      var ul = el('ul', { class: 'req-list', role: 'list' });
      list.forEach(function (r) {
        var when = new Date(r.createdAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
        ul.appendChild(el('li', { class: 'req card' + (r.handledAt ? ' handled' : '') }, [
          el('div', { class: 'req-head' }, [
            el('div', {}, [
              el('p', { class: 'req-name' }, [el('strong', { text: r.name || '—' }), r.organization ? el('span', { text: ' · ' + r.organization }) : null]),
              el('p', { class: 'hint', text: when }),
            ]),
            r.handledAt ? pill('Gestita', 'ok') : pill(r.category === 'aziende' ? 'Organizzazione · nuova' : 'Nuova', 'new'),
          ]),
          el('dl', { class: 'req-facts' }, [
            r.email ? el('div', {}, [el('dt', { text: 'Email' }), el('dd', {}, [el('a', { href: 'mailto:' + encodeURIComponent(r.email).replace(/%40/g, '@'), text: r.email })])]) : null,
            r.phone ? el('div', {}, [el('dt', { text: 'Telefono' }), el('dd', {}, [el('a', { href: 'tel:' + r.phone.replace(/\s/g, ''), text: r.phone })])]) : null,
            el('div', {}, [el('dt', { text: 'Area' }), el('dd', { text: CATEGORY_LABEL[r.category] || 'Da definire' })]),
            r.professionalName ? el('div', {}, [el('dt', { text: 'Professionista' }), el('dd', { text: r.professionalName })]) : null,
            el('div', {}, [el('dt', { text: 'Preferenza' }), el('dd', { text: ({ studio: 'in studio', online: 'online', da_definire: 'da definire' }[r.mode] || '—') + (r.preference ? ' · ' + r.preference : '') })]),
          ]),
          r.message ? el('p', { class: 'req-msg', text: r.message }) : null,
          el('div', { class: 'cta-row' }, [
            el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: r.handledAt ? 'Segna da gestire' : 'Segna come gestita', onclick: function () { api('POST', '/requests/' + r.id, { handled: !r.handledAt }).then(loadRequests); } }),
            el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Elimina', onclick: function () { if (window.confirm('Eliminare definitivamente la richiesta?')) api('DELETE', '/requests/' + r.id).then(function () { toast('Richiesta eliminata.'); return loadRequests(); }); } }),
          ]),
        ]));
      });
      box.appendChild(ul);
    });
  }
  $$('[data-req-show]').forEach(function (b) {
    b.addEventListener('click', function () { state.reqShow = b.getAttribute('data-req-show'); loadRequests(); });
  });

})(window.BloomingAdmin = window.BloomingAdmin || {});
