"""Install the built APK and exercise its own debug WebView on an isolated emulator.
No personal browser, GPU model or paid API is used. UI checks complement, not replace,
a real phone's picker/share/video tests.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
import websocket

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/android-checks'
OUT.mkdir(parents=True, exist_ok=True)
APP = os.environ.get('ANDROID_APP_ID', 'com.latula.mobile')
seq = 0
ws = None
server = subprocess.Popen([sys.executable, str(ROOT / 'frontend/tests/protocol-server.py')], stdout=(OUT / 'fixture.log').open('w'), stderr=subprocess.STDOUT)

def adb(*args, **kwargs):
    return subprocess.check_output(['adb', *args], **kwargs)

def screenshot(name):
    time.sleep(0.5)  # Allow WebView compositing to catch up with DOM assertions.
    (OUT / (name + '.png')).write_bytes(adb('exec-out', 'screencap', '-p'))

def attach():
    global ws
    for _ in range(40):
        sockets = adb('shell', 'cat', '/proc/net/unix', text=True)
        pid = adb('shell', 'pidof', APP, text=True).strip().split()[0]
        match = re.search(r'@(webview_devtools_remote_' + re.escape(pid) + r')\b', sockets)
        if match:
            adb('forward', 'tcp:9222', 'localabstract:' + match[1])
            try:
                pages = json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/list', timeout=2))
                target = next((p for p in pages if p.get('type') == 'page' and p.get('webSocketDebuggerUrl')), None)
                if target:
                    ws = websocket.create_connection(target['webSocketDebuggerUrl'], timeout=40, suppress_origin=True)
                    return
            except Exception:
                pass
        time.sleep(1)
    raise AssertionError('APK debug WebView did not become available')

def js(expression):
    global seq
    seq += 1
    ws.send(json.dumps({'id': seq, 'method': 'Runtime.evaluate', 'params': {'expression': expression, 'awaitPromise': True, 'returnByValue': True}}))
    while True:
        response = json.loads(ws.recv())
        if response.get('id') != seq:
            continue
        assert 'error' not in response, response
        result = response['result']
        assert 'exceptionDetails' not in result, result
        return result.get('result', {}).get('value')

def wait_text(text):
    # A new Android WebView exposes DevTools before its document/body exists.
    # Poll across initial document/context changes instead of failing startup early.
    for _ in range(180):
        try:
            if js("Boolean(document.body?.innerText?.includes(" + json.dumps(text) + "))"):
                print('UI ready:', text, flush=True)
                return
        except (AssertionError, websocket.WebSocketException):
            pass
        time.sleep(0.25)
    raise AssertionError('UI timeout: ' + text + '; page=' + str(js('document.body?.innerText')))

def click(text):
    js("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===" + json.dumps(text) + "||b.textContent.trim()===" + json.dumps(text) + ");if(!b)throw Error('Missing button');b.click()})()")

def field(label, value):
    js("(()=>{const label=[...document.querySelectorAll('label')].find(x=>x.textContent.trim()===" + json.dumps(label) + ");if(!label)throw Error('Missing label');const input=document.getElementById(label.htmlFor);input.value=" + json.dumps(value) + ";input.dispatchEvent(new Event('input',{bubbles:true}))})()")

try:
    adb('install', '-r', os.environ.get('ANDROID_APK_PATH',str(ROOT / 'output/latula-v0.01-test.apk')))
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-W', '-n', APP + '/.MainActivity')
    attach()
    wait_text('装配工作流')
    screenshot('01-home-installed')
    click('设置')
    wait_text('旅途设置')
    screenshot('02-settings-native')
    # Exercise Android's native back listener, not a simulated DOM navigation.
    adb('shell', 'input', 'keyevent', '4')
    wait_text('装配工作流')
    click('进入工作流')
    wait_text('导入 ComfyUI 工作流')
    click('导入 ComfyUI 工作流')
    wait_text('ComfyUI 服务地址')
    field('ComfyUI 服务地址', 'http://10.0.2.2:5173/mock')
    graph = json.loads((ROOT / 'frontend/tests/fixtures/basic-api.json').read_text())
    js("(()=>{const input=document.querySelector('input[aria-label=\"导入 API 工作流文件\"]');const d=new DataTransfer();d.items.add(new File([JSON.stringify(" + json.dumps(graph, ensure_ascii=False) + ")],'native-test.json',{type:'application/json'}));input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()")
    wait_text('素材输入')
    click('测试连接 · 完善自动装配')
    wait_text('节点字段已更新')
    field('工作流名称', 'Android 安装验证')
    click('保存并装配')
    wait_text('进入工作流')
    click('进入工作流')
    wait_text('参考图片')
    field('正向提示词CLIPTextEncode', 'Android 原生网络协议验证')
    js("(()=>{const input=document.querySelector('input[type=file][aria-label=\"参考图片\"]');const d=new DataTransfer();d.items.add(new File(['<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\"><rect width=\"64\" height=\"64\" fill=\"gold\"/></svg>'],'native-reference.svg',{type:'image/svg+xml'}));input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()")
    screenshot('03-workbench-installed')
    click('提交工作流')
    wait_text('已完成')
    click('查看任务')
    wait_text('使用相同参数')
    screenshot('04-result-native')
    jobs = json.load(urllib.request.urlopen('http://127.0.0.1:5173/test-captured'))
    assert len(jobs) == 1, jobs
    job = next(iter(jobs.values()))
    assert job['uploads'][0]['size'] > 0, job
    assert job['request']['prompt']['2']['inputs']['text'] == 'Android 原生网络协议验证', job
    assert job['request']['prompt']['1']['inputs']['image'] == 'latula/uploaded-reference.png', job
    click('收藏任务')
    time.sleep(0.5)  # Let the IndexedDB transaction commit before killing the process.
    # Cold process restart tests native Preferences + WebView history persistence.
    ws.close()
    ws = None
    adb('forward', '--remove', 'tcp:9222')
    adb('shell', 'am', 'force-stop', APP)
    adb('shell', 'am', 'start', '-W', '-n', APP + '/.MainActivity')
    attach()
    wait_text('Android 安装验证')
    click('历史任务')
    wait_text('已收藏')
    screenshot('05-history-after-restart')
    click('返回主页')
    click('装配工作流')
    click('接入 RunningHub 工作流')
    wait_text('工作流链接或 ID')
    # The test alone redirects the fixed official origin to the local fixture.
    # Production has no origin override and this does not call any paid service.
    js("""(()=>{
      const rewrite=url=>typeof url==='string'&&url.startsWith('https://www.runninghub.cn/')?'http://10.0.2.2:5173/rh'+new URL(url).pathname:url;
      // Capacitor's constructor re-patches XHR prototypes for every instance.
      // Redirect at its native HTTP bridge so fetch AND multipart use real native transport locally.
      const cap=window.Capacitor,native=cap.nativePromise.bind(cap);window.__fixtureNativeUrls=[];
      cap.nativePromise=(plugin,method,options,...args)=>{
        if(plugin==='CapacitorHttp'&&method==='request'){
          options={...options,url:rewrite(options.url)};
          if(options.url.startsWith('https://www.runninghub.cn/'))throw Error('Fixture isolation failed');
          window.__fixtureNativeUrls.push(options.url);
        }
        return native(plugin,method,options,...args);
      };
    })()""")
    field('工作流链接或 ID','https://www.runninghub.cn/workflow/2121823324379631618?source=workspace')
    field('RunningHub API Key','fixture-only-not-a-real-api-key')
    click('验证密钥 · 读取云端工作流')
    wait_text('本次执行的输出分支')
    assert js("document.getElementById('runninghub-output').value") == ''
    js("(()=>{const select=document.getElementById('runninghub-output');select.value='10';select.dispatchEvent(new Event('change',{bubbles:true}))})()")
    field('分支显示名称','图像编辑')
    field('工作流名称','RunningHub 安装验证')
    screenshot('06-runninghub-assembly')
    click('保存并装配')
    wait_text('进入工作流')
    click('进入工作流')
    wait_text('提交工作流')
    field('正向提示词CLIPTextEncode','RunningHub Android 单分支验证')
    js("(()=>{const input=document.querySelector('input[type=file][aria-label=\"参考图片\"]');const d=new DataTransfer();const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));d.items.add(new File([bytes],'reference.png',{type:'image/png'}));input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()")
    click('提交工作流')
    wait_text('已完成')
    click('查看任务')
    wait_text('使用相同参数')
    screenshot('07-runninghub-result')
    rh_jobs=json.load(urllib.request.urlopen('http://127.0.0.1:5173/test-runninghub'))
    assert len(rh_jobs)==1,rh_jobs
    request=next(iter(rh_jobs.values()))['request'];rh_graph=json.loads(request['workflow'])
    assert '91' not in rh_graph and rh_graph['1']['inputs']['image']=='openapi/fixture-uploaded.png'
    assert rh_graph['2']['inputs']['text']=='RunningHub Android 单分支验证'
    assert js("window.__fixtureNativeUrls.some(url=>url.includes('/rh/openapi/v2/media/upload/binary'))") is True
    # Keystore ciphertext is checked on disk, and decryption must survive process death.
    encrypted=adb('shell','run-as',APP,'cat','shared_prefs/latula-credentials.xml',text=True)
    assert 'fixture-only-not-a-real-api-key' not in encrypted and 'name="value"' in encrypted
    ws.close();ws=None
    adb('forward','--remove','tcp:9222')
    adb('shell','am','force-stop',APP)
    adb('shell','am','start','-W','-n',APP+'/.MainActivity')
    attach();wait_text('RunningHub 安装验证');click('进入工作流');wait_text('提交工作流')
    assert js("document.getElementById('workbench-key').value==='fixture-only-not-a-real-api-key'") is True
    assert len(json.load(urllib.request.urlopen('http://127.0.0.1:5173/test-runninghub')))==1,'Restart must not resubmit'
    screenshot('08-runninghub-key-restored')
    logs = adb('logcat', '-d', '-s', 'AndroidRuntime:E', text=True)
    (OUT / 'android-runtime.log').write_text(logs)
    assert 'FATAL EXCEPTION' not in logs, logs
    (OUT / 'summary.txt').write_text('PASS: Android 15 API 35 emulator: install/launch/settings/native back; ComfyUI import/schema/native HTTP upload/submit/result/favorite/restart. RunningHub local fixture: pasted link, JSON read, mandatory branch, upload, one submit, V2 results; Android Keystore ciphertext and cold-restart decryption; no automatic resubmit or AndroidRuntime fatal exception. No real platform API, GPU generation, physical phone picker or paid API used.\n')
    print((OUT / 'summary.txt').read_text())
except Exception:
    screenshot('failure')
    (OUT / 'logcat.txt').write_bytes(adb('logcat', '-d'))
    if ws:
        try:
            (OUT / 'page.txt').write_text(js('document.body.innerText') or '')
        except Exception:
            pass
    raise
finally:
    if ws:
        ws.close()
    server.terminate()
    server.wait(timeout=10)
