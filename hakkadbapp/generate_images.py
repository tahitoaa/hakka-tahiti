from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, csv

font_hakka='C:\WINDOWS\FONTS\SIMKAI.TTF'
font_pinyin="C:\WINDOWS\FONTS\ROBOTO-BLACK.TTF"
font_big = ImageFont.truetype(font_hakka, 200)   # Hakka large
font_py = ImageFont.truetype(font_pinyin, 150)    # Pinyin élégant
font_title = ImageFont.truetype(font_pinyin, 150)    # Pinyin élégant
size=512
out_dir=''

# --- Conversion tonale numérique → diacritiques ---
TONE_MARKS = {
    "a":  "āáǎàa",
    "e":  "ēéěèe",
    "i":  "īíǐìi",
    "o":  "ōóǒòo",
    "u":  "ūúǔùu",
    "ü":  "ǖǘǚǜü",
}

superscript_map = {"1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "":""}

def pinyin_to_diacritics(p):
    """
    Convertit un pinyin avec chiffres (ni3hao3) → diacritiques (nǐhǎo).
    Règle standard : a > e > o > i/u/ü.
    """
    import re
    def replace(m):
        syll = m.group(1)
        tone = int(m.group(2))
        # priorité voyelles
        for v in ["a", "e", "o"]:
            if v in syll:
                return syll.replace(v, TONE_MARKS[v][tone])
        # ensuite i/u/ü (la dernière voyelle)
        for v in ["i", "u", "ü"]:
            idx = syll.rfind(v)
            if idx != -1:
                return syll[:idx] + TONE_MARKS[v][tone] + syll[idx+1:]
        return syll

    return re.sub(r"([a-zü]+)([1-5])", replace, p)

def generate_theme_img(filename, french, hanzi, pinyin, english,
                       size=1024,
                       font_title=font_title,
                       font_hanzi=font_big,
                       font_pinyin=font_py,
                       illustration_path=None):

    # ------------------------------------------------------------
    # COLORS & STYLES
    # ------------------------------------------------------------
    GRADIENT_TOP = (255, 245, 242)
    GRADIENT_BOTTOM = (255, 228, 228)
    TITLE_COLOR = "#BA1111"
    PINYIN_COLOR = "#C23232"
    HANZI_COLOR = "#430808"
    BAND_COLOR = (255, 210, 210, 180)  # translucent soft red

    # ------------------------------------------------------------
    # CANVAS + GRADIENT BACKGROUND
    # ------------------------------------------------------------
    img = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    draw = ImageDraw.Draw(img)

    # vertical soft gradient
    for y in range(size):
        ratio = y / size
        r = int(GRADIENT_TOP[0] * (1 - ratio) + GRADIENT_BOTTOM[0] * ratio)
        g = int(GRADIENT_TOP[1] * (1 - ratio) + GRADIENT_BOTTOM[1] * ratio)
        b = int(GRADIENT_TOP[2] * (1 - ratio) + GRADIENT_BOTTOM[2] * ratio)
        draw.line([(0, y), (size, y)], fill=(r, g, b))

    # ------------------------------------------------------------
    # DESIGN BAND (rounded rectangle with transparency)
    # ------------------------------------------------------------
    # band = Image.new("RGBA", (0, int(size*0.5)), (0, 0, 0, 0))
    # band_draw = ImageDraw.Draw(band)

    # radius = 80
    # band_draw.rounded_rectangle(
    #     [int(size*0.10), int(size*0.18), int(size*0.90), int(size*0.78)],
    #     radius=radius,
    #     fill=BAND_COLOR
    # )
    # img.alpha_composite(band)

    # draw = ImageDraw.Draw(img)

    # ------------------------------------------------------------
    # TITLE
    # ------------------------------------------------------------
    fr = french.strip()
    bbox = draw.textbbox((0, 0), fr, font=font_title)
    w = bbox[2] - bbox[0]
    draw.text(((size - w) / 2, 50), fr, font=font_title, fill=TITLE_COLOR)

    # ------------------------------------------------------------
    # ILLUSTRATION (with drop shadow)
    # ------------------------------------------------------------
    illus_box = (
        int(size * 0.22),
        int(size * 0.25),
        int(size * 0.78),
        int(size * 0.65),
    )

    if illustration_path and os.path.exists(illustration_path):
        illus = Image.open(illustration_path).convert("RGBA")
        illus = illus.resize(
            (illus_box[2] - illus_box[0], illus_box[3] - illus_box[1]),
            Image.LANCZOS
        )

        # shadow
        shadow = Image.new("RGBA", illus.size, (0, 0, 0, 80))
        blur = shadow.filter(ImageFilter.GaussianBlur(16))

        img.paste(blur, (illus_box[0] + 10, illus_box[1] + 10), blur)
        img.paste(illus, illus_box[:2], illus)

    # ------------------------------------------------------------
    # PINYIN (superscript tones)
    # ------------------------------------------------------------
    def map_tones(c):
        return superscript_map.get(c, c)

    sup_pinyin = ''.join(map_tones(c) for c in pinyin)

    bbox_py = draw.textbbox((0, 0), sup_pinyin, font=font_pinyin)
    w_py = bbox_py[2] - bbox_py[0]

    py_y = int(size * 0.3)
    draw.text(((size - w_py) / 2, py_y),
              sup_pinyin, font=font_pinyin, fill=PINYIN_COLOR)

    # ------------------------------------------------------------
    # HANZI
    # ------------------------------------------------------------
    bbox_hz = draw.textbbox((0, 0), hanzi, font=font_hanzi)
    w_hz = bbox_hz[2] - bbox_hz[0]
    h_hz = bbox_hz[3] - bbox_hz[1]

    hanzi_y = py_y + h_hz + 20
    draw.text(((size - w_hz) / 2, hanzi_y),
              hanzi, font=font_hanzi, fill=HANZI_COLOR)

    # ------------------------------------------------------------
    # SAVE
    # ------------------------------------------------------------
    out_path = os.path.join(out_dir, filename + ".png")
    img.save(out_path)
    return out_path


def generate_img(filename, target, fr, size, font_big, font_py, out_dir):
    pinyin_raw, hakka_main = target.split(" ")
    pinyin = pinyin_to_diacritics(pinyin_raw)

    img = Image.new("RGB", (size, size), "white")
    draw = ImageDraw.Draw(img)

    # --- superscripts mapping ---
    SAFE_SUPERSCRIPTS = str.maketrans({
        "0": "⁰","1": "¹","2": "²","3": "³","4": "⁴",
        "5": "⁵","6": "⁶","7": "⁷","8": "⁸","9": "⁹",
    })

    def to_safe_superscripts(s: str) -> str:
        return s.translate(SAFE_SUPERSCRIPTS)

    pinyin_safe = to_safe_superscripts(pinyin)

    # --- design band (red tone, soft) ---
    draw.rectangle([0, size * 0.30, size, size], fill="#ffe5e5")  # soft red-pink

    n = len(hakka_main)

    if n <= 2:
        scale = 1.0          # no change
    elif n == 3:
        scale = 0.6         # slightly smaller
    else:  # n >= 4
        scale = 0.4         # more reduction

    # Create adjusted font
    font_hakka = font_big.font_variant(size=int(font_big.size * scale))
    font_py = font_py.font_variant(size=int(font_py.size * scale))

    # ===============================================================
    # 1. Pinyin on top (centered)
    # ===============================================================
    bbox_py = draw.textbbox((0, 0), pinyin_safe, font=font_py)
    w_py = bbox_py[2] - bbox_py[0]
    h_py = bbox_py[3] - bbox_py[0]

    pinyin_y = int(size * 0.08)   # top margin
    draw.text(
        ((size - w_py) / 2, pinyin_y),
        pinyin_safe,
        font=font_py,
        fill="#aa0000"           # red tone
    )

    # ===============================================================
    # 2. Hakka characters on bottom (centered)
    # ===============================================================
    # Determine shrink factor based on character count

    # Measure text
    bbox_hk = draw.textbbox((0, 0), hakka_main, font=font_hakka)
    w_hk = bbox_hk[2] - bbox_hk[0]
    h_hk = bbox_hk[3] - bbox_hk[1]

    # Vertical placement
    hakka_y = int(size * 0.30)

    # Draw text
    draw.text(
        ((size - w_hk) / 2, hakka_y),
        hakka_main,
        font=font_hakka,
        fill="#880000"
    )

    # --- save ---
    path = os.path.join(out_dir, filename + ".png")
    print("Generating image:", path)
    img.save(path)

    return filename + ".png"

def generate_cards(csv_path, font_hakka, font_pinyin, size=512, out_dir="cards"):
    """
    CSV : [..., target="Pinyin Hakka", fr, ...]
    """
    os.makedirs(out_dir, exist_ok=True)
    with open(csv_path, encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)

        for row in reader:
            _, _, target, fr, *_ = row
            generate_img(target, fr, size, font_big, font_py, out_dir)
