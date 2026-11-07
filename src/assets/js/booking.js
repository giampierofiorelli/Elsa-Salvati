// Booking (/prenota/): need → service → professional → mode → day and time → details.
// Self-service management (/prenota/gestisci/) and call-back request forms.
// Plain JavaScript, no dependencies.
(function () {
  'use strict';

  var TZ = 'Europe/Rome';
  var LANG = document.documentElement.lang === 'en' ? 'en' : 'it';
  var LOCALE = LANG === 'en' ? 'en-GB' : 'it-IT';
  var T = {
    it: {
      at: ', ore ', error: 'Si è verificato un errore. Riprova.', network: 'Connessione non riuscita. Controlla la rete e riprova.',
      service: 'Servizio', with: 'Con', language: 'Lingua', mode: 'Modalità', when: 'Quando', length: 'Durata', status: 'Stato',
      newTime: 'Nuovo orario', minutes: ' minuti', assigned: 'Una professionista libera in quell\'orario, assegnata quando invii la richiesta',
      notBookable: 'I servizi di quest\'area non sono ancora prenotabili online: chiedici di ricontattarti qui sotto.',
      help: 'Aiutami a scegliere', helpText: 'Vedi gli orari di tutte e due: quando invii la richiesta ti viene assegnata una professionista libera in quell\'orario che parla la lingua che hai scelto. Nel colloquio capite insieme se fa per te o se è meglio la collega.',
      needName: 'Inserisci nome e cognome.', needEmail: 'Inserisci un indirizzo email valido.',
      needPrivacy: 'Per prenotare è necessario prendere visione dell\'informativa privacy.',
      confirming: 'Invio in corso…', confirm: 'Invia la richiesta',
      confirmed: 'Confermato', cancelled: 'Annullato', wasCancelled: 'Questo appuntamento è stato annullato.',
      tooLate: function (h) { return 'Mancano meno di ' + h + ' ore: non si può più annullare o spostare da qui. Se non riesci a venire, usa «Non riesco a venire».'; },
      canChange: function (h) { return 'Puoi spostare o annullare l\'appuntamento fino a ' + h + ' ore prima.'; },
      reallyCancel: 'Vuoi davvero annullare l\'appuntamento?',
      cancelDone: 'Appuntamento annullato.', cancelDoneText: 'Ti abbiamo scritto un\'email di riepilogo. Se vuoi, puoi prenotare un altro orario quando preferisci.',
      moveDone: 'Appuntamento spostato.', moveDoneText: 'Ti abbiamo inviato un\'email con il nuovo orario e un nuovo link personale.',
      noPreference: 'Indifferente', reqName: 'Inserisci il tuo nome.', reqContact: 'Indica almeno un\'email o un numero di telefono.',
      reqPrivacy: 'È necessario prendere visione dell\'informativa privacy.', reqSent: 'Grazie, richiesta inviata. Ti ricontatteremo personalmente al più presto.',
      modes: { studio: 'In studio', online: 'Online' },
      requestTitle: 'Richiesta inviata.',
      requestText: 'Ti abbiamo scritto un\'email con il riepilogo e il link per annullare la richiesta. Quando la professionista la accetta, ti scriviamo di nuovo. Se non trovi l\'email, guarda nella cartella spam.',
      cancelRequestBtn: 'Annulla la richiesta',
      cantComeBtn: 'Non riesco a venire',
      reallyCantCome: 'Vuoi dire alla professionista che non riesci a venire? L\'appuntamento viene annullato.',
      cantComeDone: 'Fatto. La professionista lo sa.', cantComeDoneText: 'Se vuoi un altro orario, prenotalo dal sito o scrivi alla tua professionista.',
      pending: 'In attesa di risposta', declined: 'Richiesta non accettata', expired: 'Richiesta decaduta',
      pendingNote: 'La professionista non ha ancora risposto alla tua richiesta: ti scriviamo appena la accetta. Se l\'orario non va più bene, puoi annullarla.',
      reallyCancelRequest: 'Vuoi davvero annullare la richiesta?',
      cancelRequestDone: 'Richiesta annullata.', cancelRequestDoneText: 'L\'orario è di nuovo libero. Se vuoi, puoi sceglierne un altro quando preferisci.',
      confirmAsk: 'Ci sarai? Conferma la presenza con un clic.',
      confirmedByYou: 'Hai confermato la presenza. Grazie.',
      confirmedStatus: 'Presenza confermata',
      cannotMove: function (h) { return 'Puoi annullarlo fino a ' + h + ' ore prima. Per spostarlo scrivi alla tua professionista.'; },
    },
    en: {
      at: ', ', error: 'Something went wrong. Please try again.', network: 'Connection failed. Check your network and try again.',
      service: 'Service', with: 'With', language: 'Language', mode: 'Format', when: 'When', length: 'Length', status: 'Status',
      newTime: 'New time', minutes: ' minutes', assigned: 'A psychologist who is free then (you\'ll see who once your request is accepted)',
      notBookable: 'Sessions are arranged with your psychologist after the free first meeting. To ask something first, use the form below.',
      help: 'Help me choose', helpText: 'See all free times. Your request goes to a psychologist who is free then; you\'ll see who once it\'s accepted. In the meeting you\'ll work out together whether she\'s right for you.',
      needName: 'Please enter your full name.', needEmail: 'Please enter a valid email address.',
      needPrivacy: 'To send your request, please tick to say you\'ve read the privacy notice.',
      confirming: 'Sending…', confirm: 'Send request',
      confirmed: 'Booked', cancelled: 'Cancelled', wasCancelled: 'This appointment has been cancelled.',
      tooLate: function () { return 'It\'s too late to move this meeting online. If you can\'t make it, use "I can\'t make it".'; },
      canChange: function (h) { return 'You can move or cancel the meeting up to ' + h + ' hours before. After that, use "I can\'t make it".'; },
      reallyCancel: 'Cancel this appointment?',
      cancelDone: 'Cancelled.', cancelDoneText: 'We\'ve sent you an email about it. You can choose another time on the booking page.',
      cancelDoneTextSession: 'We\'ve sent you an email about it. For a new time, contact your psychologist.',
      moveDone: 'Meeting moved.', moveDoneText: 'We\'ve emailed you the new time and a new link.',
      noPreference: 'No preference', reqName: 'Please enter your name.', reqContact: 'Please give us an email or a phone number.',
      reqPrivacy: 'Please confirm you have read the privacy notice.', reqSent: 'Thank you, your message has been sent. We\'ll get back to you personally soon.',
      modes: { studio: 'In person', online: 'Online' },
      requestTitle: 'Request sent.',
      requestText: 'We\'re holding this time for you. The psychologist will reply by 6 pm (Italian time) the day before at the latest, and we\'ll email you when she accepts. Can\'t find our email? Check your spam folder.',
      cancelRequestBtn: 'Cancel the request',
      cantComeBtn: 'I can\'t make it',
      reallyCantCome: 'Let the psychologist know you can\'t come? The time will be freed.',
      cantComeDone: 'Thank you for letting us know.', cantComeDoneText: '',
      pending: 'Waiting for the psychologist to accept', declined: 'Request declined', expired: 'Request expired',
      pendingNote: 'We\'re holding this time while the psychologist looks at your request. We\'ll email you when she accepts it. If the time no longer suits you, you can cancel the request.',
      reallyCancelRequest: 'Cancel your request?',
      cancelRequestDone: 'Request cancelled.', cancelRequestDoneText: 'The time is free again. You can choose another one below.',
      confirmAsk: 'Please confirm you\'re coming.',
      confirmedByYou: 'Thank you, you\'ve confirmed you\'re coming.',
      confirmedStatus: 'You\'ve confirmed you\'re coming',
      cannotMove: function () { return 'You can cancel this session here. To move it, please contact your psychologist.'; },
    },
  }[LANG];
  // English messages for the server's error codes (the server answers in Italian).
  var ERR_EN = {
    slot_unavailable: 'That time is no longer available. Please choose another.',
    already_booked: 'You\'ve already requested a first meeting with this email address. You can cancel it from the link in our email, or move it once it\'s accepted.',
    rate_limited: 'Too many requests in a short time. Please try again later or contact us.',
    privacy: 'Please confirm you have read the privacy notice.',
    too_late: 'It\'s too late to change this online. If you can\'t make it, use "I can\'t make it", or contact us.',
    not_found: 'This link isn\'t valid any more. Please use the link in our most recent email, or contact us.',
    not_offered: 'This isn\'t available with this choice. A session booked by your psychologist can be cancelled here, but to move it, please contact her.',
    pending: 'Your request is still waiting for the psychologist to accept it. If the time no longer suits you, cancel it and choose another.',
    not_active: 'This appointment is no longer active.',
    lang_unavailable: 'The professional you chose doesn\'t hold meetings in this language.',
    invalid: 'Please check the details you entered: one of them isn\'t valid (for example the email address or the phone number).',
    json_required: 'Something went wrong. Please try again.',
  };
  // Localised catalogue field: English if available on the English site.
  function loc(obj, field) { return (LANG === 'en' && obj && obj[field + 'En']) || (obj && obj[field]); }

  var fmtDay = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, weekday: 'short' });
  var fmtNum = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, day: 'numeric' });
  var fmtMonth = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, month: 'short' });
  var fmtLong = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  var fmtTime = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  var MODE_LABEL = T.modes;
  var LANG_LABEL = { it: 'Italiano', en: 'English' };
  var ANY = 'any'; // "Aiutami a scegliere": the studio assigns the professional at confirmation

  function $(root, sel) { return root.querySelector(sel); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function longDate(iso) {
    var d = new Date(iso);
    var s = fmtLong.format(d);
    return s.charAt(0).toUpperCase() + s.slice(1) + T.at + fmtTime.format(d);
  }
  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]+)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function api(path, body) {
    var opts = body === undefined
      ? { headers: { accept: 'application/json' } }
      : { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) };
    return fetch('/api/public' + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error((LANG === 'en' && ERR_EN[data.error]) || data.message || T.error);
          err.code = data.error;
          err.status = res.status;
          throw err;
        }
        return data;
      });
    }, function () {
      throw new Error(T.network);
    });
  }

  var catalogPromise;
  function getCatalog() {
    if (!catalogPromise) catalogPromise = api('/catalog');
    return catalogPromise;
  }

  function fillSummary(dl, rows) {
    dl.textContent = '';
    rows.forEach(function (r) {
      if (!r[1]) return;
      dl.appendChild(el('dt', { text: r[0] }));
      dl.appendChild(el('dd', { text: r[1] }));
    });
    dl.hidden = false;
  }

  function icsHref(start, end, mode) {
    function f(iso) { return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
    var body = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Studio//Prenotazione//IT',
      'BEGIN:VEVENT',
      'UID:' + f(start) + '-' + Math.random().toString(36).slice(2) + '@studio',
      'DTSTAMP:' + f(new Date().toISOString()),
      'DTSTART:' + f(start), 'DTEND:' + f(end),
      'SUMMARY:Colloquio' + (mode === 'online' ? ' (online)' : ''),
      'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
    return URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  }

  function setPressed(container, attr, value) {
    container.querySelectorAll('[' + attr + ']').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute(attr) === String(value)));
    });
  }

  // ---------- day and time picker ----------

  function SlotPicker(root, onChange) {
    this.root = root;
    this.data = null;
    this.slot = null;
    this.onChange = onChange;
  }

  SlotPicker.prototype.load = function (fetcher) {
    var self = this;
    var days = $(this.root, '[data-days]');
    days.textContent = '';
    days.appendChild(el('div', { class: 'skeleton', 'aria-hidden': 'true' }));
    $(this.root, '[data-times]').textContent = '';
    $(this.root, '[data-empty]').hidden = true;
    this.slot = null;
    this.onChange(null);
    this.fetcher = fetcher || this.fetcher;
    return this.fetcher().then(function (data) {
      self.data = data;
      self.renderDays();
    }).catch(function (err) {
      days.textContent = '';
      days.appendChild(el('p', { class: 'form-error', text: err.message }));
    });
  };

  SlotPicker.prototype.renderDays = function () {
    var self = this;
    var days = $(this.root, '[data-days]');
    days.textContent = '';
    var list = this.data.days;
    $(this.root, '[data-empty]').hidden = list.length > 0;
    if (!list.length) { $(this.root, '[data-times]').textContent = ''; return; }
    list.forEach(function (d, i) {
      var noon = new Date(d.date + 'T12:00:00Z');
      var b = el('button', { type: 'button', class: 'day', 'aria-pressed': 'false', 'aria-label': fmtLong.format(noon) }, [
        el('span', { class: 'dw', text: fmtDay.format(noon).replace('.', '') }),
        el('span', { class: 'dn', text: fmtNum.format(noon) }),
        el('span', { class: 'dm', text: fmtMonth.format(noon).replace('.', '') }),
      ]);
      b.addEventListener('click', function () { self.selectDay(i); });
      days.appendChild(b);
    });
    this.selectDay(0);
  };

  SlotPicker.prototype.selectDay = function (i) {
    var self = this;
    var day = this.data.days[i];
    this.slot = null;
    this.onChange(null);
    this.root.querySelectorAll('.day').forEach(function (b, j) { b.setAttribute('aria-pressed', String(i === j)); });
    var times = $(this.root, '[data-times]');
    times.textContent = '';
    day.slots.forEach(function (s) {
      var b = el('button', { type: 'button', class: 'time', 'aria-pressed': 'false', text: s.time });
      b.addEventListener('click', function () {
        times.querySelectorAll('.time').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        self.slot = s;
        self.onChange(s);
      });
      times.appendChild(b);
    });
  };

  function show(root, step) {
    root.querySelectorAll('.booking-step').forEach(function (s) { s.hidden = s.getAttribute('data-step') !== step; });
    var target = root.querySelector('[data-step="' + step + '"]');
    if (target && step === 'done') target.focus();
  }

  // ---------- booking ----------

  function initBooking(root) {
    var state = { services: [], service: null, pro: null, mode: null, lang: null, assignedName: null };
    var pageLang = LANG;
    var catalog;
    var picker = new SlotPicker(root, function (slot) {
      $(root, '[data-next]').disabled = !slot;
      var dl = $(root, '[data-summary]');
      if (slot) fillSummary(dl, rows()); else dl.hidden = true;
    });

    function rows() {
      return [
        [T.service, state.service && loc(state.service, 'name')],
        [T.with, state.assignedName || (state.pro && (state.pro.id === ANY ? T.assigned : state.pro.name))],
        [T.language, LANG_LABEL[state.lang]],
        [T.mode, MODE_LABEL[state.mode]],
        [T.when, picker.slot && longDate(picker.slot.start)],
        [T.length, state.service && state.service.durationMinutes + T.minutes],
      ];
    }

    function hideFrom(name) {
      var order = ['service', 'pro', 'lang', 'mode', 'slot'];
      order.slice(order.indexOf(name)).forEach(function (k) { $(root, '[data-' + k + '-box]').hidden = true; });
    }

    // Services for a need: those of the need's categories ('*' = all).
    function servicesFor(cats) {
      var list = [];
      catalog.categories.forEach(function (c) {
        if (cats === '*' || cats.split(',').indexOf(c.slug) >= 0) {
          c.services.forEach(function (s) { list.push({ service: s, category: c }); });
        }
      });
      return list;
    }

    function selectNeed(slug, preset) {
      var btn = $(root, '[data-need="' + slug + '"]');
      if (!btn) return;
      var cats = btn.getAttribute('data-cats');
      setPressed($(root, '[data-needs]'), 'data-need', slug);
      hideFrom('service');
      var box = $(root, '[data-services]');
      box.textContent = '';
      var bookable = servicesFor(cats).filter(function (x) { return x.service.professionals.length; });
      // "Non lo so ancora" opens the shared first meeting; if that area doesn't exist yet, show everything.
      if (!bookable.length && cats === 'da-scegliere') {
        cats = '*';
        bookable = servicesFor(cats).filter(function (x) { return x.service.professionals.length; });
      }
      state.services = bookable.map(function (x) { return x.service; });
      if (!bookable.length) {
        box.appendChild(el('p', { class: 'note', text: T.notBookable }));
      }
      var many = cats === '*' || cats.indexOf(',') >= 0;
      if (cats === 'da-scegliere') many = false;
      bookable.forEach(function (x) {
        var s = x.service;
        var b = el('button', { type: 'button', class: 'choice', 'data-svc': s.id, 'aria-pressed': 'false' }, [
          el('strong', { text: loc(s, 'name') }),
          el('span', { text: (many ? loc(x.category, 'name') + ' · ' : '') + s.durationMinutes + T.minutes + (loc(s, 'price') ? ' · ' + loc(s, 'price') : '') }),
        ]);
        b.addEventListener('click', function () { selectService(s.id); });
        box.appendChild(b);
      });
      $(root, '[data-service-box]').hidden = false;
      var pre = preset && state.services.find(function (s) { return s.id === preset.service; });
      if (pre) selectService(pre.id, preset);
      else if (state.services.length === 1) selectService(state.services[0].id);
    }

    // The need that contains a category, for links like /prenota/?area=coaching
    function needForCategory(slug) {
      var found = 'tutti';
      root.querySelectorAll('[data-need]').forEach(function (b) {
        var cats = b.getAttribute('data-cats');
        if (found === 'tutti' && cats !== '*' && cats.split(',').indexOf(slug) >= 0) found = b.getAttribute('data-need');
      });
      return found;
    }

    function selectService(id, preset) {
      state.service = state.services.find(function (s) { return s.id === id; });
      setPressed($(root, '[data-services]'), 'data-svc', id);
      hideFrom('pro');
      var box = $(root, '[data-pros]');
      box.textContent = '';
      var pros = state.service.professionals;
      if (pros.length > 1) {
        var helper = el('button', { type: 'button', class: 'pro', 'data-pro': ANY, 'aria-pressed': 'false' }, [
          el('span', { class: 'pro-photo' }, [el('img', { src: '/assets/img/logo-icon.webp', alt: '', width: '56', height: '56', class: 'pro-logo' })]),
          el('span', { class: 'pro-text' }, [
            el('strong', { text: T.help }),
            el('span', { text: T.helpText }),
          ]),
        ]);
        helper.addEventListener('click', function () { selectPro(ANY); });
        box.appendChild(helper);
      }
      pros.forEach(function (p) {
        var photo = p.photo
          ? el('img', { src: '/assets/img/' + p.photo + '-480.webp', alt: '', width: '56', height: '56', loading: 'lazy' })
          : el('img', { src: '/assets/img/logo-icon.webp', alt: '', width: '56', height: '56', class: 'pro-logo' });
        var b = el('button', { type: 'button', class: 'pro', 'data-pro': p.id, 'aria-pressed': 'false' }, [
          el('span', { class: 'pro-photo' }, [photo]),
          el('span', { class: 'pro-text' }, [
            el('strong', { text: p.name }),
            el('span', { text: loc(p, 'title') }),
            el('span', { class: 'pro-modes', text: p.modes.map(function (m) { return MODE_LABEL[m]; }).join(' · ') }),
          ]),
        ]);
        b.addEventListener('click', function () { selectPro(p.id); });
        box.appendChild(b);
      });
      $(root, '[data-pro-box]').hidden = false;
      // Preset by id or by page address (slug), e.g. from a professional's page.
      var pre = preset && preset.pro && pros.find(function (p) { return p.id === preset.pro || p.slug === preset.pro; });
      if (pre) selectPro(pre.id);
      else if (pros.length === 1) selectPro(pros[0].id);
      else selectPro(ANY);
    }

    function langsOf(pro) { return (pro && pro.languages && pro.languages.length) ? pro.languages : ['it']; }

    // The professionals behind the current choice (all of them for "help me choose").
    function chosenPros() {
      return state.pro.id === ANY ? state.service.professionals : [state.pro];
    }

    function selectPro(id) {
      state.pro = id === ANY
        ? { id: ANY, name: T.help }
        : state.service.professionals.find(function (p) { return p.id === id; });
      state.assignedName = null;
      setPressed($(root, '[data-pros]'), 'data-pro', id);
      hideFrom('lang');
      // Languages: those of the professional, or of anyone for "help me choose".
      var langs = [];
      chosenPros().forEach(function (p) { langsOf(p).forEach(function (l) { if (langs.indexOf(l) < 0) langs.push(l); }); });
      langs.sort(function (a, b) { return a === pageLang ? -1 : b === pageLang ? 1 : 0; });
      var box = $(root, '[data-langs]');
      box.textContent = '';
      langs.forEach(function (l) {
        var b = el('button', { type: 'button', 'data-lang': l, 'aria-pressed': 'false', text: LANG_LABEL[l] });
        b.addEventListener('click', function () { selectLang(l); });
        box.appendChild(b);
      });
      $(root, '[data-lang-box]').hidden = false;
      selectLang(langs.indexOf(pageLang) >= 0 ? pageLang : langs[0]);
    }

    function selectLang(l) {
      state.lang = l;
      setPressed($(root, '[data-langs]'), 'data-lang', l);
      hideFrom('mode');
      // Modes offered by the professionals who work in that language.
      var modes = [];
      chosenPros().filter(function (p) { return langsOf(p).indexOf(l) >= 0; }).forEach(function (p) {
        p.modes.forEach(function (m) { if (modes.indexOf(m) < 0) modes.push(m); });
      });
      // The practice works online until it has premises (decided): when online
      // is available, in-person is not offered and the choice is not shown.
      if (modes.indexOf('online') >= 0) modes = ['online'];
      var box = $(root, '[data-modes]');
      box.textContent = '';
      modes.forEach(function (m) {
        var b = el('button', { type: 'button', 'data-mode': m, 'aria-pressed': 'false', text: MODE_LABEL[m] });
        b.addEventListener('click', function () { selectMode(m); });
        box.appendChild(b);
      });
      $(root, '[data-mode-box]').hidden = modes.length < 2;
      selectMode(modes.indexOf('online') >= 0 ? 'online' : modes[0]);
    }

    function selectMode(m) {
      state.mode = m;
      setPressed($(root, '[data-modes]'), 'data-mode', m);
      $(root, '[data-slot-box]').hidden = false;
      var q = '/slots?service=' + state.service.id + '&professional=' + state.pro.id + '&mode=' + m + '&lang=' + state.lang;
      picker.load(function () { return api(q); });
    }

    root.querySelectorAll('[data-need]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!catalog) return;
        selectNeed(b.getAttribute('data-need'));
      });
    });

    getCatalog().then(function (c) {
      catalog = c;
      // Preselection from links like /prenota/?servizio=4&professionista=2, ?bisogno=lavoro or ?area=coaching
      var wantService = param('servizio');
      var wantPro = param('professionista');
      if (wantService) {
        var cat = c.categories.find(function (x) { return x.services.some(function (s) { return s.id === wantService; }); });
        if (cat) selectNeed(needForCategory(cat.slug), { service: wantService, pro: wantPro });
      } else if (wantPro) {
        // From a professional's page: start from her first-meeting service if any, else her first service.
        var pro = c.professionals.find(function (p) { return p.id === wantPro || p.slug === wantPro; });
        if (pro && pro.services.length) {
          var s0 = null;
          c.categories.forEach(function (cat) { cat.services.forEach(function (sv) {
            if (!s0 && sv.firstMeeting && sv.professionals.some(function (x) { return x.id === pro.id; })) s0 = sv;
          }); });
          var svc = s0 || pro.services[0];
          var cat2 = c.categories.find(function (x) { return x.services.some(function (sv) { return sv.id === svc.id; }); });
          if (cat2) selectNeed(needForCategory(cat2.slug), { service: svc.id, pro: pro.id });
        }
      } else if (param('bisogno')) {
        selectNeed(param('bisogno'));
      } else if (param('area')) {
        selectNeed(needForCategory(param('area')));
      }
    }).catch(function (err) {
      var box = $(root, '[data-catalog-error]');
      box.hidden = false;
      box.textContent = err.message;
    });

    $(root, '[data-next]').addEventListener('click', function () {
      fillSummary($(root, '[data-summary-2]'), rows());
      show(root, 'details');
      $(root, '#b-name').focus();
    });
    $(root, '[data-back]').addEventListener('click', function () { show(root, 'pick'); });

    var form = $(root, 'form[data-step="details"]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var error = $(root, '[data-error]');
      error.textContent = '';
      var name = form.name.value.trim();
      var email = form.email.value.trim();
      if (name.length < 2) { error.textContent = T.needName; form.name.focus(); return; }
      if (!/^\S+@\S+\.\S{2,}$/.test(email)) { error.textContent = T.needEmail; form.email.focus(); return; }
      if (!form.privacy.checked) { error.textContent = T.needPrivacy; return; }
      var btn = $(root, '[data-confirm]');
      btn.disabled = true;
      btn.textContent = T.confirming;
      api('/book', {
        start: picker.slot.start, mode: state.mode, service: state.service.id, professional: state.pro.id, lang: state.lang,
        name: name, email: email, phone: form.phone.value.trim(), privacy: true, website: form.website.value,
        heard: form.heard ? form.heard.value : '',
      }).then(function (res) {
        if (res.booking.assigned) state.assignedName = res.booking.professional.name;
        fillSummary($(root, '[data-summary-3]'), rows());
        $(root, '[data-ics]').href = icsHref(res.booking.start, res.booking.end, res.booking.mode);
        $(root, '[data-manage]').href = res.manageUrl.replace(/^https?:\/\/[^/]+/, '');
        if (res.booking.pending) {
          // A request waiting for the professional's approval, not a confirmed appointment.
          var doneStep = $(root, '[data-step="done"]');
          var h2 = doneStep.querySelector('h2');
          var p = h2 && h2.parentNode.querySelector('dl + p, p');
          if (h2) h2.textContent = T.requestTitle;
          if (p) p.textContent = T.requestText;
          $(root, '[data-manage]').textContent = T.cancelRequestBtn;
        }
        show(root, 'done');
      }).catch(function (err) {
        error.textContent = err.message;
        if (err.code === 'slot_unavailable') {
          picker.load();
          setTimeout(function () { show(root, 'pick'); }, 2500);
        }
      }).then(function () {
        btn.disabled = false;
        btn.textContent = T.confirm;
      });
    });
  }

  // ---------- manage (cancel / reschedule) ----------

  function initManage(root) {
    var token = (location.hash.match(/t=([\w-]+)/) || [])[1];
    if (token && history.replaceState) history.replaceState(null, '', location.pathname);
    var loading = $(root, '[data-manage-loading]');
    var invalid = $(root, '[data-invalid]');
    if (!token) { loading.hidden = true; invalid.hidden = false; return; }

    var pickStep = root.querySelector('[data-step="pick"]');
    var mode;
    var picker = new SlotPicker(pickStep, function (slot) {
      $(root, '[data-next]').disabled = !slot;
      var dl = $(root, '[data-summary]');
      if (slot) fillSummary(dl, [[T.newTime, longDate(slot.start)], [T.mode, MODE_LABEL[mode]]]); else dl.hidden = true;
    });

    function done(title, text, booking) {
      $(root, '[data-done-title]').textContent = title;
      $(root, '[data-done-text]').textContent = text;
      if (booking) {
        fillSummary($(root, '[data-summary-3]'), [[T.when, longDate(booking.start)], [T.mode, MODE_LABEL[booking.mode]]]);
        var ics = $(root, '[data-ics]');
        ics.href = icsHref(booking.start, booking.end, booking.mode);
        ics.hidden = false;
      } else {
        $(root, '[data-rebook]').hidden = false;
      }
      show(root, 'done');
    }

    function selectMode(m) {
      mode = m;
      setPressed($(root, '[data-modes]'), 'data-mode', m);
      picker.load(function () { return api('/manage/slots', { t: token, mode: m }); });
    }

    api('/manage', { t: token }).then(function (res) {
      loading.hidden = true;
      var b = res.booking;
      var statusText = b.status === 'in_attesa' ? T.pending
        : b.status === 'rifiutato' ? T.declined
          : b.status === 'confermato' ? (b.confirmedAt ? T.confirmedStatus : T.confirmed) : T.cancelled;
      fillSummary($(root, '[data-current]'), [
        [T.when, longDate(b.start)],
        [T.service, b.service && b.service.name],
        [T.with, b.professional && b.professional.name],
        [T.mode, MODE_LABEL[b.mode] || '—'],
        [T.status, statusText],
      ]);
      var note = $(root, '[data-change-note]');
      var confirmBtn = $(root, '[data-confirm-attendance]');
      var moveBtn = $(root, '[data-start-reschedule]');
      var cancelBtn = $(root, '[data-cancel]');
      if (b.pending) {
        note.textContent = T.pendingNote;
        moveBtn.hidden = true;
        cancelBtn.textContent = T.cancelRequestBtn;
      } else if (b.status !== 'confermato') {
        note.textContent = T.wasCancelled;
        $(root, '[data-actions]').hidden = true;
      } else {
        // Confirming is possible even when it's too late to move or cancel online. It needs a real click:
        // nothing happens just by opening the link (email scanners open links on their own).
        if (b.needsConfirmation && confirmBtn) confirmBtn.hidden = false;
        if (!b.canMove) moveBtn.hidden = true;
        if (!b.canChange) moveBtn.hidden = true;
        // Telling us you can't come is possible until the start (late ones are flagged to the professional).
        cancelBtn.hidden = !b.canCancel;
        cancelBtn.textContent = T.cantComeBtn;
        var parts = [];
        if (b.needsConfirmation) parts.push(T.confirmAsk);
        else if (b.confirmedAt) parts.push(T.confirmedByYou);
        parts.push(b.lateCancel ? T.tooLate(b.cancelHours) : (b.canMove ? T.canChange(b.cancelHours) : T.cannotMove(b.cancelHours)));
        note.textContent = parts.join(' ');
        if (moveBtn.hidden && cancelBtn.hidden && (!confirmBtn || confirmBtn.hidden)) $(root, '[data-actions]').hidden = true;
      }
      show(root, 'view');

      if (confirmBtn) {
        confirmBtn.addEventListener('click', function () {
          confirmBtn.disabled = true;
          api('/manage/confirm', { t: token }).then(function () {
            confirmBtn.hidden = true;
            note.textContent = T.confirmedByYou;
          }).catch(function (err) {
            confirmBtn.disabled = false;
            $(root, '[data-view-error]').textContent = err.message;
          });
        });
      }

      var modesBox = $(root, '[data-modes]');
      (b.modes || ['studio', 'online']).forEach(function (m) {
        var btn = el('button', { type: 'button', 'data-mode': m, 'aria-pressed': 'false', text: MODE_LABEL[m] });
        btn.addEventListener('click', function () { selectMode(m); });
        modesBox.appendChild(btn);
      });

      $(root, '[data-cancel]').addEventListener('click', function () {
        if (!window.confirm(b.pending ? T.reallyCancelRequest : (b.lateCancel ? T.reallyCantCome : T.reallyCancel))) return;
        api('/manage/cancel', { t: token }).then(function () {
          if (b.pending) done(T.cancelRequestDone, T.cancelRequestDoneText);
          else if (b.lateCancel) done(T.cantComeDone, T.cantComeDoneText);
          else done(T.cancelDone, (!b.canMove && T.cancelDoneTextSession) || T.cancelDoneText);
        }).catch(function (err) { $(root, '[data-view-error]').textContent = err.message; });
      });
      $(root, '[data-start-reschedule]').addEventListener('click', function () {
        show(root, 'pick');
        if (!mode) selectMode((b.modes || []).indexOf(b.mode) >= 0 ? b.mode : (b.modes || ['studio'])[0]);
      });
      $(root, '[data-back-view]').addEventListener('click', function () { show(root, 'view'); });
      $(root, '[data-next]').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        api('/manage/reschedule', { t: token, start: picker.slot.start, mode: mode }).then(function (r) {
          token = (r.manageUrl.match(/t=([\w-]+)/) || [])[1];
          done(T.moveDone, T.moveDoneText, r.booking);
        }).catch(function (err) {
          $(root, '[data-error]').textContent = err.message;
          if (err.code === 'slot_unavailable') picker.load();
          btn.disabled = false;
        });
      });
    }).catch(function () {
      loading.hidden = true;
      invalid.hidden = false;
    });
  }

  // ---------- call-back request ----------

  function initRequest(form) {
    var proField = form.querySelector('[data-pro-field]');
    var proSelect = form.professional;
    if (form.category && proField) {
      form.category.addEventListener('change', function () {
        var slug = form.category.value;
        getCatalog().then(function (c) {
          var cat = c.categories.find(function (x) { return x.slug === slug; });
          proSelect.textContent = '';
          proSelect.appendChild(el('option', { value: '', text: T.noPreference }));
          var seen = {};
          (cat ? cat.services : []).forEach(function (s) {
            s.professionals.forEach(function (p) {
              if (seen[p.id]) return;
              seen[p.id] = true;
              proSelect.appendChild(el('option', { value: p.id, text: p.name }));
            });
          });
          proField.hidden = proSelect.options.length <= 1;
        }).catch(function () { proField.hidden = true; });
      });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = $(form, '[data-request-status]');
      status.className = 'status';
      status.textContent = '';
      var name = form.name.value.trim();
      var email = form.email.value.trim();
      var phone = form.phone.value.trim();
      function fail(msg) { status.className = 'status form-error'; status.textContent = msg; }
      if (name.length < 2) return fail(T.reqName);
      if (!email && !phone) return fail(T.reqContact);
      if (!form.privacy.checked) return fail(T.reqPrivacy);
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      api('/request', {
        name: name, email: email, phone: phone, mode: form.mode.value,
        category: form.category ? form.category.value : 'da_definire',
        lang: LANG,
        professional: proSelect && !proField.hidden ? proSelect.value : '',
        preference: form.preference ? form.preference.value.trim() : '',
        organization: form.organization ? form.organization.value.trim() : '',
        // Extra fields (e.g. role, size and team language on the companies form) go
        // at the top of the message, one per line, so the panel shows them.
        message: [].slice.call(form.querySelectorAll('[data-extra]')).filter(function (f) { return f.value.trim(); })
          .map(function (f) { return f.getAttribute('data-extra') + ': ' + f.value.trim(); })
          .concat(form.message && form.message.value.trim() ? [form.message.value.trim()] : []).join('\n').slice(0, 600),
        privacy: true, website: form.website.value,
        heard: form.heard ? form.heard.value : '',
      }).then(function () {
        form.reset();
        if (proField) proField.hidden = true;
        status.className = 'status form-ok';
        status.textContent = T.reqSent;
      }).catch(function (err) { fail(err.message); }).then(function () { btn.disabled = false; });
    });
  }

  var root = document.getElementById('booking');
  if (root && root.getAttribute('data-mode') === 'book') initBooking(root);
  if (root && root.getAttribute('data-mode') === 'manage') initManage(root);
  document.querySelectorAll('[data-request-form]').forEach(initRequest);
})();
