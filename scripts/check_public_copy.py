from pathlib import Path
import sys
EXTS = {".md",".txt",".json",".yml",".yaml",".csv",".html",".js",".ts",".py"}
BAD = ["\u00c3","\u00c2","\u00e2\u20ac","\u00ef\u00bf\u00bd","\ufffd"]
failures = []
for p in Path(".").rglob("*"):
    if not p.is_file() or ".git" in p.parts or p.suffix.lower() not in EXTS:
        continue
    try:
        text = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        failures.append(f"{p}: invalid UTF-8")
        continue
    for marker in BAD:
        if marker in text:
            failures.append(f"{p}: suspicious encoding sequence {marker!r}")
if failures:
    print("PUBLIC COPY QUALITY GATE: FAIL")
    for failure in failures:
        print(f"- {failure}")
    sys.exit(1)
print("PUBLIC COPY QUALITY GATE: PASS")