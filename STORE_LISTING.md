# iFill: Chrome Web Store listing

Copy each section into the matching field of the Chrome Web Store Developer Dashboard.

---

## Store listing tab

**Name** (taken from the manifest)
iFill

**Summary** (taken from the manifest; 121 of 132 characters)
Quiz & form testing assistant for quiz creators: fills in answers, submits, and helps you check the answer key and score.

**Category**
Tools

**Language**
English

**Description**

```
iFill: Quiz & form testing assistant for quiz creators: fills in answers, submits, and helps you check the answer key and score.

Before a quiz goes live you need to know three things: does it work from start to finish, are the configured correct answers actually right, and is the score shown after submitting calculated correctly? Checking a 30–40 question quiz by hand is slow. iFill fills it in for you so you only have to review the result.

HOW IT WORKS
Open your quiz, click the iFill icon, and choose a mode:

• Scoring test (no AI, nothing sent anywhere): selects a fixed answer pattern you choose, such as always the first option, alternating, or your own list like "A, C, B+D". Short-answer and paragraph questions get a fixed text you choose. iFill does not calculate the expected score itself: because you know exactly which answers were chosen, you work out what the score should be and compare it with the score on the quiz's own results page.

• Key validation: Google's Gemini AI answers each question without seeing your answer key, and iFill selects or types those answers. Short answers are written the way an answer key lists them, so a key that is too strict shows up; paragraph questions get 2–4 sentences. iFill does not compare them with your key itself: after you submit, open the quiz's own results page (Google Forms, for example, shows each chosen answer next to the correct one) and look at the questions marked wrong. Each one is a wrong key, an unclear question, or a Gemini mistake, so treat Gemini's answers as a second opinion, not the verdict.

• Dry run: shows the answer Gemini would select or type for each question on the current page, without clicking or typing anything.

WHAT IT HANDLES
• Multi-page quizzes: answers a page, clicks Next, continues.
• Single-choice, multi-select, true/false, short-answer and paragraph questions.
• Personal-detail fields (name, email, roll number, ID) are always left for you and never sent to Gemini. Answer boxes you have already filled in are never overwritten.
• Images in questions and options, such as diagrams and picture-only answers. Text that can't be copied, or that is drawn as an image, is read from a cropped screenshot of that question.
• Aimed at Google Forms and Microsoft Forms quizzes; a generic reader also tries other quiz sites.

YOU STAY IN CONTROL
• iFill selects and types answers in the quiz page, but it never clicks Submit without asking you first.
• It only runs on the tab where you click its icon and start a run.
• The on-page display is a small dot in the corner, plus a thin marker on questions that need attention.

WHAT YOU NEED
• Scoring test needs nothing: choose "Continue without a key" on the welcome screen.
• Key validation and Dry run need a free Gemini API key from Google AI Studio (aistudio.google.com). You paste it into the iFill popup once. It is stored only in your browser and sent only to Google's Gemini API.

PRIVACY
• In Key validation and Dry run, the quiz's question text, option text and images (or cropped screenshots of questions) are sent to Google's Gemini API. Personal-detail fields and text you typed are never sent. On the free tier, Google may use this data to improve its products, so don't use these modes on confidential quizzes. By default, iFill asks before sending.
• The developer collects no data. There are no analytics or trackers, and no code is loaded from the internet.
• Full privacy policy: https://1luvky.github.io/ifill/PRIVACY.html

INTENDED USE
iFill is a testing tool for quizzes and forms that you created or are responsible for. It is not intended for taking graded or proctored exams.
```

---

## Privacy practices tab

**Single purpose**

```
iFill tests online quizzes and forms for the people who create them. It fills in answers on a quiz the user is viewing, asks before submitting, and helps the user check that the quiz's answer key and displayed score are correct. Optionally, it uses Google's Gemini API to answer the questions independently, so the user can compare those answers with the quiz's answer key.
```

**Permission justifications**

