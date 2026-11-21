"""« Rechercher » (search_sources.py) : la lecture de la requête et les scores,
sans base de données.

Run: python manage.py test hakkadbapp
"""
from django.test import SimpleTestCase

from .search_sources import fold, han_score, parse_query, reading_key, reading_score, sense_score


class QueryTests(SimpleTestCase):
    def test_characters_simplified_and_traditional(self):
        q = parse_query(" 屋家 ")
        self.assertEqual(q["han"], "屋家")
        self.assertFalse(q["reading"])
        self.assertIn("屋家", q["forms"])
        self.assertEqual(parse_query("發")["han"], "发")
        self.assertIn("發", parse_query("发")["forms"])

    def test_letters_are_reading_and_sense(self):
        q = parse_query("Maisón")
        self.assertEqual((q["han"], q["reading"], q["sense"]), ("", "maison", "maison"))
        self.assertEqual(reading_key("zen¹ lao¹"), "zenlao")
        self.assertEqual(reading_key("wuk5 ka1"), "wukka")
        self.assertEqual(fold("Été"), "ete")


class ScoreTests(SimpleTestCase):
    def test_han_score(self):
        q = parse_query("屋")
        self.assertEqual(han_score(q, "屋"), 3)
        self.assertEqual(han_score(q, "屋家"), 2)
        self.assertEqual(han_score(q, "转 屋家"), 1)
        self.assertEqual(han_score(q, "家"), 0)
        self.assertEqual(han_score(parse_query("发"), "發財"), 2)

    def test_reading_score(self):
        self.assertEqual(reading_score("zenlao", "zen¹lao¹"), 3)
        self.assertEqual(reading_score("zen", "zen¹lao¹"), 2)
        self.assertEqual(reading_score("lao", "zen¹lao¹"), 0)   # trop court pour « contient »
        self.assertEqual(reading_score("", "zen¹"), 0)

    def test_sense_score(self):
        self.assertEqual(sense_score("maison", "la maison"), 3)
        self.assertEqual(sense_score("eat", "to eat"), 3)
        self.assertEqual(sense_score("maison", "aller à la maison"), 2)
        self.assertEqual(sense_score("maison", "maison, foyer"), 3)
        self.assertEqual(sense_score("maison", "maisonnette"), 1)
        self.assertEqual(sense_score("ma", "maison"), 0)
        self.assertEqual(sense_score("ete", "l'été"), 3)
