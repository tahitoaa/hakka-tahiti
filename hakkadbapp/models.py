from django.db import models
from itertools import product

from opencc import OpenCC

# Create converter: 's2t' = Simplified to Traditional, 't2s' = Traditional to Simplified
s2t = OpenCC('s2t')
t2s = OpenCC('t2s')

class Initial(models.Model):
    initial = models.CharField(max_length=10, null=True)  # Adjust this as per your requirements

    def __str__(self):
        return self.initial

class Final(models.Model):
    final = models.CharField(max_length=10, null=True)  # Adjust this as per your requirements

    def __str__(self):
        return self.final

class Tone(models.Model):
    tone_number = models.PositiveIntegerField(choices=[(i, str(i)) for i in range(1, 7)])  # 6 tones
    def __str__(self):
        return str(self.tone_number)

class Pronunciation(models.Model):
    hanzi = models.CharField(max_length=1)
    initial = models.ForeignKey(Initial, related_name='pronunciations', on_delete=models.CASCADE)
    final = models.ForeignKey(Final, related_name='pronunciations', on_delete=models.CASCADE)
    tone = models.ForeignKey(
        Tone,
        related_name='pronunciations',
        on_delete=models.CASCADE,
        null=True,   # allow NULL in the database
        blank=True   # allow blank in forms/admin
    )

    def __str__(self):
        trad = s2t.convert(self.hanzi)     # Simplified to Traditional
        simp = t2s.convert(self.hanzi)     # Traditional to Simplified
        if (simp != trad):
            return f'{simp} ({trad})  {self.pinyin()}'
        else:
            return f'{simp}           {self.pinyin()}'
        
    def simp(self):
        return t2s.convert(self.hanzi) 
    
    def trad(self):
        return s2t.convert(self.hanzi)
    
    def pinyin(self):
        superscript_map = {"1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "":""}
        return ''.join([str(self.initial or ''), str(self.final or ''), superscript_map[str(self.tone.tone_number) if self.tone else '']])

    def latex(self):
        # Compose pinyin from initial, final, and tone
        pinyin = f'\\hk{{{self.initial}}}{{{self.final}}}'
        
        # Return the full LaTeX command
        return f'\\newpinyin{{{self.hanzi}}}{{{pinyin}}}{{{self.tone}}}'

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['hanzi', 'initial', 'final', 'tone'],
                name='unique_pronunciation_combination'
            )
        ]

class Word(models.Model):
    pronunciations = models.ManyToManyField(Pronunciation, through='WordPronunciation')
    french = models.TextField()
    # Renamed from "tahitian" -- the field was mislabeled from the very
    # first migration; it has only ever held English translations (see
    # import_words_v2.py's WordImportRow).
    english = models.TextField()
    mandarin = models.TextField()
    category = models.CharField(max_length=20, default=None, null=True, blank=True)  # Category of the word (e.g., "HSK 1", "Beginner Vocabulary")
    status = models.CharField(max_length=20, default=None, null=True, blank=True)  # Status of the word (e.g., "common", "rare", etc.)
    # audio = models.TextField(defalut=None, null=True, blank=True)
    # The e_reo platform's own id for this word (wordCorpus.json's dict key),
    # carried through verbatim by platform_to_vercel on every import so it
    # stays the same across a reset+rebuild -- unlike this row's own pk,
    # which is destroyed and reassigned every time. Lets persistent
    # side-data (e.g. per-word comments) key off something stable instead
    # of a pk or a recomputed match. Null for rows never imported from the
    # platform (there is currently no other creation path).
    platform_id = models.CharField(max_length=64, unique=True, null=True, blank=True)

    def __str__(self):
        return f'{self.char()}'
    
    def char(self):
        return ''.join([wp.pronunciation.hanzi for wp in self.wordpronunciation_set.all()])
    
    def pinyin(self):
        return ''.join([wp.pronunciation.pinyin() for wp in self.wordpronunciation_set.all()])
    
    def simp(self):
        return ''.join([wp.pronunciation.simp() for wp in self.wordpronunciation_set.all()])
    
    def trad(self):
        return ''.join([wp.pronunciation.trad() for wp in self.wordpronunciation_set.all()])
    
