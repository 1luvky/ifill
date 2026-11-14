// Sample quiz definition, shared by the quiz page and the results page.
// The extension never reads this file; it only sees the rendered DOM.
//
// PLANTED PROBLEMS (what the checker should catch):
//   q7  - answer key is WRONG on purpose (key says 365; a leap year has 366 days).
//   ?bug=score  - results page shows a total 1 point higher than it should.
//   ?bug=save   - the quiz silently records the FIRST option for q1, whatever you pick.
//   ?xorigin=1  - images load from another origin (tests the screenshot fallback).
//   q10 - short-answer key is TOO STRICT on purpose: it accepts only "sixty", so "60" is marked wrong.
//
// TEXT QUESTIONS (iFill 1.1):
//   name - a personal-details field. iFill must leave it for you, never fill it.
//   q8   - paragraph, not graded.
//   q9, q10 - short answer, graded. Matching ignores case and extra spaces.

const SAMPLE_QUIZ = {
  title: 'Sample QA Quiz',
  description: 'Local test quiz for Quiz QA Checker. Not a real quiz.',
  sections: [
    {
      title: 'Section 1: Text questions',
      questions: [
        { id: 'name', type: 'detail', points: 0, text: 'Your name' },
        { id: 'q1', type: 'single', points: 1, text: 'What is the capital of France?',
          options: ['Berlin', 'Madrid', 'Paris', 'Rome'], key: ['Paris'] },
        { id: 'q2', type: 'multi', points: 1, text: 'Which of these are prime numbers? (Select all that apply)',
          options: ['2', '4', '5', '9'], key: ['2', '5'] },
        { id: 'q3', type: 'single', points: 1, text: 'True or false: The Earth orbits the Sun.',
          options: ['True', 'False'], key: ['True'] },
        { id: 'q4', type: 'single', points: 1, text: 'Look at the triangle. What is the value of x (in degrees)?',
          image: 'img/triangle.svg', options: ['60', '70', '80', '90'], key: ['70'] },
      ],
    },
    {
      title: 'Section 2: Images, locked text, and a bad key',
      questions: [
        { id: 'q5', type: 'single', points: 1, text: 'Which shape is a hexagon?',
          // Image-only options: the label is NOT visible text, only the picture.
          options: ['A', 'B', 'C', 'D'],
          optionImages: ['img/triangle-shape.svg', 'img/square.svg', 'img/pentagon.svg', 'img/hexagon.svg'],
          key: ['D'] },
        { id: 'q6', type: 'single', points: 1,
          // Question text is drawn on a <canvas> - there is no text in the DOM.
          canvasText: 'What is 7 × 8?', locked: true,
          options: ['54', '56', '58', '64'], key: ['56'] },
        { id: 'q7', type: 'single', points: 1, text: 'How many days are there in a leap year?',
          options: ['364', '365', '366', '367'], key: ['365'] /* WRONG ON PURPOSE */ },
        { id: 'q8', type: 'paragraph', points: 0, text: 'In a few sentences, explain what photosynthesis produces and why it matters. (not graded)' },
      ],
    },
    {
      title: 'Section 3: Short answers',
      questions: [
        { id: 'q9', type: 'short', points: 1, text: 'Which planet is known as the Red Planet?',
          key: ['Mars'] },
        { id: 'q10', type: 'short', points: 1, text: 'How many minutes are there in one hour?',
          key: ['sixty'] /* TOO STRICT ON PURPOSE: "60" is not accepted */ },
      ],
    },
  ],
};
