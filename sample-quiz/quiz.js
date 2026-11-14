// Renders SAMPLE_QUIZ one section at a time using ARIA widgets
// (role=radio / role=checkbox with aria-checked), like Google Forms does.
(() => {
  const params = new URLSearchParams(location.search);
  const BUG_SAVE = params.get('bug') === 'save';
  // ?xorigin=1 loads images from 127.0.0.1 instead of localhost (a different origin),
  // so the extension cannot read them directly and must fall back to a screenshot crop.
  const XORIGIN = params.get('xorigin') === '1' && location.hostname === 'localhost';
  const imgSrc = (path) => (XORIGIN ? `http://127.0.0.1:${location.port}${location.pathname.replace(/[^/]*$/, '')}${path}` : path);
  const answers = {};          // id -> array of chosen labels (or [text] for short answer)
  let sectionIdx = 0;

  const $ = (id) => document.getElementById(id);
  $('quiz-title').textContent = SAMPLE_QUIZ.title;
  $('quiz-desc').textContent = SAMPLE_QUIZ.description;
  if (params.get('bug')) {
    $('bug-banner').hidden = false;
    $('bug-banner').textContent = `Planted bug active: ${params.get('bug')}`;
  }

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else e.setAttribute(k, v);
    }
    for (const c of children) e.append(c);
    return e;
  }

  function drawCanvasText(text) {
    const c = el('canvas', { width: 600, height: 34, 'aria-hidden': 'true' });
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#202124'; ctx.font = '16px Arial'; ctx.fillText(text, 0, 22);
    return c;
  }

  function renderQuestion(q) {
    const item = el('div', { role: 'listitem', class: 'card', 'data-qid': q.id });
    if (q.locked) {
      item.classList.add('locked');
      item.addEventListener('copy', (e) => e.preventDefault());
      item.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    const heading = el('div', { role: 'heading', 'aria-level': '3' });
    heading.append(q.canvasText ? drawCanvasText(q.canvasText) : q.text);
    item.append(heading);
    if (q.image) item.append(el('img', { src: imgSrc(q.image), class: 'q-image', alt: '' }));

    // Text questions: one-line input (short answer, personal detail) or a textarea (paragraph).
    if (q.type === 'short' || q.type === 'paragraph' || q.type === 'detail') {
      const field = q.type === 'paragraph'
        ? el('textarea', { 'aria-label': 'Your answer' })
        : el('input', q.type === 'detail'
          ? { type: 'text', 'aria-label': q.text, autocomplete: 'name' }
          : { type: 'text', 'aria-label': 'Your answer', autocomplete: 'off' });
      field.value = answers[q.id]?.[0] || '';
      field.addEventListener('input', () => { answers[q.id] = [field.value]; });
      item.append(field);
      return item;
    }

    const multi = q.type === 'multi';
    const group = el('div', { role: multi ? 'group' : 'radiogroup' });
    q.options.forEach((label, i) => {
      const chosen = (answers[q.id] || []).includes(label);
      const opt = el('div', {
        role: multi ? 'checkbox' : 'radio',
        class: 'opt', tabindex: '0',
        'aria-checked': String(chosen),
        'data-value': label,
      }, el('span', { class: 'mark' }));
      if (q.optionImages) {
        // Image-only option: no visible text, alt left empty on purpose.
        opt.append(el('img', { src: imgSrc(q.optionImages[i]), alt: '' }));
      } else {
        opt.setAttribute('aria-label', label);
        opt.append(el('span', {}, label));
      }
      const toggle = () => {
        if (multi) {
          const set = new Set(answers[q.id] || []);
          set.has(label) ? set.delete(label) : set.add(label);
          answers[q.id] = [...set];
        } else {
          answers[q.id] = [label];
        }
        group.querySelectorAll('.opt').forEach((o) =>
          o.setAttribute('aria-checked', String(answers[q.id].includes(o.dataset.value))));
      };
      opt.addEventListener('click', toggle);
      opt.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
      });
      group.append(opt);
    });
    item.append(group);
    return item;
  }

  function render() {
    const section = SAMPLE_QUIZ.sections[sectionIdx];
    const last = sectionIdx === SAMPLE_QUIZ.sections.length - 1;
    $('section-title').textContent = `${section.title} (page ${sectionIdx + 1} of ${SAMPLE_QUIZ.sections.length})`;
    $('questions').replaceChildren(...section.questions.map(renderQuestion));
    $('back-btn').hidden = sectionIdx === 0;
    $('next-btn').hidden = last;
    $('submit-btn').hidden = !last;
    window.scrollTo(0, 0);
  }

  $('next-btn').addEventListener('click', () => { sectionIdx++; render(); });
  $('back-btn').addEventListener('click', () => { sectionIdx--; render(); });
  $('quiz-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const saved = structuredClone(answers);
    if (BUG_SAVE) saved.q1 = [SAMPLE_QUIZ.sections[0].questions[0].options[0]];
    sessionStorage.setItem('sampleQuizAnswers', JSON.stringify(saved));
    location.href = 'results.html' + location.search;
  });

  render();
})();
