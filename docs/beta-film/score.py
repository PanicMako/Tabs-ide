"""Original score and sound design for the Tabs public-beta film, synthesised from scratch and cut to picture.
   python3 score.py  →  out/score.wav      (numpy + scipy)
   100 BPM, D major. A beat is 0.6 s and a bar 2.4 s, the same grid film.js is cut on."""
import os, wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR, DUR = 48000, 42.6
QSHIFT = 3.6      # the Quick Actions bar-and-a-half, inserted at 24.0
N = int(SR * DUR)
rng = np.random.default_rng(11)
dry = np.zeros((2, N)); wet = np.zeros((2, N))
BEAT, BAR = 0.6, 2.4
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
tt = lambda d: np.arange(int(d * SR)) / SR
lp = lambda x, f, o=2: sosfilt(butter(o, f, "low", fs=SR, output="sos"), x)
hp = lambda x, f, o=2: sosfilt(butter(o, f, "high", fs=SR, output="sos"), x)
bp = lambda x, a, b: sosfilt(butter(2, [a, b], "band", fs=SR, output="sos"), x)

def put(sig, t, gain=1.0, pan=0.0, send=0.0, raw=False):
    if not raw and t >= 23.9: t += QSHIFT
    i = int(t * SR)
    if i < 0: sig = sig[-i:]; i = 0
    n = min(len(sig), N - i)
    if n <= 0: return
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    for ch, g in ((0, l), (1, r)):
        dry[ch, i:i + n] += sig[:n] * gain * g
        wet[ch, i:i + n] += sig[:n] * gain * g * send

# ── instruments ──
def mallet(m, dur=1.4, decay=0.35, bright=0.5):
    """soft felt mallet: sine body, a short FM knock on top"""
    t = tt(dur); f = hz(m)
    mod = np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t / 0.035) * bright * 2.2
    s = np.sin(2 * np.pi * f * t + mod) + 0.28 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / (decay * 0.5))
    return s * np.exp(-t / decay) * np.minimum(t / 0.003, 1)

def keys(notes, dur=2.6, decay=1.1, bright=1.0):
    """warm electric-piano chord"""
    t = tt(dur); s = np.zeros_like(t)
    for m in notes:
        f = hz(m)
        tine = np.sin(2 * np.pi * f * t + bright * 1.4 * np.exp(-t / 0.25) * np.sin(2 * np.pi * f * 2 * t))
        bell = 0.12 * np.sin(2 * np.pi * f * 4.0 * t) * np.exp(-t / 0.09)
        s += (tine + bell) * (1 + 0.05 * np.sin(2 * np.pi * 4.6 * t))
    return s / max(len(notes), 1) * np.exp(-t / decay) * np.minimum(t / 0.006, 1)

def pad(notes, dur, attack=0.9, release=1.2, cut=1400):
    t = tt(dur); s = np.zeros_like(t)
    for m in notes:
        for det in (-0.09, 0.0, 0.08):
            f = hz(m + det); ph = rng.uniform(0, 6.28)
            for h in range(1, 9): s += np.sin(2 * np.pi * f * h * t + ph * h) / h
    s = lp(s, cut, 2)
    env = np.minimum(t / attack, 1) * np.minimum((dur - t) / release, 1)
    return s / (len(notes) * 3) * env

def bass(m, dur=0.5):
    t = tt(dur); f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.12) + 0.12 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / 0.06)
    return s * np.minimum(t / 0.006, 1) * np.minimum((dur - t) / 0.06, 1) * np.exp(-t / (dur * 1.4))

def kick(deep=1.0):
    t = tt(0.45); f = 44 + 100 * np.exp(-t / 0.03)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.17 * deep)) + 0.25 * lp(rng.standard_normal(len(t)), 900) * np.exp(-t / 0.008)) * np.minimum(t / 0.0015, 1)

def rim():
    t = tt(0.16)
    return (np.sin(2 * np.pi * 1180 * t) * np.exp(-t / 0.018) + bp(rng.standard_normal(len(t)), 1500, 6000) * np.exp(-t / 0.03) * 0.7) * 0.6

def shaker(d=0.035):
    t = tt(0.14); return hp(rng.standard_normal(len(t)), 5500) * np.exp(-t / d) * np.minimum(t / 0.004, 1)

def tick(f=2300, d=0.008):
    t = tt(0.05); return (bp(rng.standard_normal(len(t)), 1800, 7000) * np.exp(-t / 0.003) * 0.7 + np.sin(2 * np.pi * f * t) * np.exp(-t / d) * 0.5)

