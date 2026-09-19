ATK Inventory - Request Workflow V2.5

Perbaikan:
1. Nama Staff dan Departemen readonly dengan field compact.
2. Barang dan Qty pada form pengajuan menggunakan ukuran yang lebih proporsional; Tanggal sejajar.
3. Catatan Umum sekarang disimpan pada 08_REQUESTS.note dan tampil pada Detail serta Print.
4. Print Pengajuan memiliki 3 kotak tanda tangan horizontal: Dibuat, Diketahui, Disetujui.
5. Dibuat menampilkan nama Staff; Diketahui dan Disetujui menampilkan garis Nama untuk diisi manual.
6. Edit pengajuan DITOLAK ikut membawa dan memperbarui Catatan Umum.

Deployment:
- Frontend: index.html, app.js, styles.css
- Backend: apps-script/Code.gs, apps-script/SetupDatabase.gs
- api/app.js tetap digunakan.
- Kolom 08_REQUESTS.note dimigrasikan otomatis saat create/edit request; tidak perlu membuat database baru.
