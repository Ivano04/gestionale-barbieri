"""Build the committed TEST release locally and upload its image, without server compilation."""
import gzip
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile


def main():
    sha, server, key, archive = sys.argv[1:]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid commit")
    ssh = ["ssh", "-i", key, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", server]
    script = "process.stdout.write(JSON.stringify({url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}))"
    command = "docker exec gestionale-parrucchiere-nextjs-1 node -e " + shlex.quote(script)
    public = json.loads(subprocess.check_output(ssh + [command], text=True))
    if not public.get("url", "").startswith("https://") or not public.get("key"):
        raise ValueError("Hosted public configuration missing")
    arch = subprocess.check_output(ssh + ["uname -m"], text=True).strip()
    if arch != "x86_64":
        raise ValueError("Expected amd64 TEST host")
    image = "gestionale-parrucchiere:" + sha
    build_env = dict(os.environ, NEXT_PUBLIC_SUPABASE_URL=public["url"], NEXT_PUBLIC_SUPABASE_ANON_KEY=public["key"])
    folder = Path(archive).resolve().parent
    with tempfile.TemporaryDirectory(prefix="image-" + sha[:8] + "-", dir=folder) as temporary:
        work = Path(temporary)
        context = work / "context"
        context.mkdir()
        with tarfile.open(archive) as source:
            source.extractall(context, filter="data")
        print("Building the committed release locally for linux/amd64.", flush=True)
        subprocess.run(["docker", "build", "--platform", "linux/amd64", "--build-arg", "NEXT_PUBLIC_SUPABASE_URL", "--build-arg", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "--label", "org.opencontainers.image.revision=" + sha, "-t", image, str(context)], check=True, env=build_env)
        raw = work / "image.tar"
        packed = work / "image.tar.gz"
        subprocess.run(["docker", "save", "-o", str(raw), image], check=True)
        with raw.open("rb") as source, gzip.open(packed, "wb", compresslevel=1) as target:
            shutil.copyfileobj(source, target)
        raw.unlink()
        remote = "/tmp/localvista-image-" + sha + ".tar.gz"
        print("Uploading the prebuilt image; the running application stays in place.", flush=True)
        subprocess.run(["scp", "-i", key, str(packed), server + ":" + remote], check=True)
        subprocess.run(ssh + ["docker load --input " + shlex.quote(remote) + " && rm -f -- " + shlex.quote(remote)], check=True)
        print("Prebuilt image available on the TEST host.", flush=True)


if __name__ == "__main__":
    main()
