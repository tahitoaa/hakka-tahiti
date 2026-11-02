import re

from django.db import migrations, models

IMPORTED = re.compile(r"Importé de « (.+?) »")


def source_name(filename):
    """"Chappell_Lamarre_mots.tsv" -> "Chappell Lamarre" (same as the import form)."""
    name = re.sub(r"\.[A-Za-z0-9]{2,4}$", "", filename)
    name = re.sub(r"[_-]+(mots|words|texte|extraction|ocr)$", "", name, flags=re.I)
    return " ".join(name.replace("_", " ").split())[:200]


def backfill(apps, schema_editor):
    """Additions imported before this field: their source from the
    observations ("Importé de « file » ...")."""
    LexiconAddition = apps.get_model("hakkadbapp", "LexiconAddition")
    for a in LexiconAddition.objects.filter(observations__contains="Importé de « ", source=""):
        match = IMPORTED.search(a.observations)
        if match:
            a.source = source_name(match.group(1))
            a.save(update_fields=["source"])


class Migration(migrations.Migration):

    dependencies = [
        ("hakkadbapp", "0025_sources"),
    ]

    operations = [
        migrations.AddField(
            model_name="lexiconaddition",
            name="source",
            field=models.CharField(blank=True, default="", max_length=200),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
