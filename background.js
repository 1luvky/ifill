// background.js - service worker: owns the test run, talks to the quiz tab and to Gemini.
//
// Messages it accepts (chrome.runtime.sendMessage from popup / panel / content):
//   {type:'startRun', tabId}      start a new run on that tab using the saved settings
//   {type:'stopRun', tabId?}      stop (content.js sends this from the banner's Stop button)
//   {type:'continueRun', tabId}   resume an interrupted/paused run, or verify results after submit
//   {type:'getRun', tabId}        latest run for that tab (or null)
//   {type:'listRuns'}             recent runs (summary)
// It broadcasts {type:'runUpdate', run} whenever a run changes (the panel listens).
import * as storage from './storage.js';
import { answerQuestions, GeminiError } from './llm.js';

const CONTENT_FILES = ['adapters/generic.js', 'content.js'];
const MAX_PAGES = 60;
const MAX_LOG = 300;
const MAX_RUNS_KEPT = 30;

/** tabId -> {ctrl: AbortController, run} for runs whose loop is alive in this service-worker instance.
 *  Everyone uses this same run object while it is live, so a Stop is never overwritten. */
const live = new Map();

class NavigatedError extends Error {}
class NoAccessError extends Error {}
class StoppedError extends Error {}

// =====================================================================
// Messaging
// =====================================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'content' || msg.type === 'runUpdate') return false;
  const tabId = msg.tabId ?? sender.tab?.id;
  handle(msg, tabId).then(
    (r) => sendResponse({ ok: true, ...r }),
    (e) => sendResponse({ ok: false, error: String(e?.message || e) }),
  );
  return true;
});

async function handle(msg, tabId) {
  switch (msg.type) {
    case 'startRun': return { run: await startRun(tabId) };
    case 'stopRun': return { run: await stopRun(tabId) };
    case 'continueRun': return { run: await continueRun(tabId) };
    case 'getRun': return { run: await getRunForTab(tabId) };
    case 'listRuns': return { runs: (await chrome.storage.local.get('runsIndex')).runsIndex || [] };
    default: throw new Error(`Unknown message type: ${msg.type}`);
  }
}

// =====================================================================
// Run storage (chrome.storage.local, survives page changes and SW restarts)
// =====================================================================

const runKey = (id) => `run_${id}`;

async function loadRun(id) {
  return (await chrome.storage.local.get(runKey(id)))[runKey(id)] || null;
}

async function saveRun(run) {
  run.updatedAt = Date.now();
  const { runsIndex = [], activeRuns = {} } = await chrome.storage.local.get(['runsIndex', 'activeRuns']);
  const summary = { id: run.id, tabId: run.tabId, mode: run.mode, status: run.status, title: run.title, startedAt: run.startedAt };
  const idx = [summary, ...runsIndex.filter((r) => r.id !== run.id)];
  const dropped = idx.splice(MAX_RUNS_KEPT);
  activeRuns[run.tabId] = run.id;
  await chrome.storage.local.set({ [runKey(run.id)]: run, runsIndex: idx, activeRuns });
  if (dropped.length) await chrome.storage.local.remove(dropped.map((r) => runKey(r.id)));
  chrome.runtime.sendMessage({ type: 'runUpdate', run }).catch(() => {}); // no listener is fine
}

async function getRunForTab(tabId) {
  if (live.has(tabId)) return live.get(tabId).run;
  const { activeRuns = {} } = await chrome.storage.local.get('activeRuns');
  const id = activeRuns[tabId];
  const run = id ? await loadRun(id) : null;
  if (run && run.status === 'running' && !live.has(tabId)) {
    // The service worker restarted mid-run; the loop is gone.
    run.status = 'interrupted';
    log(run, 'warn', 'Run was interrupted (browser stopped the background worker). Press Continue to resume.');
    await saveRun(run);
  }
  return run;
}

function log(run, level, msg) {
  run.log.push({ t: Date.now(), level, msg });
  if (run.log.length > MAX_LOG) run.log.splice(0, run.log.length - MAX_LOG);
}

