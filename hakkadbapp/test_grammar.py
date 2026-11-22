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
from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from . import grammar_analysis as ga
from . import search_sources
from .models import GrammarExample, GrammarRule, GrammarTag, LexiconAddition, SentenceAnalysis, SharedTranscript

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


# ---- Étiquettes, analyses, schémas (grammar_analysis.py) -------------------------------------------

def _tags():
    raw = [(1, "category", "PRO", "pronom", None), (2, "category", "NÉG", "négation", None), (3, "category", "V", "verbe", None),
           (4, "category", "Vmvt", "verbe de mouvement", 3), (5, "phrase", "GN", "groupe nominal", None),
           (6, "phrase", "GV", "groupe verbal", None), (7, "function", "sujet", "sujet", None), (8, "phrase", "P", "phrase", None)]
    return ga.Tags([GrammarTag(id=i, kind=k, code=c, name=n, parent_id=p) for i, k, c, n, p in raw])


class PatternTests(SimpleTestCase):
    # 佢 唔 來 : [P [GN:sujet 佢/PRO] [GV 唔/NÉG 來/Vmvt]]
    tokens = [{"t": "佢", "p": "ki2", "c": 1, "f": None}, {"t": "唔", "p": "m2", "c": 2, "f": None},
              {"t": "來", "p": "loi2", "c": 4, "f": None}]
    groups = [{"s": 0, "e": 3, "c": 8, "f": None}, {"s": 0, "e": 1, "c": 5, "f": 7}, {"s": 1, "e": 3, "c": 6, "f": None}]

    def match(self, pattern):
        return ga.match(ga.parse_pattern(pattern, _tags()), self.tokens, self.groups, _tags())

    def test_parts(self):
        parts = ga.parse_pattern("GN:sujet + négation + V (+ GN:obj)", _tags())
        self.assertEqual([p["kind"] for p in parts], ["tag", "tag", "tag", "unknown"])
        self.assertTrue(parts[3]["optional"])
        self.assertEqual([p["kind"] for p in ga.parse_pattern("唔 + … + ng2", _tags())], ["word", "any", "reading"])

    def test_match(self):
        self.assertEqual(self.match("GN:sujet + NÉG + V"), (0, 3))      # V accepte « V de mouvement »
        self.assertEqual(self.match("NÉG + V"), (1, 3))
        self.assertEqual(self.match("GN + GV"), (0, 3))
        self.assertEqual(self.match("唔 + V"), (1, 3))
        self.assertEqual(self.match("m + loi2"), (1, 3))               # lecture sans ton, avec ton
        self.assertEqual(self.match("PRO + … + V"), (0, 3))
        self.assertEqual(self.match("PRO + (NÉG) + V"), (0, 3))
        self.assertIsNone(self.match("V + NÉG"))
        self.assertIsNone(self.match("GV:sujet"))
        self.assertEqual(self.match("PRO|V + NÉG"), (0, 2))

    def test_check(self):
        tags = _tags()
        self.assertIsInstance(ga.check(self.tokens, self.groups, tags), tuple)
        self.assertIn("chevauchent", ga.check(self.tokens, [{"s": 0, "e": 2}, {"s": 1, "e": 3}], tags))
        self.assertIn("sort", ga.check(self.tokens, [{"s": 0, "e": 4}], tags))
        # An id of the wrong kind is dropped: a function as a category.
        tokens, _groups = ga.check([{"t": "佢", "c": 7}], [], tags)
        self.assertIsNone(tokens[0]["c"])
        self.assertEqual(ga.bracketed(self.tokens, self.groups, tags), "[P [GN:sujet 佢/PRO] [GV 唔/NÉG 來/Vmvt]]")


