"""Explicit, idempotent demo data. Never creates users or attachments."""
import argparse
import math
from datetime import timedelta

from sqlalchemy import text
from app import create_app
from app.extensions import db
from app.models import (Cliente, Material, Movimiento, ProductoCatalogo, Pedido, PedidoItem,
                        EntregaParcialItem, ReporteFaltante, hora_ecuador,
                        _actualizar_estado)
from config import validate_storage


def seed_demo():
    """Call in an application context with no outstanding transaction."""
    validate_storage()
    db.session.execute(text('BEGIN IMMEDIATE'))
    try:
        clients = []
        for index, name in enumerate(('DEMO — Alimentos del Sol', 'DEMO — Laboratorio Andino'), 1):
            code = f'DEMO-CLI-{index:03}'
            client = Cliente.query.filter_by(codigo=code).first()
            if client is None:
                client = Cliente(codigo=code, nombre=name, contacto_principal='Cliente ficticio de demostración',
                                 direccion_entrega='Dirección ficticia', plazos_entrega='A coordinar')
                db.session.add(client)
            clients.append(client)

        materials = []
        for code, name, category, stock, minimum in (
            ('DEMO-MAT-001', 'DEMO — Sustrato blanco', 'Materia Prima', 12, 3),
            ('DEMO-MAT-002', 'DEMO — Sustrato transparente', 'Materia Prima', 1, 2),
            ('DEMO-MAT-003', 'DEMO — Tinta cian', 'Tintas', 0, 2),
        ):
            material = Material.query.filter_by(codigo_barras=code).first()
            if material is None:
                raw = category == 'Materia Prima'
                material = Material(codigo_barras=code, nombre=name, categoria=category,
                    tipo='Sustrato' if raw else 'Tinta', stock_actual=stock,
                    stock_minimo=minimum, stock_critico=minimum,
                    unidad_medida='rollos' if raw else 'unidades',
                    clasificacion='Materia Prima' if raw else 'Insumo',
                    metros_por_rollo=50 if raw else 0, ancho_material_cm=50 if raw else None)
                _actualizar_estado(material)
                db.session.add(material)
            materials.append(material)
        db.session.flush()

        products = []
        for index, (client, material) in enumerate(zip(clients, materials), 1):
            code = f'DEMO-PROD-{index:03}'
            product = ProductoCatalogo.query.filter_by(codigo=code, cliente=client.nombre).first()
            if product is None:
                product = ProductoCatalogo(codigo=code, cliente=client.nombre,
                    descripcion=f'DEMO — Etiqueta {index}', material_id=material.id,
                    cant_etiquetas_plancha=10, cant_etiquetas_rollo=1000,
                    cant_planchas=100, cant_rollos=1, largo_plancha_impresa=50,
                    largo_rollo=50, ancho_rollo=0.5, tiempo_base_minutos=0.5,
                    tipo_codigo='especial' if index == 2 else 'normal',
                    maquina_requerida='Mesp' if index == 2 else None)
                db.session.add(product)
            products.append(product)

        now = hora_ecuador()
        states = ('En Cola', 'En Cola', 'Procesando', 'Terminado', 'Facturado')
        for index, state in enumerate(states, 1):
            purchase_order = f'DEMO-SGP-{index:03}'
            if Pedido.query.filter_by(orden_compra=purchase_order).first() is not None:
                continue
            product = products[1 if index == 2 else 0]
            quantity = 1200 if index == 3 else 2000 + index * 200
            order = Pedido(cliente=product.cliente, orden_compra=purchase_order,
                fecha_entrega=(now + timedelta(days=index)).strftime('%Y-%m-%dT%H:%M'),
                estado=state, total_items=1, total_unidades=quantity)
            item = PedidoItem(codigo=product.codigo, descripcion=product.descripcion,
                cantidad=quantity, estado_item='listo' if state in ('Terminado', 'Facturado') else 'pendiente',
                modo_entregas_parciales=index == 3)
            order.items.append(item)
            if index == 3:
                order.maquina_asignada = 'M1'
                order.fecha_inicio_produccion = now
                order.minutos_estimados = 60
                order.fecha_fin_produccion = now + timedelta(minutes=60)
                item.entregas.append(EntregaParcialItem(cantidad_entregada=200,
                    observacion='DEMO — Despacho parcial ficticio'))
                item.faltantes.append(ReporteFaltante(cantidad_faltante=20,
                    unidad='etiquetas', motivo='DEMO — Reposición por merma ficticia', resuelto=False))
                item.faltantes.append(ReporteFaltante(cantidad_faltante=1,
                    unidad='planchas', motivo='DEMO — Reposición ficticia ya resuelta',
                    resuelto=True, fecha_resolucion=now))
            db.session.add(order)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--crear-demo', action='store_true', required=True,
                        help='Insertar explícitamente datos ficticios DEMO-* en esta instalación')
    parser.add_argument('--ampliar', action='store_true', help='Añadir catálogo, movimientos y pedidos en todos los estados')
    args = parser.parse_args(argv)
    app = create_app()
    with app.app_context():
        seed_demo()
        if args.ampliar:
            seed_extended()
    print('Demostración DEMO-* disponible. No se han creado usuarios ni credenciales.')


