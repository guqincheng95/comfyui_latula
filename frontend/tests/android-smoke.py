"""Install the built APK and exercise its own debug WebView on an isolated emulator.
No personal browser, GPU model or paid API is used. UI checks complement, not replace,
a real phone's picker/share/video tests.
"""
import json
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
APP = 'com.acttwomobile.app'
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
    adb('install', '-r', str(ROOT / 'output/latula-v0.01-test.apk'))
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
    logs = adb('logcat', '-d', '-s', 'AndroidRuntime:E', text=True)
    (OUT / 'android-runtime.log').write_text(logs)
    assert 'FATAL EXCEPTION' not in logs, logs
    (OUT / 'summary.txt').write_text('PASS: Android 15 API 35 emulator: APK installed/launched; settings + native back; API import/schema assembly; native HTTP multipart upload and one submit; mock result; favorite; cold restart preferences/history; no AndroidRuntime fatal exception. Not a physical-phone or GPU generation test.\n')
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
