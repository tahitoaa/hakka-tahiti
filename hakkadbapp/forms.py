# your_app/forms.py
from django import forms
from django.forms.models import inlineformset_factory
from .models import Pronunciation, Word, WordPronunciation

class PronunciationForm(forms.ModelForm):
    class Meta:
        model = Pronunciation
        fields = ['hanzi', 'initial', 'final', 'tone']


class WordForm(forms.ModelForm):
    hanzi_input = forms.CharField(
        label="Hanzi sequence",
        help_text="Enter the hanzi sequence (e.g., 客家)",
        required=True
    )

    class Meta:
        model = Word
        fields = ['french', 'tahitian', 'mandarin', 'category']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Set all fields to not required
        for field in self.fields.values():
            field.required = False

        hanzi_seq = self.initial.get('hanzi_input')
        if hanzi_seq:
            for idx, char in enumerate(hanzi_seq):
                # Get all known readings for this Hanzi
                readings = Pronunciation.objects.filter(hanzi=char)
                choices = [(p.id, str(p)) for p in readings]
                self.fields[f'char_{idx}'] = forms.ChoiceField(
                    label=f"Reading for '{char}'",
                    choices=choices,
                    required=False
                )