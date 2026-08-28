#!/usr/bin/env python3
import base64
import hashlib
import json
import os
import pathlib
import re
import shutil
import tarfile
import tempfile
import urllib.request

REPOSITORY = os.environ["GITHUB_REPOSITORY"]
TOKEN = os.environ["GH_TOKEN"]
BASE_CANDIDATE = os.environ.get("BASE_CANDIDATE", "42ebf19bed3ef2ca01e3e7b9c7965cef671564f3")
FINAL_VERSION = os.environ.get("FINAL_VERSION", "0.5.1")
DESTINATION = pathlib.Path(os.environ.get("DESTINATION", "candidate"))
PRODUCT_CI_TEMPLATE = pathlib.Path(os.environ.get("PRODUCT_CI_TEMPLATE", ".finalize/product-ci.yml"))
TREE_SHAS = [
    "a931c2cff7aa3d1e929ad51ab114716462398513",
    "74f7fed7205cf77bab511bbaab230bda6d6db224",
    "a0193299ce217dc7782536d23c8eab01dcd97924",
    "8fd8fda1123631422d73d921eabe11cecb6f7564",
]
BLOB_SHAS = [
    "98809cf8e4ea262a6e7978c2c43355ae0c4b59d5",
    "90091da2871ea116cf04c6572e38b3d2bc7a43fa",
    "ee947ba18117e0064350840ef95d0d8686fc119e",
    "9a044020a4ce357a850fd2296f19665248359e52",
    "31cf87920a6d8b2e8bfc79a1059ff3dd1243adc3",
    "f7653785433fc11887a85876d284fef39d9b7c73",
    "eb04363c89f68967d3d6e1f82477bd2984da6533",
    "087099cb9bf0a87cfcaeee64d0828e1bac3596cb",
]
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "premiere-ai-harness-finalizer",
}


