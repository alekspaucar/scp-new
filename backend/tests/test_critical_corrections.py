"""Regressions for independent review findings; storage comes from conftest."""
import io
from copy import deepcopy

import pytest
from PIL import Image
from reportlab.pdfgen.canvas import Canvas
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from test_operations import create_material, create_order

MODULES = ('pedidos', 'produccion', 'operaciones', 'inventario', 'reportes',
           'configuracion', 'calculadora')
DENIED = dict.fromkeys(MODULES, 'ninguno')


def account(jefe, username='operator', **extra):
    response = jefe.post('/api/usuarios', json={
        'username': username, 'password': 'regression-password', 'rol': 'operador', **extra})
    assert response.status_code == 200, response.json
    return response.json['usuario']


def login(app, username='operator', password='regression-password'):
    client = app.test_client()
    assert client.post('/api/login', json={'username': username, 'password': password}).status_code == 200
    return client


def order_payload(order, **changes):
    # A complete editor snapshot, including item IDs and the revision it read.
    return {**deepcopy(order), 'revision': order.get('revision', 1), **changes}


def test_deleted_highest_id_cookie_cannot_authenticate_replacement_admin(app, jefe):
    operator = account(jefe)
    old_client = login(app)
    assert jefe.delete(f"/api/usuarios/{operator['id']}").status_code == 200
    admin = account(jefe, username='replacement-admin', rol='admin')
    assert admin['id'] == operator['id']  # Reproduce SQLite's real ID reuse.
    assert old_client.get('/api/sesion').status_code == 401
    assert old_client.get('/api/usuarios').status_code == 401


def test_password_change_invalidates_existing_cookie(app, jefe):
    operator = account(jefe)
    old_client = login(app)
    assert jefe.put(f"/api/usuarios/{operator['id']}", json={'password': 'replacement-password'}).status_code == 200
    assert old_client.get('/api/sesion').status_code == 401
    assert login(app, password='replacement-password').get('/api/sesion').status_code == 200


@pytest.mark.parametrize('token', ['1', '1:bad-digest', 'bad:token', None, [], 1])
def test_legacy_and_malformed_identity_tokens_are_unauthorized(app, jefe, token):
    client = app.test_client()
    with client.session_transaction() as session:
        session['_user_id'] = token
        session['_fresh'] = True
    assert client.get('/api/sesion').status_code == 401


def test_stale_order_header_preserves_new_item_delivery_and_shortage(jefe):
    original = create_order(jefe)
    path = f"/api/pedidos/{original['id']}"
    added = {'codigo': 'NEW', 'descripcion': 'Added concurrently', 'cantidad': 100}
    response = jefe.put(path, json=order_payload(original, items=[*original['items'], added]))
    assert response.status_code == 200, response.json
    new_item = response.json['pedido']['items'][-1]
    item_path = path + f"/items/{new_item['id']}"
    assert jefe.post(item_path + '/entregas', json={'cantidad_entregada': 10}).status_code == 200
    assert jefe.post(item_path + '/faltantes', json={'cantidad_faltante': 3, 'motivo': 'Merma'}).status_code == 201
    current = jefe.get(path).json
    response = jefe.put(path, json=order_payload(original, fecha_entrega='2027-01-01T10:00'))
    assert response.status_code == 409, response.json
    assert jefe.get(path).json == current
    assert len(current['items']) == 2
    assert current['items'][-1]['entregas'][0]['cantidad_entregada'] == 10
    assert current['items'][-1]['faltantes'][0]['cantidad_faltante'] == 3


def test_stale_material_header_cannot_restore_stock_after_movement(jefe):
    original = create_material(jefe, stock=20)
    response = jefe.post('/api/movimientos', json={
        'codigo_barras': original['codigo_barras'], 'tipo_movimiento': 'Salida', 'cantidad': 2})
    assert response.status_code == 201
    current = response.json['material']
    response = jefe.put(f"/api/materiales/{original['id']}", json={
        **original, 'revision': original.get('revision', 1), 'nombre': 'Stale edit'})
    assert response.status_code == 409, response.json
    assert jefe.get('/api/materiales').json == [current]
    assert current['stock_actual'] == 18
    assert len(jefe.get('/api/movimientos').json) == 1


@pytest.mark.parametrize('resource', ['materiales', 'pedidos'])
@pytest.mark.parametrize('revision,status', [('missing', 428), (None, 400), (True, 400), ('1', 400), (0, 400), (1.0, 400), (999, 409)])
def test_header_revision_precondition_is_enforced_without_mutation(jefe, resource, revision, status):
    original = create_material(jefe) if resource == 'materiales' else create_order(jefe)
    body = deepcopy(original)
    body.pop('revision', None)
    if revision != 'missing':
        body['revision'] = revision
    response = jefe.put(f"/api/{resource}/{original['id']}", json=body)
    assert response.status_code == status, response.json
    assert jefe.get('/api/' + resource).json == [original]


