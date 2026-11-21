"""« Grammaire » (grammar.py) : l'arbre, les exemples, les droits.

Ces tests ont besoin d'une base : ils ne tournent qu'avec SQLite en mémoire,
jamais sur la base de production de .env. Lancer :
    python manage.py test hakkadbapp --settings=hakkadbapp.settings_test
Avec les réglages normaux, ils sont sautés, sans créer de base de test.
"""
import json
import unittest
import uuid

from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from . import search_sources
from .models import GrammarExample, GrammarRule, LexiconAddition, SharedTranscript

SQLITE = settings.DATABASES["default"]["ENGINE"].endswith("sqlite3")


@unittest.skipUnless(SQLITE, "réglages de test (SQLite) seulement")
class GrammarTests(TestCase):
    databases = {"default"} if SQLITE else set()

    def setUp(self):
        search_sources._cache.clear()
        self.owner = User.objects.create_superuser("owner", password="x")
        self.client.force_login(self.owner)

    def post(self, name, **body):
        return self.client.post(reverse(name), json.dumps(body), content_type="application/json")

    def titles(self, parent=None):
        return list(GrammarRule.objects.filter(parent_id=parent).order_by("position").values_list("title", flat=True))

    def test_owner_only(self):
        editor = User.objects.create_user("editor", password="x")
        self.client.force_login(editor)
        self.assertEqual(self.client.get(reverse("grammar_tree"), HTTP_ACCEPT="application/json").status_code, 403)
        self.assertEqual(self.post("grammar_rule", action="create", title="x").status_code, 403)
        self.assertEqual(self.client.get(reverse("grammar")).status_code, 403)

    def test_pages_render(self):
        self.assertContains(self.client.get(reverse("grammar")), "gr-tree")
        self.assertContains(self.client.get(reverse("rechercher"), {"q": "唔"}), "rs-results")
        self.assertEqual(self.client.get(reverse("api_rechercher"), {"q": "maison"}).status_code, 200)

    def test_tree_create_move_delete(self):
        neg = self.post("grammar_rule", action="create", parent=None, title="La négation").json()["id"]
        a = self.post("grammar_rule", action="create", parent=neg, title="Au présent").json()["id"]
        b = self.post("grammar_rule", action="create", parent=neg, title="Au passé").json()["id"]
        self.assertEqual(self.titles(neg), ["Au présent", "Au passé"])
        self.post("grammar_rule", action="move", id=b, direction="up")
        self.assertEqual(self.titles(neg), ["Au passé", "Au présent"])
        # → : « Au présent » under « Au passé » ; ← : back after it.
        self.assertEqual(self.post("grammar_rule", action="move", id=a, direction="indent").status_code, 200)
        self.assertEqual(GrammarRule.objects.get(id=a).parent_id, b)
        self.post("grammar_rule", action="move", id=a, direction="outdent")
        self.assertEqual(self.titles(neg), ["Au passé", "Au présent"])
        self.assertEqual(self.post("grammar_rule", action="move", id=neg, direction="outdent").status_code, 409)
        # A rule with children isn't deleted by accident.
        self.assertEqual(self.post("grammar_rule", action="delete", id=neg).status_code, 409)
        self.post("grammar_rule", action="update", id=a, title="  Au   présent ", pattern="S + ng² + V")
        self.assertEqual(GrammarRule.objects.get(id=a).title, "Au présent")
        self.assertEqual(self.post("grammar_rule", action="delete", id=neg, with_children=True).status_code, 200)
        self.assertFalse(GrammarRule.objects.exists())

    def test_examples_follow_the_sentence(self):
        rule = GrammarRule.objects.create(title="La négation")
        addition = LexiconAddition.objects.create(kind="expression", status="review", hanzi="我 唔 食",
                                                  pinyin="ngai1 m2 shit6", french="je ne mange pas")
        transcript = SharedTranscript.objects.create(eaf_urn="urn:x", title="Repas", data={
            "participants": [{"name": "A"}],
            "segments": [{"start": 0, "end": 900, "speaker": 0, "hanzi": "你好", "translation": "bonjour"},
                         {"start": 1000, "end": 2000, "speaker": 0, "hanzi": "佢唔来", "translation": "il ne vient pas"}]})
        found = self.client.get(reverse("grammar_sentences"), {"q": "唔"}).json()["items"]
        keys = {(s["target_type"], s["target_key"]) for s in found}
        self.assertIn(("addition", str(addition.id)), keys)
        self.assertIn(("segment", f"{transcript.id}@1000"), keys)
        self.assertNotIn(("segment", f"{transcript.id}@0"), keys)
        segment = next(s for s in found if s["target_type"] == "segment")
        self.assertTrue(segment["link"].endswith("?seg=2"))

        self.post("grammar_example", action="add", rule=rule.id, target_type="addition", target_key=str(addition.id), focus="唔")
        self.post("grammar_example", action="add", rule=rule.id, target_type="segment", target_key=f"{transcript.id}@1000")
        self.assertEqual(self.post("grammar_example", action="add", rule=rule.id, target_type="segment",
                                   target_key=f"{uuid.uuid4()}@5").status_code, 404)
        # The sentence corrected: the example shows it as it is now.
        addition.french = "je ne mange point"
        addition.save()
        examples = self.client.get(reverse("grammar_tree"), HTTP_ACCEPT="application/json").json()["rules"][0]["examples"]
        self.assertEqual([e["french"] for e in examples], ["je ne mange point", "il ne vient pas"])
        self.assertEqual(examples[0]["focus"], "唔")
        # Gone: shown from its label.
        transcript.data = {"participants": [], "segments": []}
        transcript.save()
        examples = self.client.get(reverse("grammar_tree"), HTTP_ACCEPT="application/json").json()["rules"][0]["examples"]
        self.assertTrue(examples[1]["missing"])
        self.assertIn("佢唔来", examples[1]["label"])
        # « libres » : the sentences no rule quotes yet.
        free = self.client.get(reverse("grammar_sentences"), {"q": "唔", "libres": "1"}).json()["items"]
        self.assertNotIn(("addition", str(addition.id)), {(s["target_type"], s["target_key"]) for s in free})
        self.assertEqual(GrammarExample.objects.count(), 2)
