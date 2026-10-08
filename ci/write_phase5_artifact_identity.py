"""Capture the immutable CI head and verified internal artifact identity."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

variant=sys.argv[1]
recovery=variant=='recovery'
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
apk=Path('app/build/outputs/apk/debug/app-debug.apk')
build_tools=sorted((Path(os.environ['ANDROID_HOME'])/'build-tools').iterdir(),key=lambda p:tuple(int(x) for x in re.findall(r'\d+',p.name))) [-1]
badging=subprocess.check_output([str(build_tools/'aapt'),'dump','badging',str(apk)],text=True)
cert=subprocess.check_output([str(build_tools/'apksigner'),'verify','--print-certs',str(apk)],text=True)
signer=re.search(r'certificate SHA-256 digest:\s*([0-9a-fA-F]+)',cert).group(1).lower()
expected='1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe'
assert signer==expected
assert "name='com.inandout.fieldphotoprep.team.internal'" in badging
assert ("versionCode='21'" if recovery else "versionCode='20'") in badging
build_config=next(Path('app/build/generated').rglob('BuildConfig.java')).read_text()
assert ('FIELD_SYNC_ENABLED = false' if recovery else 'FIELD_SYNC_ENABLED = true') in build_config
assert (Path('app/schemas/com.inandout.fieldphotoprep.team.internal.TeamDatabase/4.json')).is_file()
permissions=subprocess.check_output([str(build_tools/'aapt'),'dump','permissions',str(apk)],text=True)
assert 'android.permission.CAMERA' in permissions
out=Path('phase5-artifacts')/variant;out.mkdir(parents=True,exist_ok=True)
filename=f'Field-Work-Hub-0.5-Phase5-{variant}-{head[:7]}.apk'
shutil.copyfile(apk,out/filename)
identity={'runtime_head':head,'variant':variant,'file':filename,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),
          'package':'com.inandout.fieldphotoprep.team.internal','signer_sha256':signer,'version_code':21 if recovery else 20,
          'room_version':4,'field_sync_enabled':not recovery,'private_photo_network_enabled':not recovery,'automatic_cleanup_enabled':False}
(out/'identity.json').write_text(json.dumps(identity,indent=2)+'\n')
print(json.dumps(identity,indent=2))