@pytest.mark.parametrize('resource', ['materiales', 'pedidos'])
def test_fresh_header_edit_returns_new_revision_and_rejects_replay(jefe, resource):
    original = create_material(jefe) if resource == 'materiales' else create_order(jefe)
    assert type(original.get('revision')) is int
    body = {**original, 'nombre': 'New name'} if resource == 'materiales' else order_payload(original, fecha_entrega='2027-01-01T10:00')
    path = f"/api/{resource}/{original['id']}"
    response = jefe.put(path, json=body)
    assert response.status_code == 200, response.json
    updated = response.json['material' if resource == 'materiales' else 'pedido']
    assert updated['revision'] > original['revision']
    assert jefe.put(path, json=body).status_code == 409


def test_each_child_mutation_invalidates_order_header(jefe):
    current = create_order(jefe)
    path = f"/api/pedidos/{current['id']}"
    item_path = path + f"/items/{current['items'][0]['id']}"

    def mutate(method, url, data=None, status=200):
        nonlocal current
        before = current
        response = getattr(jefe, method)(url, json=data)
        assert response.status_code == status, response.json
        current = jefe.get(path).json
        assert current.get('revision', 1) > before.get('revision', 1), url
        assert jefe.put(path, json=order_payload(before)).status_code == 409
        return response.json

    mutate('put', item_path + '/estado', {'estado': 'listo'})
    mutate('patch', item_path + '/modo-parcial', {'activo': True})
    mutate('post', item_path + '/entregas', {'cantidad_entregada': 10})
    delivery_id = current['items'][0]['entregas'][0]['id']
    mutate('delete', item_path + f'/entregas/{delivery_id}')
    report = mutate('post', item_path + '/faltantes', {'cantidad_faltante': 2}, status=201)
    report_id = report['faltante']['id']
    mutate('put', f'/api/pedidos/faltantes/{report_id}/resolver', {})
    mutate('delete', f'/api/pedidos/faltantes/{report_id}')


@pytest.mark.parametrize('resource', ['materiales', 'pedidos'])
def test_independent_orm_sessions_cannot_overwrite_committed_version(app, jefe, resource):
    from app.extensions import db
    from app.models import Material, Pedido
    original = create_material(jefe) if resource == 'materiales' else create_order(jefe)
    model, field = (Material, 'nombre') if resource == 'materiales' else (Pedido, 'fecha_entrega')
    with app.app_context(), Session(db.engine) as first, Session(db.engine) as second:
        a, b = first.get(model, original['id']), second.get(model, original['id'])
        setattr(a, field, 'first writer')
        first.commit()
        setattr(b, field, 'stale writer')
        with pytest.raises(StaleDataError):
            second.commit()
        second.rollback()
        with Session(db.engine) as check:
            assert getattr(check.get(model, original['id']), field) == 'first writer'


def test_create_user_with_no_access_is_immediately_restricted(app, jefe):
    user = account(jefe, permisos=DENIED)
    client = login(app)
    # Assert the first login/request, without a dedicated permissions request.
    for path in ['/api/pedidos', '/api/materiales', '/api/produccion/planificador', '/api/catalogo', '/api/clientes']:
        assert client.get(path).status_code == 403, path
    assert user['permisos'] == DENIED and user['permisos_personalizados'] is True
    assert client.get('/api/sesion').json['permisos'] == DENIED


@pytest.mark.parametrize('permissions', [{}, {'pedidos': 'ver'}, {**DENIED, 'pedidos': 'admin'}, {**DENIED, 'extra': 'ver'}, [], 'none'])
def test_bad_permissions_never_create_account(jefe, permissions):
    before = jefe.get('/api/usuarios').json
    response = jefe.post('/api/usuarios', json={
        'username': 'invalid', 'password': 'regression-password', 'rol': 'operador', 'permisos': permissions})
    assert response.status_code == 400, response.json
    assert jefe.get('/api/usuarios').json == before


def test_account_and_permissions_update_are_one_atomic_operation(app, jefe):
    user = account(jefe)
    response = jefe.put(f"/api/usuarios/{user['id']}", json={
        'username': 'renamed', 'password': 'new-password', 'rol': 'empleado', 'permisos': DENIED})
    assert response.status_code == 200
    client = login(app, 'renamed', 'new-password')
    assert client.get('/api/pedidos').status_code == 403
    assert response.json['usuario']['permisos_personalizados'] is True


def test_bad_permissions_update_rolls_back_all_account_fields(app, jefe):
    user = account(jefe)
    response = jefe.put(f"/api/usuarios/{user['id']}", json={
        'username': 'must-not-change', 'password': 'must-not-change', 'rol': 'empleado', 'permisos': {}})
    assert response.status_code == 400, response.json
    assert login(app).get('/api/sesion').json == user


def test_permissions_null_reset_and_dedicated_endpoint_remain_available(app, jefe):
    user = account(jefe, permisos=DENIED)
    path = f"/api/usuarios/{user['id']}"
    assert jefe.put(path, json={'permisos': None}).status_code == 200
    client = login(app)
    assert client.get('/api/pedidos').status_code == 200
    assert jefe.put(path + '/permisos', json={'permisos': DENIED}).status_code == 200
    assert client.get('/api/pedidos').status_code == 403


