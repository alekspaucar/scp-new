from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
import stat

import pytest

from conftest import BACKEND


def test_ignores_inherited_configuration(storage, monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 'inherited-secret')
    monkeypatch.setenv('SGP_INITIAL_ADMIN_PASSWORD', 'old-admin-password')
    monkeypatch.setenv('UPLOAD_FOLDER', '/must-not-use-inherited')
    from app import create_app
    from app.extensions import db
    from app.models import Usuario
    app = create_app()
    assert app.config['SQLALCHEMY_DATABASE_URI'] == 'sqlite:///' + str(storage[0] / 'test.sqlite3')
    assert app.config['SECRET_KEY'] != 'inherited-secret'
    assert app.config['UPLOAD_FOLDER'] == str(storage[1] / 'catalogo')
    assert app.config['SESSION_COOKIE_NAME'] == 'sgp_nueva_session'
    with app.app_context():
        assert Usuario.query.count() == 0
        db.session.remove()
        db.engine.dispose()


def test_render_bootstrap_creates_requested_admin_once(storage, monkeypatch):
    monkeypatch.setenv('RENDER', 'true')
    monkeypatch.setenv('INSTALLATION_TOKEN', 'render-installation-token')
    from app import create_app
    from app.extensions import db
    from app.models import Usuario

    app = create_app()
    with app.app_context():
        user = Usuario.query.one()
        assert user.username == 'admin'
        assert user.rol == 'admin'
        assert user.check_password('12345')
        db.session.remove()
        db.engine.dispose()

    restarted = create_app()
    with restarted.app_context():
        assert Usuario.query.count() == 1
        db.session.remove()
        db.engine.dispose()


def test_default_database_and_persistent_private_secret(storage, monkeypatch):
    from config import Config
    monkeypatch.delenv('SGP_NUEVA_DATABASE_URL')
    a, b = Config(), Config()
    assert a.SQLALCHEMY_DATABASE_URI == 'sqlite:///' + str(BACKEND.parent / 'sgp-nueva.sqlite3')
    assert len(a.SECRET_KEY) >= 64 and a.SECRET_KEY == b.SECRET_KEY
    secret = BACKEND / 'instance' / '.session-secret'
    assert stat.S_IMODE(secret.stat().st_mode) == 0o600


@pytest.mark.parametrize('uri', ['postgresql://localhost/old', 'sqlite:///:memory:',
    'sqlite:////private/tmp/outside.sqlite3', 'sqlite:///../outside.sqlite3',
    'sqlite:///instance/e2e-relative.sqlite3',
    'sqlite:///instance/db.sqlite3?uri=true'])
def test_rejects_database_outside_instance(storage, monkeypatch, uri):
    monkeypatch.setenv('SGP_NUEVA_DATABASE_URL', uri)
    from app import create_app
    with pytest.raises(ValueError):
        create_app()


def test_rejects_external_upload_directory(storage, monkeypatch):
    monkeypatch.setenv('SGP_NUEVA_UPLOAD_FOLDER', str(BACKEND / 'instance'))
    from app import create_app
    with pytest.raises(ValueError):
        create_app()


@pytest.mark.parametrize('kind', ['db', 'uploads', 'nested', 'sidecar'])
def test_rejects_symlink_escape(storage, monkeypatch, kind):
    instance, uploads = storage
    if kind == 'db':
        (instance / 'test.sqlite3').symlink_to(uploads / 'outside.sqlite3')
    elif kind == 'sidecar':
        (instance / 'test.sqlite3-journal').symlink_to(uploads / 'outside-journal')
    elif kind == 'uploads':
        link = uploads / 'escape'
        link.symlink_to(instance, target_is_directory=True)
        monkeypatch.setenv('SGP_NUEVA_UPLOAD_FOLDER', str(link))
    else:
        (uploads / 'catalogo').mkdir()
        (uploads / 'catalogo' / 'leak.pdf').symlink_to(instance / 'private.pdf')
    from app import create_app
    with pytest.raises(ValueError):
        create_app()


def test_health_and_json_errors(client):
    assert client.get('/api/health').json == {'status': 'ok', 'proyecto': 'sgp-nueva-interfaz'}
    assert client.get('/api/instalacion').json == {'requiere_configuracion': True}
    for url, status in [('/api/sesion', 401), ('/api/materiales', 401), ('/missing', 404), ('/app', 404)]:
        response = client.get(url)
        assert response.status_code == status
        assert response.is_json and 'error' in response.json
    response = client.get('/api/health', headers={'Origin': 'https://sgp-proprint.onrender.com'})
    assert 'Access-Control-Allow-Origin' not in response.headers


@pytest.mark.parametrize('data', [[], {}, {'username': 'jefe', 'password': 'short'},
    {'username': 1, 'password': 'password123'}, {'username': '', 'password': 'password123'}])
def test_bootstrap_validates_without_creating_users(client, data):
    assert client.post('/api/instalacion', json=data).status_code == 400
    assert client.get('/api/instalacion').json['requiere_configuracion'] is True


