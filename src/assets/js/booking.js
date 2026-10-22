// Booking widget (/prenota/), self-service management (/prenota/gestisci/)
// and call-back request forms. Plain JavaScript, no dependencies.
(function () {
  'use strict';

  var TZ = 'Europe/Rome';
  var fmtDay = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, weekday: 'short' });
  var fmtNum = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, day: 'numeric' });
  var fmtMonth = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, month: 'short' });
  var fmtLong = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  var fmtTime = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  var MODE_LABEL = { studio: 'In studio', online: 'Online' };

  function $(root, sel) { return root.querySelector(sel); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  function longDate(iso) {
    var d = new Date(iso);
    var s = fmtLong.format(d);
    return s.charAt(0).toUpperCase() + s.slice(1) + ', ore ' + fmtTime.format(d);
  }

  function api(path, body) {
    var opts = body === undefined
      ? { headers: { accept: 'application/json' } }
      : { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) };
    return fetch('/api/public' + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.message || 'Si è verificato un errore. Riprova.');
          err.code = data.error;
          err.status = res.status;
          throw err;
        }
        return data;
      });
    }, function () {
      throw new Error('Connessione non riuscita. Controlla la rete e riprova.');
    });
  }

  function fillSummary(dl, rows) {
    dl.textContent = '';
    rows.forEach(function (r) {
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

  // ---------- slot picker (shared by booking and rescheduling) ----------

  function SlotPicker(root, onChange) {
    this.root = root;
    this.mode = 'studio';
    this.data = null;
    this.day = null;
    this.slot = null;
    this.onChange = onChange;
    var self = this;
    root.querySelectorAll('[data-mode-btn]').forEach(function (b) {
      b.addEventListener('click', function () { self.setMode(b.getAttribute('data-mode-btn')); });
    });
  }

  SlotPicker.prototype.setMode = function (mode) {
    this.mode = mode;
    this.root.querySelectorAll('[data-mode-btn]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-mode-btn') === mode));
    });
    this.load();
  };

  SlotPicker.prototype.load = function () {
    var self = this;
    var days = $(this.root, '[data-days]');
    days.textContent = '';
    days.appendChild(el('div', { class: 'skeleton', 'aria-hidden': 'true' }));
    $(this.root, '[data-times]').textContent = '';
    this.slot = null;
    this.onChange(null);
    return api('/slots?mode=' + this.mode).then(function (data) {
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
    var empty = $(this.root, '[data-empty]');
    days.textContent = '';
    var list = this.data.days;
    empty.hidden = list.length > 0;
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
    this.day = this.data.days[i];
    this.slot = null;
    this.onChange(null);
    this.root.querySelectorAll('.day').forEach(function (b, j) { b.setAttribute('aria-pressed', String(i === j)); });
    var times = $(this.root, '[data-times]');
    times.textContent = '';
    this.day.slots.forEach(function (s) {
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

  SlotPicker.prototype.summaryRows = function () {
    var minutes = this.data ? this.data.durationMinutes : 50;
    return [
      ['Quando', longDate(this.slot.start)],
      ['Modalità', MODE_LABEL[this.mode]],
      ['Durata', minutes + ' minuti'],
    ];
  };

  function show(root, step) {
    root.querySelectorAll('.booking-step').forEach(function (s) { s.hidden = s.getAttribute('data-step') !== step; });
    var target = root.querySelector('[data-step="' + step + '"]');
    if (target && step === 'done') target.focus();
  }

  // ---------- booking ----------

  function initBooking(root) {
    var picker = new SlotPicker(root, function (slot) {
      $(root, '[data-next]').disabled = !slot;
      var dl = $(root, '[data-summary]');
      if (slot) fillSummary(dl, picker.summaryRows()); else dl.hidden = true;
    });
    picker.load();

    $(root, '[data-next]').addEventListener('click', function () {
      fillSummary($(root, '[data-summary-2]'), picker.summaryRows());
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
      if (name.length < 2) { error.textContent = 'Inserisci nome e cognome.'; form.name.focus(); return; }
      if (!/^\S+@\S+\.\S{2,}$/.test(email)) { error.textContent = 'Inserisci un indirizzo email valido.'; form.email.focus(); return; }
      if (!form.privacy.checked) { error.textContent = 'Per prenotare è necessario prendere visione dell\'informativa privacy.'; return; }
      var btn = $(root, '[data-confirm]');
      btn.disabled = true;
      btn.textContent = 'Conferma in corso…';
      api('/book', {
        start: picker.slot.start, mode: picker.mode, name: name, email: email,
        phone: form.phone.value.trim(), privacy: true, website: form.website.value,
      }).then(function (res) {
        fillSummary($(root, '[data-summary-3]'), picker.summaryRows());
        $(root, '[data-ics]').href = icsHref(res.booking.start, res.booking.end, res.booking.mode);
        $(root, '[data-manage]').href = res.manageUrl.replace(/^https?:\/\/[^/]+/, '');
        show(root, 'done');
      }).catch(function (err) {
        error.textContent = err.message;
        if (err.code === 'slot_unavailable') {
          picker.load();
          setTimeout(function () { show(root, 'pick'); }, 2500);
        }
      }).then(function () {
        btn.disabled = false;
        btn.textContent = 'Conferma la prenotazione';
      });
    });
  }

  // ---------- manage (cancel / reschedule) ----------

  function initManage(root) {
    var token = (location.hash.match(/t=([\w-]+)/) || [])[1];
    // Remove the token from the address bar so it is not shared by accident.
    if (token && history.replaceState) history.replaceState(null, '', location.pathname);
    var loading = $(root, '[data-manage-loading]');
    var invalid = $(root, '[data-invalid]');
    if (!token) { loading.hidden = true; invalid.hidden = false; return; }

    var picker;
    function done(title, text, booking) {
      $(root, '[data-done-title]').textContent = title;
      $(root, '[data-done-text]').textContent = text;
      if (booking) {
        fillSummary($(root, '[data-summary-3]'), [['Quando', longDate(booking.start)], ['Modalità', MODE_LABEL[booking.mode]]]);
        var ics = $(root, '[data-ics]');
        ics.href = icsHref(booking.start, booking.end, booking.mode);
        ics.hidden = false;
      } else {
        $(root, '[data-rebook]').hidden = false;
      }
      show(root, 'done');
    }

    api('/manage', { t: token }).then(function (res) {
      loading.hidden = true;
      var b = res.booking;
      fillSummary($(root, '[data-current]'), [
        ['Quando', longDate(b.start)],
        ['Modalità', MODE_LABEL[b.mode] || '—'],
        ['Stato', b.status === 'confermato' ? 'Confermato' : 'Annullato'],
      ]);
      var note = $(root, '[data-change-note]');
      if (b.status !== 'confermato') {
        note.textContent = 'Questo appuntamento è stato annullato.';
        $(root, '[data-actions]').hidden = true;
      } else if (!b.canChange) {
        note.textContent = 'Mancano meno di ' + b.cancelHours + ' ore all\'appuntamento: per modificarlo contatta direttamente lo studio.';
        $(root, '[data-actions]').hidden = true;
      } else {
        note.textContent = 'Puoi spostare o annullare l\'appuntamento fino a ' + b.cancelHours + ' ore prima.';
      }
      show(root, 'view');

      $(root, '[data-cancel]').addEventListener('click', function () {
        if (!window.confirm('Vuoi davvero annullare l\'appuntamento?')) return;
        api('/manage/cancel', { t: token }).then(function () {
          done('Appuntamento annullato.', 'Ti ho inviato un\'email di conferma. Se vuoi, puoi prenotare un nuovo orario quando preferisci.');
        }).catch(function (err) { $(root, '[data-view-error]').textContent = err.message; });
      });

      $(root, '[data-start-reschedule]').addEventListener('click', function () {
        show(root, 'pick');
        if (!picker) {
          picker = new SlotPicker(root.querySelector('[data-step="pick"]'), function (slot) {
            $(root, '[data-next]').disabled = !slot;
            var dl = $(root, '[data-summary]');
            if (slot) fillSummary(dl, picker.summaryRows()); else dl.hidden = true;
          });
          picker.setMode(b.mode === 'online' ? 'online' : 'studio');
        }
      });
      $(root, '[data-back-view]').addEventListener('click', function () { show(root, 'view'); });
      $(root, '[data-next]').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        api('/manage/reschedule', { t: token, start: picker.slot.start, mode: picker.mode }).then(function (res) {
          token = (res.manageUrl.match(/t=([\w-]+)/) || [])[1];
          done('Appuntamento spostato.', 'Ti ho inviato un\'email con il nuovo orario e un nuovo link personale.', res.booking);
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
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = $(form, '[data-request-status]');
      status.className = 'status';
      status.textContent = '';
      var name = form.name.value.trim();
      var email = form.email.value.trim();
      var phone = form.phone.value.trim();
      function fail(msg) { status.className = 'status form-error'; status.textContent = msg; }
      if (name.length < 2) return fail('Inserisci il tuo nome.');
      if (!email && !phone) return fail('Indica almeno un\'email o un numero di telefono.');
      if (!form.privacy.checked) return fail('È necessario prendere visione dell\'informativa privacy.');
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      api('/request', {
        name: name, email: email, phone: phone, mode: form.mode.value,
        preference: form.preference ? form.preference.value.trim() : '',
        message: form.message ? form.message.value.trim() : '',
        privacy: true, website: form.website.value,
      }).then(function () {
        form.reset();
        status.className = 'status form-ok';
        status.textContent = 'Grazie, richiesta inviata. Ti ricontatterò personalmente al più presto.';
      }).catch(function (err) { fail(err.message); }).then(function () { btn.disabled = false; });
    });
  }

  var root = document.getElementById('booking');
  if (root && root.getAttribute('data-mode') === 'book') initBooking(root);
  if (root && root.getAttribute('data-mode') === 'manage') initManage(root);
  document.querySelectorAll('[data-request-form]').forEach(initRequest);
})();
