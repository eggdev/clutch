"""Owned process-group execution and bounded command output."""

import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time


def write_json(path, value):
    temporary = path.with_suffix('.new')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def identity(pid):
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart='], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ''


def members(pgid):
    found = subprocess.run(['pgrep', '-g', str(pgid)], capture_output=True, text=True)
    if found.returncode == 1:
        return {}
    if found.returncode:
        raise RuntimeError('Cannot inspect owned process group')
    result = subprocess.run(['ps', '-p', ','.join(found.stdout.split()), '-o', 'pid=,stat=,lstart='],
                            capture_output=True, text=True)
    live = {}
    for line in result.stdout.splitlines():
        pid, state, birth = line.strip().split(None, 2)
        if not state.startswith('Z'):
            live[int(pid)] = birth
    return live


def terminate(pid, birth, known=None):
    actual = identity(pid)
    if actual and actual != birth:
        raise RuntimeError('Process identity changed; refusing to signal it')
    owned = {int(k): v for k, v in (known or {pid: birth}).items()}
    for sig in [signal.SIGTERM, signal.SIGKILL]:
        remaining = members(pid)
        if not remaining:
            return
        if not birth or not any(owned.get(p) == b for p, b in remaining.items()):
            raise RuntimeError('Process group ownership uncertain; cleanup quarantined')
        owned.update(remaining)
        try:
            os.killpg(pid, sig)
        except ProcessLookupError:
            if not members(pid):
                return
            raise RuntimeError('Owned process group changed during cleanup')
        for _ in range(20):
            remaining = members(pid)
            if not remaining:
                return
            if not any(owned.get(p) == b for p, b in remaining.items()):
                raise RuntimeError('Process group ownership changed; cleanup quarantined')
            owned.update(remaining)
            time.sleep(.05)
    raise RuntimeError('Owned process group did not stop; cleanup quarantined')


def recover(execution, root):
    if not execution.exists():
        return False
    owner = json.loads(execution.read_text())
    if owner['repository'] != str(root):
        raise RuntimeError('Interrupted command belongs to another repository')
    if owner.get('uncertain'):
        raise RuntimeError(f'Cleanup quarantined; inspect retained ownership: {owner["uncertain"]}')
    terminate(owner['pid'], owner['birth'], owner['members'])
    receipt = Path(owner['log']).parent / 'receipt.json'
    value = json.loads(receipt.read_text())
    value.update({'status': 'failed', 'error': 'Runner interrupted; inspect state before a new attempt',
                  'finishedAt': time.time(), 'cleanup': 'verified after interruption'})
    write_json(receipt, value)
    execution.unlink()
    return True


# The child waits on this gate until its ownership record is saved, then execs
# the command in place, so the pid and birth time stay the same. A runner that
# dies before it opens the gate closes the pipe, and the child exits 125 without
# running the command. No flow can run that no record owns.
GATE = (
    'import os, sys\n'
    'gate = int(sys.argv[1])\n'
    'if os.read(gate, 1) != b"g":\n'
    '    sys.exit(125)\n'
    'os.close(gate)\n'
    'try:\n'
    '    os.execvp(sys.argv[2], sys.argv[2:])\n'
    'except OSError as error:\n'
    '    print(f"Cannot run {sys.argv[2]}: {error}", flush=True)\n'
    '    sys.exit(127)\n'
)


def spawn_owned(argv, root, stdout, record, log):
    blocked = {signal.SIGTERM, signal.SIGINT}
    previous = signal.pthread_sigmask(signal.SIG_BLOCK, blocked)
    child = None
    owner = None
    gate_read, gate_write = os.pipe()
    try:
        try:
            child = subprocess.Popen([sys.executable, '-c', GATE, str(gate_read), *argv], cwd=root,
                stdin=subprocess.DEVNULL, stdout=stdout, stderr=subprocess.STDOUT, start_new_session=True,
                pass_fds=(gate_read,), preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, previous))
        finally:
            os.close(gate_read)
        birth = identity(child.pid)
        owner = {'pid': child.pid, 'birth': birth, 'repository': str(root),
                 'members': {child.pid: birth}, 'log': str(log), 'command': argv}
        write_json(record, owner)
        os.write(gate_write, b'g')
        # Pending graceful termination is delivered inside this cleanup scope.
        signal.pthread_sigmask(signal.SIG_SETMASK, previous)
        return child, owner
    except BaseException:
        if child is not None:
            terminate(child.pid, owner['birth'] if owner else identity(child.pid))
            child.wait()
            record.unlink(missing_ok=True)
            if child.stdout is not None:
                child.stdout.close()
        raise
    finally:
        os.close(gate_write)
        signal.pthread_sigmask(signal.SIG_SETMASK, previous)


def command(argv, root, log, timeout, execution, max_bytes):
    if not isinstance(argv, list) or not argv or not all(isinstance(x, str) for x in argv):
        raise ValueError('Commands must be nonempty arrays of strings')
    if not isinstance(timeout, (int, float)) or timeout <= 0:
        raise ValueError('Command timeout must be positive')
    child, owner = spawn_owned(argv, root, subprocess.PIPE, execution, log)
    deadline = time.monotonic() + timeout
    timed_out = False
    cleaned = False
    try:
        with log.open('wb') as output, selectors.DefaultSelector() as stream:
            stream.register(child.stdout, selectors.EVENT_READ)
            written = 0
            while stream.get_map():
                for key, _ in stream.select(.05):
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        stream.unregister(key.fileobj)
                        continue
                    available = max_bytes - written
                    output.write(chunk[:available])
                    written += min(len(chunk), available)
                    if len(chunk) > available:
                        raise RuntimeError(f'Command log exceeds {max_bytes} bytes')
                current = members(child.pid)
                known = {int(k): v for k, v in owner['members'].items()}
                if current and any(known.get(p) == b for p, b in current.items()):
                    if any(known.get(p) != b for p, b in current.items()):
                        known.update(current)
                        owner['members'] = known
                        write_json(execution, owner)
                if child.poll() is not None:
                    terminate(child.pid, owner['birth'], owner['members'])
                    cleaned = True
                    if stream.get_map() and time.monotonic() >= deadline:
                        owner['uncertain'] = 'Command exited but its output stream remained open beyond the deadline'
                        write_json(execution, owner)
                        raise RuntimeError(owner['uncertain'])
                elif time.monotonic() >= deadline:
                    timed_out = True
                    terminate(child.pid, owner['birth'], owner['members'])
                    cleaned = True
            # A command may close stdout before it exits.
            if child.poll() is None:
                try:
                    child.wait(timeout=max(0, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    timed_out = True
            if not cleaned:
                terminate(child.pid, owner['birth'], owner['members'])
                cleaned = True
        child.wait()
        execution.unlink()
        return 124 if timed_out else child.returncode
    except BaseException:
        try:
            if not cleaned:
                terminate(child.pid, owner['birth'], owner['members'])
            child.wait()
            if not owner.get('uncertain'):
                execution.unlink(missing_ok=True)
        except Exception as cleanup_error:
            raise RuntimeError(f'Command failed and cleanup is unverified: {cleanup_error}') from cleanup_error
        raise
    finally:
        child.stdout.close()
