# Generated by Django 5.1.4 on 2025-07-18 09:23

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hakkadbapp', '0005_traces_char_count_traces_word_count'),
    ]

    operations = [
        migrations.AlterField(
            model_name='word',
            name='category',
            field=models.CharField(blank=True, default=None, max_length=20, null=True),
        ),
    ]
