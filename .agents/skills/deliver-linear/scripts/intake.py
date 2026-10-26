#!/usr/bin/env python3
"""Local execution receipts for signed, host-validated Linear events."""

import argparse
import json
from pathlib import Path
import sqlite3
import time
import uuid


def connect(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=15, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.executescript('''
        CREATE TABLE IF NOT EXISTS routes(id TEXT PRIMARY KEY, config TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, received REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS runs(
            id TEXT PRIMARY KEY, route TEXT NOT NULL, issue TEXT NOT NULL,
            transition TEXT NOT NULL, state TEXT NOT NULL, created REAL NOT NULL,
            receipts TEXT NOT NULL DEFAULT '{}', UNIQUE(issue, transition));
        CREATE UNIQUE INDEX IF NOT EXISTS one_issue ON runs(issue)
          WHERE state IN ('queued','reserved','working','review','blocked');
        CREATE UNIQUE INDEX IF NOT EXISTS one_repository ON runs(route)
          WHERE state IN ('reserved','working');
    ''')
    return db


def load(path):
    return json.loads(Path(path).read_text())


def routes(db):
    return [json.loads(row['config']) for row in db.execute('SELECT config FROM routes')]


def validate_route(value):
    required = ['id', 'repository', 'hostProjectId', 'integrationRef', 'teamId', 'states',
                'destination', 'verificationSkill', 'requiredReview']
    if any(not value.get(k) for k in required) or value['destination'] != 'pr':
        raise ValueError('A complete route with destination pr is required')
    base = value['integrationRef']
    if not isinstance(base, str) or base.startswith('-') or any(c.isspace() for c in base):
        raise ValueError('integrationRef must name an explicit non-option Git ref')
    if value['verificationSkill'] != '.agents/skills/verify/SKILL.md':
        raise ValueError('verificationSkill must be the committed project-local verify skill')
    if value['requiredReview'] != 'bugbot':
        raise ValueError('Only the configured bugbot review policy is supported')
    if any(not value['states'].get(k) for k in ['todo', 'active', 'review', 'blocked', 'done']):
        raise ValueError('All five status UUIDs are required')
    if not Path(value['repository']).is_absolute():
        raise ValueError('Repository path must be absolute')


def snapshot_matches(issue, route):
    return (issue['teamId'] == route['teamId']
            and (route.get('projectId') is None or issue.get('projectId') == route['projectId'])
            and issue['stateId'] == route['states']['todo'] and not issue.get('archivedAt'))


def resumable_snapshot(issue, route):
    return (issue['teamId'] == route['teamId']
            and (route.get('projectId') is None or issue.get('projectId') == route['projectId'])
            and issue['stateId'] in [route['states'][k] for k in ['todo', 'active', 'review', 'blocked']]
            and not issue.get('archivedAt'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--store', default='~/.local/share/delivery/linear.sqlite3')
    commands = parser.add_subparsers(dest='command', required=True)
    route = commands.add_parser('route')
    route.add_argument('--file', required=True)
    enqueue = commands.add_parser('enqueue')
    enqueue.add_argument('--event', required=True)
    enqueue.add_argument('--issue', required=True)
    enqueue.add_argument('--delivery', required=True)
    commands.add_parser('routes')
    next_job = commands.add_parser('next')
    next_job.add_argument('route')
    reserve = commands.add_parser('reserve')
    reserve.add_argument('run')
    reserve.add_argument('--issue', required=True)
    resume = commands.add_parser('resume')
    resume.add_argument('run')
    resume.add_argument('--issue', required=True)
    record = commands.add_parser('record')
    record.add_argument('run')
    record.add_argument('--thread', required=True)
    record.add_argument('--task')
    record.add_argument('--generation', required=True, type=int)
    finish = commands.add_parser('finish')
    finish.add_argument('run')
    finish.add_argument('state', choices=['review', 'blocked', 'done', 'canceled'])
    finish.add_argument('--generation', required=True, type=int)
    for field in ['pr', 'head', 'evidence']:
        finish.add_argument('--' + field)
    show = commands.add_parser('show')
    show.add_argument('run')
    args = parser.parse_args()
    db = connect(Path(args.store).expanduser())
    db.execute('BEGIN IMMEDIATE')
    result = {}
    try:
        if args.command == 'route':
            value = load(args.file)
            validate_route(value)
            value['repository'] = str(Path(value['repository']).resolve())
            for other in routes(db):
                if other['id'] == value['id']:
                    if other != value and db.execute(
                        "SELECT 1 FROM runs WHERE route=? AND state NOT IN ('done','canceled')",
                        (value['id'],)).fetchone():
                        raise ValueError('Reconcile unfinished runs before changing their route')
                    continue
                if str(Path(other['repository']).resolve()) == value['repository']:
                    raise ValueError('Repository already has a route')
                if other['teamId'] == value['teamId'] and (
                    not other.get('projectId') or not value.get('projectId')
                    or other['projectId'] == value['projectId']):
                    raise ValueError('Routes must not overlap')
            db.execute('INSERT OR REPLACE INTO routes VALUES (?,?)', (value['id'], json.dumps(value)))
            result = {'status': 'configured', 'route': value}
        elif args.command == 'routes':
            result = {'routes': routes(db)}
        elif args.command == 'enqueue':
            event, issue = load(args.event), load(args.issue)
            # The host checks signature and freshness at HTTP receipt, before agent queueing.
            if not isinstance(event.get('webhookTimestamp'), (int, float)):
                raise ValueError('Webhook timestamp is required')
            if db.execute('SELECT 1 FROM deliveries WHERE id=?', (args.delivery,)).fetchone():
                result = {'status': 'duplicate'}
            else:
                data = event['data']
                matches = [r for r in routes(db) if snapshot_matches(issue, r)]
                route = matches[0] if len(matches) == 1 else None
                enters = event['action'] == 'create' or (
                    event['action'] == 'update' and 'stateId' in event.get('updatedFrom', {})
                    and event['updatedFrom']['stateId'] != data.get('stateId'))
                if (event.get('type') != 'Issue' or not route or not enters
                    or data['id'] != issue['id'] or data.get('teamId') != issue['teamId']
                    or data.get('stateId') != route['states']['todo']):
                    result = {'status': 'ignored'}
                elif issue['blockedBy']:
                    result = {'status': 'blocked', 'dependencies': issue['blockedBy']}
                else:
                    run_id = str(uuid.uuid4())
                    transition = event['createdAt']
                    previous = db.execute(
                        "SELECT * FROM runs WHERE issue=? AND state IN ('review','blocked')",
                        (issue['id'],)).fetchone()
                    if previous and transition > previous['transition']:
                        db.execute("UPDATE runs SET state='canceled' WHERE id=?", (previous['id'],))
                    try:
                        db.execute('INSERT INTO runs(id,route,issue,transition,state,created) VALUES (?,?,?,?,?,?)',
                                   (run_id, route['id'], issue['id'], transition, 'queued', time.time()))
                        result = {'status': 'queued', 'runId': run_id, 'route': route['id']}
                    except sqlite3.IntegrityError:
                        result = {'status': 'already-owned'}
                db.execute('INSERT INTO deliveries VALUES (?,?)', (args.delivery, time.time()))
        elif args.command == 'next':
            row = db.execute("SELECT * FROM runs WHERE route=? AND state='queued' ORDER BY created LIMIT 1",
                             (args.route,)).fetchone()
            result = dict(row) if row else {'status': 'empty'}
        else:
            row = db.execute('SELECT * FROM runs WHERE id=?', (args.run,)).fetchone()
            if row is None:
                raise ValueError('Unknown run')
            result = dict(row)
            if args.command in ['reserve', 'resume']:
                issue = load(args.issue)
                route = next(r for r in routes(db) if r['id'] == row['route'])
                state = row['state']
                receipts = json.loads(row['receipts'])
                if issue['id'] != row['issue']:
                    raise ValueError('Snapshot belongs to another issue')
                if args.command == 'resume' and state in ['review', 'blocked']:
                    if not resumable_snapshot(issue, route) or issue['blockedBy']:
                        raise ValueError('Live issue is held, canceled, archived or blocked by dependencies')
                    history = receipts.get('history', [])
                    history.append({k: v for k, v in receipts.items() if k != 'history'})
                    receipts = {'history': history, 'generation': receipts.get('generation', 0) + 1,
                                'resuming': True}
                    db.execute("UPDATE runs SET state='queued',receipts=? WHERE id=?",
                               (json.dumps(receipts), args.run))
                    state = 'queued'
                if state != 'queued':
                    result['status'] = 'already-owned'
                elif not (resumable_snapshot(issue, route) if receipts.get('resuming')
                          else snapshot_matches(issue, route)) or issue['blockedBy']:
                    db.execute("UPDATE runs SET state='canceled' WHERE id=?", (args.run,))
                    result['status'] = 'stale-or-blocked'
                else:
                    validate_route(route)
                    try:
                        db.execute("UPDATE runs SET state='reserved' WHERE id=?", (args.run,))
                        result.update({'status': 'reserved', 'state': 'reserved', 'routeConfig': route,
                                       'receipts': receipts, 'generation': receipts.get('generation', 0)})
                    except sqlite3.IntegrityError:
                        result['status'] = 'repository-busy'
            elif args.command in ['record', 'finish']:
                receipts = json.loads(row['receipts'])
                if args.generation != receipts.get('generation', 0):
                    raise ValueError('Stale dispatch generation; refusing receipt mutation')
                if args.command == 'record':
                    if row['state'] not in ['reserved', 'working']:
                        raise ValueError('Only a reserved or working run can record dispatch')
                    receipts['thread'] = args.thread
                    if args.task:
                        if receipts.get('task') and receipts['task'] != args.task:
                            raise ValueError('Another worker already owns this dispatch generation')
                        receipts['task'] = args.task
                    state = 'working' if args.task else row['state']
                else:
                    if row['state'] not in ['reserved', 'working']:
                        raise ValueError('Reconcile a live claim before finishing')
                    state = args.state
                    receipts.update({k: getattr(args, k) for k in ['pr', 'head', 'evidence'] if getattr(args, k)})
                    if state in ['review', 'done'] and not all(receipts.get(k) for k in ['pr', 'head', 'evidence']):
                        raise ValueError('Review/done requires PR, tested head and retained evidence')
                db.execute('UPDATE runs SET state=?,receipts=? WHERE id=?',
                           (state, json.dumps(receipts), args.run))
                result.update({'state': state, 'receipts': receipts})
        db.execute('COMMIT')
    except Exception:
        db.execute('ROLLBACK')
        raise
    finally:
        db.close()
    print(json.dumps(result))


if __name__ == '__main__':
    main()
