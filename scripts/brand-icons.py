"""Rebuild committed PNG/ICO companions of public/logo.svg (requires Pillow).

The small mark intentionally uses simple solid shapes, with no font dependency.
Run from any directory: python scripts/brand-icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
scale = 16
im = Image.new('RGBA', (64 * scale, 64 * scale))
d = ImageDraw.Draw(im)
blue = '#0969DA'
def box(coords):
    return tuple(round(v * scale) for v in coords)
d.rounded_rectangle(box((0, 0, 64, 64)), radius=14 * scale, fill=blue)
d.rounded_rectangle(box((16, 10, 48, 54)), radius=4 * scale, fill='white')
d.polygon([box(p) for p in [(36, 10), (48, 10), (48, 22)]], fill=blue)
d.polygon([box(p) for p in [(36, 10), (36, 22), (48, 22)]], fill='#B6DEFF')
for y in (23, 33, 43):
    d.ellipse(box((19.5, y - 2.5, 24.5, y + 2.5)), fill=blue)
for y, end in ((30, 40), (37, 40), (44, 37)):
    d.line([box((30, y)), box((end, y))], fill=blue, width=3 * scale)
    for x in (30, end):
        d.ellipse(box((x - 1.5, y - 1.5, x + 1.5, y + 1.5)), fill=blue)
public = root / 'public'
im.resize((512, 512), Image.Resampling.LANCZOS).save(public / 'logo.png')
im.resize((180, 180), Image.Resampling.LANCZOS).save(public / 'apple-touch-icon.png')
im.resize((48, 48), Image.Resampling.LANCZOS).save(public / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('Generated logo.png (512), apple-touch-icon.png (180), favicon.ico (16/32/48)')
