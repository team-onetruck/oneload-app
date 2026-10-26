"""Rebuild the bundled static UI font from a local official Noto Sans KR variable TTF.

Usage: python tools/subset-font.py path/to/NotoSansKR.ttf path/to/OFL.txt
Requires fonttools. No network or Unity is used.
"""
import hashlib
import json
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parent.parent
source, license_path = map(Path, sys.argv[1:])
chars = set(chr(i) for i in range(32, 127))
for folder in ("Core", "Runtime"):
    for path in (root / "Assets/Hangil" / folder).glob("*.cs"):
        chars.update(path.read_text(encoding="utf-8"))
chars.difference_update("\r\n\t")
font = instantiateVariableFont(TTFont(source), {"wght": 400}, inplace=True)
font.recalcTimestamp = False
# OFL reserves Noto as a name: give the modified subset a distinct family name.
for record in font["name"].names:
    names = {1: "Hangil UI", 2: "Regular", 3: "HangilUI-Regular-1", 4: "Hangil UI Regular", 6: "HangilUI-Regular", 16: "Hangil UI", 17: "Regular"}
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
options = subset.Options()
options.name_IDs = ["*"]
options.name_legacy = True
subsetter = subset.Subsetter(options=options)
subsetter.populate(text="".join(sorted(chars)))
subsetter.subset(font)
missing = {ord(c) for c in chars} - set(font.getBestCmap())
if missing:
    raise SystemExit(f"Font lacks requested codepoints: {sorted(missing)}")
output = root / "Assets/Hangil/Resources/HangilUi.ttf"
output.parent.mkdir(parents=True, exist_ok=True)
font.save(output)
third_party = root / "ThirdParty"
(third_party / "font-OFL.txt").write_bytes(license_path.read_bytes())
info = {
    "source": "https://github.com/google/fonts/tree/main/ofl/notosanskr",
    "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "subset_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    "family": "Hangil UI", "weight": 400, "license": "SIL Open Font License 1.1",
    "characters": "".join(sorted(chars)), "bytes": output.stat().st_size,
    "modification": "Static weight 400, UI character subset, renamed family; rebuild when UI text changes.",
}
(third_party / "font-source.json").write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"UI font: {output.stat().st_size} bytes, {len(chars)} codepoints requested")
