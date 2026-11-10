"""Original soundtrack for the Tabs launch film, synthesised from scratch and cut to the picture.
   python3 score.py  →  out/score.wav   (numpy only)"""
import wave, os
import numpy as np

SR, DUR = 44100, 41.2
N = int(SR * DUR)
rng = np.random.default_rng(7)
dry = np.zeros((2, N)); wet = np.zeros((2, N))          # wet bus goes through the reverb
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
tt = lambda d: np.arange(int(d * SR)) / SR

def put(sig, t, gain=1.0, pan=0.0, send=0.0):
    i = int(t * SR); n = min(len(sig), N - i)
    if n <= 0 or i < 0: return
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    for ch, g in ((0, l), (1, r)):
        dry[ch, i:i + n] += sig[:n] * gain * g
        wet[ch, i:i + n] += sig[:n] * gain * g * send

def pluck(m, dur=0.7, decay=0.16, bright=0.4):
    t = tt(dur); f = hz(m)
    s = np.sin(2 * np.pi * f * t) + bright * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.06) + 0.15 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / 0.03)
    return s * np.exp(-t / decay) * np.minimum(t / 0.004, 1)

def pad(notes, dur, attack=0.6, release=0.8, bright=1.6):
    t = tt(dur); s = np.zeros_like(t)
    for m in notes:
        for det in (-0.06, 0.0, 0.07):
            f = hz(m + det)
            for h in range(1, 6):
                s += np.sin(2 * np.pi * f * h * t + rng.uniform(0, 6.28)) / h ** bright
    env = np.minimum(t / attack, 1) * np.minimum((dur - t) / release, 1)
    return s / (len(notes) * 3) * env

def kick(deep=1.0):
    t = tt(0.4); f = 46 + 90 * np.exp(-t / 0.035)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.16 * deep)) * np.minimum(t / 0.002, 1)

def hat(d=0.03):
    t = tt(0.12); n = rng.standard_normal(len(t)); n = np.diff(n, prepend=0)
    return n * np.exp(-t / d) * 0.5

def blip(m, d=0.09):
    t = tt(0.3); f = hz(m) * (1 + 0.5 * np.exp(-t / 0.012))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / d) * np.minimum(t / 0.002, 1)

def click():
    t = tt(0.05)
    return (rng.standard_normal(len(t)) * np.exp(-t / 0.004) * 0.6 + np.sin(2 * np.pi * 1900 * t) * np.exp(-t / 0.012)) * 0.5

def sweep(dur, up=True, curve=2.0):
    n = rng.standard_normal(int(dur * SR))
    dark = np.convolve(n, np.ones(96) / 96, mode="same") * 5
    bright = np.diff(n, prepend=0)
    p = np.linspace(0, 1, len(n)) ** curve
    if not up: p = p[::-1]
    return (dark * (1 - p) + bright * p * 0.6) * p

def bass(m, dur=0.42):
    t = tt(dur); f = hz(m)
    return np.tanh(1.8 * (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t))) * np.minimum(t / 0.006, 1) * np.exp(-t / 0.22)

# ── 0.0 – 8.5  the sprawl: a low minor drone, a quickening tick, one pop per window ──
drone = pad([38, 45, 53], 8.6, attack=5.5, release=0.25, bright=1.3)
trem = 1 + 0.25 * np.sin(2 * np.pi * np.cumsum(np.linspace(1.5, 9, len(drone))) / SR)
put(drone * trem, 0.0, 0.55, send=0.5)
POPS = [0.3, 0.95, 1.45, 1.85, 2.2, 2.5, 2.75, 2.95, 3.12]
for i, (t, m) in enumerate(zip(POPS, [62, 65, 67, 69, 72, 74, 77, 79, 81])):
    put(blip(m), t, 0.34, pan=(-0.6, 0.6, -0.3, 0.7, -0.7, 0.2, 0.0, 0.6, -0.4)[i], send=0.5)
for k in range(int((8.3 - 0.3) / 0.25)):
    t = 0.3 + k * 0.25
    put(hat(0.015), t, 0.05 + 0.16 * (t / 8.3) ** 2, pan=0.3 if k % 2 else -0.3)
for k in range(16):                                   # sixteenths join in as the pile grows
    put(hat(0.01), 6.5 + k * 0.125 + 0.0625, 0.09, pan=0.5)
put(kick(1.8), 3.55, 0.7, send=0.5); put(kick(1.8), 4.55, 0.7, send=0.5)
put(pad([33, 45], 1.4, 0.01, 1.2), 3.55, 0.3, send=0.6); put(pad([31, 43], 1.6, 0.01, 1.4), 4.55, 0.3, send=0.6)
put(sweep(2.0), 6.45, 0.2, send=0.4)
g = tt(2.0); put(np.sin(2 * np.pi * np.cumsum(180 * 2 ** (g * 1.1)) / SR) * (g / 2.0) ** 2, 6.45, 0.12, send=0.5)

# ── 8.5  "One window." resolves to major ──
put(kick(1.4), 8.52, 0.8)
for j, m in enumerate([50, 57, 62, 66, 69, 76]):
    put(pluck(m, 2.2, 0.7, 0.5), 8.52 + j * 0.012, 0.2, pan=(j - 2.5) / 4, send=0.9)
