"""Move only this installation's legacy SQLite to its project root."""
import argparse
import fcntl
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from config import DATABASE_PATH, INSTANCE_ROOT, validate_storage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--a-raiz', action='store_true', required=True,
                        help='Ejecutar con el servicio nuevo detenido')
    parser.parse_args()
    validate_storage()
    INSTANCE_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    source = INSTANCE_ROOT / 'sgp-nueva.sqlite3'
    lock = INSTANCE_ROOT / '.database-location.lock'
    if lock.is_symlink():
        raise ValueError('El bloqueo debe ser propio')
    with os.fdopen(os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600), 'a+') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        validate_storage()
        if DATABASE_PATH.exists():
            print('La base de la raíz ya existe; no se reemplazó.')
            return
        if not source.is_file():
            print('No hay base anterior de esta instalación. El próximo inicio creará la base en la raíz.')
            return
        # Reserve the new filename without ever overwriting an existing file.
        descriptor = os.open(DATABASE_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        os.close(descriptor)
        try:
            with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as old:
                with closing(sqlite3.connect(DATABASE_PATH)) as new:
                    old.backup(new)
                    if new.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                        raise RuntimeError('No se pudo verificar la copia; se conserva la base anterior')
                    tables = [row[0] for row in old.execute("SELECT name FROM sqlite_master WHERE type='table'")]
                    for table in tables:
                        quoted = '"' + table.replace('"', '""') + '"'
                        if old.execute('SELECT COUNT(*) FROM ' + quoted).fetchone() != new.execute('SELECT COUNT(*) FROM ' + quoted).fetchone():
                            raise RuntimeError('La copia no conserva todos los registros')
        except BaseException:
            DATABASE_PATH.unlink(missing_ok=True)
            raise
        # Keep a complete SQLite backup of the previous state inside this project.
        backup = INSTANCE_ROOT / 'backups'
        backup.mkdir(mode=0o700, exist_ok=True)
        validate_storage()
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        target = backup / f'antes-raiz-{stamp}.sqlite3'
        with closing(sqlite3.connect(DATABASE_PATH.as_uri() + '?mode=ro', uri=True)) as current:
            with closing(sqlite3.connect(target)) as saved:
                current.backup(saved)
        target.chmod(0o600)
        source.unlink()
        for suffix in ('-wal', '-shm', '-journal'):
            Path(str(source) + suffix).unlink(missing_ok=True)
        print(f'Base activa: {DATABASE_PATH}. Registros y cuentas conservados. Copia previa: {target}.')


if __name__ == '__main__':
    main()
