import os
import sys
from pathlib import Path


def configure_argos_home():
    root = Path(
        os.environ.get(
            "BOOKT_ARGOS_HOME",
            Path(__file__).resolve().parents[1] / ".codex-run" / "argos",
        )
    )
    os.environ.setdefault("XDG_CONFIG_HOME", str(root / "config"))
    os.environ.setdefault("XDG_DATA_HOME", str(root / "data"))
    os.environ.setdefault("XDG_CACHE_HOME", str(root / "cache"))
    os.environ.setdefault("ARGOS_PACKAGES_DIR", str(root / "packages"))
    return root


def main():
    args = sys.argv[1:] or ["pl", "en", "en", "pt"]
    if len(args) % 2 != 0:
        raise SystemExit("Pass language pairs as: from1 to1 [from2 to2 ...]")

    pairs = list(zip(args[0::2], args[1::2]))
    root = configure_argos_home()

    import argostranslate.package

    print(f"Using Argos home: {root}")
    argostranslate.package.update_package_index()

    available = argostranslate.package.get_available_packages()
    for from_code, to_code in pairs:
        print(f"Installing translation package: {from_code}->{to_code}")
        for package in available:
            if package.from_code == from_code and package.to_code == to_code:
                package_path = package.download()
                argostranslate.package.install_from_path(package_path)
                print(f"Installed {from_code}->{to_code}")
                break
        else:
            raise SystemExit(f"Translation package not found: {from_code}->{to_code}")



if __name__ == "__main__":
    main()
