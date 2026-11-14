// llm.js - Gemini client.
// Part 1: low-level request helper, error classification, connection test, model list.
// Part 2 (later step): answerQuestions(questions) with JSON schema, retries, cache.
//
// The API key is sent ONLY to generativelanguage.googleapis.com in the
// x-goog-api-key header. It is never logged or put in a URL.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TIMEOUT_MS = 30000;

export class GeminiError extends Error {
  /**
   * @param {string} code  'bad_key' | 'wrong_model' | 'rate_limited' | 'offline' |
   *                       'timeout' | 'server' | 'blocked' | 'bad_request' | 'unknown'
   */
  constructor(code, message, { status = 0, retryAfterMs = 0, suggestedModel = '' } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.suggestedModel = suggestedModel; // set when Google names a replacement model
  }
}

/** Low-level request. Throws GeminiError with a friendly message on failure. */
export async function geminiRequest(path, { apiKey, method = 'POST', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!apiKey) throw new GeminiError('bad_key', 'No API key saved. Paste your Gemini API key first.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new GeminiError('offline', 'You appear to be offline. Check your internet connection.');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_BASE}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new GeminiError('timeout', `Gemini did not answer within ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw new GeminiError('offline', 'Could not reach Google (network error). Check your internet connection.');
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) throw classifyHttpError(res, data);
  return data;
}

function classifyHttpError(res, data) {
  const status = res.status;
  const apiMsg = data?.error?.message || '';
  const apiStatus = data?.error?.status || '';
  const reasons = JSON.stringify(data?.error?.details || []);
  const short = apiMsg ? ` (Google says: ${apiMsg.slice(0, 200)})` : '';

  if (/API_KEY_INVALID|API key not valid|API_KEY_/i.test(apiMsg + reasons) || status === 401) {
    return new GeminiError('bad_key', 'The API key was rejected. Check that you copied the whole key from AI Studio.', { status });
  }
  if (status === 403) {
    return new GeminiError('bad_key', `Access denied for this key${short}. The key may be restricted or the Gemini API not enabled for its project.`, { status });
  }
  // Retired models answer 404 and often name a replacement: "...use models/gemini-X-flash ...".
  const suggestedModel = (/use (?:models\/)?(gemini[\w.\-]*[\w])/i.exec(apiMsg) || [])[1] || '';
  if (status === 404 || (suggestedModel && /no longer available|deprecated|retired/i.test(apiMsg))) {
    return new GeminiError('wrong_model', `Model not available${short}.`, { status, suggestedModel });
  }
  if (status === 429 || apiStatus === 'RESOURCE_EXHAUSTED') {
    const retryAfterMs = parseRetryDelay(res, data);
    return new GeminiError('rate_limited',
      `Rate limited or out of free quota for this model${short}. Wait a bit or try a different model.`,
      { status, retryAfterMs });
  }
  if (status >= 500) {
    return new GeminiError('server', `Google's server had a problem (HTTP ${status}). Try again in a moment.`, { status });
  }
  if (status === 400) {
    return new GeminiError('bad_request', `Request rejected (HTTP 400)${short}.`, { status });
  }
  return new GeminiError('unknown', `Unexpected error (HTTP ${status})${short}.`, { status });
}

// Google may send Retry-After or a RetryInfo detail like {"retryDelay":"17s"}.
function parseRetryDelay(res, data) {
  const header = Number(res.headers.get('retry-after'));
  if (header > 0) return header * 1000;
  const info = (data?.error?.details || []).find((d) => d?.retryDelay);
  const m = info && /^(\d+(?:\.\d+)?)s$/.exec(info.retryDelay);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : 0;
}

/** Text of the first candidate, or throws 'blocked' if the response has none. */
export function extractText(data) {
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) {
    const why = data?.promptFeedback?.blockReason || cand?.finishReason || 'no content';
    throw new GeminiError('blocked', `Gemini returned no answer (${why}).`);
  }
  return text;
}

/**
 * Connection test used by the popup.
 * Step 1: GET the model info (costs no generation quota) -> catches bad key / wrong model.
 * Step 2: tiny generateContent -> confirms the key actually has quota for this model.
 * Returns { ok: true, model, displayName, reply } or { ok: false, code, message }.
 */
