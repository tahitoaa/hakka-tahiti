from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hakkadbapp', '0033_visas'),
    ]

    operations = [
        migrations.AddField(
            model_name='lexiconaddition',
            name='word_type',
            field=models.CharField(blank=True, default='', max_length=60),
        ),
    ]
