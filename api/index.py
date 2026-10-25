"""Kontho voice API for Vercel (free Hobby plan). Same as server/app.py but under /api and without Whisper.

Gives the Kontho app:
  GET  /api/tts?text=..&voice=bn-IN-TanishaaNeural&rate=+0%&pitch=+0Hz  -> mp3 (natural neural voice)
  GET  /api/translate?text=..&to=hi&src=auto                             -> {"text": "..."}
"""
import io, re
import edge_tts
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

app = FastAPI(title="Kontho voice API", root_path="")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MAX_CHARS = 1500


@app.get("/api")
def health():
    return {"ok": True, "service": "kontho"}


@app.get("/api/tts")
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


@app.get("/api/translate")
async def translate(text: str = Query(..., max_length=MAX_CHARS), to: str = "en", src: str = "auto"):
    params = {"client": "gtx", "sl": src, "tl": to, "dt": "t", "q": text}
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get("https://translate.googleapis.com/translate_a/single", params=params)
    if r.status_code != 200:
        raise HTTPException(502, "translate failed")
    data = r.json()
    return {"text": "".join(seg[0] for seg in data[0] if seg and seg[0]), "detected": data[2] if len(data) > 2 else src}