export async function testConnection(apiKey, model) {
  let modelFound = false;
  try {
    const name = normalizeModel(model);
    const info = await geminiRequest(`models/${name}`, { apiKey, method: 'GET', timeoutMs: 15000 });
    modelFound = true;
    const data = await generateWithLowThinking(name, {
      apiKey,
      timeoutMs: 60000,
      body: { contents: [{ role: 'user', parts: [{ text: 'Reply with exactly the word OK.' }] }] },
    });
    return { ok: true, model: name, displayName: info?.displayName || name, reply: extractText(data).trim().slice(0, 40) };
  } catch (err) {
    if (err instanceof GeminiError && err.code === 'timeout' && modelFound) {
      return {
        ok: false, code: 'timeout',
        message: 'Your key and model are valid (the model was found), but it did not reply within 60s. '
          + 'It may be overloaded right now. Try again in a minute, or pick a Flash-Lite model.',
      };
    }
    if (err instanceof GeminiError) {
      return { ok: false, code: err.code, message: err.message, suggestedModel: err.suggestedModel };
    }
    return { ok: false, code: 'unknown', message: String(err?.message || err) };
  }
}

/**
 * generateContent asking the model to think as little as possible (faster, uses less quota).
 * Newer models take thinkingLevel, older 2.x models take thinkingBudget, and some
 * accept neither, so fall back on a 400 that mentions thinking.
 */
const THINKING_VARIANTS = [{ thinkingLevel: 'low' }, { thinkingBudget: 0 }, null];

export async function generateWithLowThinking(model, { apiKey, body, timeoutMs }) {
  let lastErr;
  for (const thinkingConfig of THINKING_VARIANTS) {
    const generationConfig = { ...(body.generationConfig || {}) };
    if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
    else delete generationConfig.thinkingConfig;
    try {
      return await geminiRequest(`models/${model}:generateContent`, {
        apiKey, timeoutMs, body: { ...body, generationConfig },
      });
    } catch (err) {
      lastErr = err;
      const thinkingRejected = err.code === 'bad_request' && /think/i.test(err.message);
      if (!thinkingRejected) throw err;
    }
  }
  throw lastErr;
}

