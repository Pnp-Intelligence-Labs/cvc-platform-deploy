"""
extract_dataroom.py — Extract a ZIP dataroom into the DD pipeline workdir.

Usage:
    python3 extract_dataroom.py --zip /path/to/dataroom.zip --company "Acme Robotics"
    python3 extract_dataroom.py --zip dataroom.zip --company "Acme" --flat  # flatten nested folders

Extracts to: workdir/[company]/
"""

import argparse
import os
import sys
import zipfile
from pathlib import Path

# Allow running from repo root
sys.path.insert(0, str(Path(__file__).parent))

from config.settings import WORKDIR


def extract(zip_path: str, company: str, flat: bool = False) -> Path:
    """Extract ZIP to workdir/[company]/. Returns the target directory."""
    target = WORKDIR / company

    if not os.path.isfile(zip_path):
        print(f"ERROR: ZIP file not found: {zip_path}")
        sys.exit(1)

    if not zipfile.is_zipfile(zip_path):
        print(f"ERROR: Not a valid ZIP file: {zip_path}")
        sys.exit(1)

    # Create target dir
    target.mkdir(parents=True, exist_ok=True)

    print(f"Extracting {zip_path} → {target}/")

    extracted = 0
    skipped = 0

    with zipfile.ZipFile(zip_path, 'r') as zf:
        for member in zf.namelist():
            # Skip __MACOSX and .DS_Store
            if '__MACOSX' in member or member.endswith('.DS_Store'):
                skipped += 1
                continue

            # Determine final path
            if flat:
                # Flatten: take just the filename, skip directory structure
                filename = os.path.basename(member)
                if not filename:
                    continue
                dest = target / filename
            else:
                dest = target / member

            # Handle duplicate filenames when flattening
            if flat and dest.exists():
                stem = dest.stem
                suffix = dest.suffix
                counter = 1
                while dest.exists():
                    dest = target / f"{stem}_{counter}{suffix}"
                    counter += 1

            # Extract
            if member.endswith('/'):
                dest.mkdir(parents=True, exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member) as src, open(dest, 'wb') as dst:
                    dst.write(src.read())
                extracted += 1

    print(f"Done: {extracted} files extracted, {skipped} skipped (macOS metadata)")
    print(f"Target: {target}/")
    return target


def main():
    parser = argparse.ArgumentParser(description="Extract ZIP dataroom to DD pipeline workdir")
    parser.add_argument("--zip", required=True, help="Path to ZIP file")
    parser.add_argument("--company", required=True, help="Company name (used as workdir folder name)")
    parser.add_argument("--flat", action="store_true", help="Flatten nested folder structure")
    args = parser.parse_args()

    target = extract(args.zip, args.company, flat=args.flat)

    # List what was extracted
    print(f"\nContents of {target}/:")
    for item in sorted(target.iterdir()):
        size = item.stat().st_size if item.is_file() else sum(
            f.stat().st_size for f in item.rglob('*') if f.is_file()
        )
        label = f"{size / 1024:.0f}KB" if size < 1024 * 1024 else f"{size / (1024*1024):.1f}MB"
        prefix = "  📁" if item.is_dir() else "  📄"
        print(f"{prefix} {item.name} ({label})")

    print(f"\nNext: python3 run_three.py --company \"{args.company}\" --skip-ingest")


if __name__ == "__main__":
    main()
