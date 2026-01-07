import os
import hakkadbapp.json_model as jsonm
import hakkadbapp.generate_images as gen_img
import json
import os

superscript_map = {"1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "":""}
reverse_superscript_map = {v: k for k, v in superscript_map.items()}

def read_words(json_path):
    """
    Read themes from a JSON file and create Theme objects
    with fixed IDs.
    """

    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)

    for word_id, payload in data.items():
        translations = payload.get("translations", {})
        primary = translations.get("primary")
        secondary = translations.get("secondary")
        target = translations.get("target")
        print(primary, secondary, target)
        if not all([primary, secondary, target]):
            continue
        # --- Force ID to match JSON
        themes = payload.get("themes")
        new_word = jsonm.Word(
            id=word_id,
            primary=primary,
            secondary=secondary,
            target=target,
            themes=themes
        )





