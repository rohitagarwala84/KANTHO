# Kontho (কণ্ঠ) — AI Voice Studio

Apnar kotha, je kono kontho-e, je kono bhashay. WhatsApp voice message er jonno.

## Ki ki kore
1. **Meye ↔ Chele kontho** (female→male, male→female), plus Baccha, Boyosko, Robot, Cartoon.
2. **Onno bhashay** — Bangla, Hindi, English, Urdu, Arabic, Tamil, Telugu, Marathi, Gujarati, Nepali, Spanish, French, German, Russian, Chinese, Japanese.
3. **Tone** — Swabhabik, Khushi, Shanto, Dukkhi, Uttejito, Ragi.
4. **Native pronunciation** — Microsoft neural voice (prottek bhashar nijer male + female voice).
5. **Instant** — kontho bodol phone-ei hoy, 1 minute audio ~1-3 second.
6. **WhatsApp** — "WhatsApp-e pathan" button e share sheet khole, MP3 file jay.
7. **Khoroch ₹0** — sob free/open-source.

## Kivabe kaj kore (architecture)

| Kaj | Ki use hoy | Khoroch |
|---|---|---|
| Kontho bodol (male/female/child/robot) | Nijer lekha TD-PSOLA engine (pitch + formant shift), phone-er browser-e | ₹0, internet lage na |
| Bola kotha → lekha | Browser Speech Recognition (Chrome), na hole Whisper (server) | ₹0 |
| Onubad | Google Translate free endpoint | ₹0 |
| Natural kontho (onno bhasha) | edge-tts (Microsoft neural voices) on free Hugging Face Space | ₹0 |
| App hosting | GitHub Pages (PWA, phone-e install kora jay) | ₹0 |

## Folder
- `app/` — puro app (index.html, sw.js, manifest). Jekono free static host-e rakhun.
- `server/` — free voice server (Hugging Face Space, Docker).
- `src/` — source (dsp.js = voice engine, body.html = UI). `node build.js` diye app banay.

## Free voice server chalu korar niyom (5 minute)
1. https://huggingface.co e free account khulun.
2. **New Space** → naam `kontho` → SDK: **Docker** → Blank → Public → Create.
3. `server/` folder er 4 ta file (app.py, requirements.txt, Dockerfile, README.md) upload korun (Files → Add file → Upload).
4. 3-5 minute build hobe. Tarpor link hobe `https://<apnar-naam>-kontho.hf.space`.
5. App e ⚙ Settings → oi link din → "Server test" ✅.

Note: free Space 48 ghonta kono use na hole ghumiye pore; prothom request e ~30 second lagte pare.

## Porer dhap (quality upgrade)
- **RVC voice model**: ekdom asol manush er moto meye/chele kontho (GPU lage; free Colab/HF ZeroGPU diye try kora jay).
- **Nijer kontho onno bhashay** (voice cloning, e.g. OpenVoice / XTTS) — apnar nijer golay Hindi/English.
- **WhatsApp bot**: voice note forward korlei bodle ferot pathabe (WhatsApp Business API — free tier e limited).
- Android app (PWA → TWA) Play Store e.
