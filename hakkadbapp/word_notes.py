"""Persistent, human-editable data for a single Word: a free-text comment
and an opt-in "use in export" flag (see models.WordNote.use_in_export --
export_corpus() in expression_mesh.py only ever includes a Word in
wordCorpus.json when this is set, same reasoning as
ExpressionNote.use_in_export for expressions).

Row identity: Word.platform_id -- the e_reo platform's own id for this
word (wordCorpus.json's dict key), carried through verbatim by every
`platform_to_vercel` import (see models.Word.platform_id). Unlike this
row's Django pk, which a reset+rebuild destroys and reassigns every run,
platform_id is copied as-is from the platform's own JSON every time, so a
comment attached to it survives untouched across reimports.

Storage: models.WordNote, an ordinary DB table -- NOT touched by
import_words_from_df's reset=True (which only wipes
Word/WordPronunciation/Pronunciation/Initial/Final/Tone). Deliberately not
a local file: the app runs on Vercel as a serverless function with a
read-only filesystem in production, so only the DB (see
settings.DATABASES) actually persists across requests on the live site --
see expression_mesh.py's module docstring for the same reasoning.
"""
from .models import WordNote


class MissingPlatformId(Exception):
    """Raised when a Word has no platform_id yet -- it needs a fresh
    `platform_to_vercel --yes` run to get one (see models.Word.platform_id)."""


def get_note(word):
    """The Word's WordNote, or None if it doesn't have one yet (never
    saved anything) -- callers default missing fields themselves rather
    than eagerly creating a row just to read it."""
    if not word.platform_id:
        return None
    return WordNote.objects.filter(platform_id=word.platform_id).first()


def get_or_create_note(word):
    if not word.platform_id:
        raise MissingPlatformId(
            "Ce mot n'a pas encore de platform_id -- relancez "
            "`platform_to_vercel --yes` pour le renseigner."
        )
    note, _created = WordNote.objects.get_or_create(platform_id=word.platform_id)
    return note
