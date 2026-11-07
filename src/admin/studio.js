// Area riservata: professioniste, servizi, profilo della professionista.
// Tutti i file dell'area condividono un solo oggetto: window.BloomingAdmin (A).
(function (A) {
  'use strict';
  // dai file caricati prima
  var $ = A.$;
  var $$ = A.$$;
  var api = A.api;
  var buildProSwitch = A.buildProSwitch;
  var el = A.el;
  var field = A.field;
  var formDialog = A.formDialog;
  var isAdmin = A.isAdmin;
  var loadCatalog = A.loadCatalog;
  var myPro = A.myPro;
  var servicesOf = A.servicesOf;
  var state = A.state;
  // usati da altri file
  A.renderProfile = renderProfile;
  A.renderPros = renderPros;
  A.renderServices = renderServices;

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
      { name: 'notifyEmail', label: 'Email per le notifiche', type: 'email', hint: 'Qui arrivano le nuove richieste di primo colloquio e le conferme o disdette delle persone. Senza email, gli avvisi vanno agli amministratori.' },
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
      { name: 'notifyEmail', label: 'Email per le notifiche', type: 'email', hint: 'Qui arrivano le nuove richieste di primo colloquio e le conferme o disdette delle persone. Senza email, gli avvisi vanno agli amministratori.' }].forEach(function (s) { f.appendChild(field(s, p[s.name])); });
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

})(window.BloomingAdmin = window.BloomingAdmin || {});