def request_bytes(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def api_json(path):
    return json.loads(request_bytes(f"https://api.github.com/repos/{REPOSITORY}{path}"))


def safe_extract(archive_bytes, target):
    with tempfile.NamedTemporaryFile(suffix=".tar.gz") as handle:
        handle.write(archive_bytes)
        handle.flush()
        with tarfile.open(handle.name, "r:gz") as archive:
            members = archive.getmembers()
            roots = {pathlib.PurePosixPath(member.name).parts[0] for member in members if member.name}
            if len(roots) != 1:
                raise RuntimeError("candidate archive must contain one root directory")
            root = next(iter(roots))
            for member in members:
                parts = pathlib.PurePosixPath(member.name).parts
                if not parts or parts[0] != root:
                    continue
                relative = pathlib.PurePosixPath(*parts[1:])
                if not relative.parts:
                    continue
                if relative.is_absolute() or ".." in relative.parts or member.issym() or member.islnk():
                    raise RuntimeError(f"unsafe archive member: {member.name}")
                output = target.joinpath(*relative.parts)
                if member.isdir():
                    output.mkdir(parents=True, exist_ok=True)
                elif member.isfile():
                    source = archive.extractfile(member)
                    if source is None:
                        raise RuntimeError(f"cannot read archive member: {member.name}")
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_bytes(source.read())


def blob_bytes(sha):
    payload = api_json(f"/git/blobs/{sha}")
    return base64.b64decode(payload["content"].replace("\n", ""))


def materialize_tree(sha):
    payload = api_json(f"/git/trees/{sha}?recursive=1")
    if payload.get("truncated"):
        raise RuntimeError(f"tree is truncated: {sha}")
    files = {
        entry["path"]: blob_bytes(entry["sha"])
        for entry in payload.get("tree", [])
        if entry.get("type") == "blob"
    }
    if not files:
        raise RuntimeError(f"tree contains no files: {sha}")
    return files


def classify_tree(files):
    names = {pathlib.PurePosixPath(name).name for name in files}
    if {"transcript.js", "host-qualification.js", "premiere-adapter.js"}.issubset(names):
        return pathlib.Path("plugin/lib")
    if any(name.endswith(".test.js") for name in names) or "premiere-fixture.js" in names:
        return pathlib.Path("test")
    if {"build-ccx.mjs", "check.mjs"}.issubset(names):
        return pathlib.Path("scripts")
    if "ARCHITECTURE.md" in names:
        return pathlib.Path("docs")
    if {"manifest.json", "index.js", "index.html"}.issubset(names):
        return pathlib.Path("plugin")
    if any(name.endswith((".yml", ".yaml")) for name in names):
        return pathlib.Path(".github/workflows")
    raise RuntimeError(f"unrecognized reviewed tree {sorted(names)}")


def relative_paths(paths):
    split = [pathlib.PurePosixPath(path).parts for path in paths]
    prefix = []
    for column in zip(*split):
        if len(set(column)) != 1:
            break
        prefix.append(column[0])
    if prefix and prefix[-1] in {"lib", "test", "scripts", "docs", "workflows", "plugin"}:
        prefix.pop()
    return {
        path: pathlib.PurePosixPath(*pathlib.PurePosixPath(path).parts[len(prefix):])
        for path in paths
    }


def decode_text(data):
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeError("reviewed standalone blob is not UTF-8") from error


def classify_blob(data):
    text = decode_text(data)
    stripped = text.lstrip("\ufeff\n\r\t ")
    try:
        value = json.loads(stripped)
    except Exception:
        value = None
    if isinstance(value, dict):
        if value.get("lockfileVersion"):
            return pathlib.Path("package-lock.json")
        if value.get("name") == "premiere-ai-harness" and "scripts" in value:
            return pathlib.Path("package.json")
        if value.get("manifestVersion") or (value.get("id") and value.get("host")):
            return pathlib.Path("plugin/manifest.json")
    if stripped.startswith("name:") and "jobs:" in stripped and "Product CI" in stripped:
        return pathlib.Path(".github/workflows/product-ci.yml")
    markers = [
        ("const PANEL_ID", "plugin/index.js"),
        ("createQualificationFlow", "plugin/lib/qualification-flow.js"),
        ("QUALIFICATION_STORAGE_KEY", "plugin/lib/host-qualification.js"),
        ("parseTranscriptJson", "plugin/lib/transcript.js"),
        ("verifyPersistedRoughCut", "plugin/lib/premiere-adapter.js"),
        ("cleanupGenerated", "plugin/lib/generated-cleanup.js"),
        ("createGeneratedBin", "plugin/lib/generated-assets.js"),
        ("selectedClipContext", "plugin/lib/premiere-runtime.js"),
        ("createEditPlan", "plugin/lib/planner.js"),
        ("createEditorFlow", "plugin/lib/editor-flow.js"),
        ("createSession", "plugin/lib/session-state.js"),
        ("createView", "plugin/lib/ui-view.js"),
        ("normalizeHostEnvironment", "plugin/lib/host-certification.js"),
    ]
    for marker, target in markers:
        if marker in text:
            return pathlib.Path(target)
    if stripped.startswith("<!DOCTYPE html") or stripped.startswith("<html"):
        return pathlib.Path("plugin/index.html")
    if "qualification" in text and "button" in text and "{" in text and "}" in text:
        return pathlib.Path("plugin/styles.css")
    if stripped.startswith("# Premiere AI Harness"):
        return pathlib.Path("README.md")
    if stripped.startswith("# Development status") or stripped.startswith("# Status"):
        return pathlib.Path("STATUS.md")
    if stripped.startswith("# Architecture"):
        return pathlib.Path("docs/ARCHITECTURE.md")
    if "출시 체크리스트" in text:
        return pathlib.Path("docs/RELEASE_CHECKLIST_KO.md")
    if stripped.startswith("#") and "배포" in stripped[:160]:
        return pathlib.Path("docs/DISTRIBUTION_KO.md")
    if stripped.startswith("#") and "제거" in stripped[:160]:
        return pathlib.Path("docs/UNINSTALL_KO.md")
    if "node:test" in text or "require(\"node:test\")" in text:
        digest = hashlib.sha1(data).hexdigest()[:12]
        return pathlib.Path(f"test/reviewed-{digest}.test.js")
    raise RuntimeError(f"unrecognized reviewed blob {stripped[:100]!r}")


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if DESTINATION.exists():
    shutil.rmtree(DESTINATION)
DESTINATION.mkdir(parents=True)
safe_extract(
    request_bytes(f"https://api.github.com/repos/{REPOSITORY}/tarball/{BASE_CANDIDATE}"),
    DESTINATION,
)

classification = {"trees": {}, "blobs": {}}
for sha in TREE_SHAS:
    files = materialize_tree(sha)
    target = classify_tree(files)
    rels = relative_paths(files)
    classification["trees"][sha] = str(target)
    for original, data in files.items():
        output = DESTINATION / target / pathlib.Path(*rels[original].parts)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)

