#!/usr/bin/env python3
"""Project verification runner: owned commands, revision-aware durable receipts."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import time
import uuid

from evidence import artifact_snapshot, below, digest, revision
from processes import command, identity, recover, spawn_owned, terminate, write_json


def budget(config, key, default):
    value = config.get('limits', {}).get(key, default)
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError(f'{key} must be a positive integer byte limit')
    return value


def doctor(config, root, destination, execution):
    if config.get('requireOwnedStack', False):
        owner_file = below(root, config.get('stateDir', 'tmp/verification')) / 'owner.json'
        if not owner_file.exists():
            raise RuntimeError('No owned stack receipt; inspect existing processes before starting or adopting')
        owner = json.loads(owner_file.read_text())
        if owner['repository'] != str(root) or not owner['birth'] or identity(owner['pid']) != owner['birth']:
            raise RuntimeError('Owned stack is not running from this repository')
    checks = config.get('doctor', [])
    if not checks:
        raise ValueError('No doctor command configured')
    results = []
    for index, argv in enumerate(checks):
        log = destination / f'doctor-{index}.log'
        result = {'command': argv, 'exitCode': None, 'log': str(log)}
        results.append(result)
        result['exitCode'] = command(argv, root, log, 30, execution, budget(config, 'logBytes', 8 * 1024 * 1024))
    return results


def interrupted(signum, _frame):
    # A second shutdown signal must not interrupt owned cleanup.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    raise RuntimeError(f'Interrupted by {signal.Signals(signum).name}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--root', default='.')
    parser.add_argument('action', choices=['doctor', 'start', 'run', 'stop'])
    parser.add_argument('flow', nargs='?')
    args = parser.parse_args()
    root = Path(args.root).resolve()
    config = json.loads(Path(args.config).read_text())
    name = config['name']
    if not name or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in name):
        raise ValueError('Use a lowercase project slug')
    state = below(root, config.get('stateDir', 'tmp/verification'))
    state.mkdir(parents=True, exist_ok=True)
    receipt_root = Path(os.environ.get('DELIVERY_EVIDENCE_ROOT',
                                      '~/.local/share/delivery/evidence')).expanduser().resolve()
    if receipt_root.is_relative_to(root):
        raise ValueError('Evidence must survive worktree removal; choose a directory outside the repo')
    receipt = receipt_root / name / f'{time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())}-{uuid.uuid4().hex[:8]}'
    receipt.mkdir(parents=True, mode=0o700)
    flow = config.get('flows', {}).get(args.flow, {})
    exclusions = [str(state.relative_to(root)), *flow.get('artifactPaths', [])]
    for excluded in exclusions:
        below(root, excluded)
    run = {'repository': str(root), 'action': args.action, 'flow': args.flow,
           'startedAt': time.time(), 'status': 'running', 'commands': [], 'cleanup': 'not required'}
    owner_file = state / 'owner.json'
    execution = state / 'command-owner.json'
    with (state / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGINT, interrupted)
        run.update({'startedAt': time.time(), 'revision': revision(root, exclusions)})
        write_json(receipt / 'receipt.json', run)
        try:
            recovered = recover(execution, root)
            if recovered and args.action in ['run', 'start']:
                raise RuntimeError('Recovered interrupted work; inspect its receipt before a new attempt')
            if args.action == 'stop':
                if owner_file.exists():
                    owner = json.loads(owner_file.read_text())
                    if owner['repository'] != str(root):
                        raise RuntimeError('Ownership receipt belongs to another repository; refusing to signal it')
                    terminate(owner['pid'], owner['birth'], owner.get('members'))
                    owner_file.unlink()
                run.update({'status': 'passed', 'cleanup': 'verified'})
            elif args.action == 'start':
                if owner_file.exists():
                    owner = json.loads(owner_file.read_text())
                    if identity(owner['pid']):
                        raise RuntimeError('An owned stack exists; doctor it instead of starting a second')
                    # Refuse to discard uncertain descendant ownership.
                    terminate(owner['pid'], owner['birth'], owner.get('members'))
                    owner_file.unlink()
                argv = config.get('start')
                if not isinstance(argv, list) or not argv or not all(isinstance(x, str) for x in argv):
                    raise ValueError('This project has no managed start command')
                with (receipt / 'server.log').open('wb') as output:
                    child, owner = spawn_owned(argv, root, output, owner_file, receipt / 'server.log')
                try:
                    owner['revision'] = run['revision']
                    write_json(owner_file, owner)
                    deadline = time.monotonic() + config.get('startupSeconds', 180)
                    while time.monotonic() < deadline:
                        if child.poll() is not None:
                            raise RuntimeError(f'Start exited {child.returncode}; read {owner["log"]}')
                        if (receipt / 'server.log').stat().st_size > budget(config, 'logBytes', 8 * 1024 * 1024):
                            raise RuntimeError('Startup log exceeds configured limit')
                        run['commands'] = doctor(config, root, receipt, execution)
                        if all(x['exitCode'] == 0 for x in run['commands']):
                            run.update({'status': 'passed', 'cleanup': 'explicitly held by start'})
                            break
                        time.sleep(1)
                    else:
                        raise RuntimeError('Startup doctor did not pass before its deadline')
                except BaseException:
                    terminate(child.pid, owner['birth'])
                    child.wait()
                    owner_file.unlink(missing_ok=True)
                    raise
            elif args.action == 'doctor':
                run['commands'] = doctor(config, root, receipt, execution)
                run['status'] = 'passed' if all(x['exitCode'] == 0 for x in run['commands']) else 'failed'
                if owner_file.exists():
                    run['owner'] = json.loads(owner_file.read_text())
            else:
                if not flow:
                    raise ValueError('Unknown flow; select a configured flow')
                if flow['platform'] in ['native', 'ios', 'android']:
                    raise RuntimeError('Native flows require the shared driver-enforced lease; this fallback cannot grant it')
                run.update({'platform': flow['platform'], 'role': flow.get('role', 'unspecified')})
                baseline = artifact_snapshot(root, flow.get('artifactPaths', []))
                if not flow.get('ownsStack', False):
                    run['commands'] = doctor(config, root, receipt, execution)
                    if any(x['exitCode'] for x in run['commands']):
                        raise RuntimeError('Doctor failed; inspect the instance before driving it')
                if not flow.get('commands'):
                    raise ValueError('A flow needs at least one executable command')
                try:
                    for index, argv in enumerate(flow['commands']):
                        argv = [x.replace('{evidence}', str(receipt)) for x in argv]
                        log = receipt / f'command-{index}.log'
                        result = {'command': argv, 'exitCode': None, 'log': str(log)}
                        run['commands'].append(result)
                        result['exitCode'] = command(argv, root, log, flow.get('timeoutSeconds', 600),
                                                     execution, budget(config, 'logBytes', 8 * 1024 * 1024))
                        if result['exitCode']:
                            raise RuntimeError(f'Command failed with exit {result["exitCode"]}; read {log}')
                    run['status'] = 'passed'
                finally:
                    total = 0
                    for filename, fingerprint in artifact_snapshot(root, flow.get('artifactPaths', [])).items():
                        if baseline.get(filename) != fingerprint:
                            artifact = Path(filename)
                            total += artifact.stat().st_size
                            if total > budget(config, 'artifactBytes', 64 * 1024 * 1024):
                                raise RuntimeError('Artifact collection exceeds configured byte limit; originals preserved')
                            destination = receipt / 'artifacts' / artifact.relative_to(root)
                            destination.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(artifact, destination)
        except Exception as error:
            run.update({'status': 'failed', 'error': str(error)})
        finally:
            if execution.exists() and run.get('error', '').startswith('Interrupted by '):
                try:
                    recover(execution, root)
                except Exception as error:
                    run['error'] += f'; cleanup unverified: {error}'
            run['finishedAt'] = time.time()
            run['revisionAfter'] = revision(root, exclusions)
            run['stale'] = run['revision'] != run['revisionAfter']
            if run['stale'] and run['status'] == 'passed':
                run.update({'status': 'failed', 'error': 'Source changed during verification; evidence is stale'})
            if execution.exists():
                run['cleanup'] = 'unverified; command ownership retained'
                run['status'] = 'failed'
            elif args.action == 'run':
                run['cleanup'] = 'verified for runner-owned commands; flow owns fixture cleanup'
            if args.action == 'start' and run['status'] == 'failed' and owner_file.exists():
                owner = json.loads(owner_file.read_text())
                if owner.get('log') == str(receipt / 'server.log'):
                    try:
                        terminate(owner['pid'], owner['birth'], owner.get('members'))
                        owner_file.unlink()
                        run['cleanup'] = 'verified'
                    except Exception as error:
                        run['cleanup'] = f'unverified; startup ownership retained: {error}'
            run['media'] = [{'path': str(p.relative_to(receipt)), 'bytes': p.stat().st_size,
                             'sha256': digest(p)}
                            for p in receipt.rglob('*') if p.is_file()
                            and p.suffix.lower() in ['.png', '.jpg', '.jpeg', '.webm', '.mp4']]
            if args.action == 'run' and flow.get('requireMedia') and not run['media']:
                run.update({'status': 'failed', 'error': run.get('error', 'No media artifacts from this run')})
            total = sum(p.stat().st_size for p in receipt.rglob('*') if p.is_file())
            if total > budget(config, 'artifactBytes', 64 * 1024 * 1024):
                run.update({'status': 'failed', 'error': 'Evidence exceeds configured byte limit; files preserved'})
            write_json(receipt / 'receipt.json', run)
    print(json.dumps({'status': run['status'], 'evidence': str(receipt), 'error': run.get('error')}))
    return 0 if run['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
