# iFill: Quiz QA Checker

A Chrome extension for quiz creators to test their **own** quizzes before students see them.

Before a quiz goes live, you need to know three things:

1. **Does the quiz work end to end?** Can every question be answered, can you move between pages, and does Submit go through?
2. **Are the configured correct answers actually right?**
3. **Is the score shown after submitting calculated correctly?**

Checking this by hand for a 30–40 question quiz is slow. iFill fills the quiz in for you, so you only have to review the result.

## What the current version does

You open your quiz, click the extension, and pick one of three modes:

| Mode | What happens | Uses AI? |
|---|---|---|
| **Scoring test** | Fills in a fixed answer pattern you choose (always the first option, alternating, or your own list like `A, C, B+D`). Because you know exactly what was chosen, you know what the score *should* be and can compare it with the score the quiz shows. | No |
| **Key validation** | Google Gemini answers every question on its own, without seeing your answer key. After you submit, any question where Gemini and your key disagree is worth a second look: either the key is wrong or the question is unclear. | Yes |
| **Dry run** | Shows Gemini's answer for each question on the current page without clicking anything. | Yes |

In every mode:

- **Multi-page quizzes** are handled. It answers a page, clicks Next, and continues.
- **Single-choice, multi-select and true/false** questions are supported. Essay, short-answer and similar questions are skipped and left for you, never guessed.
- **Images in questions and options**, such as diagrams or picture-only answers, are sent to Gemini along with the text. Text that can't be copied, or that is drawn as an image, is read from a screenshot of the question.
- **Submit is never clicked without asking you first.** You can review the filled-in quiz before confirming.
- **The on-page UI is minimal:** a small dot in the corner shows it's running, and only problem questions get a thin marker.

## Good to know

- It is aimed at **Google Forms** and **Microsoft Forms** quizzes. For now it reads every quiz page with one generic adapter; platform-specific adapters are planned.
- Gemini modes need a free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). The key stays in your browser and is only sent to Google.
- In Gemini modes, quiz content is sent to Google. On the free tier, Google may use it to improve its products, so don't use those modes on confidential quizzes. Scoring-test mode sends nothing anywhere.
- This is a testing tool for quizzes you created. It is not meant for taking graded or proctored exams.
