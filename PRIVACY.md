# iFill Privacy Policy

**Effective date:** 13 November 2026
**Developer:** Lucky, lucky.tdr18@gmail.com

iFill is a Chrome extension. Quiz & form testing assistant for quiz creators: fills in answers, submits, and helps you check the answer key and score.

## Summary

- The developer collects **no data**. iFill has no servers, accounts, analytics or trackers.
- In the two AI modes, the quiz content you are testing is sent to **Google's Gemini API**, using your own API key.
- Everything else, including your API key, stays **in your browser**.

## What iFill reads

iFill reads a web page only when you click its toolbar icon and start a run on that tab. It uses Chrome's `activeTab` permission and has no access to other sites or tabs. On that page it reads:

- question and option text;
- images in questions and options;
- where an image or text can't be read directly, a screenshot crop of that image, option or question (only in the AI modes; see "Screenshots and crops" below);
- the page's title and address;
- the score shown on the results page.

## What is sent to Google, and when

| Mode | Sent to Google |
|---|---|
| Scoring test | **Nothing.** This mode does not use the network. |
| Key validation | Question text, option text, images from the questions and options, and screenshot crops of a question, option or image where needed |
| Dry run | Same as Key validation |

- Requests go only to `generativelanguage.googleapis.com`, Google's Gemini API. Your API key is sent in a request header to that address and nowhere else.
- By default, iFill asks you to confirm before any quiz content is sent.
- Google handles this data under its own terms, the [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) and the [Google Privacy Policy](https://policies.google.com/privacy). **On the free tier, Google may use the content you send to improve its products, and humans may review it.** Do not use the AI modes on confidential quizzes.
- Testing the connection in the popup sends a short test prompt and asks Google which models your key can use. No quiz content is included.

### Screenshots and crops

When an image or a question's text can't be read directly from the page (for example, text drawn as a picture, or an image from another website), iFill takes a screenshot:

- iFill scrolls the element into view and captures the visible part of the tab. That full screenshot is **held briefly in memory, cropped to the box of that one question, option or image, and then discarded**. **Only the crop is sent to Gemini. The full-tab screenshot is never sent or stored.**
- If a question is taller than the screen, the crop is the visible part of it, which **can be close to the whole visible area** of the tab.
- A crop shows whatever is on screen inside that box at that moment, including **anything overlaying the question, such as a cookie banner or a notification**. iFill hides its own on-page indicator while capturing.

## What is stored, and where

All of this is stored using Chrome's extension storage on your own computer. None of it is sent to the developer.

| Data | Where | Kept until |
|---|---|---|
| Your Gemini API key | This browser only. If you tick "Sync key across my Chrome profile", it is stored in Chrome sync instead, and Google syncs it to your other signed-in Chrome browsers. | You click **Clear key** or remove the extension |
| Settings: model, mode, answer pattern, confirmation preference | This browser only | You change them or remove the extension |
| Answer cache, so re-runs don't repeat requests: for each question already asked (looked up by a hash of the question), Gemini's chosen option text, its reasoning and confidence, and any text Gemini read from images | This browser only | Up to 3,000 entries, oldest dropped first. Cleared with **Clear history and cache**, or by removing the extension. |
| Run history, last 30 runs: page titles and addresses (URLs), question and option text, planned answers, Gemini's reasoning and confidence, text Gemini read from images, a log, and the displayed score | This browser only | Older runs are deleted automatically. Cleared with **Clear history and cache**, or by removing the extension. |

Images, screenshots and crops are used only during a run and are never stored.

The **Export settings** file never contains your API key.

## What iFill does not do

- It does not collect, sell or share any data with the developer or anyone other than Google's Gemini API, as described above.
- It has no analytics, advertising, tracking or remote logging.
- It does not load or run code from the internet. All of its code is included in the extension.
- It does not run on pages unless you start it.

## Deleting your data

- **Run history and answer cache:** open the iFill popup, go to **Settings**, and click **Clear history and cache**. It shows what will be deleted and asks you to confirm. Your key and settings are kept. It is unavailable while a run is in progress.
- **API key:** open the iFill popup and click **Clear key**. The key is removed from both this browser and Chrome sync.
- **Everything:** remove the extension at `chrome://extensions`. Chrome deletes the data iFill stored in this browser. If you chose to sync your key, click **Clear key** first so it is also removed from Chrome sync.
- **Data already sent to Google:** see Google's terms linked above, and your settings in [Google AI Studio](https://aistudio.google.com).

## Intended use

iFill is for testing quizzes and forms that you created or are responsible for. It is not intended for taking graded or proctored exams.

## Changes

If this policy changes, the new version will be published at this same address with a new effective date.

## Contact

Questions about this policy: **lucky.tdr18@gmail.com**
