"""Builds static/hakkadbapp/data/rey_index.json: the syllables of Charles
Rey's Dictionnaire chinois-français, dialecte hac-ka (1926) and the pages
where each one is, from the index page daylightstar.wordpress.com keeps
(each page links to its scan on minhakka2.ling.sinica.edu.tw, kf_<n>.png;
a syllable heading stands before the page where it starts).

    python manage.py build_rey_index
    python manage.py build_rey_index --html saved_page.html

A syllable runs from its first page to the page where the next one starts
(both included: the next one may start half way down that page).
"""
import html
import json
import re
import urllib.request
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

PAGE = "https://daylightstar.wordpress.com/2024/01/31/dictionnaire-chinoise-francais-dialecte-hac-ka-2/"
TARGET = Path(__file__).resolve().parents[2] / "static" / "hakkadbapp" / "data" / "rey_index.json"
LINK = re.compile(r'<a[^>]+href="(https://minhakka2\.ling\.sinica\.edu\.tw/[^"]+?kf_(\d+)\.png)"[^>]*>(.*?)</a>', re.S)


class Command(BaseCommand):
    help = "Index of the syllables of Rey's Hakka-French dictionary (1926), page by page."

    def add_arguments(self, parser):
        parser.add_argument("--html", help="A saved copy of the index page (else it is downloaded).")

    def handle(self, *args, **options):
        if options.get("html"):
            text = Path(options["html"]).read_text(encoding="utf-8", errors="replace")
        else:
            request = urllib.request.Request(PAGE, headers={"User-Agent": "Mozilla/5.0 (lexique hakka Wenfa)"})
            text = urllib.request.urlopen(request, timeout=30).read().decode("utf-8", errors="replace")
        body = text[text.find("entry-content"):]
        pages, headings = [], []
        last = 0
        for m in LINK.finditer(body):
            before = html.unescape(re.sub(r"<[^>]+>", " ", body[last:m.start()]))
            last = m.end()
            printed = re.sub(r"<[^>]+>", "", m.group(3)).strip()
            index = len(pages)
            pages.append({"page": int(printed) if printed.isdigit() else index + 1, "image": int(m.group(2))})
            # The words just before a link are the syllables starting on that page (« yo yoc »),
            # once the letter headings (« Ch. », « A. ») and the introduction are left out.
            tail = before.strip().split(".")[-1] if index == 0 else before
            # Letter headings (« Ch. », « K’. ») are not syllables.
            tail = re.sub(r"(?<![\w’'])[A-Za-z’']{1,4}\.(?=\s|$)", " ", tail)
            for syl in re.findall(r"(?<![\w*’'])([a-zàâäéèêëïîôöùûüç’'*]+)(?![\w*’'])", tail.lower()):
                if len(syl) <= 7 and not (index == 0 and syl not in ("a",)):
                    headings.append((syl, index))
        if not pages:
            raise CommandError("Aucun lien de page trouvé : la page a peut-être changé.")
        by_syllable = {}
        for k, (syl, start) in enumerate(headings):
            end = headings[k + 1][1] if k + 1 < len(headings) else len(pages) - 1
            # A syllable seen twice (its heading repeated further on): two ranges.
            by_syllable.setdefault(syl, {"syllable": syl, "ranges": []})["ranges"].append([start, max(start, end)])
        syllables = list(by_syllable.values())
        out = {
            "meta": {"title": "Charles Rey, Dictionnaire chinois-français, dialecte hac-ka (1926)",
                     "index": PAGE, "images": "https://minhakka2.ling.sinica.edu.tw/static/images/result/dictionary/kf/kf_{image}.png",
                     "romanization": "Romanisation française de Rey : -c final = -k (yoc = yok), tch = zh/ch, ts' = c, gn = ng(i), "
                                     "ou = u ; tons notés par des accents (ˉ ˆ ` ́ ˘ ̑)."},
            "pages": pages,
            "syllables": syllables,
        }
        TARGET.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(f"{len(syllables)} syllabes, {len(pages)} pages -> {TARGET.name}"))
