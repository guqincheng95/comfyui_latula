# Local protocol fixture. No model, GPU, billing, or real AI output.
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json, time
from email.parser import BytesParser
from email import policy
ROOT=Path(__file__).resolve().parent.parent
GRAPH=json.loads((ROOT/'tests/fixtures/basic-api.json').read_text())
RH_GRAPH={**GRAPH,'90':{'class_type':'LoadImageGoohai','inputs':{'image':'other.png','保留透明通道':False}},'91':{'class_type':'SaveImage','inputs':{'images':['90',0]}}}
RH_JOBS={}
JOBS={}
UPLOADS=[]
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT/'dist'),**kw)
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin','http://127.0.0.1:5173')
        self.send_header('Access-Control-Allow-Headers','Content-Type, Authorization')
        super().end_headers()
    def out(self,value,code=200):
        data=json.dumps(value,ensure_ascii=False).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_OPTIONS(self):self.send_response(204);self.end_headers()
    def do_GET(self):
        p=self.path
        if p=='/mock/system_stats':return self.out({'system':{'os':'protocol-fixture'}})
        if p=='/mock/object_info':
            data={node['class_type']:{'input':{'required':{}}} for node in GRAPH.values()}
            data['KSampler']['input']['required']={'seed':['INT',{'min':0,'max':4294967295}],'steps':['INT',{'min':1,'max':100}],'sampler_name':[['euler','dpmpp_2m']],'scheduler':[['normal','karras']]}
            return self.out(data)
        if p.startswith('/mock/history/'):
            key=p.rsplit('/',1)[1];job=JOBS.get(key)
            if not job:return self.out({})
            if time.time()-job['created']<3:return self.out({})
            return self.out({key:{'status':{'completed':True,'status_str':'success'},'outputs':{'10':{'images':[{'filename':'protocol-check.svg','subfolder':'','type':'output'}]}}}})
        if p=='/mock/queue':return self.out({'queue_running':[[0,key] for key,job in JOBS.items() if time.time()-job['created']<3],'queue_pending':[]})
        if p.startswith('/mock/view?'):
            data=b'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768"><rect width="512" height="768" fill="#17202c"/><rect x="30" y="30" width="452" height="708" fill="#39291d" stroke="#e9b861" stroke-width="4"/><text x="256" y="350" text-anchor="middle" fill="#e9b861" font-size="28">API PROTOCOL TEST</text><text x="256" y="400" text-anchor="middle" fill="#fff" font-size="18">Not an AI-generated image</text></svg>'
            self.send_response(200);self.send_header('Content-Type','image/svg+xml');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
        if p=='/test-fixture.json':
            data=(ROOT/'tests/fixtures/basic-api.json').read_bytes();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(data);return
        if p=='/test-captured':return self.out(JOBS)
        if p=='/test-runninghub':return self.out(RH_JOBS)
        return super().do_GET()
    def do_POST(self):
        if self.headers.get('Transfer-Encoding','').lower()=='chunked':
            chunks=[]
            while True:
                size=int(self.rfile.readline().split(b';',1)[0],16)
                if not size:
                    while self.rfile.readline().strip():pass
                    break
                chunks.append(self.rfile.read(size));self.rfile.read(2)
            body=b''.join(chunks)
        else:body=self.rfile.read(int(self.headers.get('Content-Length',0)))
        if self.path.startswith('/rh/'):
            if self.headers.get('Authorization')!='Bearer fixture-only-not-a-real-api-key':return self.out({'code':401,'message':'Fixture key missing'},401)
            if self.path.endswith('/media/upload/binary'):
                message=BytesParser(policy=policy.default).parsebytes(('Content-Type: '+self.headers.get('Content-Type','')+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+body)
                media=next((p for p in message.iter_parts() if p.get_param('name',header='content-disposition')=='file' and p.get_filename()),None)
                if media is None or not media.get_payload(decode=True):return self.out({'code':400,'message':'Expected file'},400)
                return self.out({'code':0,'data':{'fileName':'openapi/fixture-uploaded.png'}})
            payload=json.loads(body)
            if self.path.endswith('/getJsonApiFormat'):return self.out({'code':0,'data':{'prompt':json.dumps(RH_GRAPH)}})
            if self.path.endswith('/create'):
                key='212182332437963'+str(1000+len(RH_JOBS));graph=json.loads(payload['workflow'])
                if '90' in graph or '91' in graph:return self.out({'code':400,'msg':'Unselected branch submitted'},400)
                if graph['1']['inputs']['image']!='openapi/fixture-uploaded.png':return self.out({'code':400,'msg':'Upload path missing'},400)
                payload.pop('apiKey',None)
                RH_JOBS[key]={'request':payload}
                return self.out({'code':0,'data':{'taskId':key,'taskStatus':'QUEUED'}})
            if self.path.endswith('/query'):
                if payload['taskId'] not in RH_JOBS:return self.out({'status':'FAILED','errorMessage':'Unknown fixture task'})
                return self.out({'status':'SUCCESS','results':[{'url':'http://'+self.headers['Host']+'/mock/view?filename=protocol-check.svg','outputType':'png'}]})
            return self.out({'code':404,'msg':'Unknown fixture route'},404)
        if self.path=='/mock/upload/image':
            message=BytesParser(policy=policy.default).parsebytes(('Content-Type: '+self.headers.get('Content-Type','')+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+body)
            parts=list(message.iter_parts()) if message.is_multipart() else []
            media=next((part for part in parts if part.get_param('name',header='content-disposition')=='image' and part.get_filename()),None)
            if media is None or not media.get_payload(decode=True):return self.out({'detail':'Expected non-empty multipart media upload'},400)
            UPLOADS.append({'filename':media.get_filename(),'size':len(media.get_payload(decode=True))})
            return self.out({'name':'uploaded-reference.png','subfolder':'latula','type':'input'})
        if self.path=='/mock/prompt':
            payload=json.loads(body);key='protocol-'+str(len(JOBS)+1)
            JOBS[key]={'created':time.time(),'request':payload,'uploads':list(UPLOADS)}
            return self.out({'prompt_id':key,'number':0,'node_errors':{}})
        if self.path=='/mock/queue':return self.out({})
        return self.out({'error':'unknown'},404)
ThreadingHTTPServer(('0.0.0.0',5173),Handler).serve_forever()
