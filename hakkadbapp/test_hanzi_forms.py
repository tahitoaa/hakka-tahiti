"""Every simplified / traditional form of a character (models.hanzi_forms),
and the table the pages get to recognise them (hanzi_forms_json, read by
HanziForms.js). No database: the pronunciations are stand-ins.

Run: python manage.py test hakkadbapp.test_hanzi_forms
"""
import json
from types import SimpleNamespace

from django.test import SimpleTestCase

from .models import hanzi_forms
from .templatetags.pronunciation_tags import hanzi_forms_json


class HanziFormsTest(SimpleTestCase):
    def test_every_form(self):
        # OpenCC's s2t keeps only 發: 髮 was unknown.
        self.assertEqual(hanzi_forms("发"), {"发", "發", "髮"})
        self.assertEqual(hanzi_forms("髮"), {"发", "發", "髮"})
        self.assertEqual(hanzi_forms("爱"), {"爱", "愛"})
        self.assertEqual(hanzi_forms("愛"), {"爱", "愛"})
        self.assertEqual(hanzi_forms("好"), {"好"})

    def test_table_for_the_pages(self):
        html = hanzi_forms_json([SimpleNamespace(hanzi="发"), SimpleNamespace(hanzi="愛"), SimpleNamespace(hanzi="好")])
        self.assertIn('id="hanzi-forms"', html)
        table = json.loads(html.split(">", 1)[1].rsplit("<", 1)[0])
        self.assertEqual(table, {"發": "发", "髮": "发", "愛": "爱"})
