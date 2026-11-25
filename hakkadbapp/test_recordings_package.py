"""« À enregistrer » → « Préparer l'import plateforme » : des noms de
fichiers .wav aux éléments de la plateforme (recordings_package.build).

Run: python manage.py test hakkadbapp.test_recordings_package --settings=hakkadbapp.settings_test
"""
from django.test import TestCase

from .audio_names import wav_name
from .models import LexiconAddition, Traces
from .recordings_package import build

PLATFORM = {
    "themes": {"t1": {"translations": {"primary": "Maison", "secondary": "", "target": ""}}},
    "words": {
        "w1": {"audio": "", "themes": ["t1"], "in_expression": [], "translations": {"primary": "maison", "secondary": "house", "target": "wuk⁵ka¹ 屋家"}},
        "w2": {"audio": "uuid-1", "themes": [], "translations": {"primary": "moi", "secondary": "me", "target": "ngai² 我"}},
        "w3": {"audio": "", "themes": [], "translations": {"primary": "aimer", "secondary": "", "target": "oi⁴ 爱"}},
    },
    "expressions": {
        "e1": {"audio": "", "themes": ["t1"], "components": {}, "translations": {"primary": "J'aime ma maison", "secondary": "", "target": "ngai² oi⁴ wuk⁵ka¹ 我爱屋家"}},
    },
}


class RecordingsPackageTest(TestCase):
    def setUp(self):
        Traces.objects.create(platform_data=PLATFORM)

    def test_platform_items_matched_by_file_name(self):
        r = build(["wuk5ka1.wav", "ngai2.wav", "我爱屋家.wav", "inconnu.wav"])
        found = {(i["file"], i["id"], i["has_audio"]) for i in r["items"]}
        self.assertEqual(found, {("wuk5ka1.wav", "w1", False), ("ngai2.wav", "w2", True), ("我爱屋家.wav", "e1", False)})
        self.assertEqual(r["unmatched"], ["inconnu.wav"])
        self.assertEqual(set(r["themes"]), {"t1"})
        # Le JSON de la plateforme, tel quel.
        self.assertEqual(next(i for i in r["items"] if i["id"] == "w1")["payload"], PLATFORM["words"]["w1"])

    def test_validated_additions_as_new_items(self):
        word = LexiconAddition.objects.create(kind="word", status="validated", hanzi="屋下", pinyin="wuk5 ha1",
                                              french="à la maison", themes="Maison")
        expr = LexiconAddition.objects.create(kind="expression", status="validated", hanzi="我 爱 屋下 ，",
                                              pinyin="ngai2 oi4 wuk5 ha1 ，", french="J'aime être chez moi")
        LexiconAddition.objects.create(kind="word", status="draft", hanzi="屋", pinyin="wuk5")
        word.refresh_from_db()
        expr.refresh_from_db()
        r = build([wav_name("wuk5 ha1"), wav_name("我 爱 屋下 ，"), "wuk5.wav"])
        by_id = {i["id"]: i for i in r["items"]}
        self.assertEqual(set(by_id), {word.platform_id, expr.platform_id})
        w = by_id[word.platform_id]["payload"]
        self.assertEqual(w["translations"]["target"], "wuk⁵ha¹ 屋下")
        self.assertEqual(w["themes"], ["t1"])
        self.assertEqual(w["in_expression"], [expr.platform_id])
        e = by_id[expr.platform_id]["payload"]
        self.assertEqual(e["components"], {"ngai² 我": "w2", "oi⁴ 爱": "w3", "wuk⁵ha¹ 屋下": word.platform_id})
        self.assertTrue(e["translations"]["target"].startswith("ngai² oi⁴ wuk⁵ha¹"))
        self.assertEqual(r["unmatched"], ["wuk5.wav"])

    def test_homophones_flagged(self):
        Traces.objects.all().delete()
        data = {**PLATFORM, "words": {**PLATFORM["words"],
                                      "w4": {"audio": "", "themes": [], "translations": {"primary": "hache", "target": "oi⁴ 斧"}}}}
        Traces.objects.create(platform_data=data)
        r = build(["oi4.wav"])
        self.assertEqual(len(r["items"]), 2)
        self.assertTrue(any("homophones" in w for w in r["warnings"]))
