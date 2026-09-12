# ATK Inventory - Frontend

Frontend statis untuk Vercel dengan backend Google Apps Script + Google Sheets.

## Struktur
- `index.html` - halaman utama
- `styles.css` - CSS tampilan
- `app.js` - UI dan komunikasi API
- `api/app.js` - Vercel serverless proxy ke Apps Script
- `.env.example` - contoh environment variable
- `package.json` - project ESM

## Vercel Environment Variables
- `APPS_SCRIPT_URL`
- `APPS_SCRIPT_API_KEY`

API key harus disimpan di Vercel, bukan di source frontend.
