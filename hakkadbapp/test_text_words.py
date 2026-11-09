"""A tone left unknown ("_", ngai_) is shown as a raised question mark.

Run with: python manage.py test hakkadbapp.test_text_words
"""
from django.test import SimpleTestCase

from hakkadbapp.management.commands.import_utils_v2 import split_compact_pinyin_into_syllables
from hakkadbapp.text_to_words import _tone_to_exponent


class UnknownToneTests(SimpleTestCase):
    def test_unknown_tone_is_a_raised_question_mark(self):
        self.assertEqual(_tone_to_exponent("ngai_"), "ngaiˀ")
        self.assertEqual(_tone_to_exponent("ngai2"), "ngai²")
        self.assertEqual(split_compact_pinyin_into_syllables("ngai_oi4"), ["ngai_", "oi4"])
