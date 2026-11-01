"""Derives the Wenfa -> <dictionary> mapping automatically and writes it into
romanization.json as that dictionary's transcription system ("baoan",
"mciver"...).

    python manage.py derive_source_mapping mciver                   # report only (dry run)
    python manage.py derive_source_mapping mciver --write           # + update romanization.json
    python manage.py derive_source_mapping mciver --csv report.csv  # + per-character comparison

(`derive_baoan_mapping` is the same command for the Bao'an dictionary.)

How it works: every character that has a reading both in the Supabase
lexicon (Wenfa: initial/final/tone) and in the dictionary's compact index
(static/hakkadbapp/data/*.json, see build_dict_index) is a data point.
  1. Characters with a single reading on both sides pair up unambiguously;
     majority votes over them give the initial, final and tone maps.
  2. Polyphones are then paired reading-to-reading with the dictionary reading
     closest to what step 1 predicts, and the votes are redone with them.
  3. An initial spelled differently before i- finals (Wenfa ng -> McIver ny
     before i, ng elsewhere) gets a contextual rule ("rules").
  4. A Wenfa syllable (initial+final) whose majority dictionary spelling differs
     from what the maps and rules give -- consistently, on enough characters --
     becomes a whole-syllable override ("syllables").
  5. Every dictionary spelling observed for a Wenfa syllable that the above
     doesn't produce (lexical splits such as Wenfa z -> McIver ts or ch) is
     listed in "input_syllables", so typing it still finds the character.
Tones are lexical, not phonological: Wenfa tone 4 is split between Bao'an
5 and 3 depending on the character, so no syllable-level rule can get every
tone right. The report gives the accuracy so it's clear what the system can
and can't do.

--write regenerates that dictionary's whole system: edit romanization.json by
hand only after the last regeneration (or adjust the thresholds here).
"""
import csv
import json
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

from django.core.management.base import BaseCommand
from opencc import OpenCC

from hakkadbapp import romanization
from hakkadbapp.models import Pronunciation

APP_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = APP_DIR / "static" / "hakkadbapp" / "data"
SUPERSCRIPT = {"1": "¹", "2": "²", "3": "³", "5": "⁵", "7": "⁷", "8": "⁸"}

# One entry per dictionary of build_dict_index: its compact file, the system
# written into romanization.json, and its initials (longest first) to split
# a syllable into initial + final.
SOURCES = {
    "baoan": {
        "file": "hakka_dict_prons.json",
        "label": "Bao'an (陳志明)",
        "source": "客家話大辭典（寶安腔）, 陳志明 -- mapping déduit automatiquement",
        "name": "dictionnaire Bao'an",
        # No distinct n-: it's l- or ng-.
        "initials": ["ts'", "ts", "p'", "t'", "k'", "ng", "f", "h", "j", "k", "l", "m", "p", "s", "t", "w"],
    },
    "mciver": {
        "file": "mciver_prons.json",
        "label": "McIver",
        "source": "McIver, A Chinese-English Dictionary, Hakka-Dialect (Hakka Index) -- mapping déduit automatiquement",
        "name": "index McIver",
        # Aspiration spelled with h (kh, ph, th, tsh, chh); ch/chh/sh/ny kept
        # apart from ts/tsh/s/ng as McIver writes them.
        "initials": ["tsh", "chh", "ts", "ch", "sh", "kh", "ph", "th", "ng", "ny",
                     "p", "m", "f", "v", "t", "n", "l", "k", "h", "s", "j", "y", "w"],
    },
}
MIN_OVERRIDE_SUPPORT = 2     # characters needed before a syllable override is created
MIN_OVERRIDE_SHARE = 0.6     # ...and the share of them that must agree
MIN_INPUT_TONE_SHARE = 0.10  # a Wenfa tone behind >= 10% of a Bao'an tone is offered when typing it


def split_syllable(syllable, initials):
    for initial in initials:
        if syllable.startswith(initial):
            return initial, syllable[len(initial):]
    return "", syllable


def majority(counter):
    return counter.most_common(1)[0][0] if counter else None


