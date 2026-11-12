# Macro Tracker (PWA)
Static, no-backend macro tracker. All data in localStorage. Barcode scanning via BarcodeDetector (if present) or vendored ZXing (vendor/zxing.min.js, MIT); product lookup via Open Food Facts.
Serve the folder over HTTPS (camera + service worker need a secure context). On iPhone: Safari → Share → Add to Home Screen.
Files: index.html, styles.css, app.js, sw.js, manifest.json, icons/, vendor/.
Food search: data/foods-db.js is a bundled subset (~600 foods) of USDA FoodData Central SR Legacy (public domain); generated from the official CSV download. Online "More results" use Open Food Facts text search (degrades gracefully offline).

## Apple Watch exercise calories (Shortcuts hand-off)
The app can raise the daily calorie target by a share (50/75/100%) of the *active energy* burned that day. A PWA cannot read HealthKit, so an iPhone Shortcut reads Active Energy and puts it on the clipboard; the app imports it with one tap. (A Shortcut's "Open URL" opens Safari, and Safari's storage is separate from the Home Screen app's on iOS, so a link cannot write into the installed app.)
Data: `burned: { "YYYY-MM-DD": kcal }` in the same localStorage key; settings `exercise: { on, pct }`. Import *replaces* that day's value (idempotent).
Accepted paste formats: `macros-burned:482:2026-11-11`, `macros-burned:482` (today), or `482`. URL form `?burned=482&date=YYYY-MM-DD` is also handled (params are stripped after use) but only reaches the storage of whichever context opens it (Safari tab vs Home Screen app).

### Shortcut setup (Shortcuts app → +, name it "Macros Burned")
1. **Find Health Samples** — Type is *Active Energy*, Start Date is *Today*, Limit off. (Older iOS: "Get Health Sample".)
2. **Calculate Statistics** — Sum of *Health Samples*. (If it rejects the input, add **Get Details of Health Samples** → *Value* first.)
3. **Round Number** — *Statistics* to *Ones Place*.
4. **Format Date** — *Current Date*, Custom format `yyyy-MM-dd`.
5. **Text** — `macros-burned:` + *Rounded Number* + `:` + *Formatted Date*.
6. **Copy to Clipboard** — *Text*.
7. **Show Notification** — "Burned kcal copied — open Macros and tap Paste from Shortcut".
8. Run once and allow Health access to Active Energy.
9. In Macros: Today → **Paste from Shortcut** → tap the iOS **Paste** bubble.

Automation: Shortcuts → Automation → + → *Time of Day* (e.g. 8:00 PM, Daily) → *Run Shortcut* "Macros Burned" → *Run Immediately*. The same steps are in the app (Settings → Apple Watch / Shortcut setup, or Today → Help).
Note: no signed `.shortcut` file is provided — iOS 15+ only imports Apple-signed shortcuts, and signing needs macOS or a third-party signing service.

## AI photo estimates (Google Gemini; xAI removed in v9)
Add sheet → "Photo — AI estimate" (file input `accept=image/*`; iOS offers Take Photo / Photo Library). The photo is downscaled client-side to ≤1024 px JPEG and sent straight from the browser to `https://api.x.ai/v1/chat/completions` (OpenAI-style `image_url` content, default model `grok-4.7`, `reasoning_effort: low`) with the user's own key; no proxy. xAI's API answers CORS preflights with `access-control-allow-origin: *`. The model returns strict JSON (items with name/portion/kcal/P/C/F/confidence); the app shows an editable review screen and logs separate entries or one combined meal (entries flagged `ai: true`).
The key and model live under their own localStorage key `macrotracker.xai` (not in `macrotracker.v1`), and are excluded from JSON backups unless "Include key in backup file" is switched on. Service worker only handles same-origin GETs, so API calls are never cached.
Get a key: console.x.ai → API Keys → Create (instructions also in-app: Settings → AI photo estimates → How to get a key).

### Google Gemini provider (free tier available)
Settings has a provider picker (xAI Grok / Google Gemini) with separate on-device keys (stored in `macrotracker.xai`, excluded from backups unless "Include keys in backup file" is on). If no provider is picked, Gemini is used when it is the only key set; a picked provider with no key falls back to the other if that one has a key.
Gemini calls: `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` with header `x-goog-api-key`, `inline_data` (image/jpeg base64), same prompt/JSON as xAI, `generationConfig.responseMimeType = application/json` (+ `thinkingLevel: low`, dropped on a 400). Default model `gemini-3.8-flash` (also 3.6 Flash, 3.5 Flash-Lite). Browser CORS works (Google echoes the request origin and allows `x-goog-api-key`). Free key: https://aistudio.google.com/apikey. On the free tier Google may use content to improve its products (per aistudio.google.com/docs/pricing). HTTP 429 shows a clear quota message.

### v7 reliability notes (AI photo)
Photo is decoded with `<img>` then `createImageBitmap` (15 s guard each), redrawn on a canvas (honours EXIF orientation), downscaled to ≤1024 px and re-encoded JPEG q0.8 before base64 (inline_data without the `data:` prefix). All API calls go through `fetchT` (hard timeout over headers+body: Gemini 60 s first attempt, 40 s for fallbacks; xAI 75 s). Gemini tries the chosen model, then `gemini-3.5-flash-lite`, `gemini-3.6-flash` on timeout/404/429/5xx. The wait screen shows step text + elapsed seconds; errors show HTTP status, API message, models tried, and a "Copy error details" button. sw.js only handles same-origin GETs, so googleapis/x.ai requests are never intercepted.

### v9
- **Meals:** every entry has `meal` (breakfast|lunch|dinner|snack). Today groups entries into Breakfast/Lunch/Dinner/Snacks with subtotals; empty sections show "+ Add" (opens the add flow preselected). All add flows and the edit sheet have a meal selector. Default by time of day: <10:30 breakfast, 10:30–15:00 lunch, 15:00–17:00 snack, 17:00–21:00 dinner, else snack. Entries/backups without `meal` are assigned one from their logged timestamp on load/import (nothing else is changed).
- **AI photo is Gemini-only:** the xAI provider/key UI and code path were removed. Any legacy xAI key/model/provider in `macrotracker.xai` is deleted on first load; old backups' xAI keys are ignored.
