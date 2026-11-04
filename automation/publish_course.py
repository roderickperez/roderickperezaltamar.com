"""Publish a validated browser course build using a restricted Supabase account.

Credentials are read from environment variables and are never printed. This script
only accepts the student browser output, not a course repository or instructor files.
"""
import argparse
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

COURSES = {"python-renewable", "eage-python-course", "fault-segmentation", "energy-decision-ai"}
ROOT_FILES = {
    "index.html", "app.js", "styles.css", "python-worker.js", "eagelogo.jpg",
    "flag-es.svg", "flag-uk.svg", "explorer-python.js", "explorers.css",
    "explorers.html", "explorers.js", "decision-lab.css", "decision-lab.html",
    "decision-lab.js", "guide.html",
}
FORBIDDEN = re.compile(r"(^|/)(instructor_private|private|\.git|__pycache__)(/|$)|test_answer_key|final_project_solution|projectsolution|\.bak$", re.I)
URL = "https://axmsjmuhmsjqgnoinsza.supabase.co"
PUBLIC_KEY = "sb_publishable_Bqtvb7g2QlWCi-ZZqnPK7w_CrPu0bxR"


def build_inventory(root):
    root = root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("The course build must be a directory.")
    entries = {}
    for file in root.rglob("*"):
        if file.is_symlink():
            raise ValueError("Symlinks are not permitted in a published build.")
        if not file.is_file():
            continue
        relative = file.relative_to(root).as_posix()
        if FORBIDDEN.search(relative):
            continue
        if relative not in ROOT_FILES and not relative.startswith(("generated/", "vendor/")):
            continue
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        entries[relative] = (file, digest)
    if "index.html" not in entries or "generated/course.json" not in entries:
        raise ValueError("Build must contain index.html and generated/course.json.")
    return entries


def request(method, path, *, token=None, data=None, content_type=None, upsert=False):
    headers = {"apikey": PUBLIC_KEY}
    if token:
        headers["Authorization"] = "Bearer " + token
    if content_type:
        headers["Content-Type"] = content_type
    if upsert:
        headers["x-upsert"] = "true"
    req = urllib.request.Request(URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError("Publishing request failed with HTTP " + str(exc.code)) from None
    except urllib.error.URLError:
        raise RuntimeError("Could not contact course storage.") from None


def object_path(course, file):
    return "/storage/v1/object/private-courses/" + urllib.parse.quote(course + "/" + file, safe="/")


def publish(course, root, email, password):
    if course not in COURSES:
        raise ValueError("Unknown course.")
    inventory = build_inventory(root)
    auth = json.loads(request("POST", "/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": password}).encode(),
        content_type="application/json"))
    token = auth.get("access_token")
    if not token:
        raise RuntimeError("Publisher authentication failed.")
    # Immutable content-addressed objects are uploaded before the manifest.
    # One small manifest replacement then switches readers to the new release.
    manifest = {}
    for index, (name, (file, digest)) in enumerate(sorted(inventory.items()), 1):
        manifest[name] = digest
        encoded = object_path(course, "objects/" + digest)
        data = file.read_bytes()
        request("POST", encoded, token=token, data=data,
                content_type=mimetypes.guess_type(name)[0] or "application/octet-stream",
                upsert=True)
        print("Uploaded", index, "of", len(inventory), flush=True)
    payload = json.dumps({"version": 1, "files": manifest}, separators=(",", ":")).encode()
    request("POST", object_path(course, "current.json"), token=token, data=payload,
            content_type="application/json", upsert=True)
    print("Published", course, "with", len(inventory), "files.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--course", required=True, choices=sorted(COURSES))
    parser.add_argument("--root", required=True, type=Path)
    args = parser.parse_args()
    email = os.environ.get("COURSE_PUBLISHER_EMAIL", "")
    password = os.environ.get("COURSE_PUBLISHER_PASSWORD", "")
    if not email or not password:
        sys.exit("Set the publisher credentials as GitHub Actions secrets.")
    try:
        publish(args.course, args.root, email, password)
    except (ValueError, RuntimeError) as exc:
        sys.exit(str(exc))


if __name__ == "__main__":
    main()
