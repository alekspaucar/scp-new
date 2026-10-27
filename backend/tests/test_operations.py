import json


def create_material(client, stock=5):
    response = client.post('/api/materiales', json={'codigo_barras': 'TEST-ROLLO', 'nombre': 'Rollo test',
        'categoria': 'Materia Prima', 'stock_actual': stock, 'stock_minimo': 2})
    assert response.status_code == 201, response.json
    return response.json['material']


def create_order(client, quantity=1200):
    response = client.post('/api/pedidos', json={'cliente': 'Cliente test', 'fecha_entrega': '2026-12-01T12:00',
        'items': [{'codigo': 'TEST-PROD', 'descripcion': 'Etiquetas test', 'cantidad': quantity}]})
    assert response.status_code == 201, response.json
    return response.json['pedido']


def catalog(app, material_id):
    from app.extensions import db
    from app.models import ProductoCatalogo
    with app.app_context():
        db.session.add(ProductoCatalogo(codigo='TEST-PROD', cliente='Cliente test', descripcion='Etiquetas test',
            material_id=material_id, cant_etiquetas_plancha=10, cant_etiquetas_rollo=1000,
            cant_planchas=100, cant_rollos=1, largo_plancha_impresa=50, largo_rollo=50,
            ancho_rollo=0.5, tiempo_base_minutos=1))
        db.session.commit()


def test_readonly_permissions_and_revocation(app, jefe):
    from app.extensions import db
    from app.models import Usuario
    from app.permisos import MODULOS
    with app.app_context():
        reader = Usuario(username='reader', rol='empleado', permisos_json=json.dumps(dict.fromkeys(MODULOS, 'ver')))
        reader.set_password('reader-password')
        db.session.add(reader)
        db.session.commit()
    jefe.get('/logout')
    assert jefe.post('/api/login', json={'username': 'reader', 'password': 'reader-password'}).status_code == 200
    assert jefe.get('/api/materiales').status_code == 200
    assert jefe.get('/api/produccion/planificador').status_code == 200
    assert jefe.post('/api/reportes/mrp-lote', json={'pedidos_ids': []}).status_code == 400
    for url in ['/api/materiales', '/api/movimientos', '/api/pedidos', '/api/usuarios']:
        response = jefe.post(url, json={})
        assert response.status_code == 403 and response.is_json
    with app.app_context():
        reader = Usuario.query.filter_by(username='reader').one()
        reader.permisos_json = json.dumps(dict.fromkeys(MODULOS, 'ninguno'))
        db.session.commit()
    assert jefe.get('/api/materiales').status_code == 403


def test_movements_and_stock_states(jefe):
    material = create_material(jefe)
    assert material['estado'] == 'Disponible' and material['unidad_medida'] == 'rollos'
    for amount, state, stock in [(3, 'Crítico', 2), (2, 'Agotado', 0)]:
        response = jefe.post('/api/movimientos', json={'codigo_barras': 'TEST-ROLLO', 'tipo_movimiento': 'Salida', 'cantidad': amount})
        assert response.status_code == 201, response.json
        assert response.json['material']['estado'] == state
        assert response.json['material']['stock_actual'] == stock
    assert jefe.post('/api/movimientos', json={'codigo_barras': 'TEST-ROLLO', 'tipo_movimiento': 'Salida', 'cantidad': 1}).status_code == 400
    assert len(jefe.get('/api/movimientos').json) == 2


def test_partial_shortage_and_delivery_stock_semantics(app, jefe):
    material = create_material(jefe, stock=1)
    catalog(app, material['id'])
    order = create_order(jefe)
    path = f"/api/pedidos/{order['id']}"
    item_path = path + f"/items/{order['items'][0]['id']}"
    assert jefe.post(item_path + '/entregas', json={'cantidad_entregada': 200}).status_code == 200
    assert jefe.get('/api/materiales').json[0]['stock_actual'] == 1
    response = jefe.post(item_path + '/faltantes', json={'cantidad_faltante': 10, 'unidad': 'etiquetas', 'motivo': 'Merma test'})
    assert response.status_code == 201
    assert jefe.put(f"/api/pedidos/faltantes/{response.json['faltante']['id']}/resolver", json={}).status_code == 200
    for state in ['Procesando', 'Terminado', 'Facturado', 'Entregado']:
        response = jefe.put(path + '/estado', json={'estado': state})
        assert response.status_code == 200, response.json
    assert jefe.get('/api/materiales').json[0]['stock_actual'] == 0
    movements = jefe.get('/api/movimientos').json
    assert len(movements) == 1 and movements[0]['cantidad'] == 1
    assert jefe.put(path + '/estado', json={'estado': 'Entregado'}).status_code == 400


def test_mrp_and_gantt_are_persistent_and_do_not_consume_stock(app, jefe):
    material = create_material(jefe)
    catalog(app, material['id'])
    order = create_order(jefe)
    response = jefe.post('/api/reportes/mrp-lote', json={'pedidos_ids': [order['id']]})
    assert response.status_code == 200, response.json
    assert response.json['totales']['total_planchas'] == 120
    assert response.json['materiales_bodega'][0]['rollos_necesarios'] == 2
    response = jefe.put('/api/produccion/asignar-manual', json={'pedido_id': order['id'], 'maquina': 'M1', 'fecha_inicio': '2026-12-01T08:00:00'})
    assert response.status_code == 200, response.json
    timeline = jefe.get('/api/produccion/planificador').json
    assert {m['id'] for m in timeline['maquinas']} == {'M1', 'M2', 'Mesp'}
    assert timeline['lineas_tiempo']['M1'][0]['id'] == order['id']
    assert jefe.put('/api/produccion/asignar-manual', json={'pedido_id': order['id'], 'maquina': None}).status_code == 200
    assert jefe.get('/api/produccion/planificador').json['sin_asignar'][0]['id'] == order['id']
    assert jefe.get('/api/materiales').json[0]['stock_actual'] == 5
    assert jefe.get('/api/movimientos').json == []
