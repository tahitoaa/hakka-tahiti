"""An incomplete addition stays a draft: it can be neither proposed for
validation nor validated (additions.incomplete_refused).

No database (SimpleTestCase): the additions are built, never saved.
Run: python manage.py test hakkadbapp.test_incomplete
"""
from django.test import SimpleTestCase

from .additions import incomplete_refused
from .models import LexiconAddition

DRAFT, REVIEW, VALIDATED = LexiconAddition.STATUS_DRAFT, LexiconAddition.STATUS_REVIEW, LexiconAddition.STATUS_VALIDATED


def addition(**fields):
    values = {"kind": LexiconAddition.KIND_WORD, "hanzi": "屋家", "pinyin": "wuk5ka1", "french": "maison", "english": "house"}
    values.update(fields)
    return LexiconAddition(**values)


class IncompleteAdditionTest(SimpleTestCase):
    def test_complete_can_go_anywhere(self):
        for status in (DRAFT, REVIEW, VALIDATED):
            self.assertIsNone(incomplete_refused(addition(), status))

    def test_incomplete_stays_a_draft(self):
        for fields, missing in (({"english": ""}, "anglais"), ({"french": " "}, "français"),
                                ({"pinyin": "wuk5ka1/ga1"}, "pinyin sûr"), ({"pinyin": ""}, "pinyin")):
            a = addition(**fields)
            self.assertIsNone(incomplete_refused(a, DRAFT))
            review = incomplete_refused(a, REVIEW)
            self.assertIn("proposer à la validation", review)
            self.assertIn(missing, review)
            self.assertIn("valider", incomplete_refused(a, VALIDATED))

    def test_text_block_is_no_unsure_reading(self):
        a = addition(kind=LexiconAddition.KIND_EXPRESSION, hanzi="我 «ma'a?»", pinyin="ngai1 «ma'a?»")
        self.assertIsNone(incomplete_refused(a, REVIEW))
