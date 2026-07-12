from pathlib import Path

import stanza


ROOT = Path(__file__).resolve().parents[1] / ".codex-run" / "stanza"


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    stanza.download(
        "fr",
        model_dir=str(ROOT),
        processors="tokenize,mwt,pos,lemma",
        logging_level="WARN",
    )
    print(f"French Stanza models installed in {ROOT}")


if __name__ == "__main__":
    main()
