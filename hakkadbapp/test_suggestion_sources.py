"""The « Un texte collé » source of the AI suggestions: how a pasted text is
cut into the words absent from the lexicon (assistant.segment). No database.

Run: python manage.py test hakkadbapp.test_suggestion_sources
"""
from django.test import SimpleTestCase

from .assistant import segment


class SegmentTests(SimpleTestCase):
    known = {"佢", "屋家", "在", "食", "饭", "么"}

    def words(self, text):
        return [h for h, _pin, _ctx in segment(text, self.known)]

    def test_unknown_runs_between_known_words(self):
        self.assertEqual(self.words("佢在屋家食番薯么"), ["番薯"])

    def test_longest_known_word_first(self):
        self.assertEqual(self.words("屋家"), [])

    def test_spaced_tokens_and_pins(self):
        self.assertEqual(segment("佢 㧹(dep5) 食", self.known)[0][:2], ("㧹", "dep5"))

    def test_sentences_and_long_runs(self):
        self.assertEqual(self.words("甲乙丙丁戊。佢"), ["甲乙丙丁", "戊"])
        self.assertEqual(segment("佢食番薯。佢在", self.known)[0][2], "佢食番薯")
