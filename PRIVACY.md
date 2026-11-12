# iFill Privacy Policy

**Effective date:** 13 November 2026
**Developer:** Lucky, lucky.tdr18@gmail.com

iFill is a quiz & form testing assistant: a Chrome extension for people who create online quizzes and forms. It fills in answers, submits, and checks that the answer key and the displayed score are correct, so you can find mistakes before the quiz goes live.

## Summary

- The developer collects **no data**. iFill has no servers, accounts, analytics or trackers.
- In the two AI modes, the quiz content you are testing is sent to **Google's Gemini API**, using your own API key.
- Everything else, including your API key, stays **in your browser**.

## What iFill reads

iFill reads a web page only when you click its toolbar icon and start a run on that tab. It uses Chrome's `activeTab` permission and has no access to other sites or tabs. On that page it reads:

- question and option text;
- images in questions and options;
- where an image or text can't be read directly, a screenshot of the visible tab, cropped to that question (taken only in the AI modes; see "What is sent to Google");
- the score shown on the results page.

## What is sent to Google, and when

| Mode | Sent to Google |
|---|---|
| Scoring test | **Nothing.** This mode does not use the network. |
| Key validation | Question text, option text, and images or cropped screenshots of the questions |
| Dry run | Same as Key validation |

- Requests go only to `generativelanguage.googleapis.com`, Google's Gemini API. Your API key is sent in a request header to that address and nowhere else.
- By default, iFill asks you to confirm before any quiz content is sent.
- Google handles this data under its own terms, the [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) and the [Google Privacy Policy](https://policies.google.com/privacy). **On the free tier, Google may use the content you send to improve its products, and humans may review it.** Do not use the AI modes on confidential quizzes.
- Testing the connection in the popup sends a short test prompt and asks Google which models your key can use. No quiz content is included.

## What is stored, and where

All of this is stored using Chrome's extension storage on your own computer. None of it is sent to the developer.

| Data | Where | Kept until |
|---|---|---|
| Your Gemini API key | This browser only. If you tick "Sync key across my Chrome profile", it is stored in Chrome sync instead, and Google syncs it to your other signed-in Chrome browsers. | You click **Clear key** or remove the extension |
| Settings: model, mode, answer pattern, confirmation preference | This browser only | You change them or remove the extension |
| Answer cache: Gemini's answers for questions already asked, keyed by a hash of the question, so re-runs don't repeat requests | This browser only | Up to 3,000 entries, oldest dropped first, or until you remove the extension |
| Run history: for the last 30 runs, the question and option text, the chosen answers, Gemini's reasoning and confidence, a log, and the score | This browser only | Older runs are deleted automatically, or all are deleted when you remove the extension |

Images and screenshots are sent to Gemini during a run and are not stored.

The **Export settings** file never contains your API key.

## What iFill does not do

- It does not collect, sell or share any data with the developer or anyone other than Google's Gemini API, as described above.
- It has no analytics, advertising, tracking or remote logging.
- It does not load or run code from the internet. All of its code is included in the extension.
- It does not run on pages unless you start it.

## Deleting your data

- **API key:** open the iFill popup and click **Clear key**.
- **Everything:** remove the extension at `chrome://extensions`. Chrome deletes all of iFill's stored data.
- **Data already sent to Google:** see Google's terms linked above, and your settings in [Google AI Studio](https://aistudio.google.com).

## Intended use

iFill is for testing quizzes and forms that you created or are responsible for. It is not intended for taking graded or proctored exams.

## Changes

If this policy changes, the new version will be published at this same address with a new effective date.

## Contact

Questions about this policy: **lucky.tdr18@gmail.com**