def click():
    t = tt(0.07)
    return np.concatenate([tick(1700, 0.01)[: int(0.03 * SR)], np.zeros(int(0.012 * SR)), tick(2500, 0.006)[: int(0.028 * SR)] * 0.6])[: len(t)]

def thump(f0=62, d=0.22):
    t = tt(0.6); f = f0 + 70 * np.exp(-t / 0.04)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / d) * np.minimum(t / 0.002, 1) + lp(rng.standard_normal(len(t)), 500) * np.exp(-t / 0.02) * 0.5

def whoosh(dur, lo=300, hi=5000, peak=0.6, q=0.5):
    """filtered-noise pass-by: centre frequency rises to `peak` of the way through, then falls"""
    n = int(dur * SR); x = rng.standard_normal(n); t = np.arange(n) / n
    env = np.exp(-((t - peak) ** 2) / (2 * (0.22 * q + 0.08) ** 2))
    out = np.zeros(n); bands = np.geomspace(lo, hi, 7)
    centre = np.interp(t, [0, peak, 1], [0.0, 1.0, 0.25])
    for k, (a, b) in enumerate(zip(bands[:-1], bands[1:])):
        w = np.exp(-((centre * 5 - k) ** 2) / 1.6)
        out += bp(x, a, b) * w
    return out * env

def riser(dur, m=62):
    t = tt(dur); p = t / dur
    s = np.zeros_like(t)
    for det in (-0.1, 0, 0.1, 12.05):
        f = hz(m + det) * (1 + 0.012 * p); s += np.sin(2 * np.pi * np.cumsum(f) / SR + rng.uniform(0, 6))
    air = hp(rng.standard_normal(len(t)), 3000) * 0.5
    return (s * 0.25 + air * p ** 2) * p ** 2.2

def fall(dur=0.75):
    t = tt(dur); p = t / dur
    f = hz(86) * 2 ** (-2.2 * p ** 1.6)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * p ** 1.5 * 0.5 + bp(rng.standard_normal(len(t)), 800, 4000) * p ** 3 * 0.35

def chime(notes, gap=0.09, decay=0.5):
    out = np.zeros(int((gap * len(notes) + 1.6) * SR))
    for i, m in enumerate(notes):
        s = mallet(m, 1.5, decay, 0.9); j = int(i * gap * SR); out[j:j + len(s)] += s
    return out

# ── harmony (MIDI) ──
D, Bm, G, A, Em = [50, 57, 62, 66, 69], [47, 54, 62, 66, 69], [43, 55, 59, 62, 66], [45, 57, 61, 64, 69], [52, 59, 62, 66, 67]
bar = lambda n: n * BAR

# ── cold open: a tab falls, lands, the line runs out ──
put(fall(0.75), 0.45, 0.16, -0.1, 0.3)
put(thump(64, 0.2), 1.2, 0.5, 0, 0.12); put(mallet(62, 2.4, 0.7, 0.7), 1.2, 0.34, 0, 0.5); put(mallet(50, 2.4, 0.9, 0.3), 1.2, 0.3, 0, 0.3)
put(whoosh(1.1, 600, 7000, 0.25, 0.9), 1.2, 0.07, 0.2, 0.5)
for k in range(9): put(tick(2100 + 60 * (k % 3)), 1.52 + k / 17, 0.085, -0.25, 0.1)
put(pad([50, 57, 62], 3.2, 1.6, 1.4, 900), 1.8, 0.11, 0, 0.6)
for i, (t0, m) in enumerate(zip([3.0, 3.3, 3.6, 3.9], [66, 69, 71, 74])):
    put(mallet(m, 1.6, 0.42, 0.8), t0, 0.3, -0.4 + i * 0.27, 0.5); put(thump(90 + 8 * i, 0.07), t0, 0.14, -0.4 + i * 0.27, 0.05)
put(mallet(57, 1.4, 0.5, 0.4), 2.4, 0.2, 0.1, 0.4)

# ── the reveal: dolly-zoom into the drawer ──
put(thump(46, 0.5), 4.8, 0.42, 0, 0.3)
put(riser(2.6, 50), 4.7, 0.13, 0, 0.5)
put(whoosh(2.9, 150, 3200, 0.7, 1.2), 4.75, 0.2, -0.15, 0.4)
put(pad(Bm, 3.0, 1.5, 1.0, 1700), 4.8, 0.2, 0, 0.7); put(pad(G, 2.9, 0.8, 1.2, 1900), 7.1, 0.2, 0, 0.7)
for k, m in enumerate([66, 69, 74, 78, 74, 69, 71, 74, 78, 81, 78, 74, 71, 74, 79, 83]):
    put(mallet(m, 1.2, 0.3, 0.6), 5.4 + k * 0.3 - 0.3 * 0 + 0.0, 0.07 + 0.012 * k, np.sin(k * 1.3) * 0.6, 0.6) if 5.4 + k * 0.3 < 9.5 else None
