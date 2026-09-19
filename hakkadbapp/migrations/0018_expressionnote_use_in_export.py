from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hakkadbapp', '0017_wordnote_expressionnote'),
    ]

    operations = [
        migrations.AddField(
            model_name='expressionnote',
            name='use_in_export',
            field=models.BooleanField(default=False),
        ),
    ]