// =====================================================================
// Talking to the tab
// =====================================================================

async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  } catch (e) {
    throw new NoAccessError(
      'Chrome did not allow access to this page. Click the Quiz QA Checker icon while viewing the quiz tab, then press Continue. '
      + `(${e.message})`);
  }
}

async function toContent(tabId, msg) {
  let resp;
  try {
    resp = await chrome.tabs.sendMessage(tabId, { target: 'content', ...msg });
  } catch (e) {
    if (/Receiving end does not exist|message port closed|back\/forward cache|No tab with id/i.test(e.message)) {
      throw new NavigatedError(e.message);
    }
    throw e;
  }
  if (!resp) throw new NavigatedError('No reply (page changed).');
  if (!resp.ok) throw new Error(resp.error || 'Content script error');
  return resp;
}

async function ensureContent(tabId) {
  try { return await toContent(tabId, { type: 'ping' }); } catch { /* not injected yet */ }
  await inject(tabId);
  return toContent(tabId, { type: 'ping' });
}

async function waitForLoad(tabId, timeoutMs = 30000) {
  const t0 = Date.now();
  await sleep(400);
  while (Date.now() - t0 < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new StoppedError('The quiz tab was closed.');
    if (tab.status === 'complete') { await sleep(600); return; }
    await sleep(250);
  }
  throw new Error('The page took too long to load.');
}

// Keep the service worker alive during long Gemini calls (any extension API call resets the idle timer).
let keepAliveTimer = null;
function keepAlive(on) {
  if (on && !keepAliveTimer) keepAliveTimer = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  if (!on && keepAliveTimer && live.size === 0) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
}

// =====================================================================
// Run lifecycle
// =====================================================================

async function startRun(tabId) {
  if (!tabId) throw new Error('No tab given.');
  if (live.has(tabId)) throw new Error('A run is already in progress on this tab.');
  const settings = await storage.getSettings();
  if (settings.mode !== 'scoring' && !(await storage.getApiKey())) {
    throw new Error('This mode needs a Gemini API key. Add it in the popup settings.');
  }
  const tab = await chrome.tabs.get(tabId);
  const run = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    tabId,
    title: tab.title || '',
    startUrl: tab.url || '',
    mode: settings.mode,
    model: settings.mode === 'scoring' ? null : settings.model,
    scoringPattern: settings.scoringPattern,
    customPattern: settings.customPattern,
    confirmBeforeSend: settings.confirmBeforeSend,
    sendConfirmed: false,
    status: 'running',
    progress: '',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    adapter: null,
    pages: [],          // [{url, questionIds}]
    order: [],          // question ids in quiz order
    questions: {},      // id -> {id, n, page, type, text, options, hasImages, needsScreenshot}
    plan: {},           // id -> {status:'planned'|'skipped'|'error', answer?, source, confidence?, reasoning?, reason?}
    applied: {},        // id -> {ok, wanted, checked, error?}
    submit: null,       // {confirmed, clickedAt}
    results: null,      // {score, url, scrapedAt}
    log: [],
  };
  log(run, 'info', `Run started in ${modeName(run.mode)} mode.`);
  await saveRun(run);
  runLoop(run); // not awaited: progress is reported through runUpdate messages
  return run;
}

async function stopRun(tabId) {
  const run = await getRunForTab(tabId);
  live.get(tabId)?.ctrl.abort();
  if (run && ['running', 'interrupted', 'paused', 'needs_attention', 'awaiting_submit'].includes(run.status)) {
    run.status = 'stopped';
    log(run, 'info', 'Run stopped by you.');
    await saveRun(run);
  }
  toContent(tabId, { type: 'banner', show: false }).catch(() => {});
  return run;
}

