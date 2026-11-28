# Writes the Circuit Bench launcher icons into the Capacitor Android project (run after `npx cap add android`).
# Needs Pillow: pip install pillow
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
src = Image.open(os.path.join(HERE, '..', 'icon', 'icon.png')).convert('RGBA')
res = os.path.join(HERE, 'android', 'app', 'src', 'main', 'res')
for d, s in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    for n in ('ic_launcher.png', 'ic_launcher_round.png'):
        src.resize((s, s), Image.LANCZOS).save(os.path.join(res, f'mipmap-{d}', n))
    # Adaptive icon foreground: a 108 dp canvas with the artwork inside the 66 dp safe zone.
    f = round(s * 108 / 48)
    fg = Image.new('RGBA', (f, f), (0, 0, 0, 0))
    a = round(f * 0.70)
    fg.paste(src.resize((a, a), Image.LANCZOS), ((f - a) // 2, (f - a) // 2))
    fg.save(os.path.join(res, f'mipmap-{d}', 'ic_launcher_foreground.png'))
with open(os.path.join(res, 'values', 'ic_launcher_background.xml'), 'w') as fh:
    fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#050505</color>\n</resources>\n')
print('Launcher icons written.')
