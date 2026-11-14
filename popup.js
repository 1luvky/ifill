// popup.js - onboarding, API key, model, mode, settings import/export.
import * as storage from './storage.js';
import { testConnection, listModels, pickDefaultModel } from './llm.js';

const $ = (id) => document.getElementById(id);

// Fallback choices shown before the key's real model list is loaded.
// These are Google's "latest" aliases, so they don't go stale when models are renamed.
const PRESET_MODELS = [
  { id: 'gemini-flash-latest', label: 'Gemini Flash, latest (recommended)' },
  { id: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite, latest (most free quota)' },
  { id: 'gemini-pro-latest', label: 'Gemini Pro, latest (little or no free quota)' },
];
const OTHER = '__other__';

// Support contacts shown in the popup footer. Edit here to change them.
const SUPPORT = {
  issuesUrl: 'https://github.com/1luvky/ifill/issues/new',
  email: 'lucky.tdr18@gmail.com',
  privacyUrl: 'https://github.com/1luvky/ifill/blob/main/PRIVACY.md',
};

let settings;

init();

async function init() {
  setUpFooter();
  settings = await storage.getSettings();
  // Scoring test needs no key, so a user who skipped the key still gets the main view.
  if (!settings.onboarded) showOnboarding();
  else await showMain();
}

$('skip-key').addEventListener('click', async (e) => {
  e.preventDefault();
  settings = await storage.saveSettings({ onboarded: true, mode: 'scoring' });
  await showMain();
});

// Footer links. The issue form is pre-filled with the iFill and Chrome versions only;
// nothing about the user's key, settings or quizzes is included.
function setUpFooter() {
  const version = chrome.runtime.getManifest().version;
  const chromeVersion = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || 'unknown';
  const body = [
    `iFill version: ${version}`,
    `Chrome version: ${chromeVersion}`,
    'Quiz platform (Google Forms, Microsoft Forms, other):',
    'Mode (Scoring test, Key validation, Dry run):',
    '',
    'What happened:',
    '',
    'What you expected:',
    '',
    '(Please do not paste your API key or confidential quiz content.)',
  ].join('\n');
  const subject = `iFill ${version}: problem report`;
  $('report-link').href = `${SUPPORT.issuesUrl}?${new URLSearchParams({ title: subject, body })}`;
  $('email-link').href = `mailto:${SUPPORT.email}?${new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20')}`;
  $('email-link').textContent = SUPPORT.email;
  $('privacy-link').href = SUPPORT.privacyUrl;
  $('version').textContent = `v${version}`;
}

// ---------------- views ----------------

function showOnboarding() {
  $('main').hidden = true;
  $('onboarding').hidden = false;
  $('key-form-slot-settings').replaceChildren(); // only one copy of the form (unique IDs)
  mountKeyForm($('key-form-slot'), { onboarding: true });
}

async function showMain() {
  $('onboarding').hidden = true;
  $('main').hidden = false;
  $('key-form-slot').replaceChildren(); // only one copy of the form (unique IDs)
  settings = await storage.getSettings();

  await renderSummary();
  $('mode').value = settings.mode;
  $('pattern').value = settings.scoringPattern;
  $('custom-pattern').value = settings.customPattern;
  $('scoring-text').value = settings.scoringText;
  $('confirm-send').checked = settings.confirmBeforeSend;
  updateModeUI();
  refreshRun();

  if (!$('key-form-slot-settings').childElementCount) {
    mountKeyForm($('key-form-slot-settings'), { onboarding: false });
  }
}

async function renderSummary() {
  const key = await storage.getApiKey();
  const loc = await storage.getKeyLocation();
  const where = loc === 'sync' ? 'synced via Chrome profile' : 'this computer only';
  $('summary').replaceChildren(
    line('Key', key ? `${storage.maskKey(key)} (${where})` : 'not set'),
    line('Model', settings.model),
  );
}

function line(label, value) {
  const d = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = `${label}: `;
  d.append(b, value);
  return d;
}

function updateModeUI() {
  const mode = $('mode').value;
  $('pattern-box').hidden = mode !== 'scoring';
  $('custom-pattern').hidden = $('pattern').value !== 'custom';
  // Scoring mode sends nothing to Google, so the confirm toggle is irrelevant there.
  $('confirm-row').hidden = mode === 'scoring';
}

// ---------------- run controls ----------------

const STATUS_TEXT = {
  running: 'Running…',
  awaiting_submit: 'Answers filled. Waiting for you to confirm Submit on the page.',
  submitted: 'Submitted. Reading the results page…',
  awaiting_results: 'Submitted. Open the results page, then press Continue.',
  results_captured: 'Done: results captured.',
  done: 'Dry run finished.',
  stopped: 'Stopped.',
  interrupted: 'Interrupted. Press Continue to resume.',
  paused: 'Paused: Chrome needs permission on this page. Press Continue.',
  needs_attention: 'Needs your attention (see below).',
  error: 'Stopped with an error.',
};

let currentTabId = null;

async function activeTabId() {
  if (currentTabId) return currentTabId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id ?? null;
  return currentTabId;
}

async function refreshRun() {
  const tabId = await activeTabId();
  if (!tabId) return;
  const r = await chrome.runtime.sendMessage({ type: 'getRun', tabId });
  renderRun(r?.run || null);
}

function renderRun(run) {
  const busy = run && ['running', 'awaiting_submit', 'submitted'].includes(run.status);
  const resumable = run && ['interrupted', 'paused', 'needs_attention', 'awaiting_results', 'error'].includes(run.status);
  $('run-btn').hidden = !!busy;
  $('stop-btn').hidden = !(busy || resumable);
  $('continue-btn').hidden = !resumable;
  $('continue-btn').textContent = run?.status === 'awaiting_results' ? 'Continue (read results)' : 'Continue';
  if (!run) { $('run-status').replaceChildren(); return; }

  const kind = run.status === 'error' ? 'err' : ['results_captured', 'done'].includes(run.status) ? 'ok' : 'busy';
  const box = document.createElement('div');
  box.className = `status ${kind}`;
  const head = document.createElement('div');
  head.textContent = `${STATUS_TEXT[run.status] || run.status}${run.progress ? ' ' + run.progress : ''}`;
  box.append(head);

  const counts = summarizeRun(run);
  if (counts) { const c = document.createElement('div'); c.textContent = counts; box.append(c); }
  const s = run.results?.score;
  if (s) { const d = document.createElement('div'); d.textContent = `Displayed score: ${s.earned} / ${s.total}${s.percent != null ? ` (${s.percent}%)` : ''}`; box.append(d); }
  const last = [...run.log].reverse().find((l) => l.level !== 'info') || run.log[run.log.length - 1];
  if (last) { const l = document.createElement('div'); l.className = 'small'; l.textContent = last.msg; box.append(l); }
  $('run-status').replaceChildren(box);
}

function summarizeRun(run) {
  const n = run.order.length;
  if (!n) return '';
  const plans = run.order.map((id) => run.plan[id]).filter(Boolean);
  const planned = plans.filter((p) => p.status === 'planned').length;
  const skipped = plans.filter((p) => p.status === 'skipped').length;
  const errors = plans.filter((p) => p.status === 'error').length;
  const failed = Object.values(run.applied).filter((a) => !a.ok).length;
  return `${n} question(s): ${planned} answered${skipped ? `, ${skipped} skipped` : ''}${errors ? `, ${errors} errors` : ''}`
    + `${failed ? `, ${failed} selection failure(s)` : ''}.`;
}

$('run-btn').addEventListener('click', async () => {
  const tabId = await activeTabId();
  const r = await chrome.runtime.sendMessage({ type: 'startRun', tabId });
  if (!r?.ok) return status($('run-status'), 'err', r?.error || 'Could not start.');
  renderRun(r.run);
});
$('stop-btn').addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type: 'stopRun', tabId: await activeTabId() });
  renderRun(r?.run || null);
});
$('continue-btn').addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type: 'continueRun', tabId: await activeTabId() });
  if (!r?.ok) return status($('run-status'), 'err', r?.error || 'Could not continue.');
  renderRun(r.run);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'runUpdate' && msg.run?.tabId === currentTabId) renderRun(msg.run);
});

