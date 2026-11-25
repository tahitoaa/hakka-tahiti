"""« Analyse du lexique » → « Importer un export de la plateforme »
(platform_upload.import_corpus) : platform_to_vercel --yes depuis le site.

Run: python manage.py test hakkadbapp.test_platform_upload --settings=hakkadbapp.settings_test
"""
import gzip
import json

from django.contrib.auth.models import User
from django.test import TestCase

from .models import Expression, Traces, Word

CORPUS = {
    "themes": {"t1": {"translations": {"primary": "Maison", "secondary": "Home", "target": ""}}},
    "words": {
        "w1": {"audio": "", "themes": ["t1"], "in_expression": ["e1"], "translations": {"primary": "maison", "secondary": "house", "target": "wuk⁵ka¹ 屋家"}},
        "w2": {"audio": "a-1", "themes": [], "in_expression": ["e1"], "translations": {"primary": "moi", "secondary": "me", "target": "ngai² 我"}},
    },
    "expressions": {
        "e1": {"audio": "", "themes": ["t1"], "components": {"ngai² 我": "w2", "wuk⁵ka¹ 屋家": "w1"},
               "translations": {"primary": "ma maison", "secondary": "my house", "target": "ngai² wuk⁵ka¹ 我屋家"}},
    },
}


class PlatformUploadTest(TestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser("tahit", password="x")
        self.member = User.objects.create_user("membre", password="x")

    def post(self, data):
        return self.client.post("/api/plateforme/importer", gzip.compress(json.dumps(data).encode()),
                                content_type="application/json", HTTP_CONTENT_ENCODING="gzip")

    def test_owner_only(self):
        self.client.force_login(self.member)
        self.assertEqual(self.post({"source": "x.zip", **CORPUS}).status_code, 403)

    def test_import_replaces_the_lexicon_and_keeps_the_snapshot(self):
        self.client.force_login(self.owner)
        r = self.post({"source": "export.zip", **CORPUS})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["words"], 2)
        self.assertEqual(set(Word.objects.values_list("platform_id", flat=True)), {"w1", "w2"})
        self.assertEqual(list(Expression.objects.values_list("platform_id", flat=True)), ["e1"])
        snapshot = Traces.objects.exclude(platform_data=None).latest("timestamp")
        self.assertEqual(snapshot.platform_data["words"]["w2"]["audio"], "a-1")
        self.assertIn("export.zip", snapshot.platform_data["corpus_dir"])

    def test_a_much_smaller_corpus_needs_force(self):
        self.client.force_login(self.owner)
        big = {**CORPUS, "words": {**CORPUS["words"], **{f"x{i}": {"translations": {"primary": "p", "target": f"a{i}¹ 甲"}} for i in range(8)}}}
        self.assertEqual(self.post({"source": "full.zip", **big}).status_code, 200)
        r = self.post({"source": "petit.zip", **CORPUS})
        self.assertEqual(r.status_code, 409)
        self.assertTrue(r.json()["shrink"])
        latest = lambda: len(Traces.objects.exclude(platform_data=None).latest("timestamp").platform_data["words"])
        self.assertEqual(latest(), 10)  # rien d'importé
        self.assertEqual(self.post({"source": "petit.zip", "force": True, **CORPUS}).status_code, 200)
        self.assertEqual(latest(), 2)

    def test_not_a_platform_corpus(self):
        self.client.force_login(self.owner)
        r = self.post({"source": "x.zip", "words": {"w1": "texte"}, "expressions": CORPUS["expressions"], "themes": {}})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(Word.objects.count(), 0)