put(pad([50, 57, 62, 66], 2.8, 0.05, 1.6), 8.52, 0.42, send=0.7)
put(sweep(0.9, up=False), 9.55, 0.12, send=0.6)       # ivory floods in
for j, m in enumerate([69, 74, 78]):                  # "Meet Tabs."
    put(pluck(m, 1.6, 0.5, 0.6), 10.05 + j * 0.11, 0.26, pan=(j - 1) * 0.4, send=0.9)
put(sweep(0.9, curve=3), 10.25, 0.1, send=0.3)

# ── 11.15 – 33.15  the tour: 11 bars at 120 bpm ──
G0, BEAT = 11.15, 0.5
CH = [(50, 54, 57), (47, 50, 54), (43, 47, 50), (45, 49, 52)]     # D  Bm  G  A
for bar in range(11):
    r, th, fi = CH[bar % 4]; b0 = G0 + bar * 2.0
    full = 2 <= bar; lift = bar >= 8
    put(pad([r, th, fi, r + 12], 2.15, 0.25, 0.5, 1.7), b0, 0.3 if lift else 0.2, send=0.6)
    arp = [r + 12, th + 12, fi + 12, r + 24, fi + 12, th + 12, r + 24, fi + 12]
    for k, m in enumerate(arp):
        put(pluck(m, 0.5, 0.13), b0 + k * 0.25, 0.17 if k % 2 == 0 else 0.11, pan=0.45 if k % 2 else -0.45, send=0.6)
        if lift: put(pluck(m + 12, 0.4, 0.09, 0.2), b0 + k * 0.25 + 0.125, 0.06, pan=-0.6 if k % 2 else 0.6, send=0.8)
    for k in (0, 1.5, 2.5): put(bass(r - 12), b0 + k * BEAT, 0.34 if bar else 0.26)
    for k in range(4):
        if full: put(kick(), b0 + k * BEAT, 0.62)
        put(hat(), b0 + k * BEAT + 0.25, 0.12 if full else 0.07, pan=0.2)
    if full and bar % 2: put(hat(0.07), b0 + 1.75, 0.1, pan=-0.3)
for t in [14.2, 16.7, 18.4, 19.3, 20.2, 21.0, 21.6, 22.4, 24.4, 25.5, 26.4]: put(click(), t, 0.3, send=0.2)
for i, t in enumerate([24.4, 25.5, 26.4]): put(blip(74 + i * 2, 0.06), t, 0.14, send=0.7)       # project switches
put(sweep(0.8, curve=3), 26.4, 0.09, send=0.4)                                                # the fan
for i, t in enumerate([29.9, 30.02, 30.14]): put(click(), t, 0.4); put(blip(57 + i * 5, 0.04), t, 0.1)
put(blip(81, 0.12), 30.2, 0.16, send=0.8); put(blip(86, 0.1), 31.05, 0.16, send=0.8); put(blip(78, 0.14), 31.5, 0.14, send=0.8)
put(sweep(1.0, curve=2.5), 32.2, 0.16, send=0.4)

# ── 33.15  blue floods: drums drop out for "Your agents." ──
crash = rng.standard_normal(int(2.2 * SR)); crash = np.diff(crash, prepend=0) * np.exp(-tt(2.2) / 0.5)
put(crash, 33.15, 0.14, send=0.8); put(kick(1.6), 33.15, 0.75)
put(pad([43, 50, 55, 59, 62], 1.75, 0.05, 0.5), 33.15, 0.4, send=0.8)
put(pad([45, 52, 57, 61, 64], 1.75, 0.2, 0.4), 34.8, 0.42, send=0.8)
for i in range(10): put(blip(74 + (0, 2, 4, 7, 9)[i % 5] + 12 * (i // 5), 0.05), 34.0 + i * 0.05, 0.07, pan=(i - 4.5) / 6, send=0.9)
for k, m in enumerate([67, 71, 74, 79, 69, 73, 76, 81]): put(pluck(m, 0.6, 0.2), 33.4 + k * 0.375, 0.12, pan=0.4 if k % 2 else -0.4, send=0.9)
put(sweep(0.9, curve=3), 35.5, 0.14, send=0.4)

# ── 36.45  the mascot lands, the wordmark rings out ──
put(kick(2.0), 36.45, 0.9, send=0.3)
put(pad([38, 50, 57, 62, 66, 69], 4.75, 0.04, 3.2, 1.5), 36.45, 0.5, send=0.8)
for j, m in enumerate([62, 66, 69, 74, 78, 81, 86]): put(pluck(m, 2.5, 0.9, 0.5), 37.6 + j * 0.085, 0.15, pan=(j - 3) / 4, send=1.0)
put(blip(86, 0.05), 37.4, 0.06, send=0.9)

# ── reverb, glue, master ──
ir_t = tt(1.9)
out = np.zeros((2, N))
for ch in range(2):
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / 0.42); ir[: int(0.012 * SR)] = 0
    ir = np.convolve(ir, np.ones(6) / 6, mode="same")
    size = 1 << int(np.ceil(np.log2(N + len(ir))))
    rev = np.fft.irfft(np.fft.rfft(wet[ch], size) * np.fft.rfft(ir, size), size)[:N]
    out[ch] = dry[ch] + rev * 0.028
out = np.tanh(out * 1.15)
fade = np.ones(N); k = int(1.6 * SR); fade[-k:] = np.linspace(1, 0, k) ** 1.5
out = out * fade / np.max(np.abs(out)) * 0.9
os.makedirs("out", exist_ok=True)
with wave.open("out/score.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out.T * 32767).astype("<i2").tobytes())
print("wrote out/score.wav", round(float(np.sqrt(np.mean(out ** 2))), 3), "rms")