put(keys(Bm, 2.6, 1.3, 0.8), 7.2, 0.0, 0, 0.5)

# ── the folder becomes the window ──
put(riser(1.7, 57), 8.5, 0.12, 0, 0.5)
put(whoosh(1.9, 200, 5000, 0.72, 0.9), 8.45, 0.2, 0.15, 0.4)
put(pad(A, 2.7, 0.6, 0.9, 2100), 9.5, 0.2, 0, 0.7)
for k in range(6): put(tick(1900 + 140 * k, 0.012), 9.75 + k * 0.07, 0.1, -0.5 + k * 0.1, 0.25); put(mallet(74 + [0, 2, 4, 7, 9, 12][k], 0.6, 0.12, 0.5), 9.75 + k * 0.07, 0.07, -0.5 + k * 0.1, 0.5)
put(thump(52, 0.3), 10.2, 0.5, 0, 0.2); put(keys([50, 57, 62, 64, 69], 2.4, 1.2, 1.0), 10.2, 0.3, 0, 0.5)
for k in range(3): put(mallet([81, 78, 74][k], 0.9, 0.3, 0.5), 11.1 + k * 0.3, 0.12, 0.3 - k * 0.3, 0.6)

# ── five tools, five bars: the groove ──
prog = [D, Bm, G, A, Em]
for b, ch in enumerate(prog):
    t0 = 12.0 + b * BAR
    put(keys(ch, 2.5, 1.25, 1.0), t0, 0.26, -0.1, 0.4)
    put(keys([n + 12 for n in ch[2:]], 1.3, 0.6, 0.6), t0 + 1.5, 0.11, 0.25, 0.5)
    put(pad([ch[1], ch[2], ch[3]], 2.7, 0.5, 0.5, 1500), t0 - 0.1, 0.1, 0, 0.6)
    root = ch[0] - 12 if ch[0] > 45 else ch[0]
    for bt, d in ((0, 0.55), (0.75, 0.3), (1.5, 0.4), (2.5, 0.25), (3.0, 0.5), (3.5, 0.25)):
        put(lp(bass(root + (12 if bt == 2.5 else 0), d), 500), t0 + bt * BEAT, 0.46, 0, 0.0)
    for bt in (0, 2, 2.75): put(kick(), t0 + bt * BEAT, 0.6, 0, 0.03)
    for bt in (1, 3): put(rim(), t0 + bt * BEAT, 0.17, 0.15, 0.3)
    for e in range(8): put(shaker(0.03 if e % 2 else 0.018), t0 + e * 0.3 + (0.012 if e % 2 else 0), 0.05 if e % 2 else 0.028, 0.35, 0.15)
    arp = [ch[2] + 12, ch[4] + 12, ch[3] + 12, ch[4] + 12, ch[2] + 24, ch[4] + 12, ch[3] + 12, ch[1] + 24]
    for e, m in enumerate(arp): put(mallet(m, 0.9, 0.2, 0.55), t0 + e * 0.3, 0.085, (-1) ** e * 0.45, 0.55)
    if b: put(whoosh(0.7, 500, 6000, 0.45, 0.5), t0 - 0.08, 0.13, 0.3 if b % 2 else -0.3, 0.3); put(click(), t0, 0.26, -0.3, 0.1)

# write: typing in the editor
for k in range(30): put(tick(2000 + rng.uniform(-200, 300)), 12.15 + k / 26 + rng.uniform(-0.006, 0.006), 0.07, 0.1, 0.08)
# hand it off: the agent answers, three steps tick off
for k in range(18): put(tick(3000, 0.004), 15.1 + k * 0.048, 0.03, 0.0, 0.1)
for k, m in enumerate([78, 81, 86]): put(mallet(m, 0.8, 0.2, 0.7), 15.65 + k * 0.2, 0.13, -0.1 + k * 0.1, 0.5)
# run it: logs
for t0 in (17.05, 17.35, 17.5, 17.75, 17.95, 18.05, 18.3, 18.5): put(tick(1500, 0.006), t0, 0.045, rng.uniform(-0.5, 0.5), 0.15)
# see it: the toggle, night falls across the page
put(click(), 20.25, 0.3, 0.5, 0.1); put(whoosh(1.1, 300, 4000, 0.4, 1.0), 20.25, 0.15, 0.2, 0.6)
put(chime([86, 81, 78, 74], 0.11, 0.6), 20.3, 0.1, 0.3, 0.8)
# ship it: commit
for k in range(15): put(tick(2100 + rng.uniform(-150, 250)), 22.15 + k / 30, 0.06, -0.2, 0.08)
put(click(), 23.0, 0.32, -0.2, 0.1); put(chime([74, 78, 81, 86], 0.075, 0.55), 23.04, 0.2, -0.1, 0.7)


