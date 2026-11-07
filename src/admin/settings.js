// Area riservata: impostazioni (prenotazione, account, sicurezza, dati delle persone, calendario sul telefono).
// Tutti i file dell'area condividono un solo oggetto: window.BloomingAdmin (A).
(function (A) {
  'use strict';
  // dai file caricati prima
  var $ = A.$;
  var $$ = A.$$;
  var api = A.api;
  var el = A.el;
  var formDialog = A.formDialog;
  var refresh = A.refresh;
  var state = A.state;
  var toast = A.toast;
  // usati da altri file
  A.loadSettings = loadSettings;
  A.loadUsers = loadUsers;

  // ---------- accounts (admin) ----------
  function showInviteLink(name, url) {
    var box = el('div', { class: 'invite-share' }, [
      el('p', { text: 'Invia questo link a ' + name + ': servirà per scegliere la password e collegare l\'app di autenticazione. Vale 7 giorni e si usa una sola volta.' }),
      el('code', { text: url }),
    ]);
    var qrBox = el('div', { class: 'qr qr-small' });
    if (window.qrcode) {
      var qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'QR code del link di attivazione' });
    }
    box.appendChild(el('p', { class: 'hint', text: 'Se siete insieme, può inquadrare questo QR con la fotocamera del telefono:' }));
    box.appendChild(qrBox);
    var copy = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Copia il link', onclick: function () {
      navigator.clipboard.writeText(url).then(function () { copy.textContent = 'Link copiato'; });
    } });
    var actions = el('div', { class: 'cta-row' }, [copy]);
    if (navigator.share) {
      actions.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Condividi…', onclick: function () {
        navigator.share({ title: 'Attiva il tuo accesso a Blooming', url: url }).catch(function () {});
      } }));
    }
    box.appendChild(actions);
    formDialog('Link di attivazione', [], {}, function () { return Promise.resolve(); }, { node: box, read: function () {} });
    $('[data-form-save]').textContent = 'Chiudi';
  }

  function userDialog(u) {
    var pros = [['', '— nessuno —']].concat(state.catalog.professionals.map(function (p) { return [p.id, p.name]; }));
    var specs = [
      { name: 'name', label: 'Nome', max: 80 },
      { name: 'role', label: 'Ruolo', type: 'select', options: [['professionista', 'Professionista (vede solo la sua agenda)'], ['admin', 'Amministratore (gestisce tutto)'], ['tecnico', 'Tecnico (sito, impostazioni in lettura, statistiche aggregate e registro; mai agende né dati delle persone)']] },
      { name: 'professionalId', label: 'Collegato al professionista (non per il ruolo tecnico)', type: 'select', options: pros },
      { name: 'canEditSite', label: 'Può modificare il sito (testi e immagini delle pagine; gli amministratori possono sempre)', type: 'checkbox' },
    ];
    if (!u) specs.splice(1, 0, { name: 'email', label: 'Email', type: 'email' });
    formDialog(u ? 'Modifica account' : 'Nuovo account', specs, u ? Object.assign({}, u, { canEditSite: u.canEditSite === true }) : { role: 'professionista', canEditSite: false }, function (v) {
      if (u) return api('PATCH', '/users/' + u.id, v).then(loadUsers);
      var canEdit = v.canEditSite;
      delete v.canEditSite;
      return api('POST', '/users', v).then(function (r) {
        return canEdit && r.id ? api('PATCH', '/users/' + r.id, { canEditSite: true }).then(function () { return r; }) : r;
      }).then(function (r) {
        loadUsers();
        setTimeout(function () { showInviteLink(v.name, r.inviteUrl); }, 50);
      });
    });
    $('[data-form-save]').textContent = u ? 'Salva' : 'Crea e genera il link';
  }

  function loadUsers() {
    return api('GET', '/users').then(function (res) {
      var box = $('[data-users]');
      box.textContent = '';
      res.users.forEach(function (u) {
        var status = !u.active ? 'disattivato' : (u.enrolled ? 'attivo' : (u.invitePending ? 'invito in attesa' : 'invito scaduto'));
        var actions = el('div', { class: 'cta-row' }, [
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Modifica', onclick: function () { userDialog(u); } }),
        ]);
        if (u.id !== state.me.user.id) {
          actions.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: u.enrolled ? 'Reimposta accesso' : 'Nuovo link', onclick: function () {
            if (u.enrolled && !window.confirm('Il vecchio accesso di ' + u.name + ' smetterà di funzionare. Continuare?')) return;
            api('POST', '/users/' + u.id + '/invite', {}).then(function (r) { loadUsers(); showInviteLink(u.name, r.inviteUrl); })
              .catch(function (e) { window.alert(e.message); });
          } }));
          if (u.calendarLink) actions.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Revoca il link del calendario', onclick: function () {
            if (!window.confirm('Il calendario sul telefono di ' + u.name + ' smetterà di aggiornarsi. Potrà crearne uno nuovo dal suo account. Continuare?')) return;
            api('POST', '/users/' + u.id + '/calendar/revoke', {}).then(function () { toast('Link del calendario revocato.'); loadUsers(); })
              .catch(function (e) { window.alert(e.message); });
          } }));
          actions.appendChild(el('button', { type: 'button', class: 'btn btn-danger btn-small', text: u.active ? 'Disattiva' : 'Riattiva', onclick: function () {
            api('PATCH', '/users/' + u.id, { active: !u.active }).then(loadUsers).catch(function (e) { window.alert(e.message); });
          } }));
        }
        box.appendChild(el('div', { class: 'row-card' + (u.active ? '' : ' inactive') }, [
          el('div', {}, [
            el('strong', { text: u.name }),
            el('p', { class: 'hint', text: u.email + ' · ' + (u.role === 'admin' ? 'amministratore' : (u.role === 'tecnico' ? 'tecnico' : 'professionista')) + (u.professionalName ? ' · ' + u.professionalName : '') + (u.role === 'professionista' && u.canEditSite ? ' · modifica il sito' : '') + (u.calendarLink ? ' · calendario sul telefono attivo' : '') + ' · ' + status }),
          ]),
          actions,
        ]));
      });
    });
  }
  $('[data-new-user]').addEventListener('click', function () { userDialog(null); });

  // ---------- settings ----------
  function loadSettings() {
    return api('GET', '/settings').then(function (res) {
      state.settings = res.settings;
      var f = $('[data-settings-form]');
      Object.keys(res.settings).forEach(function (k) { if (f.elements[k]) f.elements[k].value = res.settings[k]; });
      var wd = res.settings.approvalWorkdays || [1, 2, 3, 4, 5];
      $$('[data-workday]', f).forEach(function (c) { c.checked = wd.indexOf(Number(c.value)) !== -1; });
      // The technical role reads the settings only.
      var ro = A.isTech();
      $$('input', f).forEach(function (i) { i.disabled = ro; });
      $$('button[type="submit"]', f).forEach(function (b) { b.hidden = ro; });
      $('[data-settings-readonly]').hidden = !ro;
    });
  }
  $('[data-settings-form]').addEventListener('submit', function (e) {
    e.preventDefault();
    var status = $('[data-settings-status]');
    var s = {};
    $$('input', e.target).forEach(function (i) { if (i.name && i.value.trim() !== '') s[i.name] = i.type === 'time' ? i.value : Number(i.value); });
    s.approvalWorkdays = $$('[data-workday]', e.target).filter(function (c) { return c.checked; }).map(function (c) { return Number(c.value); });
    if (!s.approvalWorkdays.length) { status.className = 'status form-error'; status.textContent = 'Scegli almeno un giorno lavorativo.'; return; }
    api('PUT', '/settings', { settings: s }).then(function (res) {
      state.settings = res.settings;
      status.className = 'status form-ok';
      status.textContent = 'Impostazioni salvate.';
      toast('Impostazioni salvate.');
    }).catch(function (e2) { status.className = 'status form-error'; status.textContent = e2.message; });
  });
  // ---------- people's rights: find, export, erase one person's data ----------
  function saveJson(data, name) {
    var url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  $('[data-people-form]').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = e.target.email.value.trim();
    var status = $('[data-people-status]');
    var box = $('[data-people-result]');
    box.textContent = '';
    status.textContent = 'Ricerca…';
    api('GET', '/people?email=' + encodeURIComponent(email)).then(function (res) {
      status.textContent = '';
      var n = res.events.length + res.requests.length;
      if (!n) { box.appendChild(el('p', { class: 'hint', text: 'Nessun dato trovato per questa email.' })); return; }
      var list = el('ul', { class: 'plain-list' });
      res.events.forEach(function (ev) {
        list.appendChild(el('li', { text: 'Appuntamento ' + (ev.date || '') + ' ' + (ev.time || '') + ' · ' + (ev.professionalName || '') + ' · ' + (ev.status || '') }));
      });
      res.requests.forEach(function (r) {
        list.appendChild(el('li', { text: 'Richiesta del ' + new Date(r.createdAt).toLocaleDateString('it-IT') + ' · ' + (r.category || '') }));
      });
      box.appendChild(el('p', { text: n + (n === 1 ? ' elemento trovato.' : ' elementi trovati.') }));
      box.appendChild(list);
      box.appendChild(el('div', { class: 'cta-row' }, [
        el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Scarica i dati (per inviarli alla persona)', onclick: function () {
          saveJson(res, 'dati-' + email.replace(/[^a-z0-9]+/gi, '-') + '.json');
        } }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Cancella i recapiti di questa persona', onclick: function () {
          if (!window.confirm('Cancellare nome, email, telefono e messaggi di ' + email + '? Gli appuntamenti restano in agenda senza nome. L\'operazione non si può annullare.')) return;
          api('POST', '/people/forget', { email: email, confirm: true }).then(function (r2) {
            box.textContent = '';
            status.textContent = 'Cancellati: recapiti di ' + r2.events + ' appuntamenti e ' + r2.requests + ' richieste.';
            refresh();
          }).catch(function (e2) { status.textContent = e2.message; });
        } }),
      ]));
    }).catch(function (e2) { status.textContent = e2.message; });
  });
  $('[data-audit-load]').addEventListener('click', function () {
    var box = $('[data-audit]');
    api('GET', '/audit').then(function (res) {
      box.textContent = '';
      if (!res.entries.length) { box.appendChild(el('p', { class: 'hint', text: 'Il registro è vuoto.' })); return; }
      var list = el('ul', { class: 'plain-list' });
      res.entries.forEach(function (x) {
        list.appendChild(el('li', { text: new Date(x.at).toLocaleString('it-IT') + ' · ' + (x.user_name || 'account rimosso') + ' · ' + x.action + (x.detail ? ' (' + x.detail + ')' : '') }));
      });
      box.appendChild(list);
    }).catch(function (e2) { box.textContent = e2.message; });
  });

  $('[data-make-feed]').addEventListener('click', function () {
    api('POST', '/me/calendar', {}).then(function (r) {
      var c = $('[data-feed]');
      c.textContent = r.url;
      c.hidden = false;
    }).catch(function (e) { window.alert(e.message); });
  });

})(window.BloomingAdmin = window.BloomingAdmin || {});
