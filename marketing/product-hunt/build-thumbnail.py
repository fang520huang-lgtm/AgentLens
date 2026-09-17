"""Build a square Product Hunt thumbnail from AgentLens's code-native brand mark."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
SIZE = 512
BASE = (11, 16, 21)
LIME = (183, 237, 121)
WHITE = (232, 241, 231)

image = Image.new("RGB", (SIZE, SIZE), BASE)
draw = ImageDraw.Draw(image)
for y in range(SIZE):
    shade = int(7 * y / SIZE)
    draw.line((0, y, SIZE, y), fill=(BASE[0] + shade, BASE[1] + shade, BASE[2] + shade))

glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
glow_draw.ellipse((110, 22, 402, 314), fill=(*LIME, 80))
glow = glow.filter(ImageFilter.GaussianBlur(64))
image = Image.alpha_composite(image.convert("RGBA"), glow)

mark = Image.new("RGBA", (220, 220), (0, 0, 0, 0))
mark_draw = ImageDraw.Draw(mark)
mark_draw.rounded_rectangle((22, 22, 198, 198), radius=40, outline=(*LIME, 255), width=15)
for y, width in ((70, 90), (109, 63), (148, 35)):
    mark_draw.rounded_rectangle((62, y, 62 + width, y + 13), radius=6, fill=(*LIME, 255))
mark = mark.rotate(8, resample=Image.Resampling.BICUBIC, expand=True)
image.alpha_composite(mark, ((SIZE - mark.width) // 2, 62))

draw = ImageDraw.Draw(image)
font_file = Path(r"C:\Windows\Fonts\arialbd.ttf")
mono_file = Path(r"C:\Windows\Fonts\consolab.ttf")
font = ImageFont.truetype(str(font_file) if font_file.exists() else "DejaVuSans-Bold.ttf", 62)
mono = ImageFont.truetype(str(mono_file) if mono_file.exists() else "DejaVuSansMono-Bold.ttf", 24)
left = draw.textbbox((0, 0), "agent", font=font)[2]
right = draw.textbbox((0, 0), "lens", font=font)[2]
start = (SIZE - left - right) // 2
draw.text((start, 356), "agent", font=font, fill=WHITE)
draw.text((start + left, 356), "lens", font=font, fill=LIME)
draw.text((SIZE // 2, 437), "REPLAY", font=mono, fill=(118, 145, 132), anchor="mm", stroke_width=0)

image.convert("RGB").save(HERE / "thumbnail.png", optimize=True)