// ---------------- main view events ----------------

$('mode').addEventListener('change', async () => {
  updateModeUI();
  settings = await storage.saveSettings({ mode: $('mode').value });
});
$('pattern').addEventListener('change', async () => {
  updateModeUI();
  settings = await storage.saveSettings({ scoringPattern: $('pattern').value });
});
$('custom-pattern').addEventListener('change', async () => {
  settings = await storage.saveSettings({ customPattern: $('custom-pattern').value.trim() });
});
$('scoring-text').addEventListener('change', async () => {
  settings = await storage.saveSettings({ scoringText: $('scoring-text').value });
  $('scoring-text').value = settings.scoringText; // shows the cleaned-up or default text
});
$('confirm-send').addEventListener('change', async () => {
  settings = await storage.saveSettings({ confirmBeforeSend: $('confirm-send').checked });
});

$('export-btn').addEventListener('click', async () => {
  const json = await storage.exportSettings();
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `quiz-qa-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  status($('settings-status'), 'ok', 'Settings exported (no API key included).');
});

// A file picker would close the popup on some systems, so import uses paste.
$('import-toggle').addEventListener('click', () => { $('import-box').hidden = !$('import-box').hidden; });
$('import-btn').addEventListener('click', async () => {
  try {
    settings = await storage.importSettings($('import-text').value);
    $('import-text').value = '';
    $('import-box').hidden = true;
    await showMain();
    syncModelSelect(settings.model);
    status($('settings-status'), 'ok', 'Settings imported. Your API key was not changed.');
  } catch (e) {
    status($('settings-status'), 'err', e.message);
  }
});

// ---------------- history + cache ----------------
// The service worker answers, because only it knows whether a run is alive.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const describe = (s) => `${plural(s.runs, 'run')}, ${plural(s.cached, 'cached answer')}`;

async function refreshHistory() {
  const r = await chrome.runtime.sendMessage({ type: 'historyStats' }).catch(() => null);
  if (!r?.ok) { $('history-info').textContent = ''; return null; }
  const empty = r.runs === 0 && r.cached === 0;
  $('history-info').textContent = r.busy ? `${describe(r)}. A run is in progress: stop it before clearing.`
    : empty ? 'Nothing stored.' : `Stored: ${describe(r)}.`;
  $('clear-history').disabled = r.busy || empty;
  if (r.busy) $('history-confirm').hidden = true;
  return r;
}

$('settings').addEventListener('toggle', () => { if ($('settings').open) refreshHistory(); });
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'runUpdate' && $('settings').open) refreshHistory();
});

$('clear-history').addEventListener('click', async () => {
  $('history-status').replaceChildren();
  const r = await refreshHistory();
  if (!r || r.busy) return;
  $('history-confirm-text').textContent =
    `Delete ${describe(r)}? Paused runs can no longer be continued. Your key and settings are kept. This cannot be undone.`;
  $('history-confirm').hidden = false;
  $('clear-history').hidden = true;
});

$('history-no').addEventListener('click', () => {
  $('history-confirm').hidden = true;
  $('clear-history').hidden = false;
});

$('history-yes').addEventListener('click', async () => {
  $('history-confirm').hidden = true;
  $('clear-history').hidden = false;
  const r = await chrome.runtime.sendMessage({ type: 'clearHistory' }).catch((e) => ({ ok: false, error: e.message }));
  if (r?.ok) {
    status($('history-status'), 'ok', 'History and cache cleared. Your key and settings were kept.');
    if (currentTabId != null) renderRun(null);
  } else {
    status($('history-status'), 'err', r?.error || 'Could not clear.');
  }
  await refreshHistory();
});

// ---------------- key + model form ----------------

function mountKeyForm(slot, { onboarding }) {
  slot.replaceChildren($('key-form-tpl').content.cloneNode(true));

  fillModelSelect(PRESET_MODELS, settings.model);
  storage.getKeyLocation().then((loc) => {
    $('sync-key').checked = loc === 'sync';
    $('clear-key').hidden = loc === 'none';
    $('key-current').textContent = loc === 'none' ? '' : 'A key is saved. Leave the field empty to keep it.';
    if (loc !== 'none') autoLoadModels({ quiet: true });
  });

  // As soon as a key is pasted, fetch the models it can use and pick a default.
  $('api-key').addEventListener('input', () => {
    if (storage.looksLikeGeminiKey($('api-key').value)) autoLoadModels({ quiet: false });
  });
  if (onboarding) $('save-btn').textContent = 'Save and continue';

  $('toggle-key').addEventListener('click', () => {
    const show = $('api-key').type === 'password';
    $('api-key').type = show ? 'text' : 'password';
    $('toggle-key').textContent = show ? 'Hide' : 'Show';
  });

  $('model').addEventListener('change', () => {
    $('model-other').hidden = $('model').value !== OTHER;
    if (!$('model-other').hidden) $('model-other').focus();
  });

  $('sync-key').addEventListener('change', () => {
    if ($('sync-key').checked) {
      status($('key-status'), 'err',
        'Heads-up: with sync on, your key is stored in your Google account\'s Chrome sync and copied to every computer where you sign in to Chrome. Click Save to apply.');
    } else {
      $('key-status').replaceChildren();
    }
  });

  $('load-models').addEventListener('click', () => autoLoadModels({ quiet: false }));

  $('test-btn').addEventListener('click', async () => {
    const key = await keyForAction();
    if (!key) return status($('key-status'), 'err', 'Paste your API key first.');
    const model = currentModel();
    if (!model) return status($('key-status'), 'err', 'Type a model name.');
    setBusy(true);
    status($('key-status'), 'busy', `Testing ${model}…`);
    let r = await testConnection(key, model);
    let note = '';
    // Google retired this model and named a replacement: switch and retry once.
    if (!r.ok && r.code === 'wrong_model' && r.suggestedModel && r.suggestedModel !== model) {
      status($('key-status'), 'busy', `${model} is retired; trying Google's replacement ${r.suggestedModel}…`);
      const retry = await testConnection(key, r.suggestedModel);
      if (retry.ok) {
        syncModelSelect(retry.model);
        note = ` Switched from ${model} (retired). Click Save to keep it.`;
        r = retry;
      }
    }
    setBusy(false);
    if (r.ok) status($('key-status'), 'ok', `✓ Connected. ${r.displayName} (${r.model}) replied "${r.reply}".${note}`);
    else status($('key-status'), 'err', `✗ ${labelFor(r.code)}: ${r.message}`);
  });

  $('save-btn').addEventListener('click', async () => {
    const typed = $('api-key').value.trim();
    const model = currentModel();
    if (!model) return status($('key-status'), 'err', 'Type a model name.');
    const existing = await storage.getApiKey();
    if (!typed && !existing) return status($('key-status'), 'err', 'Paste your API key first.');

    // Saving also moves an existing key between local and sync if the checkbox changed.
    await storage.setApiKey(typed || existing, { sync: $('sync-key').checked });
    settings = await storage.saveSettings({ model, onboarded: true });
    $('api-key').value = '';

    const warn = typed && !storage.looksLikeGeminiKey(typed)
      ? ' (Note: this doesn\'t look like a usual Gemini key; use Test connection to check.)' : '';
    if ($('onboarding').hidden) {
      await renderSummary();
      $('clear-key').hidden = false;
      $('key-current').textContent = 'A key is saved. Leave the field empty to keep it.';
      status($('key-status'), 'ok', 'Saved.' + warn);
    } else {
      await showMain();
      if (warn) status($('settings-status'), 'err', warn.trim());
    }
  });

  $('clear-key').addEventListener('click', async () => {
    if (!confirm('Remove the saved API key from this computer and from Chrome sync?')) return;
    await storage.clearApiKey();
    await storage.saveSettings({ onboarded: false });
    settings = await storage.getSettings();
    showOnboarding();
    status($('key-status'), 'ok', 'Key removed.');
  });
}