# ── quick actions: three keys, the dial blooms, focus walks round it ──
def Q(sig, t, *a): put(sig, t, *a, raw=True)
Q(keys(G, 2.2, 1.3, 0.9), 24.0, 0.24, 0, 0.5); Q(keys(A, 2.0, 1.2, 0.9), 25.8, 0.22, 0, 0.5)
Q(pad(G, 2.2, 0.4, 0.6, 1500), 24.0, 0.13, 0, 0.6); Q(pad(A, 2.0, 0.4, 0.6, 1700), 25.8, 0.13, 0, 0.6)
Q(lp(bass(31 + 12, 1.2), 420), 24.0, 0.42, 0, 0); Q(lp(bass(33, 1.2), 420), 25.8, 0.42, 0, 0)
for bt in (0, 3): Q(kick(), 24.0 + bt * BEAT, 0.55, 0, 0.04)
for e in range(12): Q(shaker(0.03 if e % 2 else 0.018), 24.0 + e * 0.3, 0.045 if e % 2 else 0.025, 0.35, 0.15)
for k in range(3): Q(click(), 24.0 + k * 0.08, 0.2, -0.2 + k * 0.2, 0.1)
Q(whoosh(0.7, 300, 5000, 0.4, 0.6), 24.2, 0.12, 0, 0.4)
for k, m in enumerate([74, 78, 81, 86, 90, 93]): Q(mallet(m, 0.8, 0.18, 0.7), 24.3 + k * 0.055, 0.1, -0.5 + k * 0.2, 0.6)
for k, m in enumerate([81, 83, 86, 88, 90]): Q(mallet(m, 0.6, 0.14, 0.6), 24.9 + k * 0.3, 0.12, -0.3 + k * 0.15, 0.5); Q(tick(1800, 0.008), 24.9 + k * 0.3, 0.09, 0, 0.15)
Q(click(), 26.4, 0.32, 0.2, 0.1); Q(chime([86, 93], 0.08, 0.4), 26.42, 0.14, 0.2, 0.7)
Q(whoosh(0.6, 400, 4000, 0.5, 0.5), 26.55, 0.1, 0, 0.4)
Q(rim(), 27.0, 0.15, 0.15, 0.3)

# ── then switch: fly through two projects ──
put(keys(G, 2.6, 1.6, 0.9), 24.0, 0.26, 0, 0.5); put(pad(G, 2.7, 0.4, 0.8, 1600), 24.0, 0.14, 0, 0.6)
put(lp(bass(31 + 12, 1.6), 400), 24.0, 0.42, 0, 0); put(kick(1.2), 24.0, 0.55, 0, 0.05)
for ts, pn, m in ((24.6, -0.3, 62), (25.8, 0.3, 66)):
    put(click(), ts, 0.3, pn, 0.1); put(whoosh(1.0, 120, 7000, 0.5, 0.8), ts - 0.02, 0.36, pn, 0.35); put(thump(50, 0.25), ts + 0.42, 0.36, 0, 0.15)
    put(keys([m - 12, m, m + 4, m + 7, m + 11], 1.6, 0.9, 1.1), ts + 0.42, 0.2, -pn, 0.5)
for e in range(8): put(shaker(0.03), 24.0 + e * 0.6 + 0.3, 0.04, 0.35, 0.2)
put(keys(A, 2.5, 1.5, 0.9), 26.4, 0.22, 0, 0.5); put(pad(A, 2.8, 0.8, 0.5, 1900), 26.2, 0.16, 0, 0.6)
put(lp(bass(33, 1.8), 400), 26.4, 0.4, 0, 0)
put(riser(1.9, 57), 26.95, 0.15, 0, 0.5); put(whoosh(2.0, 150, 3500, 0.75, 1.1), 26.95, 0.18, 0.1, 0.4)

