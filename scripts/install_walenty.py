"""Install the compact Walenty Polish valency dictionary for local grammar help."""

from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
INSTALL_DIR = ROOT / ".codex-run" / "walenty"
ARCHIVE_URL = (
    "https://clarin-pl.eu/dspace/bitstream/handle/11321/586/"
    "walenty_20180630-text.zip?isAllowed=y&sequence=1"
)


def installed_dictionary():
    return next(INSTALL_DIR.rglob("walenty_*_verbs_verified.txt"), None)


def safe_extract(archive, destination):
    destination = destination.resolve()
    for member in archive.infolist():
        target = (destination / member.filename).resolve()
        if destination not in target.parents and target != destination:
            raise RuntimeError(f"Unsafe path in Walenty archive: {member.filename}")
    archive.extractall(destination)


if __name__ == "__main__":
    existing = installed_dictionary()
    if existing:
        print(f"Walenty is already installed at {existing}")
        raise SystemExit(0)

    INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    archive_path = INSTALL_DIR / "walenty-text.zip"
    print("Downloading the Walenty Polish valency dictionary...")
    with urlopen(ARCHIVE_URL, timeout=120) as response:
        archive_path.write_bytes(response.read())

    try:
        with ZipFile(archive_path) as archive:
            safe_extract(archive, INSTALL_DIR)
    finally:
        archive_path.unlink(missing_ok=True)

    installed = installed_dictionary()
    if not installed:
        raise RuntimeError("Walenty archive did not contain the expected verb dictionary.")
    print(f"Walenty installed at {installed}")