/**
 * Load the models this key can use (free; no generation quota) and fill the dropdown.
 * Keeps the current choice if the key has it, otherwise picks the newest stable Flash.
 */
async function autoLoadModels({ quiet }) {
  const key = await keyForAction();
  if (!key) { if (!quiet) status($('key-status'), 'err', 'Paste your API key first.'); return; }
  if (!quiet) status($('key-status'), 'busy', 'Loading the models your key can use…');
  try {
    const models = await listModels(key);
    if (!models.length) throw new Error('No Gemini models returned for this key.');
    const current = currentModel();
    const keep = current && current !== storage.DEFAULT_MODEL && models.some((m) => m.id === current);
    const chosen = keep ? current : pickDefaultModel(models);
    fillModelSelect(models, chosen);
    if (!quiet || !keep) {
      status($('key-status'), 'ok', `Found ${models.length} models for your key; selected ${chosen}. Click Test connection.`);
    }
  } catch (e) {
    if (!quiet) status($('key-status'), 'err', `Couldn't load models: ${e.message}`);
  }
}

/** Key typed in the field, or the saved one. */
async function keyForAction() {
  return $('api-key').value.trim() || (await storage.getApiKey());
}

function currentModel() {
  return $('model').value === OTHER ? $('model-other').value.trim() : $('model').value;
}

function fillModelSelect(models, selected) {
  const sel = $('model');
  sel.replaceChildren();
  for (const m of models) sel.add(new Option(m.label === m.id ? m.id : `${m.label} — ${m.id}`, m.id));
  sel.add(new Option('Other (type model name)…', OTHER));
  syncModelSelect(selected);
}

function syncModelSelect(model) {
  const sel = $('model');
  if (!sel) return;
  const known = [...sel.options].some((o) => o.value === model);
  sel.value = known ? model : OTHER;
  $('model-other').hidden = known;
  if (!known) $('model-other').value = model;
}

function setBusy(b) {
  for (const id of ['test-btn', 'save-btn', 'load-models']) $(id).disabled = b;
}

function labelFor(code) {
  return {
    bad_key: 'Bad API key', wrong_model: 'Wrong model', rate_limited: 'Rate limited',
    offline: 'Offline', timeout: 'Timed out', server: 'Server error', blocked: 'No answer',
  }[code] || 'Error';
}

function status(el, kind, text) {
  const d = document.createElement('div');
  d.className = `status ${kind}`;
  d.textContent = text;
  el.replaceChildren(d);
}
