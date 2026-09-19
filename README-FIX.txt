ATK Inventory - Request Workflow V2

Perbaikan:
1. Identitas Mode Staff tanpa password dipertahankan secara stabil per Nama Staff + Departemen pada browser.
2. Pengajuan Saya tetap menemukan data lama untuk identitas Staff yang sama (termasuk fallback legacy berdasarkan nama + departemen).
3. Form Buat Pengajuan benar-benar dirender ulang setelah sukses sehingga item, qty, catatan, dan tanggal kembali ke kondisi awal.
4. Pengajuan Saya memiliki pencarian, filter tanggal, tombol Cari, dan Reset.
5. Print Pengajuan membaca seluruh pengajuan yang tersedia melalui action listPrintableRequests.
6. Print Pengajuan memiliki pencarian, filter tanggal/status, checkbox per pengajuan, pilih semua, dan Print yang Dipilih.
7. Hasil print berisi dokumen detail per pengajuan terpilih.
8. Cache bust frontend ditambahkan agar deployment baru lebih konsisten di desktop/mobile.

Deployment:
- Frontend: index.html, app.js, styles.css
- Backend: apps-script/Code.gs (wajib versi paket ini), api/app.js tetap digunakan.
- Tidak perlu membuat API key baru atau database baru.
