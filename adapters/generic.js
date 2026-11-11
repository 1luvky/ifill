// adapters/generic.js - heuristic adapter that works on most quiz pages.
// Injected into the page as a classic script; registers on globalThis.QuizQAAdapters.
//
// Finds choice widgets (native radio/checkbox/select, or ARIA role=radio/checkbox
// as used by Google Forms), groups them into questions, and finds each question's text.
//
// Adapter interface (all adapters):
//   detectPlatform()          -> number 0..1 (how sure this adapter fits the page)
//   extractQuestions()        -> [{id, index, type, text, options:[{id,text,hasImage}], hasImages, needsScreenshot}]
//   selectAnswer(q, optId, checked=true) -> Promise<{ok, before, after}>
//   isChecked(q, optId)       -> boolean
//   getElements(q)            -> {container, options:[el]}   (for image capture / highlighting)
//   findNextButton()          -> element | null
//   goNextPage()              -> boolean (clicked a Next button?)
//   findSubmitButton()        -> element | null
//   submit()                  -> boolean (only ever called after the user confirms)
//   isResultsPage()           -> boolean
//   scrapeResults()           -> {score:{earned,total,percent}|null, questions:[]}
(() => {
  const OPTION_SELECTOR = [
    'input[type=radio]', 'input[type=checkbox]',
    '[role=radio]', '[role=checkbox]', '[role=menuitemradio]',
  ].join(',');
  const GROUP_SELECTOR = '[role=radiogroup],[role=group],fieldset,[role=listbox]';
  const STOP_AT = '[role=listitem],fieldset,li,section,article';
  const NEXT_RE = /^\s*(next|next page|continue|weiter|suivant|siguiente|próximo|avanti)\s*[›>→]?\s*$/i;
  const SUBMIT_RE = /^\s*(submit|submit quiz|submit all and finish|finish|finish attempt|send|turn in|done|absenden|envoyer|enviar)\s*$/i;
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /** id -> {container, optionEls[], selectEl} from the latest extractQuestions(). */
  let refs = new Map();

  // ---------------- helpers ----------------

  const isOurs = (el) => !!el.closest('[data-quizqa-ui]');
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function visible(el) {
    if (!el.isConnected) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    // Native inputs are often visually hidden behind a styled label; judge by the label then.
    if (el.tagName === 'INPUT') {
      const lab = labelFor(el);
      if (lab) return lab.getClientRects().length > 0;
    }
    return el.getClientRects().length > 0;
  }

  function labelFor(input) {
    if (input.id) {
      const l = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (l) return l;
    }
    return input.closest('label');
  }

  function textOfIds(ids) {
    return clean((ids || '').split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '));
  }

  function hasImageIn(el) {
    return !!el && !!el.querySelector('img, svg, canvas, picture, [style*="background-image"]');
  }

  function hash(str) { // djb2 -> short base36 id, stable across reloads
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function isNativeChoice(el) { return el.tagName === 'INPUT'; }

  function kindOf(el) {
    if (isNativeChoice(el)) return el.type; // radio | checkbox
    const r = el.getAttribute('role');
    return r === 'checkbox' ? 'checkbox' : 'radio';
  }

  // ---------------- finding options and grouping ----------------

  function findOptionEls() {
    const all = [...document.querySelectorAll(OPTION_SELECTOR)].filter((el) => !isOurs(el));
    return all.filter((el) => {
      // Skip ARIA wrappers that contain a native input (avoid counting twice).
      if (!isNativeChoice(el) && el.querySelector('input[type=radio],input[type=checkbox]')) return false;
      // Skip native inputs that sit inside an ARIA option (the ARIA one is the real control).
      if (isNativeChoice(el) && el.parentElement?.closest('[role=radio],[role=checkbox]')) return false;
      return visible(el);
    });
  }

  function groupOptions(optionEls) {
    const groups = new Map(); // key -> {key, groupEl, kind, els[]}
    const add = (key, groupEl, el) => {
      if (!groups.has(key)) groups.set(key, { key, groupEl, kind: kindOf(el), els: [] });
      groups.get(key).els.push(el);
    };
    const leftovers = [];
    for (const el of optionEls) {
      if (isNativeChoice(el) && el.type === 'radio' && el.name) {
        add(`name:${el.form ? 'f' : ''}:${el.name}`, el.closest(GROUP_SELECTOR) || null, el);
        continue;
      }
      const g = el.closest(GROUP_SELECTOR);
      if (g && !isOurs(g)) { add(g, g, el); continue; }
      leftovers.push(el);
    }
    // No explicit group: use the lowest ancestor that holds 2+ leftover options.
    for (const el of leftovers) {
      let a = el.parentElement, found = null;
      while (a && a !== document.body) {
        const n = leftovers.filter((o) => a.contains(o)).length;
        if (n >= 2) { found = a; break; }
        a = a.parentElement;
      }
      add(found || el, found, el);
    }
    return [...groups.values()];
  }

  /** Grow from the group up to the largest ancestor that is still "just this question". */
  function findContainer(group, allOptionEls) {
    let node = group.groupEl || commonAncestor(group.els);
    const mine = new Set(group.els);
    while (node && node.parentElement && node.parentElement !== document.body) {
      if (node.matches(STOP_AT)) break;
      const parent = node.parentElement;
      const foreignOption = allOptionEls.some((o) => !mine.has(o) && parent.contains(o));
      const otherInputs = parent.querySelector('textarea, input[type=text], input:not([type]), select, [role=listbox]');
      const navButton = [...parent.querySelectorAll('button, [role=button], input[type=submit]')]
        .some((b) => NEXT_RE.test(buttonText(b)) || SUBMIT_RE.test(buttonText(b)));
      if (foreignOption || (otherInputs && !node.contains(otherInputs)) || navButton) break;
      node = parent;
    }
    return node;
  }

  function commonAncestor(els) {
    let a = els[0].parentElement;
    while (a && !els.every((e) => a.contains(e))) a = a.parentElement;
    return a || document.body;
  }

  // ---------------- text ----------------

  function optionText(el) {
    let t = '';
    if (isNativeChoice(el)) {
      t = el.getAttribute('aria-label') || textOfIds(el.getAttribute('aria-labelledby'));
      if (!t) { const lab = labelFor(el); if (lab) t = lab.innerText; }
      if (!t && el.value && !/^on$/i.test(el.value)) t = el.value;
    } else {
      t = el.getAttribute('aria-label') || textOfIds(el.getAttribute('aria-labelledby')) || el.innerText;
      if (!clean(t)) t = el.getAttribute('data-value') || '';
    }
    return clean(t);
  }

  function optionImageHost(el) {
    if (isNativeChoice(el)) return labelFor(el) || el.parentElement;
    return el;
  }

  function cleanQuestionText(t) {
    return clean(t)
      .replace(/\s*\*\s*$/, '')                          // required marker
      .replace(/\b\d+(\.\d+)?\s*points?\b/gi, '')         // "1 point"
      .replace(/\bRequired( question)?\b/gi, '')
      .trim()
      .slice(0, 2000);
  }

  function questionText(container, group) {
    const g = group.groupEl;
    let t = '';
    if (g) t = textOfIds(g.getAttribute('aria-labelledby')) || (g.tagName === 'FIELDSET' && g.querySelector('legend')?.innerText) || '';
    if (!t) {
      const h = container.querySelector('[role=heading], h1, h2, h3, h4, h5, h6, legend');
      if (h && !group.els.some((o) => h.contains(o))) t = h.innerText;
    }
    if (!t && g) t = g.getAttribute('aria-label') || '';
    if (!t) {
      // Fall back to the container's text minus the options' text.
      let all = container.innerText || '';
      for (const o of group.els) {
        const ot = optionText(o);
        if (ot) all = all.replace(ot, ' ');
      }
      t = all;
    }
    return cleanQuestionText(t);
  }

  function buttonText(b) {
    return clean(b.innerText || b.value || b.getAttribute('aria-label') || '');
  }

  // ---------------- interface ----------------

  function detectPlatform() {
    return 0.1; // always usable, lowest priority
  }

  function extractQuestions() {
    refs = new Map();
    const optionEls = findOptionEls();
    const groups = groupOptions(optionEls);
    const items = [];

    for (const group of groups) {
      const container = findContainer(group, optionEls);
      const text = questionText(container, group);
      const options = group.els.map((el, i) => ({
        id: LETTERS[i] || String(i + 1),
        text: optionText(el),
        hasImage: hasImageIn(optionImageHost(el)),
      }));
      let type = group.kind === 'checkbox' ? 'multi' : 'single';
      if (type === 'single' && options.length === 2
          && options.every((o) => /^(true|false|yes|no|richtig|falsch|vrai|faux|verdadero|falso)$/i.test(o.text))) {
        type = 'truefalse';
      }
      items.push({ container, type, text, options, optionEls: group.els });
    }

    // Native <select> dropdowns -> single choice.
    for (const sel of document.querySelectorAll('select')) {
      if (isOurs(sel) || !visible(sel)) continue;
      const opts = [...sel.options].filter((o) => o.value !== '' && !o.disabled);
      if (opts.length < 2) continue;
      const container = findContainer({ groupEl: sel, els: [sel] }, optionEls);
      items.push({
        container, type: 'single', selectEl: sel, optionEls: opts,
        text: cleanQuestionText(textOfIds(sel.getAttribute('aria-labelledby')) || labelFor(sel)?.innerText
          || container.querySelector('[role=heading],h1,h2,h3,h4,legend')?.innerText || ''),
        options: opts.map((o, i) => ({ id: LETTERS[i] || String(i + 1), text: clean(o.text), hasImage: false })),
      });
    }

    // Free-text / custom dropdowns: report them so they are flagged, never guessed.
    const covered = (el) => items.some((it) => it.container.contains(el));
    for (const el of document.querySelectorAll('textarea, input[type=text], input:not([type]), input[type=number], [role=listbox]')) {
      if (isOurs(el) || !visible(el) || covered(el)) continue;
      const container = findContainer({ groupEl: el, els: [el] }, optionEls);
      const kind = el.getAttribute('role') === 'listbox' ? 'dropdown' : el.tagName === 'TEXTAREA' ? 'essay' : 'fill-in';
      items.push({
        container, type: kind, optionEls: [], options: [],
        text: cleanQuestionText(container.querySelector('[role=heading],h1,h2,h3,h4,legend,label')?.innerText
          || el.getAttribute('aria-label') || ''),
      });
    }

    // Page order.
    items.sort((a, b) => (a.container.compareDocumentPosition(b.container) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

    const seen = new Map();
    return items.map((it, index) => {
      let id = 'q' + hash(it.type + '|' + it.text + '|' + it.options.map((o) => o.text).join('|'));
      const n = (seen.get(id) || 0) + 1;
      seen.set(id, n);
      if (n > 1) id += '_' + n;
      refs.set(id, { container: it.container, optionEls: it.optionEls, selectEl: it.selectEl || null });
      const hasCanvas = !!it.container.querySelector('canvas');
      return {
        id, index, type: it.type, text: it.text, options: it.options,
        hasImages: hasImageIn(it.container),
        // No readable text (e.g. drawn on canvas, or text is an image): needs a screenshot.
        needsScreenshot: !it.text || (hasCanvas && it.text.length < 5),
      };
    });
  }

  function ref(q) {
    const r = refs.get(q.id);
    if (!r || !r.container.isConnected) throw new Error(`Question ${q.id} is no longer on the page; extract again.`);
    return r;
  }

  function optionEl(q, optId) {
    const i = q.options.findIndex((o) => o.id === optId);
    const el = ref(q).optionEls[i];
    if (!el) throw new Error(`Option ${optId} not found for question ${q.id}.`);
    return el;
  }

  function isChecked(q, optId) {
    const r = ref(q);
    const el = optionEl(q, optId);
    if (r.selectEl) return r.selectEl.value === el.value;
    if (isNativeChoice(el)) return el.checked;
    return el.getAttribute('aria-checked') === 'true';
  }

  // A full pointer/mouse sequence, because some frameworks listen for mousedown/up, not click.
  function realClick(el) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, composed: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  async function selectAnswer(q, optId, checked = true) {
    const r = ref(q);
    const el = optionEl(q, optId);
    const before = isChecked(q, optId);
    if (before !== checked) {
      if (r.selectEl) {
        r.selectEl.value = el.value;
        r.selectEl.dispatchEvent(new Event('input', { bubbles: true }));
        r.selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (isNativeChoice(el)) {
        el.click(); // native input: one click toggles and fires input/change
      } else {
        realClick(el);
      }
      await new Promise((res) => setTimeout(res, 80));
    }
    const after = isChecked(q, optId);
    return { ok: after === checked, before, after };
  }

  function getElements(q) {
    const r = ref(q);
    return { container: r.container, options: r.optionEls.map((el) => (r.selectEl ? r.selectEl : optionImageHost(el))) };
  }

  function findButton(re) {
    const cands = [...document.querySelectorAll('button, [role=button], input[type=submit], input[type=button], a')]
      .filter((b) => !isOurs(b) && visible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
    return cands.find((b) => re.test(buttonText(b))) || null;
  }

  function findNextButton() {
    return findButton(NEXT_RE);
  }

  function goNextPage() {
    const b = findButton(NEXT_RE);
    if (!b) return false;
    realClick(b);
    return true;
  }

  function findSubmitButton() {
    return findButton(SUBMIT_RE) || [...document.querySelectorAll('input[type=submit], button[type=submit]')]
      .find((b) => !isOurs(b) && visible(b) && !NEXT_RE.test(buttonText(b))) || null;
  }

  function submit() {
    const b = findSubmitButton();
    if (!b) return false;
    realClick(b);
    return true;
  }

  const SCORE_RE = /(?:total\s+points|your\s+score|score|points|marks|grade)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:\/|out of|of)\s*(\d+(?:\.\d+)?)/i;

  function isResultsPage() {
    const text = document.body.innerText || '';
    return SCORE_RE.test(text) || (/correct answer/i.test(text) && findOptionEls().length === 0);
  }

  function scrapeResults() {
    // Generic: only the overall score. Per-question results need a platform adapter (Phase 2).
    const text = document.body.innerText || '';
    const m = SCORE_RE.exec(text);
    const pct = /(\d+(?:\.\d+)?)\s*%/.exec(text);
    return {
      score: m ? { earned: parseFloat(m[1]), total: parseFloat(m[2]), percent: pct ? parseFloat(pct[1]) : null } : null,
      questions: [],
    };
  }

  globalThis.QuizQAAdapters = globalThis.QuizQAAdapters || {};
  globalThis.QuizQAAdapters.generic = {
    name: 'generic',
    detectPlatform, extractQuestions, selectAnswer, isChecked, getElements,
    findNextButton, goNextPage, findSubmitButton, submit, isResultsPage, scrapeResults,
  };
})();