class Expression(models.Model):
    """
    A multi-word expression (phrase, idiom, sentence fragment…)
    composed of an ordered list of Words.
    """
    text = models.TextField(help_text="space separated words simp", blank=True, null=True)
    rendering = models.TextField(help_text="pinyin+hanzi", blank=True, null=True, default="")
    french = models.TextField(help_text="French translation of the expression")
    notes = models.TextField(blank=True, null=True)
    category = models.CharField(max_length=50, blank=True, null=True)
    status = models.CharField(max_length=20, blank=True, null=True)
    english = models.TextField(help_text="English", blank=True, null=True, default="")
    # The e_reo platform's own id for this expression (expressionCorpus.json's
    # dict key) -- see Word.platform_id for why this is carried through
    # verbatim instead of relying on this row's pk, which a reset+rebuild
    # destroys and reassigns.
    platform_id = models.CharField(max_length=64, unique=True, null=True, blank=True)

    # M2M through ExpressionWord to preserve order
    words = models.ManyToManyField(
        Word,
        through="ExpressionWord",
        related_name="expressions"
    )

    def __str__(self):
        return self.text + ' ' +' ' + self.french

    @property
    def words_ordered(self):
        return [ew.word for ew in self.expressionword_set.all() if ew.word]

    @property
    def simp(self):
        return ''.join(w.simp() for w in self.words_ordered)

    @property
    def trad(self):
        return ''.join(w.trad() for w in self.words_ordered)
        
    def french_translation(self):
        return self.french

class ExpressionWord(models.Model):
    """
    Connects each Expression to a Word, preserving the correct word order.
    """
    expression = models.ForeignKey(Expression, on_delete=models.CASCADE)
    word = models.ForeignKey(
        Word,
        on_delete=models.CASCADE,
        null=True,        # allow NULL in DB
        blank=True        # allow empty value in admin/forms
    )

    # Order inside the expression
    position = models.PositiveIntegerField()

    class Meta:
        ordering = ["position"]
        unique_together = ("expression", "position")

    def __str__(self):
        return f"{self.position}: {self.word}"

class WordPronunciation(models.Model):
    word = models.ForeignKey(Word, on_delete=models.CASCADE)
    pronunciation = models.ForeignKey(Pronunciation, on_delete=models.CASCADE)
    position = models.PositiveIntegerField()

    class Meta:
        ordering = ['position']

class VocabList(models.Model):
    name = models.CharField(max_length=100)  # Name of the vocab list (e.g., "HSK 1", "Beginner Vocabulary")
    words = models.ManyToManyField(Word, related_name='vocab_lists')  # Many-to-many relationship with Word

    def __str__(self):
        return self.name
    
class Traces(models.Model):
    timestamp = models.DateTimeField(auto_now_add=True)
    details = models.TextField(null=True, blank=True)  # Additional details about the action
    char_count = models.IntegerField(default=0)  # Count of characters processed
    word_count = models.IntegerField(default=0)  # Count of words processed
    # Raw platform corpus (words/expressions/themes) as read from e_reo_json/
    # at import time, only populated by `platform_to_vercel` -- lets any
    # deployed view query the exact platform snapshot a given import ran
    # against, without needing filesystem access to e_reo_json/ (which only
    # exists on a developer's machine, not on Vercel).
    platform_data = models.JSONField(null=True, blank=True)

    def __str__(self):
        return f"{self.timestamp} - {self.details or 'No Details'}"


class WordNote(models.Model):
    """A word's persistent, human-edited comment -- kept in its own table
    (never touched by import_words_from_df's reset=True, which only wipes
    Word/WordPronunciation/Pronunciation/Initial/Final/Tone) so it survives
    every `platform_to_vercel --yes` reset+rebuild. Keyed by the e_reo
    platform's own id (Word.platform_id), not by the Word's own pk, since
    that pk is destroyed and reassigned on every reset."""
    platform_id = models.CharField(max_length=64, unique=True)
    commentaire = models.TextField(blank=True, default="")
    # Opt-in, off by default: export_corpus() only includes this word in
    # wordCorpus.json when this is True -- same reasoning and default as
    # ExpressionNote.use_in_export.
    use_in_export = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"note for word {self.platform_id}"


class ExpressionNote(models.Model):
    """An expression's persistent, human-edited data -- the "maillage"
    (excel_format: a space-per-word hanzi phrase, see expression_mesh.py)
    plus a free-text comment. Same reasoning as WordNote: its own table,
    outside reset=True's reach, keyed by Expression.platform_id rather
    than the Expression's own reset-and-reassigned pk."""
    platform_id = models.CharField(max_length=64, unique=True)
    excel_format = models.TextField(blank=True, default="")
    commentaire = models.TextField(blank=True, default="")
    # Opt-in, off by default: export_corpus() only uses this expression's
    # maillage (excel_format) for its recomputed "hakka" target,
    # `components`, and contribution to words' `in_expression` when this is
    # True. Left False, export_corpus() falls back to the expression's
    # original import data (Expression.rendering / its DB ExpressionWord
    # links) instead -- so a hand-edited maillage never affects the
    # exported corpus until someone deliberately vouches for it.
    use_in_export = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"note for expression {self.platform_id}"