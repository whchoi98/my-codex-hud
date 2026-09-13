"""Exercise installation side effects using local executable stand-ins."""

import errno
import json
import os
from pathlib import Path
import pty
import select
import shlex
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
        self.project = self.directory / "project ' quoted $ [name]"
        self.project.mkdir()

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