async function continueRun(tabId) {
  const run = await getRunForTab(tabId);
  if (!run) throw new Error('No run on this tab.');
  if (live.has(tabId)) return run;
  if (run.status === 'submitted' || run.status === 'awaiting_results') {
    await captureResults(run);
    return run;
  }
  if (!['interrupted', 'paused', 'needs_attention', 'awaiting_submit', 'error'].includes(run.status)) {
    throw new Error(`Nothing to continue (run is ${run.status}).`);
  }
  run.status = 'running';
  log(run, 'info', 'Continuing run.');
  await saveRun(run);
  runLoop(run);
  return run;
}

async function runLoop(run) {
  const tabId = run.tabId;
  const ctrl = new AbortController();
  live.set(tabId, { ctrl, run });
  keepAlive(true);
  const checkStop = () => { if (ctrl.signal.aborted) throw new StoppedError('Stopped.'); };

  try {
    await ensureContent(tabId);
    await toContent(tabId, { type: 'banner', text: bannerText(run) });

    for (let p = 0; p < MAX_PAGES; p++) {
      checkStop();
      const page = await toContent(tabId, { type: 'extract' });
      run.adapter = page.adapter;

      if (!page.questions.length) {
        if (page.isResults) { await captureResults(run, { alreadyThere: true }); return; }
        return await attention(run, 'No questions found on this page.');
      }

      registerPage(run, page);
      const ids = page.questions.map((q) => q.id);
      await saveRun(run);

      await planQuestions(run, ids, ctrl.signal);
      checkStop();

      if (run.mode === 'dryrun') {
        await highlightPage(run, ids);
        run.status = 'done';
        run.progress = '';
        log(run, 'info', 'Dry run finished. Nothing was clicked.');
        await saveRun(run);
        await toContent(tabId, { type: 'banner', show: false }).catch(() => {});
        return;
      }

      await applyPlan(run, ids);
      await highlightPage(run, ids);
      await saveRun(run);
      checkStop();

      if (page.hasNext) {
        const moved = await goNext(run);
        if (!moved) return; // attention already recorded
        continue;
      }
      if (page.hasSubmit) { await askAndSubmit(run); return; }
      return await attention(run, 'Answers are filled in, but no Next or Submit button was found. Submit manually, then press Continue on the results page.');
    }
    await attention(run, `Stopped after ${MAX_PAGES} pages (safety limit).`);
  } catch (e) {
    if (e instanceof StoppedError) {
      if (run.status === 'running') { run.status = 'stopped'; log(run, 'info', e.message); }
    } else if (e instanceof NoAccessError) {
      run.status = 'paused';
      log(run, 'warn', e.message);
    } else if (e instanceof GeminiError) {
      run.status = 'error';
      log(run, 'error', `Gemini: ${e.message}`);
    } else {
      run.status = 'error';
      log(run, 'error', String(e?.message || e));
    }
    run.progress = '';
    await saveRun(run);
    const last = run.log[run.log.length - 1]?.msg || '';
    await toContent(tabId, run.status === 'stopped' ? { type: 'banner', show: false }
      : { type: 'banner', text: last, tone: 'error' }).catch(() => {});
  } finally {
    live.delete(tabId);
    keepAlive(false);
  }
}

async function attention(run, message) {
  run.status = 'needs_attention';
  run.progress = '';
  log(run, 'warn', message);
  await saveRun(run);
  await toContent(run.tabId, { type: 'banner', text: message, tone: 'error' }).catch(() => {});
}

function registerPage(run, page) {
  const pageNo = run.pages.length + 1;
  const newIds = [];
  for (const q of page.questions) {
    if (!run.questions[q.id]) {
      run.order.push(q.id);
      run.questions[q.id] = { ...q, n: run.order.length, page: pageNo };
      newIds.push(q.id);
    } else {
      // Refresh option data (page may be revisited); keep numbering.
      run.questions[q.id] = { ...run.questions[q.id], ...q, n: run.questions[q.id].n, page: run.questions[q.id].page };
    }
  }
  run.pages.push({ url: page.url, questionIds: page.questions.map((q) => q.id) });
  log(run, 'info', `Page ${pageNo}: found ${page.questions.length} question(s) (${newIds.length} new) using the ${page.adapter} adapter.`);
}

