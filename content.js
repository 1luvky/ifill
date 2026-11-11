// content.js - runs inside the quiz tab (injected by background.js after adapters/*.js).
// Stateless per page: background.js owns the run and sends one command at a time.
//
// Commands ({type, ...} via chrome.runtime messages, or QuizQA.handle(msg) in the page console):
//   ping                         -> {ready, adapter, url}
//   extract                      -> {adapter, url, title, questions, hasNext, hasSubmit, isResults}
//   applyAnswers {plan:[{id, answer:[optIds]}]} -> {results:[{id, ok, wanted, checked, error?}]}
//   readSelections {ids?}        -> {selections:[{id, checked:[optIds]}]}
//   nextPage                     -> {moved}   (no reply if the page navigates away; background expects that)
//   confirm {title, message, okLabel, cancelLabel} -> {ok}   (in-page dialog)
//   submit                       -> {clicked}  (background only sends this after the user confirmed)
//   collectImages {ids}          -> {items:[{id, images, failed:[{token}], options:[{id, images, failed}], containerToken}]}
//   prepareCapture {token} / endCapture  -> element box for a screenshot crop (our overlay hidden meanwhile)
//   banner {text, show}          -> {}         (visible "test run in progress" bar)
//   highlight {items:[{id, status, label}]} / clearHighlights
//   isResults / scrapeResults
(() => {
  if (globalThis.QuizQA?.version) return; // already injected on this page

  const UI_ATTR = 'data-quizqa-ui';
  const adapters = Object.values(globalThis.QuizQAAdapters || {});
  if (!adapters.length) throw new Error('Quiz QA: no adapters loaded before content.js');

  // ---------------- adapter selection ----------------

  function pickAdapter() {
    let best = null, bestScore = -1;
    for (const a of adapters) {
      let s = 0;
      try { s = Number(a.detectPlatform()) || 0; } catch { s = 0; }
      if (s > bestScore) { best = a; bestScore = s; }
    }
    return best;
  }
  let adapter = pickAdapter();
  let lastQuestions = new Map(); // id -> question (data only) from latest extract

  function questionById(id) {
    if (!lastQuestions.has(id)) extract(); // page may have re-rendered
    const q = lastQuestions.get(id);
    if (!q) throw new Error(`Question ${id} not found on this page.`);
    return q;
  }

  // ---------------- commands ----------------

  function extract() {
    adapter = pickAdapter();
    const questions = adapter.extractQuestions();
    lastQuestions = new Map(questions.map((q) => [q.id, q]));
    return {
      adapter: adapter.name,
      url: location.href,
      title: document.title,
      questions,
      hasNext: !!adapter.findNextButton?.(),
      hasSubmit: !!adapter.findSubmitButton?.(),
      isResults: safe(() => adapter.isResultsPage(), false),
    };
  }

  function checkedIds(q) {
    return q.options.filter((o) => safe(() => adapter.isChecked(q, o.id), false)).map((o) => o.id);
  }

  async function applyAnswers(plan) {
    const results = [];
    for (const { id, answer } of plan) {
      try {
        const q = questionById(id);
        const wanted = [...new Set(answer || [])];
        if (q.type === 'multi') {
          // Make the checked set exactly equal to `wanted`.
          for (const o of q.options) {
            const want = wanted.includes(o.id);
            if (adapter.isChecked(q, o.id) !== want) await adapter.selectAnswer(q, o.id, want);
          }
        } else {
          if (wanted.length !== 1) throw new Error(`Single-choice question needs exactly one answer, got ${wanted.length}.`);
          await adapter.selectAnswer(q, wanted[0], true);
        }
        await sleep(120); // let the page's own code save the choice
        const checked = checkedIds(q);
        const ok = checked.length === wanted.length && wanted.every((x) => checked.includes(x));
        results.push({ id, ok, wanted, checked });
      } catch (e) {
        results.push({ id, ok: false, wanted: answer || [], checked: [], error: String(e.message || e) });
      }
    }
    return { results };
  }

  function readSelections(ids) {
    const list = ids?.length ? ids.map(questionById) : [...lastQuestions.values()];
    return { selections: list.map((q) => ({ id: q.id, checked: checkedIds(q) })) };
  }

  async function nextPage() {
    const before = [...lastQuestions.keys()].join(',');
    if (!adapter.goNextPage()) return { moved: false, reason: 'No Next button found.' };
    // Same-document quizzes re-render; full-page quizzes navigate (then this reply never arrives).
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const now = safe(() => adapter.extractQuestions().map((q) => q.id).join(','), before);
      if (now !== before) { extract(); return { moved: true }; }
    }
    return { moved: false, reason: 'Clicked Next but the page did not change (a required question may be unanswered).' };
  }

  function submit() {
    return { clicked: adapter.submit() };
  }

  // ---------------- images ----------------
  // Converts images inside questions/options to base64 (max 1024px long side).
  // Anything that can't be read (cross-origin, tainted canvas) is returned as a
  // capture "token": background.js screenshots the tab and crops to that element.

  const MAX_SIDE = 1024;
  const MIN_SIDE = 24;          // smaller = icons/decoration, ignored
  const MAX_Q_IMAGES = 6;
  const MAX_OPT_IMAGES = 3;
  const captureTargets = new Map(); // token -> element
  let tokenSeq = 0;

  function tokenFor(el) {
    const t = `cap${++tokenSeq}`;
    captureTargets.set(t, el);
    return t;
  }

  function cssBgUrl(el) {
    const bg = getComputedStyle(el).backgroundImage;
    const m = bg && bg !== 'none' && /url\(["']?(.*?)["']?\)/.exec(bg);
    return m ? m[1] : null;
  }

  function findImageEls(root) {
    if (!root) return [];
    const found = [];
    const consider = (el) => {
      if (el.closest(`[${UI_ATTR}]`)) return;
      if (el.tagName === 'svg' || el.tagName === 'SVG') { if (el.parentElement?.closest('svg')) return; }
      const r = el.getBoundingClientRect();
      if (r.width < MIN_SIDE || r.height < MIN_SIDE) return;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return;
      found.push(el);
    };
    root.matches?.('img,canvas,svg') ? consider(root) : null;
    root.querySelectorAll('img, canvas, svg').forEach(consider);
    // CSS background images (bounded scan).
    const all = [root, ...root.querySelectorAll('*')].slice(0, 600);
    for (const el of all) if (!/^(IMG|CANVAS|svg)$/i.test(el.tagName) && cssBgUrl(el)) consider(el);
    return found;
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('image failed to load'));
      im.src = src;
    });
  }

  function encode(source, w, h) {
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(source, 0, 0, cw, ch);
    const png = cw * ch <= 250000;
    const url = c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88); // throws on tainted canvas
    const [, mimeType, data] = /^data:([^;]+);base64,(.*)$/.exec(url);
    return { mimeType, data, w: cw, h: ch };
  }

  async function convertEl(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      if (!el.complete) await el.decode().catch(() => {});
      if (!el.naturalWidth) throw new Error('image not loaded');
      const src = el.currentSrc || el.src;
      const key = src && !src.startsWith('data:') && !src.startsWith('blob:') ? `url:${src}` : null;
      return { ...encode(el, el.naturalWidth, el.naturalHeight), key };
    }
    if (tag === 'canvas') {
      if (!el.width || !el.height) throw new Error('empty canvas');
      return { ...encode(el, el.width, el.height), key: null };
    }
    if (tag === 'svg') {
      const r = el.getBoundingClientRect();
      const clone = el.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', r.width);
      clone.setAttribute('height', r.height);
      const im = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone)));
      return { ...encode(im, Math.round(r.width * 2), Math.round(r.height * 2)), key: null };
    }
    const url = cssBgUrl(el);
    if (url) {
      const im = await loadImage(url);
      return { ...encode(im, im.naturalWidth, im.naturalHeight), key: url.startsWith('data:') ? null : `url:${url}` };
    }
    throw new Error('not an image');
  }

  async function convertAll(els, max) {
    const images = [], failed = [];
    for (const el of els.slice(0, max)) {
      try { images.push(await convertEl(el)); } catch (e) { failed.push({ token: tokenFor(el), why: String(e.message || e) }); }
    }
    return { images, failed, extra: Math.max(0, els.length - max) };
  }

  async function collectImages(ids) {
    const items = [];
    for (const id of ids) {
      try {
        const q = questionById(id);
        const { container, options: hosts } = adapter.getElements(q);
        const inOption = (el) => hosts.some((h) => h && h.contains(el));
        const qr = await convertAll(findImageEls(container).filter((el) => !inOption(el)), MAX_Q_IMAGES);
        const options = [];
        for (let i = 0; i < q.options.length; i++) {
          const r = await convertAll(findImageEls(hosts[i]), MAX_OPT_IMAGES);
          options.push({ id: q.options[i].id, images: r.images, failed: r.failed });
        }
        items.push({ id, images: qr.images, failed: qr.failed, options, containerToken: tokenFor(container) });
      } catch (e) {
        items.push({ id, error: String(e.message || e), images: [], failed: [], options: [] });
      }
    }
    return { items };
  }

  // Screenshot support: hide our overlay, bring the element on screen, report its box.
  async function prepareCapture(token) {
    const el = captureTargets.get(token);
    if (!el || !el.isConnected) throw new Error('Element to capture is gone.');
    if (uiHost) uiHost.style.visibility = 'hidden';
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    // Wait for a repaint (rAF may never fire in hidden/headless tabs, so cap the wait).
    await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), sleep(100)]);
    await sleep(150);
    const r = el.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    const w = Math.min(innerWidth, r.right) - x, h = Math.min(innerHeight, r.bottom) - y;
    return { rect: { x, y, w, h }, dpr: devicePixelRatio, clipped: r.height > innerHeight || r.width > innerWidth };
  }

  function endCapture() {
    if (uiHost) uiHost.style.visibility = '';
    scheduleDraw();
    return {};
  }

  // ---------------- visible UI (shadow DOM, ignored by adapters) ----------------

  let uiHost = null, uiRoot = null;
  function ui() {
    if (uiHost?.isConnected) return uiRoot;
    uiHost = document.createElement('div');
    uiHost.setAttribute(UI_ATTR, '');
    uiHost.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
    uiRoot = uiHost.attachShadow({ mode: 'open' });
    uiRoot.innerHTML = `<style>
      :host { all: initial; }
      .dock { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column;
        align-items: flex-end; gap: 8px; font: 12px/1.4 system-ui, -apple-system, sans-serif; }
      .pill { pointer-events: auto; display: flex; align-items: center; gap: 8px; max-width: 10px; height: 10px;
        overflow: hidden; padding: 0; border-radius: 999px; background: transparent; color: #fff;
        transition: max-width .15s, padding .15s, background .15s; }
      .pill .dot { width: 10px; height: 10px; border-radius: 50%; background: #1a73e8; opacity: .55; flex: none; }
      .pill.error .dot { background: #d93025; opacity: .9; }
      .pill .txt, .pill button { opacity: 0; }
      .pill:hover { max-width: 360px; height: auto; padding: 5px 6px 5px 10px; background: rgba(32,33,36,.92); }
      .pill:hover .txt, .pill:hover button { opacity: 1; }
      .pill .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pill button { background: transparent; color: #f28b82; border: 0; padding: 2px 8px; font: inherit; cursor: pointer; }
      .box { position: absolute; border: 2px solid; border-radius: 6px; pointer-events: none; box-sizing: border-box; opacity: .85; }
      .stripe { position: absolute; width: 3px; border-radius: 2px; pointer-events: none; opacity: .8; }
      .stripe.fail { background: #d93025; } .stripe.skip { background: #f9ab00; }
      .tag { position: absolute; top: -9px; right: 8px; font: 11px/1 system-ui, sans-serif; color: #fff;
        padding: 3px 5px; border-radius: 3px; white-space: nowrap; max-width: 50vw; overflow: hidden; text-overflow: ellipsis; }
      .planned { border-color: #1a73e8; } .planned .tag { background: #1a73e8; }
      .ok { border-color: #34a853; } .ok .tag { background: #188038; }
      .fail { border-color: #d93025; } .fail .tag { background: #d93025; }
      .skip { border-color: #f9ab00; } .skip .tag { background: #b06000; }
      .card { pointer-events: auto; max-width: 320px; background: #fff; color: #202124; border-radius: 8px;
        padding: 8px 10px; box-shadow: 0 2px 10px rgba(0,0,0,.2); border: 1px solid #dadce0; }
      .card h3 { margin: 0 0 2px; font-size: 12px; }
      .card p { margin: 0 0 6px; color: #5f6368; font-size: 11px; }
      .card label { display: flex; gap: 6px; align-items: center; margin: 0 0 6px; color: #5f6368; cursor: pointer; font-size: 11px; }
      .card .btns { display: flex; gap: 6px; justify-content: flex-end; }
      .card button { font: inherit; padding: 3px 10px; border-radius: 6px; border: 1px solid #dadce0;
        background: #fff; color: #202124; cursor: pointer; }
      .card button.primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }
    </style><div id="layer"></div><div class="dock"><div id="dlg-slot"></div><div id="banner-slot"></div></div>`;
    document.documentElement.append(uiHost);
    return uiRoot;
  }

  function setBanner(text, show, tone) {
    const slot = ui().getElementById('banner-slot');
    if (!show) { slot.replaceChildren(); return; }
    const pill = document.createElement('div');
    pill.className = tone === 'error' ? 'pill error' : 'pill';
    const full = `Quiz QA Checker: ${text || 'test run in progress'}`;
    pill.title = full;
    const dot = document.createElement('span'); dot.className = 'dot';
    const msg = document.createElement('span'); msg.className = 'txt';
    msg.textContent = `Quiz QA · ${text || 'running'}`;
    const stop = document.createElement('button');
    stop.textContent = 'Stop';
    stop.title = 'Stop this test run';
    stop.addEventListener('click', () => send({ type: 'stopRun' }));
    pill.append(dot, msg, stop);
    slot.replaceChildren(pill);
  }

  // Highlight boxes follow their question while scrolling.
  let highlights = []; // {id, status, label}
  let rafPending = false;
  function drawHighlights() {
    rafPending = false;
    const layer = ui().getElementById('layer');
    layer.replaceChildren();
    for (const h of highlights) {
      const q = lastQuestions.get(h.id);
      if (!q) continue;
      let el;
      try { el = adapter.getElements(q).container; } catch { continue; }
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      if (h.status === 'ok') continue; // fine: show nothing
      if (h.status === 'fail' || h.status === 'skip') {
        const st = document.createElement('div');
        st.className = `stripe ${h.status}`;
        st.style.cssText = `left:${r.left - 8}px;top:${r.top}px;height:${r.height}px;`;
        layer.append(st);
        continue;
      }
      const box = document.createElement('div');
      box.className = `box ${h.status}`;
      box.style.cssText = `left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;`;
      if (h.label) {
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.textContent = h.label;
        box.append(tag);
      }
      layer.append(box);
    }
  }
  function scheduleDraw() {
    if (!rafPending) { rafPending = true; requestAnimationFrame(drawHighlights); }
  }
  addEventListener('scroll', scheduleDraw, { passive: true, capture: true });
  addEventListener('resize', scheduleDraw, { passive: true });

  function highlight(items) {
    const byId = new Map(highlights.map((h) => [h.id, h]));
    for (const it of items) byId.set(it.id, it);
    highlights = [...byId.values()];
    scheduleDraw();
  }

  // Small non-blocking card in the corner; the page stays usable so you can review it.
  function confirmDialog({ title = 'Quiz QA Checker', message = '', okLabel = 'OK', cancelLabel = 'Cancel', rememberLabel = '' }) {
    return new Promise((resolve) => {
      const slot = ui().getElementById('dlg-slot');
      const card = document.createElement('div');
      card.className = 'card';
      card.setAttribute('role', 'dialog');
      const h = document.createElement('h3'); h.textContent = title;
      const p = document.createElement('p'); p.textContent = message;
      card.append(h, p);
      let box = null;
      if (rememberLabel) {
        const lab = document.createElement('label');
        box = document.createElement('input'); box.type = 'checkbox';
        lab.append(box, rememberLabel);
        card.append(lab);
      }
      const btns = document.createElement('div'); btns.className = 'btns';
      const cancel = document.createElement('button'); cancel.textContent = cancelLabel;
      const ok = document.createElement('button'); ok.className = 'primary'; ok.textContent = okLabel;
      const done = (v) => { slot.replaceChildren(); resolve({ ok: v, remember: !!box?.checked }); };
      cancel.addEventListener('click', () => done(false));
      ok.addEventListener('click', () => done(true));
      btns.append(cancel, ok);
      card.append(btns);
      slot.replaceChildren(card);
    });
  }

  // ---------------- messaging ----------------

  async function handle(msg) {
    switch (msg?.type) {
      case 'ping': return { ready: true, adapter: adapter.name, url: location.href };
      case 'extract': return extract();
      case 'applyAnswers': return applyAnswers(msg.plan || []);
      case 'readSelections': return readSelections(msg.ids);
      case 'nextPage': return nextPage();
      case 'submit': return submit();
      case 'collectImages': return collectImages(msg.ids || []);
      case 'prepareCapture': return prepareCapture(msg.token);
      case 'endCapture': return endCapture();
      case 'confirm': return confirmDialog(msg);
      case 'banner': setBanner(msg.text, msg.show !== false, msg.tone); return {};
      case 'highlight': highlight(msg.items || []); return {};
      case 'clearHighlights': highlights = []; scheduleDraw(); return {};
      case 'isResults': return { isResults: safe(() => adapter.isResultsPage(), false) };
      case 'scrapeResults': return { adapter: adapter.name, url: location.href, ...adapter.scrapeResults() };
      default: throw new Error(`Unknown command: ${msg?.type}`);
    }
  }

  function send(msg) {
    try { chrome.runtime?.sendMessage?.({ from: 'content', ...msg }); } catch { /* extension reloaded */ }
  }

  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.target !== 'content') return false;
      handle(msg).then(
        (r) => sendResponse({ ok: true, ...r }),
        (e) => sendResponse({ ok: false, error: String(e?.message || e) }),
      );
      return true; // async reply
    });
  }

  function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // Exposed for testing from the page console.
  globalThis.QuizQA = { version: 1, handle, get adapter() { return adapter.name; } };
})();
