"""Check the Git publication set without printing candidate secret values."""
import pathlib
import re
import subprocess

ROOT=pathlib.Path(__file__).resolve().parents[1]
names=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT).decode('utf-8').split('\0')
patterns=[
    re.compile(rb'gh[pousr]_[A-Za-z0-9]{30,}'),
    re.compile(rb'github_pat_[A-Za-z0-9_]{40,}'),
    re.compile(rb'AKIA[0-9A-Z]{16}'),
    re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    re.compile(rb'sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}'),
]
errors=[];checked=0
for name in sorted(set(names)):
    if not name:continue
    path=ROOT/name
    if not path.is_file():continue
    relative=pathlib.PurePosixPath(name)
    if any(part in {'node_modules','data','work','.git'} for part in relative.parts) or relative.name=='.env' or path.suffix in {'.db','.sqlite','.sqlite3','.log','.pyc'}:
        errors.append(name+': runtime or credential file included');continue
    data=path.read_bytes();checked+=1
    if b'\0' in data[:8192]:continue
    if any(pattern.search(data) for pattern in patterns):errors.append(name+': possible credential or private key')
if errors:raise SystemExit('Publication check failed:\n'+'\n'.join(errors))
print(f'Publication check passed: {checked} files, no runtime data or recognized secret patterns. This is a focused check, not a guarantee against every secret format.')
