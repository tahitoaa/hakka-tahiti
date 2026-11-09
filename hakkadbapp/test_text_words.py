"""A tone left unknown ("_", ngai_) is shown as a raised question mark;
a «…» block (ma'a tinito) is copied as written in both halves.

Run with: python manage.py test hakkadbapp.test_text_words
"""
from django.test import SimpleTestCase

from hakkadbapp.management.commands.import_utils_v2 import split_compact_pinyin_into_syllables
from hakkadbapp.text_to_words import (_tone_to_exponent, join_hanzi, render_expression_from_token_data,
                                      split_rendering, split_words, text_block)


class UnknownToneTests(SimpleTestCase):
    def test_unknown_tone_is_a_raised_question_mark(self):
        self.assertEqual(_tone_to_exponent("ngai_"), "ngaiˀ")
        self.assertEqual(_tone_to_exponent("ngai2"), "ngai²")
        self.assertEqual(split_compact_pinyin_into_syllables("ngai_oi4"), ["ngai_", "oi4"])


class TextBlockTests(SimpleTestCase):
    def test_split_words_and_text_block(self):
        self.assertEqual(split_words("我 «ma'a tinito», 食"), ["我", "«ma'a tinito»,", "食"])
        self.assertEqual(text_block("«ma'a tinito»"), ("ma'a tinito", ""))
        self.assertEqual(text_block("«ma'a»,"), ("ma'a", ","))
        self.assertIsNone(text_block("ma'a"))

    def test_rendering_keeps_the_text_apart(self):
        items = [{"pinyin": p, "hanzi": h} for p, h in [("ngai¹", "我"), ("oi⁴", "爱"), ("shit⁶", "食")]]
        items.append({"pinyin": "ma'a tinito", "hanzi": "ma'a tinito", "text": True})
        self.assertEqual(render_expression_from_token_data(items), "ngai¹ oi⁴ shit⁶ ma'a tinito 我爱食 ma'a tinito")
        self.assertEqual(join_hanzi([("tinito", True), ("，", False), ("食", False)]), "tinito，食")

    def test_split_rendering(self):
        self.assertEqual(split_rendering("ngai¹ oi⁴ shit⁶ ma'a tinito 我爱食 ma'a tinito"),
                         ("ngai¹ oi⁴ shit⁶ ma'a tinito", "我爱食 ma'a tinito"))
        self.assertEqual(split_rendering("ma'a shit⁶ ma'a 食"), ("ma'a shit⁶", "ma'a 食"))
        self.assertEqual(split_rendering("ngai¹ ho³ 我好"), ("ngai¹ ho³", "我好"))
        self.assertEqual(split_rendering("abc"), ("abc", ""))
