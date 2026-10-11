"""Deploy a committed TEST release. Secrets are read from private files only."""
import json, os, re, shutil, subprocess, sys, tarfile, time
from pathlib import Path
from urllib.parse import urlparse, unquote
from urllib.request import urlopen

def run(args, **kwargs):
    subprocess.run(args, check=True, **kwargs)

def read_env(file):
    result = {}
    for line in file.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#') or '=' not in line: continue
        key, value = line.split('=', 1)
        value = value.strip()
        if value[:1] == value[-1:] and value[:1] in ('"', "'"):
            if value[:1] == '"':
                try: value = json.loads(value)
                except ValueError: value = value[1:-1]
            else: value = value[1:-1]
        result[key.strip()] = value
    return result

def main():
    sha = sys.argv[1]
    if not re.fullmatch('[0-9a-f]{40}', sha): raise ValueError('Invalid commit')
    release = Path('/opt/localvista-releases') / sha
    backup = Path('/opt/localvista-backups') / (sha + '-' + time.strftime('%Y%m%d%H%M%S'))
    release.mkdir(parents=True, exist_ok=True)
    backup.mkdir(parents=True, mode=0o700)
    with tarfile.open('/tmp/localvista-' + sha + '.tar.gz') as archive:
        archive.extractall(release, filter='data')
    settings_path = Path('/tmp/localvista-fiscal-settings.json')
    settings = json.loads(settings_path.read_text())
    current = Path('/opt/localvista-releases/current')
    source = current / '.env.production' if current.exists() else Path('/opt/gestionale-parrucchiere/.env.production')
    env = read_env(source)
    if env.get('PAYMENT_PROVIDER') != 'nexi' or env.get('NEXI_ENV') != 'test': raise ValueError('Server is not Nexi TEST')
    additions = settings['env']
    allowed = {'FISKALY_ENV','FISKALY_API_KEY','FISKALY_API_SECRET','FISKALY_SYSTEM_ID','FISKALY_TEST_ENABLED','FISKALY_TEST_REFUNDS_ENABLED','FISKALY_TEST_VAT_PERCENT','FISKALY_TEST_EMAIL_ENABLED','FISKALY_TEST_EMAIL_TO','RESEND_API_KEY','RESEND_FROM'}
    if set(additions) - allowed or additions.get('FISKALY_ENV') != 'test': raise ValueError('Invalid fiscal settings')
    if additions.get('FISKALY_TEST_REFUNDS_ENABLED') != 'false': raise ValueError('Verify sandbox payment before enabling refunds')
    for value in additions.values():
        if not isinstance(value,str) or any(c in value for c in ('\n','\r','$')): raise ValueError('Unsupported environment value')
    shutil.copy2(source, backup / '.env.production.before')
    old_image = subprocess.check_output(['docker','inspect','--format','{{.Image}}','gestionale-parrucchiere-nextjs-1'],text=True).strip()
    rollback = {'services': {'nextjs': {'image': old_image,'environment': {'NODE_ENV':'production','PORT':'3002','HOSTNAME':'0.0.0.0','FISKALY_TEST_ENABLED':'false'},'env_file':[str(backup / '.env.production.before')],'network_mode':'host','restart':'unless-stopped'}}}
    (backup / 'rollback-compose.json').write_text(json.dumps(rollback))
    (backup / 'metadata.json').write_text(json.dumps({'commit':sha,'previous_image':old_image,'previous_release':str(source.parent)}))
    env.update(additions)
    env.pop('NEXI_TEST_NOTIFY_URL', None)
    env['NEXT_PUBLIC_APP_URL'] = 'https://gestionale-parrucchiere.localvista.it'
    env['DEPLOY_COMMIT'] = sha
    environment_file = release / '.env.production'
    environment_file.write_text(''.join(k+'='+json.dumps(v)+'\n' for k,v in env.items()))
    environment_file.chmod(0o600)
    fiscal_file = release / 'fiscal-settings.json'
    fiscal_file.write_text(json.dumps(settings)); fiscal_file.chmod(0o600)
    db = urlparse(env['DATABASE_URL'])
    pg = dict(os.environ, PGHOST=db.hostname, PGPORT=str(db.port or 5432), PGDATABASE=unquote(db.path.lstrip('/')), PGUSER=unquote(db.username), PGPASSWORD=unquote(db.password), PGSSLMODE='require')
    print('Backing up application tables and storage metadata.',flush=True)
    run(['docker','run','--rm','--network','host','-e','PGHOST','-e','PGPORT','-e','PGDATABASE','-e','PGUSER','-e','PGPASSWORD','-e','PGSSLMODE','-v',str(backup)+':/backup','postgres:17-alpine','pg_dump','-Fc','-n','public','-n','storage','-f','/backup/before.dump'],env=pg)
    if not (backup / 'before.dump').stat().st_size: raise ValueError('Empty database backup')
    (backup / 'before.dump').chmod(0o600)
    compose = ['docker','compose','--env-file',str(environment_file),'-p','gestionale-parrucchiere','-f',str(release/'docker-compose.yml')]
    print('Building committed release while previous app stays available.',flush=True)
    run(compose + ['build','nextjs'])
    # The old container supplies the existing database credentials and pg module.
    run(['docker','cp',str(release/'scripts/deploy-test-db.cjs'),'gestionale-parrucchiere-nextjs-1:/app/.deploy-test-db.cjs'])
    migration_stage = '/app/.localvista-migrations'
    run(['docker','exec','--user','0','gestionale-parrucchiere-nextjs-1','mkdir','-p',migration_stage])
    run(['docker','cp',str(release/'supabase'),'gestionale-parrucchiere-nextjs-1:'+migration_stage+'/supabase'])
    run(['docker','cp',str(fiscal_file),'gestionale-parrucchiere-nextjs-1:'+migration_stage+'/fiscal-settings.json'])
    print('Applying fiscal migrations atomically.',flush=True)
    run(['docker','exec','--user','0','gestionale-parrucchiere-nextjs-1','node','/app/.deploy-test-db.cjs',migration_stage])
    fiscal_file.unlink(); settings_path.unlink()
    print('Switching to the tested release.',flush=True)
    try:
        run(compose + ['up','-d','--no-build','nextjs'])
        for attempt in range(30):
            try:
                with urlopen('http://127.0.0.1:3002/login',timeout=5) as response:
                    if response.status == 200: break
            except Exception: pass
            time.sleep(2)
        else: raise ValueError('Application health check failed')
    except Exception:
        print('Restoring previous application image; additive database migrations retained.',flush=True)
        run(['docker','compose','-p','gestionale-parrucchiere','-f',str(backup/'rollback-compose.json'),'up','-d','--no-build','nextjs'])
        raise
    temporary = current.with_name('current.next')
    if temporary.is_symlink(): temporary.unlink()
    temporary.symlink_to(release, target_is_directory=True)
    temporary.replace(current)
    print('Release active: '+sha,flush=True)
    print('Backup: '+str(backup),flush=True)

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('Deployment stopped: '+type(error).__name__,file=sys.stderr)
        sys.exit(1)
