"""A word's type (LexiconAddition.word_type): kept apart from its hakka,
shown after it in parentheses -- « ok3 OK (emprunt anglais) » -- which the
parsing of the hakka field leaves out (text_to_words.split_word_type,
split_rendering). No database.

Run: python manage.py test hakkadbapp.test_word_type
"""
from django.test import SimpleTestCase

from .additions import _apply_payload
from .models import LexiconAddition
from .text_to_words import split_rendering, split_word_type


class WordTypeTest(SimpleTestCase):
    def test_left_out_of_the_hakka(self):
        self.assertEqual(split_word_type("wuk5ka1 屋家 (onomatopée)"), ("wuk5ka1 屋家", "onomatopée"))
        self.assertEqual(split_rendering("wuk5ka1 屋家 (emprunt anglais)"), ("wuk5ka1", "屋家"))
        self.assertEqual(split_rendering("wuk5ka1 屋家"), ("wuk5ka1", "屋家"))

    def test_never_a_reading_nor_characters(self):
        # A pinned reading, a Chinese parenthesis: not a type.
        self.assertEqual(split_word_type("ngai1 我 (sen1)"), ("ngai1 我 (sen1)", ""))
        self.assertEqual(split_word_type("A 甲（乙）"), ("A 甲（乙）", ""))
        self.assertEqual(split_word_type("ka1 家 (家)"), ("ka1 家 (家)", ""))

    def test_saved_without_parentheses(self):
        a = LexiconAddition(kind=LexiconAddition.KIND_WORD)
        self.assertIsNone(_apply_payload(a, {"hanzi": "屋家", "pinyin": "wuk5ka1", "word_type": "  emprunt (anglais)  "}))
        self.assertEqual(a.word_type, "emprunt anglais")
        self.assertIn("onomatopée", LexiconAddition.WORD_TYPES)
