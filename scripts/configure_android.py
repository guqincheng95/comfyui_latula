"""Apply the maintained app identity/theme/version to a generated Capacitor project."""
from pathlib import Path
import json, re, shutil
root=Path(__file__).resolve().parents[1]
f=root/'frontend'
v=json.loads((f/'version.json').read_text())
assert "appId: 'com.latula.mobile'" in (f/'capacitor.config.ts').read_text(),'Permanent applicationId must not change'
assert isinstance(v['code'],int) and v['code']>301
assert re.search(r"DISPLAY_VERSION = '"+re.escape(v['name'])+"'",(f/'src/lib/workflow.js').read_text()),'UI and Android version differ'
p=f/'android/app/src/main/AndroidManifest.xml';s=p.read_text()
if 'android:usesCleartextTraffic=' not in s:s=s.replace('<application','<application android:usesCleartextTraffic="true"',1)
s=s.replace('@mipmap/ic_launcher_round','@drawable/latula_launcher').replace('@mipmap/ic_launcher','@drawable/latula_launcher');p.write_text(s)
shutil.copyfile(f/'native/latula_launcher.xml',f/'android/app/src/main/res/drawable/latula_launcher.xml')
shutil.copyfile(f/'native/latula_styles.xml',f/'android/app/src/main/res/values/styles.xml')
p=f/'android/app/build.gradle';s=p.read_text();s=re.sub(r'versionCode\s+\d+',f"versionCode {v['code']}",s,count=1);s=re.sub(r'versionName\s+"[^"]+"',f"versionName \"{v['name']}\"",s,count=1);p.write_text(s)
print('Configured 拉图',v['name'],'versionCode',v['code'])
