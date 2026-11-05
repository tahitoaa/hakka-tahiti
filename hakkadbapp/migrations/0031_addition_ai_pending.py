from django.db import migrations, models


def mark(apps, schema_editor):
    """The AI's drafts already there are still to sort."""
    Addition = apps.get_model("hakkadbapp", "LexiconAddition")
    Addition.objects.filter(status="draft", created_by__username="ia").update(ai_pending=True)


class Migration(migrations.Migration):
    dependencies = [("hakkadbapp", "0030_review_comment_todo")]
    operations = [
        migrations.AddField(model_name="lexiconaddition", name="ai_pending", field=models.BooleanField(default=False)),
        migrations.RunPython(mark, migrations.RunPython.noop),
    ]
