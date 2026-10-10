# 產生教學影片要用的示範媒體：一支 62 分鐘的「K 線回放」直播錄影（webm）＋六張封面
import random, subprocess, sys, math
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
FPS = 2
DUR = 3720
BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BLACK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc"
F = lambda p, s: ImageFont.truetype(p, s, index=3)
BG = (14, 19, 17); GRID = (30, 40, 36); INK = (221, 227, 224); INK3 = (134, 147, 141)
UP = (201, 102, 93); DOWN = (95, 162, 133); AMBER = (205, 164, 94)

def make_candles(seed, n, ticks):
    rnd = random.Random(seed)
    price = 20150.0
    out = []
    drift = 0
    for i in range(n):
        if i % 40 == 0: drift = rnd.uniform(-0.6, 0.6)
        path = [price]
        for _ in range(ticks):
            price += rnd.gauss(drift, 3.2)
            path.append(price)
        out.append(path)
    return out

def draw_chart(d, candles, upto, frac, box, ticks, show=72):
    x0, y0, x1, y1 = box
    start = max(0, upto - show + 1)
    vis = []
    for i in range(start, upto + 1):
        path = candles[i]
        if i == upto:
            k = max(1, int(round(frac * ticks)))
            path = path[: k + 1]
        vis.append((path[0], max(path), min(path), path[-1]))
    hi = max(v[1] for v in vis) + 8; lo = min(v[2] for v in vis) - 8
    Y = lambda p: y1 - (p - lo) / (hi - lo) * (y1 - y0)
    # 格線與價格
    step = 25
    p = math.ceil(lo / step) * step
    fs = F(REG, 15)
    while p < hi:
        y = Y(p)
        d.line([(x0, y), (x1, y)], fill=GRID, width=1)
        d.text((x1 + 10, y - 10), f"{p:,.0f}", font=fs, fill=INK3)
        p += step
    cw = (x1 - x0) / show
    # 開盤區間（前 30 根）
    if start <= 30:
        orh = max(max(c) for c in candles[:30]); orl = min(min(c) for c in candles[:30])
        for lv in (orh, orl):
            d.line([(x0, Y(lv)), (x1, Y(lv))], fill=AMBER, width=1)
    for j, (o, h, l, c) in enumerate(vis):
        cx = x0 + (j + 0.5) * cw
        col = UP if c >= o else DOWN
        d.line([(cx, Y(h)), (cx, Y(l))], fill=col, width=2)
        top, bot = sorted((Y(o), Y(c)))
        d.rectangle([cx - cw * 0.34, top, cx + cw * 0.34, max(bot, top + 1)], fill=col)
    last = vis[-1][3]
    y = Y(last)
    d.line([(x0, y), (x1, y)], fill=(70, 80, 76), width=1)
    d.rectangle([x1 + 4, y - 12, x1 + 84, y + 12], fill=UP if last >= vis[-1][0] else DOWN)
    d.text((x1 + 10, y - 10), f"{last:,.2f}", font=F(BOLD, 15), fill=(16, 18, 17))