@unittest.skipUnless(SQLITE, "réglages de test (SQLite) seulement")
class AnalysisTests(TestCase):
    databases = {"default"} if SQLITE else set()

    def setUp(self):
        search_sources._cache.clear()
        self.client.force_login(User.objects.create_superuser("owner", password="x"))
        self.addition = LexiconAddition.objects.create(kind="expression", status="review", hanzi="佢 唔 來",
                                                       pinyin="ki2 m2 loi2", french="il ne vient pas")
        self.key = {"target_type": "addition", "target_key": str(self.addition.id)}

    def post(self, name, **body):
        return self.client.post(reverse(name), json.dumps(body), content_type="application/json")

    def tag(self, code):
        return GrammarTag.objects.get(code=code).id

    def test_tags(self):
        self.assertEqual(self.post("grammar_tag", action="seed").json()["created"], len(ga.SEED))
        self.assertEqual(self.post("grammar_tag", action="seed").json()["created"], 0)
        self.assertEqual(self.post("grammar_tag", action="create", kind="category", code="v").status_code, 409)
        vm = self.post("grammar_tag", action="create", kind="category", code="Vmvt", parent=self.tag("V")).json()["id"]
        self.assertEqual(self.post("grammar_tag", action="update", id=self.tag("V"), parent=vm).status_code, 400)
        self.assertEqual(self.post("grammar_tag", action="create", kind="phrase", code="X", parent=vm).status_code, 400)

    def test_draft_save_conform_search(self):
        self.post("grammar_tag", action="seed")
        data = self.client.get(reverse("grammar_analysis"), {"type": "addition", "key": str(self.addition.id)}).json()
        self.assertIsNone(data["analysis"])
        self.assertEqual([t["t"] for t in data["draft"]], ["佢", "唔", "來"])
        self.assertEqual([t["p"] for t in data["draft"]], ["ki2", "m2", "loi2"])
        tokens = [{"t": "佢", "p": "ki2", "c": self.tag("PRO")}, {"t": "唔", "p": "m2", "c": self.tag("NÉG")},
                  {"t": "來", "p": "loi2", "c": self.tag("V")}]
        bad = self.post("grammar_analysis_save", action="save", **self.key, tokens=tokens, groups=[{"s": 0, "e": 2}, {"s": 1, "e": 3}])
        self.assertEqual(bad.status_code, 400)
        ok = self.post("grammar_analysis_save", action="save", **self.key, tokens=tokens,
                       groups=[{"s": 0, "e": 1, "c": self.tag("GN"), "f": self.tag("sujet")}, {"s": 1, "e": 3, "c": self.tag("GV")}])
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["bracketed"], "[GN:sujet 佢/PRO] [GV 唔/NÉG 來/V]")
        # The categories already given are guessed for the next sentence.
        self.assertEqual(ga.guesses()["唔"], self.tag("NÉG"))

        rule = GrammarRule.objects.create(title="La négation", pattern="GN:sujet + NÉG + V")
        self.post("grammar_example", action="add", rule=rule.id, **self.key)
        example = self.client.get(reverse("grammar_tree"), HTTP_ACCEPT="application/json").json()["rules"][0]["examples"][0]
        self.assertEqual(example["conforms"], {"ok": True, "span": [0, 3]})
        found = self.client.get(reverse("grammar_sentences"), {"schema": rule.id}).json()["items"]
        self.assertEqual([s["target_key"] for s in found], [str(self.addition.id)])
        rule.pattern = "V + NÉG"
        rule.save()
        self.assertEqual(self.client.get(reverse("grammar_sentences"), {"schema": rule.id}).json()["items"], [])
        # A used tag isn't deleted by accident; forced, it leaves the analyses.
        self.assertEqual(self.post("grammar_tag", action="delete", id=self.tag("NÉG")).status_code, 409)
        self.post("grammar_tag", action="delete", id=self.tag("NÉG"), force=True)
        self.assertIsNone(SentenceAnalysis.objects.get().tokens[1]["c"])

    def test_ai_proposal_applied(self):
        self.post("grammar_tag", action="seed")
        tokens = [{"t": "佢", "p": "ki2"}, {"t": "唔", "p": "m2"}, {"t": "來", "p": "loi2"}]
        out = ga.apply_proposal({
            "words": [{"category": "PRO", "function": "", "gloss": "il"}, {"category": "NÉGX", "function": "", "gloss": "ne…pas"},
                      {"category": "V", "function": "", "gloss": "venir"}],
            "groups": [{"start": 0, "end": 1, "category": "GN", "function": "sujet"},
                       {"start": 1, "end": 3, "category": "GV", "function": "préd"},
                       {"start": 0, "end": 2, "category": "GV", "function": ""}],
            "new_tags": [{"kind": "category", "code": "NÉGX", "name": "négation x", "description": ""}],
            "explanation": "x", "confidence": "haute"}, ga.check(tokens, [], ga.Tags())[0], ga.Tags())
        self.assertEqual(out["new_tags"], ["NÉGX"])
        self.assertEqual(GrammarTag.objects.get(code="NÉGX").status, GrammarTag.STATUS_PROPOSED)
        self.assertEqual(out["tokens"][1]["c"], self.tag("NÉGX"))
        # The crossing group (0–2 against 1–3) is dropped.
        self.assertEqual([(g["s"], g["e"]) for g in out["groups"]], [(0, 1), (1, 3)])
