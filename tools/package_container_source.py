"""Package corresponding source from the sanitized Docker context, without Git."""

import sys
import os
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
excluded = {
    ".git",
    ".local",
    ".runtime",
    ".venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    "test-results",
    "evidence",
    "static",
    "frontend-dist",
}
with ZipFile(sys.argv[1], "w", ZIP_DEFLATED) as archive:
    for directory, directories, files in os.walk(root):
        directories[:] = sorted(name for name in directories if name not in excluded)
        for name in sorted(files):
            path = Path(directory) / name
            if path.suffix in {".env", ".log", ".zip", ".pyc", ".webm", ".dump"}:
                continue
            archive.write(path, path.relative_to(root).as_posix())
