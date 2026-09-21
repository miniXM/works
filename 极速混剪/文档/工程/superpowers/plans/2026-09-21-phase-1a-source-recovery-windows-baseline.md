# Phase 1A Source Recovery and Windows Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a version-controlled, deterministic recovery workspace that preserves the current Windows release, reconstructs its Electron ASAR and payload from audited inputs, and produces an evidence-based decision on whether original source recovery or clean-room reconstruction is required next.

**Architecture:** Treat the shipped Windows application as an immutable reference, not as maintainable source. A small Python recovery tool reads and extracts ASAR files, generates cryptographic manifests, and rebuilds the archive byte-for-byte; PowerShell scripts validate the Windows payload and launch an isolated smoke-test copy. The resulting provenance report is the input contract for the next plan, which will either import verified original sources or reconstruct the Electron/Vue and Python projects behind regression tests.

**Tech Stack:** Git, PowerShell 7, Python 3.12 standard library, Electron packaged assets, ASAR format, SHA-256, Pester-style PowerShell assertions without external modules

**Spec:** `docs/superpowers/specs/2026-09-21-windows-macos-client-design.md`

## Global Constraints

- Preserve the released Windows installer at `最新发布/JSVideoMix-Setup-1.0.3.exe`; its SHA-256 is `5042387422DC28711725CE8A916EF1A6B07531976BD1F330B750C04ED7D17B20`.
- Preserve the reference ASAR at `work/rebrand/base/app.asar`; its SHA-256 is `57E9A9E41C9A90F5EB4273F5E5DD947D795B43141E989B1BD941A2E62241F9C5`.
- Preserve the Windows backend at `work/preview-install/videomix/resources/backend/KrLongAI.exe`; its SHA-256 is `CC91ABEBEECC43E9ED2CAEE73E4ED6D09DD56CE02EBEFDBB753AB8EEC4D7A63B`.
- Do not describe extracted or minified bundles as original source code.
- Do not commit installers, payload ZIP files, unpacked Electron runtimes, private keys, activation codes, tickets, logs, or user media.
- Windows x64 remains behavior-compatible throughout Phase 1A; no authorization, update, UI, or processing behavior changes are permitted.
- Future maintained client code must support Windows x64, macOS arm64, and macOS x64 from one shared Electron/Vue codebase.
- The Windows device-ID algorithm and existing bindings must remain compatible in later phases.
- A formal macOS release requires a macOS builder, Developer ID signing, and Apple notarization; no Windows-generated artifact may be labeled a macOS release.

## Review Focus

- A modified or missing reference installer/ASAR/backend must fail provenance validation before any build starts; Task 2 tests all three failures.
- ASAR paths containing Chinese characters or spaces must extract without encoding or traversal errors; Task 3 tests UTF-8 names and unsafe `../` paths.
- An ASAR entry with incorrect integrity metadata must fail validation instead of being silently accepted; Task 3 corrupts one hash and expects rejection.
- Two baseline builds from identical inputs must produce identical ASAR and payload hashes; Task 5 builds twice and compares hashes.
- The isolated smoke test must never overwrite the installed preview or write an activation code/ticket into Git; Task 6 tests path containment and ignored sensitive files.

---

### Task 1: Establish the Recovery Repository and Artifact Boundary

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `docs/recovery/artifact-policy.md`
- Create: `tools/recovery/README.md`

**Interfaces:**
- Consumes: Existing project directory and immutable release artifacts listed in Global Constraints.
- Produces: A Git repository whose tracked boundary excludes binaries and sensitive runtime state; later tasks rely on the documented `reference`, `generated`, and `source` classifications.

- [ ] **Step 1: Initialize Git without moving or deleting existing files**

Run:

```powershell
git init -b main
git status --short
```

Expected: a new repository on `main`; every existing file is initially untracked.

- [ ] **Step 2: Write the artifact-boundary test before adding ignore rules**

Run:

```powershell
$forbidden = @(
  '最新发布/JSVideoMix-Setup-1.0.3.exe',
  'work/rebrand/base/payload.zip',
  'work/preview-install/license-ticket.json',
  'work/preview-install/license-client.log'
)
$tracked = @(git ls-files)
$hits = @($forbidden | Where-Object { $tracked -contains $_ })
if ($hits.Count -ne 0) { throw "Forbidden tracked artifacts: $($hits -join ', ')" }
```