// =====================================================================
// Planning answers
// =====================================================================

const SUPPORTED = new Set(['single', 'multi', 'truefalse']);

async function planQuestions(run, ids, signal) {
  const todo = ids.filter((id) => !run.plan[id]);
  if (!todo.length) return;

  for (const id of todo) {
    const q = run.questions[id];
    if (!SUPPORTED.has(q.type)) {
      run.plan[id] = { status: 'skipped', source: 'type', reason: `Unsupported type "${q.type}" (not answered).` };
    }
  }

  if (run.mode === 'scoring') {
    for (const id of todo) {
      if (run.plan[id]) continue;
      run.plan[id] = patternPlan(run, run.questions[id]);
    }
    return;
  }

  // Key-validation / dry-run: ask Gemini.
  let ask = todo.filter((id) => !run.plan[id]).map((id) => run.questions[id]);
  if (!ask.length) return;
  const withImages = ask.filter(usesImages);

  if (run.confirmBeforeSend && !run.sendConfirmed) {
    const { ok, remember } = await toContent(run.tabId, {
      type: 'confirm',
      title: 'Send this quiz to Gemini?',
      message: `${ask.length} question(s)${withImages.length ? `, ${withImages.length} with images` : ''} will be sent to Google (${run.model}). `
        + 'Free-tier data may be used by Google to improve its products.',
      rememberLabel: "Don't ask again",
      okLabel: 'Send', cancelLabel: 'Cancel run',
    });
    if (ok && remember) {
      await storage.saveSettings({ confirmBeforeSend: false });
      log(run, 'info', '"Confirm before sending" turned off. Turn it back on in the popup.');
    }
    if (!ok) { run.status = 'stopped'; log(run, 'info', 'You chose not to send this quiz to Google.'); throw new StoppedError('Not sent.'); }
    run.sendConfirmed = true;
  }

  const media = withImages.length ? await gatherMedia(run, withImages.map((q) => q.id)) : new Map();
  const payload = [];
  for (const q of ask) {
    const m = media.get(q.id);
    const item = {
      id: q.id, type: q.type, text: q.text,
      images: m?.images || [],
      screenshot: m?.screenshot || null,
      options: q.options.map((o) => ({ id: o.id, text: o.text, images: m?.options[o.id] || [] })),
    };
    const hasAnyImage = item.images.length || item.screenshot || item.options.some((o) => o.images.length);
    if (!item.text && !hasAnyImage) {
      run.plan[q.id] = { status: 'skipped', source: 'model', reason: 'Question text could not be read (no text and image capture failed).' };
      continue;
    }
    if (q.options.some((o) => o.hasImage && !o.text) && !item.options.every((o) => o.text || o.images.length) && !item.screenshot) {
      run.plan[q.id] = { status: 'skipped', source: 'model', reason: 'Some image-only options could not be captured.' };
      continue;
    }
    payload.push(item);
  }
  if (!payload.length) return;
  const onProgress = (p) => {
    if (!p.message) return;
    run.progress = p.message;
    log(run, p.stage === 'rate_limited' ? 'warn' : 'info', p.message);
    saveRun(run);
    toContent(run.tabId, { type: 'banner', text: `${bannerText(run)} · ${p.message}` }).catch(() => {});
  };
  const results = await answerQuestions(payload, { onProgress, signal });
  for (const r of results) {
    if (r.status === 'answered') {
      run.plan[r.id] = { status: 'planned', source: 'model', answer: r.answer, answerText: r.answerText,
        confidence: r.confidence, reasoning: r.reasoning, cached: !!r.cached };
      if (r.readText && !run.questions[r.id].text) run.questions[r.id].textFromImage = r.readText;
    } else {
      run.plan[r.id] = { status: r.status === 'skipped' ? 'skipped' : 'error', source: 'model', reason: r.reason };
    }
  }
  run.progress = '';
  await toContent(run.tabId, { type: 'banner', text: bannerText(run) }).catch(() => {});
}

