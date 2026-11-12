# iFill release test checklist

Run this before every Chrome Web Store upload, on the exact `ifill.zip` you will upload, in a **new Chrome profile with no key saved**. Tick each box. If any box fails, fix the problem, rebuild, and start again from section 1.

You need:
- this repo, with a terminal open in it;
- a Gemini API key you can paste in (keep it out of every file and screenshot);
- the sample quiz served locally: `python3 -m http.server 8000` in the repo folder, then open `http://localhost:8000/sample-quiz/`.

---

## 1. Build and inspect the zip

- [ ] `./build.sh` prints `Built ifill.zip (iFill <version>, 12 files, …)` with no `BUILD FAILED`.
- [ ] The version printed matches the version you mean to upload, and is higher than the version already in the store.
- [ ] `unzip -l ifill.zip` lists only these files, with `manifest.json` at the top level and not inside a folder:
      `manifest.json`, `background.js`, `content.js`, `llm.js`, `storage.js`, `popup.html`, `popup.js`, `adapters/generic.js`, `icons/icon16.png`, `icons/icon32.png`, `icons/icon48.png`, `icons/icon128.png`.
      There should be no `sample-quiz/`, `.md` files, `build.sh`, `.git`, `.DS_Store` or `__MACOSX`.
- [ ] **No API key in the zip:** `unzip -p ifill.zip | grep -acE 'AIza[0-9A-Za-z_-]{30,}'` prints `0`. (A plain `AIza` search finds a few harmless matches: the "starts with AIza…" hint and the key-format check.)
- [ ] **No personal data in the zip:** `unzip -p ifill.zip | grep -aciE '/Users/|lucky\.chaudhary'` prints `0`.
- [ ] **The only email is the support address:** `unzip -p ifill.zip | grep -aoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' | sort -u` prints only `lucky.tdr18@gmail.com`.
- [ ] **The only remote address that code talks to is Gemini:** `unzip -p ifill.zip | grep -aoE 'https://[a-z0-9.-]+' | sort -u` prints only `generativelanguage.googleapis.com`, plus the link targets `aistudio.google.com` and `github.com` (popup links the user clicks).
- [ ] **No remote code:** `unzip -p ifill.zip | grep -acE 'eval\(|new Function|<script src="http|import\(')` prints `0`.

## 2. Fresh profile and install

- [ ] In Chrome, click your profile icon, choose **Add**, and create a profile named "iFill test" with no Google sign-in. A fresh profile has no saved key, settings or cache.
- [ ] Unzip into a new folder: `rm -rf /tmp/ifill-release && mkdir /tmp/ifill-release && unzip -q ifill.zip -d /tmp/ifill-release`.
- [ ] In the test profile, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose `/tmp/ifill-release`.
- [ ] The card shows **iFill**, the correct version, the blue check icon, and **no errors**.
- [ ] Under **Details**:
  - [ ] the description is the official one;
  - [ ] **Site access** lists only `generativelanguage.googleapis.com`;
  - [ ] there is no "read and change all your data on all websites" warning.
- [ ] Pin iFill to the toolbar. The icon is sharp, and the tooltip reads "iFill: quiz & form testing assistant".

## 3. First run (onboarding)

- [ ] Opening the popup shows the welcome screen with the official description and the **Privacy** notice.
- [ ] The **aistudio.google.com** link opens Google AI Studio in a new tab.
- [ ] The footer shows **Report a problem · lucky.tdr18@gmail.com · Privacy · v<version>**, and each link opens correctly (GitHub issue form pre-filled, mail draft, privacy policy).
- [ ] Wrong key: paste `AIzaNotARealKey`, then **Test connection**. A clear **Bad API key** error appears.
- [ ] Wrong model: enter your real key, choose **Other**, type `gemini-does-not-exist`, then **Test connection**. A clear **Wrong model** error appears.
- [ ] Offline: turn Wi-Fi off, then **Test connection**. An **Offline** error appears. Turn Wi-Fi back on.
- [ ] Real key, default model: **Test connection** succeeds and names the model.
- [ ] **Load models available to my key** fills the model list.
- [ ] **Save** moves to the main screen, and the summary shows the key **masked** (`AIza…xxxx`), never in full.

