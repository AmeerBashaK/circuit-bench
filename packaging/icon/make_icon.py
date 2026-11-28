# App icon in the Monohud look: black tile, chamfered white frame, a zigzag resistor between two glowing nodes.
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))

S = 1024
def icon(size=S):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = 150  # chamfer
    tile = [(c, 40), (S - 40, 40), (S - 40, S - c), (S - c, S - 40), (40, S - 40), (40, c)]
    d.polygon(tile, fill=(8, 8, 9, 255))
    d.line(tile + [tile[0]], fill=(235, 238, 242, 255), width=22, joint='curve')
    # lead, zigzag, lead
    y = S // 2
    pts = [(200, y), (330, y)]
    x, up = 330, True
    for _ in range(6):
        x += 61; pts.append((x, y - 95 if up else y + 95)); up = not up
    pts += [(x + 30, y), (S - 200, y)]
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.line(pts, fill=(170, 220, 255, 255), width=60, joint='curve')
    for px in (200, S - 200):
        g.ellipse([px - 70, y - 70, px + 70, y + 70], fill=(170, 220, 255, 255))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(34)))
    d = ImageDraw.Draw(img)
    d.line(pts, fill=(245, 248, 252, 255), width=30, joint='curve')
    for px in (200, S - 200):
        d.ellipse([px - 44, y - 44, px + 44, y + 44], fill=(245, 248, 252, 255))
    # HUD tick marks in the corners
    for (x0, y0, dx, dy) in [(110, 230, 1, 0), (S - 110, 230, -1, 0), (110, S - 230, 1, 0), (S - 110, S - 230, -1, 0)]:
        d.line([(x0, y0), (x0 + dx * 70, y0)], fill=(120, 126, 136, 255), width=12)
    return img.resize((size, size), Image.LANCZOS) if size != S else img

base = icon()
base.save(os.path.join(HERE, 'icon.png'))
base.save(os.path.join(HERE, 'icon.ico'), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print('ok')
