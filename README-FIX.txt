ATK Inventory - Request Workflow Fix

Perbaikan:
1. Setelah Staff berhasil mengirim pengajuan, halaman Buat Pengajuan otomatis kembali ke form kosong.
2. Admin mendapat badge angka merah pada menu Approval Pengajuan sesuai jumlah status MENUNGGU.
3. Approval Pengajuan memiliki pencarian berdasarkan No Pengajuan, Staff, Departemen, Barang, dan filter status.
4. Waktu pengajuan menampilkan createdAt dalam timezone Asia/Jakarta (tanggal + jam), bukan requestDate tengah malam.
5. Print Pengajuan diperbaiki agar membuka jendela cetak dengan lebih stabil dan memberi pesan jelas jika popup diblokir.

File yang berubah untuk deployment:
- app.js (WAJIB)
- styles.css (WAJIB untuk badge/filter)

File backend TIDAK diubah untuk perbaikan ini.
api/app.js dan apps-script/Code.gs tetap seperti paket sebelumnya.
