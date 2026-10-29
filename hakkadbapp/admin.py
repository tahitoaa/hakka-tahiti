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
    list_display = ("hanzi", "pinyin", "french", "kind", "status", "created_by", "updated_at")
    list_filter = ("kind", "status", "created_by")
    search_fields = ("hanzi", "pinyin", "french", "english")


from .models import SharedTranscript


@admin.register(SharedTranscript)
class SharedTranscriptAdmin(admin.ModelAdmin):
    list_display = ("title", "eaf_file_name", "updated_at", "updated_by")
    search_fields = ("title", "eaf_file_name")
    readonly_fields = ("id", "eaf_urn", "audio_path", "audio_source", "created_at", "updated_at")
    exclude = ("data",)
