"""What two entries must share to be reported as duplicates of each other
(addition_duplicates.py), and the keys a visa accepts (visas.py). No
database: only the normalisations are tested.

Run: python manage.py test hakkadbapp.test_duplicates
"""
from django.test import SimpleTestCase

from .addition_duplicates import EN_ARTICLES, FR_ARTICLES, classify, hanzi_key, pinyin_key, senses
from .visas import READING_KEY


def item(hanzi, pinyin, french="", english=""):
    key, syllables = pinyin_key(pinyin)
    return {"_hanzi": hanzi_key(hanzi), "_pinyin": key, "_syllables": syllables,
            "_fr": senses(french, FR_ARTICLES), "_en": senses(english, EN_ARTICLES)}


def relation(a, b):
    fields = set()
    if a["_hanzi"] and a["_hanzi"] == b["_hanzi"]:
        fields.add("hakka")
    if a["_pinyin"] and a["_pinyin"] == b["_pinyin"]:
        fields.add("pinyin")
    if a["_fr"] & b["_fr"]:
        fields.add("french")
    if a["_en"] & b["_en"]:
        fields.add("english")
    return classify(a, b, fields)


class MergeTests(SimpleTestCase):
    def test_senses_and_lists(self):
        from .addition_merge import merge_list, merge_senses
        self.assertEqual(merge_senses("maison", "la maison, foyer", FR_ARTICLES), "maison, foyer")
        self.assertEqual(merge_senses("", "foyer", FR_ARTICLES), "foyer")
        self.assertEqual(merge_senses("maison", "", FR_ARTICLES), "maison")
        self.assertEqual(merge_list("Maison, Famille", "famille, Vie"), "Maison, Famille, Vie")

    def test_additions(self):
        from .addition_merge import merge_additions
        from .models import LexiconAddition
        keep = LexiconAddition(hanzi="屋家", pinyin="wuk5 ga1", french="maison", english="house", themes="Maison")
        other = LexiconAddition(hanzi="屋下", pinyin="vuk5 ha1", french="foyer", english="house", themes="Famille",
                                observations="entendu à Moiwu")
        changed = merge_additions(keep, other)
        self.assertEqual((keep.hanzi, keep.french, keep.english, keep.themes), ("屋家", "maison, foyer", "house", "Maison, Famille"))
        self.assertIn("entendu à Moiwu", keep.observations)
        self.assertIn("autres caractères : 屋下", keep.observations)
        self.assertIn("autre pinyin : vuk5 ha1", keep.observations)
        self.assertNotIn("english", changed)

    def test_lexicon_remarks(self):
        from .addition_merge import lexicon_remarks
        from .models import LexiconAddition
        entry = {"hanzi": "屋家", "pinyin": "wuk5 ga1", "french": "maison", "english": "house", "themes": ""}
        same = LexiconAddition(hanzi="屋家", pinyin="wuk5ga1", french="la maison", english="house")
        self.assertEqual(lexicon_remarks(same, entry), [])
        more = LexiconAddition(hanzi="屋家", pinyin="wuk5 ka1", french="foyer", english="house")
        remarks = lexicon_remarks(more, entry)
        self.assertEqual([(r["kind"], r["field"]) for r in remarks], [("correction", "french"), ("comment", "")])
        self.assertEqual(remarks[0]["proposed_value"], "maison, foyer")
        self.assertIn("wuk5 ka1", remarks[1]["text"])


class RelationTests(SimpleTestCase):
    def test_relations(self):
        house = item("屋家", "wuk5 ga1", "maison", "house")
        self.assertEqual(relation(house, item("屋家", "wuk5ga1", "la maison, le foyer")), "exact")
        self.assertEqual(relation(house, item("屋家", "wuk5 ga1")), "exact")  # nothing to compare
        self.assertEqual(relation(house, item("屋家", "wuk5 ga1", "foyer", "home")), "translation")
        self.assertEqual(relation(house, item("屋家", "wuk5 ka1", "maison")), "reading")
        self.assertEqual(relation(house, item("屋下", "wuk5 ga1", "maison")), "spelling")
        self.assertEqual(relation(house, item("屋下", "vuk5 ha1", "la maison")), "synonym")
        self.assertEqual(relation(house, item("烏痂", "wuk5 ga1", "croûte")), "homophone")
        self.assertEqual(relation(house, item("房", "fong2", "chambre", "house")), "sense_en")

    def test_one_syllable_homophone_not_reported(self):
        self.assertIsNone(relation(item("食", "sit8", "manger"), item("蝕", "sit8", "perdre")))
        self.assertEqual(relation(item("食", "sit8", "manger"), item("𩛩", "sit8", "manger")), "spelling")


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
