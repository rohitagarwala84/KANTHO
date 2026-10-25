"""Kontho free voice server.

Runs on a free Hugging Face Space (Docker). Gives the Kontho app:
  GET  /tts?text=..&voice=bn-IN-TanishaaNeural&rate=+0%&pitch=+0Hz  -> mp3 (natural neural voice)
  GET  /translate?text=..&to=hi&src=auto                             -> {"text": "..."}
  POST /stt (form file=audio, lang=bn)                               -> {"text": "..."}  (Whisper, optional)
"""
import io, os, re
import edge_tts
import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

app = FastAPI(title="Kontho voice server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MAX_CHARS = 1500
_whisper = None


@app.get("/")
def health():
    return {"ok": True, "service": "kontho"}


@app.get("/tts")
async def tts(text: str = Query(..., max_length=MAX_CHARS), voice: str = "bn-IN-TanishaaNeural",
              rate: str = "+0%", pitch: str = "+0Hz", volume: str = "+0%"):
    if not re.fullmatch(r"[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural", voice):
        raise HTTPException(400, "bad voice")
    for v in (rate, volume):
        if not re.fullmatch(r"[+-]\d{1,3}%", v):
            raise HTTPException(400, "bad rate/volume")
    if not re.fullmatch(r"[+-]\d{1,3}Hz", pitch):
        raise HTTPException(400, "bad pitch")
    buf = io.BytesIO()
    com = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume)
    async for chunk in com.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    if not buf.tell():
        raise HTTPException(502, "no audio")
    return Response(buf.getvalue(), media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/translate")
async def translate(text: str = Query(..., max_length=MAX_CHARS), to: str = "en", src: str = "auto"):
    params = {"client": "gtx", "sl": src, "tl": to, "dt": "t", "q": text}
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get("https://translate.googleapis.com/translate_a/single", params=params)
    if r.status_code != 200:
        raise HTTPException(502, "translate failed")
    data = r.json()
    return {"text": "".join(seg[0] for seg in data[0] if seg and seg[0]), "detected": data[2] if len(data) > 2 else src}


@app.post("/stt")
async def stt(file: UploadFile = File(...), lang: str = Form("")):
    global _whisper
    if os.environ.get("KONTHO_NO_STT"):
        raise HTTPException(501, "stt disabled")
    from faster_whisper import WhisperModel
    if _whisper is None:
        _whisper = WhisperModel(os.environ.get("WHISPER_MODEL", "small"), device="cpu", compute_type="int8")
    data = await file.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "file too big")
    segments, info = _whisper.transcribe(io.BytesIO(data), language=lang or None, vad_filter=True)
    return {"text": " ".join(s.text.strip() for s in segments), "lang": info.language}
