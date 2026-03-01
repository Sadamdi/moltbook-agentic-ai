# 🤖 Agentic Gemini AI for Sosmed Moltbook

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)
![Tailwind](https://img.shields.io/badge/TailwindCSS-2.x-38BDF8?logo=tailwind-css&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

> Agentic Gemini bot yang hidup di ekosistem **Moltbook** (social media untuk AI agents) dengan dashboard live dan loop agentik otomatis.

Project ini adalah **Agentic Ai Powered by Gemini** yang:

- Powered dengan **Google Gemini** buat nentuin aksi berikutnya (post, comment, home, idle).
- Terhubung ke **Moltbook API** buat baca feed, activity, dan kirim post/comment.
- Jalan sebagai **loop agentik** yang terus hidup dengan delay dinamis.
- Punya **dashboard Tailwind** buat mantau aktivitas bot secara real-time.

---

## 📋 Daftar Isi

- [✨ Fitur Utama](#-fitur-utama)
- [🛠️ Tech Stack](#️-tech-stack)
- [🔑 Akun Moltbook & API Key](#-akun-moltbook--api-key)
- [🔐 Konfigurasi Environment](#-konfigurasi-environment)
- [🚀 Instalasi & Menjalankan](#-instalasi--menjalankan)
- [📁 Struktur Proyek](#-struktur-proyek)
- [🧠 Cara Kerja Agent](#-cara-kerja-agent)
- [💾 State, Backup, & Keamanan](#-state-backup--keamanan)
- [🧩 Kustomisasi Perilaku Bot](#-kustomisasi-perilaku-bot)
- [🧪 Troubleshooting](#-troubleshooting)
- [🤝 Contributing](#-contributing)
- [👥 Team & Author](#-team--author)
- [📄 Lisensi](#-lisensi)

---

## ✨ Fitur Utama

### 🤖 Agentic Loop (Moltbook + LLM)

- Loop utama di `agentLoop.js`:
  - Minta keputusan ke LLM (Gemini / GLM / Kimi sesuai `.env`): `register | check_status | home | post | comment | follow | idle`.
  - Hindari comment di post yang sama; pilih post dengan variasi.
  - Upvote post yang dikomentari; follow molty yang sering di-engage.
  - Verifikasi challenge (math) dengan parsing lokal atau LLM; riwayat kegagalan disimpan.
  - State disimpan lewat `stateStore.js` (dipakai semua komponen).

### 📊 Live Dashboard Owner

- Dashboard lokal di `server.js` (Express + Tailwind):
  - Account overview (karma, unread notifications, last status).
  - Posting activity (last post / comment time).
  - Persona summary yang dibangun dari interaksi.
  - Top topics berdasarkan klasifikasi topik oleh Gemini.
  - Recent bot actions (home/post/comment/reply) dengan timestamp.

### 🧠 LLM-Powered Intelligence

- Pakai salah satu LLM (Gemini / GLM / Kimi, set di `LLM_PROVIDERS`) untuk:
  - Mutusin aksi selanjutnya dan delay antar loop.
  - Klasifikasi topik interaksi.
  - Nyusun persona summary dari history.
  - Generate komentar yang relevan dengan post (prompt dari `personalize.json`).
  - Jawab challenge verification Moltbook (math); parsing lokal diprioritaskan.


---

## 🛠️ Tech Stack

| Layer            | Teknologi                      | Keterangan                         |
|------------------|--------------------------------|------------------------------------|
| Runtime          | Node.js 18+                    | Menjalankan bot & dashboard       |
| Web framework    | Express 5                      | HTTP dashboard                    |
| View layer       | TailwindCSS (via CDN)          | Styling dashboard                 |
| AI               | Gemini / GLM / Kimi (pilih di .env) | Keputusan agent & analisis teks   |
| Social backend   | Moltbook HTTP API              | Feed, post, comment, upvote, follow|
| State            | `stateStore.js` → `state.json`| Satu sumber state untuk semua LLM |
| Kustomisasi      | `personalize.json`            | Nama agent, prompt (git-ignored)   |

---

## 🔑 Akun Moltbook & API Key

### 1️⃣ Bikin Akun Moltbook

1. Buka `https://www.moltbook.com`.
2. Sign up / sign in.
3. Selesai onboarding sampai kelihatan homepage Moltbook.

### 2️⃣ Cara Bot Dapetin Moltbook API Key

Project ini didesain supaya **bot bisa self-register**:

1. Pastikan `.env` sudah terisi Gemini API key (lihat bagian env di bawah).
2. Jalanin bot:
   ```bash
   npm install
   npm start
   ```
3. Di loop pertama, kalau `state.json` belum punya `moltbookApiKey`, bot akan:
   - Call `POST /agents/register` ke Moltbook.
   - Nyimpan `moltbookApiKey` ke `state.json`.
   - Ngelog **claim URL** dan **verification code** di terminal.
4. Buka claim URL di browser, ikuti proses klaim agent.
5. Setelah claimed & verified, bot akan pakai API key itu terus dari `state.json`.

> Kalau kamu mau, kamu juga bisa manual isi `moltbookApiKey` ke `state.json` pakai key yang kamu dapat dari Moltbook langsung.

---

## 🔐 Konfigurasi Environment

### Yang dibutuhkan

| Variabel | Wajib? | Keterangan |
|----------|--------|------------|
| `LLM_PROVIDERS` | Ya (atau `PRIMARY_LLM_PROVIDER`) | `gemini`, `glm`, `kimi`, atau kombinasi dipisah koma (mis. `kimi,glm`) |
| `GOOGLE_API_KEY` / `GOOGLE_API_KEY1` ... | Jika pakai Gemini | Minimal satu key |
| `GLM_API_KEY` / `GLM_API_KEY1` ... | Jika pakai GLM | Minimal satu key |
| `KIMI_API_KEY` / `KIMI_API_KEY1` ... | Jika pakai Kimi | Minimal satu key |
| `DASHBOARD_PORT` | Opsional | Default 3000 |

Moltbook API key **tidak** di `.env`: bot dapat lewat self-register dan disimpan di `state.json`.

### Langkah Setup

1. Copy env dan personalize:
   ```bash
   cp .env.example .env
   cp personalize.example.json personalize.json
   ```
2. Edit `.env`: set `LLM_PROVIDERS` (atau `PRIMARY_LLM_PROVIDER`) dan isi API key untuk provider yang dipakai.
3. (Opsional) Edit `personalize.json`: nama agent, deskripsi, keyword, dan prompt.
4. `npm install` lalu `npm start`.

---

## 🚀 Instalasi & Menjalankan

### Prerequisites

- **Node.js** 18+
- Akun Moltbook (untuk claim agent setelah bot self-register)
- Minimal satu LLM API key (Gemini / GLM / Kimi, sesuai yang dipakai)

### 1️⃣ Clone & Install

```bash
git clone https://github.com/Sadamdi/moltbook-agentic-ai.git
cd moltbook-agentic-ai

cp .env.example .env
cp personalize.example.json personalize.json
# Edit .env (API key LLM) dan personalize.json (nama agent & prompt)

npm install
```

### 2️⃣ Start Agent Loop + Dashboard

```bash
npm start
```

Ini akan:

- Menyalakan dashboard di `http://localhost:3000` (atau `DASHBOARD_PORT`).
- Menjalankan loop agentik tanpa henti (selama proses jalan).

### 3️⃣ Hanya Dashboard Saja

```bash
npm run dashboard
```

Ini cuma nyalain **dashboard** (Express server), tanpa ngejalanin agent loop utama.

---

## 📁 Struktur Proyek

```bash
.
├── agentLoop.js            # Agentic loop (keputusan aksi, comment, follow, verifikasi)
├── stateStore.js           # State umum: loadState/saveState (semua LLM & dashboard)
├── llmClient.js            # Router LLM: Gemini / GLM / Kimi (sesuai .env)
├── geminiClient.js         # Wrapper Gemini API + key rotation
├── glmClient.js            # Wrapper GLM (Zhipu) API
├── kimiClient.js           # Wrapper Kimi (Moonshot) API
├── moltbookClient.js       # Moltbook API (post, comment, upvote, follow)
├── server.js               # Dashboard Express (Tailwind UI)
├── index.js                # Entrypoint: loop + dashboard
├── state.json              # State lokal (dibuat otomatis; git-ignored)
├── personalize.json        # Identitas & prompt agent (git-ignored; copy dari example)
├── personalize.example.json # Template personalize (commit)
├── .env                    # API keys LLM (git-ignored)
├── .env.example            # Contoh konfigurasi environment
├── package.json
├── README.md
└── LICENSE
```

---

## 🧠 Cara Kerja Agent

1. **`index.js`**: Load env, start `server.js`, loop `runAgentLoop()` dengan delay dinamis.
2. **`runAgentLoop`** (`agentLoop.js`):
   - Baca state dari `stateStore.js` (umum untuk semua LLM).
   - Panggil LLM (Gemini / GLM / Kimi sesuai `LLM_PROVIDERS`) untuk keputusan: `register`, `check_status`, `home`, `post`, `comment`, `follow`, `idle`.
   - Hindari post yang sudah dikomentari; pilih post dengan variasi.
   - Eksekusi aksi via `moltbookClient.js` (post, comment, upvote, follow, verifikasi).
   - Auto-reply ke komentar di post sendiri; periodik update `personaSummary`.
   - Simpan state lewat `stateStore.saveState()`.
3. **`server.js`**: Baca state dari `stateStore`, (opsional) panggil Moltbook `/home`, render dashboard Tailwind.

---

## 💾 State, Backup, & Keamanan

- **`stateStore.js`**: Satu tempat baca/tulis state (`loadState`, `saveState`) untuk agent loop, dashboard, dan semua LLM client (Gemini, GLM, Kimi). State disimpan di `state.json` (git-ignored).
- **`state.json`**: Dibuat otomatis saat pertama jalan. Berisi `moltbookApiKey`, `recentActions`, `topicHistory`, `verificationHistory`, `followingNames`, dll. Jangan commit.
- **`.env`**: API keys untuk LLM yang dipakai (Gemini / GLM / Kimi). Jangan commit.
- **`personalize.json`**: Nama agent, deskripsi, keyword, dan semua prompt. Git-ignored; copy dari `personalize.example.json` lalu edit.

Reset memory: stop proses, hapus atau edit `state.json`; saat start lagi `stateStore` akan buat state awal bila file tidak ada.

---


## 🧩 Kustomisasi Perilaku Bot

**Utama: `personalize.json`** (copy dari `personalize.example.json` kalau belum ada)

- **`agent.name`**, **`agent.description`**: Nama dan deskripsi agent (untuk register & prompt).
- **`keywords.music`**: Daftar keyword untuk preferensi topik (bisa kosong `[]` untuk netral).
- **`prompts`**: Semua prompt LLM (verification, comment, classify, personaSummary, decideNextAction, replyToComment). Pakai placeholder `{{agentName}}`, `{{context}}`, dll.

Setelah edit `personalize.json` atau `.env`, restart:

```bash
npm start
```

---

## 🧪 Troubleshooting

- **Error: No GOOGLE_API_KEY\* found**
  - Cek `.env`, pastikan minimal satu key terisi.

- **Dashboard kosong / nggak ada data**
  - Pastikan agent loop sudah sempat jalan dan memanggil `/home`.
  - Cek `state.json` valid dan bisa di-parse.

- **Error dari Moltbook atau Gemini di log**
  - Log sekarang sudah full English, biasanya cukup jelas.
  - Bisa jadi karena:
    - API key invalid / expired,
    - Rate limiting,
    - Network issue sementara.

Kalau mau adjust level “agresif” agent, fokusnya ada di `decideNextAction` dan `applyActionHeuristics` di `agentLoop.js`.

---

## 🤝 Contributing

Kontribusi dari komunitas sangat diterima! Cara berkontribusi ke **moltbook-agentic-ai**:

1. **Fork** repository ini ke akun GitHub kamu.
2. **Buat branch baru** untuk fitur/bugfix kamu:
   ```bash
   git checkout -b feature/nama-fitur-kamu
   ```
3. **Lakukan perubahan kode**:
   - Ikuti gaya kode yang sudah ada (Node.js + Express).
4. **Jalankan dan pastikan semua berjalan** secara lokal:
   ```bash
   npm install
   # npm test   # kalau nanti ada test
   npm start    # pastikan agent loop + dashboard works
   ```
5. **Commit dengan pesan yang jelas**:
   ```bash
   git commit -m "feat: deskripsi singkat perubahan"
   ```
6. **Push ke GitHub** dan buka **Pull Request** ke branch `main`:
   - Jelaskan perubahan kamu.
   - Sertakan langkah reproduksi / cara test kalau perlu.

### Pedoman Kontribusi Singkat

- **Fokus pada satu perubahan per PR** (satu fitur utama atau satu bugfix).
- **Update dokumentasi** (`README.md` atau komentar non-trivial) kalau perilaku bot berubah.
- Usahakan menjaga **simplicity**: bot ini sengaja dibuat mudah di-deploy dan di-fork.
- Kalau mengubah cara kerja inti agent di `agentLoop.js`, jelaskan dengan singkat di deskripsi PR.

---

## 👥 Team & Author

<div align="center">

<table>
<tr>
<td align="center">
<img src="https://github.com/Sadamdi.png" width="100px" alt="Sulthan Adam Rahmadi"/>
<br />
<strong>Sulthan Adam Rahmadi</strong>
<br />
<sub>🚀 <strong>Owner & Lead Developer</strong></sub>
<br />
<sub>
📋 Project Maintainer<br/>
💻 Backend & Agent Logic<br/>
⚙️ Moltbook API Integration<br/>
🏗️ System Design<br/>
🔐 Environment & State Handling<br/>
</sub>
<br />
<a href="https://github.com/Sadamdi">GitHub</a>
</td>
</tr>
</table>

</div>

---

## 📄 Lisensi

Project ini dirilis dengan **MIT License**.  
Lihat file `LICENSE` untuk detail lengkap.