Expected: PASS because the repository has no tracked files yet. Save this exact assertion in `tests/recovery/test-artifact-boundary.ps1` during Step 4.

- [ ] **Step 3: Create ignore rules and ownership documentation**

`.gitignore` must include these exact categories:

```gitignore
# Immutable/vendor binary inputs stay local and are verified by manifest.
*.exe
*.dll
*.pyd
*.zip
*.asar
work/preview-install/
work/rebrand/build/

# Sensitive runtime state.
license-ticket.json
license-server.json
*.log
.env
.env.*
*.pem
*.p12
*.pfx

# Generated recovery output.
artifacts/
recovery-output/
node_modules/
dist/
```

`docs/recovery/artifact-policy.md` must define:

```text
reference = immutable local binary verified by SHA-256 and never edited in place
generated = disposable output reproducible from reference/source inputs
source = human-maintainable text tracked in Git
secret = credential or activation state never committed or printed in CI logs
```

Document the bundled tool paths used on this machine in `tools/recovery/README.md`, but do not hard-code them into build scripts; scripts resolve `python`, `git`, and `pwsh` from parameters or `PATH`.

- [ ] **Step 4: Save and run the artifact-boundary test**

Create `tests/recovery/test-artifact-boundary.ps1` with the assertion from Step 2 plus checks that `.gitignore`, `README.md`, and `docs/recovery/artifact-policy.md` are tracked candidates.

Run:

```powershell
pwsh -NoProfile -File tests/recovery/test-artifact-boundary.ps1
```

Expected: PASS and no secret or binary path reported.

- [ ] **Step 5: Commit the repository boundary**

```powershell
git add .gitignore README.md docs/recovery/artifact-policy.md tools/recovery/README.md tests/recovery/test-artifact-boundary.ps1 docs/superpowers
git diff --staged --check
git commit -m "chore: establish recovery repository boundary"
```

Expected: one commit containing text and documentation only.

### Task 2: Pin and Validate the Immutable Windows Reference Set

**Files:**
- Create: `recovery/reference-manifest.json`
- Create: `tools/recovery/verify_reference.py`
- Create: `tests/recovery/test_verify_reference.py`

**Interfaces:**
- Consumes: `verify_manifest(manifest_path: Path, project_root: Path) -> list[VerificationResult]`, where each result contains `path`, `expected_sha256`, `actual_sha256`, `expected_size`, `actual_size`, and `ok`.
- Produces: A machine-readable reference manifest and a validator CLI used as the first command in every later build.

- [ ] **Step 1: Write failing unit tests for success, missing file, and modified file**

Create `tests/recovery/test_verify_reference.py` using only `unittest` and `tempfile`:

```python
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tools.recovery.verify_reference import verify_manifest


class VerifyReferenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "sample.bin").write_bytes(b"baseline")
        digest = hashlib.sha256(b"baseline").hexdigest()
        self.manifest = self.root / "manifest.json"
        self.manifest.write_text(json.dumps({"files": [{
            "path": "sample.bin", "size": 8, "sha256": digest
        }]}), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_reference_passes(self):
        self.assertTrue(all(r.ok for r in verify_manifest(self.manifest, self.root)))

    def test_missing_reference_fails(self):
        (self.root / "sample.bin").unlink()
        self.assertFalse(verify_manifest(self.manifest, self.root)[0].ok)

    def test_modified_reference_fails(self):
        (self.root / "sample.bin").write_bytes(b"changed!")
        self.assertFalse(verify_manifest(self.manifest, self.root)[0].ok)
```

- [ ] **Step 2: Run tests and verify the module is missing**

Run:

```powershell
python -m unittest tests.recovery.test_verify_reference -v
```

Expected: FAIL with `ModuleNotFoundError: tools.recovery.verify_reference`.

- [ ] **Step 3: Implement the manifest validator and CLI**

Implement:

```python
@dataclass(frozen=True)
class VerificationResult:
    path: str
    expected_sha256: str
    actual_sha256: str | None
    expected_size: int
    actual_size: int | None
    ok: bool


def verify_manifest(manifest_path: Path, project_root: Path) -> list[VerificationResult]:
    """Hash every declared file without modifying it; reject paths outside project_root."""
```

