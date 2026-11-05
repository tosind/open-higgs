"""Exercise the real worker against isolated studio HTTP routes and a simulated ComfyUI."""
import base64
import http.server
import json
import os
import pathlib
import subprocess
import threading
import time
import urllib.request
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
STUDIO = 'http://127.0.0.1:13163'
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXz8AAAAASUVORK5CYII=')

def request(path, payload=None, method=None):
    req = urllib.request.Request(STUDIO + path, data=json.dumps(payload).encode() if payload is not None else None, headers={'Content-Type':'application/json'}, method=method)
    with urllib.request.urlopen(req,timeout=5) as response:
        return json.load(response)

class Comfy(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_POST(self):
        raw=self.rfile.read(int(self.headers['Content-Length']))
        if self.path=='/upload/image':
            assert PNG in raw
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"name":"worker-upload.png"}');return
        body=json.loads(raw)
        assert body['prompt']['1']['inputs']['text']=='Worker integration test'
        assert body['prompt']['2']['inputs']['image']=='worker-upload.png'
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers()
        self.wfile.write(b'{"prompt_id":"fake-comfy-task"}')
    def do_GET(self):
        self.send_response(200);self.end_headers()
        if self.path.startswith('/history/'):
            self.wfile.write(json.dumps({'fake-comfy-task':{'status':{'completed':True},'outputs':{'7':{'images':[{'filename':'test.png','subfolder':'','type':'output'}]}}}}).encode())
        else:self.wfile.write(PNG)

class WorkerTest(unittest.TestCase):
    def test_claim_render_upload_complete(self):
        env=dict(os.environ,OPENHIGGS_WORKER_TOKEN='isolated-e2e-test-token-24-characters')
        log_dir=ROOT/'work';log_dir.mkdir(exist_ok=True)
        with (log_dir/'worker-e2e-host.log').open('w') as hostlog, (log_dir/'worker-e2e-worker.log').open('w') as workerlog:
            host=subprocess.Popen(['node','--import','tsx','tests/worker-host.ts'],cwd=ROOT,env=env,stdout=hostlog,stderr=subprocess.STDOUT)
            worker=None;comfy=None
            try:
                for _ in range(80):
                    try:request('/api/studio/projects');break
                    except OSError:time.sleep(.1)
                else:self.fail('Isolated studio did not start')
                request('/api/studio/projects/e2e',{'id':'e2e','name':'Isolated test','shots':[]},'PUT')
                asset=request('/api/studio/assets',{'name':'input.png','base64':base64.b64encode(PNG).decode()})
                created=request('/api/studio/jobs',{'projectId':'e2e','shotId':'s','mode':'kaggle','prompt':'Worker integration test','payload':{'workflow':{'1':{'class_type':'CLIPTextEncode','inputs':{'text':'original'}},'2':{'class_type':'LoadImage','inputs':{'image':'original.png'}}},'binding':{'node':'1','field':'text'},'assets':[{'id':asset['id'],'node':'2','field':'image'}]}})
                comfy=http.server.ThreadingHTTPServer(('127.0.0.1',13164),Comfy)
                threading.Thread(target=comfy.serve_forever,daemon=True).start()
                worker=subprocess.Popen(['python','scripts/kaggle_worker.py','--studio',STUDIO,'--comfy','http://127.0.0.1:13164','--worker','test-t4-0'],cwd=ROOT,env=env,stdout=workerlog,stderr=subprocess.STDOUT)
                for _ in range(100):
                    job=next(j for j in request('/api/studio/jobs') if j['id']==created['id'])
                    if job['status'] in ('completed','failed'):break
                    time.sleep(.1)
                self.assertEqual(job['status'],'completed',job.get('error'))
                with urllib.request.urlopen(STUDIO+job['outputs'][0],timeout=5) as response:
                    self.assertEqual(response.read(),PNG)
            finally:
                if worker:worker.terminate();worker.wait(timeout=10)
                host.terminate();host.wait(timeout=10)
                if comfy:comfy.shutdown();comfy.server_close()

if __name__=='__main__':unittest.main()
