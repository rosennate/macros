# Macro Tracker (PWA)
Static, no-backend macro tracker. All data in localStorage. Barcode scanning via BarcodeDetector (if present) or vendored ZXing (vendor/zxing.min.js, MIT); product lookup via Open Food Facts.
Serve the folder over HTTPS (camera + service worker need a secure context). On iPhone: Safari → Share → Add to Home Screen.
Files: index.html, styles.css, app.js, sw.js, manifest.json, icons/, vendor/.
Food search: data/foods-db.js is a bundled subset (~600 foods) of USDA FoodData Central SR Legacy (public domain); generated from the official CSV download. Online "More results" use Open Food Facts text search (degrades gracefully offline).
