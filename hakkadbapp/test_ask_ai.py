"""« Demander à l'IA »: the AI's new version of an entry, as the lexicon stores it.

Run with: python manage.py test hakkadbapp.test_ask_ai
"""
from django.test import SimpleTestCase

from hakkadbapp.ask_ai import build_proposal

READINGS = {"我": {"ngai2"}, "爱": {"oi4"}, "食": {"shit6"}, "饭": {"fan4"}}


class BuildProposalTests(SimpleTestCase):
    def test_an_expression(self):
        p = build_proposal({"kind": "expression", "french": "j'aime manger.", "english": "I like eating", "words": [
            {"hanzi": "我", "reading": "ngai2"}, {"hanzi": "爱", "reading": "oi4"}, {"hanzi": "食饭", "reading": "shit6 fan4"}]}, READINGS)
        self.assertEqual((p["kind"], p["hanzi"], p["pinyin"]), ("expression", "我 爱 食饭", "ngai2 oi4 shit6fan4"))
        self.assertEqual(p["notes"], [])

    def test_readings_in_wenfa_and_checked_against_the_lexicon(self):
        p = build_proposal({"kind": "expression", "french": "", "english": "", "words": [
            {"hanzi": "我", "reading": "ngai1"}, {"hanzi": "西", "reading": "si1"}]}, READINGS)
        self.assertEqual(p["pinyin"], "ngai1 xi1", "si1 set in Wenfa's pinyin")
        notes = " ".join(p["notes"])
        self.assertIn("我 lu ngai1, le lexique a ngai2", notes)
        self.assertIn("西 (xi1) : caractère absent du lexique", notes)
        self.assertIn("si1 → xi1", notes)

    def test_a_word_and_nothing(self):
        p = build_proposal({"kind": "word", "french": "manger", "english": "eat", "words": [{"hanzi": "食", "reading": "shit6"}]}, READINGS)
        self.assertEqual((p["kind"], p["hanzi"], p["pinyin"]), ("word", "食", "shit6"))
        self.assertIsNone(build_proposal({"kind": "word", "french": "", "english": "", "words": []}, READINGS))
