"""Builds static/hakkadbapp/data/hanzi_info.json: for every character of the
lexicon and of the dictionary indexes (Bao'an, McIver), its Mandarin
reading(s), a short English meaning and its Cantonese reading(s) (Jyutping), from the Unicode Unihan database
(free, textual, unicode.org). Shown by HanziInfo.js on a character's page,
in the Caractères tab and on the character suggestions.

    python manage.py build_hanzi_info            # downloads the latest Unihan
    python manage.py build_hanzi_info --zip Unihan.zip

Run it again when Unicode publishes a new version."""
import io
import json
import urllib.request
import zipfile
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from hakkadbapp.models import Pronunciation, s2t, t2s

UNIHAN_URL = "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip"
DATA_DIR = Path(__file__).resolve().parents[2] / "static" / "hakkadbapp" / "data"
DICTIONARIES = ("hakka_dict_prons.json", "mciver_prons.json")


def read_unihan(data):
    """{char: (Mandarin readings, definition)} from Unihan_Readings.txt."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        text = z.read("Unihan_Readings.txt").decode("utf-8")
    mandarin, hanyu, definition, cantonese = {}, {}, {}, {}
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        code, field, value = line.split("\t", 2)
        char = chr(int(code[2:], 16))
        if field == "kMandarin":
            mandarin[char] = value.split()
        elif field == "kHanyuPinyin":
            # "10019.020:jiā,jie 10020.030:gū" -> every reading listed
            hanyu[char] = [r for part in value.split() for r in part.split(":", 1)[-1].split(",")]
        elif field == "kDefinition":
            definition[char] = value
        elif field == "kCantonese":
            cantonese[char] = value
    out = {}
    for char in set(mandarin) | set(definition) | set(cantonese):
        readings = []
        for r in mandarin.get(char, []) + hanyu.get(char, []):
            if r and r not in readings:
                readings.append(r)
        out[char] = (readings, definition.get(char, ""), cantonese.get(char, ""))
    return out


class Command(BaseCommand):
    help = "Mandarin readings and English meanings (Unicode Unihan) for the site's characters."

    def add_arguments(self, parser):
        parser.add_argument("--zip", help="A local Unihan.zip instead of downloading it")

    def handle(self, *args, **options):
        if options["zip"]:
            data = Path(options["zip"]).read_bytes()
        else:
            self.stdout.write(f"Téléchargement de {UNIHAN_URL}…")
            try:
                with urllib.request.urlopen(UNIHAN_URL, timeout=120) as response:
                    data = response.read()
            except OSError as err:
                raise CommandError(f"Téléchargement impossible : {err}")
        unihan = read_unihan(data)

        chars = set()
        for name in DICTIONARIES:
            path = DATA_DIR / name
            if path.exists():
                for row in json.loads(path.read_text(encoding="utf-8"))["prons"]:
                    chars.update(v for v in row[:1] + row[3:4] if isinstance(v, str))
        chars.update(Pronunciation.objects.values_list("hanzi", flat=True))
        chars |= {s2t.convert(c) for c in chars} | {t2s.convert(c) for c in chars}
        chars = {c for c in chars if len(c) == 1}

        entries = {}
        for char in sorted(chars):
            readings, definition, canto = unihan.get(char, ([], "", ""))
            if readings or definition or canto:
                entries[char] = [" ".join(readings), definition, canto]
        out = {
            "meta": {
                "source": "Unicode Unihan (kMandarin, kHanyuPinyin, kDefinition, kCantonese)",
                "url": "https://www.unicode.org/charts/unihan.html",
                "license": "Unicode License v3",
                "count": len(entries),
            },
            "chars": entries,
        }
        target = DATA_DIR / "hanzi_info.json"
        target.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(
            f"{len(entries)} caractères sur {len(chars)} → {target.name} ({target.stat().st_size // 1024} Ko)"))
