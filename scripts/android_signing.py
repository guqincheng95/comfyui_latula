"""Stable Android signing. Private files stay outside the checkout/artifact directory.
bootstrap: one-time new identity, exports only RSA/AES-GCM ciphertext.
restore: loads the single repository Secret, never generates replacement identities.
sign: signs with the fixed release certificate; validates both API ranges.
"""
from pathlib import Path
import argparse, base64, hashlib, json, os, re, secrets, subprocess
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
os.umask(0o077)
ROOT=Path(__file__).resolve().parents[1]
ALIAS='latula-release-v1'
AAD=b'latula-android-signing-v1'
def call(args,env=None):
    result=subprocess.run([str(a) for a in args],env=env,capture_output=True,text=True)
    if result.returncode:
        # Only fixed tool arguments/env names enter the command; no passwords are argv.
        raise RuntimeError('Signing tool failed: '+str(args[0])+'\n'+result.stderr[-2000:])
    return result.stdout

def export_cert(ks,alias,password,out):
    env={**os.environ,'LATULA_TEMP_KS_PASSWORD':password}
    call(['keytool','-exportcert','-keystore',ks,'-alias',alias,'-storepass:env','LATULA_TEMP_KS_PASSWORD','-file',out],env)
    cert=x509.load_der_x509_certificate(out.read_bytes())
    return cert,hashlib.sha256(out.read_bytes()).hexdigest()

def materialize(data,directory):
    directory.mkdir(parents=True,exist_ok=True)
    (directory/'release.p12').write_bytes(base64.b64decode(data['keystoreBase64'],validate=True))
    (directory/'credentials.json').write_text(json.dumps(data))
    _,new=export_cert(directory/'release.p12',data['keyAlias'],data['storePassword'],directory/'release.der')
    assert new==data['certificateSha256'],'Keystore/certificate mismatch'
    return data

def bootstrap(a):
    d=Path(a.directory);d.mkdir(parents=True,exist_ok=True)
    assert not (d/'release.p12').exists(),'Refusing to replace an existing release key'
    password=secrets.token_urlsafe(40)
    env={**os.environ,'LATULA_NEW_KS_PASSWORD':password}
    call(['keytool','-genkeypair','-keystore',d/'release.p12','-storetype','PKCS12','-alias',ALIAS,'-keyalg','RSA','-keysize','4096','-sigalg','SHA256withRSA','-validity','10950','-dname','CN=Latula Android Release, OU=Latula, O=Latula, C=CN','-storepass:env','LATULA_NEW_KS_PASSWORD','-keypass:env','LATULA_NEW_KS_PASSWORD','-noprompt'],env)
    cert,newsha=export_cert(d/'release.p12',ALIAS,password,d/'release.der')
    data={'schema':1,'applicationId':'com.latula.mobile','keyAlias':ALIAS,'storePassword':password,'keystoreBase64':base64.b64encode((d/'release.p12').read_bytes()).decode(),'certificateSha256':newsha}
    materialize(data,d)
    out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
    public=serialization.load_pem_public_key(Path(a.recipient).read_bytes())
    key=secrets.token_bytes(32);nonce=secrets.token_bytes(12)
    envelope={'schema':1,'algorithm':'RSA-OAEP-SHA256+AES-256-GCM','wrappedKey':base64.b64encode(public.encrypt(key,padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))).decode(),'nonce':base64.b64encode(nonce).decode(),'ciphertext':base64.b64encode(AESGCM(key).encrypt(nonce,json.dumps(data).encode(),AAD)).decode()}
    (out/'latula-signing.encrypted.json').write_text(json.dumps(envelope))
    (out/'latula-release-v1.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    info={'schema':1,'alias':ALIAS,'keyAlgorithm':'RSA-4096','certificateSha256':newsha,'validFrom':cert.not_valid_before_utc.isoformat(),'validUntil':cert.not_valid_after_utc.isoformat(),'applicationId':'com.latula.mobile','previousApplicationId':'com.acttwomobile.app','previousCertificateSha256':'da681f29d93cdbaf1c781447e7a7c133122e601cbd9bffadf8bd226a1e4aa5b5','transition':'side-by-side; original 0.01 private key was not persisted'}
    (out/'signing-identity.json').write_text(json.dumps(info,indent=2)+'\n')
    print('Created RSA-4096 signing identity and encrypted backup. Public certificate metadata:')
    print(json.dumps(info))

def restore(a):
    raw=os.environ.get('LATULA_ANDROID_SIGNING','').strip()
    assert raw,'LATULA_ANDROID_SIGNING is not configured; no fallback signing is allowed'
    data=json.loads(raw);assert data['schema']==1 and data['applicationId']=='com.latula.mobile'
    pins=json.loads((ROOT/'.github/signing/identity.json').read_text())
    assert data['certificateSha256']==pins['certificateSha256'] and data['applicationId']==pins['applicationId'],'Signing identity differs from pinned public certificate'
    materialize(data,Path(a.directory))
    print('Fixed signing identity restored and certificate pins verified.')

def sign(a):
    d=Path(a.directory);data=json.loads((d/'credentials.json').read_text())
    out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True)
    env={**os.environ,'LATULA_RELEASE_PASSWORD':data['storePassword']}
    call([a.apksigner,'sign','--ks',d/'release.p12','--ks-key-alias',data['keyAlias'],'--ks-pass','env:LATULA_RELEASE_PASSWORD','--key-pass','env:LATULA_RELEASE_PASSWORD','--v4-signing-enabled','false','--out',out,a.apk],env)
    reports=[]
    for lower,upper,expected in [(24,32,data['certificateSha256']),(33,36,data['certificateSha256'])]:
        report=call([a.apksigner,'verify','--verbose','--print-certs','--min-sdk-version',str(lower),'--max-sdk-version',str(upper),out])
        assert expected in report.lower(),'Expected signing identity absent from verification'
        reports.append(f'API {lower}-{upper}\n'+report)
    (out.parent/'SIGNATURES.txt').write_text('\n'.join(reports))
    (out.parent/'SHA256SUMS.txt').write_text(hashlib.sha256(out.read_bytes()).hexdigest()+'  '+str(out)+'\n')
    print('Signed APK verified across Android API 24-36 with the fixed release certificate.')

p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True)
b=sub.add_parser('bootstrap');b.add_argument('--recipient',required=True);b.add_argument('--output',required=True);b.add_argument('--apksigner',required=True);b.add_argument('--directory',required=True)
r=sub.add_parser('restore');r.add_argument('--directory',required=True)
s=sub.add_parser('sign');s.add_argument('--directory',required=True);s.add_argument('--apk',required=True);s.add_argument('--output',required=True);s.add_argument('--apksigner',required=True)
a=p.parse_args();{'bootstrap':bootstrap,'restore':restore,'sign':sign}[a.command](a)
