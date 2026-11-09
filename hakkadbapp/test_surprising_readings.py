"""« Lectures surprenantes »: what counts as supported by a source, and who may ask.

Run with: python manage.py test hakkadbapp.test_surprising_readings
"""
from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory, SimpleTestCase

from hakkadbapp.surprising_readings import _attested, api_check

# Learning pairs of one source: s -> x seen 40 times (before i, in Wenfa), h -> m once.
RULES = {"baoan": {"parts": {
    "initial": {"s": {"s": 50, "x": 40}, "h": {"h": 60, "m": 1}},
    "final": {"i": {"i": 80}, "au": {"ao": 30}},
    "tone": {"5": {"4": 20}, "3": {"3": 25}},
}}}


class AttestedTests(SimpleTestCase):
    def test_a_regular_correspondence_supports_the_reading(self):
        # 四 si⁵ in Bao'an, xi⁴ in the lexicon: s -> x is regular.
        self.assertTrue(_attested(RULES, "baoan", ("s", "i", "5"), ("x", "i", "4"), 3))

    def test_a_rare_one_does_not(self):
        # 好 hau³ in Bao'an, mao³ in the lexicon: h -> m seen once.
        self.assertFalse(_attested(RULES, "baoan", ("h", "au", "3"), ("m", "ao", "3"), 2))
        self.assertTrue(_attested(RULES, "baoan", ("h", "au", "3"), ("h", "ao", "3"), 3))

    def test_the_tone_only_counts_when_asked(self):
        self.assertTrue(_attested(RULES, "baoan", ("s", "i", "5"), ("s", "i", "1"), 2))
        self.assertFalse(_attested(RULES, "baoan", ("s", "i", "5"), ("s", "i", "1"), 3))


class AccessTests(SimpleTestCase):
    def test_signed_in_users_only(self):
        request = RequestFactory().post("/api/ia/lectures-surprenantes")
        request.user = AnonymousUser()
        self.assertEqual(api_check(request).status_code, 302)   # to the login page

    def test_post_only(self):
        request = RequestFactory().get("/api/ia/lectures-surprenantes")
        request.user = AnonymousUser()
        self.assertEqual(api_check(request).status_code, 405)
