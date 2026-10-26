import json
import os
import signal
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest


RUNNER = Path(__file__).with_name('verify.py')


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        self.evidence = self.base / 'evidence'
        self.config = self.repo / 'verification.json'
        self.value = {'name': 'fixture', 'doctor': [[sys.executable, '-c', 'pass']],
                      'flows': {'flow': {'platform': 'cli', 'ownsStack': True,
                                        'commands': [[sys.executable, '-c', 'print("exercised")']]}}}

    def run_tool(self, *args):
        self.config.write_text(json.dumps(self.value))
        result = subprocess.run([sys.executable, str(RUNNER), '--config', str(self.config),
                                 '--root', str(self.repo), *args], capture_output=True, text=True,
                                env={**os.environ, 'DELIVERY_EVIDENCE_ROOT': str(self.evidence)}, timeout=15)
        return result.returncode, json.loads(result.stdout)

    def test_receipt_and_visual_artifacts_survive_failed_flow_and_stop(self):
        (self.repo / 'visual').mkdir()
        (self.repo / 'visual/stale.png').write_bytes(b'old run')
        self.value['flows']['flow'].update({'artifactPaths': ['visual'],
            'commands': [[sys.executable, '-c',
                'from pathlib import Path; Path("visual/frame.png").write_bytes(b"fixture"); raise SystemExit(3)']]})
        code, result = self.run_tool('run', 'flow')
        self.assertEqual(code, 1)
        receipt = Path(result['evidence'])
        self.assertEqual((receipt / 'artifacts/visual/frame.png').read_bytes(), b'fixture')
        self.assertFalse((receipt / 'artifacts/visual/stale.png').exists())
        self.assertEqual(json.loads((receipt / 'receipt.json').read_text())['commands'][0]['exitCode'], 3)
        self.run_tool('stop')
        self.assertTrue((receipt / 'receipt.json').exists())

    def test_failed_doctor_prevents_driving_shared_instance(self):
        self.value['doctor'] = [[sys.executable, '-c', 'raise SystemExit(1)']]
        self.value['flows']['flow']['ownsStack'] = False
        code, result = self.run_tool('run', 'flow')
        self.assertEqual(code, 1)
        receipt = json.loads((Path(result['evidence']) / 'receipt.json').read_text())
        self.assertEqual(len(receipt['commands']), 1)
        self.assertIn('Doctor failed', receipt['error'])

    def test_success_records_actual_flow_and_command(self):
        code, result = self.run_tool('run', 'flow')
        self.assertEqual(code, 0)
        receipt = json.loads((Path(result['evidence']) / 'receipt.json').read_text())
        self.assertEqual(receipt['platform'], 'cli')
        self.assertEqual(receipt['commands'][0]['exitCode'], 0)

    def test_stale_process_identity_never_signals_another_process(self):
        state = self.repo / 'tmp/verification'
        state.mkdir(parents=True)
        (state / 'owner.json').write_text(json.dumps({'pid': os.getpid(), 'birth': 'wrong',
                                                    'repository': str(self.repo)}))
        code, result = self.run_tool('stop')
        self.assertEqual(code, 1)
        self.assertIn('identity changed', result['error'])
        self.assertTrue((state / 'owner.json').exists())

    def test_foreign_repository_receipt_is_rejected_before_signaling(self):
        state = self.repo / 'tmp/verification'
        state.mkdir(parents=True)
        (state / 'owner.json').write_text(json.dumps({
            'pid': os.getpid(), 'birth': 'irrelevant', 'repository': '/another-repo'}))
        code, result = self.run_tool('stop')
        self.assertEqual(code, 1)
        self.assertIn('another repository', result['error'])

    def test_retention_error_fails_the_run(self):
        self.value['flows']['flow'].update({'artifactPaths': ['visual'], 'commands': [
            [sys.executable, '-c', 'from pathlib import Path; Path("visual").mkdir(); '
             'Path("visual/new.png").write_bytes(b"new"); '
             'Path("{evidence}/artifacts").write_text("blocks copy")']]})
        code, result = self.run_tool('run', 'flow')
        self.assertEqual(code, 1)
        self.assertEqual(result['status'], 'failed')
        receipt = json.loads((Path(result['evidence']) / 'receipt.json').read_text())
        self.assertEqual(receipt['commands'][0]['exitCode'], 0)

    def test_unchanged_future_dated_artifact_is_not_current_evidence(self):
        import time
        visual = self.repo / 'visual'
        visual.mkdir()
        old = visual / 'future.png'
        old.write_bytes(b'old image')
        os.utime(old, (time.time() + 1000, time.time() + 1000))
        self.value['flows']['flow'].update({'artifactPaths': ['visual'], 'requireMedia': True})
        code, result = self.run_tool('run', 'flow')
        self.assertEqual(code, 1)
        self.assertFalse((Path(result['evidence']) / 'artifacts/visual/future.png').exists())

    def test_touching_old_media_does_not_prove_a_new_capture(self):
        visual = self.repo / 'visual'
        visual.mkdir()
        (visual / 'old.png').write_bytes(b'old capture')
        self.value['flows']['flow'].update({'artifactPaths': ['visual'], 'requireMedia': True,
            'commands': [[sys.executable, '-c', 'from pathlib import Path; Path("visual/old.png").touch()']]})
        code, result = self.run_tool('run', 'flow')
        self.assertEqual(code, 1)
        self.assertFalse((Path(result['evidence']) / 'artifacts/visual/old.png').exists())

    def test_timeout_cleans_owned_command(self):
        self.value['flows']['flow'].update({'timeoutSeconds': 0.2,
            'commands': [[sys.executable, '-c', 'import time; time.sleep(30)']]})
        code, result = self.run_tool('run', 'flow')
        self.assertEqual(code, 1)
        receipt = json.loads((Path(result['evidence']) / 'receipt.json').read_text())
        self.assertEqual(receipt['commands'][0]['exitCode'], 124)

    def test_owned_start_rejects_duplicate_and_stop_preserves_evidence(self):
        self.value['start'] = [sys.executable, '-c', 'import time; time.sleep(30)']
        self.value['requireOwnedStack'] = True
        try:
            code, started = self.run_tool('start')
            self.assertEqual(code, 0)
            owner = self.repo / 'tmp/verification/owner.json'
            original = owner.read_text()
            self.assertEqual(self.run_tool('start')[0], 1)
            self.assertEqual(owner.read_text(), original)
            self.assertEqual(self.run_tool('doctor')[0], 0)
        finally:
            self.run_tool('stop')
        self.assertFalse(owner.exists())
        self.assertEqual(self.run_tool('doctor')[0], 1)
        self.assertTrue((Path(started['evidence']) / 'receipt.json').exists())

    def start_waiting_flow(self):
        pid_file = self.repo / 'flow.pid'
        self.value['flows']['flow']['commands'] = [[sys.executable, '-c',
            'import os,time; from pathlib import Path; '
            f'Path({str(pid_file)!r}).write_text(str(os.getpid())); time.sleep(30)']]
        self.config.write_text(json.dumps(self.value))
        runner = subprocess.Popen([sys.executable, str(RUNNER), '--config', str(self.config),
            '--root', str(self.repo), 'run', 'flow'], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, env={**os.environ, 'DELIVERY_EVIDENCE_ROOT': str(self.evidence)})
        def cleanup():
            if runner.poll() is None:
                runner.kill()
            runner.communicate(timeout=5)
            if pid_file.exists():
                try:
                    os.killpg(int(pid_file.read_text()), signal.SIGKILL)
                except ProcessLookupError:
                    pass
        self.addCleanup(cleanup)
        deadline = time.monotonic() + 5
        while not pid_file.exists() and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertTrue(pid_file.exists(), 'Fixture flow did not start')
        return runner, int(pid_file.read_text())

    def assert_not_running(self, pid):
        process = subprocess.run(['ps', '-p', str(pid), '-o', 'stat='], capture_output=True, text=True)
        self.assertTrue(process.returncode != 0 or process.stdout.strip().startswith('Z'))

    def test_sigterm_finalizes_receipt_and_stops_flow(self):
        runner, pid = self.start_waiting_flow()
        runner.terminate()
        stdout, stderr = runner.communicate(timeout=10)
        self.assertEqual(runner.returncode, 1, stderr)
        summary = json.loads(stdout)
        receipt = json.loads((Path(summary['evidence']) / 'receipt.json').read_text())
        self.assertIn('SIGTERM', receipt['error'])
        self.assertEqual(receipt['status'], 'failed')
        self.assert_not_running(pid)
        self.assertFalse((self.repo / 'tmp/verification/command-owner.json').exists())

    def test_force_loss_is_reconciled_before_another_flow_and_never_replayed(self):
        runner, pid = self.start_waiting_flow()
        runner.kill()
        runner.communicate(timeout=5)
        marker = self.repo / 'replayed'
        self.value['flows']['flow']['commands'] = [[sys.executable, '-c',
            'from pathlib import Path; Path("replayed").touch()']]
        code, summary = self.run_tool('run', 'flow')
        self.assertEqual(code, 1)
        self.assertIn('Recovered interrupted work', summary['error'])
        self.assertFalse(marker.exists())
        self.assert_not_running(pid)
        receipts = [json.loads(p.read_text()) for p in self.evidence.rglob('receipt.json')]
        self.assertTrue(any(r.get('cleanup') == 'verified after interruption' for r in receipts))

    def test_timeout_stops_descendant_even_after_group_leader_exits(self):
        child_file = self.repo / 'child.pid'
        parent_file = self.repo / 'parent.pid'
        worker = ('import os,signal,time; from pathlib import Path; '
            'signal.signal(signal.SIGTERM, signal.SIG_IGN); '
            f'Path({str(child_file)!r}).write_text(str(os.getpid())); time.sleep(30)')
        parent = ('import os,subprocess,sys,time; from pathlib import Path; '
            f'Path({str(parent_file)!r}).write_text(str(os.getpid())); '
            f'subprocess.Popen([sys.executable,"-c",{worker!r}]); time.sleep(30)')
        self.value['flows']['flow'].update({'timeoutSeconds': 1,
            'commands': [[sys.executable, '-c', parent]]})
        try:
            code, summary = self.run_tool('run', 'flow')
            self.assertEqual(code, 1)
            receipt = json.loads((Path(summary['evidence']) / 'receipt.json').read_text())
            self.assertEqual(receipt['commands'][0]['exitCode'], 124)
            self.assert_not_running(int(child_file.read_text()))
        finally:
            if parent_file.exists():
                try:
                    os.killpg(int(parent_file.read_text()), signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def test_changed_source_invalidates_success_but_artifact_output_does_not(self):
        self.value['flows']['flow'].update({'artifactPaths': ['visual'], 'commands': [[sys.executable, '-c',
            'from pathlib import Path; Path("source.txt").write_text("after")']]})
        self.config.write_text(json.dumps(self.value))
        (self.repo / 'source.txt').write_text('before')
        (self.repo / '.gitignore').write_text('tmp/\n')
        for argv in [['git', 'init', '-q'], ['git', 'add', '.'],
            ['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
             '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture']]:
            subprocess.run(argv, cwd=self.repo, check=True, capture_output=True)
        code, result = self.run_tool('run', 'flow')
        self.assertEqual(code, 1)
        receipt = json.loads((Path(result['evidence']) / 'receipt.json').read_text())
        self.assertTrue(receipt['stale'])
        self.assertNotEqual(receipt['revision'], receipt['revisionAfter'])
        self.value['flows']['flow']['commands'] = [[sys.executable, '-c',
            'from pathlib import Path; Path("visual").mkdir(); Path("visual/frame.png").write_bytes(b"new")']]
        self.assertEqual(self.run_tool('run', 'flow')[0], 0)

    def test_log_budget_fails_without_retaining_unbounded_output(self):
        self.value['limits'] = {'logBytes': 64}
        self.value['flows']['flow']['commands'] = [[sys.executable, '-c', 'print("x" * 100000)']]
        code, result = self.run_tool('run', 'flow')
        self.assertEqual(code, 1)
        self.assertIn('log exceeds', result['error'])
        self.assertLessEqual((Path(result['evidence']) / 'command-0.log').stat().st_size, 64)

    def test_artifact_budget_preserves_original_and_fails_collection(self):
        self.value['limits'] = {'artifactBytes': 1024}
        self.value['flows']['flow'].update({'artifactPaths': ['visual'], 'commands': [[sys.executable, '-c',
            'from pathlib import Path; Path("visual").mkdir(); Path("visual/frame.png").write_bytes(b"x" * 2048)']]})
        code, result = self.run_tool('run', 'flow')
        self.assertEqual(code, 1)
        self.assertEqual((self.repo / 'visual/frame.png').stat().st_size, 2048)
        self.assertFalse((Path(result['evidence']) / 'artifacts/visual/frame.png').exists())

    def test_native_fallback_is_blocked_before_driver_execution(self):
        self.value['flows']['flow'].update({'platform': 'native', 'commands': [[sys.executable, '-c',
            'from pathlib import Path; Path("drove-device").touch()']]})
        code, result = self.run_tool('run', 'flow')
        self.assertEqual(code, 1)
        self.assertIn('driver-enforced lease', result['error'])
        self.assertFalse((self.repo / 'drove-device').exists())

    def test_detached_output_writer_has_a_deadline_and_retains_uncertain_ownership(self):
        pid_file = self.repo / 'detached.pid'
        worker = ('import os,time; from pathlib import Path; '
            f'Path({str(pid_file)!r}).write_text(str(os.getpid())); time.sleep(30)')
        parent = ('import subprocess,sys; '
            f'subprocess.Popen([sys.executable,"-c",{worker!r}],start_new_session=True)')
        self.value['flows']['flow'].update({'timeoutSeconds': .5,
            'commands': [[sys.executable, '-c', parent]]})
        try:
            code, result = self.run_tool('run', 'flow')
            self.assertEqual(code, 1)
            self.assertIn('output stream remained open', result['error'])
            journal = self.repo / 'tmp/verification/command-owner.json'
            self.assertTrue(journal.exists())
            stop_code, stopped = self.run_tool('stop')
            self.assertEqual(stop_code, 1)
            self.assertIn('Cleanup quarantined', stopped['error'])
        finally:
            if pid_file.exists():
                try:
                    os.killpg(int(pid_file.read_text()), signal.SIGKILL)
                except ProcessLookupError:
                    pass


if __name__ == '__main__':
    unittest.main()
