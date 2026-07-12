"""Download the lightweight Polish Stanza processors BookT uses."""

from pathlib import Path

import stanza


MODEL_DIR = Path(__file__).resolve().parents[1] / ".codex-run" / "stanza"
PROCESSORS = {
    "tokenize": "pdb",
    "mwt": "pdb",
    "pos": "pdb_nocharlm",
    "lemma": "pdb_nocharlm",
    "depparse": "pdb_nocharlm",
}


if __name__ == "__main__":
    stanza.download(
        "pl",
        model_dir=str(MODEL_DIR),
        processors=PROCESSORS,
        package=None,
    )
    print(f"Polish language models installed in {MODEL_DIR}")
