# 原創配樂：輕鬆的 lo-fi（電鋼琴和弦、貝斯、輕鼓、偶爾的鐘聲旋律），全部用程式合成，沒有版權問題
# 用法：python3 music.py 長度秒數 輸出.wav
import sys
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt

SR = 44100
BPM = 84
BEAT = 60 / BPM
BAR = BEAT * 4
rng = np.random.default_rng(3)

def midi(n): return 440.0 * 2 ** ((n - 69) / 12)

def env(n, a, d, sustain=0.0, rel=None):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * (sustain + (1 - sustain) * np.exp(-t / d))
    if rel:
        r = int(rel * SR)
        if r < n: e[-r:] *= np.linspace(1, 0, r)
    return e

def epiano(freq, dur, vel=0.5):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * 2 * freq * t) * np.exp(-t * 3) + 0.12 * np.sin(2 * np.pi * 3 * freq * t) * np.exp(-t * 6)
    s *= 1 + 0.12 * np.sin(2 * np.pi * 4.2 * t)  # 顫音
    return vel * s * env(n, 0.012, 1.6, 0.25, rel=0.25)

def bell(freq, dur, vel=0.3):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * freq * t + 0.8 * np.sin(2 * np.pi * freq * 3.5 * t) * np.exp(-t * 4))
    return vel * s * env(n, 0.004, 0.7, 0, rel=0.1)

def bass(freq, dur, vel=0.55):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.tanh(1.6 * np.sin(2 * np.pi * freq * t)) * 0.8 + 0.2 * np.sin(4 * np.pi * freq * t)
    return vel * s * env(n, 0.01, 0.9, 0.55, rel=0.08)

def kick(vel=0.9):
    n = int(0.45 * SR); t = np.arange(n) / SR
    f = 48 + 90 * np.exp(-t * 28)
    return vel * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)

def lp(x, fc, order=2):
    return sosfilt(butter(order, fc, "low", fs=SR, output="sos"), x)

def hp(x, fc, order=2):
    return sosfilt(butter(order, fc, "high", fs=SR, output="sos"), x)

def snare(vel=0.32):
    n = int(0.3 * SR); t = np.arange(n) / SR
    noise = lp(hp(rng.standard_normal(n), 1200), 6000)
    return vel * (noise * np.exp(-t * 16) + 0.4 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25))

def hat(vel=0.08):
    n = int(0.08 * SR); t = np.arange(n) / SR
    return vel * hp(rng.standard_normal(n), 7000) * np.exp(-t * 60)

# Dm9 → G13 → Cmaj9 → Am9（一輪 4 小節）
CHORDS = [
    (38, [53, 57, 60, 64]),   # Dm9: F A C E
    (43, [53, 57, 59, 64]),   # G13: F A B E
    (36, [52, 55, 59, 62]),   # Cmaj9: E G B D
    (45, [55, 59, 60, 64]),   # Am9: G B C E
]
PENTA = [69, 72, 74, 76, 79, 81]  # A C D E G A

def render(total):
    n = int((total + 3) * SR)
    mix = {k: np.zeros(n) for k in ("keys", "bass", "drums", "bell")}
    def add(track, sig, at):
        i = int(at * SR); j = min(n, i + len(sig))
        if i < n: mix[track][i:j] += sig[: j - i]
    bars = int(total / BAR) + 2
    swing = BEAT / 2 * 0.12
    for b in range(bars):
        t0 = b * BAR
        root, notes = CHORDS[b % 4]
        sec = b // 8  # 每 8 小節換一段
        intro = b < 2
        # 和弦：第 1 拍和第 3 拍半輕輕再按一次
        for k, nn in enumerate(notes):
            add("keys", epiano(midi(nn), BAR * 0.95, 0.16), t0 + k * 0.012)
            add("keys", epiano(midi(nn), BEAT * 1.4, 0.08), t0 + BEAT * 2.5 + k * 0.01)
        if not intro:
            # 貝斯
            add("bass", bass(midi(root), BEAT * 1.8), t0)
            add("bass", bass(midi(root + (7 if b % 2 else 12)), BEAT * 0.9, 0.4), t0 + BEAT * 2.5)
            add("bass", bass(midi(root), BEAT * 0.9, 0.45), t0 + BEAT * 3.5)
            # 鼓（每 16 小節最後兩小節拿掉一半，留點呼吸）
            breath = b % 16 in (14, 15)
            add("drums", kick(), t0)
            if not breath: add("drums", kick(0.6), t0 + BEAT * 2.5)
            add("drums", snare(), t0 + BEAT)
            add("drums", snare(), t0 + BEAT * 3)
            for e in range(8):
                if breath and e % 2: continue
                add("drums", hat(0.045 if e % 2 else 0.065), t0 + e * BEAT / 2 + (swing if e % 2 else 0))
        # 鐘聲旋律：偶數段落才有，稀疏
        if sec % 2 == 1:
            r = np.random.default_rng(b)
            for e in range(8):
                if r.random() < 0.32:
                    add("bell", bell(midi(PENTA[r.integers(len(PENTA))]), BEAT * 1.2, 0.12), t0 + e * BEAT / 2 + (swing if e % 2 else 0))

    # 混音
    keys = lp(mix["keys"], 3200)
    bassl = lp(mix["bass"], 900)
    drums = lp(mix["drums"], 9000)
    bells = mix["bell"]
    # 簡單殘響
    irn = int(1.6 * SR)
    ir = rng.standard_normal(irn) * np.exp(-np.arange(irn) / SR * 3.2)
    ir = lp(ir, 4000) / np.sqrt(np.sum(ir ** 2))
    wet = fftconvolve(keys * 0.6 + bells, ir)[:n] * 0.22
    # 鼓聲讓位（sidechain 的感覺）：kick 時和弦稍微壓低
    duck = np.ones(n)
    for b in range(bars):
        for at in (0, 2.5):
            i = int((b * BAR + at * BEAT) * SR); m = int(0.25 * SR)
            if i < n: duck[i:i + m] = np.minimum(duck[i:i + m], 0.65 + 0.35 * np.linspace(0, 1, min(m, n - i)))
    out = (keys * duck + bells * 0.9 + wet) * 0.8 + bassl * 0.75 + drums * 0.7
    out = out[: int(total * SR)]
    # 淡入淡出
    fi, fo = int(1.2 * SR), int(3.5 * SR)
    out[:fi] *= np.linspace(0, 1, fi)
    out[-fo:] *= np.linspace(1, 0, fo) ** 1.5
    out = np.tanh(out * 1.2) / 1.2
    out /= np.max(np.abs(out)) + 1e-9
    out *= 0.89
    st = np.stack([out, np.roll(out, int(0.006 * SR)) * 0.97], axis=1)  # 一點點立體感
    return st

if __name__ == "__main__":
    total = float(sys.argv[1]); dst = sys.argv[2]
    import wave
    data = (render(total) * 32767).astype(np.int16)
    with wave.open(dst, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
    print("ok", dst, total)
