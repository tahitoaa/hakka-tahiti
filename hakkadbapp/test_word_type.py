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


class OnomatopoeiaTest(SimpleTestCase):
    """An onomatopoeia: its French and English say so, whatever was typed."""

    def test_locked(self):
        a = LexiconAddition(kind=LexiconAddition.KIND_WORD)
        _apply_payload(a, {"hanzi": "嘭", "pinyin": "pang1", "french": "boum", "english": "bang", "word_type": "onomatopée"})
        self.assertEqual((a.french, a.english), ("onomatopée", "onomatopoeia"))
        # Another type: what was typed.
        b = LexiconAddition(kind=LexiconAddition.KIND_WORD)
        _apply_payload(b, {"hanzi": "嘭", "pinyin": "pang1", "french": "boum", "english": "bang", "word_type": "emprunt anglais"})
        self.assertEqual((b.french, b.english), ("boum", "bang"))

    def test_an_expression_has_no_type(self):
        e = LexiconAddition(kind=LexiconAddition.KIND_EXPRESSION)
        _apply_payload(e, {"hanzi": "我 嘭", "pinyin": "ngai1 pang1", "french": "moi boum", "word_type": "onomatopée"})
        self.assertEqual((e.word_type, e.french), ("", "moi boum"))


class OccurrenceTokensTest(SimpleTestCase):
    """The words of an expression, to find where a word is used (additions.occurrences)."""

    def test_words_of_a_maillage(self):
        from .additions import _word_tokens
        self.assertEqual(_word_tokens("若 爸爸(ba1ba1) 在 屋家:maison 么 ?"), {"若", "爸爸", "在", "屋家", "么"})
        # In its simplified form: a traditional spelling finds the same word.
        self.assertIn("屋家", _word_tokens("屋家，"))
        self.assertIn("头发", _word_tokens("頭髮"))
