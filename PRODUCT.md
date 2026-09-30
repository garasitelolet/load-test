# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
delegated: Bun server dengan HTML/CSS/JavaScript ringan tanpa dependency frontend; dipilih agar GUI dapat dijalankan cepat dan tetap fokus pada eksekusi k6.

## Users
Operator atau developer yang menjalankan pengujian performa API secara manual, satu skenario pada satu waktu.

## Product Purpose
GUI lokal untuk memilih satu dari sembilan jenis pengujian beban, mengatur target API dan beban, menjalankan k6, lalu membaca status dan ringkasan metrik hasil test.

## Positioning
Satu kontrol panel untuk menerjemahkan jenis pengujian performa menjadi profil k6 yang dapat dieksekusi berulang dengan parameter yang eksplisit.

## Operating Context
Digunakan di mesin developer atau runner internal terhadap environment API yang disediakan pengguna. Endpoint, kredensial, dan SLA belum diberikan sehingga harus dikonfigurasi, bukan di-hardcode.

## Capabilities and Constraints
GUI harus menyediakan smoke, load, stress, spike, soak/endurance, volume, scalability, capacity, concurrency, dan breakpoint test secara terpisah. Hanya satu run aktif pada satu waktu. Backend menjalankan binary k6 lokal dan mengembalikan status serta summary JSON. k6 belum terpasang saat implementasi ini dibuat.

## Evidence on Hand
Harness k6 awal tersedia di `tests/helpers.js`, `tests/smoke.js`, dan `tests/load.js`. Tidak ada endpoint API atau data uji nyata yang tersedia.

## Product Principles
- Satu pilihan test harus mudah dipahami dan langsung dapat dijalankan.
- Parameter beban terlihat sebelum eksekusi.
- Hasil harus dapat dibaca cepat tanpa menyembunyikan kegagalan.
- Konfigurasi target dipisahkan dari implementasi skenario.

## Accessibility & Inclusion
Keyboard-accessible form controls, visible focus states, status text yang tidak hanya mengandalkan warna, dan layout yang tetap usable pada layar mobile.
