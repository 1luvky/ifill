// storage.js - settings and API-key helpers.
// Used by background.js and popup.js (ES module, no build step).
//
// Where things live:
//   chrome.storage.local  -> settings, and the API key by default (this machine only)
//   chrome.storage.sync   -> the API key ONLY if the user opted in to syncing it
// The key is never logged and never included in exports.

// Google's alias that always points at the current Flash model. The popup replaces
// it with a concrete model from the key's own model list when it can.
export const DEFAULT_MODEL = 'gemini-flash-latest';

export const DEFAULT_SETTINGS = Object.freeze({
  model: DEFAULT_MODEL,
  mode: 'scoring',                // 'scoring' | 'key' | 'dryrun'
  scoringPattern: 'first',        // 'first' | 'alternating' | 'custom'
  customPattern: '',              // e.g. "A,C,B,D" or "1,3,2,4"
  confirmBeforeSend: true,        // ask before sending quiz content to Google
  onboarded: false,               // first-run screen completed
});

const SETTINGS_KEY = 'settings';
const API_KEY = 'apiKey';

// ---------- settings ----------

export async function getSettings() {
  const { [SETTINGS_KEY]: saved } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(saved || {}) };
}

export async function saveSettings(partial) {
  const next = { ...(await getSettings()), ...sanitizeSettings(partial) };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function resetSettings() {
  await chrome.storage.local.remove(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS };
}

// Keep only known keys with the right type; drops anything else (incl. any key field).
function sanitizeSettings(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    if (k in obj && typeof obj[k] === typeof def) out[k] = obj[k];
  }
  if (out.model !== undefined) out.model = out.model.trim() || DEFAULT_MODEL;
  if (out.mode && !['scoring', 'key', 'dryrun'].includes(out.mode)) delete out.mode;
  if (out.scoringPattern && !['first', 'alternating', 'custom'].includes(out.scoringPattern)) {
    delete out.scoringPattern;
  }
  return out;
}

// ---------- API key ----------

/** Rough format check. Gemini keys currently look like "AIza" + 35 chars. Used for a warning only. */
export function looksLikeGeminiKey(key) {
  return typeof key === 'string' && /^AIza[0-9A-Za-z_-]{35}$/.test(key.trim());
}

/** Returns the stored key or '' if none. Checks local first, then sync. */
export async function getApiKey() {
  const local = await chrome.storage.local.get(API_KEY);
  if (local[API_KEY]) return local[API_KEY];
  const sync = await chrome.storage.sync.get(API_KEY);
  return sync[API_KEY] || '';
}

/** 'local' | 'sync' | 'none' - where the key currently lives (for the popup UI). */
export async function getKeyLocation() {
  if ((await chrome.storage.local.get(API_KEY))[API_KEY]) return 'local';
  if ((await chrome.storage.sync.get(API_KEY))[API_KEY]) return 'sync';
  return 'none';
}

/**
 * Save the key in exactly one place. sync=true stores it in Chrome sync
 * (the user's Google account); otherwise it stays on this machine.
 */
export async function setApiKey(key, { sync = false } = {}) {
  const clean = (key || '').trim();
  if (!clean) throw new Error('API key is empty.');
  if (sync) {
    await chrome.storage.sync.set({ [API_KEY]: clean });
    await chrome.storage.local.remove(API_KEY);
  } else {
    await chrome.storage.local.set({ [API_KEY]: clean });
    await chrome.storage.sync.remove(API_KEY);
  }
}

/** Removes the key from both local and sync storage. */
export async function clearApiKey() {
  await Promise.all([
    chrome.storage.local.remove(API_KEY),
    chrome.storage.sync.remove(API_KEY),
  ]);
}

// ---------- run history + answer cache (never touches the key or settings) ----------

const HISTORY_KEYS = ['answerCache', 'runsIndex', 'activeRuns'];
const isHistoryKey = (k) => k.startsWith('run_') || HISTORY_KEYS.includes(k);

/** Counts what "Clear history and cache" would delete: {runs, cached}. */
export async function getHistoryStats() {
  const all = await chrome.storage.local.get(null);
  return {
    runs: Object.keys(all).filter((k) => k.startsWith('run_')).length,
    cached: Object.keys(all.answerCache || {}).length,
  };
}

/** Deletes run history and the answer cache. The API key and settings are kept. */
export async function clearHistoryAndCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(isHistoryKey);
  if (keys.length) await chrome.storage.local.remove(keys);
}

/** For display only: "AIza…x7Qk". */
export function maskKey(key) {
  if (!key) return '';
  return key.length <= 8 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

// ---------- export / import (never includes the key) ----------

export async function exportSettings() {
  const settings = await getSettings();
  return JSON.stringify(
    { app: 'quiz-qa-checker', version: 1, exportedAt: new Date().toISOString(), settings },
    null, 2,
  );
}

export async function importSettings(jsonText) {
  let data;
  try { data = JSON.parse(jsonText); } catch { throw new Error('File is not valid JSON.'); }
  if (data?.app !== 'quiz-qa-checker' || typeof data.settings !== 'object') {
    throw new Error('This is not an iFill settings file.');
  }
  return saveSettings(data.settings); // sanitizeSettings drops unknown fields
}
