from __future__ import annotations

import os
from pathlib import Path
from typing import BinaryIO


class ServiceLockError(RuntimeError):
    pass


class ServiceLock:
    def __init__(self, path: Path, handle: BinaryIO):
        self.path = path
        self.handle = handle

    @classmethod
    def acquire(cls, data_dir: Path) -> ServiceLock:
        data_dir.mkdir(parents=True, exist_ok=True)
        path = data_dir / "writer.lock"
        handle = path.open("a+b")
        try:
            if path.stat().st_size == 0:
                handle.write(b"\0")
                handle.flush()
                os.fsync(handle.fileno())
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, IOError) as exc:
            handle.close()
            raise ServiceLockError(
                f"Another Vault Search backend owns the data directory: {data_dir}") from exc
        return cls(path, handle)

    def close(self) -> None:
        if self.handle.closed:
            return
        try:
            self.handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        finally:
            self.handle.close()