`activeTab`
```
Used only after the user clicks the iFill toolbar icon and starts a run. It gives temporary access to that one tab so iFill can read the quiz's questions and options, select answers, and (in AI modes only) capture a screenshot of the visible tab, cropped to a question whose text or images cannot be read directly. iFill does not request access to all sites.
```

`scripting`
```
Injects iFill's bundled scripts (adapters/generic.js and content.js) into the quiz tab the user started a run on. These scripts read the questions, select the chosen answers or type the chosen text into answer boxes (never into personal-detail fields or boxes the user already filled in), click Next between pages, click Submit only after the user confirms, and show a small status indicator. No remote code is injected.
```

`storage`
```
Stores, on the user's own computer: the user's Gemini API key (optionally in Chrome sync, only if the user ticks that option), their settings (model, mode, answer pattern, the text used for short answers in Scoring test), a cache of Gemini's answers so re-running a quiz doesn't repeat requests, and the history of the last 30 runs so a run can continue across page navigations. Nothing is sent to the developer.
```

Host permission `https://generativelanguage.googleapis.com/*`
```
This is the Google Gemini API, the only server iFill contacts. In Key validation and Dry run modes, iFill sends the quiz's question text, option text and question images to it, authenticated with the user's own API key, and receives the AI's answer to each question. It is also used by the "Test connection" button in the popup.
```

**Are you using remote code?**
No, I am not using remote code.

```
All JavaScript is bundled in the extension package. There are no external scripts, CDN imports, eval() or new Function(). The only network requests are calls to the Gemini REST API, which return JSON data, not code.
```

**Data usage: what user data do you collect?**

Data is "collected" when it leaves the user's device. Tick:

- [x] **Website content:** in Key validation and Dry run, quiz question text, option text, images and cropped screenshots are sent to Google's Gemini API to get answers.
- [x] **Authentication information:** the user's own Gemini API key is sent to Google's Gemini API, in a request header, to authenticate those requests. It is not sent anywhere else.

Leave everything else unticked: personally identifiable information, health, financial, personal communications, location, web history and user activity.

**Certifications** (tick all three; each statement is true):

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
  (Sending quiz content to Google's Gemini API is how the extension provides its single purpose, which is an approved use case.)
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**
https://1luvky.github.io/ifill/PRIVACY.html

---

## Test instructions tab

Paste this so reviewers can test without a real quiz or localhost:

```
iFill is a testing tool for people who create quizzes. Please test it on our public sample quiz, not a real quiz:
https://1luvky.github.io/ifill/sample-quiz/

No account or login is needed.

1. Open the sample quiz and click the iFill toolbar icon. Scoring test needs no API key: on the welcome screen click "Continue without a key". To test all modes, paste your own free Gemini key from https://aistudio.google.com/apikey instead and click Save.
2. Choose "Scoring test" with "Always the first option" and click "Run on this tab". iFill selects answers on all three pages, types "iFill test answer" into the short-answer and paragraph boxes, leaves "Your name" empty, and then asks for confirmation before clicking Submit. Confirm, and the results page shows 1 / 9.
3. Key validation and Dry run use Google's Gemini API with the user's own free API key (we do not share a key). With a key, Key validation answers each question and asks before sending anything to Google. Dry run shows the planned answers without clicking anything.

iFill only acts on the tab where the user clicks its icon and starts a run, and it never submits without an explicit confirmation click.
```

---

## Distribution tab

**Visibility:** Unlisted
**Pricing:** Free
**Regions:** All regions

---

## Account and support

**Developer contact email:** lucky.tdr18@gmail.com
**Support URL:** https://github.com/1luvky/ifill/issues
The popup footer also has "Report a problem" (opens a pre-filled GitHub issue), the support email, and a link to the privacy policy.

---

## Screenshots (to capture before submitting)

At least one screenshot is required, 1280×800 or 640×400. Use the local sample quiz (`sample-quiz/`), not a real quiz:

1. The popup showing the three modes.
2. The sample quiz filled in by Scoring test, with the submit confirmation card visible.
3. A Dry run on the sample quiz showing Gemini's planned answers, including a "QA would type" label on a short-answer question.
