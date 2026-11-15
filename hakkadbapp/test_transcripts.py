"""The Storage API's address, whatever way SUPABASE_URL is written
(transcripts.project_url). No database, no network.

Run: python manage.py test hakkadbapp.test_transcripts
"""
from django.test import SimpleTestCase, override_settings

from . import transcripts


class ProjectUrlTest(SimpleTestCase):
    def test_root_kept_whatever_the_path(self):
        for url in ("https://abc.supabase.co", "https://abc.supabase.co/", "https://abc.supabase.co/rest/v1/",
                    " https://abc.supabase.co/rest/v1 "):
            with override_settings(SUPABASE_URL=url):
                self.assertEqual(transcripts.project_url(), "https://abc.supabase.co", url)
