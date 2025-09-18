# myapp/templatetags/pronunciation_tags.py

from django import template

register = template.Library()

# Convert tone to superscript if present
superscript_map = {
    "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "":""
}

@register.simple_tag
def combo_exists(initial_id, final_id, combo_set):
    return (initial_id, final_id) in combo_set

@register.simple_tag
def wenfa_py(initial, final, tone=""):
    return (initial or "") + (final or "") + superscript_map.get(str(tone), str(tone))

@register.simple_tag
def hakka_dict_py(initial, final, tone=""):
    """
    Maps the given initial to a new initial using the provided mapping_dict.
    Example usage in template:
        {% map_initial initial mapping_dict as new_initial %}
    """
    map_i = {
        "b": "p",
        "p": "p'",
        "m": "m",
        "f": "f",
        "d": "t",
        "t": "t'",
        "n": "n",
        "l": "l",
        "g": "k",
        "k": "k'",
        "z": "ts",
        "c": "ts'",
        "s": "s",
        "zh": "ts",
        "ch": "ts'",
        "sh": "s",
        "j": "ts",
        "q": "ts'",
        "x": "s",
        "y": "j",
        "w": "w",
        "h": "h",
    }
    map_f = {
        "ao" : "au",
        "iao" : "iau",
        "eu" : "iu"
    }

    return map_i.get(initial, initial)+ map_f.get(final, final) + superscript_map.get(str(tone),str(tone) )

@register.simple_tag
def chappell_py(initial, final, tone=""):

    """
    Maps the given initial to a new initial using the provided mapping_dict.
    Example usage in template:
        {% map_initial initial mapping_dict as new_initial %}
    """

    if final == "i" and initial in ["z", "c", "s", "zh", "ch", "sh"]:
        map_i = {
            "z": "tṣ",
            "c": "tṣh",
            "s": "ṣ",
            "zh": "tṣ",
            "ch": "tṣ",
            "sh": "tṣ"
        }
        return map_i.get(initial, initial)
    
    map_i = {
        "b": "p",
        "p": "ph",
        "m": "m",
        "f": "f",
        "d": "t",
        "t": "th",
        "n": "n",
        "l": "l",
        "g": "k",
        "k": "kh",
        "z": "ts",
        "c": "tšh",
        "s": "s",
        "zh": "ts",
        "ch": "tsh",
        "sh": "sh",
        "j": "ts",
        "q": "tsh",
        "x": "š",
        "y": "j",
        "w": "w",
        "h": "h",
    }

    map_f = {
        "ao" : "au",
        "iao" : "yau",
        "ian" : "en",
        "iam" : "yam",
    }

    if initial == "g":
        map_f["et"] = "wet"
        map_f["ut"] = "wut"

    if initial == "ng" and final.startswith('i'):
        map_i['ng'] = "ny"

    return map_i.get(initial, initial)+ map_f.get(final, final) + superscript_map.get(str(tone),str(tone))


@register.simple_tag
def sagart_py(initial, final, tone=""):
    map_i = {
        "b": "p",
        "p": "p'",
        "m": "m",
        "f": "f",
        "d": "t",
        "t": "t'",
        "n": "n",
        "l": "l",
        "g": "k",
        "k": "k'",
        "z": "ts",
        "c": "ts'",
        "s": "s",
        "zh": "ts",
        "ch": "ts'",
        "sh": "s",
        "j": "ts",
        "q": "ts'",
        "x": "s",
        "y": "j",
        "w": "v",
        "h": "h",
        "ng" : "ŋ"
    }
    map_f = {}
        
    if final == "i" and initial in ["z", "c", "s", "zh", "ch", "sh"]:
        final = "u"
    
    if final.startswith('i') and initial in ["q","k", "g", "ng"] and len(final) > 1:
        initial = map_i.get(initial, initial) + 'j'
        initial = initial.replace("'j","j'")

    final = final.replace("e", "ε")
    final = final.replace("εu", "eu")

    final = final.replace("ng", "ŋ")
    final = final.replace("ao", "au")
    initial = initial.replace("ng", "ŋ")
    final = final.replace("o", "ɔ")

    if initial == "y" and final == "u":
        final = "iu"

    return map_i.get(initial, initial)+ map_f.get(final, final) + superscript_map.get(str(tone),str(tone) )
