"""Storage and credentials belonging exclusively to this installation."""
import os
import secrets
import stat
from datetime import timedelta
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_ROOT.parent
INSTANCE_ROOT = BACKEND_ROOT / 'instance'
UPLOADS_ROOT = BACKEND_ROOT / 'uploads'
DATABASE_PATH = PROJECT_ROOT / 'sgp-nueva.sqlite3'


def confined_path(value, root, allow_root=False):
    """Resolve BEFORE writing, comparing against the literal allowed boundary."""
    path = Path(value)
    if not path.is_absolute():
        path = BACKEND_ROOT / path
    try:
        resolved = path.resolve()
    except (OSError, RuntimeError) as exc:
        raise ValueError('Ruta de almacenamiento inválida') from exc
    if (resolved == root and not allow_root) or not resolved.is_relative_to(root):
        raise ValueError(f'La ruta debe permanecer dentro de {root}')
    return resolved


def validate_storage():
    # Also check nested uploaded filenames and SQLite journal/WAL sidecars.
    for suffix in ('', '-journal', '-wal', '-shm'):
        path = Path(str(DATABASE_PATH) + suffix)
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise ValueError('La base de la raíz debe ser un archivo propio, sin enlaces')
    for root in (INSTANCE_ROOT, UPLOADS_ROOT):
        if root.resolve() != root:
            raise ValueError(f'No se permiten enlaces externos en {root}')
        for parent, directories, files in os.walk(root, followlinks=False):
            for name in directories + files:
                confined_path(Path(parent) / name, root)


def _persistent_secret():
    import fcntl
    path = INSTANCE_ROOT / '.session-secret'
    lock_path = INSTANCE_ROOT / '.session-secret.lock'
    if path.is_symlink() or lock_path.is_symlink():
        raise ValueError('El secreto de sesión debe ser un archivo propio')
    # Serialize initialization so a second process never reads a partial key.
    with os.fdopen(os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600), 'a+') as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(descriptor, 'w') as handle:
                handle.write(secrets.token_hex(32))
                handle.flush()
                os.fsync(handle.fileno())
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'r') as handle:
            if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                raise ValueError('Secreto de sesión inválido')
            os.fchmod(handle.fileno(), 0o600)
            secret = handle.read().strip()
        if len(secret) != 64 or any(c not in '0123456789abcdef' for c in secret):
            raise ValueError('Secreto de sesión inválido; revisar el archivo privado')
        return secret


class Config:
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    PERMANENT_SESSION_LIFETIME = timedelta(hours=10)
    SESSION_COOKIE_NAME = 'sgp_nueva_session'
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    MAX_CONTENT_LENGTH = 10 * 1024 * 1024
    ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'pdf'}

    def __init__(self):
        validate_storage()
        uri = os.environ.get('SGP_NUEVA_DATABASE_URL', 'sqlite:///' + str(DATABASE_PATH))
        if not uri.startswith('sqlite:///') or '?' in uri or '#' in uri:
            raise ValueError('SGP_NUEVA_DATABASE_URL debe ser SQLite sin parámetros')
        database_path = uri[len('sqlite:///'):]
        if not Path(database_path).is_absolute():
            raise ValueError('SGP_NUEVA_DATABASE_URL debe contener una ruta absoluta')
        candidate = Path(database_path)
        database = DATABASE_PATH if candidate == DATABASE_PATH else confined_path(candidate, INSTANCE_ROOT)
        if database.name.startswith('.session-secret') or database.is_dir():
            raise ValueError('La base debe ser un archivo SQLite propio')
        if database == DATABASE_PATH and not database.exists() and (INSTANCE_ROOT / 'sgp-nueva.sqlite3').exists():
            raise ValueError('Mueve primero la base propia con backend/move_database.py --a-raiz, con el servicio detenido')
        # This is the uploads ROOT; keep all three categories together in tests.
        upload_folder = os.environ.get('SGP_NUEVA_UPLOAD_FOLDER')
        uploads = confined_path(os.environ.get('SGP_NUEVA_UPLOADS_DIR',
            upload_folder if upload_folder is not None else str(UPLOADS_ROOT)),
            UPLOADS_ROOT, allow_root=True)
        if upload_folder is not None and confined_path(upload_folder, UPLOADS_ROOT, allow_root=True) != uploads:
            raise ValueError('SGP_NUEVA_UPLOADS_DIR y SGP_NUEVA_UPLOAD_FOLDER deben coincidir')
        INSTANCE_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
        database.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        for category in ('catalogo', 'logos', 'facturas'):
            (uploads / category).mkdir(parents=True, exist_ok=True)
        self.SQLALCHEMY_DATABASE_URI = 'sqlite:///' + str(database)
        self.UPLOAD_FOLDER = str(uploads / 'catalogo')
        self.SECRET_KEY = _persistent_secret()
