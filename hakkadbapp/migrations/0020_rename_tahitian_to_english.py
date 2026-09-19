from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('hakkadbapp', '0019_wordnote_use_in_export'),
    ]

    operations = [
        migrations.RenameField(
            model_name='word',
            old_name='tahitian',
            new_name='english',
        ),
    ]