/** Scoring-test mode: deterministic answer from the chosen pattern. */
function patternPlan(run, q) {
  const idx = q.n - 1; // position in the whole quiz, 0-based
  const opts = q.options;
  let picks;
  if (run.scoringPattern === 'alternating') {
    picks = [opts[idx % 2] || opts[0]];
  } else if (run.scoringPattern === 'custom') {
    const tokens = (run.customPattern || '').split(/[\s,;]+/).filter(Boolean);
    const tok = tokens[idx];
    if (!tok) return { status: 'skipped', source: 'pattern', reason: `Custom pattern has no entry for question ${q.n}.` };
    picks = tok.split('+').map((part) => {
      if (/^\d+$/.test(part)) return opts[Number(part) - 1];
      if (/^[A-Za-z]$/.test(part)) return opts[part.toUpperCase().charCodeAt(0) - 65];
      return undefined;
    });
    if (picks.some((x) => !x)) {
      return { status: 'error', source: 'pattern', reason: `Pattern entry "${tok}" does not match the ${opts.length} options of question ${q.n}.` };
    }
    if (q.type !== 'multi' && picks.length > 1) {
      return { status: 'error', source: 'pattern', reason: `Pattern entry "${tok}" picks several options, but question ${q.n} is single-choice.` };
    }
  } else {
    picks = [opts[0]];
  }
  return { status: 'planned', source: 'pattern', answer: picks.map((o) => o.id), answerText: picks.map((o) => o.text || `(image option ${o.id})`) };
}

// =====================================================================
// Images: read from the page, else screenshot + crop
// =====================================================================

const usesImages = (q) => q.hasImages || q.needsScreenshot || q.options.some((o) => o.hasImage);
const CAPTURE_GAP_MS = 600;     // Chrome allows ~2 captureVisibleTab calls per second
const MAX_SIDE = 1024;
let lastCaptureAt = 0;

/** Returns Map id -> {images:[], screenshot, options:{optId: images[]}}; records counts on run.questions. */
async function gatherMedia(run, ids) {
  run.progress = `Collecting images for ${ids.length} question(s)…`;
  await saveRun(run);
  const { items } = await toContent(run.tabId, { type: 'collectImages', ids });
  const out = new Map();
  for (const it of items) {
    const q = run.questions[it.id];
    const entry = { images: [...it.images], screenshot: null, options: {} };
    const stats = { read: it.images.length, captured: 0, failed: 0, screenshot: false, notes: [] };
    if (it.error) stats.notes.push(it.error);

    for (const f of it.failed) {
      const img = await captureCrop(run, f.token).catch((e) => { stats.notes.push(e.message); return null; });
      if (img) { entry.images.push(img); stats.captured++; } else stats.failed++;
    }
    for (const o of it.options) {
      entry.options[o.id] = [...o.images];
      stats.read += o.images.length;
      for (const f of o.failed) {
        const img = await captureCrop(run, f.token).catch((e) => { stats.notes.push(e.message); return null; });
        if (img) { entry.options[o.id].push(img); stats.captured++; } else stats.failed++;
      }
    }
    // Text not readable and no image of it: screenshot the whole question.
    const noText = !q.text;
    const imageOnlyOptionsMissing = q.options.some((o) => o.hasImage && !o.text && !(entry.options[o.id] || []).length);
    if ((q.needsScreenshot && (noText ? entry.images.length === 0 : true)) || stats.failed || imageOnlyOptionsMissing) {
      if (it.containerToken) {
        entry.screenshot = await captureCrop(run, it.containerToken).catch((e) => { stats.notes.push(e.message); return null; });
        stats.screenshot = !!entry.screenshot;
      }
    }
    q.media = stats;
    out.set(it.id, entry);
    if (stats.failed || stats.notes.length) {
      log(run, 'warn', `Q${q.n}: ${stats.failed} image(s) could not be read${stats.screenshot ? '; sent a screenshot of the question instead' : ''}. ${stats.notes.slice(0, 2).join(' ')}`);
    }
  }
  const totals = [...items].reduce((a, it) => {
    const m = run.questions[it.id].media;
    return { read: a.read + m.read, captured: a.captured + m.captured, shots: a.shots + (m.screenshot ? 1 : 0) };
  }, { read: 0, captured: 0, shots: 0 });
  log(run, 'info', `Images: ${totals.read} read from the page, ${totals.captured} captured by screenshot, ${totals.shots} whole-question screenshot(s).`);
  run.progress = '';
  return out;
}

