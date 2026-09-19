from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hakkadbapp', '0015_traces_platform_data'),
    ]

    operations = [
        migrations.AddField(
            model_name='word',
            name='platform_id',
            field=models.CharField(blank=True, max_length=64, null=True, unique=True),
        ),
        migrations.AddField(
            model_name='expression',
            name='platform_id',
            field=models.CharField(blank=True, max_length=64, null=True, unique=True),
        ),
    ]
