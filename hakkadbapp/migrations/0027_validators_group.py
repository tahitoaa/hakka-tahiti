from django.db import migrations

GROUP = "Validateurs"
MEMBERS = ["charles"]


def create(apps, schema_editor):
    """The group « Validateurs » (permissions.VALIDATORS_GROUP), with Charles."""
    Group = apps.get_model("auth", "Group")
    User = apps.get_model("auth", "User")
    group, _ = Group.objects.get_or_create(name=GROUP)
    for user in User.objects.filter(username__in=MEMBERS):
        user.groups.add(group)


class Migration(migrations.Migration):

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
        ("hakkadbapp", "0026_addition_source"),
    ]

    operations = [migrations.RunPython(create, migrations.RunPython.noop)]
