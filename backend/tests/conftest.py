import os
import shutil
import sys
from pathlib import Path
from uuid import uuid4

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


@pytest.fixture
def storage(monkeypatch):
    # Even RED runs can only open a disposable database in the new instance.
    instance = BACKEND / 'instance' / ('test-' + uuid4().hex)
    uploads = BACKEND / 'uploads' / ('test-' + uuid4().hex)
    instance.mkdir(parents=True)
    uploads.mkdir(parents=True)
    for key in list(os.environ):
        if key.startswith('SGP_NUEVA_'):
            monkeypatch.delenv(key)
    monkeypatch.setenv('SGP_NUEVA_DATABASE_URL', 'sqlite:///' + str(instance / 'test.sqlite3'))
    monkeypatch.setenv('SGP_NUEVA_UPLOAD_FOLDER', str(uploads))
    # Prevent old code from creating a database elsewhere during RED.
    monkeypatch.setenv('DATABASE_URL', 'sqlite:///' + str(instance / 'inherited.sqlite3'))
    monkeypatch.delenv('SGP_INITIAL_ADMIN_PASSWORD', raising=False)
    yield instance, uploads
    shutil.rmtree(instance)
    shutil.rmtree(uploads)


@pytest.fixture
def app(storage):
    from app import create_app
    from app.extensions import db
    application = create_app()
    application.config['TESTING'] = True
    yield application
    with application.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def jefe(client):
    response = client.post('/api/instalacion', json={'username': 'jefe-test', 'password': 'clave-test-12345'})
    assert response.status_code == 201, response.get_json()
    return client
