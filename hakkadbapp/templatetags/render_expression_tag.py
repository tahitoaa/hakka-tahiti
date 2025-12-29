from django import template
from django.utils.safestring import mark_safe
from collections import defaultdict

register = template.Library()

@register.simple_tag
def render_expression_tag(expression, stats=None):
    """
    Render a full expression block and update stats.
    """

    # Init stats if first call
    if stats is None:
        stats = {
            "contains_unknowns": False,
            "unknowns": {},                 # hanzi → {simp, trad, count}
            "matched_words": set(),         # word.id
            "matched_word_count": 0,
            "themes": defaultdict(int),     # category → count
        }

    chips_html = ""
    tokens = expression.text.split()

    for i, ew in enumerate(expression.expressionword_set.all()):
        w = ew.word
        hanzi = w.char() if w else tokens[i]

        # ===============================
        # Case 1 — Unknown word
        # ===============================
        if w is None:
            stats["contains_unknowns"] = True

            if hanzi not in stats["unknowns"]:
                stats["unknowns"][hanzi] = {
                    "simp": hanzi,
                    "trad": hanzi,
                    "count": 0,
                }

            stats["unknowns"][hanzi]["count"] += 1

            chips_html += f"""
            <div class="px-3 py-2 rounded bg-red-50 border border-red-300 text-center min-w-[60px]">
                <div class="text-xs text-red-700 mb-1 font-medium">?</div>
                <div class="text-[0.65rem] text-red-600 italic">inconnu</div>
                <div class="hanzi text-2xl font-serif text-red-700">{hanzi}</div>
            </div>
            """
            continue

        # ===============================
        # Case 2 — Known word
        # ===============================
        simp = w.simp()
        trad = w.trad()
        pinyin = w.pinyin()
        french = w.french

        # ---- stats
        stats["matched_words"].add(w.id)
        stats["matched_word_count"] += 1

        if w.category:
            stats["themes"][w.category] += 1

        chips_html += f"""
        <div class="px-3 py-2 rounded bg-green-300 border border-indigo-200 text-center min-w-[60px]">
            <div class="text-xs text-gray-700 mb-1 font-medium">{pinyin}</div>
            <div class="text-[0.65rem] text-gray-600 italic">{french}</div>
            <div class="hanzi text-2xl font-serif">
                {simp}
                {"<span class='text-gray-500 text-base'>(" + trad + ")</span>" if simp != trad else ""}
            </div>
        </div>
        """

    # ===============================
    # Full expression block
    # ===============================
    full_html = f"""
    <div class="text-xl font-serif">{expression.text}</div>
    <div class="text-sm"></div>
    <div class="text-base font-medium">{expression.french}</div>
    <div class="hanzi text-xs text-gray-600">{expression.simp}</div>
    <div class="hanzi text-xs text-gray-400">{expression.trad}</div>
    """

    print(expression.text)

    bg_class = "bg-red-100" if stats["contains_unknowns"] else "bg-green-100"

    final = f"""
    <div class="exp p-3 rounded {bg_class} shadow text-center">
        <div class="flex flex-wrap justify-center gap-2 mb-2">
            {chips_html}
        </div>
        {full_html}
    </div>
    """
    return mark_safe(final)
