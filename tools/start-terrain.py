# 對外網站首屏的地面：灰白色、一層一層的岩石（做成俯視貼圖，CSS 再用透視倒下去）
import numpy as np
from PIL import Image, ImageFilter
rng = np.random.default_rng(7)
W, H = 2400, 1200
def octave(scale):
    g = rng.random((max(2, H // scale), max(2, W // scale))).astype(np.float32)
    return np.asarray(Image.fromarray(g).resize((W, H), Image.BICUBIC), dtype=np.float32)
def fbm(scales, gains):
    return sum(octave(s) * g for s, g in zip(scales, gains)) / sum(gains)
base = fbm([600, 300, 150, 75], [1, .55, .3, .15])
warp = fbm([200, 90, 40], [1, .5, .25])
fine = fbm([24, 10, 5, 2], [1, .7, .5, .35])
y = np.linspace(0, 1, H, dtype=np.float32)[:, None]
# 一層一層的岩層：沿著高度起伏的等高線
strata = np.sin((y * 24 + base * 7 + warp * 1.4) * np.pi * 2)
ridge = 1 - np.abs(strata) ** .35
mounds = fbm([900, 450, 220], [1, .5, .25])
h = mounds * 4.2 + base * .6 + ridge * .035 + fine * .025
# 光從左上照下來（hillshade）
gy, gx = np.gradient(h)
gx *= 140; gy *= 140
lx, ly, lz = -.55, -.65, .52
n = np.sqrt(gx ** 2 + gy ** 2 + 1)
shade = (-gx * lx - gy * ly + lz) / n
shade = np.clip(shade, 0, 1)
tone = .42 + .58 * shade
tone *= .82 + .18 * (fine - fine.min()) / (np.ptp(fine) + 1e-6)
tone += (ridge - .5) * .06
tone = np.clip(tone, 0, 1) ** 1.15
img = Image.fromarray((tone * 225 + 12).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(.6))
import sys, os
out = sys.argv[1] if len(sys.argv) > 1 else "public/start"
img.save(os.path.join(out, "terrain.webp"), "WEBP", quality=72, method=6)
img.resize((1200, 600), Image.LANCZOS).save(os.path.join(out, "terrain-sm.webp"), "WEBP", quality=70, method=6)
print("ok")
