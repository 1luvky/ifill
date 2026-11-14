# iFill: quiz & form testing assistant

Quiz & form testing assistant for quiz creators: fills in answers, submits, and helps you check the answer key and score.

Before a quiz goes live, you need to know three things:

1. **Does the quiz work end to end?** Can every question be answered, can you move between pages, and does Submit go through?
2. **Are the configured correct answers actually right?**
3. **Is the score shown after submitting calculated correctly?**

Checking this by hand for a 30–40 question quiz is slow. iFill fills the quiz in for you, so you only have to review the result.

## What the current version does

You open your quiz, click the extension, and pick one of three modes:

| Mode | What happens | Uses AI? |
|---|---|---|
| **Scoring test** | Fills in a fixed answer pattern you choose (always the first option, alternating, or your own list like `A, C, B+D`, one entry per choice question). Short-answer and paragraph questions get a fixed text you choose, "iFill test answer" by default. iFill does not calculate the expected score itself: because you know exactly which answers were chosen, you work out what the score should be and compare it with the score on the quiz's own results page. | No |
| **Key validation** | Google Gemini answers every question on its own, without seeing your answer key, and iFill selects or types those answers. For short-answer questions Gemini writes just the answer (a word or number, the way an answer key lists it), so a key that is too strict shows up; for paragraph questions it writes 2–4 sentences. iFill does not compare them with your key itself: after you submit, open the quiz's own results page (Google Forms, for example, shows each chosen answer next to the correct one) and look at the questions marked wrong. Each one is a wrong key, an unclear question, or a Gemini mistake. | Yes |
| **Dry run** | Shows the answer Gemini would select or type for each question on the current page, without clicking or typing anything. | Yes |

In every mode:

- **Multi-page quizzes** are handled. It answers a page, clicks Next, and continues.
- **Single-choice, multi-select, true/false, short-answer and paragraph** questions are supported. Dropdowns and other types are skipped and left for you.
- **Personal-detail fields** (name, email, roll number, ID and similar) are always left for you to fill in, and are never sent to Gemini.
- **Text you have already typed is never overwritten**: a filled-in answer box is left as it is.
- **Images in questions and options**, such as diagrams or picture-only answers, are sent to Gemini along with the text. Text that can't be copied, or that is drawn as an image, is read from a screenshot of the question.
- **Submit is never clicked without asking you first.** You can review the filled-in quiz before confirming.
- **The on-page UI is minimal:** a small dot in the corner shows it's running, and only problem questions get a thin marker.

## Good to know

- It is aimed at **Google Forms** and **Microsoft Forms** quizzes, and its generic adapter also tries other sites (such as Moodle or custom quiz pages). Platform-specific adapters are planned.
- Gemini modes need a free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). The key stays in your browser and is only sent to Google.
- In Gemini modes, quiz content is sent to Google. On the free tier, Google may use it to improve its products, so don't use those modes on confidential quizzes. Scoring-test mode sends nothing anywhere.
- Gemini's written answers are a second opinion: a short answer marked wrong may mean a strict key, or a Gemini mistake. Paragraph answers are usually graded by a person, so check how your quiz handles them.
- This is a testing tool for quizzes you created. It is not meant for taking graded or proctored exams.