def test_bootstrap_rejects_nonlocal_and_external_origin(client):
    credentials = {'username': 'jefe', 'password': 'password123'}
    assert client.post('/api/instalacion', json=credentials, environ_base={'REMOTE_ADDR': '192.0.2.4'}).status_code == 403
    # The Next.js proxy is loopback too: reject a remote browser Origin.
    assert client.post('/api/instalacion', json=credentials, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.get('/api/instalacion').json['requiere_configuracion'] is True


def test_bootstrap_login_cookie_and_second_denied(jefe):
    assert jefe.get('/api/sesion').json['rol'] == 'jefe'
    assert jefe.get_cookie('sgp_nueva_session')
    assert jefe.get_cookie('session') is None
    assert jefe.get('/api/instalacion').json['requiere_configuracion'] is False
    assert jefe.post('/api/instalacion', json={'username': 'second', 'password': 'other-password'}).status_code == 409
    jefe.get('/logout')
    assert jefe.get('/api/sesion').status_code == 401
    assert jefe.post('/api/login', json={'username': 'jefe-test', 'password': 'bad'}).status_code == 401
    response = jefe.post('/api/login', json={'username': 'jefe-test', 'password': 'clave-test-12345'})
    assert response.status_code == 200 and response.json['permisos']['inventario'] == 'editar'
    assert 'HttpOnly' in response.headers['Set-Cookie'] and 'SameSite=Lax' in response.headers['Set-Cookie']


def test_bootstrap_concurrent_first_user_is_atomic(app):
    barrier = Barrier(2)
    def install(index):
        with app.test_client() as client:
            barrier.wait(timeout=5)
            return client.post('/api/instalacion', json={'username': f'first-{index}', 'password': 'password123'}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(install, [1, 2])) == [201, 409]
    from app.extensions import db
    from app.models import Usuario
    with app.app_context():
        assert Usuario.query.count() == 1


def test_symlink_added_after_startup_is_blocked(app, storage):
    (storage[1] / 'catalogo' / 'leak.pdf').symlink_to(storage[0] / 'private.pdf')
    response = app.test_client().get('/uploads/catalogo/leak.pdf')
    assert response.status_code == 403 and response.is_json


def test_only_prefixed_database_and_upload_variables_are_used(storage, monkeypatch):
    from config import Config
    monkeypatch.setenv('DATABASE_URL', 'postgresql://inherited.invalid/production')
    monkeypatch.setenv('SECRET_KEY', 'old-secret')
    monkeypatch.setenv('SGP_NUEVA_SECRET_KEY', 'also-not-a-persisted-secret')
    monkeypatch.setenv('UPLOAD_FOLDER', '/outside-this-installation')
    configuration = Config()
    assert configuration.SQLALCHEMY_DATABASE_URI.endswith('/test.sqlite3')
    assert configuration.UPLOAD_FOLDER == str(storage[1] / 'catalogo')
    assert configuration.SECRET_KEY not in ('old-secret', 'also-not-a-persisted-secret')


@pytest.mark.parametrize('root_name', ['INSTANCE_ROOT', 'UPLOADS_ROOT'])
def test_storage_root_symlink_rejected(storage, monkeypatch, root_name):
    import config
    link = storage[0] / 'root-link'
    link.symlink_to(storage[1], target_is_directory=True)
    monkeypatch.setattr(config, root_name, link)
    with pytest.raises(ValueError):
        config.validate_storage()


@pytest.mark.parametrize('host,origin,remote,status', [
    ('127.0.0.1:5101', 'http://localhost:3000', '127.0.0.1', 201),
    ('[::1]:5101', 'http://[::1]:3000', '::1', 201),
    ('evil.example', 'http://localhost:3000', '127.0.0.1', 403),
    ('localhost', 'null', '127.0.0.1', 403),
    ('localhost', 'http://localhost:3000', '203.0.113.1', 403),
])
def test_localhost_bootstrap_boundary(client, host, origin, remote, status):
    response = client.post('/api/instalacion', json={'username': 'local-jefe', 'password': '1234567890'},
        headers={'Host': host, 'Origin': origin, 'X-Forwarded-For': '127.0.0.1'},
        environ_base={'REMOTE_ADDR': remote})
    assert response.status_code == status


def test_session_survives_application_restart(storage, jefe):
    from app import create_app
    from app.extensions import db
    cookie = jefe.get_cookie('sgp_nueva_session')
    restarted = create_app()
    client = restarted.test_client()
    client.set_cookie('sgp_nueva_session', cookie.value)
    assert client.get('/api/sesion').json['username'] == 'jefe-test'
    assert client.get('/api/instalacion').json['requiere_configuracion'] is False
    with restarted.app_context():
        db.session.remove()
        db.engine.dispose()


def test_uploads_dir_environment_alias(storage, monkeypatch):
    from config import Config
    monkeypatch.delenv('SGP_NUEVA_UPLOAD_FOLDER')
    monkeypatch.setenv('SGP_NUEVA_UPLOADS_DIR', str(storage[1]))
    assert Config().UPLOAD_FOLDER == str(storage[1] / 'catalogo')


def test_conflicting_upload_aliases_are_rejected(storage, monkeypatch):
    from config import Config
    monkeypatch.setenv('SGP_NUEVA_UPLOADS_DIR', str(storage[1] / 'different'))
    with pytest.raises(ValueError):
        Config()
