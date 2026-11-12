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

## AI photo estimates (xAI Grok vision)
Add sheet → "Photo — AI estimate" (file input `accept=image/*`; iOS offers Take Photo / Photo Library). The photo is downscaled client-side to ≤1024 px JPEG and sent straight from the browser to `https://api.x.ai/v1/chat/completions` (OpenAI-style `image_url` content, default model `grok-4.7`, `reasoning_effort: low`) with the user's own key; no proxy. xAI's API answers CORS preflights with `access-control-allow-origin: *`. The model returns strict JSON (items with name/portion/kcal/P/C/F/confidence); the app shows an editable review screen and logs separate entries or one combined meal (entries flagged `ai: true`).
The key and model live under their own localStorage key `macrotracker.xai` (not in `macrotracker.v1`), and are excluded from JSON backups unless "Include key in backup file" is switched on. Service worker only handles same-origin GETs, so API calls are never cached.
Get a key: console.x.ai → API Keys → Create (instructions also in-app: Settings → AI photo estimates → How to get a key).
