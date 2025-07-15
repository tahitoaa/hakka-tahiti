# myapp/templatetags/pronunciation_tags.py

from django import template

register = template.Library()

@register.simple_tag
def combo_exists(initial_id, final_id, combo_set):
    return (initial_id, final_id) in combo_set
