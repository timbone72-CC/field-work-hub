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
assert ("versionCode='43'" if recovery else "versionCode='42'") in badging
build_config=next(Path('app/build/generated').rglob('BuildConfig.java')).read_text()
assert ('FIELD_SYNC_ENABLED = false' if recovery else 'FIELD_SYNC_ENABLED = true') in build_config
assert 'AUTOMATIC_CLEANUP_ENABLED = false' in build_config, 'Photo cleanup cannot silently activate in a source-only build'
assert ('CLEANUP_READINESS_POLLING_ENABLED = false' if recovery else 'CLEANUP_READINESS_POLLING_ENABLED = true') in build_config, 'v42 TEST polling must be enabled and v43 recovery disabled'
room_source=Path('app/src/main/java/com/inandout/fieldphotoprep/team/internal/TeamDatabase.java').read_text()
room_version=6
assert 'version = 6,' in room_source, 'Unexpected TeamDatabase schema; review the release gate'
room_schema_blobs={}
for version in range(1,room_version+1):
    schema=Path('app/schemas/com.inandout.fieldphotoprep.team.internal.TeamDatabase')/f'{version}.json'
    assert json.loads(schema.read_text())['database']['version']==version
    room_schema_blobs[str(version)]=subprocess.check_output(['git','hash-object',str(schema)],text=True).strip()
permissions=subprocess.check_output([str(build_tools/'aapt'),'dump','permissions',str(apk)],text=True)
assert 'android.permission.CAMERA' in permissions
assert 'android.permission.REQUEST_INSTALL_PACKAGES' in permissions
assert (Path('app/src/main/res/xml/internal_update_paths.xml')).is_file()
out=Path('phase5-artifacts')/variant;out.mkdir(parents=True,exist_ok=True)
filename=f'Field-Work-Hub-0.5-Phase5-{variant}-{head[:7]}.apk'
shutil.copyfile(apk,out/filename)
identity={'runtime_head':head,'variant':variant,'file':filename,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),
          'package':'com.inandout.fieldphotoprep.team.internal','signer_sha256':signer,'version_code':43 if recovery else 42,
          'room_version':room_version,'room_schema_blobs':room_schema_blobs,'field_sync_enabled':not recovery,'private_photo_network_enabled':not recovery,'cleanup_readiness_polling_enabled':not recovery,'automatic_cleanup_enabled':False}
(out/'identity.json').write_text(json.dumps(identity,indent=2)+'\n')
if not recovery:
    release_dir=Path('phase5-artifacts/internal-release')
    release_dir.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(apk,release_dir/'Field-Work-Hub-Internal.apk')
    (release_dir/'internal-release-metadata.json').write_text(json.dumps({
        'source_commit': head,
        'package': identity['package'],
        'version_code': identity['version_code'],
        'signer_sha256': identity['signer_sha256'],
        'sha256': identity['sha256'],
        'room_version': identity['room_version'],
        'room_schema_blobs': identity['room_schema_blobs'],
        'field_sync_enabled': identity['field_sync_enabled'],
        'cleanup_readiness_polling_enabled': identity['cleanup_readiness_polling_enabled'],
        'automatic_cleanup_enabled': identity['automatic_cleanup_enabled'],
        'note': 'CI artifact only. Publish publicly only after governed release approval.'
    },indent=2)+'\n')
print(json.dumps(identity,indent=2))
