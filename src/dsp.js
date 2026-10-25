// Kontho voice engine: TD-PSOLA pitch + formant + speed shifting, all on-device.
// Works in the browser and in Node (for tests). No network, no cost.
(function (root) {
  'use strict';

  // Voice presets. p = pitch factor, f = formant factor.
  var VOICES = {
    original: { p: 1, f: 1 },
    female:   { p: 1.5, f: 1.12 },  // male -> female
    male:     { p: 0.68, f: 0.88 }, // female -> male
    child:    { p: 1.9, f: 1.28 },
    old:      { p: 0.82, f: 0.92, jitter: 0.03 },
    robot:    { p: 1, f: 1, robot: 110 },
    cartoon:  { p: 1.45, f: 1.4 }
  };
  // Tone (emotion) presets: semitone offset, speed, intonation spread.
  var TONES = {
    normal:  { st: 0,  speed: 1,    spread: 1 },
    happy:   { st: 1,  speed: 1.07, spread: 1.35 },
    excited: { st: 2,  speed: 1.13, spread: 1.6 },
    calm:    { st: -0.5, speed: 0.93, spread: 0.75 },
    sad:     { st: -1.5, speed: 0.87, spread: 0.55 },
    angry:   { st: 0.5, speed: 1.05, spread: 1.2, gain: 1.15 }
  };

  // Pitch tracking with a normalised autocorrelation (YIN-style difference).
  function trackPitch(x, sr) {
    var hop = Math.round(sr * 0.01), win = Math.round(sr * 0.04);
    var minLag = Math.floor(sr / 500), maxLag = Math.ceil(sr / 60);
    var frames = Math.max(1, Math.floor((x.length - win - maxLag) / hop));
    var f0 = new Float32Array(frames), rmsAll = 0;
    for (var i = 0; i < x.length; i++) rmsAll += x[i] * x[i];
    rmsAll = Math.sqrt(rmsAll / Math.max(1, x.length));
    var d = new Float32Array(maxLag + 1);
    for (var fr = 0; fr < frames; fr++) {
      var s = fr * hop, e = 0;
      for (i = 0; i < win; i++) e += x[s + i] * x[s + i];
      if (Math.sqrt(e / win) < rmsAll * 0.1) { f0[fr] = 0; continue; }
      var run = 0, best = -1, bestV = 1;
      d[0] = 1;
      for (var lag = 1; lag <= maxLag; lag++) {
        var sum = 0;
        for (i = 0; i < win; i++) { var df = x[s + i] - x[s + i + lag]; sum += df * df; }
        run += sum;
        d[lag] = run > 0 ? sum * lag / run : 1;
      }
      for (lag = minLag; lag <= maxLag; lag++) {
        if (d[lag] < 0.25) {
          while (lag + 1 <= maxLag && d[lag + 1] < d[lag]) lag++;
          best = lag; bestV = d[lag]; break;
        }
        if (d[lag] < bestV) { bestV = d[lag]; best = lag; }
      }
      f0[fr] = (best > 0 && bestV < 0.4) ? sr / best : 0;
    }
    // Median-of-5 smoothing removes octave blips.
    var out = new Float32Array(frames);
    for (fr = 0; fr < frames; fr++) {
      var w = [];
      for (var k = -2; k <= 2; k++) { var v = f0[Math.min(frames - 1, Math.max(0, fr + k))]; w.push(v); }
      w.sort(function (a, b) { return a - b; });
      out[fr] = f0[fr] > 0 ? (w[2] || f0[fr]) : 0;
    }
    return { f0: out, hop: hop };
  }

  function median(arr) {
    var v = [];
    for (var i = 0; i < arr.length; i++) if (arr[i] > 0) v.push(arr[i]);
    if (!v.length) return 0;
    v.sort(function (a, b) { return a - b; });
    return v[v.length >> 1];
  }

  // Place analysis marks one period apart, snapped to waveform peaks.
  function pitchMarks(x, sr, track) {
    var marks = [], periods = [], voiced = [];
    var unv = Math.round(sr / 100), t = 0, pol = 0;
    for (var q = 0; q < x.length; q++) pol += x[q] * x[q] * x[q];
    pol = pol < 0 ? -1 : 1;
    while (t < x.length) {
      var fr = Math.min(track.f0.length - 1, Math.floor(t / track.hop));
      var f = track.f0[fr];
      if (f > 0) {
        var P = Math.round(sr / f), lo = Math.max(0, t - (P >> 2)), hi = Math.min(x.length - 1, t + (P >> 2)), m = t, mv = -Infinity;
        // Snap to the same-signed peak every period, so grains line up in phase (no rough, husky sound).
        for (var i = lo; i <= hi; i++) { var a = x[i] * pol; if (a > mv) { mv = a; m = i; } }
        if (marks.length && m <= marks[marks.length - 1]) m = marks[marks.length - 1] + (P >> 1);
        marks.push(m); periods.push(P); voiced.push(1); t = m + P;
      } else {
        marks.push(t); periods.push(unv); voiced.push(0); t += unv;
      }
    }
    return { marks: marks, periods: periods, voiced: voiced };
  }

  function nearest(marks, t, hint) {
    var i = hint;
    while (i + 1 < marks.length && Math.abs(marks[i + 1] - t) <= Math.abs(marks[i] - t)) i++;
    while (i > 0 && Math.abs(marks[i - 1] - t) < Math.abs(marks[i] - t)) i--;
    return i;
  }

  // Main transform. opts: {voice, tone, pitch (semitones extra), speed}
  function transform(x, sr, opts) {
    opts = opts || {};
    var V = VOICES[opts.voice] || VOICES.original, T = TONES[opts.tone] || TONES.normal;
    var semis = T.st + (opts.pitch || 0);
    var pitchMul = V.p * Math.pow(2, semis / 12);
    var fmt = V.f * (opts.formant || 1);
    var speed = T.speed * (opts.speed || 1);
    var track = trackPitch(x, sr), base = median(track.f0) || 150;
    var pm = pitchMarks(x, sr, track);
    var outLen = Math.ceil(x.length / speed) + sr;
    var out = new Float32Array(outLen), wsum = new Float32Array(outLen);
    var ts = 0, hint = 0, seed = 1;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; }
    while (ts < outLen - sr) {
      var ta = ts * speed;
      if (ta >= x.length) break;
      hint = nearest(pm.marks, ta, hint);
      var m = pm.marks[hint], P = pm.periods[hint], isV = pm.voiced[hint];
      var step;
      if (isV) {
        var f0 = sr / P, target;
        if (V.robot) target = V.robot * Math.pow(2, semis / 12);
        else target = base * pitchMul * Math.pow(f0 / base, T.spread);
        if (V.jitter) target *= 1 + V.jitter * rnd();
        step = sr / target;
      } else step = P;
      // Analysis half-width: at least one period, wider when we stretch gaps.
      var W = Math.round(Math.max(P, step * fmt));
      var G = Math.max(2, Math.round(W / fmt)); // synthesis half-width after formant scaling
      var c = Math.round(ts);
      for (var j = -G; j <= G; j++) {
        var src = m + j * fmt, o = c + j;
        if (o < 0 || o >= outLen) continue;
        var i0 = Math.floor(src);
        if (i0 < 0 || i0 + 1 >= x.length) continue;
        var fr = src - i0, s = x[i0] + (x[i0 + 1] - x[i0]) * fr;
        var w = 0.5 + 0.5 * Math.cos(Math.PI * j / (G + 1));
        out[o] += s * w; wsum[o] += w;
      }
      ts += step;
    }
    var n = Math.min(outLen, Math.ceil(x.length / speed));
    var res = new Float32Array(n), peak = 0;
    for (var i = 0; i < n; i++) {
      res[i] = wsum[i] > 0.05 ? out[i] / Math.max(wsum[i], 0.5) : 0;
      var a = Math.abs(res[i]); if (a > peak) peak = a;
    }
    if (V.robot) { // a light metallic ring
      for (i = 0; i < n; i++) res[i] *= 0.75 + 0.25 * Math.sin(2 * Math.PI * 55 * i / sr);
    }
    return normalize(res, 0.89 * (T.gain || 1));
  }

  function normalize(x, target) {
    var peak = 0, i;
    for (i = 0; i < x.length; i++) { var a = Math.abs(x[i]); if (a > peak) peak = a; }
    if (peak > 0) { var g = Math.min(target, 0.98) / peak; for (i = 0; i < x.length; i++) x[i] *= g; }
    // 20 ms fades so the clip never clicks.
    var fl = Math.min(x.length >> 1, 441);
    for (i = 0; i < fl; i++) { var r = i / fl; x[i] *= r; x[x.length - 1 - i] *= r; }
    return x;
  }

  // Trim leading/trailing silence so voice notes start straight away.
  function trimSilence(x, sr) {
    var win = Math.round(sr * 0.02), thr = 0, i;
    for (i = 0; i < x.length; i++) thr = Math.max(thr, Math.abs(x[i]));
    thr *= 0.04;
    var s = 0, e = x.length;
    while (s < x.length - win) { var mx = 0; for (i = s; i < s + win; i++) mx = Math.max(mx, Math.abs(x[i])); if (mx > thr) break; s += win; }
    while (e > s + win) { mx = 0; for (i = e - win; i < e; i++) mx = Math.max(mx, Math.abs(x[i])); if (mx > thr) break; e -= win; }
    s = Math.max(0, s - win * 5); e = Math.min(x.length, e + win * 5);
    return x.subarray(s, e);
  }

  function encodeWav(x, sr) {
    var buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, x.length * 2, true);
    for (var i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
    return buf;
  }

  // MP3 via lamejs when loaded (much smaller for WhatsApp), else WAV.
  function encode(x, sr) {
    var L = root.lamejs;
    if (L && L.Mp3Encoder) {
      try {
        var enc = new L.Mp3Encoder(1, sr, 64), pcm = new Int16Array(x.length), parts = [];
        for (var i = 0; i < x.length; i++) pcm[i] = Math.max(-1, Math.min(1, x[i])) * 32767;
        for (i = 0; i < pcm.length; i += 1152) { var b = enc.encodeBuffer(pcm.subarray(i, i + 1152)); if (b.length) parts.push(b); }
        var f = enc.flush(); if (f.length) parts.push(f);
        return { data: parts, type: 'audio/mpeg', ext: 'mp3' };
      } catch (e) { /* fall through to WAV */ }
    }
    return { data: [encodeWav(x, sr)], type: 'audio/wav', ext: 'wav' };
  }

  root.KonthoDSP = { VOICES: VOICES, TONES: TONES, transform: transform, trackPitch: trackPitch, median: median, trimSilence: trimSilence, encodeWav: encodeWav, encode: encode };
})(typeof window !== 'undefined' ? window : globalThis);
