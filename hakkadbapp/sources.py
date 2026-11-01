"""The 🔎 lookup: what the sources say about a word or a character, in
French, every statement traceable.

Sources, in this order of priority:
1. the imported documents (ImportedDocument): searched by the server
   itself, no AI, free -- every line quoting the word;
2. online sources (SourceSite, edited in /admin/): Claude reads the
   designated sites' entry pages (web fetch) and searches them (web
   search), the whole web only if a "*" site is active;
3. the AI's own knowledge.
The rule that makes it checkable: Claude's answer comes back split into
paragraphs; a paragraph with at least one citation (URL + the exact
passage) is shown as sourced, with its citations; a paragraph with none
is shown apart, labelled "connaissance de l'IA, non sourcée". The result
is stored (SourceLookup) and shown the same every time, until someone
refreshes it."""
import json
import logging
import re
import time
from urllib.parse import quote, urlparse

from django.core.cache import cache
from django.http import JsonResponse

from .ai import HAN_RE, MODEL, _client, ai_enabled
from .models import ImportedDocument, SourceLookup, SourceSite, s2t, t2s
from .permissions import editor_required, is_editor

logger = logging.getLogger(__name__)

DAILY_LIMIT = 40          # web lookups per editor per day (per server instance)
MAX_DOC_QUOTES = 8
TIME_BUDGET = 45          # seconds: Vercel stops a request at 60


# ---- 1. imported documents ----------------------------------------------------------------

def document_quotes(hanzi):
    """Every line of the imported documents containing the word (simplified
    or traditional): [{document, location, text}]."""
    forms = {hanzi, s2t.convert(hanzi), t2s.convert(hanzi)}
    quotes = []
    for doc in ImportedDocument.objects.order_by("-created_at"):
        page = ""
        for n, line in enumerate(doc.text.splitlines(), 1):
            if re.fullmatch(r"\[page \d+\]", line.strip()):
                page = line.strip()[1:-1] + ", "
                continue
            if any(f in line for f in forms):
                quotes.append({"document": doc.filename, "location": f"{page}ligne {n}",
                               "text": " ".join(line.replace("\t", " · ").split())[:400]})
                if len(quotes) >= MAX_DOC_QUOTES:
                    return quotes
    return quotes


# ---- 2 and 3. online sources and the AI's own knowledge -----------------------------------------

SYSTEM = """You help the editors of a lexicon of the Hakka spoken by the Chinese community of Tahiti (French Polynesia). They want to know what reliable sources say about one word or character: its meanings in Hakka, its Hakka readings (any romanization), and its Cantonese and Mandarin equivalents.

Write your answer in French, as short paragraphs separated by a blank line, one fact per paragraph. Base every fact on the pages you read and cite them. Read the entry pages given first, then search the sources in the order given. Never present a fact as coming from a source that doesn't say it.

If you add something from your own knowledge that no page you read supports, put it in a last paragraph starting with "Connaissance générale :"."""


def _sites():
    return list(SourceSite.objects.filter(active=True).order_by("priority", "name"))


def _paragraphs(content):
    """Claude's text blocks grouped into paragraphs (split on blank lines),
    each with the citations of the blocks it is made of. A paragraph never
    spans a tool call or a new turn (None in `content`): text on either
    side of one is never mixed, so a citation can't spill onto it."""
    paragraphs, current = [], {"text": "", "citations": []}
    for block in content:
        if block is None or block.type != "text":
            paragraphs.append(current)
            current = {"text": "", "citations": []}
            continue
        citations = []
        for c in getattr(block, "citations", None) or []:
            url = getattr(c, "url", None) or ""
            citations.append({"url": url, "title": getattr(c, "title", None) or getattr(c, "document_title", None) or "",
                              "cited_text": " ".join(str(getattr(c, "cited_text", "") or "").split())[:500],
                              "domain": urlparse(url).netloc if url else ""})
        parts = block.text.split("\n\n")
        for i, part in enumerate(parts):
            if i > 0:
                paragraphs.append(current)
                current = {"text": "", "citations": []}
            current["text"] += part
            if part.strip():
                current["citations"] += citations
    paragraphs.append(current)
    out = []
    for p in paragraphs:
        text = " ".join(p["text"].split())
        if not text:
            continue
        seen, citations = set(), []
        for c in p["citations"]:
            key = (c["url"], c["cited_text"])
            if key not in seen and (c["url"] or c["cited_text"]):
                seen.add(key)
                citations.append(c)
        out.append({"text": text, "citations": citations})
    return out