The CLI accepts `--manifest` and `--root`, prints one line per file, and exits `0` only when all files match. Reject absolute manifest paths and any normalized path escaping `project_root`.

Create `recovery/reference-manifest.json` containing the three pinned files and hashes in Global Constraints with these exact sizes:

```json
{
  "files": [
    {"path": "最新发布/JSVideoMix-Setup-1.0.3.exe", "size": 1019898209, "sha256": "5042387422DC28711725CE8A916EF1A6B07531976BD1F330B750C04ED7D17B20"},
    {"path": "work/rebrand/base/app.asar", "size": 74765638, "sha256": "57E9A9E41C9A90F5EB4273F5E5DD947D795B43141E989B1BD941A2E62241F9C5"},
    {"path": "work/preview-install/videomix/resources/backend/KrLongAI.exe", "size": 19750931, "sha256": "CC91ABEBEECC43E9ED2CAEE73E4ED6D09DD56CE02EBEFDBB753AB8EEC4D7A63B"}
  ]
}
```

- [ ] **Step 4: Run unit tests and validate the real references**

Run:

```powershell
python -m unittest tests.recovery.test_verify_reference -v
python tools/recovery/verify_reference.py --manifest recovery/reference-manifest.json --root .
```

Expected: all unit tests PASS; all three real reference files report `OK`.

- [ ] **Step 5: Commit the reference contract**

```powershell
git add recovery/reference-manifest.json tools/recovery/verify_reference.py tests/recovery/test_verify_reference.py
git diff --staged --check
git commit -m "test: pin Windows release reference artifacts"
```

### Task 3: Build a Safe ASAR Reader, Extractor, and Integrity Validator

**Files:**
- Create: `tools/recovery/asar.py`
- Create: `tools/recovery/extract_asar.py`
- Create: `tests/recovery/test_asar.py`

**Interfaces:**
- Consumes: `read_asar(path: Path) -> AsarArchive`.
- Produces: `AsarArchive.entries: tuple[AsarEntry, ...]`, `extract(destination: Path) -> None`, and `verify_integrity() -> list[IntegrityResult]`; Task 4 uses the entries, Task 5 uses the parser and packer contract. `tuple[AsarEntry, ...]` is Python's variadic tuple type annotation, not an omitted implementation step.

- [ ] **Step 1: Write failing tests for round-trip metadata, UTF-8 paths, traversal rejection, and bad hashes**

Use an in-memory fixture helper that writes the Chromium ASAR header format already documented by `work/rebrand/build_asar.py`. Include entries named `dist/index.html` and `dist/中文 空格.txt`.

Required assertions:

```python
self.assertEqual(archive.read("dist/中文 空格.txt"), "内容".encode())
self.assertTrue(all(item.ok for item in archive.verify_integrity()))
with self.assertRaises(ValueError):
    archive.extract_entry("../escape.txt", destination)
self.assertFalse(corrupted_archive.verify_integrity()[0].ok)
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
python -m unittest tests.recovery.test_asar -v
```

Expected: FAIL because `tools.recovery.asar` does not exist.

- [ ] **Step 3: Implement the ASAR model and safe extraction**

Implement these exact public types:

```python
@dataclass(frozen=True)
class AsarEntry:
    path: str
    size: int
    offset: int
    integrity: dict[str, object] | None

@dataclass(frozen=True)
class IntegrityResult:
    path: str
    expected_sha256: str | None
    actual_sha256: str
    ok: bool

class AsarArchive:
    @classmethod
    def open(cls, path: Path) -> "AsarArchive":
        return cls(path)

    def read(self, entry_path: str) -> bytes:
        entry = self.entry_by_path[validate_entry_path(entry_path)]
        return self._read_entry_bytes(entry)

    def verify_integrity(self) -> list[IntegrityResult]:
        return [verify_entry_integrity(entry, self.read(entry.path)) for entry in self.entries]

    def extract(self, destination: Path) -> None:
        destination = destination.resolve()
        for entry in self.entries:
            target = resolve_beneath(destination, entry.path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(self.read(entry.path))
```

