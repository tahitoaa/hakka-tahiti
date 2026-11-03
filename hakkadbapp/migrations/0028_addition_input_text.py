from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hakkadbapp", "0027_validators_group"),
    ]

    operations = [
        migrations.AddField(
            model_name="lexiconaddition",
            name="input_text",
            field=models.TextField(blank=True, default=""),
        ),
    ]
