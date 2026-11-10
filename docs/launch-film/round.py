"""Rounded corners for README media: animated WebP clips from frame folders, and still screenshots.
   python3 round.py clip <frames_dir> <out.webp> | python3 round.py still <in.png> <out.png> [width]"""
import sys, glob
from PIL import Image, ImageDraw

def mask(size, radius):
    big = Image.new("L", (size[0] * 4, size[1] * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle([0, 0, big.width - 1, big.height - 1], radius * 4, fill=255)
    return big.resize(size, Image.LANCZOS)

mode, src, dst = sys.argv[1:4]
if mode == "clip":
    frames = [Image.open(f).convert("RGBA") for f in sorted(glob.glob(src + "/*.png"))]
    m = mask(frames[0].size, 26)
    for f in frames: f.putalpha(m)
    frames[0].save(dst, save_all=True, append_images=frames[1:], duration=67, loop=0, quality=80, method=4)
else:
    im = Image.open(src).convert("RGBA")
    w = int(sys.argv[4]) if len(sys.argv) > 4 else im.width
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.putalpha(mask(im.size, 28))
    im.save(dst, optimize=True)
print("wrote", dst)
