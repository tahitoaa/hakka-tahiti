# myapp/templatetags/pronunciation_tags.py

from django import template
from opencc import OpenCC

from hakkadbapp import romanization

register = template.Library()

# Same pair of converters models.py instantiates for Pronunciation/Word --
# duplicated here rather than imported so this templatetags module has no
# dependency on models.py (avoids the app-loading-order issues that can
# come from templatetags importing models at module scope).
_s2t = OpenCC('s2t')
_t2s = OpenCC('t2s')


@register.filter
def to_simp(hanzi):
    return _t2s.convert(hanzi) if hanzi else hanzi


@register.filter
def to_trad(hanzi):
    return _s2t.convert(hanzi) if hanzi else hanzi

@register.simple_tag
def combo_exists(initial_id, final_id, combo_set):
    return (initial_id, final_id) in combo_set

@register.simple_tag
def combo_hanzi_list(initial_id, final_id, combo_hanzi):
    return combo_hanzi.get((initial_id, final_id), [])

@register.simple_tag
def romanize_all(initial, final, tone=""):
    """Every transcription system for one stored syllable, one span each;
    only the one picked in the header menu is visible (see base.html).
    Mappings: hakkadbapp/romanization.json."""
    return romanization.romanize_all_html(initial, final, tone)


@register.simple_tag
def romanize(initial, final, tone="", system_id=None):
    """A single system, for places that need plain text (default system
    when `system_id` is omitted)."""
    return romanization.romanize(initial, final, tone, system_id)
