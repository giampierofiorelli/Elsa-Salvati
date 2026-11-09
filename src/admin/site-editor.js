// Area riservata: editor del sito (pagine, intestazione e piè di pagina, dati dello studio, immagini).
// Tutti i file dell'area condividono un solo oggetto: window.BloomingAdmin (A).
(function (A) {
  'use strict';
  // dai file caricati prima
  var $ = A.$;
  var $$ = A.$$;
  var api = A.api;
  var el = A.el;
  var icon = A.icon;
  var routeKey = A.routeKey;
  var showPanel = A.showPanel;
  var state = A.state;
  // usati da altri file
  A.closePicker = closePicker;
  A.enterEditor = enterEditor;
  A.flushSave = flushSave;
  // shared with email-texts.js (same rich text rules)
  A.richToDom = function (v, b) { return richToDom(v, b); };
  A.domToRuns = function (r, k) { return domToRuns(r, k); };
  A.pastedHtml = function (e, m) { return pastedHtml(e, m); };

  // =====================================================================
  // ---------- page editor ("Sito") ----------
  // Pages are lists of blocks. Every change is saved as a draft after a short pause;
  // "Pubblica" puts the draft online. Text is kept as data (bold, italic, links only).
  // =====================================================================
  var PAGE_NAMES = {
    index: 'Home', servizi: 'Come possiamo aiutarti', lavoro: 'Orientamento e carriera', coaching: 'Coaching',
    sostegno: 'Sostegno psicologico', psicoterapia: 'Psicoterapia', differenze: 'Le differenze', team: 'Team',
    'costi-e-faq': 'Tariffe e prenotazioni', aziende: 'Aziende', contatti: 'Contatti', prenota: 'Prenotazione',
    privacy: 'Privacy', cookie: 'Cookie', accessibilita: 'Accessibilità',
  };
  var PAGE_ORDER = ['index', 'servizi', 'lavoro', 'coaching', 'sostegno', 'psicoterapia', 'differenze', 'team', 'costi-e-faq', 'aziende', 'contatti', 'prenota'];
  var BG_LABEL = { light: 'Chiaro', soft: 'Tenue (menta)', dark: 'Scuro' };
  var STYLE_LABEL = { primary: 'Principale', ghost: 'Secondario', light: 'Chiaro (su fondo scuro)', 'outline-light': 'Bordato (su fondo scuro)' };
  var KIND_NAMES = { p: 'Paragrafo', lead: 'Paragrafo in evidenza', stat: 'Dato con fonte', arrow: 'Link con freccia' };
  var VERSION_KIND = { pubblicazione: 'Pubblicata', ripristino: 'Ripristino', iniziale: 'Versione iniziale' };
  var LANG_NAME = { it: 'Italiano', en: 'Inglese' };

  var se = {
    pages: [], page: null, draft: null, expected: null, library: {}, linkTargets: [], pros: [],
    selected: -1, dirty: false, saving: false, again: false, timer: null, previewTimer: null,
    device: 'desktop', refOpen: false, refPage: null, loaded: false, tab: 'blocks',
    // Header, footer and studio details ("globals"): mode 'global', scope it | en | studio.
    mode: 'page', globals: null, gscope: null, gdata: null, gexpected: null, gpreview: null,
    // Editor v2: what is selected inside the block ('' = the block; 'items.2' = an item; 'items.2.title' = a field)
    // and the text being typed on the page, if any.
    sel: { path: '' }, inline: null,
  };
  var GLOBAL_NAMES = { it: 'Intestazione e piè di pagina', en: 'Intestazione e piè di pagina', studio: 'Dati dello studio' };

  function pageName(key) { return PAGE_NAMES[key] || key; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function timeNow() { return new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
  function pathOf(key, lang) {
    var p = se.pages.find(function (x) { return x.key === key && x.lang === lang; });
    return p ? p.path : null;
  }
  function safeHref(h) {
    return typeof h === 'string' && (/^\/media\/[a-f0-9]{24}\.pdf$/.test(h) || /^\/(?!\/)[a-z0-9\-/]*(#[a-z0-9-]+)?(\?[a-z0-9=&_-]+)?$/i.test(h) || /^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(h) || /^mailto:[^\s<>"'?&]+@/i.test(h) || /^tel:\+?[0-9 ]{6,20}$/.test(h));
  }
  function isExternalOk(h) { return /^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(\/[^\s<>"']*)?$/i.test(h) || /^mailto:[^\s<>"'?&]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(h) || /^tel:\+?[0-9 ]{6,20}$/.test(h); }

  // ---------- rich text: editable DOM <-> { p: [[{ t, b, i, href }]] } ----------
  function richToDom(value, box) {
    box.textContent = '';
    var paras = value && value.p && value.p.length ? value.p : [[]];
    paras.forEach(function (para) {
      var p = el('p');
      para.forEach(function (r) {
        var node = document.createTextNode(r.t);
        if (r.i) { var em = el('em'); em.appendChild(node); node = em; }
        if (r.b) { var st = el('strong'); st.appendChild(node); node = st; }
        if (r.href && safeHref(r.href)) { var a = el('a', { href: r.href }); a.appendChild(node); node = a; }
        p.appendChild(node);
      });
      if (!p.childNodes.length) p.appendChild(el('br'));
      box.appendChild(p);
    });
  }

  function isBoldEl(n) {
    if (n.nodeName === 'B' || n.nodeName === 'STRONG') return true;
    var w = n.style && n.style.fontWeight;
    return w === 'bold' || w === 'bolder' || Number(w) >= 600;
  }
  function isItalicEl(n) { return n.nodeName === 'I' || n.nodeName === 'EM' || (n.style && n.style.fontStyle === 'italic'); }
  var BLOCK_TAGS = { P: 1, DIV: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, BLOCKQUOTE: 1, TR: 1, SECTION: 1, ARTICLE: 1, UL: 1, OL: 1, TABLE: 1 };

  // Walks any DOM (the editor's, or pasted HTML) and keeps only text with bold, italic and, if asked, links.
  function domToRuns(root, keepLinks) {
    var paras = [[]];
    function br() { if (paras[paras.length - 1].length) paras.push([]); }
    function walk(n, fmt) {
      if (n.nodeType === 3) {
        var t = n.nodeValue.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ');
        if (t) {
          var r = { t: t };
          if (fmt.b) r.b = true;
          if (fmt.i) r.i = true;
          if (fmt.href) r.href = fmt.href;
          paras[paras.length - 1].push(r);
        }
        return;
      }
      if (n.nodeType !== 1) return;
      var tag = n.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'HEAD' || tag === 'META' || tag === 'TITLE' || tag === 'IMG' || tag === 'SVG' || tag === 'IFRAME' || tag === 'OBJECT') return;
      if (tag === 'BR') { br(); return; }
      var f = { b: fmt.b || isBoldEl(n), i: fmt.i || isItalicEl(n), href: fmt.href };
      if (keepLinks && tag === 'A') { var h = n.getAttribute('href'); if (safeHref(h)) f.href = h; }
      var block = BLOCK_TAGS[tag];
      if (block) br();
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c, f);
      if (block) br();
    }
    walk(root, {});
    // Merge runs with the same format, trim each paragraph, drop empty ones.
    return paras.map(function (para) {
      var out = [];
      para.forEach(function (r) {
        var prev = out[out.length - 1];
        if (prev && !!prev.b === !!r.b && !!prev.i === !!r.i && prev.href === r.href) prev.t += r.t;
        else out.push(Object.assign({}, r));
      });
      if (out.length) { out[0].t = out[0].t.replace(/^ /, ''); out[out.length - 1].t = out[out.length - 1].t.replace(/ $/, ''); }
      return out.filter(function (r) { return r.t; });
    }).filter(function (p) { return p.length; });
  }

  function escText(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Paste: only the text, with bold and italic. Links, styles, images and scripts are dropped.
  function pastedHtml(e, multiline) {
    var cd = e.clipboardData || window.clipboardData;
    if (!cd) return null;
    var html = cd.getData('text/html');
    var paras;
    if (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      paras = domToRuns(doc.body, false);
    } else {
      paras = String(cd.getData('text/plain') || '').split(/\r?\n/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
        .filter(Boolean).map(function (t) { return [{ t: t }]; });
    }
    var parts = paras.map(function (para) {
      return para.map(function (r) {
        var s = escText(r.t);
        if (r.i) s = '<i>' + s + '</i>';
        if (r.b) s = '<b>' + s + '</b>';
        return s;
      }).join('');
    });
    return parts.join(multiline ? '<br>' : ' ');
  }

  var savedRange = null;
  function rememberSelection(box) {
    var sel = window.getSelection();
    if (sel.rangeCount && box.contains(sel.getRangeAt(0).commonAncestorContainer)) savedRange = sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection() {
    if (!savedRange) return;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  function richEditor(value, opts, onChange) {
    var multiline = opts.multiline !== false;
    var box = el('div', { class: 'rte-box', contenteditable: 'true', role: 'textbox', 'aria-multiline': multiline ? 'true' : 'false', 'aria-label': opts.label || 'Testo', spellcheck: 'true' });
    richToDom(value, box);
    var counter = opts.max ? el('span', { class: 'se-count' }) : null;
    function update() {
      var model = { p: domToRuns(box, true) };
      if (!multiline && model.p.length > 1) model.p = [model.p.reduce(function (a, p) { return a.concat(a.length ? [{ t: ' ' }] : [], p); }, [])];
      if (counter) {
        var n = model.p.reduce(function (s, p) { return s + p.reduce(function (t, r) { return t + r.t.length; }, 0); }, 0);
        counter.textContent = n + ' / ' + opts.max;
        counter.classList.toggle('over', n > opts.max);
      }
      onChange(model);
    }
    function cmd(name, arg) { box.focus(); restoreSelection(); document.execCommand(name, false, arg); update(); }
    function link() {
      rememberSelection(box);
      var sel = window.getSelection();
      if (!savedRange || savedRange.collapsed) { window.alert('Seleziona prima le parole da trasformare in link.'); return; }
      linkDialog(function (href) { cmd('createLink', href); });
      void sel;
    }
    var bar = el('div', { class: 'rte-bar', role: 'toolbar', 'aria-label': 'Formato del testo' }, [
      el('button', { type: 'button', class: 'rte-btn', title: 'Grassetto (Ctrl/Cmd+B)', 'aria-label': 'Grassetto', onmousedown: function (e) { e.preventDefault(); }, onclick: function () { cmd('bold'); } }, [el('strong', { text: 'B' })]),
      el('button', { type: 'button', class: 'rte-btn', title: 'Corsivo (Ctrl/Cmd+I)', 'aria-label': 'Corsivo', onmousedown: function (e) { e.preventDefault(); }, onclick: function () { cmd('italic'); } }, [el('em', { text: 'I' })]),
      el('button', { type: 'button', class: 'rte-btn', title: 'Link (Ctrl/Cmd+K)', 'aria-label': 'Aggiungi link', onmousedown: function (e) { e.preventDefault(); }, onclick: link, text: 'Link' }),
      el('button', { type: 'button', class: 'rte-btn', title: 'Togli il link', 'aria-label': 'Togli il link', onmousedown: function (e) { e.preventDefault(); }, onclick: function () { cmd('unlink'); }, text: 'Togli link' }),
    ]);
    box.addEventListener('input', update);
    box.addEventListener('keyup', function () { rememberSelection(box); });
    box.addEventListener('mouseup', function () { rememberSelection(box); });
    box.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); link(); }
      if (e.key === 'Enter' && !multiline) e.preventDefault();
      if (mod && /^[uU]$/.test(e.key)) e.preventDefault(); // no underline
    });
    box.addEventListener('paste', function (e) {
      e.preventDefault();
      var html = pastedHtml(e, multiline);
      if (html) document.execCommand('insertHTML', false, html);
      // The browser may add inline styles while inserting: remove them so only bold and italic stay.
      Array.prototype.forEach.call(box.querySelectorAll('[style],[class],[color],[face]'), function (n) {
        n.removeAttribute('style'); n.removeAttribute('class'); n.removeAttribute('color'); n.removeAttribute('face');
      });
      Array.prototype.forEach.call(box.querySelectorAll('span,font'), function (n) {
        while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n);
        n.parentNode.removeChild(n);
      });
      update();
    });
    box.addEventListener('drop', function (e) { e.preventDefault(); });
    if (counter) { var n0 = (value && value.p || []).reduce(function (s, p) { return s + p.reduce(function (t, r) { return t + r.t.length; }, 0); }, 0); counter.textContent = n0 + ' / ' + opts.max; }
    return el('div', { class: 'rte' }, [bar, box, counter]);
  }

  // Language of what is open: header/footer use their scope (studio data counts as Italian), pages their own.
  function editLang() {
    if (se.mode === 'global') return se.gscope === 'en' ? 'en' : 'it';
    return se.page ? se.page.lang : 'it';
  }

  // Link inside a text: a page of the site (same tab) or an outside address (new tab, decided by the site).
  function linkDialog(onPick) {
    var lang = editLang();
    var own = se.pages.filter(function (p) { return p.lang === lang; });
    var dlg = el('dialog', { class: 'dlg' });
    var sel = el('select', { id: 'ld-page' }, own.map(function (p) { return el('option', { value: p.path, text: pageName(p.key) + ' (' + p.path + ')' }); }));
    var url = el('input', { id: 'ld-url', type: 'url', placeholder: 'https://…', maxlength: 500 });
    var kindPage = el('input', { type: 'radio', name: 'ld-kind', value: 'page', checked: true });
    var kindUrl = el('input', { type: 'radio', name: 'ld-kind', value: 'url' });
    var kindPdf = el('input', { type: 'radio', name: 'ld-kind', value: 'pdf' });
    var pdfSel = el('select', { id: 'ld-pdf' }, [el('option', { value: '', text: 'Carico i PDF della libreria…' })]);
    api('GET', '/site/media').then(function (res) {
      var pdfs = res.media.filter(function (m) { return m.kind === 'pdf'; });
      pdfSel.textContent = '';
      if (!pdfs.length) { pdfSel.appendChild(el('option', { value: '', text: 'Nessun PDF: caricali da «Media»' })); return; }
      pdfs.forEach(function (m) { pdfSel.appendChild(el('option', { value: m.url, text: m.name + ' (' + kb(m.bytes) + ')' })); });
    }).catch(function () { pdfSel.textContent = ''; pdfSel.appendChild(el('option', { value: '', text: 'Libreria non disponibile' })); });
    var err = el('p', { class: 'status form-error', role: 'alert' });
    var form = el('form', { class: 'dlg-inner', method: 'dialog' }, [
      el('div', { class: 'dlg-head' }, [el('h2', { text: 'Aggiungi un link' })]),
      el('label', { class: 'check' }, [kindPage, el('span', { text: 'Pagina del sito (si apre nella stessa scheda)' })]),
      el('div', { class: 'field' }, [el('label', { for: 'ld-page', text: 'Pagina' }), sel]),
      el('label', { class: 'check' }, [kindUrl, el('span', { text: 'Indirizzo esterno (si apre in una nuova scheda)' })]),
      el('div', { class: 'field' }, [el('label', { for: 'ld-url', text: 'Indirizzo (https://…, mailto:… o tel:…)' }), url]),
      el('label', { class: 'check' }, [kindPdf, el('span', { text: 'Documento PDF della libreria (si apre in una nuova scheda)' })]),
      el('div', { class: 'field' }, [el('label', { for: 'ld-pdf', text: 'Documento' }), pdfSel]),
      err,
      el('div', { class: 'cta-row dlg-actions' }, [
        el('button', { type: 'submit', class: 'btn btn-primary btn-small', text: 'Aggiungi' }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Annulla', onclick: function () { dlg.close(); } }),
      ]),
    ]);
    url.addEventListener('focus', function () { kindUrl.checked = true; });
    sel.addEventListener('focus', function () { kindPage.checked = true; });
    pdfSel.addEventListener('focus', function () { kindPdf.checked = true; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var href;
      if (kindUrl.checked) {
        href = url.value.trim();
        if (/^www\./i.test(href)) href = 'https://' + href;
        if (!isExternalOk(href)) { err.textContent = 'Scrivi un indirizzo completo, che inizi con https://, mailto: o tel:'; return; }
      } else if (kindPdf.checked) {
        href = pdfSel.value;
        if (!/^\/media\/[a-f0-9]{24}\.pdf$/.test(href)) { err.textContent = 'Scegli un PDF dalla libreria.'; return; }
      } else href = sel.value;
      dlg.close();
      onPick(href);
    });
    dlg.appendChild(form);
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- small form pieces ----------
  var uid = 0;
  function nextId() { uid += 1; return 'se-' + uid; }

  function textInput(label, value, max, onChange, opts) {
    opts = opts || {};
    var id = nextId();
    var input = el(opts.area ? 'textarea' : 'input', { id: id, type: opts.area ? null : (opts.type || 'text'), maxlength: max || 200, rows: opts.area ? 3 : null, placeholder: opts.placeholder || null });
    input.value = value || '';
    var counter = max ? el('span', { class: 'se-count' }) : null;
    function count() {
      if (!counter) return;
      var n = input.value.length;
      counter.textContent = n + ' / ' + (opts.recommended ? opts.recommended + ' consigliati' : max);
      counter.classList.toggle('over', opts.recommended ? n > opts.recommended : n >= max);
    }
    count();
    input.addEventListener('input', function () { count(); onChange(input.value); });
    return el('div', { class: 'field se-field' }, [el('label', { for: id, text: label + (opts.required ? ' *' : '') }), input, counter, opts.hint ? el('span', { class: 'hint', text: opts.hint }) : null]);
  }

  function selectInput(label, options, value, onChange) {
    var id = nextId();
    var s = el('select', { id: id }, options.map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    s.value = value;
    if (s.value !== value && options[0]) s.value = options[0][0];
    s.addEventListener('change', function () { onChange(s.value); });
    return el('div', { class: 'field se-field' }, [el('label', { for: id, text: label }), s]);
  }

  function checkInput(label, value, onChange) {
    var c = el('input', { type: 'checkbox' });
    c.checked = !!value;
    c.addEventListener('change', function () { onChange(c.checked); });
    return el('label', { class: 'check se-check' }, [c, el('span', { text: label })]);
  }

  function moveItem(arr, i, d) {
    var j = i + d;
    if (j < 0 || j >= arr.length) return false;
    var x = arr[i]; arr[i] = arr[j]; arr[j] = x;
    return true;
  }

  function itemTools(arr, i, rerender, opts) {
    opts = opts || {};
    var label = opts.label || 'voce';
    return el('div', { class: 'se-tools' }, [
      el('button', { type: 'button', class: 'se-icon', 'aria-label': 'Sposta su ' + label + ' ' + (i + 1), title: 'Sposta su', disabled: i === 0, onclick: function () { if (moveItem(arr, i, -1)) { changed(); rerender(); } }, text: '↑' }),
      el('button', { type: 'button', class: 'se-icon', 'aria-label': 'Sposta giù ' + label + ' ' + (i + 1), title: 'Sposta giù', disabled: i === arr.length - 1, onclick: function () { if (moveItem(arr, i, 1)) { changed(); rerender(); } }, text: '↓' }),
      opts.noRemove ? null : el('button', { type: 'button', class: 'se-icon se-danger', 'aria-label': 'Elimina ' + label + ' ' + (i + 1), title: 'Elimina', onclick: function () {
        if (opts.min !== undefined && arr.length <= opts.min) { window.alert('Servono almeno ' + opts.min + ' elementi.'); return; }
        if (!window.confirm('Eliminare questo elemento?')) return;
        arr.splice(i, 1); changed(); rerender();
      }, text: '✕' }),
    ]);
  }

  // Where a button or link goes: page of the site, place in this page, booking, outside address.
  function targetEditor(to, onChange) {
    to = to || { kind: 'page', key: '' };
    var wrap = el('div', { class: 'se-target' });
    function render() {
      wrap.textContent = '';
      var isPdf = to.kind === 'url' && /^\/media\/[a-f0-9]{24}\.pdf$/.test(to.href || '');
      wrap.appendChild(selectInput('Destinazione', [['page', 'Pagina del sito'], ['anchor', 'Punto di questa pagina'], ['book', 'Prenotazione'], ['url', 'Indirizzo esterno'], ['pdf', 'Documento PDF della libreria']], isPdf ? 'pdf' : to.kind, function (k) {
        if (k === 'pdf') { pickMedia({ kind: 'pdf' }, function (m) { to = { kind: 'url', href: m.url }; onChange(to); render(); }); return; }
        to = k === 'page' ? { kind: 'page', key: (se.linkTargets[0] || {}).key || '' } : k === 'anchor' ? { kind: 'anchor', anchor: '' } : k === 'book' ? { kind: 'book' } : { kind: 'url', href: 'https://' };
        onChange(to); render();
      }));
      if (to.kind === 'page') {
        var lang = editLang();
        var opts = se.linkTargets.map(function (t) {
          var here = t[lang];
          return [t.key, pageName(t.key) + (here ? '' : ' (manca in ' + (lang === 'en' ? 'inglese' : 'italiano') + ')')];
        });
        if (to.key && !opts.some(function (o) { return o[0] === to.key; })) opts.push([to.key, to.key]);
        wrap.appendChild(selectInput('Pagina', opts, to.key, function (v) { to.key = v; onChange(to); }));
        wrap.appendChild(textInput('Punto della pagina (facoltativo, es. come-funziona)', to.anchor || '', 40, function (v) {
          v = v.trim().replace(/^#/, ''); if (v) to.anchor = v; else delete to.anchor; onChange(to);
        }));
      } else if (to.kind === 'anchor') {
        wrap.appendChild(textInput('Nome del punto (es. contatto)', to.anchor || '', 40, function (v) { to.anchor = v.trim().replace(/^#/, ''); onChange(to); }));
      } else if (to.kind === 'book') {
        wrap.appendChild(selectInput('Con la professionista già scelta', [['', 'Nessuna (sceglie chi prenota)']].concat(se.pros.map(function (p) { return [p.slug, p.name]; })), to.pro || '', function (v) {
          if (v) to.pro = v; else delete to.pro; onChange(to);
        }));
        // Opens the booking on an area without naming anyone (works in both first-meeting modes).
        wrap.appendChild(selectInput('Con l\'area già scelta (se non c\'è una professionista)', [['', 'Nessuna'], ['carriera', 'Orientamento e carriera'], ['coaching', 'Coaching'], ['psicologia', 'Sostegno psicologico'], ['psicoterapia', 'Psicoterapia'], ['aziende', 'Per la tua organizzazione'], ['da-scegliere', 'Non lo so ancora']], to.area || '', function (v) {
          if (v) to.area = v; else delete to.area; onChange(to);
        }));
      } else if (isPdf) {
        wrap.appendChild(el('p', { class: 'hint', text: 'Documento: ' + to.href + ' (si apre in una nuova scheda).' }));
        wrap.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Scegli un altro PDF', onclick: function () { pickMedia({ kind: 'pdf' }, function (m) { to = { kind: 'url', href: m.url }; onChange(to); render(); }); } }));
      } else {
        var hint = el('span', { class: 'hint' });
        var f = textInput('Indirizzo (si apre in una nuova scheda)', to.href || '', 500, function (v) {
          to.href = v.trim(); hint.textContent = isExternalOk(to.href) ? '' : 'Deve iniziare con https://, mailto: o tel:'; onChange(to);
        }, { type: 'url' });
        f.appendChild(hint);
        wrap.appendChild(f);
      }
    }
    render();
    return wrap;
  }

  // A link or a button. Optional ones can be switched off.
  function linkEditor(value, opts, onChange) {
    var box = el('div', { class: 'se-link' });
    function render() {
      box.textContent = '';
      if (opts.optional) {
        box.appendChild(checkInput(opts.label, !!value, function (on) {
          value = on ? { label: '', to: { kind: 'page', key: (se.linkTargets[0] || {}).key || '' } } : null;
          if (value && opts.styles) value.style = opts.styles[0];
          onChange(value); render();
        }));
        if (!value) return;
      } else if (opts.label) box.appendChild(el('p', { class: 'se-sub', text: opts.label }));
      box.appendChild(textInput('Testo', value.label, 120, function (v) { value.label = v; onChange(value); }, { required: true }));
      box.appendChild(targetEditor(value.to, function (to) { value.to = to; onChange(value); }));
      if (opts.styles && opts.styles.length > 1) {
        box.appendChild(selectInput('Stile', opts.styles.map(function (s) { return [s, STYLE_LABEL[s] || s]; }), value.style || opts.styles[0], function (s) { value.style = s; onChange(value); }));
      }
    }
    render();
    return box;
  }

  function listEditor(arr, opts, renderItem) {
    var box = el('div', { class: 'se-list' });
    function render() {
      box.textContent = '';
      arr.forEach(function (item, i) {
        var card = el('div', { class: 'se-item' }, [
          el('div', { class: 'se-item-head' }, [el('strong', { text: (opts.itemLabel || 'Voce') + ' ' + (i + 1) }), itemTools(arr, i, render, { label: (opts.itemLabel || 'voce').toLowerCase(), min: opts.min })]),
        ]);
        card.appendChild(renderItem(item, i, function (v) { arr[i] = v; }));
        box.appendChild(card);
      });
      if (arr.length < (opts.max || 12)) {
        box.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small se-add', text: '+ Aggiungi ' + (opts.itemLabel || 'voce').toLowerCase(), onclick: function () { arr.push(opts.make()); changed(); render(); } }));
      }
    }
    render();
    return box;
  }

  // ---------- default values for new blocks and items ----------
  function emptyValue(f) {
    switch (f.type) {
      case 'text': return f.required ? 'Testo da scrivere' : '';
      case 'note': case 'anchor': return '';
      case 'rich': return f.required ? { p: [[{ t: 'Testo da scrivere' }]] } : { p: [] };
      case 'flow': case 'links': case 'buttons': case 'textlist': return [];
      case 'select': return f.options[0][0];
      case 'bool': return false;
      case 'link': case 'button': case 'image': return null;
      case 'list': { var out = []; for (var i = 0; i < (f.min || 0); i++) out.push(emptyData(f.fields)); return out; }
      default: return null;
    }
  }
  function emptyData(fields) { var d = {}; fields.forEach(function (f) { d[f.name] = emptyValue(f); }); return d; }

  // ---------- media: photos converted in the browser (the original never leaves the computer) ----------
  // Research 20: WebP q 0.80 + JPEG q 0.82; widths per use; never wider than the photo itself.
  var ROLE_WIDTHS = { content: [480, 800, 1200], wide: [640, 960, 1280, 1920, 2560] };
  var ROLE_FALLBACK = { content: 800, wide: 1280 };
  var ROLE_NAMES = { content: 'Foto o immagine nel testo', wide: 'Immagine a tutta larghezza', social: 'Immagine per i social' };
  var WEBP_Q = 0.80;
  var JPEG_Q = 0.82;
  var MAX_INPUT = 40 * 1024 * 1024;
  // Test switch: ?webp=wasm forces the WebAssembly encoder (what Safari uses).
  var FORCE_WASM = /[?&]webp=wasm\b/.test(location.search);

  /** Thumbnail URL of an image value stored in a block (library, older uploads, files in /assets/img). */
  function thumbUrl(v) {
    if (!v || !v.id) return '';
    if (v.id.indexOf('static-') === 0) return '/assets/img/' + v.id.slice(7) + '-480.webp';
    if (v.social) return '/media/' + v.id + '-1200x630.jpg';
    if (v.variants && v.variants.length) return '/media/' + v.id + '-' + v.variants[0] + '.' + (v.format === 'jpg' ? 'jpg' : 'webp');
    return '/media/' + v.id + '-480.webp';
  }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  // Decode the photo with the right rotation (EXIF). Big phone photos are reduced right away to the widest
  // version needed (sizes depend on the width), so the browser never holds the full 12–48 MP picture.
  function decodePhoto(file, maxWidth) {
    if (!window.createImageBitmap) return Promise.reject(new Error('Questo browser è troppo vecchio per preparare le foto. Aggiornalo e riprova.'));
    return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
      if (bmp.width <= maxWidth) return bmp;
      var k = maxWidth / bmp.width;
      var opts = { imageOrientation: 'from-image', resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' };
      bmp.close && bmp.close();
      return createImageBitmap(file, opts);
    }).catch(function () {
      throw new Error('Non riesco ad aprire questa foto. Se viene dall\'iPhone (HEIC), esportala in JPG e riprova.');
    });
  }

  // Resize with good quality everywhere: halve step by step, then draw at the final size.
  function drawScaled(src, sx, sy, sw, sh, w, h, jpeg) {
    var cur = src; var cx = sx; var cy = sy; var cw = sw; var ch = sh;
    while (cw / 2 >= w && ch / 2 >= h) {
      var half = document.createElement('canvas');
      half.width = Math.round(cw / 2); half.height = Math.round(ch / 2);
      var hc = half.getContext('2d');
      hc.imageSmoothingEnabled = true; hc.imageSmoothingQuality = 'high';
      hc.drawImage(cur, cx, cy, cw, ch, 0, 0, half.width, half.height);
      cur = half; cx = 0; cy = 0; cw = half.width; ch = half.height;
    }
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (jpeg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(cur, cx, cy, cw, ch, 0, 0, w, h);
    return c;
  }

  function toBlob(canvas, type, q) {
    return new Promise(function (resolve) { canvas.toBlob(function (b) { resolve(b); }, type, q); });
  }
  function blobToBase64(b) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1]); };
      fr.onerror = function () { reject(new Error('Lettura del file non riuscita')); };
      fr.readAsDataURL(b);
    });
  }

  // WebP: the browser's own encoder when it really makes WebP; otherwise libwebp in a worker (Safari).
  var nativeWebp = null;
  function canNativeWebp() {
    if (FORCE_WASM) return Promise.resolve(false);
    if (nativeWebp !== null) return Promise.resolve(nativeWebp);
    var c = document.createElement('canvas'); c.width = 2; c.height = 2;
    return toBlob(c, 'image/webp', 0.8).then(function (b) { nativeWebp = !!(b && b.type === 'image/webp'); return nativeWebp; });
  }
  var worker = null; var jobs = {}; var jobId = 0;
  function wasmWebp(canvas, q) {
    return new Promise(function (resolve, reject) {
      try {
        if (!worker) {
          worker = new Worker('/admin/vendor/jsquash/webp-worker.js', { type: 'module' });
          worker.onmessage = function (e) {
            var j = jobs[e.data.id]; delete jobs[e.data.id];
            if (!j) return;
            if (e.data.error) j.reject(new Error(e.data.error)); else j.resolve(new Blob([e.data.buffer], { type: 'image/webp' }));
          };
          worker.onerror = function (e) {
            Object.keys(jobs).forEach(function (k) { jobs[k].reject(new Error(e.message || 'convertitore non disponibile')); delete jobs[k]; });
            worker = null;
          };
        }
        var img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        jobId += 1;
        jobs[jobId] = { resolve: resolve, reject: reject };
        worker.postMessage({ id: jobId, data: img.data, width: img.width, height: img.height, quality: q * 100 }, [img.data.buffer]);
      } catch (err) { reject(err); }
    });
  }
  function encodeWebp(canvas, q) {
    return canNativeWebp().then(function (ok) {
      if (ok) return toBlob(canvas, 'image/webp', q).then(function (b) { if (b && b.type === 'image/webp') return b; return wasmWebp(canvas, q); });
      return wasmWebp(canvas, q);
    });
  }
  // A version over 1.4 MB is encoded again a little lighter.
  function encodeFit(canvas, type, q) {
    var job = type === 'image/webp' ? encodeWebp(canvas, q) : toBlob(canvas, 'image/jpeg', q);
    return job.then(function (b) {
      if (!b) throw new Error('Preparazione della foto non riuscita');
      if (b.size > 1400000 && q > 0.5) return encodeFit(canvas, type, q - 0.12);
      return b;
    });
  }

  /**
   * Prepare every version for a use ("role") and upload them. onStep(text) shows the progress.
   * Returns the library item from the server.
   */
  function uploadPhoto(file, role, onStep) {
    onStep = onStep || function () {};
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || '') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) return Promise.reject(new Error('Usa una foto JPG, PNG o WebP.'));
    if (file.size > MAX_INPUT) return Promise.reject(new Error('La foto è troppo grande (massimo 40 MB).'));
    var social = role === 'social';
    var widths = social ? [] : ROLE_WIDTHS[role];
    onStep('Apro la foto…');
    return decodePhoto(file, social ? 2400 : Math.max.apply(null, widths)).then(function (bmp) {
      var W = bmp.width; var H = bmp.height;
      var files = {}; var plan = [];
      if (social) {
        if (W < 600 || H < 315) throw new Error('Per i social serve una foto di almeno 600 × 315 pixel.');
        // Centre crop to 1200 × 630 (1.91:1).
        var r = 1200 / 630; var cw = W; var ch = Math.round(W / r);
        if (ch > H) { ch = H; cw = Math.round(H * r); }
        plan.push({ name: '1200x630.jpg', type: 'image/jpeg', q: JPEG_Q, canvas: function () { return drawScaled(bmp, Math.round((W - cw) / 2), Math.round((H - ch) / 2), cw, ch, 1200, 630, true); } });
      } else {
        var usable = widths.filter(function (w) { return w <= W; });
        if (!usable.length) throw new Error('La foto è troppo piccola: serve almeno ' + widths[0] + ' pixel di larghezza.');
        var fb = usable.indexOf(ROLE_FALLBACK[role]) >= 0 ? ROLE_FALLBACK[role] : usable[usable.length - 1];
        usable.forEach(function (w) {
          plan.push({ name: w + '.webp', w: w, type: 'image/webp', q: WEBP_Q });
        });
        plan.push({ name: fb + '.jpg', w: fb, type: 'image/jpeg', q: JPEG_Q });
        plan.forEach(function (x) { var h = Math.round(H * x.w / W); x.canvas = function () { return drawScaled(bmp, 0, 0, W, H, x.w, h, x.type === 'image/jpeg'); }; });
      }
      var n = 0; var total = 0; var noWebp = false;
      function step(i) {
        if (i >= plan.length) return Promise.resolve();
        var x = plan[i];
        n += 1;
        onStep('Preparo la versione ' + n + ' di ' + plan.length + ' (' + x.name.replace('.', ' ') + ')…');
        var c = x.canvas();
        var job = encodeFit(c, x.type, x.q).catch(function (err) {
          if (x.type !== 'image/webp') throw err;
          // No WebP encoder at all (e.g. WebAssembly blocked): JPEG versions instead, the page still gets every size.
          noWebp = true;
          return encodeFit(c, 'image/jpeg', JPEG_Q).then(function (b) { x.name = x.w + '.jpg'; return b; });
        });
        return job.then(function (b) {
          total += b.size;
          return blobToBase64(b).then(function (data) { files[x.name] = data; return step(i + 1); });
        });
      }
      return step(0).then(function () {
        bmp.close && bmp.close();
        // Keep the upload under the server's limit: drop the widest versions if needed.
        var order = Object.keys(files).filter(function (k) { return /\.webp$/.test(k); }).sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });
        function size() { return Object.keys(files).reduce(function (t, k) { return t + files[k].length * 0.75; }, 0); }
        while (size() > 4200000 && order.length > 1) delete files[order.shift()];
        onStep('Carico ' + kb(size()) + (noWebp ? ' (versioni JPEG)' : '') + '…');
        return api('POST', '/site/media', { role: role, name: file.name, files: files });
      });
    }).then(function (res) { return res.media; });
  }

  function uploadPdf(file, onStep) {
    if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') return Promise.reject(new Error('Scegli un file PDF.'));
    if (file.size > 4 * 1024 * 1024) return Promise.reject(new Error('Il PDF è troppo grande (massimo 4 MB). Prova a esportarlo con una qualità inferiore.'));
    (onStep || function () {})('Carico il PDF…');
    return blobToBase64(file).then(function (data) { return api('POST', '/site/media', { kind: 'pdf', name: file.name, data: data }); })
      .then(function (res) { return res.media; });
  }

  function usedText(m) {
    if (!m.usedIn || !m.usedIn.length) return 'Non usato in nessuna pagina';
    return 'Usato in: ' + m.usedIn.map(function (u) {
      var where = u.type === 'page' ? pageName(u.key) + (u.lang ? ' (' + u.lang.toUpperCase() + ')' : '') : u.title + (u.lang ? ' (' + u.lang.toUpperCase() + ')' : '');
      return where + (u.published ? '' : ' – solo bozza');
    }).join(', ');
  }

  function mediaCard(m, actions) {
    var visual = m.kind === 'pdf'
      ? el('div', { class: 'md-pdf', 'aria-hidden': 'true', text: 'PDF' })
      : el('img', { class: 'md-thumb', src: m.thumb, alt: '', loading: 'lazy' });
    var meta = m.kind === 'pdf' ? 'PDF · ' + kb(m.bytes) : ROLE_NAMES[m.role] + ' · ' + m.width + ' × ' + m.height + ' · ' + kb(m.bytes) + ' in ' + m.variants.length + (m.variants.length === 1 ? ' versione' : ' versioni');
    return el('li', { class: 'md-card' }, [visual, el('div', { class: 'md-body' }, [
      el('strong', { class: 'md-name', text: m.name || '(senza nome)' }),
      el('span', { class: 'hint', text: meta }),
      el('span', { class: 'hint md-used', text: usedText(m) }),
      actions ? el('div', { class: 'md-actions' }, actions) : null,
    ])]);
  }

  /** Choose a file from the library. filter: { kind: 'image'|'pdf', role? } */
  function pickMedia(filter, onPick) {
    var dlg = el('dialog', { class: 'dlg md-dialog' });
    var list = el('ul', { class: 'md-grid', role: 'list' }, [el('li', { class: 'hint', text: 'Carico la libreria…' })]);
    dlg.appendChild(el('div', { class: 'dlg-inner' }, [
      el('div', { class: 'dlg-head' }, [el('h2', { text: filter.kind === 'pdf' ? 'Scegli un PDF' : 'Scegli un\'immagine' }),
        el('button', { type: 'button', class: 'round', 'aria-label': 'Chiudi', text: '×', onclick: function () { dlg.close(); } })]),
      filter.role ? el('p', { class: 'hint', text: 'Solo i file caricati come «' + ROLE_NAMES[filter.role] + '».' }) : null,
      list,
    ]));
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    api('GET', '/site/media').then(function (res) {
      var items = res.media.filter(function (m) { return m.kind === filter.kind && (!filter.role || m.role === filter.role); });
      list.textContent = '';
      if (!items.length) { list.appendChild(el('li', { class: 'hint', text: 'Nessun file adatto nella libreria. Caricane uno nuovo.' })); return; }
      items.forEach(function (m) {
        list.appendChild(mediaCard(m, [el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Usa questo', onclick: function () { dlg.close(); onPick(m); } })]));
      });
    }).catch(function (e) { list.textContent = ''; list.appendChild(el('li', { class: 'form-error', text: e.message })); });
  }

  /** Image field: choose from the library or upload a new one; then the description for who can't see it. */
  function imageEditor(value, onChange, opts) {
    opts = opts || {};
    var role = opts.role || 'content';
    var lang = editLang();
    var box = el('div', { class: 'se-image' });
    function useItem(m) {
      var v = Object.assign({}, m.value);
      v.alt = (value && value.alt) || (lang === 'en' ? m.altEn : m.altIt) || '';
      v.decorative = value ? !!value.decorative : false;
      value = v; onChange(value); render();
    }
    function render() {
      box.textContent = '';
      var status = el('p', { class: 'status', role: 'status' });
      var file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'se-file', 'aria-label': 'Carica una nuova foto' });
      file.addEventListener('change', function () {
        if (!file.files[0]) return;
        status.className = 'status';
        uploadPhoto(file.files[0], role, function (t) { status.textContent = t; }).then(function (m) {
          status.textContent = 'Fatto: ' + m.variants.length + ' versioni, ' + kb(m.bytes) + ' in tutto.';
          useItem(m);
        }).catch(function (e) { status.className = 'status form-error'; status.textContent = e.message; });
      });
      var pick = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Scegli dalla libreria', onclick: function () { pickMedia({ kind: 'image', role: role }, useItem); } });
      var upload = el('label', { class: 'btn btn-ghost btn-small se-file-label' }, [value && value.id ? 'Carica un\'altra foto' : 'Carica nuova', file]);
      if (value && value.id) {
        box.appendChild(el('img', { class: 'se-thumb', src: thumbUrl(value), alt: '' }));
        if (!value.social) {
          box.appendChild(textInput('Descrizione per chi non vede l\'immagine (testo alternativo)', value.alt, 200, function (v) { value.alt = v; onChange(value); }, { required: !value.decorative, hint: 'Per esempio: «Elsa Salvati sorride, seduta alla scrivania».' }));
          box.appendChild(checkInput('Immagine decorativa (non serve descriverla)', value.decorative, function (on) { value.decorative = on; onChange(value); render(); }));
        }
        box.appendChild(el('div', { class: 'cta-row' }, [pick, upload,
          el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Togli', onclick: function () { if (window.confirm('Togliere l\'immagine da qui? Resta nella libreria.')) { value = null; onChange(null); render(); } } }),
        ]));
      } else {
        box.appendChild(el('div', { class: 'cta-row' }, [pick, upload]));
        box.appendChild(el('p', { class: 'hint', text: role === 'social'
          ? 'Viene tagliata al centro a 1200 × 630 pixel, la misura chiesta da Facebook, LinkedIn e WhatsApp.'
          : 'JPG, PNG o WebP. Il sito crea da solo le misure giuste per ogni schermo; l\'originale non viene caricato.' }));
      }
      box.appendChild(status);
    }
    render();
    return box;
  }

  // ---------- one field of a block, generated from the library ----------
  function fieldEditor(f, data, lang) {
    var set = function (v) { data[f.name] = v; changed(); };
    var v = data[f.name];
    switch (f.type) {
      case 'text': return textInput(f.label, v, f.max, set, { required: f.required });
      case 'note': return textInput(f.label, v, f.max || 1500, set, { area: true, hint: 'Visibile solo qui e nell\'anteprima, mai sul sito pubblicato.' });
      case 'anchor': return textInput(f.label, v, 40, function (x) { set(x.trim().replace(/^#/, '').toLowerCase()); }, { hint: 'Solo lettere minuscole, numeri e trattini.' });
      case 'select': return selectInput(f.label, f.options, v, set);
      case 'bool': return checkInput(f.label, v, set);
      case 'rich': return el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: f.label + (f.required ? ' *' : '') }), richEditor(v, { multiline: f.multiline !== false, max: f.max, label: f.label }, set)]);
      case 'image': return el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: f.label }), imageEditor(v, set, { role: f.role || 'content' })]);
      case 'link': return linkEditor(v, { optional: true, label: f.label }, set);
      case 'button': return linkEditor(v, { optional: true, label: f.label, styles: f.styles }, set);
      case 'links': case 'buttons': {
        if (!Array.isArray(v)) { v = []; data[f.name] = v; }
        var isBtn = f.type === 'buttons';
        return el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: f.label }), listEditor(v, {
          itemLabel: isBtn ? 'Pulsante' : 'Link', max: f.max || 3,
          make: function () { var x = { label: '', to: { kind: 'page', key: (se.linkTargets[0] || {}).key || '' } }; if (isBtn) x.style = (f.styles || ['primary'])[0]; return x; },
        }, function (item) { return linkEditor(item, { styles: isBtn ? f.styles : null }, function () { changed(); }); })]);
      }
      case 'textlist': {
        if (!Array.isArray(v)) { v = []; data[f.name] = v; }
        return el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: f.label }), listEditor(v, { itemLabel: 'Punto', max: f.max || 6, make: function () { return ''; } },
          function (item, i) { return textInput('Testo', item, f.itemMax || 200, function (x) { v[i] = x; changed(); }); })]);
      }
      case 'flow': {
        if (!Array.isArray(v)) { v = []; data[f.name] = v; }
        return el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: f.label }), flowEditor(v, f)]);
      }
      case 'list': {
        if (!Array.isArray(v)) { v = []; data[f.name] = v; }
        return el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: f.label }), listEditor(v, {
          itemLabel: f.itemLabel || 'Voce', max: f.max, min: f.min, make: function () { return emptyData(f.fields); },
        }, function (item) {
          var wrap = el('div', { class: 'se-fields' });
          f.fields.forEach(function (sub) { wrap.appendChild(fieldEditor(sub, item, lang)); });
          return wrap;
        })]);
      }
      default: return el('p', { class: 'hint', text: f.label });
    }
  }

  // Paragraphs, highlighted paragraphs, figures with a source and arrow links, in any order.
  function flowEditor(arr, f) {
    var kinds = f.kinds || ['p', 'lead', 'stat', 'arrow'];
    var box = el('div', { class: 'se-list' });
    function render() {
      box.textContent = '';
      arr.forEach(function (elx, i) {
        var card = el('div', { class: 'se-item' }, [el('div', { class: 'se-item-head' }, [el('strong', { text: KIND_NAMES[elx.kind] || elx.kind }), itemTools(arr, i, render, { label: 'elemento' })])]);
        if (elx.kind === 'arrow') {
          if (!elx.link) elx.link = { label: '', to: { kind: 'page', key: (se.linkTargets[0] || {}).key || '' } };
          card.appendChild(linkEditor(elx.link, {}, function () { changed(); }));
        } else {
          card.appendChild(richEditor(elx.text, { multiline: true, max: 1500, label: KIND_NAMES[elx.kind] }, function (m) { elx.text = m; changed(); }));
          if (elx.kind === 'stat') card.appendChild(textInput('Fonte (es. Censis-Eudaimon, 2026)', elx.source, 120, function (x) { elx.source = x; changed(); }));
        }
        box.appendChild(card);
      });
      if (arr.length < (f.max || 10)) {
        box.appendChild(el('div', { class: 'se-addrow' }, kinds.map(function (k) {
          return el('button', { type: 'button', class: 'btn btn-ghost btn-small se-add', text: '+ ' + KIND_NAMES[k], onclick: function () {
            arr.push(k === 'arrow' ? { kind: 'arrow', link: { label: '', to: { kind: 'page', key: (se.linkTargets[0] || {}).key || '' } } } : k === 'stat' ? { kind: 'stat', text: { p: [] }, source: '' } : { kind: k, text: { p: [] } });
            changed(); render();
          } });
        })));
      }
    }
    render();
    return box;
  }

  // ---------- page list ----------
  function siteGroups() {
    var groups = {};
    se.pages.forEach(function (p) { (groups[p.key] = groups[p.key] || {})[p.lang] = p; });
    return Object.keys(groups).sort(function (a, b) {
      var ia = PAGE_ORDER.indexOf(a); var ib = PAGE_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    }).map(function (k) { return { key: k, it: groups[k].it, en: groups[k].en }; });
  }

  // Every place the editor can open: shared parts, the media library, then the pages in both languages.
  function editorEntries() {
    var scopes = se.globals ? se.globals.scopes : null;
    var out = [];
    if (scopes) {
      ['it', 'en'].forEach(function (l) {
        out.push({ group: 'Tutto il sito', label: 'Intestazione e piè di pagina', lang: l, changes: !!(scopes[l] && scopes[l].hasChanges),
          current: se.mode === 'global' && se.gscope === l, run: function () { openGlobal(l); } });
      });
      out.push({ group: 'Tutto il sito', label: 'Dati dello studio', changes: !!(scopes.studio && scopes.studio.hasChanges),
        current: se.mode === 'global' && se.gscope === 'studio', run: function () { openGlobal('studio'); } });
    }
    out.push({ group: 'Tutto il sito', label: 'Immagini e PDF', current: se.mode === 'media', run: openMedia });
    siteGroups().forEach(function (g) {
      ['it', 'en'].forEach(function (l) {
        var p = g[l];
        if (!p) return;
        out.push({ group: 'Pagine', label: pageName(g.key), lang: l, path: p.path, changes: !!p.hasChanges,
          current: se.mode === 'page' && se.page && se.page.id === p.id, run: function () { openSitePage(p.id); } });
      });
    });
    return out;
  }

  function entryButton(x, onDone) {
    return el('button', {
      type: 'button', class: 'ed-entry' + (x.current ? ' current' : ''), 'aria-current': x.current ? 'page' : null,
      'aria-label': x.label + (x.lang ? ', ' + LANG_NAME[x.lang] : '') + (x.changes ? ', modifiche non pubblicate' : ''),
      onclick: function () { if (onDone) onDone(); x.run(); },
    }, [
      el('span', { class: 'ed-entry-name' }, [x.label, x.path ? el('small', { text: x.path }) : null]),
      x.changes ? el('span', { class: 'se-dot', title: 'Modifiche non pubblicate', 'aria-hidden': 'true' }) : null,
      x.lang ? el('span', { class: 'ed-lang', text: x.lang.toUpperCase() }) : null,
    ]);
  }

  function renderPageList() {
    var box = $('[data-se-pages]');
    box.textContent = '';
    var entries = editorEntries();
    ['Tutto il sito', 'Pagine'].forEach(function (g) {
      box.appendChild(el('h2', { class: 'se-h', text: g }));
      var ul = el('ul', { class: 'se-pagelist', role: 'list' });
      entries.filter(function (x) { return x.group === g; }).forEach(function (x) { ul.appendChild(el('li', {}, [entryButton(x)])); });
      box.appendChild(ul);
    });
    box.appendChild(el('p', { class: 'hint se-legend' }, [el('span', { class: 'se-dot', 'aria-hidden': 'true' }), ' modifiche non ancora pubblicate']));
    renderPicker();
    updateChangesButton();
  }

  // Page picker in the toolbar, with search.
  function renderPicker() {
    var box = $('[data-ed-results]');
    if (!box) return;
    var q = ($('[data-ed-search]').value || '').trim().toLowerCase();
    box.textContent = '';
    var entries = editorEntries().filter(function (x) {
      return !q || (x.label + ' ' + (x.path || '') + ' ' + (x.lang || '')).toLowerCase().indexOf(q) !== -1;
    });
    var last = null;
    entries.forEach(function (x) {
      if (x.group !== last) { box.appendChild(el('p', { class: 'se-h', text: x.group })); last = x.group; }
      box.appendChild(entryButton(x, closePicker));
    });
    if (!entries.length) box.appendChild(el('p', { class: 'hint ed-noresult', text: 'Nessuna pagina trovata.' }));
  }
  function closePicker() {
    var pop = $('[data-ed-pop]');
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    $('[data-ed-pick]').setAttribute('aria-expanded', 'false');
  }

  // Which panel the editor shows: page (blocks + preview + inspector), shared parts, or the library.
  function edLayout() {
    var ed = $('[data-panel="sito"]');
    var media = se.mode === 'media';
    var global = se.mode === 'global';
    ed.classList.toggle('mode-media', media);
    ed.classList.toggle('mode-global', global);
    ed.classList.toggle('has-selection', se.mode === 'page' && se.selected >= 0 && se.tab === 'blocks');
    var bt = $('[data-ed-ltab="blocks"]');
    bt.disabled = media || global;
    setLTab(media || global ? 'pages' : (se.ltab || 'blocks'));
    $('[data-se-history]').hidden = global || media;
    $('[data-se-publish]').hidden = media;
    $('[data-se-badge]').hidden = media;
    $('[data-se-langswitch]').hidden = media || (global && se.gscope === 'studio');
    $('.se-device').hidden = media;
    $('[data-se-openpreview]').classList.toggle('is-off', media);
  }
  function setLTab(t) {
    $$('[data-ed-ltab]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-ed-ltab') === t)); });
    $$('[data-ed-lpanel]').forEach(function (p) { p.hidden = p.getAttribute('data-ed-lpanel') !== t; });
  }

  // Keep the address in step with what is open, so reload and back/forward come back here.
  function edHash() {
    if (se.mode === 'media') return '#/sito/media';
    if (se.mode === 'global') return se.gscope === 'studio' ? '#/studio/dati' : '#/sito/intestazione/' + se.gscope;
    return se.page ? '#/sito/pagine/' + se.page.id : '#/sito/pagine';
  }
  function syncHash() {
    if (!document.body.classList.contains('is-editor')) return;
    var h = edHash();
    if (location.hash === h) return;
    var r = routeKey();
    if (r.key) state.route = r.key;
    // From the bare section address to a specific page: replace, so "back" leaves the editor.
    if (h.indexOf(location.hash + '/') === 0) history.replaceState(null, '', h); else history.pushState(null, '', h);
    var nr = routeKey();
    state.route = nr.key;
    $$('[data-route]').forEach(function (a) {
      if (a.getAttribute('data-route') === nr.key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function enterEditor(kind, arg) {
    document.body.classList.add('is-editor');
    document.body.classList.remove('route-wide');
    $('[data-ed-exit]').href = '#/' + (state.lastShellRoute || 'agenda/calendario');
    showPanel('sito');
    document.title = 'Editor del sito – Area riservata Blooming';
    var ready = se.loaded ? Promise.resolve() : loadSitePages();
    ready.then(function () {
      if (kind === 'media') { if (se.mode !== 'media') return openMedia(); }
      else if (kind === 'global' || kind === 'studio') {
        var sc = kind === 'studio' ? 'studio' : (arg === 'en' ? 'en' : 'it');
        if (!(se.mode === 'global' && se.gscope === sc)) return openGlobal(sc);
      } else {
        var id = arg ? String(arg) : (se.page ? se.page.id : null);
        if (!id || !se.pages.some(function (p) { return p.id === id; })) {
          var home = se.pages.find(function (p) { return p.key === 'index' && p.lang === 'it'; }) || se.pages[0];
          id = home ? home.id : null;
        }
        if (id && !(se.mode === 'page' && se.page && se.page.id === id)) return openSitePage(id);
      }
      edLayout();
      syncHash();
    }).then(function () { setTimeout(fitFrame, 0); });
  }

  function loadGlobals() {
    return api('GET', '/site/globals').then(function (res) { se.globals = res; }).catch(function () { se.globals = null; });
  }

  function loadSitePages() {
    return Promise.all([api('GET', '/site/pages'), loadGlobals()]).then(function (all) {
      se.pages = all[0].pages;
      se.loaded = true;
      renderPageList();
    }).catch(function (e) { showBanner(e.message); });
  }

  function openSitePage(id) {
    return flushSave().then(function () {
      return api('GET', '/site/pages/' + id);
    }).then(function (res) {
      se.mode = 'page';
      se.page = res.page;
      se.returnPage = res.page.id;
      se.draft = clone(res.page.draft);
      if (!se.draft.seo || typeof se.draft.seo !== 'object') se.draft.seo = { image: null, noindex: false };
      se.expected = res.page.draftUpdatedAt;
      se.linkTargets = res.linkTargets || [];
      se.pros = res.professionals || [];
      se.library = {};
      (res.library || []).forEach(function (b) { se.library[b.type] = b; });
      se.selected = -1;
      se.sel = { path: '' };
      se.inline = null;
      se.dirty = false;
      se.refPage = null;
      hideBanner();
      setStatus(res.page.draftUpdatedBy ? 'Ultima modifica: ' + res.page.draftUpdatedBy + ', ' + new Date(res.page.draftUpdatedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '');
      renderEditor();
      renderPageList();
      syncHash();
      histReset();
      if (se.refOpen) loadReference();
      schedulePreview(0);
    }).catch(function (e) { showBanner(e.message); });
  }

  // ---------- editor ----------
  function setStatus(t, cls) {
    var s = $('[data-se-status]');
    s.textContent = t;
    s.className = 'se-status' + (cls ? ' ' + cls : '');
  }
  function showBanner(msg, action) {
    var b = $('[data-se-banner]');
    b.textContent = '';
    b.appendChild(el('span', { text: msg }));
    if (action) b.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: action.label, onclick: action.run }));
    b.hidden = false;
  }
  function hideBanner() { $('[data-se-banner]').hidden = true; }

  function updateBadge() {
    updateChangesButton();
    var badge = $('[data-se-badge]');
    if (se.mode === 'global') {
      var s = se.globals && se.globals.scopes[se.gscope];
      var ch = se.dirty || (s && s.hasChanges);
      badge.textContent = ch ? 'Modifiche non pubblicate' : 'Pubblicato';
      badge.className = 'se-badge' + (ch ? ' changes' : ' ok');
      return;
    }
    var p = se.page;
    var changes = p && (se.dirty || p.hasChanges);
    badge.textContent = changes ? 'Modifiche non pubblicate' : 'Pubblicata';
    badge.className = 'se-badge' + (changes ? ' changes' : ' ok');
  }

  function blockSummary(b) {
    var d = b.data || {};
    var t = d.title || d.eyebrow || d.descriptor || '';
    if (!t && d.items && d.items[0]) t = d.items[0].title || d.items[0].q || d.items[0].term || '';
    if (typeof t === 'object' && t && t.p) t = t.p.map(function (p) { return p.map(function (r) { return r.t; }).join(''); }).join(' ');
    return String(t || '');
  }

  function setTab(tab) {
    se.tab = tab;
    $$('[data-se-tab]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-se-tab') === tab)); });
    $('[data-se-tab-blocks]').hidden = tab !== 'blocks';
    $('[data-se-tab-seo]').hidden = tab !== 'seo';
    if (tab === 'seo') renderSeo();
    $('[data-panel="sito"]').classList.toggle('has-selection', se.mode === 'page' && se.selected >= 0 && tab === 'blocks');
  }

  function renderEditor() {
    var p = se.page;
    var global = se.mode === 'global';
    edLayout();
    $('[data-se-media]').hidden = true;
    $('[data-se-empty]').hidden = !!(p || global);
    $('[data-se-editor]').hidden = !(p || global);
    $('[data-se-tabs]').hidden = global;
    $('[data-se-history]').hidden = global;
    $('[data-se-ref]').hidden = global;
    $('[data-se-tab-global]').hidden = !global;
    if (global) { $('[data-se-tab-blocks]').hidden = true; $('[data-se-tab-seo]').hidden = true; renderGlobalEditor(); return; }
    if (!p) return;
    setTab(se.tab);
    $('[data-se-title]').textContent = pageName(p.key);
    $('[data-se-path]').textContent = p.path;
    var other = se.pages.find(function (x) { return x.key === p.key && x.lang !== p.lang; });
    var sw = $('[data-se-langswitch]');
    sw.textContent = '';
    ['it', 'en'].forEach(function (l) {
      var target = l === p.lang ? p : (other && other.lang === l ? other : null);
      sw.appendChild(el('button', { type: 'button', 'aria-pressed': String(l === p.lang), disabled: !target, title: target ? '' : 'Questa pagina non esiste in ' + LANG_NAME[l].toLowerCase(),
        text: LANG_NAME[l], onclick: function () { if (target && target.id !== p.id) openSitePage(target.id); } }));
    });
    $('[data-se-ref]').disabled = !other;
    updateBadge();
    renderBlocks();
  }

  // ---------- SEO and sharing ----------
  function renderSeo() {
    var box = $('[data-se-tab-seo]');
    box.textContent = '';
    var seo = se.draft.seo;
    var domain = location.host;
    var gTitle = el('span', { class: 'se-g-title' });
    var gDesc = el('span', { class: 'se-g-desc' });
    var cTitle = el('strong');
    var cDesc = el('span', { class: 'hint' });
    var cImg = el('div', { class: 'se-card-img' });
    function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
    function refresh() {
      gTitle.textContent = cut(se.draft.title || pageName(se.page.key), 62);
      gDesc.textContent = cut(se.draft.description || 'Google sceglierà un pezzo di testo della pagina.', 158);
      cTitle.textContent = cut(se.draft.title, 80);
      cDesc.textContent = cut(se.draft.description, 120);
      cImg.textContent = '';
      if (seo.image && seo.image.id) cImg.appendChild(el('img', { src: thumbUrl(seo.image), alt: '' }));
      else cImg.appendChild(el('span', { class: 'hint', text: 'Nessuna immagine: i social useranno quella predefinita del sito.' }));
    }
    box.appendChild(el('p', { class: 'hint', text: 'Come la pagina compare su Google e quando qualcuno la condivide. L\'indirizzo ' + se.page.path + ' non si cambia da qui.' }));
    box.appendChild(textInput('Titolo per Google', se.draft.title, 120, function (v) { se.draft.title = v; refresh(); changed(); }, { recommended: 60, required: true, hint: 'Compare nella scheda del browser e nei risultati di Google. Meglio sotto i 60 caratteri.' }));
    box.appendChild(textInput('Descrizione', se.draft.description, 300, function (v) { se.draft.description = v; refresh(); changed(); }, { area: true, recommended: 155, hint: 'Una o due frasi su cosa trova chi apre la pagina.' }));
    box.appendChild(el('p', { class: 'se-sub', text: 'Anteprima su Google' }));
    box.appendChild(el('div', { class: 'se-google', 'aria-label': 'Anteprima del risultato su Google' }, [
      el('span', { class: 'se-g-url', text: domain + se.page.path }), gTitle, gDesc,
    ]));
    box.appendChild(el('div', { class: 'field se-field' }, [el('span', { class: 'label', text: 'Immagine per la condivisione sui social' }),
      imageEditor(seo.image, function (v) { seo.image = v; refresh(); changed(); }, { role: 'social' })]));
    box.appendChild(el('p', { class: 'se-sub', text: 'Anteprima della condivisione' }));
    box.appendChild(el('div', { class: 'se-card' }, [cImg, el('div', { class: 'se-card-text' }, [el('span', { class: 'se-g-url', text: domain }), cTitle, cDesc])]));
    var warn = el('p', { class: 'status form-error', role: 'status' });
    function warnNoindex() { warn.textContent = seo.noindex ? 'Attenzione: con questa scelta la pagina sparisce da Google e dagli altri motori di ricerca.' : ''; }
    box.appendChild(checkInput('Non mostrare nei motori di ricerca', seo.noindex, function (on) { seo.noindex = on; warnNoindex(); changed(); }));
    box.appendChild(warn);
    warnNoindex();
    refresh();
  }

  // ---------- media library: every image and PDF, reusable on any page ----------
  function openMedia() {
    return flushSave().then(function () {
      se.mode = 'media';
      hideBanner();
      setStatus('');
      $('[data-se-title]').textContent = 'Immagini e PDF';
      $('[data-se-path]').textContent = 'Libreria di tutto il sito';
      $('[data-se-empty]').hidden = true;
      $('[data-se-editor]').hidden = true;
      $('[data-se-media]').hidden = false;
      edLayout();
      renderPageList();
      syncHash();
      return renderMedia();
    });
  }

  function renderMedia() {
    var box = $('[data-se-media]');
    box.textContent = '';
    var status = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    var roleSel = el('select', { id: 'md-role' }, ['content', 'wide', 'social'].map(function (r) { return el('option', { value: r, text: ROLE_NAMES[r] }); }));
    var photo = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'se-file', 'aria-label': 'Carica un\'immagine' });
    var pdf = el('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'se-file', 'aria-label': 'Carica un PDF' });
    function done(m) { status.className = 'status form-ok'; status.textContent = 'Caricato: ' + m.name + (m.kind === 'image' ? ' (' + m.variants.length + ' versioni, ' + kb(m.bytes) + ')' : ''); load(); }
    function fail(e) { status.className = 'status form-error'; status.textContent = e.message; }
    photo.addEventListener('change', function () {
      if (!photo.files[0]) return;
      status.className = 'status';
      uploadPhoto(photo.files[0], roleSel.value, function (t) { status.textContent = t; }).then(done).catch(fail);
      photo.value = '';
    });
    pdf.addEventListener('change', function () {
      if (!pdf.files[0]) return;
      status.className = 'status';
      uploadPdf(pdf.files[0], function (t) { status.textContent = t; }).then(done).catch(fail);
      pdf.value = '';
    });
    box.appendChild(el('div', { class: 'se-bar' }, [el('div', { class: 'se-bar-title' }, [
      el('h2', { text: 'Immagini e PDF' }),
      el('p', { class: 'hint', text: 'Carichi un file una volta e lo usi in tutte le pagine che vuoi. Delle foto il sito tiene solo le misure che servono a ogni schermo.' }),
    ])]));
    box.appendChild(el('div', { class: 'md-upload' }, [
      el('div', { class: 'field' }, [el('label', { for: 'md-role', text: 'Dove userai la foto' }), roleSel]),
      el('label', { class: 'btn btn-primary btn-small se-file-label' }, ['Carica un\'immagine', photo]),
      el('label', { class: 'btn btn-ghost btn-small se-file-label' }, ['Carica un PDF (massimo 4 MB)', pdf]),
    ]));
    box.appendChild(status);
    var grid = el('ul', { class: 'md-grid', role: 'list' }, [el('li', { class: 'hint', text: 'Carico la libreria…' })]);
    box.appendChild(grid);
    function rename(m) {
      var name = window.prompt('Nome del file', m.name);
      if (name === null) return;
      api('PATCH', '/site/media/' + m.id, { name: name }).then(load).catch(fail);
    }
    function altDialog(m) {
      var dlg = el('dialog', { class: 'dlg' });
      var it = el('input', { id: 'md-alt-it', maxlength: 200 }); it.value = m.altIt || '';
      var en = el('input', { id: 'md-alt-en', maxlength: 200 }); en.value = m.altEn || '';
      var form = el('form', { class: 'dlg-inner', method: 'dialog' }, [
        el('div', { class: 'dlg-head' }, [el('h2', { text: 'Descrizione predefinita' })]),
        el('p', { class: 'hint', text: 'Proposta quando inserisci l\'immagine in una pagina; lì puoi sempre cambiarla.' }),
        el('div', { class: 'field' }, [el('label', { for: 'md-alt-it', text: 'In italiano' }), it]),
        el('div', { class: 'field' }, [el('label', { for: 'md-alt-en', text: 'In inglese' }), en]),
        el('div', { class: 'cta-row dlg-actions' }, [
          el('button', { type: 'submit', class: 'btn btn-primary btn-small', text: 'Salva' }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Annulla', onclick: function () { dlg.close(); } }),
        ]),
      ]);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        api('PATCH', '/site/media/' + m.id, { alt_it: it.value, alt_en: en.value }).then(function () { dlg.close(); load(); }).catch(fail);
      });
      dlg.appendChild(form);
      dlg.addEventListener('close', function () { dlg.remove(); });
      document.body.appendChild(dlg);
      dlg.showModal();
    }
    function remove(m) {
      if (m.usedIn && m.usedIn.length) { window.alert('Non si può cancellare: ' + usedText(m).replace('Usato in: ', 'è usato in ') + '. Toglilo prima da quelle pagine.'); return; }
      if (!window.confirm('Cancellare «' + m.name + '»? Non si può annullare.')) return;
      api('DELETE', '/site/media/' + m.id).then(function () { status.className = 'status form-ok'; status.textContent = 'Cancellato.'; load(); })
        .catch(fail);
    }
    function load() {
      return api('GET', '/site/media').then(function (res) {
        grid.textContent = '';
        if (!res.media.length) { grid.appendChild(el('li', { class: 'hint', text: 'La libreria è vuota.' })); return; }
        res.media.forEach(function (m) {
          var actions = [el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Rinomina', onclick: function () { rename(m); } })];
          if (m.kind === 'image' && m.role !== 'social') actions.push(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Descrizione', onclick: function () { altDialog(m); } }));
          if (m.kind === 'pdf') actions.push(el('a', { class: 'btn btn-ghost btn-small', href: m.url, target: '_blank', rel: 'noopener', text: 'Apri' }));
          actions.push(el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Cancella', onclick: function () { remove(m); } }));
          grid.appendChild(mediaCard(m, actions));
        });
      }).catch(function (e) { grid.textContent = ''; grid.appendChild(el('li', { class: 'form-error', text: e.message })); });
    }
    return load();
  }

  // ---------- header, footer and studio details ----------
  function openGlobal(scope, part) {
    return flushSave().then(function () { return loadGlobals(); }).then(function () {
      if (!se.globals || !se.globals.scopes[scope]) { showBanner('Questa parte non è ancora disponibile.'); return null; }
      var s = se.globals.scopes[scope];
      se.mode = 'global';
      se.gscope = scope;
      se.gdata = clone(s.draft || {});
      se.gexpected = s.draftUpdatedAt;
      se.linkTargets = se.globals.linkTargets || se.linkTargets;
      se.pros = se.globals.professionals || se.pros;
      se.dirty = false;
      hideBanner();
      setStatus('');
      // The preview shows a page of that language (the last one opened, else the home) with these header and footer.
      var lang = scope === 'en' ? 'en' : 'it';
      var target = se.page && se.page.lang === lang ? se.page : (se.pages.find(function (p) { return p.key === 'index' && p.lang === lang; }) || se.pages.find(function (p) { return p.lang === lang; }));
      se.gpreview = target ? { id: target.id, draft: null } : null;
      se.inline = null;
      renderEditor();
      histReset();
      renderPageList();
      syncHash();
      if (part) focusGlobalPart(part);
      if (!target) return null;
      return api('GET', '/site/pages/' + target.id).then(function (res) {
        if (se.mode !== 'global' || se.gscope !== scope) return;
        se.gpreview = { id: res.page.id, draft: res.page.draft };
        schedulePreview(0);
      });
    }).catch(function (e) { showBanner(e.message); });
  }

  // Opens the header or the footer section of the shared editor and brings it into view.
  function focusGlobalPart(part) {
    var box = $('[data-se-tab-global]');
    $$('.se-global-part', box).forEach(function (d) {
      var on = d.getAttribute('data-part') === part;
      d.classList.toggle('is-target', on);
      if (on) d.open = true;
    });
    var target = $('.se-global-part[data-part="' + part + '"]', box);
    if (!target) return;
    // The header is the first part: show the panel from the top, so "Torna alla pagina" stays in view.
    var panel = target.closest('.ed-right');
    if (part === 'header' && panel) panel.scrollTop = 0; else target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    var sum = $('summary', target);
    if (sum) sum.focus({ preventScroll: true });
    clearTimeout(focusGlobalPart.t);
    focusGlobalPart.t = setTimeout(function () { target.classList.remove('is-target'); }, 2400);
  }

  // The page to go back to from the shared parts: the one that was open, else the one in the preview.
  function backPageId() {
    var back = se.pages.find(function (p) { return p.id === se.returnPage; });
    if (back && back.lang === se.gscope) return back.id;
    var id = se.gpreview && se.gpreview.id;
    return id && se.pages.some(function (p) { return p.id === id; }) ? id : null;
  }

  function renderGlobalEditor() {
    var scope = se.gscope;
    var studio = scope === 'studio';
    $('[data-se-title]').textContent = GLOBAL_NAMES[scope];
    $('[data-se-path]').textContent = studio ? 'Usati in tutte le pagine' : 'Tutte le pagine in ' + LANG_NAME[scope].toLowerCase();
    var sw = $('[data-se-langswitch]');
    sw.textContent = '';
    if (!studio) {
      ['it', 'en'].forEach(function (l) {
        sw.appendChild(el('button', { type: 'button', 'aria-pressed': String(l === scope), text: LANG_NAME[l], onclick: function () { if (l !== scope) openGlobal(l); } }));
      });
    }
    var s = se.globals.scopes[scope];
    var badge = $('[data-se-badge]');
    var changes = se.dirty || s.hasChanges;
    badge.textContent = changes ? 'Modifiche non pubblicate' : 'Pubblicato';
    badge.className = 'se-badge' + (changes ? ' changes' : ' ok');
    var box = $('[data-se-tab-global]');
    box.textContent = '';
    var backId = studio ? null : backPageId();
    var backPage = backId && se.pages.find(function (p) { return p.id === backId; });
    if (backPage) {
      var twoLangs = se.pages.some(function (x) { return x.key === backPage.key && x.lang !== backPage.lang; });
      box.appendChild(el('button', { type: 'button', class: 'se-backpage', 'data-se-backpage': true, onclick: function () { openSitePage(backPage.id); } }, [
        icon('back', 16), el('span', { text: 'Torna alla pagina' }), el('strong', { text: pageName(backPage.key) + (twoLangs ? ' · ' + backPage.lang.toUpperCase() : '') }),
      ]));
    }
    box.appendChild(el('p', { class: 'hint', text: studio
      ? 'Telefono, email e WhatsApp compaiono in automatico nelle pagine e nel piè di pagina: cambiandoli qui cambiano ovunque.'
      : 'Il menu in alto e il piè di pagina sono uguali in tutte le pagine di questa lingua. L\'ordine delle voci è l\'ordine del menu.' }));
    var schema = se.globals.schema || {};
    var sections = studio ? [['studio', 'Dati dello studio']] : [['header', 'Intestazione (menu in alto)'], ['footer', 'Piè di pagina']];
    sections.forEach(function (sec) {
      var data = studio ? se.gdata : (se.gdata[sec[0]] = se.gdata[sec[0]] || {});
      var fields = schema[sec[0]] || [];
      var part = el('details', { class: 'se-global-part', open: true, 'data-part': sec[0] }, [el('summary', { text: sec[1] })]);
      var wrap = el('div', { class: 'se-fields' });
      fields.forEach(function (f) {
        if (data[f.name] === undefined) data[f.name] = emptyValue(f);
        wrap.appendChild(fieldEditor(f, data, scope === 'en' ? 'en' : 'it'));
      });
      if (!fields.length) wrap.appendChild(el('p', { class: 'hint', text: 'Nessun campo.' }));
      part.appendChild(wrap);
      box.appendChild(part);
    });
  }

  // Header and footer: fixed rows at the ends of the list. They are shared by every page of the language,
  // so a click opens their own editor instead of selecting a block.
  function sharedRow(part) {
    var label = part === 'header' ? 'Intestazione' : 'Piè di pagina';
    return el('li', { class: 'se-block se-shared', 'data-se-shared': part }, [
      el('div', { class: 'se-block-head' }, [
        el('button', { type: 'button', class: 'se-block-pick', title: 'Modifica ' + label.toLowerCase() + ' (uguale in tutte le pagine)', onclick: function () { openShared(part); } }, [
          el('span', { class: 'se-block-n se-shared-ic', 'aria-hidden': 'true' }, [icon('layout', 14)]),
          el('span', { class: 'se-block-text' }, [
            el('strong', {}, [label, el('span', { class: 'se-shared-tag', text: 'tutto il sito' })]),
            el('span', { class: 'hint', text: part === 'header' ? 'Logo, menu e pulsante in alto' : 'Contatti, link e note in fondo' }),
          ]),
        ]),
      ]),
    ]);
  }
  function openShared(part) {
    var lang = editLang();
    if (se.page) se.returnPage = se.page.id;
    return openGlobal(lang, part);
  }

  function renderBlocks() {
    var box = $('[data-se-blocks]');
    box.textContent = '';
    var blocks = se.draft.blocks;
    box.appendChild(sharedRow('header'));
    var insertRow = function (at) {
      return el('li', { class: 'se-ins', 'aria-hidden': 'false' }, [el('button', { type: 'button', class: 'se-ins-btn', title: 'Aggiungi un blocco qui', 'aria-label': 'Aggiungi un blocco in posizione ' + (at + 1), 'data-se-insert': String(at), onclick: function () { addBlockDialog(at); } }, [el('span', { text: '+' })])]);
    };
    blocks.forEach(function (b, i) {
      var def = se.library[b.type] || { label: b.type, fields: [], bg: ['light'] };
      var open = se.selected === i;
      var locked = def.fixed || def.special;
      var head = el('div', { class: 'se-block-head' }, [
        el('button', { type: 'button', class: 'se-block-pick', 'aria-expanded': String(open), title: 'Clic per modificare · Alt+↑/↓ per spostare · trascina per riordinare', onclick: function () { selectBlock(open && !se.sel.path ? -1 : i); } }, [
          el('span', { class: 'se-block-n', text: String(i + 1) }),
          el('span', { class: 'se-block-text' }, [el('strong', { text: def.label }), el('span', { class: 'hint', text: blockSummary(b) || (def.special ? 'Parte fissa del sito' : '') })]),
        ]),
        el('div', { class: 'se-tools' }, [
          el('button', { type: 'button', class: 'se-icon', title: 'Sposta su', 'aria-label': 'Sposta su il blocco ' + (i + 1), disabled: i === 0, onclick: function () { moveBlock(i, -1); }, text: '↑' }),
          el('button', { type: 'button', class: 'se-icon', title: 'Sposta giù', 'aria-label': 'Sposta giù il blocco ' + (i + 1), disabled: i === blocks.length - 1, onclick: function () { moveBlock(i, 1); }, text: '↓' }),
          locked || def.once ? null : el('button', { type: 'button', class: 'se-icon', title: 'Duplica', 'aria-label': 'Duplica il blocco ' + (i + 1), onclick: function () { duplicateBlock(i); }, text: '⧉' }),
          locked ? null : el('button', { type: 'button', class: 'se-icon se-danger', title: 'Elimina', 'aria-label': 'Elimina il blocco ' + (i + 1), onclick: function () { deleteBlock(i); }, text: '✕' }),
        ]),
      ]);
      var item = el('li', { class: 'se-block' + (open ? ' open' : '') + (b.__error ? ' error' : ''), 'data-se-block': String(i) }, [head]);
      wireListItem(item, i, head.firstChild);
      box.appendChild(insertRow(i));
      box.appendChild(item);
    });
    if (!blocks.length) box.appendChild(el('li', { class: 'empty', text: 'Nessun blocco. Aggiungine uno.' }));
    box.appendChild(insertRow(blocks.length));
    box.appendChild(sharedRow('footer'));
    renderInspector();
  }

  // Right panel: the fields of the selected block.
  function renderInspector() {
    var box = $('[data-se-tab-blocks]');
    box.textContent = '';
    $('[data-panel="sito"]').classList.toggle('has-selection', se.mode === 'page' && se.selected >= 0 && se.tab === 'blocks');
    var b = se.draft && se.draft.blocks[se.selected];
    if (!b) {
      box.appendChild(el('div', { class: 'ed-empty' }, [
        el('div', { class: 'es-icon' }, [icon('cursor', 26)]),
        el('p', { class: 'ed-empty-title', text: 'Scegli un blocco' }),
        el('p', { class: 'hint', text: 'Clicca un blocco nell\'elenco a sinistra, o direttamente nell\'anteprima, per modificarne testi e impostazioni.' }),
      ]));
      return;
    }
    var def = se.library[b.type] || { label: b.type, fields: [], bg: ['light'] };
    var i = se.selected;
    box.appendChild(el('div', { class: 'ins-head' }, [
      el('button', { type: 'button', class: 'ins-back', onclick: function () { selectUp(); } }, [icon('back', 18), el('span', { text: 'Indietro' })]),
      crumbs(i, def),
    ]));
    var item = itemOf(def.fields, se.sel.path);
    if (!item && se.sel.path && fieldDef(def.fields, se.sel.path) && fieldDef(def.fields, se.sel.path).item && fieldDef(def.fields, se.sel.path).type === 'list') item = se.sel.path;
    box.appendChild(item ? itemInspector(b, def, item) : inspector(b, def));
  }

  // Breadcrumb: page › block › item › field. Each step selects that level; Esc goes up one.
  function crumbs(i, def) {
    var nav = el('nav', { class: 'ins-crumbs', 'aria-label': 'Percorso della selezione' });
    var ol = el('ol', { role: 'list' });
    var add = function (label, run, current) {
      ol.appendChild(el('li', {}, [current ? el('span', { 'aria-current': 'location', text: label }) : el('button', { type: 'button', text: label, onclick: run })]));
    };
    add(pageName(se.page.key), function () { selectBlock(-1); });
    var steps = se.sel.path ? pathSteps(def.fields, se.sel.path) : [];
    add((i + 1) + ' · ' + def.label, function () { selectAt(i, ''); scrollPreviewTo(i); }, !steps.length);
    steps.forEach(function (st, k) {
      var last = k === steps.length - 1;
      if (st.noSelect && !last) { ol.appendChild(el('li', {}, [el('span', { text: st.label })])); return; }
      add(st.label, function () { selectAt(i, st.path); }, last);
    });
    nav.appendChild(ol);
    return nav;
  }

  // One list item on its own (picked on the page, or from the breadcrumb).
  function itemInspector(b, def, itemPath) {
    var box = el('div', { class: 'se-inspector' });
    var f = fieldDef(def.fields, itemPath);
    var data = getPath(b.data, itemPath);
    if (!f || !data) { box.appendChild(inspector(b, def)); return box; }
    var fields = el('div', { class: 'se-fields' });
    f.fields.forEach(function (sub) {
      if (data[sub.name] === undefined) data[sub.name] = emptyValue(sub);
      var w = fieldEditor(sub, data, se.page.lang);
      w.setAttribute('data-field', sub.name);
      fields.appendChild(w);
    });
    box.appendChild(fields);
    box.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Tutto il blocco', onclick: function () { selectAt(se.selected, ''); } }));
    return box;
  }

  function inspector(b, def) {
    var box = el('div', { class: 'se-inspector' });
    if (def.help) box.appendChild(el('p', { class: 'hint', text: def.help }));
    if (b.__error) box.appendChild(el('p', { class: 'status form-error', role: 'alert', text: b.__error }));
    var fields = el('div', { class: 'se-fields' });
    def.fields.forEach(function (f) {
      if (!b.data) b.data = {};
      if (b.data[f.name] === undefined) b.data[f.name] = emptyValue(f);
      var w = fieldEditor(f, b.data, se.page.lang);
      w.setAttribute('data-field', f.name);
      fields.appendChild(w);
    });
    if (!def.fields.length) fields.appendChild(el('p', { class: 'hint', text: 'Questo blocco non ha testi da modificare qui: si può solo spostare.' }));
    box.appendChild(fields);
    var settings = el('details', { class: 'se-settings' }, [el('summary', { text: 'Impostazioni del blocco' })]);
    if (def.bg && def.bg.length > 1) settings.appendChild(selectInput('Sfondo', def.bg.map(function (x) { return [x, BG_LABEL[x] || x]; }), b.bg || def.bg[0], function (v) { b.bg = v; changed(); }));
    if (def.numbered) settings.appendChild(checkInput('Numero nell\'occhiello (01 · …)', b.numbered !== false, function (on) { if (on) delete b.numbered; else b.numbered = false; changed(); }));
    settings.appendChild(textInput('Ancora (per link come #come-funziona)', b.anchor || '', 40, function (v) { v = v.trim().replace(/^#/, '').toLowerCase(); if (v) b.anchor = v; else delete b.anchor; changed(); }, { hint: 'Facoltativa. Solo lettere minuscole, numeri e trattini.' }));
    settings.appendChild(textInput('Nota interna', b.note || '', 1500, function (v) { if (v.trim()) b.note = v; else delete b.note; changed(); }, { area: true, hint: 'Visibile solo qui e nell\'anteprima, mai sul sito pubblicato.' }));
    var otherLang = se.page.lang === 'it' ? 'en' : 'it';
    if (se.pages.some(function (x) { return x.key === se.page.key && x.lang === otherLang; }) && !def.once) {
      settings.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Copia questo blocco nella versione ' + (otherLang === 'en' ? 'inglese' : 'italiana'), onclick: function () { copyToOther(b); } }));
    }
    box.appendChild(settings);
    return box;
  }

  function selectBlock(i) {
    if (se.inline) endInline();
    selectAt(i, '');
    scrollPreviewTo(i);
  }
  function moveBlock(i, d) {
    if (!moveItem(se.draft.blocks, i, d)) return;
    if (se.selected === i) se.selected = i + d; else if (se.selected === i + d) se.selected = i;
    changed({ step: true }); renderBlocks();
  }
  function duplicateBlock(i) {
    var c = clone(se.draft.blocks[i]);
    delete c.id; delete c.__error;
    se.draft.blocks.splice(i + 1, 0, c);
    se.selected = i + 1;
    se.sel.path = '';
    changed({ step: true }); renderBlocks();
  }
  // No confirmation: the block goes, and "Annulla" brings it back for 10 seconds (or Ctrl/Cmd+Z).
  function deleteBlock(i) {
    if (se.inline) endInline();
    var def = se.library[se.draft.blocks[i].type] || {};
    var pageId = se.page.id;
    var removed = se.draft.blocks.splice(i, 1)[0];
    se.selected = -1;
    se.sel.path = '';
    changed({ step: true }); renderBlocks();
    undoToast('Blocco «' + (def.label || removed.type) + '» eliminato.', function () {
      if (se.mode !== 'page' || !se.page || se.page.id !== pageId) return;
      se.draft.blocks.splice(Math.min(i, se.draft.blocks.length), 0, removed);
      changed({ step: true });
      selectAt(Math.min(i, se.draft.blocks.length - 1), '');
      scrollPreviewTo(i);
    });
  }

  function addBlockDialog(atPos) {
    if (se.inline) endInline();
    var fixedAt = typeof atPos === 'number' && atPos >= 0 ? Math.min(atPos, se.draft.blocks.length) : -1;
    var dlg = el('dialog', { class: 'dlg se-library' });
    var list = el('ul', { class: 'se-libgrid', role: 'list' });
    Object.keys(se.library).forEach(function (type) {
      var def = se.library[type];
      var present = se.draft.blocks.some(function (b) { return b.type === type; });
      var disabled = (def.once && present) || type === 'home-hero' && se.page.key !== 'index';
      list.appendChild(el('li', {}, [el('button', { type: 'button', class: 'se-libitem', disabled: disabled, onclick: function () {
        var b = { type: type, bg: def.bg[0], data: emptyData(def.fields) };
        var at = fixedAt >= 0 ? fixedAt : (se.selected >= 0 ? se.selected + 1 : se.draft.blocks.length);
        se.draft.blocks.splice(at, 0, b);
        se.selected = at;
        se.sel.path = '';
        dlg.close();
        changed({ step: true }); renderBlocks(); setTimeout(function () { scrollPreviewTo(at); }, 700);
      } }, [el('strong', { text: def.label }), el('span', { class: 'hint', text: disabled && present ? 'Già presente in questa pagina' : def.help })])]));
    });
    dlg.appendChild(el('div', { class: 'dlg-inner' }, [
      el('div', { class: 'dlg-head' }, [el('h2', { text: 'Aggiungi un blocco' }), el('button', { type: 'button', class: 'round', 'aria-label': 'Chiudi', text: '×', onclick: function () { dlg.close(); } })]),
      el('p', { class: 'hint', text: fixedAt >= 0 ? 'Il blocco verrà aggiunto in posizione ' + (fixedAt + 1) + '.' : (se.selected >= 0 ? 'Il blocco verrà aggiunto dopo quello selezionato.' : 'Il blocco verrà aggiunto in fondo alla pagina.') }),
      list,
    ]));
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function copyToOther(b) {
    var other = se.pages.find(function (x) { return x.key === se.page.key && x.lang !== se.page.lang; });
    if (!other) return;
    var copy = clone(b);
    delete copy.id; delete copy.__error;
    api('GET', '/site/pages/' + other.id).then(function (res) {
      var d = res.page.draft;
      return api('PUT', '/site/pages/' + other.id, { title: d.title, description: d.description, blocks: d.blocks.concat([copy]), expected: res.page.draftUpdatedAt });
    }).then(function () {
      setStatus('Blocco copiato in fondo alla versione ' + (other.lang === 'en' ? 'inglese' : 'italiana') + ': va tradotto.', 'ok');
      other.hasChanges = true;
      renderPageList();
    }).catch(function (e) { showBanner('Copia non riuscita: ' + e.message); });
  }

  // ---------- reference: the other language, read only ----------
  function loadReference() {
    var box = $('[data-se-refbox]');
    var other = se.pages.find(function (x) { return x.key === se.page.key && x.lang !== se.page.lang; });
    box.textContent = '';
    if (!other) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(el('p', { class: 'se-sub', text: 'Riferimento: versione ' + (other.lang === 'en' ? 'inglese' : 'italiana') + ' (sola lettura)' }));
    api('GET', '/site/pages/' + other.id).then(function (res) {
      var ol = el('ol', { class: 'se-reflist' });
      res.page.draft.blocks.forEach(function (b) {
        var def = se.library[b.type] || { label: b.type };
        ol.appendChild(el('li', {}, [el('strong', { text: def.label }), el('span', { class: 'hint', text: blockSummary(b) })]));
      });
      box.appendChild(ol);
    }).catch(function (e) { box.appendChild(el('p', { class: 'form-error', text: e.message })); });
  }

  // ---------- saving ----------
  function changed(opts) {
    se.dirty = true;
    setStatus('Modifiche da salvare…');
    updateBadge();
    clearTimeout(se.timer);
    se.timer = setTimeout(saveDraft, 1500);
    histRecord(!!(opts && opts.step));
    // While typing on the page, the page already shows the text: it is redrawn when the typing ends.
    if (!se.inline) schedulePreview(900);
  }

  function payload() {
    return {
      title: se.draft.title, description: se.draft.description, seo: se.draft.seo,
      blocks: se.draft.blocks.map(function (b) { var c = Object.assign({}, b); delete c.__error; return c; }),
    };
  }

  function saveGlobal() {
    var scope = se.gscope;
    se.dirty = false;
    setStatus('Salvataggio…');
    se.saving = api('PUT', '/site/globals/' + scope, { data: se.gdata, expected: se.gexpected }).then(function (res) {
      if (se.mode !== 'global' || se.gscope !== scope) return;
      se.gexpected = res.draftUpdatedAt;
      var s = se.globals.scopes[scope];
      s.draftUpdatedAt = res.draftUpdatedAt;
      if (!s.hasChanges) { s.hasChanges = true; renderPageList(); }
      hideBanner();
      setStatus(se.dirty ? 'Modifiche da salvare…' : 'Bozza salvata alle ' + timeNow(), se.dirty ? '' : 'ok');
      updateBadge();
    }).catch(function (e) {
      se.dirty = true;
      if (e.data && e.data.error === 'conflict') {
        setStatus('Non salvato', 'error');
        showBanner(e.message, { label: 'Ricarica', run: function () { se.dirty = false; openGlobal(scope); } });
        return;
      }
      setStatus('Non salvato: ' + e.message, 'error');
      showBanner('La bozza non è stata salvata: ' + e.message);
    }).then(function () {
      se.saving = false;
      if (se.again) { se.again = false; if (se.dirty) return saveDraft(); }
    });
    return se.saving;
  }

  function saveDraft() {
    clearTimeout(se.timer);
    if (!se.dirty) return Promise.resolve();
    if (se.saving) { se.again = true; return se.saving; }
    if (se.mode === 'global') return saveGlobal();
    if (!se.page) return Promise.resolve();
    var pageId = se.page.id;
    var body = payload();
    body.expected = se.expected;
    se.dirty = false;
    setStatus('Salvataggio…');
    se.saving = api('PUT', '/site/pages/' + pageId, body).then(function (res) {
      if (!se.page || se.page.id !== pageId) return;
      se.expected = res.draftUpdatedAt;
      // Keep the ids the server gave to new blocks.
      (res.draft.blocks || []).forEach(function (sb, i) { if (se.draft.blocks[i]) se.draft.blocks[i].id = sb.id; });
      var hadError = se.draft.blocks.some(function (b) { return b.__error; });
      se.draft.blocks.forEach(function (b) { delete b.__error; });
      se.page.hasChanges = true;
      var listed = se.pages.find(function (p) { return p.id === pageId; });
      if (listed && !listed.hasChanges) { listed.hasChanges = true; renderPageList(); }
      hideBanner();
      if (hadError) renderBlocks();
      setStatus(se.dirty ? 'Modifiche da salvare…' : 'Bozza salvata alle ' + timeNow(), se.dirty ? '' : 'ok');
      updateBadge();
    }).catch(function (e) {
      se.dirty = true;
      if (e.data && e.data.error === 'conflict') {
        setStatus('Non salvato', 'error');
        showBanner(e.message, { label: 'Ricarica la pagina', run: function () { se.dirty = false; openSitePage(pageId); } });
        return;
      }
      var m = /^Blocco (\d+)/.exec(e.message || '');
      if (m && se.draft.blocks[Number(m[1]) - 1]) {
        var idx = Number(m[1]) - 1;
        se.draft.blocks[idx].__error = e.message.replace(/^Blocco \d+ \([^)]*\)\s*–?\s*/, '');
        if (se.selected !== idx) se.selected = idx;
        renderBlocks();
      }
      setStatus('Non salvato: ' + e.message, 'error');
      showBanner('La bozza non è stata salvata: ' + e.message);
    }).then(function () {
      se.saving = false;
      if (se.again) { se.again = false; if (se.dirty) return saveDraft(); }
    });
    return se.saving;
  }

  function flushSave() {
    clearTimeout(se.timer);
    if (se.saving) return se.saving.then(flushSave);
    if (se.dirty) return saveDraft();
    return Promise.resolve();
  }

  // ---------- preview: the server's HTML, without scripts, in a sandboxed frame ----------
  function schedulePreview(ms) {
    clearTimeout(se.previewTimer);
    se.previewTimer = setTimeout(renderPreview, ms === undefined ? 900 : ms);
  }

  function renderPreview() {
    var body;
    if (se.mode === 'media') return;
    if (se.inline) { schedulePreview(600); return; }
    if (se.mode === 'global') {
      if (!se.gpreview || !se.gpreview.draft) return;
      var d = se.gpreview.draft;
      body = { pageId: se.gpreview.id, title: d.title, description: d.description, seo: d.seo, blocks: d.blocks };
      if (se.gscope === 'studio') body.studio = se.gdata;
      else body.globals = { header: se.gdata.header, footer: se.gdata.footer };
    } else {
      if (!se.page) return;
      body = payload();
      body.pageId = se.page.id;
    }
    var frames = $$('[data-se-frame]');
    api('POST', '/site/preview', body).then(function (res) {
      var html = String(res.html)
        .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
        .replace(/<html([^>]*)>/i, function (all, attrs) { return /class=/.test(attrs) ? all.replace(/class="/, 'class="is-staging is-preview ') : '<html' + attrs + ' class="is-staging is-preview">'; });
      frames.forEach(function (f) {
        var y = 0;
        try { y = f.contentWindow ? f.contentWindow.scrollY : 0; } catch (e) { y = 0; }
        f.onload = function () {
          try { f.contentWindow.scrollTo(0, y); } catch (e2) { /* ignore */ }
          // Clicking links inside the preview does nothing: it is only a picture of the page.
          try { f.contentDocument.addEventListener('click', function (ev) { if (ev.target.closest && ev.target.closest('a,button')) ev.preventDefault(); }, true); } catch (e3) { /* ignore */ }
          wirePreviewPick(f);
          fitFrame();
        };
        f.srcdoc = html;
      });
      $('[data-se-preview-msg]').textContent = '';
    }).catch(function (e) { $('[data-se-preview-msg]').textContent = 'Anteprima non aggiornata: ' + e.message; });
  }

  // Clicking a section of the preview selects its block, like a design tool.
  function wirePreviewPick(f) {
    try {
      var doc = f.contentDocument;
      // Header and footer are shared by every page of the language: a click opens their editor.
      [['header', doc.querySelector('.site-header')], ['footer', doc.querySelector('.site-footer')]].forEach(function (x) {
        var n = x[1];
        if (!n || se.mode === 'media' || (se.mode === 'global' && se.gscope === 'studio')) return;
        n.title = (x[0] === 'header' ? 'Intestazione' : 'Piè di pagina') + ': uguale in tutte le pagine. Clic per modificarla.';
        n.addEventListener('mouseenter', function () { n.style.outline = '2px solid rgba(31, 47, 58, .55)'; n.style.outlineOffset = '-2px'; n.style.cursor = 'pointer'; });
        n.addEventListener('mouseleave', function () { n.style.outline = ''; });
        n.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var dlg = $('[data-se-fullpreview]');
          if (dlg.open) dlg.close();
          if (se.mode === 'global') focusGlobalPart(x[0]); else openShared(x[0]);
        });
      });
      wireOnPage(f);
    } catch (e) { /* not loaded yet */ }
  }

  function scrollPreviewTo(i) {
    paintSelection();
    var b = i >= 0 && blockEl(frameDoc(canvasFrame()), i);
    if (b) b.scrollIntoView({ block: 'start' });
  }

  function fitFrame() {
    var wrap = $('[data-se-framewrap]');
    var f = $('[data-se-frame]', wrap);
    if (!wrap || !f) return;
    if (se.device === 'phone') {
      f.style.width = '390px'; f.style.transform = 'none'; f.style.height = '100%';
      wrap.classList.add('phone');
    } else {
      wrap.classList.remove('phone');
      var scale = Math.min(1, wrap.clientWidth / 1280);
      f.style.width = '1280px';
      f.style.transform = 'scale(' + scale + ')';
      f.style.height = (wrap.clientHeight / scale) + 'px';
    }
  }

  // ---------- publish and history ----------
  function publishGlobalDialog() {
    flushSave().then(function () {
      if (se.dirty) return;
      var scope = se.gscope;
      var dlg = el('dialog', { class: 'dlg' });
      var err = el('p', { class: 'status form-error', role: 'alert' });
      dlg.appendChild(el('div', { class: 'dlg-inner' }, [
        el('div', { class: 'dlg-head' }, [el('h2', { text: 'Pubblica: ' + GLOBAL_NAMES[scope] })]),
        el('p', { class: 'se-warn', text: 'Cambia tutte le pagine del sito' + (scope === 'studio' ? '.' : ' in ' + LANG_NAME[scope].toLowerCase() + '.') }),
        el('p', { class: 'hint', text: 'Controlla l\'anteprima prima di confermare.' }),
        err,
        el('div', { class: 'cta-row dlg-actions' }, [
          el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Pubblica su tutto il sito', onclick: function (e) {
            e.target.disabled = true;
            api('POST', '/site/globals/' + scope + '/publish', {}).then(function () {
              dlg.close();
              if (se.globals.scopes[scope]) se.globals.scopes[scope].hasChanges = false;
              renderPageList(); updateBadge();
              setStatus('Pubblicato alle ' + timeNow() + '.', 'ok');
            }).catch(function (e2) { e.target.disabled = false; err.textContent = e2.message; });
          } }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Annulla', onclick: function () { dlg.close(); } }),
        ]),
      ]));
      dlg.addEventListener('close', function () { dlg.remove(); });
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  function publishDialog() {
    if (se.mode === 'global') { publishGlobalDialog(); return; }
    flushSave().then(function () {
      if (se.dirty) return;
      var dlg = el('dialog', { class: 'dlg' });
      var err = el('p', { class: 'status form-error', role: 'alert' });
      dlg.appendChild(el('div', { class: 'dlg-inner' }, [
        el('div', { class: 'dlg-head' }, [el('h2', { text: 'Pubblica la pagina' })]),
        el('p', { text: '«' + pageName(se.page.key) + '» in ' + LANG_NAME[se.page.lang].toLowerCase() + ' andrà online così come la vedi nell\'anteprima.' }),
        el('p', { class: 'hint', text: 'Le note interne non vengono pubblicate. Potrai tornare a una versione precedente dallo Storico.' }),
        err,
        el('div', { class: 'cta-row dlg-actions' }, [
          el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Pubblica adesso', onclick: function (e) {
            e.target.disabled = true;
            api('POST', '/site/pages/' + se.page.id + '/publish', {}).then(function (r) {
              dlg.close();
              se.page.hasChanges = false;
              var listed = se.pages.find(function (p) { return p.id === se.page.id; });
              if (listed) listed.hasChanges = false;
              renderPageList(); updateBadge();
              setStatus(r.purged === false ? 'Pubblicata. Potrebbe servire qualche minuto prima di vederla online.' : 'Pubblicata alle ' + timeNow() + '.', 'ok');
            }).catch(function (e2) { e.target.disabled = false; err.textContent = e2.message; });
          } }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Annulla', onclick: function () { dlg.close(); } }),
        ]),
      ]));
      dlg.addEventListener('close', function () { dlg.remove(); });
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  function historyDialog() {
    var dlg = el('dialog', { class: 'dlg' });
    var list = el('ul', { class: 'se-history', role: 'list' }, [el('li', { class: 'hint', text: 'Caricamento…' })]);
    dlg.appendChild(el('div', { class: 'dlg-inner' }, [
      el('div', { class: 'dlg-head' }, [el('h2', { text: 'Storico della pagina' }), el('button', { type: 'button', class: 'round', 'aria-label': 'Chiudi', text: '×', onclick: function () { dlg.close(); } })]),
      el('p', { class: 'hint', text: 'Ogni pubblicazione resta qui. «Ripristina come bozza» rimette quella versione nell\'editor: va poi pubblicata.' }),
      list,
    ]));
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    flushSave().then(function () { return api('GET', '/site/pages/' + se.page.id + '/versions'); }).then(function (res) {
      list.textContent = '';
      if (!res.versions.length) list.appendChild(el('li', { class: 'hint', text: 'Nessuna versione.' }));
      res.versions.forEach(function (v) {
        list.appendChild(el('li', { class: 'row-card' }, [
          el('div', {}, [
            el('strong', { text: VERSION_KIND[v.kind] || v.kind }),
            el('p', { class: 'hint', text: new Date(v.createdAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) + (v.by ? ' · ' + v.by : '') }),
          ]),
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Ripristina come bozza', onclick: function () {
            if (!window.confirm('Sostituire la bozza attuale con questa versione? Le modifiche non pubblicate andranno perse.')) return;
            api('POST', '/site/pages/' + se.page.id + '/versions/' + v.id + '/restore', {}).then(function () {
              dlg.close();
              openSitePage(se.page.id).then(function () { setStatus('Versione ripristinata come bozza. Controlla l\'anteprima e pubblica.', 'ok'); });
            }).catch(function (e) { window.alert(e.message); });
          } }),
        ]));
      });
    }).catch(function (e) { list.textContent = ''; list.appendChild(el('li', { class: 'form-error', text: e.message })); });
  }

  // =====================================================================
  // ---------- on-page editing (editor v2) ----------
  // The preview has no scripts and stays sandboxed: everything below runs in the admin window and reaches
  // into the frame. The server marks editable fields only in the preview (data-edit-block, data-edit,
  // data-edit-kind, data-edit-para); what is typed goes back into se.draft as data and the server checks it.
  // =====================================================================
  var EDIT_CSS = '[data-edit-block]{cursor:pointer}'
    + '.ed-hov{outline:1px dashed rgba(44,85,115,.8)!important;outline-offset:3px}'
    + '.ed-blk-hov{box-shadow:inset 0 0 0 1px rgba(31,47,58,.3)!important}'
    + '.ed-blk-sel{box-shadow:inset 0 0 0 2px rgba(31,47,58,.85)!important}'
    + '.ed-sel{outline:2px solid #2C5573!important;outline-offset:3px}'
    + '[contenteditable]{outline:2px solid #2C5573!important;outline-offset:3px;cursor:text;caret-color:#1F2F3A}'
    + '.ed-plus{position:absolute;left:50%;z-index:2147483000;transform:translate(-50%,-50%);display:none;align-items:center;gap:6px;'
    + 'padding:6px 14px;border:0;border-radius:999px;background:#1F2F3A;color:#fff;font:600 13px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 0 0 4px rgba(255,255,255,.9)}'
    + '.ed-plus.on{display:inline-flex}';

  function isIndex(k) { return /^\d+$/.test(k); }
  function getPath(obj, path) {
    if (!path) return obj;
    return path.split('.').reduce(function (o, k) { return o == null ? o : o[isIndex(k) ? Number(k) : k]; }, obj);
  }
  function setPath(obj, path, v) {
    var ks = path.split('.');
    var last = ks.pop();
    var o = getPath(obj, ks.join('.'));
    if (o == null) return false;
    o[isIndex(last) ? Number(last) : last] = v;
    return true;
  }
  var FLOW_FIELDS = [{ name: 'text', label: 'Testo', type: 'rich', max: 1500 }, { name: 'source', label: 'Fonte', type: 'text', max: 120 }, { name: 'link', label: 'Link', type: 'link' }];
  // The definition of the field a path points to ({ item: true } when the path ends on a list index), or null.
  function fieldDef(fields, path) {
    var parts = String(path || '').split('.');
    var list = fields;
    var f = null;
    for (var i = 0; i < parts.length; i++) {
      f = (list || []).find(function (x) { return x.name === parts[i]; });
      if (!f) return null;
      if (i === parts.length - 1) return f;
      if (!isIndex(parts[i + 1])) return null;
      i += 1;
      if (i === parts.length - 1) return Object.assign({}, f, { item: true });
      if (f.type === 'list') list = f.fields;
      else if (f.type === 'flow') list = FLOW_FIELDS;
      else return null;
    }
    return f;
  }
  // The deepest list item that contains a path ("items.2" for "items.2.body.0.text"), or ''.
  function itemOf(fields, path) {
    var parts = String(path || '').split('.');
    for (var n = parts.length - 2; n >= 1; n--) {
      if (!isIndex(parts[n])) continue;
      var pre = parts.slice(0, n + 1).join('.');
      var f = fieldDef(fields, pre);
      if (f && f.item && f.type === 'list') return pre;
    }
    return '';
  }
  // Human names of the path, for the breadcrumb: [{ label, path }].
  function pathSteps(fields, path) {
    var steps = [];
    var parts = String(path || '').split('.');
    var list = fields;
    var acc = [];
    for (var i = 0; i < parts.length; i++) {
      var f = (list || []).find(function (x) { return x.name === parts[i]; });
      if (!f) break;
      acc.push(parts[i]);
      if (i + 1 < parts.length && isIndex(parts[i + 1])) {
        i += 1;
        acc.push(parts[i]);
        var n = Number(parts[i]) + 1;
        if (f.type === 'list') { steps.push({ label: (f.itemLabel || 'Voce') + ' ' + n, path: acc.join('.') }); list = f.fields; continue; }
        if (f.type === 'flow') { list = FLOW_FIELDS; steps.push({ label: f.label + ' · ' + n, path: acc.join('.'), noSelect: true }); continue; }
        steps.push({ label: f.label + ' · ' + n, path: acc.join('.') });
        break;
      }
      steps.push({ label: f.label, path: acc.join('.') });
    }
    return steps;
  }

  function canvasFrame() { return $('.ed-canvas [data-se-frame]'); }
  function frameDoc(f) { try { return f && f.contentDocument; } catch (e) { return null; } }
  function blockEl(doc, i) { return doc && doc.querySelector('[data-edit-block="' + i + '"]'); }
  function blockIndexOf(node) {
    var b = node && node.closest && node.closest('[data-edit-block]');
    return b ? Number(b.getAttribute('data-edit-block')) : -1;
  }
  function blockDef(i) { var b = se.draft && se.draft.blocks[i]; return b ? (se.library[b.type] || { label: b.type, fields: [] }) : null; }
  // Where an element of the frame is on the admin's screen (the frame is scaled to fit).
  function onScreen(f, r) {
    var fr = f.getBoundingClientRect();
    var sc = f.offsetWidth ? fr.width / f.offsetWidth : 1;
    return { left: fr.left + r.left * sc, top: fr.top + r.top * sc, width: r.width * sc, height: r.height * sc, right: fr.left + r.right * sc, bottom: fr.top + r.bottom * sc };
  }

  // Outline of the selected block and field in the canvas preview.
  function paintSelection() {
    var doc = frameDoc(canvasFrame());
    if (!doc || !doc.body) return;
    Array.prototype.forEach.call(doc.querySelectorAll('.ed-sel,.ed-blk-sel'), function (n) { n.classList.remove('ed-sel', 'ed-blk-sel'); });
    if (se.mode !== 'page' || se.selected < 0) return;
    var b = blockEl(doc, se.selected);
    if (!b) return;
    b.classList.add('ed-blk-sel');
    var p = se.sel.path;
    if (!p) return;
    Array.prototype.forEach.call(b.querySelectorAll('[data-edit]'), function (n) {
      if (n.getAttribute('data-edit') === p && blockIndexOf(n) === se.selected) n.classList.add('ed-sel');
    });
  }

  // Select a block (path '') or something inside it: a list item ("items.2") or a field ("items.2.title").
  function selectAt(i, path) {
    se.selected = i;
    se.sel.path = i >= 0 ? (path || '') : '';
    if (i >= 0 && se.tab !== 'blocks') setTab('blocks');
    renderBlocks();
    paintSelection();
    if (i >= 0) {
      var li = $('[data-se-block="' + i + '"]');
      if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
    }
    focusInspectorField();
  }
  // Esc: field → list item → block → nothing.
  function selectUp() {
    if (se.inline) { endInline(); return true; }
    if (se.mode !== 'page' || se.selected < 0) return false;
    var def = blockDef(se.selected);
    if (se.sel.path) {
      var item = itemOf(def.fields, se.sel.path);
      selectAt(se.selected, item);
      return true;
    }
    selectAt(-1, '');
    return true;
  }
  function focusInspectorField() {
    var p = se.sel.path;
    var box = $('[data-se-tab-blocks]');
    $$('.is-focus', box).forEach(function (n) { n.classList.remove('is-focus'); });
    if (!p) return;
    var name = p.split('.').filter(function (k) { return !isIndex(k); });
    var item = itemOf((blockDef(se.selected) || {}).fields, p);
    var key = item ? p.slice(item.length + 1).split('.')[0] : name[0];
    var target = $('[data-field="' + key + '"]', box);
    if (target) { target.classList.add('is-focus'); if (target.scrollIntoView) target.scrollIntoView({ block: 'nearest' }); }
  }

  // ---------- typing on the page ----------
  var ALLOWED_INPUT = /^(insertText|insertReplacementText|insertCompositionText|deleteContent\w*|deleteWord\w*|deleteSoftLine\w*|deleteHardLine\w*|deleteByCut|formatBold|formatItalic|insertParagraph|insertLineBreak|insertLink)$/;

  function hasTokens(v) { return JSON.stringify(v || '').indexOf('{{') >= 0; }

  function startInline(n, i, path, ev) {
    endInline();
    var b = se.draft.blocks[i];
    var def = blockDef(i);
    var f = fieldDef(def.fields, path);
    var kind = n.getAttribute('data-edit-kind');
    if (!f || !b) return;
    // Texts with the studio's details ({{contact.phone}}…) are edited in the panel, where the token stays a token.
    if (hasTokens(getPath(b.data, path))) { A.toast('Questo testo contiene i contatti dello studio: si modifica nel pannello a destra.'); return; }
    var doc = n.ownerDocument;
    var s = { n: n, i: i, path: path, kind: kind, para: Number(n.getAttribute('data-edit-para') || 0), count: 1, f: f, doc: doc, keep: false };
    se.inline = s;
    n.setAttribute('contenteditable', kind === 'text' ? 'plaintext-only' : 'true');
    if (kind === 'text' && n.contentEditable !== 'plaintext-only') n.setAttribute('contenteditable', 'true');
    n.setAttribute('spellcheck', 'true');
    n.setAttribute('role', 'textbox');
    n.setAttribute('aria-label', f.label || 'Testo');
    n.focus({ preventScroll: true });
    // The caret goes where the click was.
    try {
      if (ev && doc.caretRangeFromPoint) {
        var r = doc.caretRangeFromPoint(ev.clientX, ev.clientY);
        if (r && n.contains(r.startContainer)) { var sel = doc.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      }
    } catch (e) { /* the caret stays at the start */ }
    s.onBefore = function (e) {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); var redo = e.inputType === 'historyRedo'; endInline(); if (redo) redoStep(); else undoStep(); return; }
      if (!ALLOWED_INPUT.test(e.inputType)) { e.preventDefault(); return; }
      if ((e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') && s.kind !== 'rich') { e.preventDefault(); n.blur(); return; }
      if (s.kind === 'text' && /^format/.test(e.inputType)) { e.preventDefault(); return; }
      var max = s.f.item ? (s.f.itemMax || 240) : (s.f.max || 4000);
      if (/^insert/.test(e.inputType) && e.data && s.kind === 'text' && (n.textContent.length + e.data.length) > max) { e.preventDefault(); A.toast('Massimo ' + max + ' caratteri.'); }
    };
    s.onInput = function () { syncInline(); };
    s.onKey = function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endInline(); return; }
      if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) { e.preventDefault(); var redo = e.shiftKey || e.key === 'y'; endInline(); if (redo) redoStep(); else undoStep(); return; }
      if (s.kind !== 'text' && mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); inlineLink(); }
      if (e.key === 'Enter' && s.kind !== 'rich') { e.preventDefault(); n.blur(); }
    };
    s.onPaste = function (e) {
      e.preventDefault();
      if (s.kind === 'text') {
        var cd = e.clipboardData;
        var t = cd ? String(cd.getData('text/plain') || '').replace(/\s+/g, ' ').trim() : '';
        if (t) doc.execCommand('insertText', false, t);
        return;
      }
      var html = pastedHtml(e, s.kind === 'rich');
      if (html) doc.execCommand('insertHTML', false, html);
    };
    s.onDrop = function (e) { e.preventDefault(); };
    s.onBlur = function () { setTimeout(function () { if (se.inline === s && !s.keep) endInline(); }, 0); };
    n.addEventListener('beforeinput', s.onBefore);
    n.addEventListener('input', s.onInput);
    n.addEventListener('keydown', s.onKey);
    n.addEventListener('paste', s.onPaste);
    n.addEventListener('drop', s.onDrop);
    n.addEventListener('blur', s.onBlur);
    if (kind !== 'text') showRichBar();
  }

  // What is on the page goes back into the draft, as data.
  function syncInline() {
    var s = se.inline;
    if (!s) return;
    var b = se.draft.blocks[s.i];
    if (!b) return;
    if (s.kind === 'text') {
      setPath(b.data, s.path, s.n.textContent.replace(/ /g, ' ').replace(/[\r\n]+/g, ' '));
    } else {
      var paras = domToRuns(s.n, true);
      if (s.kind === 'inline') {
        var one = paras.reduce(function (a, p) { return a.concat(a.length ? [{ t: ' ' }] : [], p); }, []);
        setPath(b.data, s.path, { p: one.length ? [one] : [] });
      } else {
        var v = getPath(b.data, s.path);
        if (!v || !Array.isArray(v.p)) { v = { p: [] }; setPath(b.data, s.path, v); }
        Array.prototype.splice.apply(v.p, [s.para, s.count].concat(paras));
        s.count = paras.length;
      }
    }
    changed();
    if (s.kind !== 'text') placeRichBar();
    // The panel shows the same field: brought up to date shortly after typing pauses.
    clearTimeout(syncInline.t);
    syncInline.t = setTimeout(function () { if (se.inline === s) { renderInspector(); focusInspectorField(); } }, 400);
  }

  function endInline() {
    var s = se.inline;
    if (!s) return;
    se.inline = null;
    var n = s.n;
    n.removeEventListener('beforeinput', s.onBefore);
    n.removeEventListener('input', s.onInput);
    n.removeEventListener('keydown', s.onKey);
    n.removeEventListener('paste', s.onPaste);
    n.removeEventListener('drop', s.onDrop);
    n.removeEventListener('blur', s.onBlur);
    n.removeAttribute('contenteditable');
    n.removeAttribute('role');
    n.removeAttribute('aria-label');
    // Trim what was typed, like the panel does.
    var b = se.draft.blocks[s.i];
    if (b && s.kind === 'text') {
      var t = getPath(b.data, s.path);
      if (typeof t === 'string' && t !== t.trim()) setPath(b.data, s.path, t.trim());
    }
    hideRichBar();
    renderInspector();
    focusInspectorField();
    schedulePreview(120);
  }

  // Small floating bar over the text: bold, italic, link.
  var richBar = null;
  function showRichBar() {
    if (!richBar) {
      var mk = function (label, title, run, cls) {
        return el('button', { type: 'button', class: 'ed-rb-btn' + (cls ? ' ' + cls : ''), title: title, 'aria-label': title, text: label, onmousedown: function (e) { e.preventDefault(); run(); } });
      };
      richBar = el('div', { class: 'ed-richbar', role: 'toolbar', 'aria-label': 'Formato del testo' }, [
        mk('G', 'Grassetto (Ctrl/Cmd+B)', function () { inlineCmd('bold'); }, 'b'),
        mk('C', 'Corsivo (Ctrl/Cmd+I)', function () { inlineCmd('italic'); }, 'i'),
        mk('Link', 'Link (Ctrl/Cmd+K)', inlineLink),
        mk('Togli link', 'Togli il link', function () { inlineCmd('unlink'); }),
      ]);
      document.body.appendChild(richBar);
    }
    richBar.hidden = false;
    placeRichBar();
  }
  function placeRichBar() {
    var s = se.inline;
    if (!richBar || !s) return;
    var f = canvasFrame();
    if (!f || f.ownerDocument !== document || s.doc !== frameDoc(f)) { richBar.hidden = true; return; }
    var r = onScreen(f, s.n.getBoundingClientRect());
    var top = r.top - 44;
    if (top < 70) top = r.bottom + 8;
    richBar.style.top = Math.round(top + window.scrollY) + 'px';
    richBar.style.left = Math.round(Math.max(8, r.left)) + 'px';
  }
  function hideRichBar() { if (richBar) richBar.hidden = true; }
  function inlineCmd(name, arg) {
    var s = se.inline;
    if (!s) return;
    s.n.focus({ preventScroll: true });
    s.doc.execCommand(name, false, arg);
    syncInline();
  }
  function inlineLink() {
    var s = se.inline;
    if (!s) return;
    var sel = s.doc.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) { A.toast('Prima seleziona le parole da collegare.'); return; }
    var range = sel.getRangeAt(0).cloneRange();
    s.keep = true;
    var back = function () { s.keep = false; if (se.inline !== s) return; s.n.focus({ preventScroll: true }); var sl = s.doc.getSelection(); sl.removeAllRanges(); sl.addRange(range); };
    linkDialog(function (href) { back(); s.doc.execCommand('createLink', false, href); syncInline(); });
    var dlg = document.body.lastElementChild;
    if (dlg && dlg.nodeName === 'DIALOG') dlg.addEventListener('close', function () { setTimeout(function () { if (s.keep) back(); }, 0); });
  }

  // ---------- photos and links on the page ----------
  function replaceImage(i, path) {
    var b = se.draft.blocks[i];
    var f = fieldDef(blockDef(i).fields, path);
    if (!b || !f) return;
    var cur = getPath(b.data, path);
    pickMedia({ kind: 'image', role: f.role || 'content' }, function (m) {
      var v = Object.assign({}, m.value);
      v.alt = (cur && cur.alt) || (se.page.lang === 'en' ? m.altEn : m.altIt) || '';
      v.decorative = cur ? !!cur.decorative : false;
      setPath(b.data, path, v);
      changed({ step: true });
      renderBlocks();
      schedulePreview(0);
      A.toast('Foto sostituita. Controlla la descrizione nel pannello a destra.');
    });
  }

  function editLinkDialog(i, path) {
    var b = se.draft.blocks[i];
    var f = fieldDef(blockDef(i).fields, path);
    var cur = b && getPath(b.data, path);
    if (!f || !cur) return;
    var work = clone(cur);
    var styles = f.styles || null;
    var isBtn = f.type === 'button' || f.type === 'buttons';
    var dlg = el('dialog', { class: 'dlg' });
    var box = el('div', { class: 'se-fields' }, [linkEditor(work, { styles: isBtn ? styles : null }, function () {})]);
    dlg.appendChild(el('div', { class: 'dlg-inner' }, [
      el('div', { class: 'dlg-head' }, [el('h2', { text: isBtn ? 'Pulsante' : 'Link' }), el('button', { type: 'button', class: 'round', 'aria-label': 'Chiudi', text: '×', onclick: function () { dlg.close(); } })]),
      box,
      el('div', { class: 'cta-row dlg-actions' }, [
        el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Fatto', onclick: function () {
          if (!String(work.label || '').trim()) { A.toast('Scrivi il testo del ' + (isBtn ? 'pulsante.' : 'link.'), 'error'); return; }
          setPath(b.data, path, work);
          dlg.close();
          changed({ step: true });
          renderBlocks();
          schedulePreview(0);
        } }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Annulla', onclick: function () { dlg.close(); } }),
      ]),
    ]));
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- the preview: hover, click, "+" between blocks ----------
  function wireOnPage(f) {
    var doc = frameDoc(f);
    if (!doc || !doc.body || se.mode !== 'page') return;
    var inDialog = !!f.closest('dialog');
    var st = doc.createElement('style');
    st.textContent = EDIT_CSS;
    (doc.head || doc.body).appendChild(st);
    var hov = [];
    function clearHover() { hov.forEach(function (n) { n.classList.remove('ed-hov', 'ed-blk-hov'); }); hov = []; }
    var plus = null;
    if (!inDialog) {
      plus = doc.createElement('button');
      plus.type = 'button';
      plus.className = 'ed-plus';
      plus.textContent = '+ Aggiungi un blocco qui';
      doc.body.appendChild(plus);
      plus.addEventListener('mousedown', function (e) { e.preventDefault(); });
      plus.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); addBlockDialog(Number(plus.getAttribute('data-at'))); });
    }
    doc.addEventListener('mouseover', function (e) {
      if (se.inline) return;
      clearHover();
      var t = e.target;
      var bi = blockIndexOf(t);
      if (bi < 0) return;
      var b = blockEl(doc, bi);
      var n = t.closest('[data-edit]');
      if (b) { b.classList.add('ed-blk-hov'); hov.push(b); }
      if (n && blockIndexOf(n) === bi) { n.classList.add('ed-hov'); hov.push(n); }
    });
    doc.addEventListener('mouseleave', clearHover);
    if (plus) {
      doc.addEventListener('mousemove', function (e) {
        if (se.inline) { plus.classList.remove('on'); return; }
        if (e.target === plus) return;
        var bi = blockIndexOf(e.target);
        var b = bi >= 0 && blockEl(doc, bi);
        if (!b) { plus.classList.remove('on'); return; }
        var r = b.getBoundingClientRect();
        var edge = Math.min(36, r.height / 4);
        var at = e.clientY - r.top < edge ? bi : (r.bottom - e.clientY < edge ? bi + 1 : -1);
        if (at < 0) { plus.classList.remove('on'); return; }
        var y = (at === bi ? r.top : r.bottom) + (doc.defaultView.scrollY || 0);
        plus.style.top = y + 'px';
        plus.setAttribute('data-at', String(at));
        plus.classList.add('on');
      });
    }
    doc.addEventListener('click', function (e) {
      if (plus && e.target === plus) return;
      var t = e.target;
      if (se.inline && se.inline.n.contains(t)) return;   // clicks inside the text being typed move the caret
      var bi = blockIndexOf(t);
      if (bi < 0) { if (se.inline) endInline(); return; }
      e.preventDefault();
      var n = t.closest('[data-edit]');
      if (n && blockIndexOf(n) !== bi) n = null;
      var path = n ? n.getAttribute('data-edit') : '';
      var kind = n ? n.getAttribute('data-edit-kind') : '';
      if (se.inline) endInline();
      // Telephone-sized screens: the preview is a full-screen picture; the click opens the field in the panel.
      if (inDialog) {
        var dlg = $('[data-se-fullpreview]');
        if (dlg.open) dlg.close();
        selectAt(bi, kind === 'link' || kind === 'image' ? path : path);
        return;
      }
      selectAt(bi, path);
      if (!n) return;
      if (kind === 'text' || kind === 'rich' || kind === 'inline') {
        // The real element again: selectAt re-rendered the panel, not the preview.
        startInline(n, bi, path, e);
      } else if (kind === 'link') editLinkDialog(bi, path);
      else if (kind === 'image') replaceImage(bi, path);
    });
    doc.addEventListener('keydown', function (e) { if (!se.inline) editorKeys(e); });
    doc.addEventListener('scroll', function () { placeRichBar(); }, { passive: true });
    if (!inDialog) paintSelection();
  }

  // ---------- undo and redo: the last 100 changes of what is open ----------
  var hist = { undo: [], redo: [], last: null, lastAt: 0 };
  function histState() { return se.mode === 'global' ? se.gdata : se.draft; }
  function histReset() {
    hist.undo = []; hist.redo = []; hist.lastAt = 0;
    hist.last = histState() ? JSON.stringify(histState()) : null;
    updateHistButtons();
  }
  // Typing in the same second is one step; moving, adding, removing, photos and links are a step each.
  function histRecord(step) {
    var state = histState();
    if (!state) return;
    var cur = JSON.stringify(state);
    if (cur === hist.last) return;
    var now = Date.now();
    if (hist.last !== null && (step || !hist.lastAt || now - hist.lastAt > 1000)) {
      hist.undo.push(hist.last);
      if (hist.undo.length > 100) hist.undo.shift();
    }
    hist.redo = [];
    hist.last = cur;
    hist.lastAt = step ? 0 : now;
    updateHistButtons();
  }
  function applyHist(json) {
    hist.last = json;
    hist.lastAt = 0;
    if (se.mode === 'global') { se.gdata = JSON.parse(json); renderGlobalEditor(); }
    else {
      se.draft = JSON.parse(json);
      if (se.selected >= se.draft.blocks.length) se.selected = -1;
      se.sel.path = '';
      renderBlocks();
    }
    se.dirty = true;
    setStatus('Modifiche da salvare…');
    updateBadge();
    clearTimeout(se.timer);
    se.timer = setTimeout(saveDraft, 1500);
    schedulePreview(150);
    updateHistButtons();
  }
  function undoStep() { if (se.inline) endInline(); if (!hist.undo.length) return; hist.redo.push(hist.last); applyHist(hist.undo.pop()); }
  function redoStep() { if (se.inline) endInline(); if (!hist.redo.length) return; hist.undo.push(hist.last); applyHist(hist.redo.pop()); }
  function updateHistButtons() {
    var u = $('[data-se-undo]'), r = $('[data-se-redo]');
    if (u) u.disabled = !hist.undo.length;
    if (r) r.disabled = !hist.redo.length;
  }

  // Keys that work anywhere in the editor (except while typing in a field of the panel).
  function editorKeys(e) {
    if (!document.body.classList.contains('is-editor') || document.querySelector('dialog[open]')) return;
    var t = e.target;
    var typing = t && (t.nodeName === 'INPUT' || t.nodeName === 'TEXTAREA' || t.nodeName === 'SELECT' || t.isContentEditable);
    var mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
      if (typing) return;   // the field's own undo
      e.preventDefault();
      if (e.shiftKey || e.key === 'y' || e.key === 'Y') redoStep(); else undoStep();
      return;
    }
    if (e.key === 'Escape' && !typing && $('[data-ed-pop]').hidden) {
      if (selectUp()) e.preventDefault();
    }
  }
  document.addEventListener('keydown', editorKeys);

  // ---------- delete with "Annulla" ----------
  function undoToast(msg, onUndo) {
    var box = document.querySelector('.toasts');
    if (!box) { box = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(box); }
    var t = el('div', { class: 'toast toast-undo' });
    var done = false;
    var close = function () { if (done) return; done = true; t.classList.add('out'); setTimeout(function () { t.remove(); }, 400); };
    t.appendChild(el('span', { text: msg }));
    t.appendChild(el('button', { type: 'button', class: 'toast-action', 'data-toast-undo': true, text: 'Annulla', onclick: function () { if (done) return; onUndo(); close(); } }));
    box.appendChild(t);
    setTimeout(close, 10000);
    return t;
  }

  // ---------- "N modifiche da pubblicare" ----------
  function pendingItems() {
    var items = [];
    var named = {};
    se.pages.forEach(function (p) { named[p.key] = (named[p.key] || 0) + 1; });
    se.pages.forEach(function (p) {
      if (p.hasChanges) items.push({ id: 'page-' + p.id, label: pageName(p.key) + (named[p.key] > 1 ? ' (' + p.lang.toUpperCase() + ')' : ''), sub: p.path, url: '/site/pages/' + p.id + '/publish', open: function () { openSitePage(p.id); } });
    });
    var sc = (se.globals && se.globals.scopes) || {};
    ['it', 'en', 'studio'].forEach(function (k) {
      if (sc[k] && sc[k].hasChanges) items.push({ id: 'global-' + k, label: GLOBAL_NAMES[k] + (k === 'studio' ? '' : ' (' + k.toUpperCase() + ')'), sub: k === 'studio' ? 'Tutte le pagine' : 'Tutte le pagine in ' + LANG_NAME[k].toLowerCase(), url: '/site/globals/' + k + '/publish', open: function () { openGlobal(k); } });
    });
    return items;
  }
  function updateChangesButton() {
    var b = $('[data-se-changes]');
    if (!b) return;
    var n = pendingItems().length;
    b.textContent = n ? (n === 1 ? '1 modifica da pubblicare' : n + ' modifiche da pubblicare') : 'Tutto pubblicato';
    b.classList.toggle('has-changes', n > 0);
  }
  function refreshPublishState() {
    return Promise.all([api('GET', '/site/pages'), loadGlobals()]).then(function (all) {
      se.pages = all[0].pages;
      if (se.page) { var me = se.pages.find(function (p) { return p.id === se.page.id; }); if (me) se.page.hasChanges = me.hasChanges; }
      renderPageList();
      updateBadge();
      updateChangesButton();
    });
  }
  function changesDialog() {
    flushSave().then(refreshPublishState).then(function () {
      var items = pendingItems();
      var dlg = el('dialog', { class: 'dlg se-changes-dlg' });
      var err = el('p', { class: 'status form-error', role: 'alert' });
      var list = el('ul', { class: 'se-changes-list', role: 'list' });
      var boxes = {};
      items.forEach(function (x) {
        var cb = el('input', { type: 'checkbox', id: 'pub-' + x.id, checked: true });
        boxes[x.id] = cb;
        list.appendChild(el('li', {}, [
          cb,
          el('label', { for: 'pub-' + x.id }, [el('strong', { text: x.label }), el('small', { text: x.sub })]),
          el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Vedi', onclick: function () { dlg.close(); x.open(); } }),
        ]));
      });
      var publish = function (sel, btnEl) {
        if (!sel.length) { err.textContent = 'Scegli almeno una voce.'; return; }
        $$('button', dlg).forEach(function (b) { b.disabled = true; });
        err.textContent = '';
        var done = 0;
        sel.reduce(function (p, x) {
          return p.then(function () { btnEl.textContent = 'Pubblico… ' + (done + 1) + ' di ' + sel.length; return api('POST', x.url, {}); }).then(function () { done += 1; });
        }, Promise.resolve()).then(function () {
          dlg.close();
          A.toast(done === 1 ? 'Pubblicata 1 voce.' : 'Pubblicate ' + done + ' voci.');
          setStatus('Pubblicato alle ' + timeNow() + '.', 'ok');
        }).catch(function (e) {
          err.textContent = (done ? 'Pubblicate ' + done + ' voci, poi: ' : '') + e.message;
          $$('button', dlg).forEach(function (b) { b.disabled = false; });
        }).then(refreshPublishState);
      };
      var selBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-small', 'data-pub-selected': true, text: 'Pubblica selezionate', onclick: function () { publish(items.filter(function (x) { return boxes[x.id].checked; }), selBtn); } });
      var allBtn = el('button', { type: 'button', class: 'btn btn-primary btn-small', 'data-pub-all': true, text: 'Pubblica tutto', onclick: function () { publish(items, allBtn); } });
      dlg.appendChild(el('div', { class: 'dlg-inner' }, [
        el('div', { class: 'dlg-head' }, [el('h2', { text: items.length ? 'Da pubblicare' : 'Tutto pubblicato' }), el('button', { type: 'button', class: 'round', 'aria-label': 'Chiudi', text: '×', onclick: function () { dlg.close(); } })]),
        items.length
          ? el('p', { class: 'hint', text: 'Queste pagine e parti del sito hanno modifiche salvate in bozza ma non ancora online. Pubblicando, vanno online così come le vedi nell\'anteprima.' })
          : el('p', { class: 'hint', text: 'Non ci sono modifiche in bozza: il sito online è uguale a quello che vedi qui.' }),
        items.length ? list : null,
        err,
        items.length ? el('div', { class: 'cta-row dlg-actions' }, [allBtn, selBtn, el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Annulla', onclick: function () { dlg.close(); } })]) : null,
      ]));
      dlg.addEventListener('close', function () { dlg.remove(); });
      document.body.appendChild(dlg);
      dlg.showModal();
    }).catch(function (e) { showBanner(e.message); });
  }

  // ---------- reordering in the list: drag and drop, Alt+↑/↓ ----------
  var dragFrom = -1;
  function wireListItem(li, i, pick) {
    li.setAttribute('draggable', 'true');
    li.addEventListener('dragstart', function (e) {
      dragFrom = i;
      li.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (x) { /* ignore */ }
    });
    li.addEventListener('dragend', function () { dragFrom = -1; li.classList.remove('dragging'); $$('.drop-before,.drop-after').forEach(function (n) { n.classList.remove('drop-before', 'drop-after'); }); });
    li.addEventListener('dragover', function (e) {
      if (dragFrom < 0) return;
      e.preventDefault();
      var r = li.getBoundingClientRect();
      var after = e.clientY > r.top + r.height / 2;
      li.classList.toggle('drop-after', after);
      li.classList.toggle('drop-before', !after);
    });
    li.addEventListener('dragleave', function () { li.classList.remove('drop-before', 'drop-after'); });
    li.addEventListener('drop', function (e) {
      if (dragFrom < 0) return;
      e.preventDefault();
      var after = li.classList.contains('drop-after');
      li.classList.remove('drop-before', 'drop-after');
      var to = i + (after ? 1 : 0);
      if (to > dragFrom) to -= 1;
      moveBlockTo(dragFrom, to);
      dragFrom = -1;
    });
    pick.addEventListener('keydown', function (e) {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      var d = e.key === 'ArrowUp' ? -1 : 1;
      if (i + d < 0 || i + d >= se.draft.blocks.length) return;
      moveBlockTo(i, i + d);
      var again = $('[data-se-block="' + (i + d) + '"] .se-block-pick');
      if (again) again.focus();
    });
  }
  function moveBlockTo(from, to) {
    var blocks = se.draft.blocks;
    if (from === to || from < 0 || to < 0 || to >= blocks.length) return;
    var b = blocks.splice(from, 1)[0];
    blocks.splice(to, 0, b);
    if (se.selected === from) se.selected = to;
    else if (se.selected > from && se.selected <= to) se.selected -= 1;
    else if (se.selected < from && se.selected >= to) se.selected += 1;
    changed({ step: true });
    renderBlocks();
    var label = (se.library[b.type] || {}).label || b.type;
    var live = $('[data-se-live]');
    if (live) live.textContent = '«' + label + '» spostato in posizione ' + (to + 1) + ' di ' + blocks.length + '.';
  }

  // ---------- wiring ----------
  (function wireSiteEditor() {
    var root = $('[data-panel="sito"]');
    if (!root) return;
    $('[data-ed-pick]').addEventListener('click', function (e) {
      e.stopPropagation();
      var pop = $('[data-ed-pop]');
      pop.hidden = !pop.hidden;
      this.setAttribute('aria-expanded', String(!pop.hidden));
      if (!pop.hidden) { $('[data-ed-search]').value = ''; renderPicker(); $('[data-ed-search]').focus(); }
    });
    $('[data-ed-search]').addEventListener('input', renderPicker);
    $('[data-ed-search]').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var first = $('[data-ed-results] .ed-entry'); if (first) { e.preventDefault(); first.click(); } }
      if (e.key === 'ArrowDown') { var f2 = $('[data-ed-results] .ed-entry'); if (f2) { e.preventDefault(); f2.focus(); } }
    });
    $('[data-ed-results]').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var all = $$('[data-ed-results] .ed-entry');
      var i = all.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      if (e.key === 'ArrowDown' && all[i + 1]) all[i + 1].focus();
      if (e.key === 'ArrowUp') { if (all[i - 1]) all[i - 1].focus(); else $('[data-ed-search]').focus(); }
    });
    $$('[data-ed-ltab]').forEach(function (b) {
      b.addEventListener('click', function () { se.ltab = b.getAttribute('data-ed-ltab'); setLTab(se.ltab); });
    });
    $$('[data-se-tab]').forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-se-tab')); }); });
    $('[data-se-add]').addEventListener('click', function () { addBlockDialog(); });
    $('[data-se-undo]').addEventListener('click', undoStep);
    $('[data-se-redo]').addEventListener('click', redoStep);
    $('[data-se-changes]').addEventListener('click', changesDialog);
    window.addEventListener('scroll', placeRichBar, { passive: true });
    window.addEventListener('resize', placeRichBar);
    $('[data-se-publish]').addEventListener('click', publishDialog);
    $('[data-se-history]').addEventListener('click', historyDialog);
    $('[data-se-ref]').addEventListener('click', function (e) {
      se.refOpen = !se.refOpen;
      e.currentTarget.setAttribute('aria-pressed', String(se.refOpen));
      if (se.refOpen) loadReference(); else $('[data-se-refbox]').hidden = true;
    });
    $$('[data-se-device]').forEach(function (b) {
      b.addEventListener('click', function () {
        se.device = b.getAttribute('data-se-device');
        $$('[data-se-device]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        fitFrame();
        schedulePreview(0);
      });
    });
    $('[data-se-openpreview]').addEventListener('click', function () {
      var dlg = $('[data-se-fullpreview]');
      dlg.showModal();
      schedulePreview(0);
    });
    $('[data-se-closepreview]').addEventListener('click', function () { $('[data-se-fullpreview]').close(); });
    window.addEventListener('resize', fitFrame);
    window.addEventListener('beforeunload', function (e) {
      if (se.dirty || se.saving) { e.preventDefault(); e.returnValue = ''; }
    });
  })();

})(window.BloomingAdmin = window.BloomingAdmin || {});
