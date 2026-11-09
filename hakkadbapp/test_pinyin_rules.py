"""Readings from elsewhere set in Wenfa's pinyin (pinyin_rules), with the
examples of Wen Fa's pronunciation guide (February 2026).

Run with: python manage.py test hakkadbapp.test_pinyin_rules
"""
from django.test import SimpleTestCase

from hakkadbapp.pinyin_rules import normalize, normalize_note, violations


class NormalizeTests(SimpleTestCase):
    def fixed(self, text):
        return normalize(text)[0]

    def test_x_j_q_before_i(self):
        self.assertEqual(self.fixed("si1"), "xi1")          # 西
        self.assertEqual(self.fixed("zi3 moi4"), "ji3 moi4")  # 姊妹
        self.assertEqual(self.fixed("cit5"), "qit5")        # 七
        self.assertEqual(self.fixed("zhi1 chi2"), "ji1 qi2")
        self.assertEqual(self.fixed("shit6"), "shit6", "sh may be followed by i")
        self.assertEqual(self.fixed("sü1 zü3 cü4"), "sü1 zü3 cü4")

    def test_entering_tones_7_8_become_5_6(self):
        self.assertEqual(self.fixed("sit7"), "xit5")
        self.assertEqual(self.fixed("hok8"), "hok6")
        # Numbered like Bao'an (7 and 8 present): its 5 is the departing tone, Wenfa 4.
        self.assertEqual(self.fixed("kon5 hok8"), "kon4 hok6")
        self.assertEqual(self.fixed("ga¹ka⁵ hok⁸"), "ga¹ka⁴ hok⁶", "superscripts stay superscripts")
        # Without 7 or 8, a 5 is left for violations() to report.
        self.assertEqual(self.fixed("ka5"), "ka5")

    def test_stops_p_t_k(self):
        self.assertEqual(self.fixed("zhug5"), "zhuk5")      # 竹
        self.assertEqual(self.fixed("bed5"), "bet5")
        self.assertEqual(self.fixed("gong1"), "gong1", "ng is no stop")

    def test_y_w_e(self):
        self.assertEqual(self.fixed("iao1 iu1 i1 iam2 in1"), "yao1 yu1 yi1 yam2 yin1")  # 腰 有 衣 盐 因
        self.assertEqual(self.fixed("vun2"), "wun2")
        self.assertEqual(self.fixed("wi2"), "wui2")         # 围
        self.assertEqual(self.fixed("hêt5"), "het5")

    def test_left_alone(self):
        self.assertEqual(normalize("wuk5ka1 ngin2"), ("wuk5ka1 ngin2", []))
        self.assertEqual(self.fixed("ngai2 oi4 «si1 ma'a»"), "ngai2 oi4 «si1 ma'a»", "text between « » is kept as written")
        self.assertEqual(self.fixed("maison si"), "maison si", "a word without a tone may be French")
        self.assertEqual(self.fixed("Si1"), "Xi1")

    def test_notes(self):
        text, notes = normalize("si1 sit7")
        self.assertEqual(notes, ["si1 → xi1", "sit7 → xit5"])
        self.assertEqual(normalize_note(notes), "lecture mise en pinyin Wenfa : si1 → xi1, sit7 → xit5")
        self.assertEqual(normalize_note([]), "")


class ViolationTests(SimpleTestCase):
    def test_what_cannot_be_fixed_is_reported(self):
        problems = " ".join(violations("ju1 rat5 bak2 ka5 ngin8"))
        for expected in ("j, q, x", "pas de r", "prend le ton 5 ou 6", "réservés aux finales", "pas de ton 8"):
            self.assertIn(expected, problems)

    def test_a_correct_reading(self):
        self.assertEqual(violations("ngai2 oi4 shit6 wuk5ka1 xi1 qit5 yao1 wui2 sü1"), [])


class CheckPinyinTests(SimpleTestCase):
    """« Vérifier le pinyin » (Suivi, Brouillons / À valider) on one addition, without the database."""

    def addition(self, pinyin, status="draft"):
        from unittest import mock

        from hakkadbapp.models import LexiconAddition

        a = LexiconAddition(id=1, hanzi="西", pinyin=pinyin, status=status, observations="Importé.")
        a.save = mock.Mock()
        return a

    def test_fixed_and_noted(self):
        from hakkadbapp.additions import check_pinyin

        a = self.addition("si1")
        report = check_pinyin(a, True, None)
        self.assertEqual(a.pinyin, "xi1")
        self.assertEqual(a.observations, "Importé. Lecture mise en pinyin Wenfa : si1 → xi1.")
        a.save.assert_called_once()
        self.assertEqual((report["fixes"], report["pending"], report["problems"]), (["si1 → xi1"], [], []))

    def test_not_allowed_left_pending(self):
        from hakkadbapp.additions import check_pinyin

        a = self.addition("si1", status="validated")
        report = check_pinyin(a, False, None)
        self.assertEqual(a.pinyin, "si1")
        a.save.assert_not_called()
        self.assertEqual(report["pending"], ["si1 → xi1"])

    def test_what_is_left_to_look_at(self):
        from hakkadbapp.additions import check_pinyin

        report = check_pinyin(self.addition("gok3"), True, None)
        self.assertEqual(report["fixes"], [])
        self.assertTrue(report["problems"])
        self.assertEqual(check_pinyin(self.addition(""), True, None)["problems"], ["lecture vide"])