## 4. Key storage

Open the service worker console from the iFill card's **service worker** link at `chrome://extensions`.

- [ ] `await chrome.storage.local.get(null)` shows `apiKey` and `settings`. `await chrome.storage.sync.get(null)` is empty `{}`.
- [ ] In Settings, tick **Sync key across my Chrome profile** and save. The sync warning text is shown, and `apiKey` is now in `chrome.storage.sync` and **gone** from `chrome.storage.local`.
- [ ] Untick sync and save. The key moves back to `local` and is gone from `sync`.
- [ ] **Export settings** downloads a file. Open it: there is **no** `apiKey` and no `AIza` anywhere in it.
- [ ] **Import settings** with that file works, and the key is unchanged.
- [ ] **Clear key** removes it. `apiKey` is missing from both `local` and `sync`, and reopening the popup shows the welcome screen again. Enter the key again before continuing.

## 5. Modes on the sample quiz

Use `http://localhost:8000/sample-quiz/`, never a real quiz.

**Scoring test (no AI)**
- [ ] Choose **Scoring test** with pattern **Always the first option**. The "Confirm before sending" option is hidden.
- [ ] Watch the service worker console's **Network** tab during the run: **no requests** at all.
- [ ] It fills page 1, clicks Next, and fills page 2. The essay question is left blank.
- [ ] It **stops and asks** before Submit. Clicking Cancel does not submit.
- [ ] Run again and confirm. The results page shows **1 / 7**: with "first option" only question 3 (True) is right. The popup shows the captured score.
- [ ] Repeat on `?bug=score`. The page shows **2 / 7** although only 1 answer is right, so the planted scoring bug is visible.
- [ ] Custom pattern `C,A+C,A,B,D,B,C` (the right answer to every question): the page shows **6 / 7**, because the q7 key is deliberately wrong (365 instead of 366).

**Key validation (Gemini)**
- [ ] With **Confirm before sending** on, a card asks before anything is sent to Google. Clicking **Cancel run** sends nothing: the Network tab shows no Gemini request.
- [ ] Clicking **Send**: every request in the Network tab goes to `generativelanguage.googleapis.com`. Each request URL has **no** `key=` parameter, because the key is only in the `x-goog-api-key` header.
- [ ] Gemini answers q1 to q7, including the diagram (q4), the image-only options (q5) and the canvas text (q6). The essay is skipped.
- [ ] q7: Gemini chooses **366**, which disagrees with the planted wrong key (365).
- [ ] It still asks before Submit.
- [ ] Running the same quiz again uses the cache: no new Gemini requests for questions already answered.

**Dry run**
- [ ] It shows Gemini's planned answer on each question and **clicks nothing**. All options stay unselected.

**Screenshot fallback**
- [ ] Open `http://localhost:8000/sample-quiz/?xorigin=1` and run a Dry run. The image questions are still answered, using screenshot crops.

**On-page UI and Stop**
- [ ] While running, there is only a small dot in the bottom-right corner. Hovering shows "iFill · …" and a Stop button.
- [ ] **Stop**, from the dot or the popup, stops the run, and nothing more is clicked.

## 6. Logging and leaks

- [ ] During all of the above, the **service worker console**, the **popup console** (right-click the popup, Inspect) and the **quiz page console** show no API key and no quiz text. iFill writes nothing to the console.
- [ ] Error messages shown in the popup never include the key.

## 7. Permissions and scope

- [ ] Open any other site, for example `https://example.com`, without clicking iFill. iFill does nothing there: no dot, and no script injected.
- [ ] Opening the popup on `chrome://extensions` and clicking Run shows a clear message that the page can't be used. Nothing crashes.

## 8. Uninstall

- [ ] Remove iFill from the test profile, then load it again. It starts at the welcome screen with **no key, settings or run history**.
- [ ] Delete the test profile and `/tmp/ifill-release` when done.

---

**Release decision:** upload `ifill.zip` only if every box above is ticked.
