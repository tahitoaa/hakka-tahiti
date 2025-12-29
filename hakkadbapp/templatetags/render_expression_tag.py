from django import template
from django.utils.safestring import mark_safe

register = template.Library()

@register.simple_tag
def render_expression_tag(expression):
    """
    Render a full expression block:
    - per-word chips (pinyin, gloss, hanzi)
    - full expression (hanzi, pinyin, french, simp, trad)
    """

    # Build chips
    chips_html = ""
    i = 0

    for ew in expression.expressionword_set.all():
        w = ew.word     # dictionary word or None
        print(w, expression.text[i])
        hanzi = ew.word.char if ew.word else expression.text[i]

        # Case 1 — Unknown word (no dictionary match)
        if w is None:
            chips_html += f"""
                <div class="px-3 py-2 rounded bg-red-50 border border-red-300 text-center min-w-[60px]">
                    
                    <!-- Pinyin not available -->
                    <div class="text-xs text-red-700 leading-tight mb-1 font-medium">
                        ?
                    </div>

                    <!-- French gloss missing -->
                    <div class="text-[0.65rem] text-red-600 leading-tight italic">
                        inconnu
                    </div>

                    <!-- Hanzi -->
                    <div class="hanzi text-2xl font-serif leading-none mb-1 tracking-wide text-red-700">
                        {hanzi}
                    </div>

                </div>
            """
            continue

        # Case 2 — Known dictionary word
        simp = w.simp()
        trad = w.trad()
        pinyin = w.pinyin() 
        french = w.french

        chips_html += f"""
            <div class="px-3 py-2 rounded bg-indigo-50 border border-indigo-200 text-center min-w-[60px]">

                <div class="text-xs text-gray-700 leading-tight mb-1 font-medium">
                    {pinyin}
                </div>

                <div class="text-[0.65rem] text-gray-600 leading-tight italic">
                    {french}
                </div>

                <div class="hanzi text-2xl font-serif leading-none mb-1 tracking-wide">
                    {simp}
                    {"<span class='text-gray-500 text-base'>(" + trad + ")</span>" if simp != trad else ""}
                </div>

            </div>
        """
        i += 1

    # Full expression block
    full_html = f"""
        <div class="text-xl text-gray-900 leading-tight mb-1 font-serif">
            {expression.text}
        </div>

        <div class="text-sm text-gray-800 leading-tight mb-1">
            {expression.pinyin}
        </div>

        <div class="text-base text-gray-900 font-medium mb-1">
            {expression.french}
        </div>

        <div class="hanzi text-xs text-gray-600 leading-tight">
            {expression.simp}
        </div>

        <div class="hanzi text-xs text-gray-400 leading-tight">
            {expression.trad}
        </div>
    """

    # Wrap everything
    final = f"""
    <div class="exp p-3 rounded bg-white shadow text-center">

        <div class="flex flex-wrap justify-center gap-2 mb-2">
            {chips_html}
        </div>

        {full_html}

    </div>
    """

    return mark_safe(final)