def web_lookup(hanzi, reading=""):
    """Asks Claude, with web fetch and web search, restricted to the active
    sources. Returns (web paragraphs, AI knowledge paragraphs, sites, searches)."""
    import anthropic

    sites = _sites()
    domains = [s.domain for s in sites if s.domain != "*"]
    open_web = any(s.domain == "*" for s in sites)
    urls = [s.lookup_url.replace("{q}", quote(hanzi)) for s in sites if s.lookup_url and s.kind == SourceSite.KIND_DESIGNATED][:4]
    search_tool = {"type": "web_search_20260209", "name": "web_search", "max_uses": 3}
    if domains and not open_web:
        search_tool["allowed_domains"] = domains
    tools = [search_tool]
    if urls:
        tools.append({"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": len(urls),
                      "max_content_tokens": 3000, "citations": {"enabled": True}})
    order = "\n".join(f"- {s.name} ({s.domain})" for s in sites)
    message = (f"Mot ou caractère : {hanzi}" + (f" (lecture hakka connue : {reading})" if reading else "")
               + ("\n\nPages d'entrée à lire d'abord :\n" + "\n".join(urls) if urls else "")
               + f"\n\nSources, par ordre de priorité :\n{order}")
    messages = [{"role": "user", "content": message}]
    client = _client().with_options(timeout=50.0)
    start, content, searches = time.monotonic(), [], 0
    for _ in range(3):  # a long server-tool turn can pause; it is resumed at most twice
        try:
            response = client.beta.messages.create(
                model=MODEL, max_tokens=4000, betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                output_config={"effort": "low"}, system=SYSTEM, tools=tools, messages=messages)
        except anthropic.RateLimitError:
            raise LookupError_("L'IA est très demandée : réessayez dans une minute.")
        except anthropic.APIConnectionError:
            raise LookupError_("L'IA ne répond pas : réessayez plus tard.")
        except anthropic.APIStatusError as e:
            logger.exception("sources: API error %s", e.status_code)
            raise LookupError_("La recherche a échoué : réessayez plus tard.")
        content += list(response.content) + [None]
        usage = getattr(response.usage, "server_tool_use", None)
        if usage:
            searches += getattr(usage, "web_search_requests", 0) or 0
        logger.info("sources %s: stop=%s in=%s out=%s searches=%s", hanzi, response.stop_reason,
                    response.usage.input_tokens, response.usage.output_tokens, searches)
        if response.stop_reason == "refusal":
            raise LookupError_("L'IA a refusé cette recherche.")
        if response.stop_reason != "pause_turn" or time.monotonic() - start > TIME_BUDGET:
            break
        messages = [messages[0], {"role": "assistant", "content": response.content}]
    # Cited -> sourced. Marked "Connaissance générale" -> the AI's own
    # knowledge, labelled. Anything else uncited ("Je cherche…") is dropped.
    web, ai = [], []
    for p in _paragraphs(content):
        if p["citations"]:
            web.append(p)
        else:
            match = re.match(r"^\W*Connaissance générale\s*:\s*(.+)", p["text"], flags=re.S)
            if match and match.group(1).strip():
                ai.append(match.group(1).strip())
    return web, ai, [s.name for s in sites], searches


class LookupError_(Exception):
    """A failure to show the editor as is (French)."""


# ---- HTTP -------------------------------------------------------------------------------------

def _lookup_json(lookup):
    if not lookup:
        return None
    return {**lookup.result, "query": lookup.query, "reading": lookup.reading,
            "created_at": lookup.created_at.isoformat(),
            "created_by": lookup.created_by.username if lookup.created_by else ""}


def _clean_query(value):
    value = "".join(str(value or "").split())[:20]
    return value if value and all(HAN_RE.fullmatch(c) for c in value) else ""


@editor_required
def api_sources(request):
    """GET ?q=屋家: the stored lookup (or null) and the documents' quotes.
    POST {q, reading}: a new web lookup, stored."""
    if not is_editor(request.user):
        return JsonResponse({"error": "Connexion requise."}, status=403)
    if request.method == "POST":
        try:
            payload = json.loads(request.body.decode("utf-8") or "{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            return JsonResponse({"error": "JSON invalide."}, status=400)
        hanzi = _clean_query(payload.get("q"))
        reading = " ".join(str(payload.get("reading", "")).split())[:100]
    else:
        hanzi, reading = _clean_query(request.GET.get("q")), ""
    if not hanzi:
        return JsonResponse({"error": "Donnez un mot ou un caractère chinois."}, status=400)
    documents = document_quotes(hanzi)
    if request.method != "POST":
        lookup = SourceLookup.objects.filter(query=hanzi).select_related("created_by").first()
        return JsonResponse({"query": hanzi, "documents": documents, "lookup": _lookup_json(lookup),
                             "ai_enabled": ai_enabled()})
    if not ai_enabled():
        return JsonResponse({"error": "La recherche en ligne n'est pas configurée sur ce serveur."}, status=503)
    key = f"source-lookups:{request.user.pk}"
    if cache.get(key, 0) >= DAILY_LIMIT:
        return JsonResponse({"error": f"Limite de {DAILY_LIMIT} recherches par jour atteinte."}, status=429)
    cache.set(key, cache.get(key, 0) + 1, 24 * 3600)
    try:
        web, ai_knowledge, sites, searches = web_lookup(hanzi, reading)
    except LookupError_ as err:
        return JsonResponse({"error": str(err)}, status=503)
    lookup = SourceLookup.objects.create(query=hanzi, reading=reading, created_by=request.user, result={
        "web": web, "ai": ai_knowledge, "sites": sites, "searches": searches})
    return JsonResponse({"query": hanzi, "documents": documents, "lookup": _lookup_json(lookup),
                         "ai_enabled": True})
