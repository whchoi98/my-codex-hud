"""Exercise installation side effects using local executable stand-ins."""

import errno
import json
import os
from pathlib import Path
import pty
import select
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "plugins" / "codex-hud" / "skills" / "codex-hud-install"
INSTALLER = SKILL / "scripts" / "install.py"
VERSION = json.loads((SKILL / "assets" / "package.json").read_text())["version"]
HEADER = f"#!{sys.executable}\n"
HUD = HEADER + """
import json, os, sys
if sys.argv[1:] == ['--version']:
    print(os.environ['HUD_FIXTURE_VERSION'])
elif sys.argv[1:2] == ['doctor']:
    print(json.dumps({'node': 'v20.20.1', 'codex': 'codex-cli 0.153.4',
                      'inline': {'available': os.environ.get('HUD_FIXTURE_PTY') != 'fail'},
                      'sessionsDirectory': False, 'matchingSession': None}))
else:
    print(json.dumps({'program': 'hud', 'args': sys.argv[1:], 'cwd': os.getcwd()}))
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
executable.write_text(os.environ['HUD_FIXTURE_EXECUTABLE'])
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

    def terminal(self, args, *, raw=False, prefix_script="", exit_code=0, tty=True):
        shell = self.directory / "invocation.bash"
        shell.write_text(
            prefix_script + '\n. "$1"\nshift\n'
            + ('command codex' if raw else 'codex') + ' "$@"\n'
        )
        command = ["/bin/bash", "--noprofile", "--norc", str(shell),
                   str(self.prefix / "shell.sh"), *args]
        env = {**self.env, "HUD_FIXTURE_EXIT": str(exit_code)}
        if not tty:
            result = subprocess.run(command, env=env, cwd="/tmp",
                                    capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, exit_code, result.stderr)
            return json.loads(result.stdout)
        master, slave = pty.openpty()
        child = subprocess.Popen(command, env=env, cwd="/tmp",
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
