"""Verify copied source hashes, graph shapes, and notebook syntax without network access."""
import ast
import hashlib
import json
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'integrations/manifest.json').read_text(encoding='utf-8'))
files=0;graphs=0
for source in manifest:
    folder=ROOT/'integrations/sources'/source['repo'].split('/')[1].lower()
    if not (folder/'LICENSE').is_file():raise SystemExit(f'Missing source license: {source["repo"]}')
    if not source.get('licenseSha256') or hashlib.sha256((folder/'LICENSE').read_bytes()).hexdigest()!=source['licenseSha256']:raise SystemExit(f'License checksum mismatch: {source["repo"]}')
    for entry in source['files']:
        digest=hashlib.sha256((folder/entry['path']).read_bytes()).hexdigest()
        if digest!=entry['sha256']:raise SystemExit(f'Source checksum mismatch: {source["repo"]}/{entry["path"]}')
        files+=1
    for workflow in source['workflows']:
        graph=json.loads((ROOT/'integrations/workflows'/(workflow['id']+'.json')).read_text(encoding='utf-8'))
        if not graph or not all(isinstance(node,dict) and isinstance(node.get('class_type'),str) and isinstance(node.get('inputs'),dict) for node in graph.values()):raise SystemExit(f'Invalid API graph: {workflow["id"]}')
        graphs+=1
notebook=json.loads((ROOT/'notebooks/Open_Higgs_Twin_T4.ipynb').read_text(encoding='utf-8'))
cells=0
for cell in notebook['cells']:
    if cell['cell_type']=='code':ast.parse(''.join(cell['source']));cells+=1
print(f'OK: {len(manifest)} source licenses, {files} source hashes, {graphs} API graphs, {cells} notebook code cells.')
