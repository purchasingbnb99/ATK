# ATK Inventory — FINAL Mobile UI + Barcode

## Arsitektur

Browser → Vercel Frontend → Vercel `/api/app` → Google Apps Script `/exec` → Google Sheets `DATABASE_ATK`

## Struktur

```text
atk-inventory/
├── index.html
├── styles.css
├── app.js
├── package.json
├── README.md
├── .gitignore
├── api/
│   └── app.js
└── apps-script/
    ├── Code.gs
    └── SetupDatabase.gs
```

## Database

Google Spreadsheet harus bernama `DATABASE_ATK` dan memiliki 14 sheet yang dibuat otomatis oleh `setupDatabase()`:

- 01_USERS
- 02_CATEGORIES
- 03_SUPPLIERS
- 04_PRODUCTS
- 05_STOCK_RECEIPTS
- 06_STOCK_MOVEMENTS
- 07_STOCK_ADJUSTMENTS
- 08_REQUESTS
- 09_REQUEST_ITEMS
- 10_PURCHASE_ORDERS
- 11_PURCHASE_ITEMS
- 12_PURCHASE_RECEIPTS
- 13_PURCHASE_RECEIPT_ITEMS
- 14_APP_SETTINGS

Timezone: `Asia/Jakarta`.

## Apps Script Setup

1. Buat spreadsheet `DATABASE_ATK`.
2. Extensions → Apps Script.
3. Buat `SetupDatabase.gs` dan `Code.gs` dari folder `apps-script/`.
4. Save.
5. Jalankan `setupDatabase()` satu kali.
6. Jalankan `getOrCreateApiKey()` satu kali.
7. Di Project Settings → Script Properties, key `ATK_API_KEY` akan tersimpan. Jangan masukkan nilainya ke GitHub atau frontend.
8. Deploy sebagai Web App production.
9. Gunakan URL `/exec`, bukan `/dev`.
10. Jalankan dengan identitas deployer dan konfigurasi akses yang memungkinkan request tanpa login Google dari Vercel.

Health check:

GET `/exec`

Expected:

```json
{"ok":true,"service":"ATK Inventory API","version":"1.0.0"}
```

## Vercel Environment Variables

Buat Environment Variables server-side:

```text
APPS_SCRIPT_URL=<production Apps Script /exec URL>
APPS_SCRIPT_API_KEY=<isi ATK_API_KEY dari Script Properties>
```

Jangan menaruh secret tersebut di:

- `index.html`
- root `app.js`
- repository GitHub
- browser local configuration

## Demo login

ADMIN:

```text
username: admin
password: Admin123!
```

STAFF:

```text
username: staff1
password: Staff123!
```

Password tersimpan sebagai salted hash.

## Fitur final

### ADMIN

- Dashboard
- Master Barang
- Kategori
- Supplier
- User Management
- Barang Masuk
- Barcode Scanner
- Adjustment / Opname
- Histori Mutasi
- Rekomendasi Order
- Purchase Order
- Penerimaan PO partial
- Approval Pengajuan
- Partial Approval
- Reject dengan alasan
- Laporan Stok
- Laporan Mutasi
- Laporan Pengajuan
- Laporan PO
- Laporan Penerimaan
- Print
- Import Excel
- Export Excel
- Change Password

### STAFF

- Dashboard
- Cari Barang
- Cari SKU / Barcode / Nama
- Scan Barcode
- Lihat Stok
- Buat Pengajuan
- Melihat pengajuan sendiri
- Print Pengajuan
- Membatalkan pengajuan MENUNGGU
- Change Password

## Aturan stok

Staff membuat pengajuan tidak mengurangi stok.

Approval Admin:

1. Membaca request terbaru.
2. Memastikan status masih `MENUNGGU`.
3. Membaca `currentStock` terbaru dari Master Barang.
4. Tidak memakai `stockAtRequest` sebagai stok final.
5. Memvalidasi `qtyApproved`.
6. Memastikan `qtyApproved <= stock terbaru`.
7. Mengubah stok.
8. Membuat movement `OUT`.
9. Mengubah `qtyApproved` dan status.
10. Seluruh transaksi kritis dikunci dengan `LockService`.

## Reorder

```text
recommendedQty = maxStock - currentStock - outstandingOrder
```

Outstanding Order:

```text
qtyOrdered - qtyReceived
```

PO yang dihitung:

- DRAFT
- ORDERED
- PARTIAL

Reorder tidak otomatis membuat PO.

## Purchase Order

Status:

- DRAFT
- ORDERED
- PARTIAL
- COMPLETED
- CANCELLED

Pembuatan PO dimulai dari `DRAFT`. Penerimaan dapat dilakukan secara partial. Sistem menolak qty penerimaan yang melebihi `qtyRemaining`.

## Import Excel

Header utama:

```text
SKU
Barcode
Nama Barang
Kategori
Satuan
Min
Max
Harga
Supplier
Lokasi
```

Frontend memvalidasi header sebelum commit. Backend kembali memvalidasi setiap baris, duplicate SKU/Barcode, referensi kategori/supplier, Min/Max, dan harga.

`currentStock` tidak diubah oleh import.

## Export Excel

Export menghasilkan `.xlsx` dari browser menggunakan SheetJS.

Dataset yang tersedia:

- Master Barang
- Histori Mutasi
- Pengajuan
- Purchase Order
- Penerimaan
- Laporan Stok

## Barcode scanner

Scanner berjalan di browser menggunakan HTTPS. Input barcode manual tetap tersedia sebagai fallback. Frontend mencoba kamera belakang (`environment`) untuk penggunaan mobile.

## Print

Print dibuat melalui jendela print browser sehingga data tidak perlu dikirim ke Apps Script untuk rendering HTML.

## Pengujian

Static checks yang dilakukan sebelum package final:

- syntax root `app.js`
- syntax `api/app.js`
- syntax Apps Script files menggunakan parser JavaScript Node pada salinan `.js`
- duplicate function names
- duplicate static HTML IDs
- action contract frontend/backend
- API secret separation
- role access mapping
- LockService pada critical stock/request/PO transactions
- document number prefixes
- SheetJS import/export references
- barcode library references

End-to-end production test tetap memerlukan URL Apps Script `/exec`, API key asli, dan environment variables Vercel yang nyata; nilai secret tidak disertakan di package.

## Pembaruan Mobile & Barcode

Dashboard berwarna, scan barcode pada form Master Barang, serta alur simpan/edit dari modul Barcode Scanner sudah ditambahkan.


## UI terbaru

Versi ini mempertahankan backend dan API yang sudah berfungsi, dengan penyempurnaan frontend: menu modul pada sidebar tampil sebagai kartu berwarna, memiliki efek glow saat hover/focus, dashboard memakai kartu statistik berwarna, dan background aplikasi menggunakan pola/grid halus berbasis CSS. Layout tetap responsif untuk desktop dan HP.
