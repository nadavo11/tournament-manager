"""Package the corresponding AGPL source; fail closed on credentials and runtime files."""
import subprocess
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root=Path(__file__).resolve().parent.parent
files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root).decode().split('\0')
target=root/'backend/source.zip'
with ZipFile(target,'w',ZIP_DEFLATED) as z:
    for name in sorted(set(files)):
        if not name:
            continue
        p=Path(name)
        if any(part in {'.git','.local','.venv','node_modules','test-results','report','video'} for part in p.parts):
            continue
        if p.suffix in {'.env','.log','.zip'} or p.name=='demo-accounts.json':
            continue
        f=root/p
        if f.is_file():
            z.write(f,name)
print('Packaged corresponding source:',target)