class Command(BaseCommand):
    help = "Derive the Wenfa -> dictionary transcription mapping from shared characters."
    default_source = None

    def add_arguments(self, parser):
        if self.default_source:
            parser.set_defaults(source=self.default_source)
        else:
            parser.add_argument("source", choices=sorted(SOURCES), help="Dictionary (see build_dict_index).")
        parser.add_argument("--write", action="store_true", help="Write the dictionary's system into romanization.json.")
        parser.add_argument("--csv", dest="csv_path", help="Write a per-character comparison to this CSV file.")

    def handle(self, *args, source, write=False, csv_path=None, **options):
        self.system_id = source
        self.spec = SOURCES[source]
        wenfa = self.load_wenfa()
        baoan = self.load_source()
        # One data point per character, not per written form: 粪/糞 or
        # 签/籤 are the same character and must not vote twice.
        s2t = OpenCC("s2t")
        canonical = {}
        for char in sorted(set(wenfa) & set(baoan)):
            canonical.setdefault(s2t.convert(char), char)
        shared = sorted(canonical.values())
        self.stdout.write(f"{len(wenfa)} caractères dans le lexique, {len(baoan)} dans le dictionnaire, {len(shared)} en commun.")

        # Step 1: unambiguous pairs only.
        pairs = [(c, wenfa[c][0], baoan[c][0]) for c in shared if len(wenfa[c]) == 1 and len(baoan[c]) == 1]
        maps = self.vote(pairs)
        self.stdout.write(f"Étape 1 : {len(pairs)} caractères monophones des deux côtés.")

        # Step 2: pair polyphones by closeness to the step-1 prediction, revote.
        pairs = self.pair_all(shared, wenfa, baoan, maps)
        maps = self.vote(pairs)
        self.stdout.write(f"Étape 2 : {len(pairs)} paires lecture-à-lecture (polyphones inclus).")

        # Steps 3-5: whole-syllable overrides, then attested spellings for input.
        maps["syllables"] = self.overrides(pairs, maps)
        maps["input_syllables"] = self.input_syllables(pairs, maps)

        # Every Wenfa initial/final in use gets an explicit entry, even
        # without evidence (copied verbatim, and reported).
        inventory = {(i, f) for readings in wenfa.values() for i, f, _ in readings}
        no_data = []
        for i in sorted({i for i, _ in inventory}):
            if i not in maps["initials"]:
                maps["initials"][i] = i
                no_data.append(f"initiale '{i}'")
        for f in sorted({f for _, f in inventory}):
            if f not in maps["finals"]:
                maps["finals"][f] = f
                no_data.append(f"finale '{f}'")

        system = self.build_system(maps, len(pairs))
        self.report(maps, pairs, system, no_data)

        if csv_path:
            self.write_csv(csv_path, shared, wenfa, baoan, system)
            self.stdout.write(f"Comparaison par caractère écrite dans {csv_path}")
        if write:
            self.write_system(system)
        else:
            self.stdout.write("(Simulation : relancer avec --write pour mettre à jour romanization.json.)")

    # -- data -------------------------------------------------------------
    def load_wenfa(self):
        readings = defaultdict(set)
        for p in Pronunciation.objects.select_related("initial", "final", "tone"):
            if not p.tone:
                continue
            reading = (p.initial.initial or "", p.final.final or "", str(p.tone.tone_number))
            for char in {p.hanzi, p.simp(), p.trad()} - {None, ""}:
                readings[char].add(reading)
        return {c: sorted(r) for c, r in readings.items()}

    def load_source(self):
        data = json.loads((DATA_DIR / self.spec["file"]).read_text(encoding="utf-8"))
        readings = defaultdict(set)
        for row in data["prons"]:
            trad, syllable, tone = row[0], row[1], str(row[2])
            for char in {trad, row[3] if len(row) > 3 else trad}:
                readings[char].add((syllable, tone))
        return {c: sorted(r) for c, r in readings.items()}

    # -- derivation -------------------------------------------------------
    def vote(self, pairs):
        votes = {"initials": defaultdict(Counter), "finals": defaultdict(Counter), "tones": defaultdict(Counter)}
        # Initials again, split by context: before an i- final or not.
        by_context = {True: defaultdict(Counter), False: defaultdict(Counter)}
        for _, (i, f, t), (syllable, bt) in pairs:
            bi, bf = split_syllable(syllable, self.spec["initials"])
            votes["initials"][i][bi] += 1
            by_context[f.startswith("i")][i][bi] += 1
            votes["finals"][f][bf] += 1
            votes["tones"][t][bt] += 1

        # The plain map takes the spelling used outside i- finals (when the
        # initial occurs there at all); a different, consistent spelling
        # before i- becomes a rule -- instead of one majority for both,
        # which made Wenfa ng always McIver ny (nyai for ngai).
        initials, rules = {}, []
        for i, counter in votes["initials"].items():
            plain = by_context[False].get(i)
            initials[i] = majority(plain) if plain else majority(counter)
            before_i = by_context[True].get(i)
            if before_i:
                best, n = before_i.most_common(1)[0]
                if best != initials[i] and n >= MIN_OVERRIDE_SUPPORT and n / sum(before_i.values()) >= MIN_OVERRIDE_SHARE:
                    rules.append({
                        "_comment": f"déduit : {n}/{sum(before_i.values())} caractères",
                        "when": {"initial": i, "final_startswith": "i"},
                        "then": {"initial": best},
                    })
        return {
            "initials": initials,
            "rules": rules,
            "finals": {k: majority(v) for k, v in votes["finals"].items()},
            "tones": {k: majority(v) for k, v in votes["tones"].items()},
            "votes": votes,
        }

    @staticmethod
    def predict(maps, i, f, t=None):
        syllable = maps.get("syllables", {}).get(f"{i}+{f}")
        if syllable is None:
            out_i, out_f = maps["initials"].get(i, i), maps["finals"].get(f, f)
            for rule in maps.get("rules", []):
                if romanization._matches(rule["when"], i, f):
                    out_i = rule["then"].get("initial", out_i)
                    out_f = rule["then"].get("final", out_f)
            syllable = out_i + out_f
        return syllable, (maps["tones"].get(t, t) if t is not None else None)

    def pair_all(self, shared, wenfa, baoan, maps):
        pairs = []
        for char in shared:
            for w in wenfa[char]:
                predicted, ptone = self.predict(maps, *w)
                best = max(
                    baoan[char],
                    key=lambda b: (SequenceMatcher(None, predicted, b[0]).ratio(), b[1] == ptone),
                )
                # Polyphones whose closest reading is still far off are
                # probably different words: leave them out of the vote.
                if len(wenfa[char]) == 1 and len(baoan[char]) == 1 or \
                        SequenceMatcher(None, predicted, best[0]).ratio() >= 0.75:
                    pairs.append((char, w, best))
        return pairs

    def overrides(self, pairs, maps):
        # Support = distinct characters, so one polyphone (托 dok5/dok6)
        # can't create an override on its own.
        chars = defaultdict(lambda: defaultdict(set))
        for char, (i, f, _t), (syllable, _bt) in pairs:
            chars[(i, f)][syllable].add(char)
        by_syllable = {k: Counter({s: len(c) for s, c in v.items()}) for k, v in chars.items()}
        syllables = {}
        for (i, f), counter in sorted(by_syllable.items()):
            best, n = counter.most_common(1)[0]
            total = sum(counter.values())
            rule_based = self.predict({**maps, "syllables": {}}, i, f)[0]
            if best != rule_based and n >= MIN_OVERRIDE_SUPPORT and n / total >= MIN_OVERRIDE_SHARE:
                syllables[f"{i}+{f}"] = best
        return syllables

    def input_syllables(self, pairs, maps):
        """Dictionary spelling -> Wenfa syllables it was observed for, when
        the mapping doesn't already produce it (Romanization.js adds these to
        its typing index)."""
        observed = defaultdict(set)
        for _, (i, f, _t), (syllable, _bt) in pairs:
            if self.predict(maps, i, f)[0] != syllable:
                observed[syllable].add(f"{i}+{f}")
        return {s: sorted(v) for s, v in sorted(observed.items())}

    def build_system(self, maps, n_pairs):
        tones = {t: SUPERSCRIPT.get(bt, bt) for t, bt in sorted(maps["tones"].items())}
        tones[""] = ""
        # Typing direction: a Bao'an tone digit stands for every Wenfa tone
        # that commonly lands on it (tones are lexical: Bao'an 3 is Wenfa 3
        # but also a third of Wenfa 4), not just the exact reverse of `tones`.
        by_baoan = defaultdict(Counter)
        for t, counter in maps["votes"]["tones"].items():
            for bt, n in counter.items():
                by_baoan[bt][t] += n
        input_tones = {}
        for bt, counter in sorted(by_baoan.items()):
            total = sum(counter.values())
            input_tones[bt] = sorted(t for t, n in counter.items() if n / total >= MIN_INPUT_TONE_SHARE)
        return {
            "id": self.system_id,
            "label": self.spec["label"],
            "source": self.spec["source"],
            "_comment": (
                f"GÉNÉRÉ par `manage.py derive_source_mapping {self.system_id}` à partir de {n_pairs} paires de lectures "
                f"(lexique Wenfa x {self.spec['name']}). Les tons sont lexicaux : le ton 4 Wenfa "
                "correspond à ⁵ ou ³ selon le caractère, d'où des erreurs inévitables (voir le rapport)."
            ),
            "initials": dict(sorted(maps["initials"].items())),
            "finals": dict(sorted(maps["finals"].items())),
            "tones": tones,
            "rules": maps["rules"],
            "syllables": maps["syllables"],
            "input_tones": input_tones,
            "input_syllables": maps["input_syllables"],
        }

    # -- output -----------------------------------------------------------
    def report(self, maps, pairs, system, no_data):
        votes = maps["votes"]
        out = self.stdout.write

        def table(title, key):
            out(f"\n{title}")
            for k in sorted(votes[key]):
                counter = votes[key][k]
                total = sum(counter.values())
                best, n = counter.most_common(1)[0]
                others = ", ".join(f"{v or '∅'}:{c}" for v, c in counter.most_common()[1:4])
                flag = "" if n / total >= 0.85 else "   <- partagé"
                out(f"  {k or '∅':>5} -> {best or '∅':<5} {n}/{total} ({n / total:.0%}){'  autres ' + others if others else ''}{flag}")

        table(f"Initiales (Wenfa -> {self.spec['label']}) :", "initials")
        table("Finales :", "finals")
        table("Tons :", "tones")
        if system["rules"]:
            out("\nRègles contextuelles : " + ", ".join(
                f"{r['when']['initial']} + i… -> {r['then']['initial']}" for r in system["rules"]))
        if system["syllables"]:
            out("\nSyllabes particulières : " + ", ".join(f"{k} -> {v}" for k, v in system["syllables"].items()))
        if no_data:
            out(self.style.WARNING("\nSans donnée (recopiés tels quels) : " + ", ".join(no_data)))

        ok_syl = ok_tone = 0
        for _, (i, f, t), (syllable, bt) in pairs:
            ok_syl += self.predict(maps, i, f)[0] == syllable
            ok_tone += maps["tones"].get(t) == bt
        n = len(pairs) or 1
        out(f"\nOrthographes attestées ajoutées pour la saisie : {len(system['input_syllables'])}.")
        out(self.style.SUCCESS(
            f"\nFiabilité sur {len(pairs)} paires : syllabe exacte {ok_syl / n:.0%}, ton exact {ok_tone / n:.0%}."
        ))

    def write_csv(self, path, shared, wenfa, baoan, system):
        maps = {"initials": system["initials"], "finals": system["finals"], "syllables": system["syllables"],
                "rules": system["rules"], "tones": {t: v for t, v in system["tones"].items()}}
        with open(path, "w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["hanzi", "wenfa", f"{self.system_id}_prédit", f"{self.system_id}_dictionnaire", "syllabe_ok", "ton_ok"])
            for char in shared:
                dict_readings = [s + t for s, t in baoan[char]]
                for i, f, t in wenfa[char]:
                    syllable = self.predict(maps, i, f)[0]
                    tone = next((bt for bt, sup in SUPERSCRIPT.items() if sup == system["tones"].get(t)), t)
                    writer.writerow([
                        char, f"{i}{f}{t}", f"{syllable}{tone}", " ".join(dict_readings),
                        any(s == syllable for s, _ in baoan[char]),
                        (syllable, tone) in baoan[char],
                    ])

    def write_system(self, system):
        path = romanization.CONFIG_PATH
        config = json.loads(path.read_text(encoding="utf-8"))
        systems = [s for s in config["systems"] if s.get("id") != self.system_id] + [system]
        config["systems"] = systems
        romanization.validate(config)
        # LF explicitly: on Windows text mode would write CRLF, and the JS
        # parity test hashes the raw file (see tests/romanization.test.js).
        path.write_text(format_config(config), encoding="utf-8", newline="\n")
        romanization.load_config.cache_clear()
        self.stdout.write(self.style.SUCCESS(
            f"Système '{self.system_id}' écrit dans {path}. Penser à : manage.py check_romanization --fixture, puis npm test."
        ))


def format_config(config):
    """JSON in the same hand-readable layout as romanization.json: one line
    per short value, maps wrapped over a few lines, one rule per line."""
    dumps = lambda v: json.dumps(v, ensure_ascii=False)

    def wrapped_map(d, indent):
        items = [f"{dumps(k)}: {dumps(v)}" for k, v in d.items()]
        lines, line = [], ""
        for item in items:
            if line and len(line) + len(item) > 100:
                lines.append(line.rstrip())
                line = ""
            line += item + ", "
        if line:
            lines.append(line.rstrip(", "))
        if not lines:
            return "{}"
        pad = " " * (indent + 2)
        return "{\n" + ",\n".join(pad + l.rstrip(",") for l in lines) + "\n" + " " * indent + "}"

    def system_block(s):
        parts = []
        for key, value in s.items():
            if isinstance(value, dict):
                parts.append(f'      {dumps(key)}: {wrapped_map(value, 6)}')
            elif isinstance(value, list) and key == "rules":
                if not value:
                    parts.append('      "rules": []')
                else:
                    parts.append('      "rules": [\n' + ",\n".join("        " + dumps(r) for r in value) + "\n      ]")
            else:
                parts.append(f"      {dumps(key)}: {dumps(value)}")
        return "    {\n" + ",\n".join(parts) + "\n    }"

    head = []
    for key, value in config.items():
        if key in ("systems", "_version"):
            continue
        if key == "_readme":
            head.append('  "_readme": [\n' + ",\n".join("    " + dumps(l) for l in value) + "\n  ]")
        else:
            head.append(f"  {dumps(key)}: {dumps(value)}")
    systems = ",\n\n".join(system_block(s) for s in config["systems"])
    return "{\n" + ",\n\n".join(head) + ',\n\n  "systems": [\n' + systems + "\n  ]\n}\n"
