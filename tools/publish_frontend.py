"""Publish the named Pages frontend while retaining the existing Bracket API/database.

The git credential helper supplies credentials in memory. No token is written to files.
"""

import json
import hashlib
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECKOUT = ROOT / ".local" / "pages-checkout"
REPOSITORY = "nadavo11/streetball4biber"


def run(*args):
    return subprocess.check_output(args, cwd=CHECKOUT, text=True).strip()


def main():
    origin = (ROOT / ".local" / "active-url.txt").read_text().strip()
    if not origin.startswith("https://"):
        raise ValueError("A public HTTPS backend is required")
    CHECKOUT.mkdir(parents=True, exist_ok=True)
    if not (CHECKOUT / ".git").exists():
        run("git", "init", "-b", "main")
        run("git", "remote", "add", "origin", f"https://github.com/{REPOSITORY}.git")
    run("git", "remote", "set-url", "origin", f"https://github.com/{REPOSITORY}.git")
    for name in ("style.css", "app.js", "diagram.js", "court.js"):
        (CHECKOUT / name).write_bytes(
            (ROOT / "backend" / "live-ui" / name).read_bytes()
        )
    html = (ROOT / "backend" / "live-ui" / "index.html").read_text(encoding="utf-8")
    html = html.replace("/live-assets/", "./").replace('href="/"', 'href="./"')
    for name in ("style.css", "app.js", "diagram.js", "court.js"):
        digest = hashlib.sha256((CHECKOUT / name).read_bytes()).hexdigest()[:12]
        html = html.replace("./" + name, "./" + name + "?v=" + digest)
    html = html.replace(
        "./site-config.js",
        "./site-config.js?v=" + hashlib.sha256(origin.encode()).hexdigest()[:12],
    )
    (CHECKOUT / "index.html").write_text(html, encoding="utf-8")
    (CHECKOUT / "site-config.js").write_text(
        "window.BIBER_API_ORIGIN = " + json.dumps(origin) + ";\n"
    )
    (CHECKOUT / ".nojekyll").write_text("")
    (CHECKOUT / "LICENSE").write_bytes((ROOT / "LICENSE").read_bytes())
    (CHECKOUT / "README.md").write_text(
        "# Streetball4Biber\n\nLive tournament frontend powered by Bracket.\n\n"
        "Corresponding full source, backend, tests and upstream attribution: "
        "https://github.com/nadavo11/tournament-manager\n\n"
        "AGPL-3.0. Original Bracket by Erik Vroon and contributors.\n\n"
        "This frontend uses the shared PostgreSQL-backed API hosted on the tournament computer. "
        "The host and HTTPS tunnel must stay online. Refresh the backend address by running "
        "`tools/publish_frontend.py` from the main source checkout after renewing its tunnel.\n"
    )
    run(
        "git",
        "add",
        "index.html",
        "style.css",
        "app.js",
        "diagram.js",
        "court.js",
        "site-config.js",
        ".nojekyll",
        "LICENSE",
        "README.md",
    )
    if run("git", "diff", "--cached", "--name-only"):
        run("git", "commit", "-m", "Publish Streetball4Biber tournament dashboard")
        run("git", "push", "-u", "origin", "main")
    credential = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True,
        text=True,
        check=True,
        cwd=ROOT,
    )
    fields = dict(
        line.split("=", 1) for line in credential.stdout.splitlines() if "=" in line
    )
    headers = {
        "Authorization": "Bearer " + fields["password"],
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "biber-streetball-publisher",
    }
    endpoint = f"https://api.github.com/repos/{REPOSITORY}/pages"
    try:
        with urllib.request.urlopen(
            urllib.request.Request(endpoint, headers=headers)
        ) as response:
            pages = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        request = urllib.request.Request(
            endpoint,
            headers=headers,
            method="POST",
            data=json.dumps({"source": {"branch": "main", "path": "/"}}).encode(),
        )
        with urllib.request.urlopen(request) as response:
            pages = json.load(response)
    print("Named frontend:", pages["html_url"])
    print("Backend:", origin)


if __name__ == "__main__":
    main()