# ── ink: bring your own agents (quiet) ──
put(thump(40, 0.7), 28.8, 0.6, 0, 0.35); put(whoosh(1.3, 80, 1500, 0.2, 1.2), 28.75, 0.2, 0, 0.5)
put(pad([47, 54, 59, 62], 3.9, 1.0, 1.2, 1100), 28.9, 0.2, 0, 0.7)
put(mallet(74, 2.0, 0.8, 0.5), 29.3, 0.16, -0.2, 0.7); put(mallet(78, 2.0, 0.8, 0.5), 29.9, 0.13, 0.2, 0.7)
roll = lp(rng.standard_normal(int(2.0 * SR)), 260, 2) * np.hanning(int(2.0 * SR)) ** 0.7
put(roll, 29.5, 0.5, 0.3, 0.2)
scale = [62, 66, 69, 71, 74, 78, 81, 83, 86, 90]
for i in range(10):
    ts = 29.55 + i * 0.075 + 1.02
    put(mallet(scale[i], 0.9, 0.22, 0.7), ts, 0.1, 0.6 - i * 0.13, 0.6); put(tick(1300, 0.01), ts, 0.05, 0.6 - i * 0.13, 0.2)
for i in range(10): put(mallet(scale[i] + 12, 0.5, 0.1, 0.4), 31.35 + i * 0.05 + 0.18, 0.05, -0.6 + i * 0.13, 0.6)
put(pad([43, 50, 59, 62, 66], 1.9, 0.7, 0.5, 1500), 30.9, 0.16, 0, 0.7)
put(riser(1.25, 57), 31.2, 0.14, 0, 0.5)

# ── the mark: the tab falls once more, and finds its body ──
put(thump(44, 0.6), 32.4, 0.5, 0, 0.3); put(whoosh(1.2, 200, 6000, 0.3, 1.0), 32.35, 0.22, 0, 0.5)
put(pad([50, 57, 62, 66], 6.4, 0.9, 3.2, 1700), 32.4, 0.2, 0, 0.7)
put(fall(0.7), 32.9, 0.16, 0, 0.3)
put(thump(64, 0.2), 33.6, 0.55, 0, 0.12); put(mallet(62, 2.4, 0.7, 0.7), 33.6, 0.36, 0, 0.5); put(mallet(50, 2.6, 1.0, 0.3), 33.6, 0.34, 0, 0.3)
put(mallet(69, 1.6, 0.4, 0.9), 33.72, 0.3, 0.1, 0.5); put(mallet(74, 1.6, 0.4, 0.9), 33.84, 0.24, -0.1, 0.5)
put(tick(2600, 0.012), 34.22, 0.16, 0, 0.3); put(mallet(86, 0.7, 0.16, 0.6), 34.22, 0.13, 0, 0.6)
put(whoosh(0.9, 400, 6000, 0.4, 0.6), 34.5, 0.14, 0.3, 0.4)
put(keys([38, 50, 57, 62, 66, 69, 76], 4.4, 2.6, 1.1), 34.8, 0.42, 0, 0.6); put(lp(bass(38, 3.0), 300), 34.8, 0.42, 0, 0); put(kick(1.3), 34.8, 0.5, 0, 0.1)
for k, m in enumerate([74, 78, 81, 86]): put(mallet(m, 1.6, 0.5, 0.6), 35.4 + k * 0.15, 0.11, -0.3 + k * 0.2, 0.7)
put(mallet(90, 1.8, 0.6, 0.5), 36.15, 0.09, 0.2, 0.8)
for ts in (37.15, 37.45): put(tick(2400, 0.01), ts + 0.08, 0.11, -0.25, 0.3)
put(mallet(74, 1.6, 0.6, 0.4), 37.6, 0.07, 0, 0.8)

# ── room: one plate reverb for everything ──
n_ir = int(2.4 * SR); t_ir = np.arange(n_ir) / SR
verb = np.zeros((2, N))
for ch in range(2):
    ir = rng.standard_normal(n_ir) * np.exp(-t_ir / 0.55) * np.minimum(t_ir / 0.012, 1)
    ir = hp(lp(ir, 5200), 220)
    verb[ch] = fftconvolve(wet[ch], ir)[:N] * 0.022
mixd = dry + verb
mixd = hp(mixd, 28)
mixd[:, : int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
fade = int(1.3 * SR); mixd[:, -fade:] *= np.linspace(1, 0, fade) ** 1.5
mixd = np.tanh(mixd * 1.5) / np.tanh(1.5)
mixd *= 0.89 / np.max(np.abs(mixd))
os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"), exist_ok=True)
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "score.wav")
with wave.open(path, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mixd.T * 32767).astype("<i2").tobytes())
rms = 20 * np.log10(np.sqrt(np.mean(mixd ** 2)))
print(f"wrote {path}  rms {rms:.1f} dBFS")
