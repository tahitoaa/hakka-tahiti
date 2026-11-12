"""What two entries must share to be reported as duplicates of each other
(addition_duplicates.py), and the keys a visa accepts (visas.py). No
database: only the normalisations are tested.

Run: python manage.py test hakkadbapp.test_duplicates
"""
from django.test import SimpleTestCase

from .addition_duplicates import EN_ARTICLES, FR_ARTICLES, hanzi_key, pinyin_key, senses
from .visas import READING_KEY


class DuplicateKeysTests(SimpleTestCase):
    def test_characters_alone_simplified(self):
        self.assertEqual(hanzi_key("屋家"), "屋家")
        self.assertEqual(hanzi_key("若 爸爸:père 在 屋家 么"), "若爸爸在屋家么")
        self.assertEqual(hanzi_key("蝦公"), hanzi_key("虾公"))
        self.assertEqual(hanzi_key("«ma'a» 食，"), "食")

    def test_pinyin_spaces_and_superscripts_ignored(self):
        self.assertEqual(pinyin_key("wuk⁵ ga¹")[0], pinyin_key("wuk5ga1")[0])
        self.assertEqual(pinyin_key("wuk5 ga1"), ("wuk5ga1", 2))
        self.assertEqual(pinyin_key("«ma'a» xit5")[1], 1)

    def test_senses_without_articles_or_brackets(self):
        self.assertEqual(senses("la maison, le foyer (familial)", FR_ARTICLES), {"maison", "foyer"})
        self.assertEqual(senses("to eat; a meal", EN_ARTICLES), {"eat", "meal"})
        self.assertEqual(senses("", FR_ARTICLES), set())

    def test_reading_visa_keys(self):
        for key in ("家|ka1", "𠾒|nga1", "家|ngai_"):
            self.assertTrue(READING_KEY.match(key), key)
        for key in ("家", "家|", "家|ka1|x", "abc|ka1"):
            self.assertFalse(READING_KEY.match(key), key)
