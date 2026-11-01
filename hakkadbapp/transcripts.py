"""Shared transcriptions (models.SharedTranscript): the audio in Supabase
Storage, and the checks on what the "Transcrire" page publishes.

The audio never goes through Django -- Vercel limits a request body to
4.5 MB, a compressed hour of speech is ~18 MB. Django signs URLs with the
service_role key instead:
- an upload URL, that the transcriber's browser PUTs the file to;
- a download URL (a few hours), put in the page of a logged-in member.
The bucket stays private: without a signed URL nobody can read it.
"""
import json
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings

AUDIO_URL_SECONDS = 6 * 60 * 60
MAX_SEGMENTS = 20000
TEXT_FIELDS = ("hanzi", "pinyin", "translation", "transcript")


class StorageError(Exception):
    pass


def storage_configured():
    return bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_KEY)


def _request(method, path, body=None):
    """Calls the Storage API (path after /storage/v1); returns its JSON."""
    if not storage_configured():
        raise StorageError(
            "Le stockage audio n'est pas configuré (SUPABASE_URL et SUPABASE_SERVICE_KEY).")
    key = settings.SUPABASE_SERVICE_KEY
    request = urllib.request.Request(
        f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")[:300]
        raise StorageError(f"Stockage audio : erreur {err.code} ({detail})") from err
    except urllib.error.URLError as err:
        raise StorageError(f"Stockage audio injoignable : {err.reason}") from err
    return json.loads(raw or b"{}")


def _object(path):
    bucket = settings.SUPABASE_TRANSCRIPTS_BUCKET
    return f"{urllib.parse.quote(bucket)}/{urllib.parse.quote(path)}"


def signed_upload_url(path):
    """Full URL the browser PUTs the audio file to (valid ~2 hours)."""
    answer = _request("POST", f"/object/upload/sign/{_object(path)}", {})
    url = answer.get("url") or answer.get("signedURL")
    if not url:
        raise StorageError("Stockage audio : pas d'adresse d'envoi dans la réponse.")
    return f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1{url}"


def signed_audio_url(path):
    """Full URL to play the audio, for AUDIO_URL_SECONDS."""
    answer = _request("POST", f"/object/sign/{_object(path)}", {"expiresIn": AUDIO_URL_SECONDS})
    url = answer.get("signedURL") or answer.get("signedUrl")
    if not url:
        raise StorageError("Stockage audio : pas d'adresse de lecture dans la réponse.")
    return f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1{url}"


def delete_objects(paths):
    paths = [p for p in paths if p]
    if paths:
        _request("DELETE", f"/object/{urllib.parse.quote(settings.SUPABASE_TRANSCRIPTS_BUCKET)}", {"prefixes": paths})


def clean_data(data):
    """The published transcript, reduced to the known fields; raises
    ValueError with a readable message when it isn't usable."""
    if not isinstance(data, dict):
        raise ValueError("Transcription illisible.")
    participants = data.get("participants")
    segments = data.get("segments")
    if not isinstance(participants, list) or not participants or not isinstance(segments, list):
        raise ValueError("Transcription sans participants ou sans segments.")
    if len(segments) > MAX_SEGMENTS:
        raise ValueError("Trop de segments.")
    clean_participants = [
        {"name": str(p.get("name", ""))[:200], "tier": str(p.get("tier", ""))[:200]}
        for p in participants if isinstance(p, dict)
    ]
    clean_segments = []
    for s in segments:
        if not isinstance(s, dict):
            continue
        try:
            segment = {"start": int(s["start"]), "end": int(s["end"]), "speaker": int(s["speaker"])}
        except (KeyError, TypeError, ValueError):
            raise ValueError("Segment mal formé (start, end, speaker).")
        if not 0 <= segment["speaker"] < len(clean_participants):
            raise ValueError("Segment rattaché à un participant inconnu.")
        for field in TEXT_FIELDS:
            segment[field] = str(s.get(field) or "")[:5000]
        clean_segments.append(segment)
    clean_segments.sort(key=lambda s: (s["start"], s["speaker"]))
    return {"participants": clean_participants, "segments": clean_segments}
