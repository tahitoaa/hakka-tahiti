from django.db import models
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
        return ''.join([str(self.initial or ''), str(self.final or ''), str(self.tone or '')])

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
    tahitian = models.TextField()
    mandarin = models.TextField()
    category = models.CharField(max_length=20, default=None, null=True, blank=True)  # Category of the word (e.g., "HSK 1", "Beginner Vocabulary")
    status = models.CharField(max_length=20, default=None, null=True, blank=True)  # Status of the word (e.g., "common", "rare", etc.)

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
    
    def __str__(self):
        return f"{self.timestamp} - {self.details or 'No Details'}"