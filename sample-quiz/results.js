// Results/review page: shows each question with the chosen answer,
// the correct answer, per-question points, and the total score.
(() => {
  const params = new URLSearchParams(location.search);
  const BUG_SCORE = params.get('bug') === 'score';
  const answers = JSON.parse(sessionStorage.getItem('sampleQuizAnswers') || '{}');
  const $ = (id) => document.getElementById(id);

  $('quiz-title').textContent = SAMPLE_QUIZ.title + ' - Results';
  $('retake').href = 'index.html' + location.search;
  if (params.get('bug')) {
    $('bug-banner').hidden = false;
    $('bug-banner').textContent = `Planted bug active: ${params.get('bug')}`;
  }

  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  // Short answers match if they equal an accepted answer, ignoring case and extra spaces.
  const norm = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const textMatches = (given, accepted) => accepted.some((a) => norm(a) === norm(given));
  let earned = 0, possible = 0;
  const list = $('results');

  for (const section of SAMPLE_QUIZ.sections) {
    for (const q of section.questions) {
      const chosen = answers[q.id] || [];
      const card = document.createElement('div');
      card.className = 'card';
      card.setAttribute('role', 'listitem');
      card.dataset.qid = q.id;

      const heading = document.createElement('div');
      heading.setAttribute('role', 'heading');
      heading.textContent = q.text || q.canvasText;
      card.append(heading);

      // Personal details and paragraphs: shown, not graded.
      if (q.type === 'detail' || q.type === 'paragraph') {
        const p = document.createElement('div');
        p.className = 'your-answer';
        p.textContent = `${q.type === 'detail' ? q.text : 'Your answer'}: ${chosen[0] || '(blank)'}`
          + (q.type === 'paragraph' ? ' (not graded)' : '');
        card.append(p);
        list.append(card);
        continue;
      }

      // Short answer: graded against the accepted answers.
      if (q.type === 'short') {
        const given = chosen[0] || '';
        const ok = given.trim() !== '' && textMatches(given, q.key);
        const pts = ok ? q.points : 0;
        earned += pts; possible += q.points;
        const ptsEl = document.createElement('span');
        ptsEl.className = 'points';
        ptsEl.textContent = `${pts}/${q.points}`;
        heading.prepend(ptsEl);
        const p = document.createElement('div');
        p.className = `res-opt chosen ${ok ? 'right' : 'wrong'}`;
        p.textContent = `${ok ? '✓' : '✗'} Your answer: ${given || '(blank)'}`;
        card.append(p);
        if (!ok) {
          const ca = document.createElement('div');
          ca.className = 'correct-answer';
          ca.textContent = 'Accepted answers: ' + q.key.join(', ');
          card.append(ca);
        }
        list.append(card);
        continue;
      }

      const correct = sameSet(chosen, q.key);
      const pts = correct ? q.points : 0;
      earned += pts; possible += q.points;

      const ptsEl = document.createElement('span');
      ptsEl.className = 'points';
      ptsEl.textContent = `${pts}/${q.points}`;
      heading.prepend(ptsEl);

      q.options.forEach((label, i) => {
        const row = document.createElement('div');
        row.className = 'res-opt';
        row.dataset.value = label;
        const isChosen = chosen.includes(label);
        if (isChosen) {
          row.classList.add('chosen', q.key.includes(label) ? 'right' : 'wrong');
          row.setAttribute('aria-label', `${label} (your answer)`);
        }
        const mark = document.createElement('span');
        mark.textContent = isChosen ? (q.key.includes(label) ? '✓' : '✗') : '○';
        row.append(mark);
        if (q.optionImages) {
          const img = document.createElement('img');
          img.src = q.optionImages[i]; img.alt = '';
          row.append(img);
        }
        const text = document.createElement('span');
        text.textContent = label;
        row.append(text);
        card.append(row);
      });

      if (!correct) {
        const ca = document.createElement('div');
        ca.className = 'correct-answer';
        ca.textContent = 'Correct answer: ' + q.key.join(', ');
        card.append(ca);
      }
      list.append(card);
    }
  }

  const shown = BUG_SCORE ? earned + 1 : earned;
  $('score-display').textContent = `${shown} / ${possible}`;
  $('percent-display').textContent = `${Math.round((shown / possible) * 100)}%`;
})();