def seed_extended():
    """Additional examples; never replaces existing records or resets their stock."""
    validate_storage()
    db.session.execute(text('BEGIN IMMEDIATE'))
    try:
        now = hora_ecuador()
        for index, name, contact, address in (
            (3, 'Café Sierra Sur', 'Andrea · Compras', 'Cuenca · Parque Industrial'),
            (4, 'Cosmética Botánica', 'Daniela · Producción', 'Azogues · Centro'),
            (5, 'Lácteos del Austro', 'Mateo · Despachos', 'Cuenca · Totoracocha'),
            (6, 'Dulces La Tradición', 'Valeria · Administración', 'Gualaceo · Centro'),
        ):
            code = f'DEMO-CLI-{index:03}'
            if Cliente.query.filter_by(codigo=code).first() is None:
                db.session.add(Cliente(codigo=code, nombre=f'DEMO — {name}',
                    contacto_principal=contact, direccion_facturacion=address,
                    direccion_entrega=address, horarios_entrega='Lunes a viernes · 09:00–17:00',
                    plazos_entrega='48 horas'))
        for index, name, category, stock, minimum in (
            (4, 'Polipropileno mate', 'Materia Prima', 24, 5),
            (5, 'Papel adhesivo brillante', 'Materia Prima', 18, 4),
            (6, 'Película metalizada', 'Materia Prima', 3, 4),
            (7, 'Tinta magenta', 'Tintas', 8, 3),
            (8, 'Tinta amarilla', 'Tintas', 6, 2),
            (9, 'Tinta negra', 'Tintas', 10, 3),
            (10, 'Cinta de montaje', 'Herramientas', 15, 4),
            (11, 'Cuchilla de corte', 'Herramientas', 2, 3),
            (12, 'Sustrato térmico', 'Materia Prima', 9, 3),
        ):
            code = f'DEMO-MAT-{index:03}'
            if Material.query.filter_by(codigo_barras=code).first() is None:
                raw = category == 'Materia Prima'
                material = Material(codigo_barras=code, nombre=f'DEMO — {name}',
                    categoria=category, tipo='Sustrato' if raw else 'Tinta' if category == 'Tintas' else 'Cinta',
                    stock_actual=stock, stock_minimo=minimum, stock_critico=minimum,
                    unidad_medida='rollos' if raw else 'unidades',
                    clasificacion='Materia Prima' if raw else 'Insumo',
                    metros_por_rollo=50 if raw else 0, ancho_material_cm=50 if raw else None,
                    proveedor='Proveedor de demostración', acabado='Mate' if raw else None)
                _actualizar_estado(material)
                db.session.add(material)
        db.session.flush()
        clients = Cliente.query.filter(Cliente.codigo.like('DEMO-CLI-%')).order_by(Cliente.codigo).all()
        materials = Material.query.filter(Material.codigo_barras.like('DEMO-MAT-%')).order_by(Material.codigo_barras).all()
        raw_materials = [material for material in materials if material.categoria == 'Materia Prima']
        # Each initial history balances to the current demo stock. Existing history is preserved.
        for material in materials:
            if Movimiento.query.filter_by(material_id=material.id).first() is None:
                db.session.add(Movimiento(material_id=material.id, tipo_movimiento='Entrada',
                    cantidad=material.stock_actual + 2, fecha=now - timedelta(hours=6),
                    observacion='DEMO — Recepción de material'))
                db.session.add(Movimiento(material_id=material.id, tipo_movimiento='Salida',
                    cantidad=2, fecha=now - timedelta(hours=3), observacion='DEMO — Consumo de muestra'))
        descriptions = ('Etiqueta café 250 g', 'Etiqueta café 500 g', 'Etiqueta champú 300 ml',
            'Etiqueta crema corporal', 'Etiqueta yogur natural', 'Etiqueta queso fresco',
            'Etiqueta granola 400 g', 'Etiqueta galletas artesanales', 'Etiqueta miel 500 g',
            'Etiqueta laboratorio · lote', 'Etiqueta chocolate 70 %', 'Etiqueta mermelada 250 g')
        for index, description in enumerate(descriptions, 3):
            client = clients[(index - 3) // 2]
            code = f'DEMO-PROD-{index:03}'
            if ProductoCatalogo.query.filter_by(codigo=code, cliente=client.nombre).first() is None:
                material = raw_materials[(index - 3) % len(raw_materials)]
                db.session.add(ProductoCatalogo(codigo=code, cliente=client.nombre,
                    descripcion=f'DEMO — {description}', material_id=material.id,
                    cant_etiquetas_plancha=12, cant_etiquetas_rollo=1200,
                    cant_planchas=100, cant_rollos=1, largo_plancha_impresa=50,
                    largo_rollo=50, ancho_rollo=0.5, tiempo_base_minutos=0.4,
                    tipo_codigo='especial' if index == 8 else 'normal',
                    maquina_requerida='Mesp' if index == 8 else None))
        db.session.flush()
        products = ProductoCatalogo.query.filter(ProductoCatalogo.codigo.like('DEMO-PROD-%')).order_by(ProductoCatalogo.codigo).all()
        states = ('En Cola', 'En Cola', 'En Cola', 'Procesando', 'Procesando', 'Procesando',
                  'Terminado', 'Terminado', 'Facturado', 'Facturado', 'Retiro en Fábrica', 'Entregado', 'Entregado')
        for index, state in enumerate(states, 6):
            oc = f'DEMO-SGP-{index:03}'
            if Pedido.query.filter_by(orden_compra=oc).first() is not None:
                continue
            product = products[(index - 6) % len(products)]
            siblings = [entry for entry in products if entry.cliente == product.cliente]
            selected = [product] + ([entry for entry in siblings if entry.id != product.id][:1] if index % 3 == 0 else [])
            deadline = now + timedelta(hours=(index - 4) * 3)
            order = Pedido(cliente=product.cliente, orden_compra=oc, estado=state,
                fecha_entrega=deadline.strftime('%Y-%m-%dT%H:%M'), fecha_emision=now - timedelta(days=1),
                total_items=len(selected), total_unidades=0)
            complete = state in ('Terminado', 'Facturado', 'Retiro en Fábrica', 'Entregado')
            for position, entry in enumerate(selected):
                quantity = 600 + (index % 4) * 300 + position * 200
                item = PedidoItem(codigo=entry.codigo, descripcion=entry.descripcion,
                    cantidad=quantity, estado_item='listo' if complete or (state == 'Procesando' and position == 1) else 'pendiente')
                if index == 9 and position == 0:
                    item.modo_entregas_parciales = True
                    item.entregas.append(EntregaParcialItem(cantidad_entregada=300,
                        fecha=now - timedelta(hours=1), observacion='DEMO — Primera entrega'))
                    item.faltantes.append(ReporteFaltante(cantidad_faltante=50, unidad='etiquetas',
                        motivo='DEMO — Reposición de etiquetas de corte', resuelto=False))
                order.items.append(item)
                order.total_unidades += quantity
            if state == 'Procesando' or index in (6, 7):
                order.maquina_asignada = product.maquina_requerida or ('M2' if index % 2 == 0 else 'M1')
                start = now + timedelta(minutes=(index - 5) * 90)
                order.fecha_inicio_produccion = start
                order.minutos_estimados = 60
                order.fecha_fin_produccion = start + timedelta(minutes=60)
            if state == 'Entregado':
                order.fecha_entregado = now - timedelta(minutes=(index - 16) * 20)
            db.session.add(order)
            db.session.flush()
            if state == 'Entregado':
                for item, entry in zip(order.items, selected):
                    material = db.session.get(Material, entry.material_id)
                    amount = min(math.ceil(item.cantidad / entry.cant_etiquetas_rollo), material.stock_actual)
                    if amount > 0:
                        material.stock_actual -= amount
                        _actualizar_estado(material)
                        db.session.add(Movimiento(material_id=material.id, pedido_origen_id=order.id,
                            tipo_movimiento='Salida', cantidad=amount, fecha=order.fecha_entregado,
                            observacion=f'DEMO — Entrega del pedido #{order.id} ({item.codigo})'))
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise


if __name__ == '__main__':
    main()
