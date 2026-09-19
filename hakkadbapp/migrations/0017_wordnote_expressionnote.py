from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hakkadbapp', '0016_word_platform_id_expression_platform_id'),
    ]

    operations = [
        migrations.CreateModel(
            name='WordNote',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('platform_id', models.CharField(max_length=64, unique=True)),
                ('commentaire', models.TextField(blank=True, default='')),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name='ExpressionNote',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('platform_id', models.CharField(max_length=64, unique=True)),
                ('excel_format', models.TextField(blank=True, default='')),
                ('commentaire', models.TextField(blank=True, default='')),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