/** Models this key can call generateContent on (for the popup dropdown). Free: no generation quota used. */
export async function listModels(apiKey) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < 5; i++) {
    const q = `models?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await geminiRequest(q, { apiKey, method: 'GET', timeoutMs: 15000 });
    for (const m of data?.models || []) {
      if ((m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name)) {
        out.push({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name });
      }
    }
    pageToken = data?.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/**
 * Pick a sensible default from listModels() output: newest stable "gemini-N.N-flash",
 * then the "gemini-flash-latest" alias, then newest flash variant (not lite), then first.
 */
export function pickDefaultModel(models) {
  const ids = models.map((m) => m.id);
  const ver = (id) => parseFloat((/^gemini-(\d+(?:\.\d+)?)-/.exec(id) || [])[1] || '0');
  const newest = (list) => list.sort((a, b) => ver(b) - ver(a))[0];
  return newest(ids.filter((id) => /^gemini-\d+(?:\.\d+)?-flash$/.test(id)))
    || ids.find((id) => id === 'gemini-flash-latest')
    || newest(ids.filter((id) => /^gemini-\d+(?:\.\d+)?-flash(?!-lite)/.test(id)))
    || ids[0] || '';
}

export function normalizeModel(model) {
  const m = String(model || '').trim().replace(/^models\//, '');
  if (!m) throw new GeminiError('wrong_model', 'No model selected.');
  if (!/^[\w.\-]+$/.test(m)) throw new GeminiError('wrong_model', `"${m}" is not a valid model name.`);
  return m;
}

// =====================================================================
// Part 2: answerQuestions(questions) - the one function callers use.
// Swap providers later by re-implementing just this function.
// =====================================================================

import { getApiKey, getSettings } from './storage.js';

const PROMPT_VERSION = 3;                      // bump to invalidate the cache when the prompt changes
const CHOICE_TYPES = new Set(['single', 'multi', 'truefalse']);
const TEXT_TYPES = new Set(['text', 'paragraph']);   // 'detail' (name, email, ID…) is never sent
const SHORT_MAX_WORDS = 12;
const PARAGRAPH_MAX_WORDS = 120;
const MAX_REQUEST_BYTES = 14 * 1024 * 1024;    // stay well under Gemini's ~20 MB inline request limit
const MAX_QUESTIONS_PER_REQUEST = 60;
const VALIDATION_RETRIES = 2;                  // re-ask for questions whose answer was missing/invalid
const MAX_RATE_LIMIT_RETRIES = 6;              // 2s, 4s, 8s, 16s, 32s, 64s (or Google's suggested delay)
const MAX_TRANSIENT_RETRIES = 2;               // timeouts / 5xx
const CACHE_KEY = 'answerCache';
const CACHE_MAX_ENTRIES = 3000;

const SYSTEM_PROMPT = `You are helping a teacher quality-check a quiz they wrote, before it goes live.
For each question, work out the correct answer from your own knowledge. No answer in the input is marked as correct; do not assume the first or any option is right.
Rules:
- Choice questions: answer with option ids exactly as given (for example "A"), and leave textAnswer empty.
- "single" and "truefalse": exactly one id. "multi": every correct id (one or more).
- "text" (short answer): put the answer in textAnswer and leave answer as []. Write only the answer itself, the way a teacher's answer key would most likely list it: usually 1 to 5 words, no full sentence, no trailing full stop, no quotes. If the question says the answer must be a number, give digits only.
- "paragraph": put a clear, correct answer of 2 to 4 sentences (at most ${PARAGRAPH_MAX_WORDS} words) in textAnswer, in plain text without lists, headings or markdown, and leave answer as [].
- Respect any character limit given for a question.
- Images are labeled with the question or option they belong to. Use them. If an option has no text, its image IS the option.
- confidence: a number from 0 to 1, your probability that your whole answer is correct. Use low values if the question is ambiguous, an image is unclear, or several options could be right.
- reasoning: one or two short sentences. Say so if the question itself looks flawed (ambiguous, no correct option, more than one correct option for a single-choice question).
- readText: if the question text was only available in an image or screenshot, write the question text you read there; otherwise an empty string.
- Return exactly one entry for every question id you were given.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          answer: { type: 'ARRAY', items: { type: 'STRING' } },
          textAnswer: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
          reasoning: { type: 'STRING' },
          readText: { type: 'STRING' },
        },
        required: ['id', 'confidence', 'reasoning'],
        propertyOrdering: ['id', 'answer', 'textAnswer', 'confidence', 'reasoning', 'readText'],
      },
    },
  },
  required: ['answers'],
};

/**
 * @param {Array} questions  see the question format at the top of this section
 * @param {{onProgress?: Function, signal?: AbortSignal}} opts
 * @returns {Promise<Array>} one result per question, same order:
 *   {id, status:'answered', answer:[ids], answerText:[texts], confidence, reasoning, model, cached}
 *     text/paragraph questions: answer:[], textAnswer:'…', answerText:['…']
 *   {id, status:'skipped', reason}   - unsupported type / nothing to send
 *   {id, status:'error',   reason}   - model never gave a valid answer
 */