for sha in BLOB_SHAS:
    data = blob_bytes(sha)
    target = classify_blob(data)
    classification["blobs"][sha] = str(target)
    output = DESTINATION / target
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)

for pattern in [".connector-probe*", ".update", "tmp", "reports", "docs/STATUS.md", ".finalize"]:
    for path in DESTINATION.glob(pattern):
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()

workflows = DESTINATION / ".github/workflows"
workflows.mkdir(parents=True, exist_ok=True)
for obsolete in [
    "apply-distribution-update.yml",
    "apply-fixed-core-0.5.0.yml",
    "candidate-audit.yml",
    "finalize-clean-core.yml",
    "source-snapshot.yml",
]:
    (workflows / obsolete).unlink(missing_ok=True)
shutil.copyfile(PRODUCT_CI_TEMPLATE, workflows / "product-ci.yml")

package_path = DESTINATION / "package.json"
package_data = json.loads(package_path.read_text(encoding="utf-8"))
package_data["version"] = FINAL_VERSION
write_json(package_path, package_data)

lock_path = DESTINATION / "package-lock.json"
lock_data = json.loads(lock_path.read_text(encoding="utf-8"))
lock_data["version"] = FINAL_VERSION
if isinstance(lock_data.get("packages", {}).get(""), dict):
    lock_data["packages"][""]["version"] = FINAL_VERSION
write_json(lock_path, lock_data)

manifest_path = DESTINATION / "plugin/manifest.json"
manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest_data["version"] = FINAL_VERSION
write_json(manifest_path, manifest_data)

text_paths = [DESTINATION / "README.md", DESTINATION / "STATUS.md", DESTINATION / "plugin/README.txt"]
text_paths.extend(DESTINATION.glob("docs/*.md"))
for path in text_paths:
    if not path.exists():
        continue
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"Core 0\.[45]\.[01]", f"Core {FINAL_VERSION}", text)
    text = re.sub(r"\b0\.[45]\.[01]\b", FINAL_VERSION, text)
    text = text.replace("저장·종료·재실행", "프로젝트 저장·새 패널 세션")
    path.write_text(text, encoding="utf-8")

check_path = DESTINATION / "scripts/check.mjs"
check_text = check_path.read_text(encoding="utf-8")
marker = '".github/workflows/apply-fixed-core-0.5.0.yml"'
if marker in check_text and '".connector-probe"' not in check_text:
    additions = (
        marker
        + ',\n  ".connector-probe", ".update", "tmp", "reports", "docs/STATUS.md",\n'
        + '  ".github/workflows/candidate-audit.yml", ".github/workflows/finalize-clean-core.yml",\n'
        + '  ".github/workflows/source-snapshot.yml"'
    )
    check_text = check_text.replace(marker, additions)
check_path.write_text(check_text, encoding="utf-8")

print(json.dumps({"version": FINAL_VERSION, **classification}, indent=2))
