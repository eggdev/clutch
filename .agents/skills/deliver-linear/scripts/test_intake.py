from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sqlite3
import sys
import tempfile
import time
import unittest


SCRIPT = Path(__file__).with_name('intake.py')


class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.route = {'id': 'app', 'repository': str(self.root / 'repo'),
                      'hostProjectId': 'host', 'integrationRef': 'origin/main', 'teamId': 'team', 'projectId': None,
                      'states': {'todo': 'todo', 'active': 'active', 'review': 'review',
                                 'blocked': 'blocked', 'done': 'done'},
                      'destination': 'pr', 'verificationSkill': '.agents/skills/verify/SKILL.md', 'requiredReview': 'bugbot'}
        self.issue = {'id': 'issue', 'teamId': 'team', 'projectId': None,
                      'stateId': 'todo', 'archivedAt': None, 'blockedBy': []}
        self.event = {'type': 'Issue', 'action': 'update', 'webhookTimestamp': time.time() * 1000,
                      'createdAt': '2026-10-24T16:00:00Z', 'data': dict(self.issue),
                      'updatedFrom': {'stateId': 'backlog'}}
        self.route_file = self.save('route.json', self.route)
        self.issue_file = self.save('issue.json', self.issue)
        self.event_file = self.save('event.json', self.event)
        self.call('route', '--file', self.route_file)

    def save(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value))
        return str(path)

    def call(self, *args):
        result = subprocess.run([sys.executable, str(SCRIPT), '--store', str(self.root / 'state.sqlite'),
                                 *args], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return json.loads(result.stdout)

    def enqueue(self, delivery='delivery'):
        return self.call('enqueue', '--event', self.event_file, '--issue', self.issue_file,
                         '--delivery', delivery)

    def test_duplicate_concurrent_delivery_creates_one_job(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.enqueue(), range(4)))
        self.assertEqual(sum(x['status'] == 'queued' for x in results), 1)
        self.assertEqual(sum(x['status'] == 'duplicate' for x in results), 3)

    def test_incomplete_or_unsupported_execution_contract_cannot_register(self):
        for field, value, error in [
            ('integrationRef', None, 'complete route'),
            ('integrationRef', '--wrong', 'explicit non-option'),
            ('verificationSkill', 'verify-app', 'project-local verify'),
            ('requiredReview', 'unknown', 'bugbot review policy'),
        ]:
            route = {**self.route, field: value}
            with self.assertRaisesRegex(RuntimeError, error):
                self.call('route', '--file', self.save('bad-route.json', route))

    def test_description_edit_and_wrong_team_do_not_dispatch(self):
        self.event['updatedFrom'] = {'description': 'old'}
        self.event_file = self.save('event.json', self.event)
        self.assertEqual(self.enqueue()['status'], 'ignored')
        self.issue['teamId'] = 'other'
        self.issue_file = self.save('issue.json', self.issue)
        self.assertEqual(self.enqueue('other')['status'], 'ignored')

    def test_agent_queue_delay_does_not_reject_host_verified_live_todo(self):
        self.event['webhookTimestamp'] = (time.time() - 180) * 1000
        self.event_file = self.save('event.json', self.event)
        self.assertEqual(self.enqueue()['status'], 'queued')

    def test_live_cancellation_prevents_reservation(self):
        run = self.enqueue()['runId']
        self.issue['stateId'] = 'canceled'
        self.issue_file = self.save('issue.json', self.issue)
        result = self.call('reserve', run, '--issue', self.issue_file)
        self.assertEqual(result['status'], 'stale-or-blocked')
        self.assertEqual(self.call('show', run)['state'], 'canceled')

    def test_persisted_legacy_route_cannot_bypass_dispatch_validation(self):
        run = self.enqueue()['runId']
        legacy = {k: v for k, v in self.route.items() if k != 'integrationRef'}
        with sqlite3.connect(self.root / 'state.sqlite') as db:
            db.execute('UPDATE routes SET config=? WHERE id=?', (json.dumps(legacy), self.route['id']))
        with self.assertRaisesRegex(RuntimeError, 'complete route'):
            self.call('reserve', run, '--issue', self.issue_file)
        self.assertEqual(self.call('show', run)['state'], 'queued')
        # A live cancellation can still reconcile the queued claim.
        self.issue['stateId'] = 'canceled'
        self.issue_file = self.save('canceled.json', self.issue)
        self.assertEqual(self.call('reserve', run, '--issue', self.issue_file)['status'], 'stale-or-blocked')

    def set_max_lanes(self, value):
        self.route['maxLanes'] = value
        self.call('route', '--file', self.save('route.json', self.route))

    def queue_issue(self, issue_id):
        issue = {**self.issue, 'id': issue_id}
        issue_file = self.save(f'{issue_id}.json', issue)
        event_file = self.save(f'{issue_id}-event.json', {**self.event, 'data': dict(issue)})
        queued = self.call('enqueue', '--event', event_file, '--issue', issue_file,
                           '--delivery', f'delivery-{issue_id}')
        self.assertEqual(queued['status'], 'queued')
        return queued['runId'], issue_file

    def reserve_issue(self, run, issue_file):
        return self.call('reserve', run, '--issue', issue_file)['status']

    def test_default_max_lanes_allows_three_runs_per_route(self):
        lanes = [self.queue_issue(issue_id) for issue_id in ['one', 'two', 'three', 'four']]
        self.assertEqual([self.reserve_issue(*lane) for lane in lanes[:3]], ['reserved'] * 3)
        self.assertEqual(self.reserve_issue(*lanes[3]), 'busy')
        self.assertEqual(self.call('show', lanes[3][0])['state'], 'queued')

    def test_max_lanes_two_reserves_two_issues_and_queues_the_third(self):
        self.set_max_lanes(2)
        first, second, third = (self.queue_issue(issue_id) for issue_id in ['one', 'two', 'three'])
        self.assertEqual([self.reserve_issue(*first), self.reserve_issue(*second)], ['reserved', 'reserved'])
        self.assertEqual(self.reserve_issue(*third), 'busy')
        self.assertEqual(self.call('show', third[0])['state'], 'queued')

    def test_max_lanes_one_keeps_one_run_per_repository_without_losing_queue(self):
        self.set_max_lanes(1)
        first, second = self.queue_issue('one'), self.queue_issue('two')
        self.assertEqual(self.reserve_issue(*first), 'reserved')
        self.assertEqual(self.reserve_issue(*second), 'busy')
        self.assertEqual(self.call('show', second[0])['state'], 'queued')
        self.call('finish', first[0], 'review', '--pr', 'https://example.test/pr/1',
                  '--head', 'sha', '--evidence', '/durable/receipt', '--generation', '0')
        self.assertEqual(self.reserve_issue(*second), 'reserved')

    def test_finished_or_canceled_runs_free_their_lane(self):
        self.set_max_lanes(1)
        first, second = self.queue_issue('one'), self.queue_issue('two')
        self.assertEqual(self.reserve_issue(*first), 'reserved')
        self.call('finish', first[0], 'canceled', '--generation', '0')
        self.assertEqual(self.reserve_issue(*second), 'reserved')

    def test_invalid_max_lanes_cannot_register(self):
        for value in [0, -1, 1.5, '2', True]:
            with self.subTest(value=value):
                self.route['maxLanes'] = value
                with self.assertRaisesRegex(RuntimeError, 'maxLanes must be a positive integer'):
                    self.call('route', '--file', self.save('bad-route.json', self.route))

    def test_existing_database_drops_the_one_repository_index(self):
        with sqlite3.connect(self.root / 'state.sqlite') as db:
            db.execute("CREATE UNIQUE INDEX one_repository ON runs(route) WHERE state IN ('reserved','working')")
        self.call('routes')
        with sqlite3.connect(self.root / 'state.sqlite') as db:
            indexes = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='index'")]
        self.assertNotIn('one_repository', indexes)
        self.assertEqual(self.reserve_issue(*self.queue_issue('one')), 'reserved')
        self.assertEqual(self.reserve_issue(*self.queue_issue('two')), 'reserved')

    def test_dependencies_block_and_replayed_transition_cannot_duplicate(self):
        self.issue['blockedBy'] = ['dependency']
        self.issue_file = self.save('issue.json', self.issue)
        self.assertEqual(self.enqueue()['status'], 'blocked')
        self.issue['blockedBy'] = []
        self.issue_file = self.save('issue.json', self.issue)
        self.assertEqual(self.enqueue('new')['status'], 'queued')
        self.assertEqual(self.enqueue('redelivery')['status'], 'already-owned')

    def test_new_todo_transition_can_reopen_finished_worker_without_duplicate_old_event(self):
        first = self.enqueue()['runId']
        self.call('reserve', first, '--issue', self.issue_file)
        self.call('finish', first, 'review', '--pr', 'https://example.test/pr/1',
                  '--head', 'sha', '--evidence', '/durable/receipt', '--generation', '0')
        self.assertEqual(self.enqueue('same-transition')['status'], 'already-owned')
        self.assertEqual(self.call('show', first)['state'], 'review')
        self.event['createdAt'] = '2026-10-24T16:01:00Z'
        self.event_file = self.save('event.json', self.event)
        self.assertEqual(self.enqueue('new-transition')['status'], 'queued')
        self.assertEqual(self.call('show', first)['state'], 'canceled')

    def test_repository_alias_cannot_register_second_execution_route(self):
        self.route['id'] = 'alias'
        self.route['teamId'] = 'another-team'
        self.route['repository'] += '/.'
        self.route_file = self.save('alias.json', self.route)
        with self.assertRaisesRegex(RuntimeError, 'already has a route'):
            self.call('route', '--file', self.route_file)

    def test_review_fixes_resume_with_preserved_receipts_and_new_generation(self):
        run = self.enqueue()['runId']
        self.call('reserve', run, '--issue', self.issue_file)
        self.call('record', run, '--thread', 'parent', '--task', 'worker-0', '--generation', '0')
        self.call('finish', run, 'review', '--pr', 'https://example.test/pr/1',
                  '--head', 'old-sha', '--evidence', '/durable/first', '--generation', '0')
        self.issue['stateId'] = 'review'
        self.issue_file = self.save('issue.json', self.issue)
        resumed = self.call('resume', run, '--issue', self.issue_file)
        self.assertEqual(resumed['status'], 'reserved')
        self.assertEqual(resumed['generation'], 1)
        self.assertEqual(resumed['receipts']['history'][0]['task'], 'worker-0')
        self.call('record', run, '--thread', 'parent', '--task', 'worker-1', '--generation', '1')
        with self.assertRaisesRegex(RuntimeError, 'Stale dispatch generation'):
            self.call('finish', run, 'review', '--pr', 'https://example.test/old',
                      '--head', 'old-sha', '--evidence', '/old', '--generation', '0')
        self.assertEqual(self.call('show', run)['state'], 'working')
        self.assertEqual(self.call('resume', run, '--issue', self.issue_file)['status'], 'already-owned')


if __name__ == '__main__':
    unittest.main()
