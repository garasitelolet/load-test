# SIMAS k6 Performance Tests

Harness pengujian performa API menggunakan [k6](https://grafana.com/docs/k6/latest/).

## GUI Bun

Console GUI untuk menjalankan sembilan profil pengujian satu per satu tersedia di `http://localhost:3000`.

```sh
brew install bun k6
bun run dev
```

GUI menyediakan `load`, `stress`, `spike`, `soak/endurance`, `volume`, `scalability`, `capacity`, `concurrency`, dan `breakpoint` test. Isi URL service serta endpoint, pilih satu profil, lalu tekan **Run selected test**. Hanya satu run yang dapat aktif pada satu waktu; tombol **Stop run** menghentikan proses k6 yang sedang berjalan.

Setiap run menyimpan summary k6 dan time-series latency ke folder `reports/`. GUI menampilkan p95, p99, request rate, error rate, grafik latency per detik, dan tombol **Download JSON report**.

## Docker

Image sudah membawa Bun dan k6 sehingga host tidak perlu memasang k6:

```sh
docker build -t simas-k6-console .
docker run --rm -p 3000:3000 -v "$PWD/reports:/app/reports" simas-k6-console
```

Buka <http://localhost:3000>. Report tetap tersimpan di folder `reports/` melalui volume Docker.

Untuk `volume test`, field `Data size` diteruskan sebagai query `limit`. Sesuaikan endpoint atau skenario jika API Anda membutuhkan payload volume khusus.

## Prasyarat

Pasang k6 sesuai sistem operasi: <https://grafana.com/docs/k6/latest/set-up/install-k6/>

## Konfigurasi

| Variable | Default | Keterangan |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000` | Base URL service yang diuji |
| `HEALTH_PATH` | `/` | Endpoint GET yang diuji |
| `REQUEST_TIMEOUT` | `10s` | Timeout setiap request |
| `VUS` | `1` | Virtual users untuk smoke test |
| `DURATION` | `30s` | Durasi smoke test |
| `TARGET_VUS` | `20` | Jumlah VU maksimum pada load test |
| `RAMP_UP` | `1m` | Durasi menaikkan beban |
| `HOLD` | `3m` | Durasi mempertahankan beban |
| `RAMP_DOWN` | `1m` | Durasi menurunkan beban |
| `THINK_TIME` | `1` | Jeda antar request dalam detik |

## Menjalankan

Smoke test singkat:

```sh
BASE_URL=https://api.example.com HEALTH_PATH=/health npm run test:smoke
```

Load test bertahap:

```sh
BASE_URL=https://api.example.com \
HEALTH_PATH=/health \
TARGET_VUS=50 \
RAMP_UP=2m \
HOLD=10m \
RAMP_DOWN=2m \
npm run test:load
```

Atau jalankan langsung dengan output JSON:

```sh
k6 run --out json=results/load.json tests/load.js
```

## Kriteria awal

Test gagal jika error rate mencapai 1% atau lebih, p95 latency mencapai 1 detik atau lebih, p99 mencapai 2 detik atau lebih, atau rasio check di bawah 99%. Sesuaikan threshold setelah baseline service diketahui.
# load-test