@pytest.mark.parametrize('method', ['post', 'put'])
def test_manager_cannot_silently_ignore_custom_permissions(jefe, method):
    user = account(jefe)
    path = '/api/usuarios' if method == 'post' else f"/api/usuarios/{user['id']}"
    response = getattr(jefe, method)(path, json={
        'username': 'invalid-admin', 'password': 'regression-password', 'rol': 'admin', 'permisos': DENIED})
    assert response.status_code == 400, response.json
    assert len(jefe.get('/api/usuarios').json) == 2


@pytest.mark.parametrize('extension,format,mime', [
    ('pdf', None, 'application/pdf'), ('png', 'PNG', 'image/png'),
    ('jpg', 'JPEG', 'image/jpeg'), ('jpeg', 'JPEG', 'image/jpeg'), ('webp', 'WEBP', 'image/webp')])
def test_invoice_upload_serves_validated_type_inline_with_filename(jefe, extension, format, mime):
    order = create_order(jefe)
    file = io.BytesIO()
    if extension == 'pdf':
        canvas = Canvas(file)
        canvas.drawString(50, 750, 'Valid regression invoice')
        canvas.save()
    else:
        Image.new('RGB', (2, 2), 'white').save(file, format=format)
    content = file.getvalue()
    file.seek(0)
    response = jefe.post(f"/api/pedidos/{order['id']}/factura", data={'archivo': (file, 'invoice.' + extension)})
    assert response.status_code == 200, response.json
    url = response.json['pedido']['url_factura']
    response = jefe.get(url)
    assert response.mimetype == mime
    assert response.headers['Content-Disposition'].startswith('inline;')
    assert 'filename=' in response.headers['Content-Disposition']
    assert response.headers['X-Content-Type-Options'] == 'nosniff'
    assert response.data == content


def test_revision_migration_is_additive_idempotent_and_preserves_data(app, jefe, storage):
    import sqlite3
    from app import create_app
    from app.extensions import db
    material = create_material(jefe, stock=20)
    order = create_order(jefe)
    assert jefe.post('/api/movimientos', json={
        'codigo_barras': material['codigo_barras'], 'tipo_movimiento': 'Salida', 'cantidad': 2}).status_code == 201
    with app.app_context():
        db.session.remove()
        db.engine.dispose()
    with sqlite3.connect(storage[0] / 'test.sqlite3') as connection:
        for table in ('materiales', 'pedidos'):
            if 'revision' in {row[1] for row in connection.execute(f'PRAGMA table_info({table})')}:
                connection.execute(f'ALTER TABLE {table} DROP COLUMN revision')
    for _ in range(2):
        restarted = create_app()
        with restarted.app_context():
            with db.engine.connect() as connection:
                from sqlalchemy import text
                for table in ('materiales', 'pedidos'):
                    assert 'revision' in {row[1] for row in connection.execute(text(f'PRAGMA table_info({table})'))}
                    assert connection.execute(text(f'SELECT revision FROM {table}')).scalar_one() >= 1
                assert connection.execute(text('SELECT stock_actual FROM materiales')).scalar_one() == 18
                assert connection.execute(text('SELECT count(*) FROM movimientos')).scalar_one() == 1
                assert connection.execute(text('SELECT count(*) FROM pedido_items')).scalar_one() == 1
            db.session.remove()
            db.engine.dispose()
    assert order['id'] == 1


def test_concurrent_header_requests_have_one_winner(app, jefe):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    original = create_order(jefe)
    cookie = jefe.get_cookie('sgp_nueva_session').value
    barrier = Barrier(2)

    def update(index):
        client = app.test_client()
        client.set_cookie('sgp_nueva_session', cookie)
        barrier.wait(timeout=5)
        return client.put(f"/api/pedidos/{original['id']}", json=order_payload(
            original, fecha_entrega=f'2027-01-0{index}T10:00')).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(update, [1, 2])) == [200, 409]


def test_invoice_optimistic_conflict_rolls_back_and_removes_unreferenced_upload(app, jefe, storage):
    from sqlalchemy import event, inspect, text
    from app.models import Pedido
    order = create_order(jefe)
    file = io.BytesIO()
    canvas = Canvas(file)
    canvas.drawString(50, 750, 'Conflict invoice')
    canvas.save()
    file.seek(0)

    def invalidate_version(session, flush_context, instances):
        # Exercise the real ORM row-count conflict without a second SQLite
        # writer waiting on this request's BEGIN IMMEDIATE lock.
        for obj in session.dirty:
            if isinstance(obj, Pedido) and inspect(obj).attrs.url_factura.history.has_changes():
                session.connection().execute(text('UPDATE pedidos SET revision = revision + 1 WHERE id = :id'), {'id': obj.id})

    event.listen(Session, 'before_flush', invalidate_version)
    try:
        response = jefe.post(f"/api/pedidos/{order['id']}/factura", data={'archivo': (file, 'conflict.pdf')})
    finally:
        event.remove(Session, 'before_flush', invalidate_version)
    assert response.status_code == 409, response.json
    assert list((storage[1] / 'facturas').iterdir()) == []
    assert jefe.get(f"/api/pedidos/{order['id']}").json == order
