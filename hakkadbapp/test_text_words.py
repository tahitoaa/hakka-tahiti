"""Words written without characters (Tahitian, French, proper names) in an
expression: copied as written in both halves of the rendering.

Run with: python manage.py test hakkadbapp.test_text_words
"""
from django.test import SimpleTestCase

from hakkadbapp.text_to_words import is_text_word, join_hanzi, render_expression_from_token_data, split_rendering


class TextWordTests(SimpleTestCase):
    def test_is_text_word(self):
        for word in ["ma'a", "tinito", "Raiatea", "ma'a:nourriture"]:
            self.assertTrue(is_text_word(word), word)
        for word in ["ngai2", "ngai_", "ngai¹", "我", "-(man4)", "-", ",", ""]:
            self.assertFalse(is_text_word(word), word)

    def test_rendering_keeps_text_words_apart(self):
        tokens = [("ngai¹", "我"), ("oi⁴", "爱"), ("shit⁶", "食"), ("ma'a", "ma'a"), ("tinito", "tinito")]
        rendering = render_expression_from_token_data([{"pinyin": p, "hanzi": h} for p, h in tokens])
        self.assertEqual(rendering, "ngai¹ oi⁴ shit⁶ ma'a tinito 我爱食 ma'a tinito")
        self.assertEqual(join_hanzi(["tinito", "，", "食"]), "tinito，食")

    def test_split_rendering(self):
        self.assertEqual(split_rendering("ngai¹ oi⁴ shit⁶ ma'a tinito 我爱食 ma'a tinito"),
                         ("ngai¹ oi⁴ shit⁶ ma'a tinito", "我爱食 ma'a tinito"))
        self.assertEqual(split_rendering("ma'a shit⁶ ma'a 食"), ("ma'a shit⁶", "ma'a 食"))
        self.assertEqual(split_rendering("ngai¹ ho³ 我好"), ("ngai¹ ho³", "我好"))
        self.assertEqual(split_rendering("abc"), ("abc", ""))
