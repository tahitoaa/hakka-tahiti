"""Anonymous visitors can't reach the AI or write anything.

Every route is requested anonymously, with GET and with POST. Unless it is
listed in PUBLIC below, it must refuse: a login redirect, 401, 403 or 405
(GET on a POST-only endpoint; its POST is checked too). A new route is
therefore protected by default: this test fails until it is guarded
(permissions.editor_required / owner_required, login_required, or an
is_editor() check) or deliberately added to PUBLIC.

No database: SimpleTestCase forbids queries, so a protected view must refuse
before touching the database, and Django creates no test database (the
real one is never contacted). The AI client is replaced by one that fails
the test if it is ever reached, and an API key is set so that a missing key
can't be what stops a request.

Run: python manage.py test hakkadbapp
"""
import os
import re
import uuid
from unittest import mock

from django.contrib.admindocs.views import simplify_regex
from django.test import SimpleTestCase
from django.urls import URLPattern, get_resolver, reverse

# Read-only pages and endpoints open to everyone, with the methods that may
# answer anonymously. Anything that writes or calls the AI must not be here.
PUBLIC = {
    "flashcards": {"GET", "POST"},
    "reports": {"GET", "POST"},
    "duplicates": {"GET", "POST"},  # redirect to the lexicon browser's Doublons tab
    "expressions": {"GET", "POST"},  # redirect to its Expressions tab (the editing endpoints stay owner-only)
    "search": {"GET", "POST"},
    "pinyin_converter": {"GET", "POST"},
    "transcripter": {"GET", "POST"},
    "caracters": {"GET", "POST"},  # redirect to the search page
    "hanzi": {"GET", "POST"},
    "phonemes": {"GET", "POST"},  # redirect
    "hanzi_by_pinyin": {"GET", "POST"},
    "hanzi_by_tone": {"GET", "POST"},
    "pronunciation_comparison": {"GET", "POST"},  # redirect
    "api_sources_table": {"GET", "POST"},
    "character_dictionary": {"GET", "POST"},
    "pronunciation": {"GET", "POST"},
    "api_convert_text": {"GET", "POST"},
    "api_words_data": {"GET", "POST"},
    "input_guide": {"GET", "POST"},
    "drafts": {"GET", "POST"},  # redirect to Suivi, itself protected
    "word_note_entry": {"GET"},  # reading a word's note; saving it is protected
    "login": {"GET", "POST"},
    "logout": {"GET", "POST"},
}

# Kept out of this test: Django's own admin (its login protects it).
SKIPPED_PREFIXES = ("admin/",)

REFUSED = {401, 403, 405}
ARGS = {"int": 1, "uuid": uuid.UUID(int=1), "str": "a", "slug": "a", "path": "a"}


def routes():
    """(name, url) for every named route of the site."""
    for pattern in get_resolver().url_patterns:
        if not isinstance(pattern, URLPattern) or not pattern.name:
            continue
        route = str(pattern.pattern)
        if route.startswith(SKIPPED_PREFIXES):
            continue
        kwargs = {}
        for converter, name in re.findall(r"<(?:(\w+):)?(\w+)>", route):
            kwargs[name] = ARGS[converter or "str"]
        if pattern.pattern.regex.groupindex and not kwargs:  # a re_path
            kwargs = {name: "a" for name in pattern.pattern.regex.groupindex}
        yield pattern.name, reverse(pattern.name, kwargs=kwargs) if kwargs else simplify_regex(route)


def _ai_reached(*args, **kwargs):
    raise AssertionError("an anonymous request reached the AI client")


class AnonymousAccessTests(SimpleTestCase):
    def setUp(self):
        patches = [mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key", "CRON_SECRET": "test-secret"})]
        patches += [mock.patch(f"hakkadbapp.{module}._client", _ai_reached)
                    for module in ("ai", "assistant", "rey", "sources")]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def assertRefused(self, response, label):
        if response.status_code in (301, 302):
            target = response["Location"]
            self.assertTrue(target.startswith(reverse("login")),
                            f"{label} redirects to {target}, not to the login page")
        else:
            self.assertIn(response.status_code, REFUSED, f"{label} answered {response.status_code} anonymously")

    def test_routes_are_refused_to_anonymous_visitors(self):
        checked = 0
        for name, url in routes():
            public = PUBLIC.get(name, set())
            for method in ("GET", "POST"):
                if method in public:
                    continue
                label = f"{method} {url} ({name})"
                with self.subTest(label):
                    if method == "GET":
                        response = self.client.get(url)
                    else:
                        response = self.client.post(url, data="{}", content_type="application/json")
                    self.assertRefused(response, label)
                    checked += 1
        self.assertGreater(checked, 40, "the route list looks empty: is urls.py still loaded?")

    def test_public_list_has_no_stale_names(self):
        names = {name for name, _url in routes()}
        self.assertEqual(set(PUBLIC) - names, set(), "PUBLIC names a route that no longer exists")

    def test_ai_routes_are_never_public(self):
        ai_routes = [name for name, url in routes() if "/api/ia/" in url]
        self.assertGreaterEqual(len(ai_routes), 5)
        for name in ai_routes:
            self.assertNotIn(name, PUBLIC)
