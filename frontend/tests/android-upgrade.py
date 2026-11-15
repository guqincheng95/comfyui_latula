"""Original test app coexists; permanent package retains data across 302 -> 303."""
from pathlib import Path
import os, runpy, subprocess, time
root=Path(__file__).resolve().parents[2]
OLD='com.acttwomobile.app';APP='com.latula.mobile'
def adb(*args,**kw):return subprocess.check_output(['adb',*args],**kw)
def uid(app):return adb('shell','cmd','package','list','packages','-U',app,text=True).strip()
def records(state):
 return state['js']("(async()=>{const d=await new Promise((res,rej)=>{const r=indexedDB.open('latula-v1',1);r.onsuccess=()=>res(r.result);r.onerror=rej});return await new Promise((res,rej)=>{const r=d.transaction('tasks').objectStore('tasks').getAll();r.onsuccess=()=>res(r.result.map(x=>({favorite:x.favorite,remoteId:x.remoteId,status:x.status})));r.onerror=rej})})()")
os.environ['ANDROID_APP_ID']=OLD
os.environ['ANDROID_APK_PATH']=str(root/'output/latula-v0.01-test.apk')
old=runpy.run_path(str(root/'frontend/tests/android-smoke.py'))
old_uid=uid(OLD)
adb('shell','am','force-stop',OLD)
os.environ['ANDROID_APP_ID']=APP
os.environ['ANDROID_APK_PATH']=str(root/'output/latula-v0.01.1-test.apk')
state=runpy.run_path(str(root/'frontend/tests/android-smoke.py'))
new_uid=uid(APP)
assert new_uid and new_uid!=old_uid and uid(OLD)==old_uid,'Original app was replaced'
# Verify original records remain accessible after the permanent package is installed.
adb('forward','--remove','tcp:9222')
adb('shell','am','start','-W','-n',OLD+'/.MainActivity')
old['attach']();old['wait_text']('Android 安装验证')
original_records=records(old)
assert len(original_records)==1 and original_records[0]['favorite'] is True
old['attach'].__globals__['ws'].close()
adb('shell','am','force-stop',OLD)
# Install a genuinely higher versionCode with the SAME new certificate.
subprocess.check_call(['adb','install','-r',str(root/'output/latula-v0.01.1-upgrade-check.apk')])
assert uid(APP)==new_uid,'Permanent app UID changed during update'
adb('shell','am','force-stop',APP)
adb('forward','--remove','tcp:9222')
adb('shell','am','start','-W','-n',APP+'/.MainActivity')
try:
 state['attach']();state['wait_text']('Android 安装验证')
 assert state['js']("document.body.innerText.includes('v0.01.1')"),'Wrong UI version after update'
 state['click']('历史任务');state['wait_text']('已收藏')
 data=records(state)
 assert len(data)==1 and data[0]['favorite'] is True and data[0]['status']=='SUCCEEDED',data
 package=adb('shell','dumpsys','package',APP,text=True)
 assert 'versionCode=303' in package and 'versionName=0.01.1' in package
 logs=adb('logcat','-d','-s','AndroidRuntime:E',text=True)
 assert 'FATAL EXCEPTION' not in logs,logs
 time.sleep(1);state['screenshot']('06-fixed-certificate-install-over-update')
 (root/'output/android-checks/upgrade-summary.txt').write_text('PASS: original 0.01 remains installed with its original UID/history/favorite; permanent package com.latula.mobile installed separately; versionCode 302 -> 303 signed with the same release key updated via adb install -r and retained config, history, favorite and UID. Android 15 API 35. No uninstall or data clear. Original 0.01 is not cryptographically upgrade-compatible with the new certificate.\n')
 print('PASS: original app preserved; permanent certificate package upgrades retain data.')
finally:
 current=state['attach'].__globals__.get('ws')
 if current:current.close()