/** Screenshot the visible tab and crop to the element behind `token`. Returns {mimeType, data}. */
async function captureCrop(run, token) {
  const tab = await chrome.tabs.get(run.tabId);
  const prep = await toContent(run.tabId, { type: 'prepareCapture', token });
  let dataUrl;
  try {
    const wait = lastCaptureAt + CAPTURE_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCaptureAt = Date.now();
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (e) {
    throw new Error(`Screenshot failed: ${e.message}`);
  } finally {
    await toContent(run.tabId, { type: 'endCapture' }).catch(() => {});
  }
  const { rect, dpr } = prep;
  if (rect.w < 4 || rect.h < 4) throw new Error('Element is not visible on screen.');
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const sx = Math.round(rect.x * dpr), sy = Math.round(rect.y * dpr);
  const sw = Math.min(bmp.width - sx, Math.round(rect.w * dpr)), sh = Math.min(bmp.height - sy, Math.round(rect.h * dpr));
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const c = new OffscreenCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
  c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const small = c.width * c.height <= 250000;
  const blob = await c.convertToBlob(small ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.88 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  if (prep.clipped) log(run, 'warn', 'A question was taller than the screen; only the visible part was captured.');
  return { mimeType: blob.type, data: btoa(bin) };
}

// =====================================================================
// Applying, paging, submitting
// =====================================================================

async function applyPlan(run, ids) {
  const plan = ids.filter((id) => run.plan[id]?.status === 'planned').map((id) => ({ id, answer: run.plan[id].answer }));
  if (!plan.length) return;
  run.progress = `Selecting ${plan.length} answer(s)…`;
  await saveRun(run);
  const { results } = await toContent(run.tabId, { type: 'applyAnswers', plan });
  let failed = 0;
  for (const r of results) {
    run.applied[r.id] = { ok: r.ok, wanted: r.wanted, checked: r.checked, error: r.error || null, at: Date.now() };
    if (!r.ok) {
      failed++;
      log(run, 'warn', `Q${run.questions[r.id]?.n}: selection failed (wanted ${r.wanted.join('+')}, page shows ${r.checked.join('+') || 'nothing'})${r.error ? ': ' + r.error : ''}.`);
    }
  }
  run.progress = '';
  log(run, failed ? 'warn' : 'info', `Selected ${results.length - failed}/${results.length} answer(s) on this page.`);
}

async function highlightPage(run, ids) {
  const items = ids.map((id) => {
    const p = run.plan[id], a = run.applied[id];
    const ans = p?.answer?.join('+');
    const conf = p?.confidence != null ? ` (${Math.round(p.confidence * 100)}%)` : '';
    if (!p || p.status !== 'planned') return { id, status: 'skip', label: `QA: ${p?.status || 'skipped'} — ${p?.reason || ''}` };
    if (run.mode === 'dryrun') return { id, status: 'planned', label: `QA would pick: ${ans}${conf}` };
    if (a && !a.ok) return { id, status: 'fail', label: `QA: selection failed (wanted ${ans})` };
    return { id, status: 'ok', label: `QA: ${ans}${conf}` };
  });
  await toContent(run.tabId, { type: 'highlight', items }).catch(() => {});
}

async function goNext(run) {
  run.progress = 'Going to the next page…';
  await saveRun(run);
  try {
    const r = await toContent(run.tabId, { type: 'nextPage' });
    if (!r.moved) { await attention(run, r.reason || 'Could not move to the next page.'); return false; }
    return true;
  } catch (e) {
    if (!(e instanceof NavigatedError)) throw e;
    // Full page load (e.g. Google Forms sections): re-inject on the new page.
    await waitForLoad(run.tabId);
    await ensureContent(run.tabId);
    await toContent(run.tabId, { type: 'banner', text: bannerText(run) });
    return true;
  }
}

async function askAndSubmit(run) {
  const planned = run.order.filter((id) => run.plan[id]?.status === 'planned');
  const failed = planned.filter((id) => run.applied[id] && !run.applied[id].ok);
  const skipped = run.order.filter((id) => run.plan[id] && run.plan[id].status !== 'planned');
  run.status = 'awaiting_submit';
  run.progress = 'Waiting for you to confirm submit…';
  await saveRun(run);

  const { ok } = await toContent(run.tabId, {
    type: 'confirm',
    title: 'Submit?',
    message: `${planned.length - failed.length} selected`
      + (failed.length ? `, ${failed.length} failed` : '')
      + (skipped.length ? `, ${skipped.length} skipped` : '')
      + '. You can review the page first.',
    okLabel: 'Submit', cancelLabel: 'Not yet',
  });
  if (!ok) {
    run.progress = '';
    log(run, 'info', 'Not submitted. You can submit manually; then open the extension on the results page and press Continue.');
    await saveRun(run);
    return;
  }
  run.submit = { confirmed: true, clickedAt: Date.now() };
  log(run, 'info', 'You confirmed. Clicking Submit.');
  await saveRun(run);

  try {
    const r = await toContent(run.tabId, { type: 'submit' });
    if (!r.clicked) return await attention(run, 'Submit button not found. Submit manually, then press Continue on the results page.');
  } catch (e) {
    if (!(e instanceof NavigatedError)) throw e;
  }
  run.status = 'submitted';
  await saveRun(run);
  await waitForLoad(run.tabId).catch(() => {});
  await captureResults(run);
}

async function captureResults(run, { alreadyThere = false } = {}) {
  try {
    await ensureContent(run.tabId);
    const { isResults } = await toContent(run.tabId, { type: 'isResults' });
    if (!isResults) {
      run.status = 'awaiting_results';
      log(run, 'info', 'Results page not detected yet. Open the results/score page, click the extension icon, and press Continue.');
      await saveRun(run);
      return;
    }
    const res = await toContent(run.tabId, { type: 'scrapeResults' });
    run.results = { score: res.score, questions: res.questions || [], url: res.url, adapter: res.adapter, scrapedAt: Date.now() };
    run.status = 'results_captured';
    run.progress = '';
    const s = res.score;
    log(run, 'info', s ? `Results page found. Displayed score: ${s.earned} / ${s.total}${s.percent != null ? ` (${s.percent}%)` : ''}.`
      : 'Results page found, but no score could be read.');
    if (!alreadyThere || run.submit) log(run, 'info', 'Per-question verification (chosen vs correct) comes with the platform adapters.');
    await saveRun(run);
    await toContent(run.tabId, { type: 'banner', show: false }).catch(() => {});
  } catch (e) {
    run.status = 'awaiting_results';
    log(run, 'warn', e instanceof NoAccessError
      ? 'Chrome needs your permission on the results page: click the extension icon there and press Continue.'
      : `Could not read results yet: ${e.message}`);
    await saveRun(run);
  }
}

// =====================================================================
// helpers
// =====================================================================

function modeName(m) {
  return { scoring: 'Scoring-test', key: 'Key-validation', dryrun: 'Dry-run' }[m] || m;
}

function bannerText(run) {
  return `${modeName(run.mode)} running`;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// If a quiz tab is closed, drop it from the active map.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  live.get(tabId)?.ctrl.abort();
  const { activeRuns = {} } = await chrome.storage.local.get('activeRuns');
  if (activeRuns[tabId]) { delete activeRuns[tabId]; await chrome.storage.local.set({ activeRuns }); }
});
