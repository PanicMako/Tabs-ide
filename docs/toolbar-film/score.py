"""Original score and sound design for the Tabs toolbar film ("Play it"), synthesised from scratch and cut to picture.
   python3 score.py  →  out/score.wav      (numpy + scipy)
   120 BPM, D major pentatonic. Every tool on the toolbar owns one note, so pressing keys plays the tune."""
import os, wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR, DUR = 48000, 51.5
PRO = 8.0          # the prologue; everything written below it is shifted by this much
N = int(SR * DUR)
rng = np.random.default_rng(11)
dry = np.zeros((2, N)); wet = np.zeros((2, N))
BEAT, BAR = 0.5, 2.0
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
tt = lambda d: np.arange(int(d * SR)) / SR
lp = lambda x, f, o=2: sosfilt(butter(o, f, "low", fs=SR, output="sos"), x)
hp = lambda x, f, o=2: sosfilt(butter(o, f, "high", fs=SR, output="sos"), x)
bp = lambda x, a, b: sosfilt(butter(2, [a, b], "band", fs=SR, output="sos"), x)

def put(sig, t, gain=1.0, pan=0.0, send=0.0, raw=False):
    if not raw: t += PRO
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


# ── harmony + the keyboard: one note per tool ──
D, Bm, G, A = [50, 57, 62, 66, 69], [47, 54, 62, 66, 69], [43, 55, 59, 62, 66], [45, 57, 61, 64, 69]
NOTE = dict(code=62, agents=66, dock=69, git=71, browser=74, testing=76, figma=78, vercel=81, claude=83, codex=86)

def key(tool, t, gain=1.0, pan=0.0, low=True):
    """a key press: the tool's note, a soft click, a little weight underneath"""
    m = NOTE[tool]
    put(mallet(m, 1.6, 0.42, 0.9), t, 0.34 * gain, pan, 0.55); put(mallet(m + 12, 0.9, 0.2, 0.5), t, 0.1 * gain, -pan, 0.6)
    put(tick(1700 + m * 8, 0.01), t, 0.14 * gain, pan, 0.15)
    if low: put(thump(70 + (m - 62) * 1.5, 0.09), t, 0.26 * gain, pan * 0.5, 0.08)

def hat(d=0.022):
    t = tt(0.1); return hp(rng.standard_normal(len(t)), 7000) * np.exp(-t / d) * np.minimum(t / 0.002, 1)
def clap():
    t = tt(0.22); n = bp(rng.standard_normal(len(t)), 900, 4200)
    env = sum(np.exp(-np.maximum(t - d, 0) / 0.018) * (t >= d) for d in (0, 0.011, 0.023)) * 0.5 + np.exp(-t / 0.07) * 0.35
    return n * env


# ── prologue: too many windows; the mascot tidies them ──
def R(sig, t, *a): put(sig, t, *a, raw=True)
R(pad([38, 45, 51], 5.2, 1.5, 1.2, 500), 0.0, 0.2, 0, 0.6)                       # low, slightly uneasy
clutter = [(0.5, 61), (1.0, 68), (1.5, 63), (2.0, 70), (2.25, 66), (2.5, 73), (2.75, 65)]
for i, (t0, m) in enumerate(clutter):
    R(mallet(m + 0.3 * (-1) ** i, 0.9, 0.22, 1.2), t0, 0.2, (-1) ** i * 0.6, 0.5); R(thump(120 + 10 * i, 0.06), t0, 0.16, (-1) ** i * 0.6, 0.1); R(tick(1500 + 90 * i, 0.012), t0, 0.1, (-1) ** i * 0.6, 0.2)
