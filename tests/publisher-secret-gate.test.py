"""Publisher scan contracts using exact selected fields and a mocked scanner."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import tomllib
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test-results/publisher-secret-gate"
OUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location("publisher_gate", ROOT / "tools/publisher-secret-gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
FIELDS = {}
for path in sorted({r["path"] for r in gate.PUBLISHER_RULES}):
    wanted = {(r["record_id"], r["field"]): r["field_sha256"] for r in gate.PUBLISHER_RULES if r["path"] == path}
    owner = None
    primary = path in ("data/stig-rules.json", "data/srg-requirements.json")
    owner_pattern = r'^      "id": "(V-[0-9]+)",' if primary else r'^\s*"(V-[0-9]+)"\s*:\s*\['
    indent = 6 if primary else 8
    with (ROOT / path).open(encoding="utf-8") as source:
        for line in source:
            found = re.match(owner_pattern, line)
            if found:
                owner = found.group(1)
            found = re.match(r'^ {' + str(indent) + r'}"(description|check_text|fix_text)": ', line)
            if not found or (owner, found.group(1)) not in wanted:
                continue
            field = found.group(1)
            value = json.loads("{" + line.strip().rstrip(",") + "}")[field]
            if hashlib.sha256(value.encode()).hexdigest() == wanted[(owner, field)]:
                FIELDS[(path, owner, field)] = value
    if any((path, owner, field) not in FIELDS for owner, field in wanted):
        raise ValueError("A reviewed publisher field is missing or changed")

DOCS = {}
for path in sorted({key[0] for key in FIELDS}):
    records = {}
    for (p, owner, field), value in FIELDS.items():
        if p == path:
            records.setdefault(owner, {"id": owner})[field] = value
    DOCS[path] = {"records": list(records.values())} if path != "data/curated/disa/stig-previous-editions.json" else {"records": {owner: [record] for owner, record in records.items()}}
RAW = {path: (json.dumps(doc, ensure_ascii=False, indent=2) + "\n").encode() for path, doc in DOCS.items()}
FINDINGS = []
for rule in gate.PUBLISHER_RULES:
    primary = rule["path"] in ("data/stig-rules.json", "data/srg-requirements.json")
    owner = None
    for number, line in enumerate(RAW[rule["path"]].decode().splitlines(), 1):
        found = re.match(r'^      "id": "(V-[0-9]+)",' if primary else r'^\s*"(V-[0-9]+)"\s*:\s*\[', line)
        if found:
            owner = found.group(1)
        if owner == rule["record_id"] and line.lstrip().startswith('"' + rule["field"] + '":'):
            FINDINGS.append({"File": rule["path"], "RuleID": rule["RuleID"], "StartLine": number, "EndLine": number, "StartColumn": rule["StartColumn"], "EndColumn": rule["EndColumn"]})
            break
    else:
        raise ValueError("Fixture native field unavailable")
assert len(FINDINGS) == 49 and len(FIELDS) == 30
POLICY = b"""title = "Test scanner policy"
[extend]
useDefault = true
[allowlist]
paths = [
  '''data/stig-rules\\.json''',
  '''data/srg-requirements\\.json''',
  '''data/generated/graph-data/.*\\.json''',
]
regexes = ['''^public-telemetry$''']
"""


def git_bytes(cwd, *args):
    if args[0] == "config":
        return b"https://github.com/RAMBULLS/control-atlas.git\n"
    if args[0] != "show":
        raise ValueError("Unexpected Git operation")
    return RAW[args[1].split(":", 1)[1]]


class NativeFieldTests(unittest.TestCase):
    def setUp(self):
        self.patch = mock.patch.object(gate, "_git_bytes", side_effect=git_bytes)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_all_49_exact_signatures_snapshot(self):
        self.assertTrue(gate.publisher_findings_allowed(FINDINGS, ["dir", "."]))

    def test_all_49_exact_signatures_history(self):
        self.assertTrue(gate.publisher_findings_allowed([{**f, "Commit": "1" * 40} for f in FINDINGS], ["git", "."]))

    def test_stdin_never_receives_dispositions(self):
        self.assertFalse(gate.publisher_findings_allowed(FINDINGS, ["stdin"]))

    def test_unrelated_repository_held(self):
        gate._git_bytes.side_effect = lambda cwd, *args: b"https://github.com/example/other.git" if args[0] == "config" else git_bytes(cwd, *args)
        self.assertFalse(gate.publisher_findings_allowed(FINDINGS, ["dir", "."]))

    def test_unreviewed_finding_blocks_entire_set(self):
        self.assertFalse(gate.publisher_findings_allowed([*FINDINGS, {**FINDINGS[0], "RuleID": "github-oauth"}], ["dir", "."]))

    def test_changed_columns_held(self):
        self.assertFalse(gate.publisher_findings_allowed([{**FINDINGS[0], "StartColumn": FINDINGS[0]["StartColumn"] + 1}], ["dir", "."]))

    def test_boolean_coordinate_held(self):
        self.assertFalse(gate.publisher_findings_allowed([{**FINDINGS[0], "StartLine": True}], ["dir", "."]))

    def test_multiline_finding_held(self):
        self.assertFalse(gate.publisher_findings_allowed([{**FINDINGS[0], "EndLine": FINDINGS[0]["EndLine"] + 1}], ["dir", "."]))

    def test_unreviewed_path_held(self):
        self.assertFalse(gate.publisher_findings_allowed([{**FINDINGS[0], "File": "data/other.json"}], ["dir", "."]))

    def test_history_requires_full_commit(self):
        self.assertFalse(gate.publisher_findings_allowed([{**FINDINGS[0], "Commit": "1234"}], ["git", "."]))
        self.assertFalse(gate.publisher_findings_allowed(FINDINGS, ["git", "."]))

    def test_changed_field_held(self):
        path = "data/srg-requirements.json"
        changed = copy.deepcopy(DOCS[path])
        changed["records"][0]["check_text"] += " changed"
        gate._git_bytes.side_effect = lambda cwd, *args: json.dumps(changed, indent=2).encode() if args[0] == "show" and args[1].endswith(path) else git_bytes(cwd, *args)
        self.assertFalse(gate.publisher_findings_allowed([f for f in FINDINGS if f["File"] == path], ["dir", "."]))

    def test_duplicate_native_id_held(self):
        path = "data/srg-requirements.json"
        changed = copy.deepcopy(DOCS[path])
        changed["records"].append(copy.deepcopy(changed["records"][0]))
        gate._git_bytes.side_effect = lambda cwd, *args: json.dumps(changed, indent=2).encode() if args[0] == "show" and args[1].endswith(path) else git_bytes(cwd, *args)
        self.assertFalse(gate.publisher_findings_allowed([f for f in FINDINGS if f["File"] == path], ["dir", "."]))

    def test_duplicate_json_key_held(self):
        self.assertRaises(ValueError, gate._unique, [("records", []), ("records", [])])

    def test_wrong_native_owner_held(self):
        path = "data/srg-requirements.json"
        altered = RAW[path].replace(b'"V-274847"', b'"V-999999"')
        gate._git_bytes.side_effect = lambda cwd, *args: altered if args[0] == "show" and args[1].endswith(path) else git_bytes(cwd, *args)
        self.assertFalse(gate.publisher_findings_allowed([f for f in FINDINGS if f["File"] == path], ["dir", "."]))

    def test_empty_or_unknown_scan_mode_held(self):
        self.assertFalse(gate.publisher_findings_allowed([], ["dir", "."]))
        self.assertFalse(gate.publisher_findings_allowed(FINDINGS, ["unknown", "."]))


def sarif_result(finding, history=False):
    result = {"ruleId": finding["RuleID"], "locations": [{"physicalLocation": {"artifactLocation": {"uri": finding["File"]}, "region": {"startLine": finding["StartLine"], "endLine": finding["EndLine"], "startColumn": finding["StartColumn"], "endColumn": finding["EndColumn"]}}}]}
    if history:
        result["partialFingerprints"] = {"commitSha": "1" * 40}
    return result


class ScanReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="portable-gate-test-", dir=OUT)
        self.cwd = Path(self.temp.name).resolve()
        self.assertTrue(self.cwd.is_relative_to(OUT.resolve()))
        self.addCleanup(self.temp.cleanup)
        (self.cwd / ".gitleaks.toml").write_bytes(POLICY)
        (self.cwd / "gitleaks").write_bytes(b"test binary\n")
        for path, raw in RAW.items():
            destination = self.cwd / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)
        self.report = {"runs": [{"results": [sarif_result(f) for f in FINDINGS]}]}
        self.scan_exit = 1
        self.version = b"8.24.3\n"
        self.scanner_after = lambda: None
        self.patchers = [
            mock.patch.object(gate, "_git_bytes", side_effect=git_bytes),
            mock.patch.object(gate, "REPO_CONFIG_SHA", hashlib.sha256(POLICY).hexdigest()),
            mock.patch.object(gate.subprocess, "run", side_effect=self.run_process),
        ]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_process(self, args, **kwargs):
        if args[1] == "version":
            return types.SimpleNamespace(returncode=0, stdout=self.version)
        path = next(arg.split("=", 1)[1] for arg in args if arg.startswith("--report-path="))
        config_path = next(arg.split("=", 1)[1] for arg in args if arg.startswith("--config="))
        self.effective_policy = Path(config_path).read_bytes()
        (self.cwd / path).write_text(json.dumps(self.report), encoding="utf-8")
        self.scanner_after()
        return types.SimpleNamespace(returncode=self.scan_exit, stdout=b"", stderr=b"")

    def run_gate(self, mode="snapshot"):
        return gate.scan_report(mode, "results.sarif" if mode == "snapshot" else "history-results.sarif", self.cwd)

    def test_snapshot_accepts_exact_and_retains_all_results(self):
        self.assertEqual(self.run_gate(), 0)
        results = json.loads((self.cwd / "results.sarif").read_text())["runs"][0]["results"]
        self.assertEqual(len(results), 49)
        self.assertTrue(all(r["suppressions"][0]["kind"] == "external" for r in results))
        # Each source is read before/after scanning and parsed once for all its
        # findings, rather than reparsing the same large blob for every match.
        shows = sum(call.args[1] == "show" for call in gate._git_bytes.call_args_list)
        self.assertEqual(shows, 3 * len(RAW))

    def test_history_resolves_each_commit(self):
        self.report["runs"][0]["results"] = [sarif_result(f, history=True) for f in FINDINGS]
        self.assertEqual(self.run_gate("history"), 0)

    def test_snapshot_scans_primary_sources_without_altering_other_policy(self):
        self.assertEqual(self.run_gate(), 0)
        before = tomllib.loads(POLICY.decode())
        after = tomllib.loads(self.effective_policy.decode())
        expected = copy.deepcopy(before)
        expected["allowlist"]["paths"] = [r"data/generated/graph-data/.*\.json"]
        self.assertEqual(after, expected)
        self.assertEqual((self.cwd / ".gitleaks.toml").read_bytes(), POLICY)
        self.assertFalse(any(self.cwd.glob(".publisher-snapshot-*")))

    def test_history_keeps_existing_policy_scope(self):
        self.report["runs"][0]["results"] = [sarif_result(f, history=True) for f in FINDINGS]
        self.assertEqual(self.run_gate("history"), 0)
        self.assertEqual(self.effective_policy, POLICY)

    def test_unapproved_result_still_fails_and_remains_visible(self):
        self.report["runs"][0]["results"].append({**sarif_result(FINDINGS[0]), "ruleId": "github-oauth", "suppressions": [{"kind": "external"}]})
        self.assertEqual(self.run_gate(), 1)
        results = json.loads((self.cwd / "results.sarif").read_text())["runs"][0]["results"]
        self.assertEqual(len(results), 50)
        self.assertNotIn("suppressions", results[-1])

    def test_clean_report_requires_success_exit(self):
        self.report = {"runs": [{"results": []}]}
        self.scan_exit = 0
        self.assertEqual(self.run_gate(), 0)

    def test_exit_report_disagreement_held(self):
        self.scan_exit = 0
        self.assertRaises(ValueError, self.run_gate)

    def test_scanner_error_held(self):
        self.scan_exit = 2
        self.assertRaises(ValueError, self.run_gate)

    def test_changed_config_held(self):
        (self.cwd / ".gitleaks.toml").write_bytes(b"changed policy\n")
        self.assertRaises(ValueError, self.run_gate)

    def test_wrong_binary_version_held(self):
        self.version = b"9.0.0\n"
        self.assertRaises(ValueError, self.run_gate)

    def test_dirty_source_snapshot_held(self):
        path = self.cwd / "data/srg-requirements.json"
        path.write_bytes(path.read_bytes() + b"\n")
        self.assertRaises(ValueError, self.run_gate)

    def test_source_changed_during_scan_held(self):
        self.scanner_after = lambda: (self.cwd / "data/srg-requirements.json").write_bytes(b"changed")
        self.assertRaises(ValueError, self.run_gate)

    def test_unknown_report_path_held(self):
        self.assertRaises(ValueError, gate.scan_report, "snapshot", "../results.sarif", self.cwd)

    def test_history_missing_commit_held(self):
        self.assertEqual(self.run_gate("history"), 1)

    def test_multiple_locations_held(self):
        result = self.report["runs"][0]["results"][0]
        result["locations"].append(copy.deepcopy(result["locations"][0]))
        self.assertEqual(self.run_gate(), 1)


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(__import__(__name__)))
    summary = {"tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors), "signatures": len(FINDINGS), "fields": len(FIELDS), "passed": result.wasSuccessful()}
    (OUT / "portable-secret-gate-candidate-tests.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    raise SystemExit(0 if result.wasSuccessful() else 1)
