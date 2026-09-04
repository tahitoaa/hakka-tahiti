import csv
import datetime
import json
import os
import shutil
import zipfile
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

import hakkadbapp.json_model as jsonm
import hakkadbapp.read_themes_corpus
from hakkadbapp.management.commands.export import (
    Command as ExportCommand,
    ROW_HEADERS,
    find_latest_dated_corpus_dir,
)

ANALYTICS_HTML_NAME = "analytics.html"


def build_audio_report(state, reference_words, reference_expressions):
    """Per-word/expression local-audio-file status across the WHOLE current
    corpus (not just the added/modified/deleted diff), so gaps are visible
    everywhere, not only on rows that happen to have changed."""

    def entries(row_by_id, payloads, reference_map):
        out = []
        missing_local = 0
        for obj_id, row in row_by_id.items():
            payload = payloads.get(obj_id, {})
            translations = payload.get("translations", {})
            local_file = row[6] or ""
            platform_has_audio = bool((reference_map.get(obj_id) or {}).get("audio"))
            if not local_file:
                missing_local += 1
            out.append({
                "id": obj_id,
                "target": translations.get("target", ""),
                "primary": translations.get("primary", ""),
                "local_file": local_file,
                "platform_has_audio": platform_has_audio,
            })
        out.sort(key=lambda e: e["target"])
        return out, missing_local

    word_entries, word_missing = entries(state["word_row_by_id"], state["current_word_payloads"], reference_words)
    expr_entries, expr_missing = entries(state["expression_row_by_id"], state["current_expression_payloads"], reference_expressions)

    return {
        "words": word_entries,
        "expressions": expr_entries,
        "summary": {
            "words": {"total": len(word_entries), "missing_local": word_missing},
            "expressions": {"total": len(expr_entries), "missing_local": expr_missing},
        },
    }


def build_duplicates_report(current_word_payloads, current_expression_payloads, reference_words, reference_expressions):
    """Entries sharing the same french (primary), hakka (target), or english
    (secondary) text -- within Vercel and within E-reo separately, for both
    words and expressions. A shared hakka target is usually a true duplicate
    entry; shared french/english is weaker (synonyms happen) but still worth
    surfacing for a human to check.
    """

    def norm(s):
        return (s or "").strip().lower()

    def group_by(payloads, field):
        groups = {}
        for obj_id, payload in payloads.items():
            translations = payload.get("translations", {}) if isinstance(payload, dict) else {}
            key = norm(translations.get(field))
            if not key:
                continue
            groups.setdefault(key, []).append({
                "id": obj_id,
                "french": translations.get("primary", ""),
                "target": translations.get("target", ""),
                "english": translations.get("secondary", ""),
            })
        return [
            {"value": key, "entries": entries}
            for key, entries in sorted(groups.items())
            if len(entries) > 1
        ]

    def one_corpus(payloads):
        return {
            "french": group_by(payloads, "primary"),
            "target": group_by(payloads, "target"),
            "english": group_by(payloads, "secondary"),
        }

    return {
        "vercel": {
            "words": one_corpus(current_word_payloads),
            "expressions": one_corpus(current_expression_payloads),
        },
        "e_reo": {
            "words": one_corpus(reference_words),
            "expressions": one_corpus(reference_expressions),
        },
    }


def find_unmatched_audio_files(state, audio_index):
    """Audio files sitting in the local source dir that no current
    word/expression's expected filename resolved to."""
    claimed = {row[6] for row in state["rows"] if row[6]}
    all_indexed = set(audio_index.get("by_name", {}).values())
    return sorted(all_indexed - claimed)