hum = bp(rng.standard_normal(int(4.6 * SR)), 180, 900) * np.linspace(0, 1, int(4.6 * SR)) ** 1.6
R(hum, 0.5, 0.05, 0, 0.3)
for t0, f in ((3.3, 150), (3.7, 165), (4.1, 180), (4.5, 200)):                   # hop, hop, hop
    R(thump(f, 0.08), t0, 0.34, -0.5 + (f - 150) / 100, 0.15); R(mallet(50 + (f - 150) // 10, 0.5, 0.12, 0.3), t0, 0.14, -0.4, 0.4)
R(tick(2400, 0.01), 4.72, 0.1, 0, 0.3)
R(whoosh(0.5, 300, 3000, 0.8, 0.5), 4.92, 0.12, 0, 0.3)
scale = [62, 66, 69, 71, 74, 78, 81]                                              # the first notes of the keyboard to come
for i, m in enumerate(scale):
    R(whoosh(0.5, 300, 6000, 0.85, 0.4), 5.0 + i * 0.125, 0.12, 0.6 - i * 0.2, 0.3)
    R(mallet(m, 1.0, 0.3, 0.9), 5.44 + i * 0.125, 0.22, 0.4 - i * 0.13, 0.6); R(thump(80 + 6 * i, 0.06), 5.44 + i * 0.125, 0.16, 0, 0.08)
R(keys([50, 57, 62, 66, 69], 2.6, 1.5, 1.0), 6.5, 0.3, 0, 0.6); R(thump(60, 0.2), 6.5, 0.3, 0, 0.2); R(mallet(86, 1.0, 0.3, 0.6), 6.5, 0.12, 0.2, 0.7)
R(thump(190, 0.07), 6.95, 0.26, 0, 0.15)
R(tick(2400, 0.01), 6.98, 0.09, 0, 0.3)
R(whoosh(0.8, 300, 7000, 0.75, 0.7), 7.2, 0.22, 0, 0.4); R(riser(0.55, 74), 7.3, 0.12, 0, 0.5)

# ── A: six keys in the dark ──
put(pad([38, 50, 57], 5.0, 1.2, 1.6, 600), 0.1, 0.16, 0, 0.6)
put(whoosh(1.2, 100, 1800, 0.7, 1.2), 0.0, 0.1, 0, 0.5)
for i, tool in enumerate(["code", "agents", "dock", "git", "browser", "testing"]):
    key(tool, 1.0 + i * 0.5, 1.0, -0.5 + i * 0.2)
    if i: put(whoosh(0.45, 400, 4500, 0.5, 0.4), 0.72 + i * 0.5, 0.05, -0.5 + i * 0.2, 0.3)
put(whoosh(1.5, 150, 5000, 0.6, 1.0), 3.7, 0.2, 0, 0.5)
put(thump(46, 0.45), 4.25, 0.5, 0, 0.3); put(keys([50, 57, 62, 66, 69, 76], 3.2, 1.8, 1.0), 4.25, 0.34, 0, 0.6); put(pad(D, 3.9, 0.5, 1.2, 1500), 4.2, 0.16, 0, 0.7)
put(mallet(88, 0.8, 0.2, 0.6), 6.0, 0.14, 0.5, 0.7); put(tick(2600, 0.012), 6.0, 0.12, 0.5, 0.3)
put(keys([43, 55, 59, 62, 66, 74], 2.4, 1.4, 1.0), 6.15, 0.28, 0, 0.6)
for e in range(16): put(hat(0.02 if e % 2 else 0.012), 4.25 + e * 0.25, 0.02 + 0.0018 * e, 0.3, 0.2)

# ── B: add your own (a URL, a URL, a command, a command) ──
ADDS = [(8.2, 10.0, "figma", 5, Bm), (10.75, 12.5, "vercel", 6, G), (13.6, 15.5, "claude", 11, D), (16.05, 17.5, "codex", 5, A)]
put(whoosh(1.3, 200, 4000, 0.6, 0.9), 7.7, 0.16, 0.2, 0.4)
for ts, tn, tool, nlen, ch in ADDS:
    put(whoosh(0.5, 500, 5000, 0.4, 0.5), ts - 0.05, 0.08, 0.3, 0.4); put(mallet(81, 0.5, 0.12, 0.5), ts, 0.07, 0.3, 0.6)
    n = int((tn - ts - 0.9) * 22)
    for k in range(n): put(tick(2000 + rng.uniform(-250, 350)), ts + 0.28 + k * (tn - ts - 0.95) / n + rng.uniform(-0.006, 0.006), 0.06, 0.25, 0.08)
    put(click(), tn - 0.6, 0.3, 0.3, 0.1)
    put(whoosh(0.5, 300, 7000, 0.7, 0.5), tn - 0.45, 0.2, 0.2, 0.3)
    key(tool, tn, 1.15, 0.25); put(kick(1.1), tn, 0.6, 0, 0.05)
    put(keys(ch, 2.4, 1.3, 1.0), tn, 0.26, -0.1, 0.5); put(lp(bass(ch[0] - 12 if ch[0] > 45 else ch[0], 0.9), 450), tn, 0.45, 0, 0)
for b in range(6):
    t0 = 8.0 + b * 2
    put(pad([Bm, G, D, A, Bm, G][b][1:4], 2.2, 0.5, 0.5, 1300), t0, 0.1, 0, 0.6)
    for e in range(8): put(hat(0.02 if e % 2 else 0.012), t0 + e * 0.25, 0.04 if e % 2 else 0.022, 0.3, 0.2)
    put(kick(), t0, 0.42, 0, 0.03); put(kick(0.8), t0 + 1.25, 0.25, 0, 0.03)
# ten keys, played in one run
for i, tool in enumerate(["code", "agents", "dock", "git", "browser", "testing", "figma", "vercel", "claude", "codex"]): key(tool, 18.5 + i * 0.1, 0.8, -0.7 + i * 0.155, low=False)
put(riser(1.5, 62), 18.5, 0.16, 0, 0.5); put(whoosh(1.6, 150, 6000, 0.8, 1.0), 18.45, 0.2, 0, 0.4)
put(keys([50, 57, 62, 66, 69], 1.2, 0.8, 1.0), 19.5, 0.0, 0, 0.5)

# ── C: play it — the groove, one pane per key ──
put(thump(44, 0.5), 20.0, 0.55, 0, 0.25)
prog = [D, Bm, G, A, D, G]
for b, ch in enumerate(prog):
    t0 = 20.0 + b * 2
    put(keys(ch, 2.1, 1.1, 1.0), t0, 0.24, -0.1, 0.4); put(keys([n + 12 for n in ch[2:]], 0.9, 0.5, 0.6), t0 + 1.25, 0.1, 0.25, 0.5)
    put(pad(ch[1:4], 2.2, 0.3, 0.4, 1600), t0, 0.1, 0, 0.6)
    root = ch[0] - 12 if ch[0] > 45 else ch[0]
    for bt, d, up in ((0, 0.4, 0), (0.75, 0.2, 0), (1.5, 0.3, 12), (2, 0.4, 0), (2.75, 0.2, 7), (3.5, 0.22, 12)): put(lp(bass(root + up, d), 520), t0 + bt * BEAT, 0.46, 0, 0)
    for bt in range(4): put(kick(), t0 + bt * BEAT, 0.6, 0, 0.03); put(hat(0.03), t0 + bt * BEAT + 0.25, 0.07, 0.3, 0.2)
    for bt in (1, 3): put(clap(), t0 + bt * BEAT, 0.16, -0.1, 0.35)
    for e in range(8): put(hat(0.012), t0 + e * 0.25 + 0.125, 0.02, -0.3, 0.2)
for t0, tool in [(20, "code"), (22, "claude"), (24, "figma"), (26, "dock"), (27, "browser"), (28, "vercel"), (29, "agents"), (30, "git"), (31, "code")]:
    key(tool, t0, 1.0, 0.2 if NOTE[tool] > 74 else -0.2, low=False); put(click(), t0, 0.2, 0, 0.1)
    if t0 > 20: put(whoosh(0.35, 500, 6000, 0.5, 0.4), t0 - 0.06, 0.12, 0, 0.3)
for k in range(30): put(tick(2100 + rng.uniform(-200, 300), 0.005), 22.33 + k / 46 * 1.6, 0.04, 0.1, 0.08)

# ── D: every project, its own toolbar (the keys flip) ──
for t0, ch, m in ((32, Bm, 86), (34, G, 83), (36, D, 62)):
    for k in range(10): put(tick(1500 + k * 130, 0.006), t0 + k * 0.04, 0.1, -0.6 + k * 0.13, 0.15); put(tick(1300 + k * 130, 0.006), t0 + k * 0.04 + 0.2, 0.07, -0.6 + k * 0.13, 0.15)
    put(whoosh(0.7, 200, 7000, 0.45, 0.7), t0 - 0.05, 0.28, 0, 0.35); put(click(), t0, 0.26, -0.3, 0.1)
    put(kick(1.2), t0, 0.62, 0, 0.05); put(keys(ch, 2.1, 1.4, 1.1), t0 + 0.2, 0.3, 0, 0.5); put(mallet(m, 1.4, 0.4, 0.9), t0 + 0.2, 0.24, 0.2, 0.6)
    root = ch[0] - 12 if ch[0] > 45 else ch[0]
    put(lp(bass(root, 0.8), 450), t0 + 0.2, 0.46, 0, 0); put(lp(bass(root, 0.35), 450), t0 + 1.25, 0.4, 0, 0)
    put(pad(ch[1:4], 2.2, 0.3, 0.4, 1500), t0, 0.11, 0, 0.6)
    for bt in (1, 2, 3): put(kick(0.9), t0 + bt * BEAT, 0.45, 0, 0.03)
    put(clap(), t0 + 1.5, 0.14, -0.1, 0.35)
    for e in range(8): put(hat(0.02 if e % 2 else 0.012), t0 + e * 0.25, 0.045 if e % 2 else 0.022, 0.3, 0.2)
# camera climbs to the project tabs, and comes back
put(whoosh(1.0, 200, 5000, 0.6, 0.9), 30.85, 0.18, -0.2, 0.4); put(mallet(86, 1.0, 0.3, 0.6), 31.1, 0.12, -0.3, 0.7); put(mallet(90, 1.0, 0.3, 0.6), 31.35, 0.1, -0.1, 0.7)
put(whoosh(0.9, 200, 5000, 0.5, 0.9), 35.15, 0.16, 0.2, 0.4)
# quick actions cameo
for k in range(3): put(click(), 36.5 + k * 0.06, 0.18, -0.2 + k * 0.2, 0.1)
for k, m in enumerate([74, 78, 81, 86, 90, 93]): put(mallet(m, 0.7, 0.16, 0.7), 36.56 + k * 0.04, 0.09, -0.5 + k * 0.2, 0.6)
for k, m in enumerate([86, 88, 90]): put(mallet(m, 0.5, 0.12, 0.6), 37.0 + k * 0.25, 0.11, 0, 0.5); put(tick(1800, 0.008), 37.0 + k * 0.25, 0.08, 0, 0.15)

# ── E: dive into the key; the mark ──
put(riser(0.95, 62), 37.95, 0.2, 0, 0.5); put(whoosh(1.1, 120, 8000, 0.85, 0.8), 37.9, 0.34, 0, 0.4)
put(thump(42, 0.7), 38.9, 0.62, 0, 0.3); put(kick(1.4), 38.9, 0.55, 0, 0.1)
put(keys([38, 50, 57, 62, 66, 69, 76], 4.6, 2.8, 1.1), 38.9, 0.44, 0, 0.6); put(lp(bass(38, 3.2), 300), 38.9, 0.44, 0, 0)
put(pad([50, 57, 62, 66], 4.4, 0.6, 2.6, 1700), 38.9, 0.18, 0, 0.7)
put(mallet(74, 1.6, 0.5, 0.9), 38.9, 0.26, 0, 0.5); put(mallet(81, 1.4, 0.4, 0.8), 39.02, 0.2, 0.1, 0.5)
put(tick(2600, 0.012), 39.37, 0.15, 0, 0.3); put(mallet(86, 0.7, 0.16, 0.6), 39.37, 0.12, 0, 0.6)
put(whoosh(0.85, 400, 6000, 0.4, 0.6), 39.85, 0.14, 0.3, 0.4)
for k, m in enumerate([74, 78, 81, 86, 90]): put(mallet(m, 1.6, 0.5, 0.6), 40.5 + k * 0.125, 0.1, -0.3 + k * 0.15, 0.7)
for ts in (42.1, 42.4): put(tick(2400, 0.01), ts + 0.08, 0.11, -0.25, 0.3)
put(mallet(74, 1.6, 0.6, 0.4), 42.55, 0.07, 0, 0.8)

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
