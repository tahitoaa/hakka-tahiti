"""Copie le module commun de grammaire tumu-kin dans les fichiers statiques.

tumu-kin (https://github.com/tahitoaa/tumu-kin) est partagé avec tumuparau.
Le site n'a pas d'étape de compilation : on en garde une copie dans
hakkadbapp/static/hakkadbapp/vendor/tumu-kin/, comme lamejs, avec la version
copiée dans VERSION.

    python tools/vendor_tumu_kin.py [chemin du dépôt tumu-kin]

Par défaut : ws/tumu-kin, à côté de ws/hakka.
"""
import shutil
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
DEST = APP / "hakkadbapp" / "static" / "hakkadbapp" / "vendor" / "tumu-kin"
FILES = ["tumu-kin.js", "arbre.css", "etiquettes-de-base.json", "LICENSE"]


def main():
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else APP.parent.parent / "tumu-kin"
    if not (source / "tumu-kin.js").exists():
        sys.exit(f"tumu-kin introuvable dans {source}")
    version = subprocess.run(["git", "-C", str(source), "describe", "--tags", "--always", "--dirty"],
                             capture_output=True, text=True).stdout.strip() or "inconnue"
    DEST.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        if (source / name).exists():
            shutil.copy2(source / name, DEST / name)
    (DEST / "VERSION").write_text(version + "\n", encoding="utf-8")
    print(f"tumu-kin {version} copié dans {DEST.relative_to(APP)}")


if __name__ == "__main__":
    main()
