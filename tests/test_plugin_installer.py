"""Exercise installation side effects using local executable stand-ins."""

import errno
import hashlib
import io
import json
import os
from pathlib import Path
import pty
import runpy
import select
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "plugins" / "codex-hud" / "skills" / "codex-hud-install"
INSTALLER = SKILL / "scripts" / "install.py"
VERSION = json.loads((SKILL / "assets" / "package.json").read_text())["version"]
HEADER = f"#!{sys.executable}\n"
HUD = HEADER + """
import json, os, sys
from pathlib import Path
if sys.argv[1:] == ['--version']:
    print(os.environ['HUD_FIXTURE_VERSION'])
elif sys.argv[1:2] == ['doctor']:
    if sys.argv[1:] != ['doctor', '--json']:
        print('Unsupported doctor arguments', file=sys.stderr)
        sys.exit(2)
    state_file = Path(sys.argv[0]).parent.parent / 'install-state.json'
    saved = json.loads(state_file.read_text()) if state_file.exists() else None
    failure = os.environ.get('HUD_FIXTURE_FINAL_DOCTOR') if (
        saved and saved['version'] == os.environ['HUD_FIXTURE_VERSION']) else None
    if failure == 'exit':
        print('final fixture probe exited', file=sys.stderr)
        sys.exit(37)
    if failure == 'json':
        print('invalid final doctor JSON')
        sys.exit(0)
    if failure == 'shape':
        print(json.dumps({'codex': 'codex-cli 0.153.4', 'inline': None}))
        sys.exit(0)
    pty_failure = os.environ.get('HUD_FIXTURE_PTY')
    available = pty_failure not in ('fail', 'helper-unavailable') and failure != 'pty'
    probe = {'status': 'ok' if available else (
        'helper-unavailable' if pty_failure == 'helper-unavailable' else 'spawn-failed'),
        'timeoutMs': 2000}
    if available:
        probe.update(exitCode=0, signal=0)
    inline = {'available': available, 'probe': probe}
    probe_mode = {'load-only': 'missing', 'probe-timeout': 'timeout',
                  'probe-shape': 'shape'}.get(failure) or os.environ.get('HUD_FIXTURE_PROBE')
    if probe_mode == 'missing':
        inline.pop('probe')
    elif probe_mode == 'null':
        inline['probe'] = None
    elif probe_mode == 'shape':
        inline['probe'] = 'ok'
    elif probe_mode:
        inline['probe'] = {'status': probe_mode}
    print(json.dumps({'node': 'v20.20.1',
                      'codex': None if os.environ.get('HUD_FIXTURE_CODEX') == 'missing'
                                      or failure == 'codex' else 'codex-cli 0.153.4',
                      'inline': inline,
                      'hud': {
                          'managed': saved is not None, 'stateFile': str(state_file),
                          'scope': saved['scope'] if saved else None,
                          'project': saved['project'] if saved else None,
                          'language': saved['language'] if saved else None,
                          'startupFiles': saved['startupFiles'] if saved else None,
                          'autostart': {'configured': saved['autostart'] if saved else None,
                                        'active': None},
                      },
                      'sessionsDirectory': False, 'matchingSession': None}))
else:
    print(json.dumps({'program': 'hud', 'args': sys.argv[1:], 'cwd': os.getcwd(),
                      'executable': sys.argv[0]}))
    sys.exit(int(os.environ.get('HUD_FIXTURE_EXIT', '0')))
"""
CODEX = HEADER + """
import json, os, sys
print(json.dumps({'program': 'codex', 'args': sys.argv[1:], 'cwd': os.getcwd()}))
sys.exit(int(os.environ.get('HUD_FIXTURE_EXIT', '0')))
"""
NPM = HEADER + """
import json, os, sys
from pathlib import Path
with open(os.environ['HUD_FIXTURE_LOG'], 'a') as file:
    file.write(json.dumps(sys.argv[1:]) + '\\n')
if os.environ.get('HUD_FIXTURE_NPM_FAIL'):
    sys.exit(29)
prefix = Path(sys.argv[sys.argv.index('--prefix') + 1])
executable = prefix / 'bin' / 'codex-hud'
executable.parent.mkdir(parents=True, exist_ok=True)
source = os.environ['HUD_FIXTURE_EXECUTABLE'].replace(
    "os.environ['HUD_FIXTURE_VERSION']", repr(os.environ['HUD_FIXTURE_VERSION']))
executable.write_text(source)
executable.chmod(0o755)
"""


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="hud-installer-test-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.bin = self.directory / "fixtures"
        self.bin.mkdir()
        for name, source in {
            "node": HEADER + "import os; print(os.environ.get('HUD_FIXTURE_NODE', 'v20.20.1'))\n",
            "codex": CODEX, "npm": NPM,
        }.items():
            path = self.bin / name
            path.write_text(source)
            path.chmod(0o755)
        self.prefix = self.directory / "hud ' quoted $directory"
        self.rc = self.directory / "shell.rc"
        self.original = b"# Keep this configuration\nexport KEEP_HUD_TEST='unchanged'\n"
        self.rc.write_bytes(self.original)
        self.rc.chmod(0o640)
        self.log = self.directory / "npm-calls.jsonl"
        self.env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.defpath,
            "HUD_FIXTURE_LOG": str(self.log), "HUD_FIXTURE_VERSION": VERSION,
            "HUD_FIXTURE_EXECUTABLE": HUD,
        }
        self.env.pop("BASH_ENV", None)
        self.project = self.directory / "project ' quoted $ [name]"
        self.project.mkdir()
        self.home = self.directory / "home"
        self.home.mkdir()
        self.env.update({
            "HOME": str(self.home), "XDG_DATA_HOME": str(self.home / ".local" / "share"),
            "SHELL": "/bin/bash",
        })
        self.env.pop("ZDOTDIR", None)

    def selected(self, *args, env=None, prefix=None, script=INSTALLER):
        """Invoke only the target selector, without install configuration flags."""
        return subprocess.run(
            [sys.executable, str(script), "--prefix", str(prefix or self.prefix), *args],
            env=self.env if env is None else env, cwd="/tmp",
            capture_output=True, text=True, timeout=10,
        )

    def report(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def snapshot(self):
        """Capture bytes, modes, mtimes and links so a rewrite is observable."""
        result = {}
        for path in self.directory.rglob("*"):
            if path.is_symlink():
                result[str(path)] = ("link", os.readlink(path), path.lstat().st_mtime_ns)
            elif path.is_file():
                result[str(path)] = (
                    path.read_bytes(), stat.S_IMODE(path.stat().st_mode), path.stat().st_mtime_ns,
                )
            else:
                result[str(path)] = ("directory", stat.S_IMODE(path.stat().st_mode))
        return result

    def seed_runtime(self, version, *, prefix=None, state=True, scope="user",
                     project=None, language="en", autostart=True, shell="zsh",
                     startup=None, recoverable_root=True):
        """Model a previously installed executable and independently saved settings."""
        prefix = prefix or self.prefix
        executable = prefix / "bin" / "codex-hud"
        executable.parent.mkdir(parents=True, exist_ok=True)
        executable.write_text(HUD.replace("os.environ['HUD_FIXTURE_VERSION']", repr(version)))
        executable.chmod(0o755)
        source = f"# Managed by codex-hud-install.\n# scope: {scope}\n# language: {language}\n"
        if autostart:
            source += "\n# codex-hud autostart enabled\n"
            if scope == "project" and recoverable_root:
                source += "_CODEX_HUD_PROJECT_ROOT=" + shlex.quote(str(project)) + "\n"
        (prefix / "shell.sh").write_text(source)
        startup = ([self.rc] if scope == "user" else []) if startup is None else startup
        for path in startup:
            quoted = shlex.quote(str(prefix / "shell.sh"))
            path.write_text(
                "# Keep existing startup configuration\n"
                "# >>> codex-hud installer >>>\n"
                f"if [ -r {quoted} ]; then\n    . {quoted}\nfi\n"
                "# <<< codex-hud installer <<<\n"
            )
        if state:
            (prefix / "install-state.json").write_text(json.dumps({
                "schemaVersion": 1, "owner": "codex-hud-install", "version": "0.5.0",
                "scope": scope, "project": str(project) if project is not None else None,
                "prefix": str(prefix), "command": str(executable),
                "shellFile": str(prefix / "shell.sh"),
                "startupFiles": [str(path) for path in startup],
                "shell": shell, "language": language, "autostart": autostart,
            }))
        return prefix

    def versioned_bundle(self, version):
        """Create a small, valid local bundle to exercise prerelease comparisons."""
        skill = self.directory / ("bundle-" + version)
        (skill / "scripts").mkdir(parents=True)
        (skill / "assets").mkdir()
        script = skill / "scripts" / "install.py"
        shutil.copyfile(INSTALLER, script)
        shutil.copyfile(SKILL / "assets" / "codex-hud.sh", skill / "assets" / "codex-hud.sh")
        archive = skill / "assets" / "fixture.tgz"
        payload = json.dumps({"name": "my-codex-hud", "version": version}).encode()
        with tarfile.open(archive, "w:gz") as package:
            member = tarfile.TarInfo("package/package.json")
            member.size = len(payload)
            package.addfile(member, io.BytesIO(payload))
        (skill / "assets" / "package.json").write_text(json.dumps({
            "version": version, "file": archive.name,
            "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        }))
        return script

    def invoke(self, *args, env=None, script=INSTALLER, rc=None):
        return subprocess.run(
            [sys.executable, str(script), "--prefix", str(self.prefix),
             "--shell", "bash", "--rc-file", str(rc or self.rc), *args],
            env=self.env if env is None else env, cwd="/tmp",
            capture_output=True, text=True, timeout=10,
        )

    def installed(self, *args):
        result = self.invoke(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def invoke_project(self, *args, project=None):
        return subprocess.run(
            [sys.executable, str(INSTALLER), "--scope", "project",
             "--project-dir", str(project or self.project), "--shell", "bash", *args],
            env=self.env, cwd="/tmp", capture_output=True, text=True, timeout=10,
        )

    def installed_project(self, *args):
        result = self.invoke_project(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def terminal(self, args, *, raw=False, prefix_script="", exit_code=0, tty=True,
                 shell_file=None, cwd="/tmp", shell_name="bash"):
        script = self.directory / "invocation.sh"
        script.write_text(
            prefix_script + '\n. "$1"\nshift\n'
            + ('command codex' if raw else 'codex') + ' "$@"\n'
        )
        executable = [shutil.which("zsh"), "-f"] if shell_name == "zsh" else [
            "/bin/bash", "--noprofile", "--norc",
        ]
        command = [*executable, str(script), str(shell_file or self.prefix / "shell.sh"), *args]
        env = {**self.env, "HUD_FIXTURE_EXIT": str(exit_code)}
        if not tty:
            result = subprocess.run(command, env=env, cwd=cwd,
                                    capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, exit_code, result.stderr)
            return json.loads(result.stdout)
        master, slave = pty.openpty()
        child = subprocess.Popen(command, env=env, cwd=cwd,
                                 stdin=slave, stdout=slave, stderr=slave)
        os.close(slave)
        output = b""
        deadline = time.monotonic() + 5
        try:
            while time.monotonic() < deadline:
                ready, _, _ = select.select([master], [], [], 0.1)
                if not ready:
                    if child.poll() is not None:
                        break
                    continue
                try:
                    chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                output += chunk
            self.assertEqual(child.wait(timeout=1), exit_code, output.decode())
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()
            os.close(master)
        return json.loads(output.decode().strip())

    def test_dry_run_has_no_installation_or_shell_writes(self):
        report = self.installed("--dry-run", "--autostart")
        self.assertEqual(report["action"], "dry-run")
        self.assertTrue(report["autostart"])
        self.assertFalse(self.prefix.exists())
        self.assertFalse(self.log.exists())
        self.assertEqual(self.rc.read_bytes(), self.original)

    def test_status_missing_runtime_needs_no_prerequisites_and_writes_nothing(self):
        before = self.snapshot()
        report = self.report(self.selected("--status", env={**self.env, "PATH": "/missing"}))
        self.assertEqual(report["action"], "status")
        self.assertEqual(report["stage"], "inspection")
        self.assertEqual(report["prefix"], str(self.prefix))
        self.assertEqual(report["scope"], "user")
        self.assertIsNone(report["project"])
        self.assertIsNone(report["installedVersion"])
        self.assertEqual(report["bundledVersion"], VERSION)
        self.assertEqual(report["versionComparison"], "missing")
        self.assertIsNone(report["language"])
        self.assertIsNone(report["autostart"])
        self.assertEqual(report["pluginRegistration"], "not-checked")
        self.assertEqual(self.snapshot(), before)

    def test_status_reports_actual_version_and_shell_settings_without_writes(self):
        self.seed_runtime("90.0.0")
        state = self.prefix / "install-state.json"
        metadata = json.loads(state.read_text())
        metadata.update(language="ko", autostart=False)
        state.write_text(json.dumps(metadata))
        before = self.snapshot()
        report = self.report(self.selected("--status", env={**self.env, "PATH": "/missing"}))
        self.assertEqual(report["installedVersion"], "90.0.0")
        self.assertEqual(report["versionComparison"], "downgrade")
        self.assertEqual(report["language"], "en")
        self.assertTrue(report["autostart"])
        self.assertEqual(report["shell"], "zsh")
        self.assertEqual(report["startupFiles"], [str(self.rc)])
        self.assertEqual(self.snapshot(), before)

    def test_status_does_not_require_a_real_pty_probe(self):
        self.seed_runtime("0.5.0")
        before = self.snapshot()
        report = self.report(self.selected("--status", env={
            **self.env, "PATH": "/missing", "HUD_FIXTURE_PROBE": "missing",
            "HUD_FIXTURE_PTY": "helper-unavailable",
        }))
        self.assertEqual(report["installedVersion"], "0.5.0")
        self.assertEqual(report["versionComparison"], "upgrade")
        self.assertEqual(self.snapshot(), before)

    def test_newer_runtime_blocks_normal_install_and_dry_run_before_npm(self):
        for args in ((), ("--dry-run",), ("--update",), ("--update", "--dry-run")):
            with self.subTest(args=args):
                self.seed_runtime("90.0.0")
                before = self.snapshot()
                result = self.selected(*args)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn("newer", result.stderr.lower())
                self.assertIn("--allow-downgrade", result.stderr)
                self.assertEqual(self.snapshot(), before)

    def test_semver_status_orders_numeric_prerelease_and_build_components(self):
        cases = [
            ("1.10.0", "1.9.0", "downgrade"),
            ("1.0.0", "1.0.0-rc.9", "downgrade"),
            ("1.0.0-rc.2", "1.0.0-rc.10", "upgrade"),
            ("1.0.0-1", "1.0.0-alpha", "upgrade"),
            ("1.0.0-alpha", "1.0.0-alpha.1", "upgrade"),
            ("1.0.0-beta", "1.0.0-alpha.99", "downgrade"),
            ("1.0.0+installed.1", "1.0.0+bundled.2", "same"),
            ("1.0.0-rc.1+installed", "1.0.0-rc.1+bundled", "same"),
        ]
        for installed, bundled, comparison in cases:
            with self.subTest(installed=installed, bundled=bundled):
                self.seed_runtime(installed)
                script = self.versioned_bundle(bundled)
                before = self.snapshot()
                report = self.report(self.selected("--status", script=script))
                self.assertEqual(report["versionComparison"], comparison)
                result = self.selected("--update", "--dry-run", script=script)
                if comparison == "downgrade":
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("--allow-downgrade", result.stderr)
                    result = self.selected("--update", "--dry-run", "--allow-downgrade", script=script)
                update = self.report(result)
                self.assertEqual(update["action"], "unchanged" if comparison == "same" else "dry-run")
                self.assertEqual(update["installedVersion"], installed)
                self.assertEqual(update["versionComparison"], comparison)
                self.assertEqual(self.snapshot(), before)

    def test_unknown_runtime_versions_block_even_with_allow_downgrade(self):
        for version in ("not a version", "01.2.3", "1.0.0-01", "1.0", ""):
            with self.subTest(version=version):
                self.seed_runtime(version)
                before = self.snapshot()
                for flags in ((), ("--allow-downgrade",), ("--update", "--allow-downgrade"),
                              ("--update", "--dry-run")):
                    result = self.selected(*flags)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("version", result.stderr.lower())
                self.assertEqual(self.snapshot(), before)
                report = self.report(self.selected("--status"))
                self.assertEqual(report["versionComparison"], "unknown")

    def test_unreadable_runtime_is_unknown_and_never_treated_as_missing(self):
        self.seed_runtime("0.5.0")
        executable = self.prefix / "bin" / "codex-hud"
        executable.chmod(0o644)
        before = self.snapshot()
        report = self.report(self.selected("--status"))
        self.assertEqual(report["versionComparison"], "unknown")
        self.assertNotEqual(self.invoke().returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_uninspectable_runtime_path_is_reported_unknown_without_writes(self):
        self.prefix.mkdir()
        (self.prefix / "bin").write_text("Unrelated file obstructing the runtime path.")
        before = self.snapshot()
        report = self.report(self.selected("--status"))
        self.assertEqual(report["versionComparison"], "unknown")
        self.assertTrue(report["versionError"])
        self.assertNotEqual(self.invoke().returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_broken_runtime_symlink_is_unknown_and_not_a_new_install(self):
        self.prefix.mkdir()
        (self.prefix / "bin").mkdir()
        (self.prefix / "bin" / "codex-hud").symlink_to(self.directory / "missing-runtime")
        before = self.snapshot()
        report = self.report(self.selected("--status"))
        self.assertEqual(report["versionComparison"], "unknown")
        self.assertNotEqual(self.invoke("--allow-downgrade").returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_explicit_downgrade_updates_runtime_and_saves_verified_state(self):
        self.seed_runtime("90.0.0")
        report = self.installed("--allow-downgrade")
        self.assertEqual(report["installedVersion"], VERSION)
        self.assertEqual(report["versionComparison"], "same")
        self.assertEqual(report["previousVersion"], "90.0.0")
        self.assertEqual(report["previousVersionComparison"], "downgrade")
        self.assertEqual(report["verifiedVersion"], VERSION)
        self.assertEqual(report["stage"], "complete")
        actual = subprocess.run(
            [str(self.prefix / "bin" / "codex-hud"), "--version"],
            env={**self.env, "HUD_FIXTURE_VERSION": "99.0.0"},
            capture_output=True, text=True, check=True,
        )
        self.assertEqual(actual.stdout.strip(), VERSION)
        state = json.loads((self.prefix / "install-state.json").read_text())
        self.assertEqual(state["version"], VERSION)

    def test_new_install_persists_complete_private_state(self):
        report = self.installed("--autostart", "--language", "en")
        self.assertEqual(report["installedVersion"], VERSION)
        self.assertEqual(report["versionComparison"], "same")
        self.assertIsNone(report["previousVersion"])
        self.assertEqual(report["previousVersionComparison"], "missing")
        self.assertEqual(report["verifiedVersion"], VERSION)
        state_file = self.prefix / "install-state.json"
        self.assertTrue(state_file.is_file(), "Successful installs must save managed update state.")
        self.assertEqual(stat.S_IMODE(state_file.stat().st_mode), 0o600)
        self.assertEqual(json.loads(state_file.read_text()), {
            "schemaVersion": 1, "owner": "codex-hud-install", "version": VERSION,
            "scope": "user", "project": None, "prefix": str(self.prefix),
            "command": str(self.prefix / "bin" / "codex-hud"),
            "shellFile": str(self.prefix / "shell.sh"), "startupFiles": [str(self.rc)],
            "shell": "bash", "language": "en", "autostart": True,
        })

    def test_successful_install_doctor_reads_published_configuration(self):
        report = self.installed("--autostart", "--language", "en")
        self.assertEqual(report["doctor"]["inline"]["probe"]["status"], "ok")
        hud = report["doctor"]["hud"]
        self.assertTrue(hud["managed"], "The returned doctor must see the newly published install state.")
        self.assertEqual(hud["scope"], "user")
        self.assertEqual(hud["language"], "en")
        self.assertEqual(hud["startupFiles"], [str(self.rc)])
        self.assertEqual(hud["stateFile"], str(self.prefix / "install-state.json"))
        self.assertEqual(hud["autostart"], {"configured": True, "active": None})

    def test_successful_legacy_update_doctor_reads_newly_recorded_connections(self):
        rc = self.home / ".zshrc"
        self.seed_runtime("0.5.0", state=False, startup=[rc])
        before_rc = (rc.read_bytes(), rc.stat().st_mtime_ns)
        report = self.report(self.selected("--update"))
        self.assertEqual(report["action"], "updated")
        self.assertEqual(report["doctor"]["hud"]["startupFiles"], [str(rc)])
        self.assertEqual(report["doctor"]["hud"]["language"], "en")
        self.assertTrue(report["doctor"]["hud"]["autostart"]["configured"])
        self.assertEqual((rc.read_bytes(), rc.stat().st_mtime_ns), before_rc)

    def test_final_doctor_failure_reports_written_files_without_claiming_rollback(self):
        for failure in ("codex", "pty", "exit", "json", "shape",
                        "load-only", "probe-timeout", "probe-shape"):
            with self.subTest(failure=failure):
                prefix = self.directory / ("final-probe-" + failure)
                self.rc.write_bytes(self.original)
                result = self.invoke(
                    "--prefix", str(prefix), "--autostart",
                    env={**self.env, "HUD_FIXTURE_FINAL_DOCTOR": failure},
                )
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn("Final HUD diagnostics failed", result.stderr)
                self.assertIn("after shell files and install state were written", result.stderr)
                self.assertIn("no rollback", result.stderr.lower())
                self.assertNotIn("not changed", result.stderr.lower())
                state = json.loads((prefix / "install-state.json").read_text())
                self.assertEqual(state["version"], VERSION)
                self.assertTrue(state["autostart"])
                self.assertTrue((prefix / "shell.sh").is_file())
                self.assertNotEqual(self.rc.read_bytes(), self.original)
                self.assertEqual(result.stdout, "")

    def test_final_doctor_failure_keeps_published_update_state(self):
        self.seed_runtime("0.5.0")
        before_rc = (self.rc.read_bytes(), self.rc.stat().st_mtime_ns)
        result = self.selected("--update", env={**self.env, "HUD_FIXTURE_FINAL_DOCTOR": "pty"})
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("after shell files and install state were written", result.stderr)
        state_file = self.prefix / "install-state.json"
        saved = json.loads(state_file.read_text())
        self.assertEqual(saved["version"], VERSION)
        self.assertEqual(saved["shell"], "zsh")
        self.assertEqual(stat.S_IMODE(state_file.stat().st_mode), 0o600)
        self.assertEqual((self.rc.read_bytes(), self.rc.stat().st_mtime_ns), before_rc)

    def test_invalid_or_unrelated_state_blocks_normal_install_before_npm(self):
        self.prefix.mkdir()
        state_file = self.prefix / "install-state.json"
        for content in ('{broken', '[]', '{"owner":"someone-else"}',
                        '{"schemaVersion":1,"owner":"codex-hud-install"}'):
            with self.subTest(content=content):
                state_file.write_text(content)
                before = self.snapshot()
                result = self.invoke()
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn("state", result.stderr.lower())
                self.assertEqual(self.snapshot(), before)

    def test_update_rejects_malformed_state_fields_before_npm(self):
        self.seed_runtime("0.5.0")
        state_file = self.prefix / "install-state.json"
        original = json.loads(state_file.read_text())
        for changes in (
            {"schemaVersion": True}, {"owner": "another-installer"},
            {"prefix": str(self.directory / "another-prefix")},
            {"command": str(self.bin / "codex")}, {"shellFile": str(self.rc)},
            {"scope": "global"}, {"project": str(self.project)}, {"shell": "fish"},
            {"startupFiles": ["relative.rc"]}, {"startupFiles": [str(state_file)]},
            {"startupFiles": "not-a-list"}, {"autostart": "false"},
            {"language": "unknown"}, {"version": "unknown"},
        ):
            with self.subTest(changes=changes):
                state_file.write_text(json.dumps({**original, **changes}))
                before = self.snapshot()
                result = self.selected("--update")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("state", result.stderr.lower())
                self.assertEqual(self.snapshot(), before)

    def test_duplicate_state_fields_are_refused_before_mutation(self):
        self.seed_runtime("0.5.0")
        state_file = self.prefix / "install-state.json"
        state_file.write_text('{"owner":"another-installer",' + state_file.read_text()[1:])
        before = self.snapshot()
        result = self.selected("--update")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("state", result.stderr.lower())
        self.assertEqual(self.snapshot(), before)

    def test_symlinked_state_is_refused_before_npm(self):
        self.seed_runtime("0.5.0")
        state_file = self.prefix / "install-state.json"
        target = self.directory / "state-owned-elsewhere.json"
        state_file.rename(target)
        state_file.symlink_to(target)
        before = self.snapshot()
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("state", result.stderr.lower())
        self.assertEqual(self.snapshot(), before)

    def test_state_is_not_published_after_npm_or_doctor_failure(self):
        for values in (
            {"HUD_FIXTURE_NPM_FAIL": "fail"}, {"HUD_FIXTURE_PTY": "fail"},
            {"HUD_FIXTURE_PTY": "helper-unavailable"},
            {"HUD_FIXTURE_CODEX": "missing"}, {"HUD_FIXTURE_VERSION": "99.0.0"},
        ):
            with self.subTest(values=values):
                result = self.invoke(env={**self.env, **values})
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.prefix / "install-state.json").exists())
                self.assertFalse((self.prefix / "shell.sh").exists())
                self.assertEqual(self.rc.read_bytes(), self.original)

    def test_load_only_or_unexecuted_pty_is_rejected_before_shell_and_state_writes(self):
        for probe in ("missing", "null", "shape", "not-run", "timeout", "helper-unavailable"):
            with self.subTest(probe=probe):
                prefix = self.directory / ("unverified-pty-" + probe)
                self.rc.write_bytes(self.original)
                result = self.invoke(
                    "--prefix", str(prefix), "--autostart",
                    env={**self.env, "HUD_FIXTURE_PROBE": probe},
                )
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn("HUD diagnostics failed", result.stderr)
                self.assertTrue((prefix / "bin" / "codex-hud").is_file())
                self.assertFalse((prefix / "shell.sh").exists())
                self.assertFalse((prefix / "install-state.json").exists())
                self.assertEqual(self.rc.read_bytes(), self.original)

    def test_startup_write_failure_does_not_publish_state(self):
        installer = runpy.run_path(str(INSTALLER), run_name="hud_installer_test")
        original_replace = os.replace

        def replace(source, destination):
            if Path(destination) == self.rc:
                raise OSError("simulated startup write failure")
            return original_replace(source, destination)

        argv = [str(INSTALLER), "--prefix", str(self.prefix), "--shell", "bash",
                "--rc-file", str(self.rc), "--autostart"]
        with mock.patch.dict(os.environ, self.env, clear=True), \
                mock.patch.object(sys, "argv", argv), mock.patch("os.replace", side_effect=replace):
            with self.assertRaisesRegex(OSError, "startup write failure"):
                installer["install"](installer["parse_args"]())
        self.assertTrue((self.prefix / "shell.sh").exists())
        self.assertFalse((self.prefix / "install-state.json").exists())
        self.assertEqual(self.rc.read_bytes(), self.original)

    def test_update_keeps_previous_state_when_post_install_checks_fail(self):
        for values in ({"HUD_FIXTURE_NPM_FAIL": "fail"}, {"HUD_FIXTURE_PTY": "fail"},
                       {"HUD_FIXTURE_PTY": "helper-unavailable"}, {"HUD_FIXTURE_PROBE": "missing"},
                       {"HUD_FIXTURE_CODEX": "missing"}, {"HUD_FIXTURE_VERSION": "99.0.0"}):
            with self.subTest(values=values):
                self.seed_runtime("0.5.0")
                paths = [self.prefix / "install-state.json", self.prefix / "shell.sh", self.rc]
                before = [(path.read_bytes(), path.stat().st_mtime_ns) for path in paths]
                result = self.selected("--update", env={**self.env, **values})
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual([(path.read_bytes(), path.stat().st_mtime_ns) for path in paths], before)

    def test_legacy_load_only_runtime_can_upgrade_before_real_pty_verification(self):
        self.seed_runtime("0.6.0", state=False)
        executable = self.prefix / "bin" / "codex-hud"
        executable.write_text(HEADER + """
import json, sys
if sys.argv[1:] == ['--version']:
    print('0.6.0')
elif sys.argv[1:] == ['doctor', '--json']:
    print(json.dumps({'codex': 'codex-cli 0.153.4', 'inline': {'available': True}}))
else:
    sys.exit('Unexpected legacy runtime command')
""")
        script = self.versioned_bundle("0.7.0")
        report = self.report(self.selected("--update", script=script, env={
            **self.env, "HUD_FIXTURE_VERSION": "0.7.0",
        }))
        self.assertEqual(report["previousVersion"], "0.6.0")
        self.assertEqual(report["installedVersion"], "0.7.0")
        self.assertEqual(report["versionComparison"], "same")
        self.assertEqual(report["doctor"]["inline"]["probe"]["status"], "ok")

    def test_update_preserves_custom_user_zsh_connections_with_different_shell(self):
        self.seed_runtime("0.5.0", shell="zsh")
        before_rc = (self.rc.read_bytes(), self.rc.stat().st_mtime_ns)
        report = self.report(self.selected("--update", env={**self.env, "SHELL": "/bin/bash"}))
        self.assertEqual(report["action"], "updated")
        self.assertEqual(report["prefix"], str(self.prefix))
        self.assertEqual(report["shell"], "zsh")
        self.assertEqual(report["startupFiles"], [str(self.rc)])
        self.assertEqual(report["language"], "en")
        self.assertTrue(report["autostart"])
        self.assertEqual((self.rc.read_bytes(), self.rc.stat().st_mtime_ns), before_rc)
        self.assertFalse((self.home / ".bashrc").exists())
        self.assertFalse((self.home / ".bash_profile").exists())
        saved = json.loads((self.prefix / "install-state.json").read_text())
        self.assertEqual(saved["shell"], "zsh")
        self.assertEqual(saved["startupFiles"], [str(self.rc)])
        self.assertEqual(saved["version"], VERSION)

    def test_successful_update_reports_current_and_previous_runtime_versions(self):
        self.seed_runtime("0.5.0")
        report = self.report(self.selected("--update"))
        self.assertEqual(report["installedVersion"], VERSION)
        self.assertEqual(report["versionComparison"], "same")
        self.assertEqual(report["previousVersion"], "0.5.0")
        self.assertEqual(report["previousVersionComparison"], "upgrade")
        self.assertEqual(report["verifiedVersion"], VERSION)
        self.assertEqual(report["stage"], "complete")

    def test_update_dry_run_keeps_current_pre_operation_version(self):
        self.seed_runtime("0.5.0")
        before = self.snapshot()
        report = self.report(self.selected("--update", "--dry-run"))
        self.assertEqual(report["installedVersion"], "0.5.0")
        self.assertEqual(report["versionComparison"], "upgrade")
        self.assertEqual(report["bundledVersion"], VERSION)
        self.assertNotIn("verifiedVersion", report)
        self.assertEqual(self.snapshot(), before)

    def test_update_preserves_project_root_when_custom_prefix_has_autostart_off(self):
        prefix = self.project / "tools" / "local-hud"
        self.seed_runtime("0.5.0", prefix=prefix, scope="project", project=self.project,
                          autostart=False, shell="none")
        report = self.report(self.selected("--update", prefix=prefix))
        self.assertEqual(report["scope"], "project")
        self.assertEqual(report["project"], str(self.project))
        self.assertEqual(report["prefix"], str(prefix))
        self.assertFalse(report["autostart"])
        self.assertEqual(report["startupFiles"], [])
        self.assertEqual(self.rc.read_bytes(), self.original)
        saved = json.loads((prefix / "install-state.json").read_text())
        self.assertEqual(saved["project"], str(self.project))

    def test_update_preserves_live_shell_settings_over_stale_state(self):
        self.seed_runtime("0.5.0", language="en", autostart=True)
        shell_file = self.prefix / "shell.sh"
        shell_file.write_text("# Managed by codex-hud-install.\n# scope: user\n# language: ko\n")
        report = self.report(self.selected("--update"))
        self.assertEqual(report["language"], "ko")
        self.assertFalse(report["autostart"])
        saved = json.loads((self.prefix / "install-state.json").read_text())
        self.assertEqual(saved["language"], "ko")
        self.assertFalse(saved["autostart"])
        self.assertEqual(self.terminal(["prompt"])["program"], "codex")

    def test_update_can_recover_missing_shell_from_valid_state(self):
        self.seed_runtime("0.5.0")
        (self.prefix / "shell.sh").unlink()
        before_rc = (self.rc.read_bytes(), self.rc.stat().st_mtime_ns)
        report = self.report(self.selected("--update"))
        self.assertEqual(report["language"], "en")
        self.assertTrue(report["autostart"])
        self.assertEqual(report["shell"], "zsh")
        self.assertEqual((self.rc.read_bytes(), self.rc.stat().st_mtime_ns), before_rc)
        self.assertEqual(self.terminal(["prompt"])["program"], "hud")

    def test_update_without_state_or_managed_shell_refuses_to_guess_configuration(self):
        self.seed_runtime("0.5.0", state=False, startup=[])
        (self.prefix / "shell.sh").unlink()
        before = self.snapshot()
        result = self.selected("--update")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("configuration", result.stderr.lower())
        self.assertEqual(self.snapshot(), before)

    def test_update_same_version_is_noop_without_npm_or_prerequisites(self):
        self.seed_runtime(VERSION)
        before = self.snapshot()
        report = self.report(self.selected("--update", env={**self.env, "PATH": "/missing"}))
        self.assertEqual(report["action"], "unchanged")
        self.assertEqual(report["versionComparison"], "same")
        self.assertEqual(self.snapshot(), before)

    def test_legacy_same_version_is_noop_and_does_not_migrate_state(self):
        self.seed_runtime(VERSION, state=False)
        before = self.snapshot()
        report = self.report(self.selected("--update"))
        self.assertEqual(report["action"], "unchanged")
        self.assertFalse((self.prefix / "install-state.json").exists())
        self.assertEqual(self.snapshot(), before)

    def test_plain_install_still_reinstalls_same_version_for_repair(self):
        self.seed_runtime(VERSION)
        report = self.installed()
        self.assertEqual(report["action"], "installed")
        self.assertEqual(report["versionComparison"], "same")
        self.assertEqual(report["verifiedVersion"], VERSION)
        self.assertTrue(self.log.exists())

    def test_scope_and_project_directory_select_standard_update_prefixes(self):
        user_prefix = self.home / ".local" / "share" / "codex-hud"
        project_prefix = self.project / ".codex-hud"
        self.seed_runtime("0.5.0", prefix=user_prefix)
        self.seed_runtime("0.5.0", prefix=project_prefix, scope="project", project=self.project)
        for flags, prefix, scope in (
            (["--scope", "user"], user_prefix, "user"),
            (["--project-dir", str(self.project)], project_prefix, "project"),
        ):
            with self.subTest(scope=scope):
                result = subprocess.run(
                    [sys.executable, str(INSTALLER), "--update", *flags], env=self.env,
                    cwd="/tmp", capture_output=True, text=True, timeout=10,
                )
                report = self.report(result)
                self.assertEqual(report["action"], "updated")
                self.assertEqual(report["prefix"], str(prefix))
                self.assertEqual(report["scope"], scope)

    def test_update_absent_target_never_selects_another_runtime_on_path(self):
        other = self.directory / "other-hud"
        self.seed_runtime("0.5.0", prefix=other, startup=[])
        before = self.snapshot()
        env = {**self.env, "PATH": str(other / "bin") + os.pathsep + self.env["PATH"]}
        result = self.selected("--update", env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing", result.stderr.lower())
        self.assertEqual(self.snapshot(), before)

    def test_update_rejects_configuration_flags_without_writes(self):
        self.seed_runtime("0.5.0")
        before = self.snapshot()
        for flags in (("--shell", "bash"), ("--language", "ko"),
                      ("--autostart",), ("--rc-file", str(self.rc))):
            with self.subTest(flags=flags):
                result = self.selected("--update", *flags)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("--update", result.stderr)
                self.assertIn(flags[0], result.stderr)
                self.assertEqual(self.snapshot(), before)

    def test_update_cannot_change_known_scope_or_project(self):
        prefix = self.project / "tools" / "hud"
        self.seed_runtime("0.5.0", prefix=prefix, scope="project", project=self.project)
        before = self.snapshot()
        for flags in (("--scope", "user"), ("--project-dir", str(self.directory))):
            with self.subTest(flags=flags):
                result = self.selected("--update", *flags, prefix=prefix)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.snapshot(), before)

    def test_update_legacy_user_preserves_header_values_and_existing_startup_file(self):
        rc = self.home / ".zshrc"
        self.seed_runtime("0.5.0", state=False, startup=[rc])
        before_rc = (rc.read_bytes(), rc.stat().st_mtime_ns)
        report = self.report(self.selected("--update"))
        self.assertEqual(report["scope"], "user")
        self.assertEqual(report["language"], "en")
        self.assertTrue(report["autostart"])
        self.assertEqual(report["shell"], "zsh")
        self.assertEqual(report["startupFiles"], [str(rc)])
        self.assertEqual((rc.read_bytes(), rc.stat().st_mtime_ns), before_rc)
        self.assertTrue((self.prefix / "install-state.json").is_file())

    def test_legacy_user_without_scope_header_and_unknown_custom_rc_is_preserved(self):
        self.seed_runtime("0.5.0", state=False)
        shell_file = self.prefix / "shell.sh"
        shell_file.write_text(shell_file.read_text().replace("# scope: user\n", ""))
        before_rc = (self.rc.read_bytes(), self.rc.stat().st_mtime_ns)
        report = self.report(self.selected("--update"))
        self.assertEqual(report["scope"], "user")
        self.assertEqual(report["language"], "en")
        self.assertTrue(report["autostart"])
        self.assertEqual(report["startupFiles"], [])
        self.assertEqual(report["shell"], "none")
        self.assertEqual((self.rc.read_bytes(), self.rc.stat().st_mtime_ns), before_rc)
        self.assertFalse((self.home / ".bashrc").exists())

    def test_project_assignment_prevents_legacy_prefix_becoming_user_scope(self):
        prefix = self.project / "tools" / "hud"
        self.seed_runtime("0.5.0", prefix=prefix, state=False,
                          scope="project", project=self.project)
        shell_file = prefix / "shell.sh"
        shell_file.write_text(shell_file.read_text().replace("# scope: project\n", ""))
        report = self.report(self.selected("--update", prefix=prefix))
        self.assertEqual(report["scope"], "project")
        self.assertEqual(report["project"], str(self.project))
        self.assertEqual(report["startupFiles"], [])
        self.assertEqual(self.rc.read_bytes(), self.original)

    def test_update_legacy_project_safely_recovers_quoted_literal_root(self):
        prefix = self.project / "tools" / "hud"
        self.seed_runtime("0.5.0", prefix=prefix, state=False,
                          scope="project", project=self.project)
        report = self.report(self.selected("--update", prefix=prefix))
        self.assertEqual(report["scope"], "project")
        self.assertEqual(report["project"], str(self.project))
        self.assertEqual(report["language"], "en")
        self.assertTrue(report["autostart"])
        self.assertEqual(report["startupFiles"], [])
        self.assertEqual(self.rc.read_bytes(), self.original)

    def test_standard_project_selection_recovers_legacy_root_without_autostart(self):
        prefix = self.project / ".codex-hud"
        self.seed_runtime("0.5.0", prefix=prefix, state=False, scope="project",
                          project=self.project, autostart=False)
        result = subprocess.run(
            [sys.executable, str(INSTALLER), "--update", "--scope", "project",
             "--project-dir", str(self.project)],
            env=self.env, cwd="/tmp", capture_output=True, text=True, timeout=10,
        )
        report = self.report(result)
        self.assertEqual(report["project"], str(self.project))
        self.assertEqual(report["prefix"], str(prefix))
        self.assertFalse(report["autostart"])
        saved = json.loads((prefix / "install-state.json").read_text())
        self.assertEqual(saved["project"], str(self.project))

    def test_explicit_legacy_dot_codex_hud_prefix_needs_a_root_even_when_nested(self):
        for prefix in (self.project / ".codex-hud", self.project / "nested" / ".codex-hud"):
            with self.subTest(prefix=prefix):
                self.seed_runtime("0.5.0", prefix=prefix, state=False, scope="project",
                                  project=self.project, autostart=False)
                before = self.snapshot()
                for flags in (("--update",), ("--update", "--dry-run"), ("--status",), ("--dry-run",)):
                    result = self.selected(*flags, prefix=prefix)
                    self.assertNotEqual(result.returncode, 0, result.stdout)
                    self.assertIn("--project-dir", result.stderr)
                    self.assertEqual(self.snapshot(), before)
                report = self.report(self.selected("--update", "--project-dir", str(self.project),
                                                   prefix=prefix))
                self.assertEqual(report["project"], str(self.project))
                self.assertFalse(report["autostart"])
                saved = json.loads((prefix / "install-state.json").read_text())
                self.assertEqual(saved["project"], str(self.project))

    def test_locating_cwd_cannot_establish_an_unknown_legacy_project_root(self):
        modes = (("--update",), ("--update", "--dry-run"), ("--status",), ("--dry-run",), ())
        for index, flags in enumerate(modes):
            with self.subTest(flags=flags):
                locating_cwd = self.project / f"nested-{index}"
                prefix = locating_cwd / ".codex-hud"
                self.seed_runtime("0.5.0", prefix=prefix, state=False, scope="project",
                                  project=self.project, autostart=False)
                before = self.snapshot()
                result = subprocess.run(
                    [sys.executable, str(INSTALLER), "--scope", "project", *flags],
                    env=self.env, cwd=locating_cwd, capture_output=True, text=True, timeout=10,
                )
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn("--project-dir", result.stderr)
                self.assertEqual(self.snapshot(), before)

    def test_recovered_project_root_wins_over_the_cwd_locating_its_prefix(self):
        for source, state, autostart in (("state", True, False), ("literal", False, True)):
            with self.subTest(source=source):
                locating_cwd = self.project / ("nested-" + source)
                prefix = locating_cwd / ".codex-hud"
                self.seed_runtime("0.5.0", prefix=prefix, state=state, scope="project",
                                  project=self.project, autostart=autostart)
                before = self.snapshot()
                for flags in (("--status",), ("--update", "--dry-run")):
                    result = subprocess.run(
                        [sys.executable, str(INSTALLER), "--scope", "project", *flags],
                        env=self.env, cwd=locating_cwd, capture_output=True, text=True, timeout=10,
                    )
                    report = self.report(result)
                    self.assertEqual(report["project"], str(self.project))
                    self.assertEqual(report["prefix"], str(prefix))
                    self.assertEqual(self.snapshot(), before)
                result = subprocess.run(
                    [sys.executable, str(INSTALLER), "--update", "--scope", "project"],
                    env=self.env, cwd=locating_cwd, capture_output=True, text=True, timeout=10,
                )
                report = self.report(result)
                self.assertEqual(report["action"], "updated")
                self.assertEqual(report["prefix"], str(prefix))
                self.assertEqual(report["project"], str(self.project))
                self.assertEqual(report["autostart"], autostart)
                saved = json.loads((prefix / "install-state.json").read_text())
                self.assertEqual(saved["project"], str(self.project))

    def test_custom_legacy_project_without_root_requires_explicit_project_directory(self):
        prefix = self.project / "tools" / "hud"
        self.seed_runtime("0.5.0", prefix=prefix, state=False, scope="project",
                          project=self.project, autostart=False)
        before = self.snapshot()
        result = self.selected("--update", prefix=prefix)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--project-dir", result.stderr)
        self.assertEqual(self.snapshot(), before)
        report = self.report(self.selected("--update", "--project-dir", str(self.project),
                                           prefix=prefix))
        self.assertEqual(report["scope"], "project")
        self.assertEqual(report["project"], str(self.project))

    def test_legacy_project_root_is_never_executed(self):
        prefix = self.project / "tools" / "hud"
        self.seed_runtime("0.5.0", prefix=prefix, state=False, scope="project",
                          project=self.project, recoverable_root=False)
        marker = self.directory / "executed-root-assignment"
        shell_file = prefix / "shell.sh"
        with shell_file.open("a") as file:
            file.write("_CODEX_HUD_PROJECT_ROOT=$(touch " + shlex.quote(str(marker)) + ")\n")
        before = self.snapshot()
        result = self.selected("--update", prefix=prefix)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--project-dir", result.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_long_unquoted_expanding_legacy_root_is_rejected_without_stalling(self):
        prefix = self.project / "tools" / "hud"
        self.seed_runtime("0.6.0", prefix=prefix, state=False, scope="project",
                          project=self.project, recoverable_root=False)
        with (prefix / "shell.sh").open("a") as file:
            file.write("_CODEX_HUD_PROJECT_ROOT=/" + "a" * 8192 + "$UNRESOLVED\n")
        before = self.snapshot()
        try:
            result = subprocess.run(
                [sys.executable, str(INSTALLER), "--update", "--prefix", str(prefix)],
                env=self.env, cwd="/tmp", capture_output=True, text=True, timeout=2,
            )
        except subprocess.TimeoutExpired:
            self.fail("Installer stalled while parsing a long unquoted expanding legacy root.")
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("--project-dir", result.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_install_preserves_content_permissions_and_private_backup(self):
        report = self.installed("--autostart", "--language", "en")
        self.assertTrue(self.rc.read_bytes().startswith(self.original))
        self.assertEqual(stat.S_IMODE(self.rc.stat().st_mode), 0o640)
        backup = Path(report["backups"][0])
        self.assertEqual(backup.read_bytes(), self.original)
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
        self.assertTrue(report["doctor"]["inline"]["available"])
        self.assertFalse(report["doctor"]["sessionsDirectory"])

    def test_reinstall_is_idempotent_and_preserves_language_and_autostart(self):
        self.installed("--autostart", "--language", "en")
        before = self.rc.read_bytes()
        shell_before = (self.prefix / "shell.sh").read_bytes()
        report = self.installed()
        self.assertEqual(report["backups"], [])
        self.assertTrue(report["autostart"])
        self.assertEqual(report["language"], "en")
        self.assertEqual(self.rc.read_bytes(), before)
        self.assertEqual((self.prefix / "shell.sh").read_bytes(), shell_before)

    def test_normal_install_does_not_override_codex(self):
        report = self.installed()
        self.assertFalse(report["autostart"])
        self.assertEqual(self.terminal(["prompt"])["program"], "codex")

    def test_user_scope_retains_existing_install_and_startup_behavior(self):
        report = self.installed("--scope", "user", "--autostart")
        self.assertEqual(report["scope"], "user")
        self.assertIsNone(report["project"])
        self.assertEqual(report["prefix"], str(self.prefix))
        self.assertEqual(report["startupFiles"], [str(self.rc)])
        self.assertEqual(self.terminal(["prompt"])["program"], "hud")

    def test_project_dry_run_uses_local_prefix_without_startup_or_install_writes(self):
        report = self.installed_project("--dry-run", "--autostart")
        self.assertEqual(report["scope"], "project")
        self.assertEqual(report["project"], str(self.project))
        self.assertEqual(report["prefix"], str(self.project / ".codex-hud"))
        self.assertEqual(report["startupFiles"], [])
        self.assertFalse((self.project / ".codex-hud").exists())
        self.assertFalse(self.log.exists())
        self.assertEqual(self.rc.read_bytes(), self.original)

    def test_project_scope_defaults_to_the_invocation_directory(self):
        result = subprocess.run(
            [sys.executable, str(INSTALLER), "--scope", "project", "--dry-run"],
            env=self.env, cwd=self.project, capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["project"], str(self.project))
        self.assertEqual(report["prefix"], str(self.project / ".codex-hud"))
        self.assertEqual(report["startupFiles"], [])

    def test_fresh_project_install_can_save_cwd_as_its_new_root(self):
        result = subprocess.run(
            [sys.executable, str(INSTALLER), "--scope", "project"],
            env=self.env, cwd=self.project, capture_output=True, text=True, timeout=10,
        )
        report = self.report(result)
        prefix = self.project / ".codex-hud"
        self.assertEqual(report["action"], "installed")
        self.assertEqual(report["prefix"], str(prefix))
        self.assertEqual(report["project"], str(self.project))
        saved = json.loads((prefix / "install-state.json").read_text())
        self.assertEqual(saved["project"], str(self.project))
        self.assertEqual(saved["startupFiles"], [])
        self.assertEqual(self.rc.read_bytes(), self.original)

    def test_project_install_does_not_change_startup_files_or_override_codex_by_default(self):
        report = self.installed_project()
        executable = self.project / ".codex-hud" / "bin" / "codex-hud"
        self.assertEqual(report["command"], str(executable))
        self.assertTrue(executable.is_file())
        self.assertEqual(report["startupFiles"], [])
        self.assertEqual(report["backups"], [])
        self.assertEqual(self.rc.read_bytes(), self.original)
        self.assertEqual(self.terminal(["prompt"], shell_file=report["shellFile"],
                                       cwd=self.project)["program"], "codex")

    def test_project_autostart_respects_directory_boundaries_and_command_routing(self):
        report = self.installed_project("--autostart", "--language", "en")
        child = self.project / "nested"
        child.mkdir()
        sibling = self.project.with_name(self.project.name + "-sibling")
        sibling.mkdir()
        outside = self.directory / "outside"
        outside.mkdir()
        link = self.project / "linked-outside"
        link.symlink_to(outside, target_is_directory=True)
        for cwd in (self.project, child):
            for args in (["prompt"], ["resume", "--last"], ["fork", "--last"]):
                with self.subTest(cwd=cwd, args=args):
                    record = self.terminal(args, shell_file=report["shellFile"],
                                           cwd=cwd, exit_code=23)
                    self.assertEqual(record["program"], "hud")
                    self.assertEqual(record["executable"], report["command"])
                    self.assertEqual(record["args"], ["start", "--language", "en", "--", *args])
        for cwd in (sibling, outside, link):
            with self.subTest(outside=cwd):
                self.assertEqual(self.terminal(["prompt"], shell_file=report["shellFile"],
                                               cwd=cwd)["program"], "codex")
        self.assertEqual(self.terminal(["exec", "prompt"], shell_file=report["shellFile"],
                                       cwd=self.project)["program"], "codex")
        self.assertEqual(self.terminal([], shell_file=report["shellFile"],
                                       cwd=self.project, tty=False)["program"], "codex")
        self.assertEqual(self.terminal([], shell_file=report["shellFile"],
                                       cwd=self.project, raw=True)["program"], "codex")
        self.assertEqual(self.rc.read_bytes(), self.original)

    def test_project_and_user_autostart_choose_the_matching_installation(self):
        user = self.installed("--scope", "user", "--autostart", "--language", "ko")
        project = self.installed_project("--autostart", "--language", "en")
        source_user = ". " + shlex.quote(user["shellFile"])
        for cwd, expected in ((self.project, project), (self.directory, user)):
            with self.subTest(cwd=cwd):
                record = self.terminal(["prompt"], shell_file=project["shellFile"],
                                       prefix_script=source_user, cwd=cwd)
                self.assertEqual(record["executable"], expected["command"])
                self.assertEqual(record["args"][2], expected["language"])

    def test_project_autostart_uses_codex_directory_options_before_the_delimiter(self):
        report = self.installed_project("--autostart")
        cases = [
            (self.project, ["--cd", str(self.directory), "prompt"], "codex"),
            (self.directory, ["--cd", str(self.project), "prompt"], "hud"),
            (self.directory, ["--cd=" + str(self.project), "prompt"], "hud"),
            (self.directory, ["-C" + str(self.project), "prompt"], "hud"),
            (self.directory, ["-C=" + str(self.project), "prompt"], "hud"),
            (self.project, ["--model", "--cd=/not-a-directory", "prompt"], "hud"),
            (self.directory, ["--", "--cd", str(self.project)], "codex"),
        ]
        for cwd, args, program in cases:
            with self.subTest(cwd=cwd, args=args):
                record = self.terminal(args, shell_file=report["shellFile"], cwd=cwd)
                self.assertEqual(record["program"], program)
                expected = ["start", "--language", "ko", "--", *args] if program == "hud" else args
                self.assertEqual(record["args"], expected)

    def test_project_autostart_preserves_newlines_when_checking_the_directory_boundary(self):
        report = self.installed_project("--autostart")
        outside = self.project.with_name(self.project.name + "\n")
        outside.mkdir()
        for cwd, args in (
            (self.project, ["--cd", str(outside), "prompt"]),
            (outside, ["prompt"]),
        ):
            with self.subTest(cwd=cwd, args=args):
                record = self.terminal(args, shell_file=report["shellFile"], cwd=cwd)
                self.assertEqual(record["program"], "codex")
                self.assertEqual(record["args"], args)

    @unittest.skipUnless(shutil.which("zsh"), "Zsh is not installed.")
    def test_zsh_project_directory_check_does_not_run_chpwd_hooks(self):
        report = self.installed_project("--autostart")
        marker = self.directory / "chpwd-called"
        hook = "chpwd() { print changed; print called >> " + shlex.quote(str(marker)) + "; }"
        record = self.terminal(["prompt"], shell_file=report["shellFile"],
                               prefix_script=hook, cwd=self.project, shell_name="zsh")
        self.assertEqual(record["program"], "hud")
        self.assertFalse(marker.exists())

    def test_project_reinstall_preserves_autostart_and_language_without_profile_edits(self):
        first = self.installed_project("--autostart", "--language", "en")
        shell_before = Path(first["shellFile"]).read_bytes()
        second = self.installed_project()
        self.assertTrue(second["autostart"])
        self.assertEqual(second["language"], "en")
        self.assertEqual(Path(second["shellFile"]).read_bytes(), shell_before)
        self.assertEqual(second["startupFiles"], [])
        self.assertEqual(self.rc.read_bytes(), self.original)

    def test_project_scope_rejects_external_prefixes_and_user_startup_files_before_npm(self):
        escaped = self.project / "escape"
        escaped.symlink_to(self.directory, target_is_directory=True)
        for args in (
            ["--prefix", str(self.prefix)],
            ["--prefix", str(self.project)],
            ["--prefix", str(escaped / "hud")],
            ["--rc-file", str(self.rc)],
        ):
            with self.subTest(args=args):
                result = self.invoke_project(*args)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.log.exists())
                self.assertEqual(self.rc.read_bytes(), self.original)

    def test_project_scope_requires_an_existing_project_directory(self):
        ordinary_file = self.directory / "not-a-directory"
        ordinary_file.write_text("keep")
        for project in (self.directory / "missing", ordinary_file, Path("/")):
            with self.subTest(project=project):
                result = self.invoke_project(project=project)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.log.exists())

    def test_user_scope_rejects_project_directory_before_npm(self):
        result = self.invoke("--scope", "user", "--project-dir", str(self.project))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.log.exists())

    def test_npm_failure_leaves_shell_files_untouched(self):
        result = self.invoke("--autostart", env={**self.env, "HUD_FIXTURE_NPM_FAIL": "1"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("npm install failed", result.stderr)
        self.assertEqual(self.rc.read_bytes(), self.original)
        self.assertFalse((self.prefix / "shell.sh").exists())

    def test_failed_pty_diagnostics_do_not_enable_broken_autostart(self):
        result = self.invoke("--autostart", env={**self.env, "HUD_FIXTURE_PTY": "fail"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HUD diagnostics failed", result.stderr)
        self.assertEqual(self.rc.read_bytes(), self.original)
        self.assertFalse((self.prefix / "shell.sh").exists())

    def test_malformed_markers_are_rejected_before_installation(self):
        self.rc.write_text("# >>> codex-hud installer >>>\nunfinished\n")
        before = self.rc.read_bytes()
        result = self.invoke("--autostart")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("markers", result.stderr)
        self.assertFalse(self.log.exists())
        self.assertEqual(self.rc.read_bytes(), before)

    def test_unrelated_shell_file_is_not_overwritten(self):
        self.prefix.mkdir()
        shell = self.prefix / "shell.sh"
        shell.write_text("# user-owned file\n")
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unrelated", result.stderr)
        self.assertEqual(shell.read_text(), "# user-owned file\n")
        self.assertFalse(self.log.exists())

    def test_startup_symlink_is_preserved(self):
        link = self.directory / "linked.rc"
        link.symlink_to(self.rc)
        result = self.invoke("--autostart", rc=link)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(link.is_symlink())
        self.assertTrue(self.rc.read_bytes().startswith(self.original))

    def test_refuses_startup_file_that_would_source_itself(self):
        result = self.invoke("--autostart", rc=self.prefix / "shell.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.log.exists())

    def test_corrupt_bundle_is_rejected_without_running_npm(self):
        copy = self.directory / "copied-skill"
        shutil.copytree(SKILL, copy)
        metadata = json.loads((copy / "assets" / "package.json").read_text())
        archive = copy / "assets" / metadata["file"]
        archive.write_bytes(archive.read_bytes() + b"broken")
        result = self.invoke(script=copy / "scripts" / "install.py")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum", result.stderr)
        self.assertFalse(self.log.exists())

    def test_unsupported_node_fails_before_writes(self):
        result = self.invoke(env={**self.env, "HUD_FIXTURE_NODE": "v18.20.0"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Node.js 20+", result.stderr)
        self.assertFalse(self.log.exists())

    def test_offline_cache_options_are_forwarded_as_literal_arguments(self):
        cache = self.directory / "cache with spaces"
        self.installed("--offline", "--npm-cache", str(cache))
        call = json.loads(self.log.read_text().splitlines()[0])
        self.assertIn("--offline", call)
        self.assertEqual(call[call.index("--cache") + 1], str(cache))

    def test_terminal_routing_preserves_arguments_and_exit_codes(self):
        self.installed("--autostart")
        cases = [
            ([], "hud"),
            (["resume", "--last"], "hud"),
            (["fork", "--last"], "hud"),
            (["--profile", "exec", "한글 prompt"], "hud"),
            (["-i", "exec", "--model", "fixture"], "hud"),
            (["--", "exec"], "hud"),
            (["literal $HOME $(false); `false` \"quotes\"\nnew line"], "hud"),
            (["exec", "prompt"], "codex"),
            (["--profile", "fixture", "exec", "prompt"], "codex"),
            (["--version"], "codex"),
            (["resume", "--help"], "codex"),
            (["login", "status"], "codex"),
        ]
        for args, program in cases:
            with self.subTest(args=args):
                record = self.terminal(args, exit_code=23)
                self.assertEqual(record["program"], program)
                self.assertEqual(record["cwd"], "/tmp")
                expected = ["start", "--language", "ko", "--", *args] if program == "hud" else args
                self.assertEqual(record["args"], expected)
        self.assertEqual(self.terminal([], raw=True)["program"], "codex")
        self.assertEqual(self.terminal([], tty=False)["program"], "codex")

    def test_existing_codex_flag_alias_survives_autostart_setup(self):
        self.installed("--autostart")
        record = self.terminal(["prompt"], prefix_script=(
            "shopt -s expand_aliases\nalias codex='codex --search'\n"
        ))
        self.assertEqual(record["program"], "hud")
        self.assertEqual(record["args"], ["start", "--language", "ko", "--", "--search", "prompt"])


if __name__ == "__main__":
    unittest.main()