export async function answerQuestions(questions, { onProgress = () => {}, signal } = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new GeminiError('bad_key', 'No API key saved. Open the extension popup and add your Gemini key.');
  const model = normalizeModel((await getSettings()).model);

  const results = new Map();
  const toAsk = [];
  const cache = await loadCache();
  let cachedCount = 0;

  for (const q of questions) {
    const problem = whyUnsupported(q);
    if (problem) { results.set(q.id, { id: q.id, status: 'skipped', reason: problem }); continue; }
    const hash = await questionHash(model, q);
    if (cache[hash]) {
      results.set(q.id, { ...cache[hash].result, id: q.id, cached: true });
      cachedCount++;
      continue;
    }
    toAsk.push({ q, hash });
  }

  const batches = makeBatches(toAsk);
  onProgress({
    stage: 'start', total: questions.length, cached: cachedCount,
    skipped: questions.length - cachedCount - toAsk.length, toAsk: toAsk.length, requests: batches.length,
    message: toAsk.length
      ? `Asking Gemini about ${toAsk.length} question(s) in ${batches.length} request(s); ${cachedCount} from cache.`
      : `All ${cachedCount} answerable question(s) came from cache; nothing sent.`,
  });

  for (let i = 0; i < batches.length; i++) {
    const answered = await askBatch(model, apiKey, batches[i], {
      signal,
      onProgress: (p) => onProgress({ ...p, request: i + 1, requests: batches.length }),
    });
    for (const { q, hash } of batches[i]) {
      const r = answered.get(q.id);
      results.set(q.id, r);
      if (r.status === 'answered') cache[hash] = { ts: Date.now(), result: { ...r, cached: false } };
    }
    await saveCache(cache);
    onProgress({ stage: 'request-done', request: i + 1, requests: batches.length,
      message: `Request ${i + 1}/${batches.length} done.` });
  }

  return questions.map((q) => results.get(q.id));
}

export async function clearAnswerCache() {
  await chrome.storage.local.remove(CACHE_KEY);
}

// ---------- validation of input ----------

function whyUnsupported(q) {
  if (q.type === 'detail') return 'Personal-details field (name, email, ID…): left for you and never sent to Gemini.';
  if (TEXT_TYPES.has(q.type)) {
    const hasContent = q.text || q.screenshot || (q.images || []).length;
    return hasContent ? '' : 'No question text or image found.';
  }
  if (!CHOICE_TYPES.has(q.type)) return `Unsupported question type "${q.type}" (skipped, not guessed).`;
  if (!Array.isArray(q.options) || q.options.length < 2) return 'Fewer than two options found.';
  const ids = q.options.map((o) => o.id);
  if (ids.some((x) => !x) || new Set(ids).size !== ids.length) return 'Options are missing ids or have duplicate ids.';
  const hasContent = q.text || q.screenshot || (q.images || []).length;
  if (!hasContent) return 'No question text or image found.';
  return '';
}

// ---------- request building ----------

function toInlinePart(img) {
  if (typeof img === 'string') { // data URL
    const m = /^data:([^;]+);base64,(.*)$/.exec(img);
    if (!m) throw new Error('Image is not a base64 data URL.');
    return { inlineData: { mimeType: m[1], data: m[2] } };
  }
  return { inlineData: { mimeType: img.mimeType, data: img.data } };
}

function imageList(x) { return (x || []).filter(Boolean); }

function questionParts(q) {
  const parts = [];
  const lines = [`### Question id="${q.id}" (type: ${q.type})`];
  lines.push(q.text ? q.text : '(Question text is only in the image(s) below.)');
  if (TEXT_TYPES.has(q.type)) {
    lines.push(q.type === 'text' ? 'Answer field: one line (short answer).' : 'Answer field: paragraph.');
    if (q.numeric) lines.push('The field only accepts a number.');
    if (q.maxLength) lines.push(`Character limit: ${q.maxLength}.`);
  } else {
    lines.push('Options:');
    for (const o of q.options) {
      const imgNote = imageList(o.images).length ? ' [see image labeled for this option]' : '';
      lines.push(`  ${o.id}) ${o.text || (imgNote ? '(no text)' : '(empty)')}${imgNote}`);
    }
  }
  parts.push({ text: lines.join('\n') });

  if (q.screenshot) {
    parts.push({ text: `Screenshot of question "${q.id}" (its text may only be visible here):` });
    parts.push(toInlinePart(q.screenshot));
  }
  imageList(q.images).forEach((img, i) => {
    parts.push({ text: `Image ${i + 1} for question "${q.id}":` });
    parts.push(toInlinePart(img));
  });
  for (const o of q.options || []) {
    imageList(o.images).forEach((img, i) => {
      parts.push({ text: `Image ${i + 1} for question "${q.id}", option ${o.id}:` });
      parts.push(toInlinePart(img));
    });
  }
  return parts;
}

