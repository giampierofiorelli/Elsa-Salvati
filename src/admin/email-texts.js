// Area riservata: Sito › Testi delle email. Elenco per momento, modifica per lingua, anteprima con dati di esempio.
// I testi originali stanno nel codice del sito; qui si salvano solo quelli personalizzati.
// Tutti i file dell'area condividono un solo oggetto: window.BloomingAdmin (A).
(function (A) {
  'use strict';
  var $ = A.$;
  var api = A.api;
  var el = A.el;
  var toast = A.toast;
  A.renderEmailTexts = render;

  var BLOCK = { dettagli: 1, tariffa: 1, link: 1, elenco: 1 };
  var et = { data: null, key: null, lang: 'it', drafts: {}, timer: null, seq: 0, valid: true };

  function box() { return $('[data-panel="email-testi"]'); }
  function byKey(k) { return et.data && et.data.emails.filter(function (e) { return e.key === k; })[0]; }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function render(arg) {
    var key = arg || null;
    var load = et.data && key ? Promise.resolve() : api('GET', '/email-texts').then(function (res) { et.data = res; });
    return load.then(function () {
      if (key && !byKey(key)) { location.replace('#/sito/email'); return; }
      if (key !== et.key) { et.drafts = {}; et.lang = 'it'; }
      et.key = key;
      if (key) editor(byKey(key)); else list();
    });
  }

  // ---------- status ----------
  function statusOf(e, lang) {
    var o = e.overrides[lang];
    if (!o) return { cls: 'pill-muted', text: 'originale' };
    if (!o.valid) return { cls: 'pill-late', text: 'personalizzato, non valido' };
    return { cls: 'pill-ok', text: 'personalizzato' };
  }
  function statusPills(e) {
    return el('span', { class: 'et-status' }, e.langs.map(function (l) {
      var s = statusOf(e, l);
      return el('span', { class: 'pill ' + s.cls, title: l === 'it' ? 'Italiano' : 'Inglese', text: l.toUpperCase() + ' · ' + s.text });
    }));
  }

  // ---------- list ----------
  function list() {
    var root = box();
    root.textContent = '';
    root.appendChild(el('p', { class: 'hint et-intro', text: 'Qui cambi il testo delle email automatiche, in italiano e in inglese. In fondo alle email alle persone il sito aggiunge sempre la riga sulle emergenze e la firma dello studio; l\'oggetto finisce sempre con «– Blooming». Se un testo personalizzato non va più bene, parte quello originale.' }));
    et.data.groups.forEach(function (g) {
      var items = et.data.emails.filter(function (e) { return e.group === g.key; });
      root.appendChild(el('h2', { class: 'et-group-h', text: g.label }));
      root.appendChild(el('ul', { class: 'rows et-list', role: 'list' }, items.map(function (e) {
        return el('li', {}, [el('a', { class: 'et-row', href: '#/sito/email/' + e.key }, [
          el('span', { class: 'et-row-main' }, [el('strong', { text: e.label }), el('small', { text: e.when })]),
          statusPills(e),
          el('span', { class: 'et-chev', 'aria-hidden': 'true', text: '›' }),
        ])]);
      })));
    });
  }

  // ---------- editor ----------
  function startText(e, lang) {
    var o = e.overrides[lang];
    return clone(o ? { subject: o.subject, body: o.body, button: o.button } : e.defaults[lang]);
  }
  function draft(e) {
    if (!et.drafts[et.lang]) et.drafts[et.lang] = startText(e, et.lang);
    return et.drafts[et.lang];
  }
  function dirty(e, lang) { return !!et.drafts[lang] && !same(et.drafts[lang], startText(e, lang)); }

  function editor(e) {
    var root = box();
    root.textContent = '';
    if (e.langs.indexOf(et.lang) < 0) et.lang = e.langs[0];
    var d = draft(e);
    var back = el('a', { class: 'et-back', href: '#/sito/email', text: '← Tutte le email', onclick: function (ev) {
      if (e.langs.some(function (l) { return dirty(e, l); }) && !window.confirm('Ci sono modifiche non salvate. Uscire lo stesso?')) ev.preventDefault();
    } });
    var head = el('div', { class: 'et-head' }, [
      back,
      el('h2', { text: e.label }),
      el('p', { class: 'hint', text: e.when + (e.audience === 'studio' ? ' Email alla professionista, solo in italiano: niente dati della persona.' : '') }),
    ]);
    root.appendChild(head);

    if (e.langs.length > 1) {
      root.appendChild(el('div', { class: 'seg et-langs', role: 'group', 'aria-label': 'Lingua' }, e.langs.map(function (l) {
        var s = statusOf(e, l);
        return el('button', { type: 'button', 'aria-pressed': String(l === et.lang), onclick: function () { if (l !== et.lang) { et.lang = l; editor(e); } } }, [
          el('span', { text: l === 'it' ? 'Italiano' : 'Inglese' }), el('span', { class: 'pill ' + s.cls, text: s.text }),
        ]);
      })));
    }

    // Subject
    var subject = el('input', { id: 'et-subject', type: 'text', maxlength: 100, value: d.subject, autocomplete: 'off' });
    subject.addEventListener('input', function () { d.subject = subject.value; changed(e); });
    var fSubject = el('div', { class: 'field' }, [
      el('label', { for: 'et-subject', text: 'Oggetto' }),
      el('div', { class: 'et-subject' }, [subject, el('span', { class: 'et-suffix', text: '– Blooming' })]),
      el('span', { class: 'hint', text: 'Resta neutro: niente nome, niente parole che rivelino di che studio si tratta.' + (e.vars.indexOf('tipo') >= 0 ? ' Puoi usare {tipo}.' : '') }),
    ]);

    // Body: bold and italic only, placeholders from the menu.
    var body = el('div', { class: 'rte-box et-body', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': 'et-body-label', spellcheck: 'true' });
    A.richToDom(d.body, body);
    function update() { d.body = { p: A.domToRuns(body, false) }; changed(e); }
    function cmd(name) { body.focus(); document.execCommand(name, false, null); update(); }
    var menu = el('div', { class: 'et-menu', role: 'menu', hidden: true }, e.vars.map(function (v) {
      return el('button', { type: 'button', role: 'menuitem', class: 'et-menu-item', onmousedown: function (ev) { ev.preventDefault(); }, onclick: function () { insert(v); } }, [
        el('code', { text: '{' + v + '}' }), el('span', { text: et.data.vars[v] + (BLOCK[v] ? ' (in un paragrafo a sé)' : '') }),
      ]);
    }));
    var menuBtn = el('button', { type: 'button', class: 'rte-btn et-menu-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', onmousedown: function (ev) { ev.preventDefault(); }, onclick: function () {
      var open = menu.hidden;
      menu.hidden = !open;
      menuBtn.setAttribute('aria-expanded', String(open));
    }, text: 'Inserisci segnaposto ▾' });
    function insert(v) {
      menu.hidden = true;
      menuBtn.setAttribute('aria-expanded', 'false');
      var sel = window.getSelection();
      if (!sel.rangeCount || !body.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        body.focus();
        var r = document.createRange();
        r.selectNodeContents(body);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      if (BLOCK[v]) {
        // A paragraph of its own, after the one with the cursor (or in place of an empty one).
        var node = sel.getRangeAt(0).startContainer;
        while (node && node.parentNode !== body) node = node.parentNode;
        var para = el('p', { text: '{' + v + '}' });
        if (node && node.nodeType === 1 && !node.textContent.trim()) body.replaceChild(para, node);
        else if (node && node.nextSibling) body.insertBefore(para, node.nextSibling);
        else body.appendChild(para);
        var after = document.createRange();
        after.selectNodeContents(para);
        after.collapse(false);
        sel.removeAllRanges();
        sel.addRange(after);
      } else document.execCommand('insertText', false, '{' + v + '}');
      update();
    }
    body.addEventListener('input', update);
    body.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && /^[uUkK]$/.test(ev.key)) ev.preventDefault(); // no underline, no links
    });
    body.addEventListener('paste', function (ev) {
      ev.preventDefault();
      var html = A.pastedHtml(ev, true);
      if (html) document.execCommand('insertHTML', false, html);
      Array.prototype.forEach.call(body.querySelectorAll('[style],[class],[color],[face]'), function (n) {
        n.removeAttribute('style'); n.removeAttribute('class'); n.removeAttribute('color'); n.removeAttribute('face');
      });
      Array.prototype.forEach.call(body.querySelectorAll('span,font,a'), function (n) {
        while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n);
        n.parentNode.removeChild(n);
      });
      update();
    });
    body.addEventListener('drop', function (ev) { ev.preventDefault(); });
    var bar = el('div', { class: 'rte-bar', role: 'toolbar', 'aria-label': 'Formato del testo' }, [
      el('button', { type: 'button', class: 'rte-btn', title: 'Grassetto (Ctrl/Cmd+B)', 'aria-label': 'Grassetto', onmousedown: function (ev) { ev.preventDefault(); }, onclick: function () { cmd('bold'); } }, [el('strong', { text: 'B' })]),
      el('button', { type: 'button', class: 'rte-btn', title: 'Corsivo (Ctrl/Cmd+I)', 'aria-label': 'Corsivo', onmousedown: function (ev) { ev.preventDefault(); }, onclick: function () { cmd('italic'); } }, [el('em', { text: 'I' })]),
      el('span', { class: 'et-menu-wrap' }, [menuBtn, menu]),
    ]);
    var need = e.required.map(function (v) { return '{' + v + '}'; });
    var fBody = el('div', { class: 'field' }, [
      el('span', { id: 'et-body-label', class: 'label', text: 'Testo' }),
      el('div', { class: 'rte' }, [bar, body]),
      el('span', { class: 'hint', text: 'Le parole tra graffe si riempiono da sole (nome, data, link…). Con l\'iniziale maiuscola, come {Professionista}, il valore inizia con la maiuscola.' + (need.length ? ' Obbligatori: ' + need.join(', ') + '.' : '') }),
    ]);

    // Button
    var fButton = null;
    if (e.link) {
      var button = el('input', { id: 'et-button', type: 'text', maxlength: 40, value: d.button, autocomplete: 'off' });
      button.addEventListener('input', function () { d.button = button.value; changed(e); });
      fButton = el('div', { class: 'field' }, [
        el('label', { for: 'et-button', text: 'Testo del pulsante' }), button,
        el('span', { class: 'hint', text: 'Il pulsante {link} porta a ' + e.linkHint + '. È l\'unico link dell\'email.' }),
      ]);
    }

    var err = el('p', { class: 'status form-error et-error', role: 'alert', 'data-et-error': '' });
    var o = e.overrides[et.lang];
    var state = el('p', { class: 'hint et-state', 'data-et-state': '' });
    var save = el('button', { type: 'button', class: 'btn btn-primary btn-small', 'data-et-save': '', text: 'Salva', onclick: function () { doSave(e); } });
    var reset = el('button', { type: 'button', class: 'btn btn-ghost btn-small', 'data-et-reset': '', text: 'Ripristina testo originale', onclick: function () { doReset(e); } });
    var form = el('div', { class: 'card et-form' }, [fSubject, fBody, fButton, err, el('div', { class: 'cta-row' }, [save, reset]), state]);

    var frame = el('iframe', { class: 'et-frame', title: 'Anteprima dell\'email', sandbox: 'allow-same-origin', 'data-et-frame': '' });
    var preview = el('div', { class: 'card et-preview' }, [
      el('h3', { class: 'et-preview-h', text: 'Anteprima con dati di esempio' }),
      el('p', { class: 'et-preview-subject' }, [el('span', { class: 'hint', text: 'Oggetto: ' }), el('strong', { 'data-et-psubject': '', text: '' })]),
      frame,
    ]);
    root.appendChild(el('div', { class: 'et-grid' }, [form, preview]));
    paintState(e);
    void o;
    changed(e, true);
  }

  function paintState(e) {
    var o = e.overrides[et.lang];
    var st = $('[data-et-state]');
    var parts = [];
    if (o) parts.push('Testo personalizzato' + (o.updatedBy ? ', modificato da ' + o.updatedBy : '') + (o.updatedAt ? ' il ' + fmtDate(o.updatedAt) : '') + '.');
    else parts.push('Testo originale.');
    if (o && !o.valid) parts.push('Il testo salvato non passa più i controlli: finché non lo correggi, parte quello originale.');
    if (dirty(e, et.lang)) parts.push('Modifiche non salvate.');
    st.textContent = parts.join(' ');
    $('[data-et-reset]').disabled = !o && !dirty(e, et.lang);
    $('[data-et-save]').disabled = !et.valid || !dirty(e, et.lang);
  }

  // Live preview from the server (same checks and rendering as the real emails).
  function changed(e, now) {
    clearTimeout(et.timer);
    paintState(e);
    et.timer = setTimeout(function () { preview(e); }, now ? 0 : 300);
  }
  function preview(e) {
    var d = draft(e);
    var n = ++et.seq;
    api('POST', '/email-texts/preview', { key: e.key, lang: et.lang, subject: d.subject, body: d.body, button: d.button }).then(function (res) {
      if (n !== et.seq || !$('[data-et-frame]')) return;
      et.valid = !!res.ok;
      $('[data-et-error]').textContent = res.ok ? '' : res.error;
      if (res.ok) {
        $('[data-et-psubject]').textContent = res.subject;
        var frame = $('[data-et-frame]');
        frame.onload = function () {
          try { frame.style.height = Math.max(200, frame.contentDocument.documentElement.scrollHeight + 8) + 'px'; } catch (x) { /* sizing is a nicety */ }
        };
        frame.srcdoc = '<!doctype html><meta charset="utf-8"><style>body{margin:16px;background:#fff}</style>' + res.html;
      }
      paintState(e);
    }).catch(function () {});
  }

  function reload(e) {
    return api('GET', '/email-texts').then(function (res) {
      et.data = res;
      var fresh = byKey(e.key);
      delete et.drafts[et.lang];
      editor(fresh);
    });
  }
  function doSave(e) {
    var d = draft(e);
    $('[data-et-save]').disabled = true;
    api('PUT', '/email-texts/' + e.key + '/' + et.lang, d).then(function () {
      toast('Testo salvato: le prossime email useranno questo.');
      return reload(e);
    }).catch(function (err) {
      $('[data-et-error]').textContent = (err && err.message) || 'Non è stato possibile salvare.';
      paintState(e);
    });
  }
  function doReset(e) {
    var o = e.overrides[et.lang];
    if (!o) { delete et.drafts[et.lang]; editor(e); return; }
    if (!window.confirm('Ripristinare il testo originale? Il testo personalizzato in ' + (et.lang === 'it' ? 'italiano' : 'inglese') + ' si perde.')) return;
    api('DELETE', '/email-texts/' + e.key + '/' + et.lang).then(function () {
      toast('Ripristinato il testo originale.');
      return reload(e);
    }).catch(function () {});
  }
})(window.BloomingAdmin);
