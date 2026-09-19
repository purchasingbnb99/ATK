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

V2.6 update:
7. Form Buat Pengajuan disusun horizontal: Tanggal - Barang - Qty - Catatan Item - Hapus.
8. Tombol Hapus diperkecil dan kolom Aksi dibuat tetap ringkas.
9. Tanggal hanya ditampilkan sekali pada baris pertama karena berlaku untuk seluruh pengajuan; baris item berikutnya tetap sejajar dengan spacer.
10. Pada mobile, layout otomatis menjadi satu kolom agar tetap responsif.

11. V2.6: posisi Tanggal dipindahkan ke baris item, sejajar dengan Barang, Qty, Catatan Item, dan Hapus.
12. V2.6: tombol Hapus diperkecil dan kolom Aksi dibuat ringkas; pada mobile layout kembali satu kolom.
13. V2.6: jika baris pertama dihapus saat masih ada item lain, tanggal otomatis dipindahkan ke baris pertama yang tersisa.