function buildBody(items, correction) {
  const parts = [{ text: `Answer the following ${items.length} question(s).` }];
  for (const { q } of items) parts.push(...questionParts(q));
  if (correction) parts.push({ text: `IMPORTANT, fix this from your previous attempt: ${correction}` });
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
  };
}

function approxBytes(q) {
  return JSON.stringify(questionParts(q)).length;
}

function makeBatches(items) {
  const batches = [];
  let cur = [], size = 0;
  for (const it of items) {
    const b = approxBytes(it.q);
    if (cur.length && (size + b > MAX_REQUEST_BYTES || cur.length >= MAX_QUESTIONS_PER_REQUEST)) {
      batches.push(cur); cur = []; size = 0;
    }
    cur.push(it); size += b;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// ---------- calling + validating ----------

async function askBatch(model, apiKey, items, { onProgress, signal }) {
  const out = new Map();
  let pending = items;
  let correction = '';

  for (let attempt = 0; attempt <= VALIDATION_RETRIES && pending.length; attempt++) {
    if (attempt > 0) {
      onProgress({ stage: 'revalidate', message: `Re-asking ${pending.length} question(s) with invalid answers (try ${attempt + 1}).` });
    } else {
      onProgress({ stage: 'request', message: `Sending ${pending.length} question(s) to Gemini…` });
    }
    const data = await withBackoff(
      () => generateWithLowThinking(model, { apiKey, timeoutMs: 180000, body: buildBody(pending, correction) }),
      { onProgress, signal },
    );

    let parsed;
    try {
      parsed = JSON.parse(stripFences(extractText(data)));
    } catch {
      correction = 'Your previous reply was not valid JSON. Reply with JSON matching the schema only.';
      continue;
    }
    const byId = new Map((parsed?.answers || []).map((a) => [String(a?.id), a]));
    const problems = [];
    const stillPending = [];
    for (const it of pending) {
      const v = validateAnswer(it.q, byId.get(it.q.id));
      if (v.ok) out.set(it.q.id, { ...v.result, model, cached: false });
      else { problems.push(`question "${it.q.id}": ${v.error}`); stillPending.push(it); }
    }
    pending = stillPending;
    correction = problems.join('; ');
  }

  for (const it of pending) {
    out.set(it.q.id, { id: it.q.id, status: 'error', reason: `Gemini did not give a valid answer: ${correction || 'unknown problem'}` });
  }
  return out;
}

function stripFences(s) {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
}

function confidenceOf(a) {
  let conf = Number(a.confidence);
  if (!Number.isFinite(conf)) conf = 0.5;
  if (conf > 1 && conf <= 100) conf /= 100;
  return Math.round(Math.min(1, Math.max(0, conf)) * 100) / 100;
}

const wordCount = (t) => (t.match(/\S+/g) || []).length;

function validateTextAnswer(q, a) {
  let t = String(a.textAnswer ?? '').trim();
  // Light clean-up of things the prompt asks for anyway: wrapping quotes, markdown emphasis.
  t = t.replace(/^["'“‘]+|["'”’]+$/g, '').replace(/\*\*|__/g, '').trim();
  if (!t) return { ok: false, error: 'textAnswer is empty' };
  if (q.type === 'text') {
    t = t.replace(/\s*\n+\s*/g, ' ');
    if (q.numeric) {
      const num = t.replace(/[,\s]/g, '');
      if (!/^-?\d+(\.\d+)?$/.test(num)) return { ok: false, error: 'this field only accepts a number: give digits only in textAnswer' };
      t = num;
    }
    if (wordCount(t) > SHORT_MAX_WORDS) return { ok: false, error: `a short answer must be at most ${SHORT_MAX_WORDS} words` };
  } else if (wordCount(t) > PARAGRAPH_MAX_WORDS) {
    return { ok: false, error: `the paragraph must be at most ${PARAGRAPH_MAX_WORDS} words` };
  }
  if (q.maxLength && t.length > q.maxLength) return { ok: false, error: `the answer must be at most ${q.maxLength} characters` };
  return {
    ok: true,
    result: {
      id: q.id, status: 'answered', answer: [], textAnswer: t, answerText: [t],
      confidence: confidenceOf(a),
      reasoning: String(a.reasoning || '').slice(0, 600),
      readText: String(a.readText || '').slice(0, 1000),
    },
  };
}

function validateAnswer(q, a) {
  if (!a) return { ok: false, error: 'missing from your reply' };
  if (TEXT_TYPES.has(q.type)) return validateTextAnswer(q, a);
  const byUpper = new Map(q.options.map((o) => [String(o.id).toUpperCase(), o]));
  const raw = Array.isArray(a.answer) ? a.answer : [a.answer];
  const chosen = [...new Set(raw.map((x) => String(x ?? '').trim().replace(/[).]$/, '').toUpperCase()))]
    .filter(Boolean);
  const unknown = chosen.filter((x) => !byUpper.has(x));
  if (unknown.length) return { ok: false, error: `unknown option id(s) ${unknown.join(', ')}; valid ids are ${q.options.map((o) => o.id).join(', ')}` };
  if (!chosen.length) return { ok: false, error: 'no option chosen' };
  if (q.type !== 'multi' && chosen.length !== 1) return { ok: false, error: `exactly one option required, got ${chosen.length}` };

  const opts = chosen.map((x) => byUpper.get(x));
  return {
    ok: true,
    result: {
      id: q.id,
      status: 'answered',
      answer: opts.map((o) => o.id),
      answerText: opts.map((o) => o.text || `(image option ${o.id})`),
      confidence: confidenceOf(a),
      reasoning: String(a.reasoning || '').slice(0, 600),
      readText: String(a.readText || '').slice(0, 1000),
    },
  };
}

/** Retries on 429 (exponential backoff, honoring Google's suggested delay) and on timeouts/5xx. */
async function withBackoff(fn, { onProgress, signal }) {
  let rateTries = 0, transientTries = 0;
  for (;;) {
    if (signal?.aborted) throw new GeminiError('unknown', 'Run cancelled.');
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof GeminiError)) throw err;
      let wait = 0;
      if (err.code === 'rate_limited' && rateTries < MAX_RATE_LIMIT_RETRIES) {
        wait = Math.max(err.retryAfterMs || 0, 2000 * 2 ** rateTries) + Math.random() * 1000;
        rateTries++;
        onProgress({ stage: 'rate_limited', retryInMs: wait,
          message: `Rate limited, retrying in ${Math.round(wait / 1000)}s (attempt ${rateTries}/${MAX_RATE_LIMIT_RETRIES})…` });
      } else if ((err.code === 'timeout' || err.code === 'server') && transientTries < MAX_TRANSIENT_RETRIES) {
        wait = 3000 * 2 ** transientTries;
        transientTries++;
        onProgress({ stage: 'retry', retryInMs: wait,
          message: `${err.message} Retrying in ${Math.round(wait / 1000)}s…` });
      } else {
        throw err;
      }
      await sleep(Math.min(wait, 90000), signal);
    }
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new GeminiError('unknown', 'Run cancelled.')); }, { once: true });
  });
}

// ---------- cache ----------

// Images with a stable source URL are hashed by URL (screenshots can differ by a pixel between runs).
const imageKey = (i) => (i && typeof i === 'object' && i.key) || toInlinePart(i).inlineData.data;

async function questionHash(model, q) {
  const canon = JSON.stringify({
    v: PROMPT_VERSION, model, type: q.type, text: q.text || '',
    numeric: !!q.numeric, maxLength: q.maxLength || 0,
    images: imageList(q.images).map(imageKey),
    screenshot: q.screenshot ? imageKey(q.screenshot) : '',
    options: (q.options || []).map((o) => [o.id, o.text || '', imageList(o.images).map(imageKey)]),
  });
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadCache() {
  const { [CACHE_KEY]: c } = await chrome.storage.local.get(CACHE_KEY);
  return c && typeof c === 'object' ? c : {};
}

async function saveCache(cache) {
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX_ENTRIES) {
    keys.sort((a, b) => cache[a].ts - cache[b].ts)
      .slice(0, keys.length - CACHE_MAX_ENTRIES)
      .forEach((k) => delete cache[k]);
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}
