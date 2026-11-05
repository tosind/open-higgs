"""Outbound-only ComfyUI worker, one instance per GPU. Python standard library only."""
import argparse
import base64
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def prepare_assets(studio, comfy, token, job):
    graph = job['payload']['workflow']
    for asset in job['payload'].get('assets', []):
        req = urllib.request.Request(studio + '/api/studio/worker/assets/' + asset['id'], headers={'Authorization': 'Bearer ' + token})
        with urllib.request.urlopen(req, timeout=90) as response:
            data = response.read(45_000_000 + 1)
        if len(data) > 45_000_000:
            raise RuntimeError('Input media exceeds the 45 MB worker limit.')
        boundary = 'OpenHiggs' + uuid.uuid4().hex
        name = re.sub(r'[^\w.-]', '_', asset['name'], flags=re.ASCII)
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + data + f'\r\n--{boundary}--\r\n'.encode())
        req = urllib.request.Request(comfy + '/upload/image',data=body,headers={'Content-Type':'multipart/form-data; boundary='+boundary},method='POST')
        with urllib.request.urlopen(req,timeout=90) as response:
            result=json.load(response)
        if not result.get('name'):
            raise RuntimeError('ComfyUI did not return an uploaded filename.')
        graph[asset['node']]['inputs'][asset['field']]='/'.join(part for part in [result.get('subfolder'),result['name']] if part)
    return graph


def request(url, payload=None, headers=None, method=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json', **(headers or {})}, method=method)
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.load(response)


def process_job(studio, comfy, token, job):
    headers = {'Authorization': 'Bearer ' + token}
    endpoint = studio + '/api/studio/worker/' + job['id']
    stop = threading.Event()
    lost_lease = threading.Event()

    def heartbeat():
        while not stop.wait(20):
            try:
                request(endpoint, {'lease': job['lease'], 'status': 'running'}, headers)
            except urllib.error.HTTPError as error:
                if error.code == 409:
                    lost_lease.set()
                    return
            except (OSError, ValueError):
                pass

    beat = threading.Thread(target=heartbeat, daemon=True)
    beat.start()
    try:
        # Never retry a submission with an unknown outcome.
        graph = prepare_assets(studio, comfy, token, job)
        task = request(comfy + '/prompt', {'prompt': graph, 'client_id': job['id']})
        if task.get('error') or task.get('node_errors'):
            raise RuntimeError('ComfyUI rejected workflow: ' + json.dumps(task)[:1000])
        prompt_id = task['prompt_id']
        while True:
            if lost_lease.is_set():
                raise RuntimeError('Studio lease lost; inspect this notebook before submitting a replacement.')
            try:
                history = request(comfy + '/history/' + prompt_id).get(prompt_id)
            except (OSError, ValueError):
                time.sleep(5)
                continue
            if history and history.get('status', {}).get('status_str') == 'error':
                raise RuntimeError(json.dumps(history['status'].get('messages', []))[:1500])
            if history and history.get('status', {}).get('completed'):
                break
            time.sleep(3)
        outputs = []
        for output in history.get('outputs', {}).values():
            for kind in ['images', 'gifs', 'videos', 'audio', 'files']:
                for file in output.get(kind, []):
                    if not file.get('filename'):
                        continue
                    query = urllib.parse.urlencode({key: file.get(key, default) for key, default in [('filename', ''), ('subfolder', ''), ('type', 'output')]})
                    with urllib.request.urlopen(comfy + '/view?' + query, timeout=90) as response:
                        data = response.read(45_000_000 + 1)
                    if len(data) > 45_000_000:
                        raise RuntimeError('Output exceeds the 45 MB transport limit. Save it from Kaggle and lower the preview size.')
                    name = str(len(outputs)) + '-' + re.sub(r'[^\w.-]', '_', os.path.basename(file['filename']), flags=re.ASCII)
                    upload = request(endpoint + '/artifact/' + urllib.parse.quote(name), {'base64': base64.b64encode(data).decode()}, {**headers, 'X-Worker-Lease': job['lease']}, 'PUT')
                    outputs.append(upload['url'])
        if not outputs:
            raise RuntimeError('Workflow completed without supported outputs.')
        request(endpoint, {'lease': job['lease'], 'status': 'completed', 'outputs': outputs}, headers)
    except Exception as error:
        try:
            request(endpoint, {'lease': job['lease'], 'status': 'failed', 'error': str(error)}, headers)
        except Exception:
            print('Could not report job result. Job will expire without automatic retry.', flush=True)
        print('Job failed:', str(error), flush=True)
    finally:
        stop.set()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--studio', required=True)
    parser.add_argument('--comfy', default='http://127.0.0.1:8188')
    parser.add_argument('--worker', default='kaggle-t4-0')
    args = parser.parse_args()
    token = os.environ.get('OPENHIGGS_WORKER_TOKEN', '')
    if len(token) < 24:
        raise SystemExit('Set OPENHIGGS_WORKER_TOKEN to a shared secret of at least 24 characters.')
    if not args.studio.startswith('https://') and not args.studio.startswith(('http://127.0.0.1:', 'http://localhost:')):
        raise SystemExit('A remote studio URL must use HTTPS.')
    studio, comfy = args.studio.rstrip('/'), args.comfy.rstrip('/')
    print('Worker ready:', args.worker, flush=True)
    while True:
        try:
            claim = request(studio + '/api/studio/worker/claim', {'worker': args.worker}, {'Authorization': 'Bearer ' + token})
            if claim.get('job'):
                process_job(studio, comfy, token, claim['job'])
            else:
                time.sleep(4)
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                raise SystemExit('Worker authentication or access rejected. Check studio URL and matching worker token.')
            print('Studio temporarily unavailable:', error.code, flush=True)
            time.sleep(10)
        except (OSError, ValueError) as error:
            print('Connection unavailable:', type(error).__name__, flush=True)
            time.sleep(10)


if __name__ == '__main__':
    main()
