"""Run the portable skill registration helper against isolated local bundles."""

import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "plugins" / "codex-hud" / "skills" / "codex-hud-install"
NAME = "codex-hud-install"
REPORT_KEYS = {"scope", "project", "skillPath", "version", "action"}


def tree(directory, *, timestamps=False):
    """Snapshot contents without following symlinks or reading access times."""
    result = {}
    for path in sorted(directory.iterdir()):
        details = path.lstat()
        mode = stat.S_IMODE(details.st_mode)
        if path.is_symlink():
            value = ("link", os.readlink(path))
        elif path.is_dir():
            value = ("directory", mode)
            for child, data in tree(path, timestamps=timestamps).items():
                result[f"{path.name}/{child}"] = data
        else:
            value = ("file", mode, path.read_bytes())
        if timestamps:
            value += (details.st_mtime_ns, details.st_ino)
        result[path.name] = value
    return result


class SkillInstallerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="hud-skill-registration-")
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name).resolve()
        self.source = self.directory / "portable bundle" / NAME
        shutil.copytree(SKILL, self.source)
        self.project = self.directory / "project ' 한글 $literal"
        self.project.mkdir()
        self.user_home = self.directory / "user-home"
        self.user_home.mkdir()
        self.no_tools = self.directory / "empty-path"
        self.no_tools.mkdir()
        self.version = json.loads(
            (self.source / "assets" / "package.json").read_text()
        )["version"]
        for filename in (".bashrc", ".bash_profile", ".profile", ".zshrc"):
            (self.user_home / filename).write_text("# Keep user startup settings.\n")
        (self.project / ".envrc").write_text("# Keep project startup settings.\n")

    def destination(self, project=None):
        return (project or self.project) / ".agents" / "skills" / NAME

    def invoke(self, *args, source=None, cwd=None):
        script = (source or self.source) / "scripts" / "install-skill.py"
        self.assertTrue(script.is_file(), "The skill registration helper is not implemented.")
        stdout, stderr = io.StringIO(), io.StringIO()
        previous = Path.cwd()
        try:
            os.chdir(cwd or self.project)
            with (
                mock.patch.object(Path, "home", return_value=self.user_home),
                mock.patch.object(sys, "argv", [str(script), *map(str, args)]),
                mock.patch.dict(os.environ, {"PATH": str(self.no_tools)}),
                contextlib.redirect_stdout(stdout),
                contextlib.redirect_stderr(stderr),
            ):
                try:
                    runpy.run_path(str(script), run_name="__main__")
                except SystemExit as error:
                    code = error.code
                else:
                    code = 0
        finally:
            os.chdir(previous)
        return subprocess.CompletedProcess(args, code, stdout.getvalue(), stderr.getvalue())

    def registered(self, *args, **kwargs):
        result = self.invoke(*args, **kwargs)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        report = json.loads(result.stdout)
        self.assertEqual(set(report), REPORT_KEYS)
        return report

    def rejected_without_writes(self, *args, message=None, **kwargs):
        before = tree(self.directory, timestamps=True)
        result = self.invoke(*args, **kwargs)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertEqual(result.stdout, "")
        self.assertNotIn("Traceback", result.stderr)
        if message:
            self.assertIn(message.lower(), result.stderr.lower())
        self.assertEqual(tree(self.directory, timestamps=True), before)
        return result

    def change_source(self):
        with (self.source / "SKILL.md").open("a") as file:
            file.write("\nA new locally bundled instruction.\n")

    def marker(self, destination):
        candidates = [
            path for path in destination.iterdir()
            if path.is_file() and path.name not in {p.name for p in self.source.iterdir()}
        ]
        self.assertEqual(len(candidates), 1)
        return candidates[0]

    def replace_archive(self, *, name="my-codex-hud", version="99.0.0"):
        metadata_path = self.source / "assets" / "package.json"
        metadata = json.loads(metadata_path.read_text())
        archive = self.source / "assets" / metadata["file"]
        data = json.dumps({"name": name, "version": version}).encode()
        with tarfile.open(archive, "w:gz") as package:
            info = tarfile.TarInfo("package/package.json")
            info.size = len(data)
            package.addfile(info, io.BytesIO(data))
        metadata.update(version=version, sha256=hashlib.sha256(archive.read_bytes()).hexdigest())
        metadata_path.write_text(json.dumps(metadata))

    def test_project_scope_copies_every_bundle_entry_and_reports_canonical_path(self):
        alias = self.directory / "project-alias"
        alias.symlink_to(self.project, target_is_directory=True)
        (self.project / "child").mkdir()
        report = self.registered("--scope", "project", "--project-dir", alias / "child" / "..")
        destination = self.destination()
        self.assertEqual(report, {
            "scope": "project", "project": str(self.project),
            "skillPath": str(destination), "version": self.version, "action": "registered",
        })
        copied = tree(destination)
        for path, expected in tree(self.source).items():
            self.assertEqual(copied[path], expected, path)
        self.assertTrue((destination / "SKILL.md").is_file())
        self.assertTrue((destination / "agents" / "openai.yaml").is_file())
        self.assertTrue((destination / "scripts" / "install.py").is_file())
        metadata = json.loads((destination / "assets" / "package.json").read_text())
        archive = destination / "assets" / metadata["file"]
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), metadata["sha256"])

    def test_project_scope_defaults_to_current_directory(self):
        report = self.registered("--scope", "project")
        self.assertEqual(report["project"], str(self.project))
        self.assertEqual(report["skillPath"], str(self.destination()))
        self.assertTrue((self.destination() / "SKILL.md").is_file())

    def test_user_scope_uses_path_home_without_runtime_or_startup_effects(self):
        home_before = tree(self.user_home, timestamps=True)
        project_before = tree(self.project, timestamps=True)
        report = self.registered("--scope", "user")
        self.assertEqual(report, {
            "scope": "user", "project": None,
            "skillPath": str(self.destination(self.user_home)),
            "version": self.version, "action": "registered",
        })
        for path, expected in tree(self.source).items():
            self.assertEqual(tree(self.destination(self.user_home))[path], expected, path)
        remaining_home = {
            path: data for path, data in tree(self.user_home, timestamps=True).items()
            if path != ".agents" and not path.startswith(".agents/")
        }
        self.assertEqual(remaining_home, home_before)
        self.assertEqual(tree(self.project, timestamps=True), project_before)
        self.assertEqual(set(p.name for p in (self.user_home / ".agents").iterdir()), {"skills"})

    def test_project_registration_has_no_user_or_project_startup_effects(self):
        home_before = tree(self.user_home, timestamps=True)
        self.registered("--scope", "project")
        self.assertEqual(tree(self.user_home, timestamps=True), home_before)
        self.assertEqual(
            {path.name for path in self.project.iterdir()}, {".envrc", ".agents"}
        )
        self.assertEqual((self.project / ".envrc").read_text(), "# Keep project startup settings.\n")

    def test_scope_is_required_and_invalid_scope_is_rejected(self):
        for args in ((), ("--scope", "global")):
            with self.subTest(args=args):
                self.rejected_without_writes(*args, message="--scope")

    def test_user_scope_rejects_project_dir(self):
        self.rejected_without_writes(
            "--scope", "user", "--project-dir", self.project, message="--project-dir"
        )

    def test_dry_run_has_exact_report_and_never_creates_files_for_either_scope(self):
        for scope, base, project in (
            ("project", self.project, str(self.project)),
            ("user", self.user_home, None),
        ):
            with self.subTest(scope=scope):
                before = tree(self.directory, timestamps=True)
                report = self.registered("--scope", scope, "--dry-run")
                self.assertEqual(report, {
                    "scope": scope, "project": project,
                    "skillPath": str(self.destination(base)),
                    "version": self.version, "action": "dry-run",
                })
                self.assertEqual(tree(self.directory, timestamps=True), before)

    def test_registered_bundle_remains_portable_after_original_source_is_removed(self):
        self.registered("--scope", "project")
        first = self.destination()
        second_project = self.directory / "second-project"
        second_project.mkdir()
        expected = tree(self.source)
        shutil.rmtree(self.source)
        report = self.registered(
            "--scope", "project", "--project-dir", second_project, source=first
        )
        self.assertEqual(report["action"], "registered")
        for path, data in expected.items():
            self.assertEqual(tree(self.destination(second_project))[path], data, path)

    def test_registering_from_the_destination_itself_is_a_no_write_noop(self):
        destination = self.destination()
        destination.parent.mkdir(parents=True)
        shutil.copytree(self.source, destination)
        before = tree(self.directory, timestamps=True)
        report = self.registered("--scope", "project", source=destination)
        self.assertEqual(report["action"], "unchanged")
        self.assertEqual(tree(self.directory, timestamps=True), before)

    def test_repeat_registration_is_idempotent_without_backups_or_rewrites(self):
        self.registered("--scope", "project")
        before = tree(self.directory, timestamps=True)
        report = self.registered("--scope", "project")
        self.assertEqual(report["action"], "unchanged")
        self.assertEqual(tree(self.directory, timestamps=True), before)

    def test_missing_file_and_root_project_directories_are_rejected(self):
        root_alias = self.directory / "root-alias"
        root_alias.symlink_to(Path(self.project.anchor), target_is_directory=True)
        for project in (
            self.directory / "does-not-exist",
            self.project / ".envrc",
            Path(self.project.anchor),
            root_alias,
        ):
            with self.subTest(project=project):
                self.rejected_without_writes(
                    "--scope", "project", "--project-dir", project, "--dry-run",
                    message="project",
                )

    def test_source_and_destination_must_not_contain_each_other(self):
        self.rejected_without_writes(
            "--scope", "project", "--project-dir", self.source, message="source"
        )
        nested_source = self.destination() / "nested-bundle"
        shutil.copytree(self.source, nested_source)
        self.rejected_without_writes(
            "--scope", "project", source=nested_source, message="source"
        )

    def test_unmanaged_directories_files_and_symlinks_are_preserved(self):
        outside = self.directory / "unrelated-skill"
        outside.mkdir()
        (outside / "SKILL.md").write_text("Unrelated skill.\n")
        for kind in ("directory", "empty-directory", "file", "link", "dangling-link"):
            with self.subTest(kind=kind):
                project = self.directory / kind
                project.mkdir()
                target = self.destination(project)
                target.parent.mkdir(parents=True)
                if kind in ("directory", "empty-directory"):
                    target.mkdir()
                    if kind == "directory":
                        (target / "SKILL.md").write_text("User-owned skill.\n")
                elif kind == "file":
                    target.write_text("User-owned file.\n")
                else:
                    target.symlink_to(
                        outside if kind == "link" else self.directory / "missing",
                        target_is_directory=True,
                    )
                self.rejected_without_writes(
                    "--scope", "project", "--project-dir", project, message="refus"
                )

    def test_neighboring_skills_and_symlinks_survive_registration(self):
        skills = self.destination().parent
        other = skills / "other-skill"
        other.mkdir(parents=True)
        (other / "SKILL.md").write_text("Another skill.\n")
        (skills / "linked-skill").symlink_to(other, target_is_directory=True)
        (skills / "dangling-skill").symlink_to(self.directory / "missing")
        before = tree(skills, timestamps=True)
        self.registered("--scope", "project")
        after = {
            path: data for path, data in tree(skills, timestamps=True).items()
            if path != NAME and not path.startswith(NAME + "/")
        }
        self.assertEqual(after, before)

    def test_symlinked_destination_ancestors_cannot_escape_project_boundary(self):
        for relative in (".agents", ".agents/skills"):
            with self.subTest(relative=relative):
                project = self.directory / relative.replace("/", "-").lstrip(".")
                project.mkdir()
                outside = self.directory / (project.name + "-outside")
                outside.mkdir()
                link = project / relative
                link.parent.mkdir(parents=True, exist_ok=True)
                link.symlink_to(outside, target_is_directory=True)
                self.rejected_without_writes(
                    "--scope", "project", "--project-dir", project, message="symlink"
                )

    def test_corrupt_archive_is_rejected_including_dry_run(self):
        metadata = json.loads((self.source / "assets" / "package.json").read_text())
        archive = self.source / "assets" / metadata["file"]
        archive.write_bytes(archive.read_bytes() + b"corrupt")
        for extra in ((), ("--dry-run",)):
            with self.subTest(extra=extra):
                self.rejected_without_writes("--scope", "project", *extra, message="checksum")

    def test_archive_filename_traversal_is_rejected_without_writes(self):
        metadata_path = self.source / "assets" / "package.json"
        metadata = json.loads(metadata_path.read_text())
        for filename in ("../outside.tgz", str(self.directory / "outside.tgz")):
            with self.subTest(filename=filename):
                metadata["file"] = filename
                metadata_path.write_text(json.dumps(metadata))
                self.rejected_without_writes(
                    "--scope", "project", "--dry-run", message="assets"
                )

    def test_archive_name_and_version_are_verified_by_runtime_bundle_helper(self):
        metadata_path = self.source / "assets" / "package.json"
        metadata = json.loads(metadata_path.read_text())
        metadata["version"] = "99.0.0"
        metadata_path.write_text(json.dumps(metadata))
        self.rejected_without_writes("--scope", "project", "--dry-run", message="name/version")
        self.replace_archive(name="unrelated-package")
        self.rejected_without_writes("--scope", "project", message="name/version")

    def test_missing_skill_document_is_rejected_before_registration(self):
        (self.source / "SKILL.md").unlink()
        self.rejected_without_writes("--scope", "project", message="SKILL.md")

    def test_internal_relative_source_symlinks_are_copied_as_links(self):
        link = self.source / "assets" / "shell-link.sh"
        link.symlink_to("codex-hud.sh")
        self.registered("--scope", "project")
        copied = self.destination() / "assets" / "shell-link.sh"
        self.assertTrue(copied.is_symlink())
        self.assertEqual(os.readlink(copied), "codex-hud.sh")
        self.assertEqual(copied.read_bytes(), link.read_bytes())

    def test_source_symlinks_cannot_pull_in_external_files(self):
        outside = self.directory / "outside.txt"
        outside.write_text("Must remain outside the skill.\n")
        (self.source / "external.txt").symlink_to(outside)
        self.rejected_without_writes("--scope", "project", "--dry-run", message="symlink")

    def test_source_symlink_cannot_depend_on_the_original_bundle_directory_name(self):
        relocated = self.directory / "custom-bundle-name"
        self.source.rename(relocated)
        self.source = relocated
        (self.source / "reference.md").symlink_to("../custom-bundle-name/SKILL.md")
        self.rejected_without_writes("--scope", "project", message="symlink")

    @unittest.skipUnless(os.name == "posix", "Backslash is a filename character on POSIX.")
    def test_nonportable_source_paths_are_rejected_before_creating_an_unusable_marker(self):
        (self.source / "..\\outside.txt").write_text("Cannot be a portable owned path.\n")
        self.rejected_without_writes("--scope", "project", message="source")

    def test_managed_update_preserves_extras_and_backs_up_outside_discovered_skills(self):
        retired = self.source / "retired.txt"
        retired.write_text("A formerly bundled file.\n")
        self.registered("--scope", "project")
        destination = self.destination()
        (destination / "user-notes.txt").write_text("Keep local notes.\n")
        outside = self.directory / "user-file.txt"
        outside.write_text("Keep linked content.\n")
        (destination / "user-link").symlink_to(outside)
        old_contents = tree(destination)
        retired.unlink()
        self.change_source()
        self.replace_archive()
        (self.source / "scripts" / "new-script.py").write_text("# New bundled script.\n")

        report = self.registered("--scope", "project")
        self.assertEqual(report["action"], "updated")
        self.assertEqual(report["version"], "99.0.0")
        for path, data in tree(self.source).items():
            self.assertEqual(tree(destination)[path], data, path)
        self.assertFalse((destination / "retired.txt").exists())
        self.assertEqual((destination / "user-notes.txt").read_text(), "Keep local notes.\n")
        self.assertTrue((destination / "user-link").is_symlink())
        self.assertEqual(outside.read_text(), "Keep linked content.\n")
        skills = destination.parent
        self.assertEqual({path.name for path in skills.iterdir()}, {NAME})
        backups = [
            path.parent for path in (self.project / ".agents").rglob("SKILL.md")
            if not path.is_relative_to(skills)
        ]
        self.assertEqual(len(backups), 1)
        self.assertEqual(tree(backups[0]), old_contents)

    def test_same_version_source_changes_are_applied(self):
        self.registered("--scope", "project")
        self.change_source()
        report = self.registered("--scope", "project")
        self.assertEqual(report["action"], "updated")
        self.assertEqual(report["version"], self.version)
        self.assertEqual(
            (self.destination() / "SKILL.md").read_bytes(),
            (self.source / "SKILL.md").read_bytes(),
        )

    def test_update_dry_run_does_not_create_backup_or_change_registered_files(self):
        self.registered("--scope", "project")
        self.change_source()
        before = tree(self.directory, timestamps=True)
        report = self.registered("--scope", "project", "--dry-run")
        self.assertEqual(report["action"], "dry-run")
        self.assertEqual(tree(self.directory, timestamps=True), before)

    def test_update_refuses_to_replace_edited_or_deleted_owned_files(self):
        for change in ("edit", "delete", "symlink"):
            with self.subTest(change=change):
                project = self.directory / ("modified-" + change)
                project.mkdir()
                self.registered("--scope", "project", "--project-dir", project)
                skill_file = self.destination(project) / "SKILL.md"
                if change == "edit":
                    skill_file.write_text("Preserve my edited skill.\n")
                else:
                    skill_file.unlink()
                    if change == "symlink":
                        skill_file.symlink_to(self.source / "SKILL.md")
                self.change_source()
                self.rejected_without_writes(
                    "--scope", "project", "--project-dir", project, message="modified"
                )

    def test_new_bundle_files_cannot_overwrite_untracked_target_files(self):
        self.registered("--scope", "project")
        (self.destination() / "local.txt").write_text("Keep my file.\n")
        (self.source / "local.txt").write_text("An unrelated new bundled file.\n")
        self.rejected_without_writes("--scope", "project", message="unrelated")

    def test_removing_owned_directory_keeps_untracked_children(self):
        directory = self.source / "references"
        directory.mkdir()
        (directory / "old.md").write_text("Old reference.\n")
        self.registered("--scope", "project")
        (self.destination() / "references" / "user.md").write_text("Keep user reference.\n")
        shutil.rmtree(directory)
        self.registered("--scope", "project")
        self.assertEqual(
            (self.destination() / "references" / "user.md").read_text(),
            "Keep user reference.\n",
        )
        self.assertFalse((self.destination() / "references" / "old.md").exists())

    def test_replacing_directory_with_file_refuses_to_delete_untracked_children(self):
        directory = self.source / "references"
        directory.mkdir()
        (directory / "old.md").write_text("Old reference.\n")
        self.registered("--scope", "project")
        (self.destination() / "references" / "user.md").write_text("Keep user reference.\n")
        shutil.rmtree(directory)
        directory.write_text("A new file replacing the old directory.\n")
        self.rejected_without_writes("--scope", "project", message="unrelated")

    def test_forged_manifest_paths_cannot_traverse_outside_the_registration(self):
        self.registered("--scope", "project")
        marker = self.marker(self.destination())
        original = json.loads(marker.read_text())
        for path in ("../outside.txt", "/outside.txt", "..\\outside.txt", "C:/outside.txt"):
            with self.subTest(path=path):
                forged = json.loads(json.dumps(original))
                forged["files"][path] = forged["files"]["SKILL.md"]
                marker.write_text(json.dumps(forged))
                self.rejected_without_writes("--scope", "project", message="marker")

    def test_invalid_or_symlinked_ownership_marker_is_not_trusted(self):
        self.registered("--scope", "project")
        marker = self.marker(self.destination())
        valid = marker.read_bytes()
        for data in (b"not json", b"{}", b'{"owner":"someone-else"}'):
            with self.subTest(data=data):
                marker.write_bytes(data)
                self.rejected_without_writes("--scope", "project", message="marker")
        marker.unlink()
        outside = self.directory / "outside-marker.json"
        outside.write_bytes(valid)
        marker.symlink_to(outside)
        self.rejected_without_writes("--scope", "project", message="marker")

    def test_update_refuses_symlinked_backup_location_before_writes(self):
        self.registered("--scope", "project")
        outside = self.directory / "external-backups"
        outside.mkdir()
        (self.project / ".agents" / "skill-backups").symlink_to(
            outside, target_is_directory=True
        )
        self.change_source()
        self.rejected_without_writes("--scope", "project", message="symlink")

    def test_update_cannot_write_backups_into_its_source_bundle(self):
        self.registered("--scope", "project")
        relocated = self.project / ".agents" / "skill-backups" / NAME
        relocated.parent.mkdir()
        self.source.rename(relocated)
        self.source = relocated
        self.change_source()
        self.rejected_without_writes("--scope", "project", message="source")


if __name__ == "__main__":
    unittest.main()
