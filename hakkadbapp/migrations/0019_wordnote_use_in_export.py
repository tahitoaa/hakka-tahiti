from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hakkadbapp', '0018_expressionnote_use_in_export'),
    ]

    operations = [
        migrations.AddField(
            model_name='wordnote',
            name='use_in_export',
            field=models.BooleanField(default=False),
        ),
    ]