The constructor parses the 16-byte prefix and JSON header, builds `entry_by_path`, and retains the content offset and archive stream path. Implement `validate_entry_path`, `_read_entry_bytes`, `verify_entry_integrity`, and `resolve_beneath` as focused helpers. Normalize separators to `/`; reject empty, absolute, drive-qualified, `.` and `..` path components. Verify whole-file and block hashes when integrity metadata is present. Extraction writes only beneath the resolved destination.

- [ ] **Step 4: Implement the CLI and test the real ASAR**

`extract_asar.py` accepts `--input`, `--output`, `--manifest`, and `--verify-only`. The manifest records path, byte size, SHA-256, and whether integrity metadata existed.

Run:

```powershell
python -m unittest tests.recovery.test_asar -v
python tools/recovery/extract_asar.py --input work/rebrand/base/app.asar --output recovery-output/app --manifest recovery-output/asar-manifest.json
```

Expected: tests PASS; extraction reports 9,109 entries; integrity verification has zero failures; `package.json` and `dist-electron/main.js` exist.

- [ ] **Step 5: Commit the ASAR recovery tool**

```powershell
git add tools/recovery/asar.py tools/recovery/extract_asar.py tests/recovery/test_asar.py
git diff --staged --check
git commit -m "feat: add safe ASAR recovery tooling"
```

### Task 4: Generate the Source-Provenance and Platform-Dependency Report

**Files:**
- Create: `tools/recovery/audit_sources.py`
- Create: `tests/recovery/test_audit_sources.py`
- Create: `recovery/source-provenance.json`
- Create: `docs/recovery/source-provenance-report.md`

**Interfaces:**
- Consumes: ASAR manifest from Task 3 and filesystem roots supplied with repeated `--search-root` arguments.
- Produces: `SourceAudit` JSON with `electron_original_source`, `electron_source_maps`, `backend_original_source`, `windows_only_dependencies`, and `decision`; the next implementation plan consumes `decision` exactly as `import-original-source` or `clean-room-reconstruction`.

- [ ] **Step 1: Write failing classification tests**

```python
def test_original_vue_and_python_sources_select_import(self):
    audit = classify({"src/App.vue", "src/main.ts", "backend/main.py"})
    self.assertEqual(audit.decision, "import-original-source")

def test_only_bundles_select_clean_room(self):
    audit = classify({"dist/index.html", "dist-electron/main.js", "KrLongAI.exe"})
    self.assertEqual(audit.decision, "clean-room-reconstruction")

def test_source_maps_are_reported_but_not_called_original_source(self):
    audit = classify({"dist-electron/main.js", "dist-electron/main.js.map"})
    self.assertFalse(audit.electron_original_source)
    self.assertTrue(audit.electron_source_maps)
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
python -m unittest tests.recovery.test_audit_sources -v
```

Expected: FAIL because `audit_sources` is missing.

- [ ] **Step 3: Implement deterministic classification and secret-safe scanning**

Scan filenames and package metadata only; do not copy arbitrary files and do not print file contents. Original Electron source requires at least one Vue source file plus a TypeScript/JavaScript app entry outside `dist`; original backend source requires Python modules that define the processing service, not installed third-party packages under `_internal`.

Classify these Windows-only dependencies explicitly when present:

```json
["*.exe", "*.dll", "*.pyd", "pywin32", "Pythonwin", "Win32_*", "PowerShell device enumeration"]
```

- [ ] **Step 4: Audit all known local locations and generate the report**

Run:

```powershell
python tools/recovery/audit_sources.py `
  --asar-manifest recovery-output/asar-manifest.json `
  --search-root . `
  --search-root E:\GPT-Codex `
  --json recovery/source-provenance.json `
  --markdown docs/recovery/source-provenance-report.md