class Command(BaseCommand):
    help = (
        "Compare the personal Supabase DB against the latest dated platform "
        "reference corpus (../e_reo_json/<dd_mm_yyyy>/) and export only the "
        "words/expressions that are missing from the platform or whose "
        "content there differs from the personal DB (additions + "
        "modifications; deletions are reported but not exported, since "
        "they're missing from the personal DB rather than the platform). "
        "Also writes, in the same run: a full DB export (full_db_export/), "
        "a copy of the platform reference files used (platform_reference/), "
        "an audio-coverage report for the whole corpus, and a copy-out of "
        "any local audio file that doesn't match a word/expression by name "
        "(unmatched_audio/)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--corpus-dir",
            type=str,
            default="",
            help=(
                "Explicit ../e_reo_json/<dd_mm_yyyy> folder to diff against, "
                "instead of auto-detecting the most recent date."
            ),
        )

    def handle(self, *args, **options):
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

        base_corpus_dir = Path("../e_reo_json")
        if options.get("corpus_dir"):
            corpus_dir = Path(options["corpus_dir"])
        else:
            corpus_dir = find_latest_dated_corpus_dir(base_corpus_dir)

        if not corpus_dir or not corpus_dir.is_dir():
            raise CommandError(
                f"No dated platform corpus folder found under {base_corpus_dir} "
                "(expected e.g. ../e_reo_json/02_09_2026/ containing "
                "wordCorpus.json, expressionCorpus.json and themeCorpus.json). "
                "Pass --corpus-dir to point at one explicitly."
            )

        self.stdout.write(self.style.SUCCESS(f"Using platform reference corpus: {corpus_dir}/"))

        export_dir = Path(f"../export_missing_{timestamp}")
        export_dir.mkdir(parents=True, exist_ok=True)

        # build_current_state() copies matched expression audio here (hanzi-named).
        export_audio_dir = export_dir / "audio"
        export_audio_dir.mkdir(parents=True, exist_ok=True)

        # Reuse export.py's Command wholesale: it already knows how to match
        # personal-DB rows to the reference corpus by target text, reusing
        # the reference's id when matched (or minting a fresh one otherwise)
        # so ids stay coherent with the platform's own id space.
        exporter = ExportCommand()
        exporter.stdout = self.stdout
        exporter.stderr = self.stderr
        exporter.style = self.style

        jsonm.Theme.reset()
        jsonm.Word.reset()
        jsonm.Expression.reset()

        hakkadbapp.read_themes_corpus.read_themes(str(corpus_dir / "themeCorpus.json"))

        reference_words = exporter.load_reference_corpus(corpus_dir / "wordCorpus.json")
        reference_expressions = exporter.load_reference_corpus(corpus_dir / "expressionCorpus.json")
        reference_words_by_target, _ = exporter.index_reference_by_target(reference_words)
        reference_expressions_by_target, _ = exporter.index_reference_by_target(reference_expressions)

        if reference_words:
            self.stdout.write(self.style.SUCCESS(f"Loaded {len(reference_words)} reference words."))
        if reference_expressions:
            self.stdout.write(self.style.SUCCESS(f"Loaded {len(reference_expressions)} reference expressions."))

        audio_source_dir = exporter.resolve_audio_source_dir()
        audio_index = exporter.build_audio_index(audio_source_dir)

        # One DB scan/match pass serves everything below: the missing-only
        # export, the parallel full-db export, and the audio report all read
        # from this same `state` rather than re-querying.
        state = exporter.build_current_state(
            reference_words_by_target, reference_expressions_by_target, audio_index, export_audio_dir
        )

        word_diff = exporter.compute_diff(reference_words, state["current_word_payloads"])
        expression_diff = exporter.compute_diff(reference_expressions, state["current_expression_payloads"])

        # "Missing on the platform" = doesn't exist there at all (added) or
        # exists but its content there is stale (modified). Deletions are the
        # opposite direction (missing from the personal DB) and are reported
        # below but intentionally not exported.
        missing_word_ids = sorted(
            {item["id"] for item in word_diff["added"]} | {item["id"] for item in word_diff["modified"]}
        )
        missing_expression_ids = sorted(
            {item["id"] for item in expression_diff["added"]} | {item["id"] for item in expression_diff["modified"]}
        )

        missing_words = {wid: state["current_word_payloads"][wid] for wid in missing_word_ids}
        missing_expressions = {eid: state["current_expression_payloads"][eid] for eid in missing_expression_ids}

        self.stdout.write(self.style.SUCCESS(
            f"Words: added={len(word_diff['added'])} modified={len(word_diff['modified'])} "
            f"deleted={len(word_diff['deleted'])} (deleted = on platform, not in personal DB; not exported) "
            f"-> exporting {len(missing_words)}"
        ))
        self.stdout.write(self.style.SUCCESS(
            f"Expressions: added={len(expression_diff['added'])} modified={len(expression_diff['modified'])} "
            f"deleted={len(expression_diff['deleted'])} (deleted = on platform, not in personal DB; not exported) "
            f"-> exporting {len(missing_expressions)}"
        ))

        # ---- missing-only patch (json + xlsx) ------------------------------

        word_json_path = export_dir / "wordCorpus.missing.json"
        with open(word_json_path, "w", encoding="utf-8") as f:
            json.dump(missing_words, f, ensure_ascii=False, indent=2, sort_keys=True)

        expression_json_path = export_dir / "expressionCorpus.missing.json"
        with open(expression_json_path, "w", encoding="utf-8") as f:
            json.dump(missing_expressions, f, ensure_ascii=False, indent=2, sort_keys=True)

        missing_rows = (
            [state["word_row_by_id"][wid] for wid in missing_word_ids if wid in state["word_row_by_id"]]
            + [state["expression_row_by_id"][eid] for eid in missing_expression_ids if eid in state["expression_row_by_id"]]
        )
        xlsx_path = export_dir / "missing.xlsx"
        exporter.write_xlsx(xlsx_path, missing_rows)

        # ---- platform reference copy (quick access alongside the diff) ----

        platform_ref_dir = export_dir / "platform_reference"
        platform_ref_dir.mkdir(parents=True, exist_ok=True)
        for filename in ("wordCorpus.json", "expressionCorpus.json", "themeCorpus.json"):
            src = corpus_dir / filename
            if src.exists():
                shutil.copy2(src, platform_ref_dir / filename)

        # ---- full DB export, generated in parallel from the same state ----

        full_db_dir = export_dir / "full_db_export"
        full_db_dir.mkdir(parents=True, exist_ok=True)
        with open(full_db_dir / "wordCorpus.json", "w", encoding="utf-8") as f:
            f.write(jsonm.Word.export())
        with open(full_db_dir / "expressionCorpus.json", "w", encoding="utf-8") as f:
            f.write(jsonm.Expression.export())
        with open(full_db_dir / "themeCorpus.json", "w", encoding="utf-8") as f:
            f.write(jsonm.Theme.export())
        with open(full_db_dir / "export.csv", mode="w", newline="", encoding="utf-8") as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow(ROW_HEADERS)
            writer.writerows(state["rows"])
        exporter.write_xlsx(full_db_dir / "export.xlsx", state["rows"])
        self.stdout.write(self.style.SUCCESS(
            f"Full DB export: {len(state['word_row_by_id'])} words, "
            f"{len(state['expression_row_by_id'])} expressions -> {full_db_dir}/"
        ))

        # Single archive with both corpus files plus every matched audio file
        # (words and expressions alike -- build_current_state() copies both
        # into export_audio_dir as it matches them), ready to hand off as one
        # file instead of the folder.
        full_export_zip_path = export_dir / "full_db_export.zip"
        with zipfile.ZipFile(full_export_zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zipf:
            zipf.write(full_db_dir / "wordCorpus.json", arcname="wordCorpus.json")
            zipf.write(full_db_dir / "expressionCorpus.json", arcname="expressionCorpus.json")
            for audio_file in sorted(export_audio_dir.glob("*")):
                if audio_file.is_file():
                    zipf.write(audio_file, arcname=f"audio/{audio_file.name}")
        self.stdout.write(self.style.SUCCESS(f"Wrote {full_export_zip_path}"))

        # ---- audio coverage (whole corpus) + unmatched local audio files --

        audio_report = build_audio_report(state, reference_words, reference_expressions)
        unmatched_audio_files = find_unmatched_audio_files(state, audio_index)

        # Relative path from this export folder to the local audio source dir
        # (computed, not hardcoded, in case resolve_audio_source_dir's
        # candidates ever change) -- lets analytics.html play a word's local
        # file directly via "<that prefix>/<filename>", since audio files
        # aren't copied into every export folder.
        audio_source_relative_dir = (
            os.path.relpath(audio_source_dir, start=export_dir).replace(os.sep, "/")
            if audio_source_dir else None
        )

        unmatched_audio_dir = export_dir / "unmatched_audio"
        if unmatched_audio_files and audio_source_dir:
            unmatched_audio_dir.mkdir(parents=True, exist_ok=True)
            for filename in unmatched_audio_files:
                src = audio_index["path_by_name"].get(filename)
                if src:
                    shutil.copy2(src, unmatched_audio_dir / filename)

        self.stdout.write(self.style.SUCCESS(
            f"Audio: words missing local file={audio_report['summary']['words']['missing_local']}/"
            f"{audio_report['summary']['words']['total']}, "
            f"expressions missing local file={audio_report['summary']['expressions']['missing_local']}/"
            f"{audio_report['summary']['expressions']['total']}, "
            f"unmatched local files={len(unmatched_audio_files)}"
            + (f" -> copied to {unmatched_audio_dir}/" if unmatched_audio_files and audio_source_dir else "")
        ))

        # ---- duplicate french/hakka/english, within each corpus -----------

        duplicates_report = build_duplicates_report(
            state["current_word_payloads"], state["current_expression_payloads"],
            reference_words, reference_expressions,
        )

        def dup_counts(side):
            return {
                cat: {key: len(groups) for key, groups in duplicates_report[side][cat].items()}
                for cat in ("words", "expressions")
            }

        self.stdout.write(self.style.SUCCESS(f"Duplicates (Vercel): {dup_counts('vercel')}"))
        self.stdout.write(self.style.SUCCESS(f"Duplicates (E-reo): {dup_counts('e_reo')}"))

        # ---- diff_summary.json (diff + audio + legend, all in one file) ---

        diff_summary_path = export_dir / "diff_summary.json"
        with open(diff_summary_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "legend": {
                        "added": (
                            "In the personal DB but not on the platform (no entry there "
                            "with a matching target text). Gets a freshly minted id. "
                            "Exported."
                        ),
                        "modified": (
                            "On both sides (matched by target text), but the stored "
                            "content differs -- translations, themes, components, "
                            "in_expression links, etc. Keeps the platform's existing id. "
                            "Exported. Note: audio/image differences are ignored here, "
                            "since those depend on local files being present at export "
                            "time rather than on real content."
                        ),
                        "deleted": (
                            "On the platform but not in the personal DB -- the reverse "
                            "of 'added', i.e. missing on our side, not theirs. Listed "
                            "here for visibility only; NOT written to "
                            "wordCorpus.missing.json/expressionCorpus.missing.json/"
                            "missing.xlsx, since this command's job is to fill in what "
                            "the platform is missing, not what the personal DB is missing."
                        ),
                    },
                    "corpus_dir": str(corpus_dir),
                    "generated_at": timestamp,
                    "words": word_diff,
                    "expressions": expression_diff,
                    "summary": {
                        "words": exporter.summarize_diff(word_diff),
                        "expressions": exporter.summarize_diff(expression_diff),
                    },
                    # Theme id -> display name, so a viewer (analytics.html)
                    # can show readable theme names instead of raw UUIDs.
                    "themes": {
                        theme_id: theme_obj.translations.primary
                        for theme_id, theme_obj in jsonm.Theme.instances.items()
                    },
                    # Whole-corpus audio coverage, independent of the diff above.
                    "audio": audio_report,
                    "unmatched_audio_files": unmatched_audio_files,
                    # Where analytics.html can find the actual audio files to
                    # play them, relative to this export folder. None if no
                    # local audio source dir was found at all.
                    "audio_source_relative_dir": audio_source_relative_dir,
                    # Whole-corpus duplicate french/hakka/english, within Vercel
                    # and within E-reo separately -- also independent of the
                    # added/modified/deleted diff above.
                    "duplicates": duplicates_report,
                    # Fixed, relative to this file's own folder -- analytics.html
                    # is copied alongside these, so plain relative links work
                    # regardless of where the export folder itself lives.
                    "platform_reference_dir": "platform_reference",
                    "full_db_export_dir": "full_db_export",
                    "unmatched_audio_dir": "unmatched_audio" if unmatched_audio_files else None,
                },
                f,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )

        # ---- README + a ready-to-open copy of the analytics page ----------

        readme_path = export_dir / "README.md"
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(self.build_readme(
                corpus_dir=corpus_dir,
                timestamp=timestamp,
                word_diff=word_diff,
                expression_diff=expression_diff,
                missing_words_count=len(missing_words),
                missing_expressions_count=len(missing_expressions),
                audio_report=audio_report,
                unmatched_audio_count=len(unmatched_audio_files),
                duplicates_report=duplicates_report,
            ))

        analytics_html_src = Path(__file__).resolve().parent / ANALYTICS_HTML_NAME
        analytics_html_dst = export_dir / ANALYTICS_HTML_NAME
        if analytics_html_src.exists():
            shutil.copy2(analytics_html_src, analytics_html_dst)
        else:
            analytics_html_dst = None
            self.stdout.write(self.style.WARNING(f"{ANALYTICS_HTML_NAME} not found next to this command; skipped copying it in."))

        self.stdout.write(self.style.SUCCESS(f"Wrote {readme_path}"))
        self.stdout.write(self.style.SUCCESS(f"Wrote {word_json_path}"))
        self.stdout.write(self.style.SUCCESS(f"Wrote {expression_json_path}"))
        self.stdout.write(self.style.SUCCESS(f"Wrote {diff_summary_path}"))
        self.stdout.write(self.style.SUCCESS(f"Wrote {xlsx_path}"))
        if analytics_html_dst:
            self.stdout.write(self.style.SUCCESS(f"Open {analytics_html_dst} in a browser to review/merge."))
        self.stdout.write(self.style.SUCCESS("Done."))

    @staticmethod
    def build_readme(
        corpus_dir, timestamp, word_diff, expression_diff, missing_words_count,
        missing_expressions_count, audio_report, unmatched_audio_count, duplicates_report,
    ):
        word_counts = {k: len(v) for k, v in word_diff.items()}
        expr_counts = {k: len(v) for k, v in expression_diff.items()}
        aw = audio_report["summary"]["words"]
        ae = audio_report["summary"]["expressions"]

        def dup_row(side, cat):
            d = duplicates_report[side][cat]
            return f"| {side} {cat} | {len(d['french'])} | {len(d['target'])} | {len(d['english'])} |"

        return f"""\
# export_missing output ({timestamp})

Compares the personal Supabase DB against the platform reference corpus at
`{corpus_dir}/` (the most recent `e_reo_json/<dd_mm_yyyy>/` snapshot, unless
`--corpus-dir` was passed) and exports what the platform is missing, plus a
full snapshot of the DB and an audio-coverage report, all from the same run.

Open **analytics.html** in this folder for an interactive view of everything
below (diff review + merge decisions + audio tracking).

## What "added" / "modified" / "deleted" mean here

- **added** -- in the personal DB, but no entry on the platform has a
  matching target text (pinyin + hanzi). Gets a freshly minted id.
  **Exported.**
- **modified** -- exists on both sides (same target text), but the stored
  content differs: translations, themes, components, `in_expression`
  links, etc. Keeps the platform's existing id, so the exported entry is a
  drop-in replacement rather than a new id. **Exported.**
  Audio/image differences are *not* counted here -- they depend on which
  local files happen to be present at export time, not on real content.
- **deleted** -- the reverse of "added": exists on the platform, but not in
  the personal DB. This tool's job is to fill in what the *platform* is
  missing, not the other way around, so deletions are reported below for
  visibility but **not exported** to any of the other files.

## Counts

| | added | modified | deleted |
|---|---|---|---|
| words | {word_counts['added']} | {word_counts['modified']} | {word_counts['deleted']} |
| expressions | {expr_counts['added']} | {expr_counts['modified']} | {expr_counts['deleted']} |

-> {missing_words_count} words and {missing_expressions_count} expressions exported (added + modified).

## Audio coverage (whole DB, not just the diff above)

| | total | missing local file |
|---|---|---|
| words | {aw['total']} | {aw['missing_local']} |
| expressions | {ae['total']} | {ae['missing_local']} |

{unmatched_audio_count} local audio file(s) didn't match any word/expression by
filename{" -- copied to `unmatched_audio/` for review." if unmatched_audio_count else "."}

## Duplicates (whole DB, Vercel and E-reo separately)

Entries sharing the same french, hakka (target), or english text. A shared
hakka target is usually a true duplicate entry; shared french/english is a
weaker signal (synonyms happen) but still worth a look.

| corpus | same french | same hakka | same english |
|---|---|---|---|
{dup_row('vercel', 'words')}
{dup_row('vercel', 'expressions')}
{dup_row('e_reo', 'words')}
{dup_row('e_reo', 'expressions')}

## Files in this folder

- **analytics.html** -- open this directly in a browser. Diff review with
  per-row merge decisions (push to E-reo / re-import to Vercel / custom
  JSON), plus Audio and Duplicates tabs for the reports above. Nothing is
  uploaded anywhere; it only reads `diff_summary.json` from this folder.
- **wordCorpus.missing.json** / **expressionCorpus.missing.json** -- only
  the added + modified entries, in the same `id -> payload` shape as the
  platform's own `wordCorpus.json` / `expressionCorpus.json`. Ready to hand
  off or merge into the platform corpus as-is.
- **missing.xlsx** -- the same added + modified entries as a spreadsheet.
- **diff_summary.json** -- the full comparison (including deletions) plus
  the audio report; `analytics.html` reads this file. Its own `legend` key
  repeats the definitions above for anyone reading it in isolation.
- **platform_reference/** -- a copy of the exact `wordCorpus.json` /
  `expressionCorpus.json` / `themeCorpus.json` this run diffed against.
- **full_db_export/** -- the full current DB state (every word/expression,
  not just the missing ones), in the same json/csv/xlsx shapes as
  `manage.py export`'s own output, generated from the same DB scan.
- **full_db_export.zip** -- `wordCorpus.json` + `expressionCorpus.json` from
  `full_db_export/` above, bundled with every matched local audio file
  (words and expressions alike), as one file to hand off.
- **unmatched_audio/** -- local audio files that don't match any current
  word/expression by filename (only present if there were any).
"""
