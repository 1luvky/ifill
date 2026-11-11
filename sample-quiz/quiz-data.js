// Sample quiz definition, shared by the quiz page and the results page.
// The extension never reads this file; it only sees the rendered DOM.
//
// PLANTED PROBLEMS (what the checker should catch):
//   q7  - answer key is WRONG on purpose (key says 365; a leap year has 366 days).
//   ?bug=score  - results page shows a total 1 point higher than it should.
//   ?bug=save   - the quiz silently records the FIRST option for q1, whatever you pick.
//   ?xorigin=1  - images load from another origin (tests the screenshot fallback).

const SAMPLE_QUIZ = {
  title: 'Sample QA Quiz',
  description: 'Local test quiz for Quiz QA Checker. Not a real quiz.',
  sections: [
    {
      title: 'Section 1: Text questions',
      questions: [
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
        { id: 'q8', type: 'short', points: 0, text: 'In one sentence, what does photosynthesis produce? (not graded)' },
      ],
    },
  ],
};