```

Expected with current evidence: `decision` is `clean-room-reconstruction`; no `.map` files are reported inside the ASAR; the report lists the absent historical path `E:\GPT Codex\2026-09-15\new-chat` as unavailable evidence, not as an error.

- [ ] **Step 5: Commit the provenance decision**

```powershell
git add tools/recovery/audit_sources.py tests/recovery/test_audit_sources.py recovery/source-provenance.json docs/recovery/source-provenance-report.md
git diff --staged --check
git commit -m "docs: record source provenance decision"
```

### Task 5: Prove Deterministic ASAR and Payload Reconstruction

**Files:**
- Create: `tools/recovery/pack_asar.py`
- Create: `tests/recovery/test_asar_roundtrip.py`
- Create: `scripts/build-windows-baseline.ps1`
- Create: `tests/recovery/test-windows-baseline.ps1`
- Modify: `tools/recovery/asar.py`

**Interfaces:**
- Consumes: Verified references from Task 2, extracted entries from Task 3, existing `work/rebrand/build_payload.py`, and optional `-OutputDirectory`.
- Produces: `recovery-output/baseline/app.asar`, `recovery-output/baseline/payload.zip`, and `recovery-output/baseline/build-manifest.json`; later smoke tests consume that manifest.

- [ ] **Step 1: Write failing ASAR byte-for-byte round-trip test**

```python
def test_reference_asar_round_trip_is_byte_identical(self):
    source = Path("work/rebrand/base/app.asar")
    archive = AsarArchive.open(source)
    rebuilt = self.temp_path / "app.asar"
    pack_asar(archive, rebuilt)
    self.assertEqual(source.read_bytes(), rebuilt.read_bytes())
```

Also add a test that packing twice yields the same SHA-256.

- [ ] **Step 2: Run the round-trip test and verify failure**

```powershell
python -m unittest tests.recovery.test_asar_roundtrip -v
```

Expected: FAIL because `pack_asar` is missing.

- [ ] **Step 3: Implement deterministic ASAR packing**

Implement:

```python
def pack_asar(archive: AsarArchive, output: Path) -> None:
    """Preserve entry order, header fields, padding, offsets, and bytes exactly."""
