"""Coordinate admin writes with local backups and scheduled data builds."""
from contextlib import contextmanager
import fcntl
import os
from pathlib import Path


@contextmanager
def runtime_lock(root):
    path = Path(root) / '.yesspec-data.lock'
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(fd, 'a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)
