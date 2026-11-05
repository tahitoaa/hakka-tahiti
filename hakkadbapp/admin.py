from django.contrib import admin
# from .models import Character, Pronunciation, Word, WordCharacter, VocabList, VocabListEntry

# admin.site.register(Character)
# admin.site.register(Pronunciation)
# admin.site.register(Word)
# admin.site.register(WordCharacter)
# admin.site.register(VocabList)
# admin.site.register(VocabListEntry)
from .models import LexiconAddition


@admin.register(LexiconAddition)
class LexiconAdditionAdmin(admin.ModelAdmin):
    """Same rule as the site: only the group « Validateurs » sets or changes
    the « Validé » / « Rejeté » status (permissions.status_change_refused)."""
    list_display = ("hanzi", "pinyin", "french", "kind", "status", "source", "created_by", "updated_at")
    list_filter = ("kind", "status", "created_by", "source")
    search_fields = ("hanzi", "pinyin", "french", "english", "source", "observations")

    def get_readonly_fields(self, request, obj=None):
        from .permissions import is_validator

        fields = super().get_readonly_fields(request, obj)
        if not is_validator(request.user) and obj and obj.status in ("validated", "rejected"):
            return (*fields, "status")
        return fields

    def get_form(self, request, obj=None, **kwargs):
        """A refused status change is shown as a form error, not a 403 page."""
        from django.core.exceptions import ValidationError

        from .permissions import status_change_refused

        form_class = super().get_form(request, obj, **kwargs)
        old = obj.status if obj else "draft"

        class CheckedForm(form_class):
            def clean(self):
                data = super().clean()
                message = status_change_refused(request.user, old, data.get("status", old))
                if message:
                    raise ValidationError(message)
                if data.get("status") == "validated" and old != "validated":
                    from .additions import REQUIRED_FIELDS

                    missing = [label for field, label in REQUIRED_FIELDS if not (data.get(field) or "").strip()]
                    if missing:
                        raise ValidationError(f"Incomplet, impossible de valider : il manque {', '.join(missing)}.")
                return data

        return CheckedForm

    def save_model(self, request, obj, form, change):
        from django.core.exceptions import PermissionDenied

        from .permissions import status_change_refused

        old = LexiconAddition.objects.filter(pk=obj.pk).values_list("status", flat=True).first() if change else "draft"
        message = status_change_refused(request.user, old, obj.status)
        if message:
            raise PermissionDenied(message)
        super().save_model(request, obj, form, change)


from .models import SharedTranscript


@admin.register(SharedTranscript)
class SharedTranscriptAdmin(admin.ModelAdmin):
    list_display = ("title", "eaf_file_name", "updated_at", "updated_by")
    search_fields = ("title", "eaf_file_name")
    readonly_fields = ("id", "eaf_urn", "audio_path", "audio_source", "created_at", "updated_at")
    exclude = ("data",)


from .models import SourceLookup, SourceSite


@admin.register(SourceSite)
class SourceSiteAdmin(admin.ModelAdmin):
    """The sources the 🔎 lookup consults (sources.py)."""
    list_display = ("name", "domain", "kind", "priority", "active", "lookup_url")
    list_editable = ("priority", "active")
    list_filter = ("kind", "active")


@admin.register(SourceLookup)
class SourceLookupAdmin(admin.ModelAdmin):
    list_display = ("query", "reading", "created_by", "created_at")
    search_fields = ("query",)
    readonly_fields = ("query", "reading", "result", "created_by", "created_at")