```

Do not normalize timestamps because ASAR entries do not use them. Preserve JSON insertion order and compact separators so an untouched archive round-trips byte-for-byte.

- [ ] **Step 4: Write the Windows baseline build script**

`scripts/build-windows-baseline.ps1` must:

1. Resolve project root relative to `$PSScriptRoot`, never from the old absolute path.
2. Run `verify_reference.py` and stop on mismatch.
3. Rebuild the reference ASAR with `pack_asar.py`.
4. Call `work/rebrand/build_payload.py` to replace only `videomix/resources/app.asar` in `work/rebrand/base/payload.zip`; all other ZIP entries remain byte-for-byte copied by the existing tool.
5. Write a JSON manifest with input/output hashes, sizes, tool versions, UTC build time, and `sourceKind: "recovered-binary-baseline"`.
6. Refuse an output directory inside `work/preview-install` or `最新发布`.

- [ ] **Step 5: Test two builds for deterministic output**

Create `tests/recovery/test-windows-baseline.ps1` to build into two temporary directories and assert:

```powershell
$a = Get-FileHash "$first/app.asar" -Algorithm SHA256
$b = Get-FileHash "$second/app.asar" -Algorithm SHA256
if ($a.Hash -ne $b.Hash) { throw 'ASAR builds differ' }
$pa = Get-FileHash "$first/payload.zip" -Algorithm SHA256
$pb = Get-FileHash "$second/payload.zip" -Algorithm SHA256
if ($pa.Hash -ne $pb.Hash) { throw 'Payload builds differ' }
```

Run:

```powershell
python -m unittest tests.recovery.test_asar_roundtrip -v
pwsh -NoProfile -File tests/recovery/test-windows-baseline.ps1
```

Expected: PASS; rebuilt ASAR equals the reference hash; two payload outputs have identical hashes.

- [ ] **Step 6: Commit deterministic reconstruction**

```powershell
git add tools/recovery/asar.py tools/recovery/pack_asar.py tests/recovery/test_asar_roundtrip.py scripts/build-windows-baseline.ps1 tests/recovery/test-windows-baseline.ps1
git diff --staged --check
git commit -m "build: make Windows baseline reconstruction deterministic"
```

### Task 6: Add an Isolated Windows Smoke-Test Gate and Phase Report

**Files:**
- Create: `scripts/smoke-windows-baseline.ps1`
- Create: `tests/recovery/test-smoke-safety.ps1`
- Create: `docs/recovery/windows-baseline-results.md`
- Create: `docs/superpowers/plans/README.md`

**Interfaces:**
- Consumes: `build-manifest.json` from Task 5 and local preview payload resources.
- Produces: A smoke result with process start, window creation, backend health, and unchanged-reference assertions; a plan index routes the next phase according to `source-provenance.json.decision`.

- [ ] **Step 1: Write the smoke-script safety test first**

The test imports the script functions without starting the application and asserts:

```powershell
Assert-IsSafeSmokeRoot -Candidate "$TestDrive\smoke" -ProjectRoot $projectRoot
try {
  Assert-IsSafeSmokeRoot -Candidate "$projectRoot\work\preview-install" -ProjectRoot $projectRoot
  throw 'Expected preview-install rejection'
} catch {
  if ($_.Exception.Message -notmatch 'protected') { throw }
}
```

Also run `test-artifact-boundary.ps1` after creating dummy `license-ticket.json` and `license-client.log` beneath a temporary smoke directory; `git status --short` must not list them.

- [ ] **Step 2: Run the safety test and verify failure**

```powershell
pwsh -NoProfile -File tests/recovery/test-smoke-safety.ps1
```

Expected: FAIL because `Assert-IsSafeSmokeRoot` is undefined.

- [ ] **Step 3: Implement safe smoke staging and launch**

`scripts/smoke-windows-baseline.ps1` accepts:

```powershell
param(
  [Parameter(Mandatory)] [string] $BuildManifest,
  [string] $SmokeRoot = (Join-Path $env:TEMP 'videomix-baseline-smoke'),
  [int] $StartupTimeoutSeconds = 60,
  [switch] $KeepSmokeRoot
)
```

It must resolve and validate `$SmokeRoot`, copy rather than edit reference files, choose unused local ports, start the Electron client with the backend disabled for the shell smoke, wait for a non-zero main window handle, record process exit and window title, then terminate only processes it started. A second smoke starts the packaged backend, waits for its documented health endpoint, and terminates it. Never terminate processes by product name alone.

- [ ] **Step 4: Run safety tests, reconstruction, and the smoke gate**

Run:

```powershell
pwsh -NoProfile -File tests/recovery/test-smoke-safety.ps1
pwsh -NoProfile -File scripts/build-windows-baseline.ps1 -OutputDirectory recovery-output/baseline
pwsh -NoProfile -File scripts/smoke-windows-baseline.ps1 -BuildManifest recovery-output/baseline/build-manifest.json
python -m unittest discover -s tests/recovery -p 'test_*.py' -v
```

Expected: all tests PASS; Electron creates a visible window; backend health succeeds; all three reference hashes remain unchanged.

- [ ] **Step 5: Record measured results and route the next plan**

`docs/recovery/windows-baseline-results.md` must include commands run, hashes, window result, backend health result, any platform limitations, and the exact provenance decision. `docs/superpowers/plans/README.md` lists the four program tracks and sets the next plan as:

```text
import-original-source -> Phase 1B source import and normalization
clean-room-reconstruction -> Phase 1B Electron/Vue and Python contract reconstruction
```

With current evidence, select `Phase 1B Electron/Vue and Python contract reconstruction`. Do not begin authorization or macOS implementation until Phase 1B produces a maintainable Windows build that passes this baseline.

- [ ] **Step 6: Commit the verified Phase 1A baseline**

```powershell
git add scripts/smoke-windows-baseline.ps1 tests/recovery/test-smoke-safety.ps1 docs/recovery/windows-baseline-results.md docs/superpowers/plans/README.md
git diff --staged --check
git status --short
git commit -m "test: establish Windows recovery baseline"
```

Expected: generated binaries remain ignored; the worktree is clean after the documentation commit.

## Phase 1A Completion Gate

Phase 1A is complete only when all of the following are true:

- The repository boundary test proves no binary release, secret, ticket, or runtime log is tracked.
- All pinned reference hashes match.
- The reference ASAR extracts safely and passes integrity validation.
- The source-provenance decision is recorded with evidence.
- Two independent baseline builds produce identical ASAR and payload hashes.
- The isolated Windows client opens a window and its backend passes health checks.
- The original installer, ASAR, and backend hashes are unchanged after testing.
- The next Phase 1B plan is selected from the recorded provenance decision.

Passing this gate does not mean the application has maintainable source or macOS support. It means the current Windows behavior has been preserved well enough to reconstruct those capabilities without losing the only verified reference.
