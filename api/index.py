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
from fastapi.responses import Response, FileResponse
from pathlib import Path

app = FastAPI(title="Kontho voice API", root_path="")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Kontho-Engine"])

MAX_CHARS = 1500
ROOT = Path(__file__).resolve().parent.parent
STATIC = {"index.html": "text/html; charset=utf-8", "sw.js": "text/javascript", "manifest.webmanifest": "application/manifest+json", "icon.svg": "image/svg+xml"}


@app.get("/api")
def health():
    return {"ok": True, "service": "kontho"}


@app.get("/api/tts")
async def tts(text: str = Query(..., max_length=MAX_CHARS), voice: str = "bn-IN-TanishaaNeural",
              rate: str = "+0%", pitch: str = "+0Hz", volume: str = "+0%", lang: str = ""):
    if not re.fullmatch(r"[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural", voice):
        raise HTTPException(400, "bad voice")
    for v in (rate, volume):
        if not re.fullmatch(r"[+-]\d{1,3}%", v):
            raise HTTPException(400, "bad rate/volume")
    if lang and not re.fullmatch(r"[a-zA-Z-]{2,10}", lang):
        raise HTTPException(400, "bad lang")
    if not re.fullmatch(r"[+-]\d{1,3}Hz", pitch):
        raise HTTPException(400, "bad pitch")
    lang = lang or voice.split("-")[0]
    errors = []
    try:
        data = await edge_speak(text, voice, rate, pitch, volume)
        return Response(data, media_type="audio/mpeg", headers={"X-Kontho-Engine": "edge", "Cache-Control": "public, max-age=86400"})
    except Exception as e:  # Microsoft voices can refuse cloud IPs; fall back to Google's voice.
        errors.append("edge: %r" % e)
    try:
        data = await google_speak(text, lang)
        return Response(data, media_type="audio/mpeg", headers={"X-Kontho-Engine": "google", "Cache-Control": "public, max-age=86400"})
    except Exception as e:
        errors.append("google: %r" % e)
    raise HTTPException(502, " | ".join(errors)[:500])


async def edge_speak(text, voice, rate, pitch, volume):
    buf = io.BytesIO()
    com = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume)
    async for chunk in com.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    if not buf.tell():
        raise RuntimeError("no audio")
    return buf.getvalue()


def _chunks(text, size=180):
    """Google's voice takes short pieces; split on sentence marks, then spaces."""
    parts, cur = [], ""
    for word in re.split(r"(?<=[.!?।॥,;:\s])", text):
        if len(cur) + len(word) > size and cur:
            parts.append(cur.strip()); cur = ""
        while len(word) > size:
            parts.append(word[:size]); word = word[size:]
        cur += word
    if cur.strip():
        parts.append(cur.strip())
    return parts


async def google_speak(text, lang):
    out = io.BytesIO()
    headers = {"User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36", "Referer": "https://translate.google.com/"}
    async with httpx.AsyncClient(timeout=15, headers=headers) as c:
        for i, piece in enumerate(_chunks(text)):
            r = await c.get("https://translate.google.com/translate_tts", params={"ie": "UTF-8", "client": "tw-ob", "tl": lang, "q": piece, "total": 1, "idx": 0, "textlen": len(piece)})
            if r.status_code != 200 or not r.content:
                raise RuntimeError("google tts %s" % r.status_code)
            out.write(r.content)
    return out.getvalue()


@app.get("/api/diag")
async def diag(voice: str = "hi-IN-SwaraNeural", lang: str = "hi"):
    """Open in a browser to see which voice engine works from this server."""
    res = {"edge_tts_version": getattr(edge_tts, "__version__", "?")}
    for name, fn in (("edge", lambda: edge_speak("नमस्ते", voice, "+0%", "+0Hz", "+0%")), ("google", lambda: google_speak("नमस्ते", lang))):
        try:
            res[name] = "ok, %d bytes" % len(await fn())
        except Exception as e:
            res[name] = "error: %r" % e
    return res


@app.get("/api/translate")
async def translate(text: str = Query(..., max_length=MAX_CHARS), to: str = "en", src: str = "auto"):
    params = {"client": "gtx", "sl": src, "tl": to, "dt": "t", "q": text}
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get("https://translate.googleapis.com/translate_a/single", params=params)
    if r.status_code != 200:
        raise HTTPException(502, "translate failed")
    data = r.json()
    return {"text": "".join(seg[0] for seg in data[0] if seg and seg[0]), "detected": data[2] if len(data) > 2 else src}


# The app page itself, so one Vercel link serves both the app and the voice API.
@app.get("/")
def home():
    return FileResponse(ROOT / "index.html", media_type=STATIC["index.html"], headers={"Cache-Control": "no-cache"})


@app.get("/{name}")
def static_file(name: str):
    if name not in STATIC:
        raise HTTPException(404, "not found")
    return FileResponse(ROOT / name, media_type=STATIC[name], headers={"Cache-Control": "no-cache"})