def video():
    ticks = 10 * FPS  # 每 10 秒一根
    n = DUR // 10 + 1
    candles = make_candles(7, n, ticks)
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "300k", "-g", str(FPS * 10), "-pix_fmt", "yuv420p",
                           "media/live.webm"], stdin=subprocess.PIPE)
    ft, fs, fb = F(BOLD, 22), F(REG, 17), F(BOLD, 17)
    for f in range(DUR * FPS):
        t = f / FPS
        im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im)
        d.text((36, 26), "NQ 期貨　1 分 K 回放", font=ft, fill=INK)
        d.text((36, 60), "CME · 美東 09:30 開盤", font=fs, fill=INK3)
        hh, mm, ss = int(t // 3600), int(t % 3600 // 60), int(t % 60)
        d.ellipse([W - 240, 36, W - 228, 48], fill=UP)
        d.text((W - 220, 28), f"直播錄影　{hh:02d}:{mm:02d}:{ss:02d}", font=fb, fill=INK)
        draw_chart(d, candles, int(t // 10), (t % 10) / 10, (36, 110, W - 120, H - 70), ticks)
        d.text((36, H - 46), "CCC 交易實驗室", font=fb, fill=AMBER)
        ff.stdin.write(im.tobytes())
        if f % 600 == 0: print("frame", f, file=sys.stderr)
    ff.stdin.close(); ff.wait()

def thumbs():
    items = [("t1", "本週盤勢\n紀律檢討", "CCC・OC", 11), ("t2", "NQ 開盤區間\n怎麼看", "OC", 22), ("t3", "停損\n設在哪裡", "X", 33),
             ("t4", "研究員 Q&A", "CCC・X・OC", 44), ("t5", "資金控管\n每筆風險怎麼抓", "CCC", 55), ("t6", "交易日誌\n怎麼寫", "X", 66), ("t7", "10/16 直播", "CCC", 77)]
    for name, title, host, seed in items:
        ticks = 20
        candles = make_candles(seed, 80, ticks)
        im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im)
        draw_chart(d, candles, 79, 1, (420, 70, W - 110, H - 70), ticks)
        # 左邊漸層壓暗，放標題
        ov = Image.new("RGBA", (W, H)); od = ImageDraw.Draw(ov)
        for x in range(0, 760):
            a = int(255 * max(0, min(1, 1.25 - x / 640)))
            od.line([(x, 0), (x, H)], fill=(14, 19, 17, a))
        im = Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB"); d = ImageDraw.Draw(im)
        d.rounded_rectangle([64, 78, 64 + d.textlength(host, font=F(BOLD, 30)) + 36, 128], radius=25, fill=AMBER)
        d.text((82, 80), host, font=F(BOLD, 30), fill=(22, 18, 10))
        d.multiline_text((64, 170), title, font=F(BLACK, 92), fill=INK, spacing=18)
        d.text((64, H - 90), "CCC 交易實驗室", font=F(BOLD, 30), fill=AMBER)
        im.save(f"media/{name}.jpg", quality=86)

def course_thumbs():
    items = [("c1", "交易計畫\n怎麼寫", "CCC・課程 1", 101), ("c2", "看懂\n市場結構", "X・課程 1", 102), ("c3", "開盤前的\n準備", "OC・課程 1", 103),
             ("c4", "部位大小\n怎麼算", "CCC・課程 2", 104), ("c5", "流動性與\n假突破", "X・課程 2", 105)]
    for name, title, host, seed in items:
        candles = make_candles(seed, 80, 20)
        im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im)
        draw_chart(d, candles, 79, 1, (420, 70, W - 110, H - 70), 20)
        ov = Image.new("RGBA", (W, H)); od = ImageDraw.Draw(ov)
        for x in range(760):
            a = int(255 * max(0, min(1, 1.25 - x / 640)))
            od.line([(x, 0), (x, H)], fill=(14, 19, 17, a))
        im = Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB"); d = ImageDraw.Draw(im)
        f = F(BOLD, 30)
        d.rounded_rectangle([64, 78, 64 + d.textlength(host, font=f) + 36, 128], radius=25, outline=AMBER, width=3)
        d.text((82, 80), host, font=f, fill=AMBER)
        d.multiline_text((64, 170), title, font=F(BLACK, 92), fill=INK, spacing=18)
        d.text((64, H - 90), "CCC 交易實驗室・教學課程", font=f, fill=AMBER)
        im.save(f"media/{name}.jpg", quality=86)

def upload_files():
    # 管理員教學裡「上傳」用的檔案：一支影片＋一份講義
    import os, shutil
    os.makedirs("upload", exist_ok=True)
    if os.path.exists("media/live.webm"):
        shutil.copy("media/live.webm", "upload/1010直播.webm")
    with open("upload/10-10 盤勢整理.pdf", "wb") as fh:
        fh.write(b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n" + b" " * 700000)

if __name__ == "__main__":
    import os
    os.makedirs("media", exist_ok=True)
    thumbs()
    course_thumbs()
    if "thumbs" not in sys.argv: video()
    upload_files()
