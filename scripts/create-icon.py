from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

root = Path(__file__).resolve().parent.parent
(root / 'assets').mkdir(exist_ok=True)
im = Image.new('RGBA', (1024, 1024))
d = ImageDraw.Draw(im)
d.rounded_rectangle((32, 32, 992, 992), radius=235, fill='#7660dc')
# NZIP's independent geometric N, with a subtle zipper motif.
d.polygon([(260, 747), (260, 277), (392, 277), (638, 600), (638, 277), (764, 277), (764, 747), (634, 747), (386, 424), (386, 747)], fill='white')
for y in (114, 170, 805, 861):
    d.rounded_rectangle((476, y, 548, y + 35), radius=7, fill='#c8bcf3')
im.resize((256, 256), Image.Resampling.LANCZOS).save(root / 'src/ui/icon.png')
im.save(root / 'assets/icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('Created NZIP icon')
