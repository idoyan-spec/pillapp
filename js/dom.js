// ============================================================
//  dom.js  —  עזרי DOM, טוסטים, גיליון תחתון
// ============================================================
export const $ = sel => document.querySelector(sel);
export const $$ = sel => Array.prototype.slice.call(document.querySelectorAll(sel));

export function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function el(tag, attrs, children) {
  const n = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k === 'text') n.textContent = attrs[k];
    else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
    else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
  }
  (children || []).forEach(c => { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return n;
}

// ---------- טוסטים ----------
export function toast(text, kind, long) {
  const box = $('#toasts');
  const t = el('div', { class: 'toast ' + (kind || ''), text: text });
  box.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s, transform .3s';
    t.style.opacity = '0'; t.style.transform = 'translateY(10px)';
    setTimeout(() => t.remove(), 320);
  }, long ? 7000 : 3400);
}

document.addEventListener('pill:toast', e => toast(e.detail.text, e.detail.kind, e.detail.long));

// ---------- גיליון תחתון ----------
let sheetOnClose = null;

export function openSheet(title, buildBody, onClose, headerAction) {
  $('#sheetTitle').textContent = title;
  const head = $('#sheetPanel').querySelector('.sheet-head');
  const oldAction = head.querySelector('.sheet-action');
  if (oldAction) oldAction.remove();
  if (headerAction) {
    headerAction.classList.add('sheet-action');
    head.insertBefore(headerAction, head.querySelector('.sheet-close'));
  }
  const body = $('#sheetBody');
  body.innerHTML = '';
  const content = buildBody();
  if (typeof content === 'string') body.innerHTML = content;
  else if (content) body.appendChild(content);
  $('#sheet').classList.remove('hidden');
  $('#sheetPanel').scrollTop = 0;
  sheetOnClose = onClose || null;
  document.body.style.overflow = 'hidden';
}

export function closeSheet() {
  $('#sheet').classList.add('hidden');
  document.body.style.overflow = '';
  if (sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; f(); }
}

export function sheetIsOpen() { return !$('#sheet').classList.contains('hidden'); }

export function setSheetBody(node) {
  const body = $('#sheetBody');
  body.innerHTML = '';
  if (typeof node === 'string') body.innerHTML = node;
  else if (node) body.appendChild(node);
}

// ---------- דיאלוג עצמאי ----------
// לא משתמש ב-openSheet כדי שאפשר יהיה לפתוח אותו מעל גיליון פתוח
// בלי לאבד את מה שכבר הוקלד בו.
function modal(title, buildBody, onDismiss) {
  const back = el('div', {
    class: 'sheet', style: 'z-index:110',
    onclick: e => { if (e.target === back) { close(); if (onDismiss) onDismiss(); } }
  });
  const panel = el('div', { class: 'sheet-panel', style: 'max-height:80vh' });
  panel.appendChild(el('div', { class: 'grab' }));
  const head = el('div', { class: 'sheet-head' });
  head.appendChild(el('h2', { text: title }));
  head.appendChild(el('button', {
    class: 'sheet-close', html: '✕', 'aria-label': 'סגירה',
    onclick: () => { close(); if (onDismiss) onDismiss(); }
  }));
  panel.appendChild(head);
  const body = el('div');
  panel.appendChild(body);
  back.appendChild(panel);
  document.body.appendChild(back);
  function close() { back.remove(); }
  body.appendChild(buildBody(close));
  return close;
}

export function confirmBig(question, okLabel, danger) {
  return new Promise(resolve => {
    let answered = false;
    const done = v => { answered = true; resolve(v); };
    modal('רגע לפני', close => {
      const wrap = el('div');
      wrap.appendChild(el('p', { text: question, style: 'font-size:1.15em;font-weight:700' }));
      const row = el('div', { class: 'row', style: 'margin-top:18px' });
      row.appendChild(el('button', {
        class: 'btn grow ' + (danger ? 'danger' : ''), text: okLabel || 'כן',
        onclick: () => { close(); done(true); }
      }));
      row.appendChild(el('button', {
        class: 'btn ghost grow', text: 'ביטול',
        onclick: () => { close(); done(false); }
      }));
      wrap.appendChild(row);
      return wrap;
    }, () => { if (!answered) resolve(false); });
  });
}

/** קלט טקסט גדול ונוח */
export function promptBig(title, label, initial, multiline) {
  return new Promise(resolve => {
    let answered = false;
    modal(title, close => {
      const wrap = el('div');
      const input = multiline ? el('textarea', { rows: 6 }) : el('input', { type: 'text' });
      input.value = initial || '';
      wrap.appendChild(el('label', { class: 'field' }, [el('span', { class: 'lbl', text: label }), input]));
      wrap.appendChild(el('button', {
        class: 'btn block', text: 'שמירה',
        onclick: () => { answered = true; close(); resolve(input.value); }
      }));
      setTimeout(() => { input.focus(); input.select(); }, 120);
      return wrap;
    }, () => { if (!answered) resolve(null); });
  });
}
