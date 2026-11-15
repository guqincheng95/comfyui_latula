"""Real install-over test from the distributed 0.01 certificate to fixed lineage."""
from pathlib import Path
import json, os, runpy, subprocess, time
root=Path(__file__).resolve().parents[2]
os.environ['ANDROID_APK_PATH']=str(root/'output/latula-v0.01-test.apk')
# Populate settings, uploaded workflow, completed history and favorite using the original app.
state=runpy.run_path(str(root/'frontend/tests/android-smoke.py'))
adb=state['adb']
uid_before=adb('shell','cmd','package','list','packages','-U','com.acttwomobile.app',text=True).strip()
subprocess.check_call(['adb','install','-r',str(root/'output/latula-v0.01.1-test.apk')])
uid_after=adb('shell','cmd','package','list','packages','-U','com.acttwomobile.app',text=True).strip()
assert uid_before==uid_after,'Application UID changed during update'
adb('shell','am','force-stop','com.acttwomobile.app')
adb('forward','--remove','tcp:9222')
adb('shell','am','start','-W','-n','com.acttwomobile.app/.MainActivity')
try:
 state['attach']()
 state['wait_text']('Android 安装验证')
 assert state['js']("document.body.innerText.includes('v0.01.1')"),'Wrong UI version after update'
 state['click']('历史任务');state['wait_text']('已收藏')
 records=state['js']("(async()=>{const d=await new Promise((res,rej)=>{const r=indexedDB.open('latula-v1',1);r.onsuccess=()=>res(r.result);r.onerror=rej});return await new Promise((res,rej)=>{const r=d.transaction('tasks').objectStore('tasks').getAll();r.onsuccess=()=>res(r.result.map(x=>({favorite:x.favorite,remoteId:x.remoteId,status:x.status})));r.onerror=rej})})()")
 assert len(records)==1 and records[0]['favorite'] is True and records[0]['status']=='SUCCEEDED',records
 package=adb('shell','dumpsys','package','com.acttwomobile.app',text=True)
 assert 'versionCode=302' in package and 'versionName=0.01.1' in package
 logs=adb('logcat','-d','-s','AndroidRuntime:E',text=True)
 assert 'FATAL EXCEPTION' not in logs,logs
 time.sleep(1)
 state['screenshot']('06-after-install-over-update')
 (root/'output/android-checks/upgrade-summary.txt').write_text('PASS: installed published 0.01, created workflow/history/favorite, adb install -r signed 0.01.1 with proof-of-rotation, kept application UID and persisted settings/history/favorite. Android 15 API 35. No uninstall, data reset or crash.\n')
 print('PASS: fixed certificate migration preserves installed app data and favorite history.')
finally:
 current=state['attach'].__globals__.get('ws')
 if current:current.close()
