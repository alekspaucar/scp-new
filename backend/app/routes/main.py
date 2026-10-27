import io
from hashlib import sha256
import json
import math
import os
import re
import shutil
import time
from uuid import uuid4
from datetime import datetime, timedelta
from fractions import Fraction
from html import escape

import pdfplumber
import pytesseract
from flask import (Blueprint, request, jsonify, send_file,
                   send_from_directory, current_app)
from flask_login import login_required, current_user
from functools import wraps
from ..permisos import (ENDPOINTS_USUARIOS, REGLAS_ENDPOINT, endpoint_escritura,
                        puede_acceder_endpoint, usuario_a_dict, validar_permisos)

def roles_required(*roles):
    def wrapper(fn):
        @wraps(fn)
        def decorated_view(*args, **kwargs):
            autorizado = (puede_acceder_endpoint(current_user, fn.__name__)
                          if fn.__name__ in REGLAS_ENDPOINT else current_user.rol in roles)
            if not autorizado:
                return jsonify({'error': 'Acceso denegado (Rol insuficiente)'}), 403
            return fn(*args, **kwargs)
        return decorated_view
    return wrapper

from PIL import Image as PILImage
from werkzeug.security import safe_join
from werkzeug.utils import secure_filename
from openpyxl import Workbook, load_workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle,
                                Paragraph, Spacer, Image, PageBreak)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.exc import StaleDataError

from ..extensions import db
from ..models import (db, Usuario, Material, Movimiento, Pedido, PedidoItem,
                      EntregaParcialItem, ReporteFaltante, ProductoCatalogo, Cliente,
                      hora_ecuador, _actualizar_estado)

from ..services.consumption import (datos_produccion as _datos_produccion_mrp,
                                    calcular_consumo, consolidar_materiales, numero_finito,
                                    entero_seguro)
from ..services.consumption_pdf import generar_pdf_consumo

main_bp = Blueprint('main', __name__)


def _conflicto_guardado():
    db.session.rollback()
    return jsonify({'error': 'El recurso cambió. Recarga los datos antes de guardar.',
                    'codigo': 'revision_desactualizada'}), 409


@main_bp.errorhandler(StaleDataError)
def conflicto_guardado(error):
    return _conflicto_guardado()


def _comprobar_revision(data, recurso):
    if 'revision' not in data:
        return jsonify({'error': 'Debes enviar la revision leída al abrir el editor.',
                        'codigo': 'revision_requerida'}), 428
    revision = data['revision']
    if type(revision) is not int or revision < 1:
        return jsonify({'error': 'revision debe ser un entero positivo.',
                        'codigo': 'revision_invalida'}), 400
    if revision != recurso.revision:
        return jsonify({'error': 'El recurso cambió. Recarga los datos antes de guardar.',
                        'codigo': 'revision_desactualizada',
                        'revision_actual': recurso.revision}), 409
    return None


def _comprobar_estado_pedido(data, pedido):
    # Compatibilidad: sin precondición explícita se conserva el flujo original.
    if not isinstance(data, dict):
        return None
    if 'estado_pedido_esperado' in data:
        esperado = data['estado_pedido_esperado']
        if not isinstance(esperado, str) or esperado not in ESTADOS_PEDIDO:
            return jsonify({'error': 'estado_pedido_esperado debe ser un estado de pedido válido.',
                            'codigo': 'estado_pedido_esperado_invalido'}), 400
        if pedido.estado != esperado:
            return jsonify({'error': 'El estado del pedido cambió. Actualiza los datos antes de modificar sus ítems.',
                            'codigo': 'estado_pedido_desactualizado',
                            'estado_actual': pedido.estado}), 409
    if 'revision_pedido_esperada' in data:
        revision = data['revision_pedido_esperada']
        if type(revision) is not int or revision < 1:
            return jsonify({'error': 'revision_pedido_esperada debe ser un entero positivo.',
                            'codigo': 'revision_invalida'}), 400
        if revision != pedido.revision:
            return jsonify({'error': 'El pedido cambió. Actualiza los datos antes de modificar sus ítems.',
                            'codigo': 'revision_desactualizada',
                            'revision_actual': pedido.revision}), 409
    return None


@main_bp.before_request
def autorizar_seccion():
    if request.method == 'OPTIONS':
        return None
    endpoint = (request.endpoint or '').removeprefix('main.')
    if not current_user.is_authenticated:
        return current_app.login_manager.unauthorized()

    def denegar():
        return jsonify({'error': 'No tienes permiso para realizar esta acción',
                        'usuario': usuario_a_dict(current_user)}), 403

    if not puede_acceder_endpoint(current_user, endpoint):
        return denegar()
    if request.is_json and request.method in ('POST', 'PUT', 'PATCH'):
        if not isinstance(request.get_json(silent=True), dict):
            return jsonify({'error': 'El cuerpo de la petición debe ser un objeto JSON'}), 400
    if (request.method not in ('GET', 'HEAD') and endpoint_escritura(endpoint)
            and endpoint != 'leer_documento_pedido' and db.engine.dialect.name == 'sqlite'):
        # Adquirir el turno de escritura ANTES de consultar stock, entregas o
        # estados. También funciona entre procesos Gunicorn independientes.
        from sqlalchemy import text
        from sqlalchemy.exc import OperationalError
        try:
            db.session.execute(text('BEGIN IMMEDIATE'))
            db.session.expire_all()
        except OperationalError:
            db.session.rollback()
            return jsonify({'error': 'Otro usuario está guardando cambios. Intenta nuevamente.'}), 503
        if not puede_acceder_endpoint(current_user, endpoint):
            db.session.rollback()
            return denegar()
    return None

CATEGORIAS_VALIDAS = ['Materia Prima', 'Tintas', 'Herramientas']
TIPOS_VALIDOS = ['Sustrato', 'Tinta', 'Cinta']
ESTADOS_PEDIDO = ['En Cola', 'Procesando', 'Terminado', 'Facturado', 'Retiro en Fábrica',
                  'Entregado']
# Desde Terminado el pedido pasa a Facturado (beta/autorización).
# Desde Facturado puede pasar a Retiro en Fábrica (el cliente lo
# recoge en planta) o entregarse directo; Retiro en Fábrica solo termina
# en Entregado.
TRANSICIONES_PEDIDO = {
    'En Cola': ('Procesando',),
    'Procesando': ('Terminado',),
    'Terminado': ('Facturado',),
    'Facturado': ('Retiro en Fábrica', 'Entregado'),
    'Retiro en Fábrica': ('Entregado',),
    'Entregado': (),
}
# Estados asignables a un ítem vía PUT .../items/<id>/estado. 'pendiente'
# está acá para poder revertir el toggle "Listo" del Kanban de Producción.
ESTADOS_ITEM_PEDIDO = ('pendiente', 'listo', 'suspendido', 'entregado_parcial')

# clasificacion y unidad_medida se derivan siempre de la categoria en el
# backend; el frontend no los manda (se ignoran si llegan en el payload).
MAPEO_CLASIFICACION = {
    'Materia Prima': 'Materia Prima',
    'Tintas': 'Insumo',
    'Herramientas': 'Insumo',
}
MAPEO_UNIDAD = {
    'Materia Prima': 'rollos',
    'Tintas': 'unidades',
    'Herramientas': 'unidades',
}


def puede_operar_seccion():
    return puede_acceder_endpoint(current_user, (request.endpoint or '').removeprefix('main.'))


def es_jefe():
    return current_user.is_authenticated and current_user.rol == 'jefe'


def _catalogo_item(item, cliente):
    """Resuelve el producto del cliente; '-' requiere también descripción."""
    codigo = (item.codigo or '').strip().upper()
    consulta = ProductoCatalogo.query.filter(
        db.func.upper(db.func.trim(db.func.coalesce(ProductoCatalogo.cliente, '')))
        == (cliente or '').strip().upper())
    if codigo in ('', '-', 'S/C'):
        consulta = consulta.filter(ProductoCatalogo.codigo == '-',
            ProductoCatalogo.descripcion == (item.descripcion or '').strip())
    else:
        consulta = consulta.filter(db.func.upper(db.func.trim(ProductoCatalogo.codigo)) == codigo)
    candidatos = consulta.limit(2).all()
    return candidatos[0] if len(candidatos) == 1 else None


def _aplicar_impacto_stock(pedido, signo):
    """
    signo=1 descuenta stock (al entregar).
    signo=-1 revierte lo descontado (al editar o eliminar un pedido entregado).
    El descuento solo aplica a items cuyo código exista en el catálogo PARA EL
    CLIENTE del pedido (codigo es único por cliente, no global), con material
    vinculado y cant_etiquetas_rollo > 0. Se registra la cantidad realmente descontada
    (nunca más de lo que hay en stock). La reversión devuelve exactamente el
    neto descontado según el origen de los movimientos automáticos del pedido,
    independiente del texto de las observaciones, de modo que no se
    crea stock fantasma aunque el catálogo cambie o el stock se haya agotado.
    """
    if signo > 0:
        for item in pedido.items:
            catalogo = _catalogo_item(item, pedido.cliente)
            if not catalogo or not catalogo.material_id:
                continue
            if not catalogo.cant_etiquetas_rollo:
                continue
            material = db.session.get(Material, catalogo.material_id)
            if not material:
                continue
            rollos = math.ceil(item.cantidad / catalogo.cant_etiquetas_rollo)
            descuento = min(rollos, material.stock_actual)
            if descuento <= 0:
                continue
            material.stock_actual -= descuento
            _actualizar_estado(material)
            observacion = (
                f'Descuento automático pedido #{pedido.id} ({item.codigo})')
            if descuento < rollos:
                observacion += (
                    f' — stock insuficiente: {descuento} de {rollos} rollos')
            db.session.add(Movimiento(
                material_id=material.id,
                pedido_origen_id=pedido.id,
                usuario_id=current_user.id,
                tipo_movimiento='Salida',
                cantidad=descuento,
                observacion=observacion,
            ))
        return

    movimientos = Movimiento.query.filter_by(pedido_origen_id=pedido.id).all()
    neto = {}
    for mov in movimientos:
        delta = mov.cantidad if mov.tipo_movimiento == 'Salida' else -mov.cantidad
        neto[mov.material_id] = neto.get(mov.material_id, 0) + delta
    for material_id, pendiente in neto.items():
        if pendiente <= 0:
            continue
        material = db.session.get(Material, material_id)
        if not material:
            continue
        material.stock_actual += pendiente
        _actualizar_estado(material)
        db.session.add(Movimiento(
            material_id=material_id,
            pedido_origen_id=pedido.id,
            usuario_id=current_user.id,
            tipo_movimiento='Entrada',
            cantidad=pendiente,
            observacion=(
                f'Reversión automática pedido #{pedido.id} '
                f'({material.codigo_barras})'),
        ))


def _entero(valor, campo, minimo=0):
    """Valida que valor sea un entero sin decimales; lanza ValueError si no."""
    if isinstance(valor, bool):
        raise ValueError(f'{campo} debe ser un número entero')
    if isinstance(valor, float) and not valor.is_integer():
        raise ValueError(f'{campo} no acepta decimales')
    if isinstance(valor, str) and '.' in valor:
        raise ValueError(f'{campo} no acepta decimales')
    try:
        num = int(valor)
    except (TypeError, ValueError):
        raise ValueError(f'{campo} debe ser un número entero')
    if num < minimo:
        raise ValueError(f'{campo} debe ser mayor o igual a {minimo}')
    return num


def _flotante(valor, campo):
    if valor in (None, ''):
        return 0
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        raise ValueError(f'{campo} debe ser un número')
    if isinstance(valor, bool) or not math.isfinite(numero) or numero < 0:
        raise ValueError(f'{campo} debe ser un número finito mayor o igual a 0')
    return numero


def _fmt_fecha(dt):
    return dt.strftime('%d/%m/%Y %H:%M') if dt else None


def _rango_fechas():
    """Lee ?desde= y ?hasta= (ISO). 'hasta' a medianoche cubre todo ese día."""
    desde_str = (request.args.get('desde') or '').strip()
    hasta_str = (request.args.get('hasta') or '').strip()
    try:
        desde = datetime.fromisoformat(desde_str) if desde_str else None
        hasta = datetime.fromisoformat(hasta_str) if hasta_str else None
        if hasta and hasta.time() == datetime.min.time():
            hasta = hasta + timedelta(days=1)
    except (ValueError, OverflowError):
        raise ValueError('Formato de fecha inválido — usar ISO (YYYY-MM-DD)')
    return desde, hasta


def material_a_dict(m):
    return {
        'id': m.id,
        'revision': m.revision,
        'codigo_barras': m.codigo_barras,
        'nombre': m.nombre,
        'categoria': m.categoria,
        'tipo': m.tipo,
        'metros_por_rollo': m.metros_por_rollo,
        'stock_actual': m.stock_actual,
        'stock_minimo': m.stock_minimo,
        'stock_critico': m.stock_critico,
        'estado': m.estado,
        'unidad_medida': m.unidad_medida,
        'clasificacion': m.clasificacion,
        'color': m.color,
        'capacidad': m.capacidad,
        'gramaje': m.gramaje,
        'proveedor': m.proveedor,
        'ancho_material_cm': m.ancho_material_cm,
        'acabado': m.acabado,
        'cantidad_ml': m.cantidad_ml,
    }


def movimiento_a_dict(mov):
    return {
        'id': mov.id,
        'fecha': _fmt_fecha(mov.fecha),
        'sku': mov.material.codigo_barras if mov.material else 'N/A',
        'nombre_material': mov.material.nombre if mov.material else 'Material eliminado',
        'unidad_medida': mov.material.unidad_medida if mov.material else None,
        'tipo_movimiento': mov.tipo_movimiento,
        'cantidad': mov.cantidad,
        'observacion': mov.observacion,
        'usuario': mov.usuario.username if mov.usuario else 'N/A',
    }


def _progreso_pedido(pedido):
    """% de avance sobre los ítems activos (todos menos los suspendidos, que no
    cuentan ni arriba ni abajo de la fracción). Cada ítem aporta una fracción
    entre 0 y 1:
      - Ítem sin modo parcial: 1 si está listo o entregado parcial, 0 si no.
      - Ítem con modo parcial activado: cantidad_entregada_total / item.cantidad
        (topeada a 1).
    El progreso es la suma de fracciones sobre el número de ítems activos."""
    items_activos = [i for i in pedido.items if i.estado_item != 'suspendido']
    if not items_activos:
        return 0
    suma_fracciones = 0.0
    for i in items_activos:
        if i.modo_entregas_parciales:
            total = i.cantidad or 0
            entregado = sum(e.cantidad_entregada for e in i.entregas)
            suma_fracciones += min(entregado / total, 1.0) if total else 0
        elif i.estado_item in ('listo', 'entregado_parcial'):
            suma_fracciones += 1
    return suma_fracciones / len(items_activos) * 100


def _items_incompletos(pedido):
    """Ítems activos (no suspendidos) que todavía no están completos. Usa la
    MISMA definición de 'completo' que _progreso_pedido (fracción == 1), para que
    la coherencia estado-pedido ↔ estado-ítems no diverja de la barra de avance:
      - Ítem sin modo parcial: completo si está 'listo' o 'entregado_parcial'.
      - Ítem con modo parcial: completo si ya entregó toda su cantidad.
    Un pedido sin ítems activos (todos suspendidos, o sin ítems) devuelve []."""
    incompletos = []
    for i in pedido.items:
        if i.estado_item == 'suspendido':
            continue
        if i.modo_entregas_parciales:
            total = i.cantidad or 0
            entregado = sum(e.cantidad_entregada for e in i.entregas)
            completo = bool(total) and entregado >= total
        else:
            completo = i.estado_item in ('listo', 'entregado_parcial')
        if not completo:
            incompletos.append(i)
    return incompletos


def faltante_a_dict(f):
    return {
        'id': f.id,
        'item_id': f.item_id,
        'cantidad_faltante': f.cantidad_faltante,
        'unidad': f.unidad or 'etiquetas',
        'departamento_origen': f.departamento_origen or 'Corte',
        'motivo': f.motivo or '',
        'resuelto': bool(f.resuelto),
        'fecha': _fmt_fecha(f.fecha),
        'fecha_resolucion': _fmt_fecha(f.fecha_resolucion),
        'usuario_id': f.usuario_id,
    }


def pedido_a_dict(p, incluir_referencias=False):
    items_dict = []
    tiene_faltantes_activos = False
    for indice, i in enumerate(p.items):
        item_faltantes = [faltante_a_dict(f) for f in getattr(i, 'faltantes', [])]
        item_tiene_faltantes = any(not f['resuelto'] for f in item_faltantes)
        if item_tiene_faltantes:
            tiene_faltantes_activos = True
        items_dict.append({
            'id': i.id,
            'codigo': i.codigo,
            'descripcion': i.descripcion,
            'cantidad': i.cantidad,
            'estado_item': i.estado_item or 'pendiente',
            'fecha_estado': _fmt_fecha(i.fecha_estado),
            'observacion': i.observacion,
            'modo_entregas_parciales': bool(i.modo_entregas_parciales),
            'faltantes': item_faltantes,
            'tiene_faltantes_activos': item_tiene_faltantes,
            'entregas': [{'id': e.id,
                          'cantidad_entregada': e.cantidad_entregada,
                          'fecha': _fmt_fecha(e.fecha),
                          'observacion': e.observacion}
                         for e in i.entregas],
            'cantidad_entregada_total': sum(
                e.cantidad_entregada for e in i.entregas)
        })
        # Las referencias solo se resuelven en el detalle, con coste acotado.
        # Sin coincidencia única del cliente, no elegir un producto arbitrario.
        if incluir_referencias and indice < 50:
            items_dict[-1].update({'imagen_url': None, 'imagen_referencia': None, 'material_sku': None})
            catalogo = _catalogo_item(i, p.cliente)
            if catalogo is not None:
                items_dict[-1].update({
                    'imagen_url': (f'/uploads/catalogo/{catalogo.imagen_referencia}'
                                   if catalogo.imagen_referencia else None),
                    'imagen_referencia': catalogo.imagen_referencia,
                    'material_sku': catalogo.material.codigo_barras if catalogo.material else None,
                })

    return {
        'id': p.id,
        'revision': p.revision,
        'cliente': p.cliente,
        'orden_compra': p.orden_compra,
        'fecha_entrega': p.fecha_entrega,
        'fecha_emision': _fmt_fecha(p.fecha_emision),
        'fecha_modificacion': _fmt_fecha(p.fecha_modificacion),
        'estado': p.estado,
        'total_items': p.total_items,
        'total_unidades': p.total_unidades,
        'fecha_entregado': _fmt_fecha(p.fecha_entregado),
        'observacion_retroceso': p.observacion_retroceso,
        'progreso': _progreso_pedido(p),
        'tiene_faltantes_activos': tiene_faltantes_activos,
        'maquina_asignada': p.maquina_asignada,
        'url_factura': p.url_factura,
        'fecha_inicio_produccion': p.fecha_inicio_produccion.isoformat() if p.fecha_inicio_produccion else None,
        'fecha_fin_produccion': p.fecha_fin_produccion.isoformat() if p.fecha_fin_produccion else None,
        'minutos_estimados': round(p.minutos_estimados or 0.0, 1),
        'items': items_dict,
    }


def producto_a_dict(pr):
    return {
        'id': pr.id,
        'codigo': pr.codigo,
        'cliente': pr.cliente,
        'descripcion': pr.descripcion,
        'cant_etiquetas_plancha': pr.cant_etiquetas_plancha,
        'cant_planchas': pr.cant_planchas,
        'cant_rollos': pr.cant_rollos,
        'cant_etiquetas_rollo': pr.cant_etiquetas_rollo,
        'largo_plancha_impresa': pr.largo_plancha_impresa,
        'largo_rollo': pr.largo_rollo,
        'ancho_rollo': pr.ancho_rollo,
        'material_id': pr.material_id,
        'material_sku': pr.material.codigo_barras if pr.material else None,
        'imagen_referencia': pr.imagen_referencia,
        'imagen_url': (f'/uploads/catalogo/{pr.imagen_referencia}'
                       if pr.imagen_referencia else None),
        'tipo_codigo': pr.tipo_codigo or 'normal',
        'tiempo_base_minutos': pr.tiempo_base_minutos if pr.tiempo_base_minutos is not None else 1.0,
        'maquina_requerida': pr.maquina_requerida,
    }


def cliente_a_dict(c):
    return {
        'id': c.id,
        'codigo': c.codigo,
        'nombre': c.nombre,
        'ruc': c.ruc,
        'direccion_facturacion': c.direccion_facturacion,
        'direccion_entrega': c.direccion_entrega,
        'contacto_principal': c.contacto_principal,
        'horarios_entrega': c.horarios_entrega,
        'plazos_entrega': c.plazos_entrega,
        'logo_filename': c.logo_filename,
        'logo_url': f'/uploads/logos/{c.logo_filename}' if c.logo_filename else None,
    }


# ── Materiales ────────────────────────────────────────────────────────────

@main_bp.route('/api/materiales', methods=['GET'])
@login_required
def get_materiales():
    materiales = Material.query.order_by(Material.nombre).all()
    return jsonify([material_a_dict(m) for m in materiales])


@main_bp.route('/api/materiales', methods=['POST'])
@login_required
@roles_required('jefe', 'admin')
def crear_material():
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para agregar materiales'}), 403
    try:
        data = request.get_json() or {}
        codigo = (data.get('codigo_barras') or '').strip().upper()
        nombre = (data.get('nombre') or '').strip()
        categoria = (data.get('categoria') or '').strip()
        if not codigo:
            return jsonify({'error': 'El código de barras es obligatorio'}), 400
        if not nombre:
            return jsonify({'error': 'El nombre es obligatorio'}), 400
        if not categoria:
            return jsonify({'error': 'La categoría es obligatoria'}), 400
        if categoria not in CATEGORIAS_VALIDAS:
            return jsonify({'error': f'Categoría inválida. Válidas: {", ".join(CATEGORIAS_VALIDAS)}'}), 400
        tipo = (data.get('tipo') or 'Sustrato').strip() or 'Sustrato'
        if tipo not in TIPOS_VALIDOS:
            return jsonify({'error': f'Tipo inválido. Válidos: {", ".join(TIPOS_VALIDOS)}'}), 400
        cantidad = _entero(data.get('stock_actual', 0), 'stock_actual')
        stock_minimo = _entero(data.get('stock_minimo', 0), 'stock_minimo')

        existente = Material.query.filter_by(codigo_barras=codigo).first()
        if existente:
            existente.stock_actual += cantidad
            _actualizar_estado(existente)
            db.session.commit()
            return jsonify({'mensaje': f'Stock sumado al material existente {codigo}',
                            'material': material_a_dict(existente)})

        ancho = data.get('ancho_material_cm')
        # clasificacion y unidad_medida se calculan siempre en el backend
        m = Material(
            codigo_barras=codigo,
            nombre=nombre,
            categoria=categoria,
            tipo=tipo,
            metros_por_rollo=_flotante(data.get('metros_por_rollo'), 'metros_por_rollo'),
            stock_actual=cantidad,
            stock_minimo=stock_minimo,
            stock_critico=stock_minimo,
            unidad_medida=MAPEO_UNIDAD.get(categoria),
            clasificacion=MAPEO_CLASIFICACION.get(categoria),
            color=data.get('color'),
            capacidad=data.get('capacidad'),
            gramaje=data.get('gramaje'),
            proveedor=data.get('proveedor'),
            ancho_material_cm=_flotante(ancho, 'ancho_material_cm') if ancho not in (None, '') else None,
            acabado=(data.get('acabado') or None),
        )
        _actualizar_estado(m)
        db.session.add(m)
        db.session.commit()
        return jsonify({'mensaje': 'Material creado',
                        'material': material_a_dict(m)}), 201
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Ese código de barras ya existe'}), 400
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/materiales/<int:material_id>', methods=['PUT'])
@login_required
@roles_required('admin', 'jefe')
def editar_material(material_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para editar materiales'}), 403
    m = db.session.get(Material, material_id)
    if not m:
        return jsonify({'error': 'Material no encontrado'}), 404
    try:
        data = request.get_json() or {}
        conflicto = _comprobar_revision(data, m)
        if conflicto is not None:
            return conflicto
        if 'codigo_barras' in data:
            codigo = (data.get('codigo_barras') or '').strip().upper()
            if not codigo:
                return jsonify({'error': 'El código de barras no puede quedar vacío'}), 400
            m.codigo_barras = codigo
        if 'nombre' in data:
            nombre = (data.get('nombre') or '').strip()
            if not nombre:
                return jsonify({'error': 'El nombre no puede quedar vacío'}), 400
            m.nombre = nombre
        if 'categoria' in data:
            categoria = (data.get('categoria') or '').strip()
            if categoria not in CATEGORIAS_VALIDAS:
                return jsonify({'error': f'Categoría inválida. Válidas: {", ".join(CATEGORIAS_VALIDAS)}'}), 400
            m.categoria = categoria
        if 'tipo' in data:
            tipo = (data.get('tipo') or '').strip()
            if tipo not in TIPOS_VALIDOS:
                return jsonify({'error': f'Tipo inválido. Válidos: {", ".join(TIPOS_VALIDOS)}'}), 400
            m.tipo = tipo
        if 'metros_por_rollo' in data:
            m.metros_por_rollo = _flotante(data.get('metros_por_rollo'), 'metros_por_rollo')
        if 'stock_actual' in data:
            m.stock_actual = _entero(data.get('stock_actual'), 'stock_actual')
        if 'stock_minimo' in data:
            m.stock_minimo = _entero(data.get('stock_minimo'), 'stock_minimo')
        m.stock_critico = m.stock_minimo
        # unidad_medida se ignora del payload — se deriva de la categoria abajo
        for campo in ('color', 'capacidad', 'gramaje', 'proveedor', 'acabado'):
            if campo in data:
                setattr(m, campo, data.get(campo))
        if 'ancho_material_cm' in data:
            ancho = data.get('ancho_material_cm')
            m.ancho_material_cm = _flotante(ancho, 'ancho_material_cm') if ancho not in (None, '') else None
        # clasificacion y unidad_medida siempre coherentes con la categoria final
        m.clasificacion = MAPEO_CLASIFICACION.get(m.categoria)
        m.unidad_medida = MAPEO_UNIDAD.get(m.categoria)
        _actualizar_estado(m)
        db.session.commit()
        return jsonify({'mensaje': 'Material actualizado',
                        'material': material_a_dict(m)})
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Ese código de barras ya existe'}), 400
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/materiales/<int:material_id>', methods=['DELETE'])
@login_required
@roles_required('admin', 'jefe')
def eliminar_material(material_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para eliminar materiales'}), 403
    m = db.session.get(Material, material_id)
    if not m:
        return jsonify({'error': 'Material no encontrado'}), 404
    if (Movimiento.query.filter_by(material_id=material_id).first()
            or ProductoCatalogo.query.filter_by(material_id=material_id).first()):
        return jsonify({'error': 'No se puede eliminar un material vinculado al catálogo o con movimientos registrados'}), 400
    try:
        db.session.delete(m)
        db.session.commit()
        return jsonify({'mensaje': f'Material {m.codigo_barras} eliminado'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/materiales/contador-criticos', methods=['GET'])
@login_required
def contador_criticos():
    contador = Material.query.filter(
        Material.estado.in_(['Crítico', 'Agotado'])).count()
    return jsonify({'contador': contador})


# ── Movimientos ───────────────────────────────────────────────────────────

@main_bp.route('/api/movimientos', methods=['GET'])
@login_required
def get_movimientos():
    movimientos = (Movimiento.query
                   .order_by(Movimiento.fecha.desc(), Movimiento.id.desc())
                   .limit(50).all())
    return jsonify([movimiento_a_dict(mov) for mov in movimientos])


@main_bp.route('/api/movimientos', methods=['POST'])
@login_required
def procesar_movimiento():
    try:
        data = request.get_json() or {}
        codigo = (data.get('codigo_barras') or '').strip().upper()
        if not codigo:
            return jsonify({'error': 'El código de barras es obligatorio'}), 400
        tipo = data.get('tipo_movimiento')
        if tipo not in ('Entrada', 'Salida'):
            return jsonify({'error': "tipo_movimiento debe ser 'Entrada' o 'Salida'"}), 400
        cantidad = _entero(data.get('cantidad'), 'cantidad', minimo=1)

        material = Material.query.filter_by(codigo_barras=codigo).first()
        if not material:
            return jsonify({'error': f'No existe un material con código {codigo}'}), 404

        if tipo == 'Salida':
            if material.stock_actual < cantidad:
                unidad = material.unidad_medida or 'rollos'
                return jsonify({'error': (
                    f'Stock insuficiente para {material.nombre}: '
                    f'hay {material.stock_actual} {unidad} disponibles '
                    f'y se intentó sacar {cantidad}')}), 400
            material.stock_actual -= cantidad
        else:
            material.stock_actual += cantidad
        _actualizar_estado(material)

        mov = Movimiento(
            material_id=material.id,
            usuario_id=current_user.id,
            tipo_movimiento=tipo,
            cantidad=cantidad,
            observacion=(data.get('observacion') or '').strip() or None,
        )
        db.session.add(mov)
        db.session.commit()
        return jsonify({'mensaje': 'Movimiento registrado',
                        'movimiento': movimiento_a_dict(mov),
                        'material': material_a_dict(material)}), 201
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


# ── Pedidos ───────────────────────────────────────────────────────────────

def _validar_items_pedido(items_data, conservar_ids=False):
    """Valida y normaliza los items del payload. Devuelve lista de dicts."""
    if not isinstance(items_data, list) or not items_data:
        raise ValueError('El pedido debe tener al menos un ítem')
    items = []
    for item in items_data:
        codigo = (item.get('codigo') or '').strip().upper() or 'S/C'
        descripcion = (item.get('descripcion') or '').strip()
        if not descripcion:
            raise ValueError('Cada ítem debe tener una descripción')
        cantidad = _entero(item.get('cantidad'), 'La cantidad del ítem', minimo=1)
        campos = {'codigo': codigo, 'descripcion': descripcion, 'cantidad': cantidad}
        if conservar_ids and item.get('id') is not None:
            campos['id'] = _entero(item['id'], 'id del ítem', minimo=1)
        items.append(campos)
    return items


def _validar_tipos_cabecera_pedido(data):
    if data.get('cliente') is not None and type(data['cliente']) not in (str, int):
        raise ValueError('cliente debe ser un nombre o ID de cliente')
    if data.get('fecha_entrega') is not None and not isinstance(data['fecha_entrega'], str):
        raise ValueError('fecha_entrega debe ser texto')


@main_bp.route('/api/pedidos', methods=['GET'])
@login_required
def get_pedidos():
    pedidos = (Pedido.query
               .options(selectinload(Pedido.items).selectinload(PedidoItem.entregas),
                        selectinload(Pedido.items).selectinload(PedidoItem.faltantes))
               .order_by(Pedido.id.desc())
               .all())
    return jsonify([pedido_a_dict(p) for p in pedidos])


@main_bp.route('/api/pedidos', methods=['POST'])
@login_required
@roles_required('jefe', 'admin')
def crear_pedido():
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para crear pedidos'}), 403
    try:
        data = request.get_json() or {}
        _validar_tipos_cabecera_pedido(data)
        cliente_raw = data.get('cliente')
        if cliente_raw is None or (isinstance(cliente_raw, str) and not cliente_raw.strip()):
            return jsonify({'error': 'El cliente es obligatorio'}), 400

        # Resolución / creación rápida de cliente
        cliente_nombre = None
        if isinstance(cliente_raw, int) or (isinstance(cliente_raw, str) and cliente_raw.isdigit()):
            c_existente = db.session.get(Cliente, int(cliente_raw))
            if c_existente:
                cliente_nombre = c_existente.nombre

        if not cliente_nombre:
            nombre_str = str(cliente_raw).strip()
            # Buscar si ya existe por nombre insensible a mayúsculas
            c_existente = Cliente.query.filter(
                db.func.upper(Cliente.nombre) == nombre_str.upper()
            ).first()
            if not c_existente:
                # Crear nuevo registro en Cliente sin violar restricciones NOT NULL de la BD
                c_existente = _crear_nuevo_cliente_rapido(nombre_str)
            cliente_nombre = c_existente.nombre

        orden_compra = (data.get('orden_compra') or '').strip()
        if not orden_compra:
            orden_compra = 'S/N'
        
        fecha_entrega = (str(data.get('fecha_entrega') or '')).strip()
        if not fecha_entrega:
            return jsonify({'error': 'La fecha de entrega es obligatoria'}), 400
        items = _validar_items_pedido(data.get('items'))

        pedido = Pedido(
            cliente=cliente_nombre,
            orden_compra=orden_compra,
            fecha_entrega=fecha_entrega, 
            estado='En Cola',
            total_items=len(items),
            total_unidades=sum(i['cantidad'] for i in items),
        )
        db.session.add(pedido)
        for i in items:
            pedido.items.append(PedidoItem(**i))
        db.session.commit()
        return jsonify({'mensaje': 'Pedido creado',
                        'pedido': pedido_a_dict(pedido)}), 201
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


def _crear_nuevo_cliente_rapido(nombre):
    """Crea un nuevo registro en Cliente llenando los campos con defaults
    seguros para no violar restricciones de unicidad o NOT NULL."""
    base = ''.join(c for c in nombre.upper() if c.isascii() and c.isalnum())[:4] or 'CLI'
    codigo_base = f'{base}{datetime.now().year}'
    codigo = codigo_base
    sufijo = 2
    while Cliente.query.filter_by(codigo=codigo).first():
        codigo = f'{codigo_base}-{sufijo}'
        sufijo += 1

    nuevo = Cliente(
        codigo=codigo,
        nombre=nombre.strip().upper(),
        ruc='',
        direccion_facturacion='',
        direccion_entrega='',
        contacto_principal='',
        horarios_entrega='',
        plazos_entrega=''
    )
    db.session.add(nuevo)
    db.session.flush()
    return nuevo


# ── Lectura de documento (OCR/PDF) para autocompletar Nuevo Pedido ──────

EXTENSIONES_DOCUMENTO_PEDIDO = {'pdf', 'png', 'jpg', 'jpeg', 'webp'}

_RE_CLIENTE = re.compile(r'(?im)^[ \t]*cliente[ \t]*:?[ \t]*[-–]?[ \t]*(.+?)[ \t]*$')
_RE_OC_CODIGO = re.compile(r'(?i)\b(?:OC|PO)[ \t\-]?\d[\w\-]*')
_RE_OC_NUMERO = re.compile(r'(?i)\bN[°ºo]\.?[ \t]*[:\-]?[ \t]*(\d[\w\-]*)')
_RE_OC_ETIQUETA = re.compile(r'(?im)^[ \t]*orden(?:[ \t]+de[ \t]+compra)?[ \t]*:?[ \t]*[-–]?[ \t]*(.+?)[ \t]*$')
_RE_FECHA = re.compile(r'\b(\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{1,2}-\d{1,2})\b')
_RE_ITEM = re.compile(r'^([A-Z0-9][A-Z0-9\-/]{1,19})\s+(.{3,80}?)\s+(\d{1,5})$', re.I)
_PALABRAS_EXCLUIDAS_ITEM = ('cliente', 'orden', 'fecha', 'entrega', 'delivery')


def _extraer_texto_pdf(archivo):
    with pdfplumber.open(archivo.stream) as pdf:
        if not pdf.pages:
            return ''
        return pdf.pages[0].extract_text() or ''


def _extraer_texto_imagen(archivo):
    archivo.seek(0)
    imagen = PILImage.open(io.BytesIO(archivo.read()))
    if imagen.mode not in ('L', 'RGB'):
        imagen = imagen.convert('RGB')
    # gunicorn corre como servicio systemd y no hereda el PATH del usuario,
    # así que apuntamos pytesseract al ejecutable de forma explícita. Se busca
    # primero en el PATH (dev: Homebrew /opt/homebrew/bin) y si no aparece se
    # usa la ruta fija de producción (/usr/bin/tesseract en el Ubuntu real).
    pytesseract.pytesseract.tesseract_cmd = shutil.which('tesseract') or '/usr/bin/tesseract'
    try:
        return pytesseract.image_to_string(imagen, lang='spa+eng')
    except pytesseract.TesseractError:
        # el paquete de idioma 'spa' puede no estar instalado en el servidor
        return pytesseract.image_to_string(imagen)


def _extraer_cliente(texto):
    m = _RE_CLIENTE.search(texto)
    if not m:
        return None
    valor = m.group(1).strip()
    return valor or None


def _extraer_orden_compra(texto):
    m = _RE_OC_CODIGO.search(texto)
    if m:
        return m.group(0).strip()
    m = _RE_OC_NUMERO.search(texto)
    if m:
        return m.group(0).strip()
    m = _RE_OC_ETIQUETA.search(texto)
    if m:
        valor = m.group(1).strip()
        return valor or None
    return None


def _normalizar_fecha(valor):
    valor = valor.strip()
    formato = '%d/%m/%Y' if '/' in valor else '%Y-%m-%d'
    try:
        return datetime.strptime(valor, formato).strftime('%Y-%m-%d')
    except ValueError:
        return None


def _extraer_fecha_entrega(texto):
    lineas = texto.splitlines()
    for palabra in ('entrega', 'delivery', 'fecha'):
        for linea in lineas:
            if palabra in linea.lower():
                m = _RE_FECHA.search(linea)
                if m:
                    fecha = _normalizar_fecha(m.group(1))
                    if fecha:
                        return fecha
    m = _RE_FECHA.search(texto)
    return _normalizar_fecha(m.group(1)) if m else None


def _extraer_items(texto):
    items = []
    for linea in texto.splitlines():
        linea = linea.strip()
        if not linea or linea.lower().startswith(_PALABRAS_EXCLUIDAS_ITEM):
            continue
        m = _RE_ITEM.match(linea)
        if not m:
            continue
        codigo, descripcion, cantidad = m.groups()
        items.append({'codigo': codigo.strip().upper(),
                      'descripcion': descripcion.strip(),
                      'cantidad': int(cantidad)})
    return items[:50]


@main_bp.route('/api/pedidos/leer-documento', methods=['POST'])
@login_required
def leer_documento_pedido():
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para esta acción'}), 403
    archivo = request.files.get('archivo')
    if not archivo or not archivo.filename:
        return jsonify({'error': 'No se envió ningún archivo'}), 400
    ext = archivo.filename.rsplit('.', 1)[-1].lower() if '.' in archivo.filename else ''
    if ext not in EXTENSIONES_DOCUMENTO_PEDIDO:
        return jsonify({'error': 'Formato no permitido. Use PDF, PNG, JPG o WEBP'}), 400
    try:
        texto = _extraer_texto_pdf(archivo) if ext == 'pdf' else _extraer_texto_imagen(archivo)
    except pytesseract.TesseractNotFoundError:
        return jsonify({'error': 'OCR no disponible en el servidor. Instale tesseract-ocr '
                                  '(sudo apt install tesseract-ocr)'}), 500
    except Exception as e:
        return jsonify({'error': f'No se pudo leer el documento: {e}'}), 400

    return jsonify({
        'cliente': _extraer_cliente(texto),
        'orden_compra': _extraer_orden_compra(texto),
        'fecha_entrega': _extraer_fecha_entrega(texto),
        'items': _extraer_items(texto),
    })


@main_bp.route('/api/pedidos/<int:pedido_id>', methods=['GET'])
@login_required
def get_pedido(pedido_id):
    pedido = db.session.get(
        Pedido, pedido_id, options=(selectinload(Pedido.items).selectinload(PedidoItem.entregas),
                                  selectinload(Pedido.items).selectinload(PedidoItem.faltantes)))
    if not pedido:
        return jsonify({'error': 'Pedido no encontrado'}), 404
    return jsonify(pedido_a_dict(pedido, incluir_referencias=True))


@main_bp.route('/api/pedidos/<int:pedido_id>', methods=['PUT'])
@login_required
def editar_pedido(pedido_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para editar pedidos'}), 403
    pedido = db.session.get(Pedido, pedido_id)
    if not pedido:
        return jsonify({'error': 'Pedido no encontrado'}), 404
    if pedido.estado == 'Entregado' and not es_jefe():
        return jsonify({'error': 'Solo el Jefe puede editar un pedido Entregado'}), 403
    try:
        data = request.get_json() or {}
        conflicto = _comprobar_revision(data, pedido)
        if conflicto is not None:
            return conflicto
        _validar_tipos_cabecera_pedido(data)
        cliente_raw = data.get('cliente')
        cliente_nombre = None
        if isinstance(cliente_raw, int) or (isinstance(cliente_raw, str) and cliente_raw.isdigit()):
            c_existente = db.session.get(Cliente, int(cliente_raw))
            if c_existente:
                cliente_nombre = c_existente.nombre

        if not cliente_nombre:
            nombre_str = str(cliente_raw or '').strip()
            if not nombre_str:
                return jsonify({'error': 'El cliente es obligatorio'}), 400
            c_existente = Cliente.query.filter(
                db.func.upper(Cliente.nombre) == nombre_str.upper()
            ).first()
            if not c_existente:
                c_existente = _crear_nuevo_cliente_rapido(nombre_str)
            cliente_nombre = c_existente.nombre
        cliente = cliente_nombre
        
        orden_compra = (data.get('orden_compra') or '').strip()
        if not orden_compra:
            return jsonify({'error': 'La Orden de Compra es obligatoria'}), 400
        
        fecha_entrega = (str(data.get('fecha_entrega') or '')).strip()
        if not fecha_entrega:
            return jsonify({'error': 'La fecha de entrega es obligatoria'}), 400
        items = _validar_items_pedido(data.get('items'), conservar_ids=True)

        if pedido.estado == 'Entregado':
            _aplicar_impacto_stock(pedido, -1)

        existentes = {item.id: item for item in pedido.items}
        conservados = set()
        for campos in items:
            item_id = campos.pop('id', None)
            item = existentes.get(item_id) if item_id is not None else None
            if item_id is not None and (item is None or item_id in conservados):
                raise ValueError('Ítem inválido o repetido en este pedido')
            if item_id is None:
                # Compatibilidad con formularios anteriores que no enviaban ID.
                item = next((i for i in existentes.values() if i.id not in conservados
                             and i.codigo == campos['codigo']
                             and i.descripcion == campos['descripcion']), None)
            if item is None:
                estado = 'listo' if pedido.estado in ('Terminado', 'Facturado', 'Retiro en Fábrica', 'Entregado') else 'pendiente'
                pedido.items.append(PedidoItem(**campos, estado_item=estado))
                continue
            if campos['cantidad'] < sum(e.cantidad_entregada for e in item.entregas):
                raise ValueError('La cantidad del ítem no puede ser menor a sus entregas registradas')
            for campo, valor in campos.items():
                setattr(item, campo, valor)
            conservados.add(item.id)
        for item in existentes.values():
            if item.id not in conservados:
                pedido.items.remove(item)
        pedido.cliente = cliente
        pedido.orden_compra = orden_compra
        pedido.fecha_entrega = fecha_entrega
        pedido.total_items = len(items)
        pedido.total_unidades = sum(i['cantidad'] for i in items)
        db.session.flush()
        db.session.expire(pedido, ['items'])

        if pedido.estado == 'Entregado':
            _aplicar_impacto_stock(pedido, 1)

        db.session.commit()
        return jsonify({'mensaje': 'Pedido actualizado',
                        'pedido': pedido_a_dict(pedido)})
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/pedidos/<int:pedido_id>', methods=['DELETE'])
@login_required
def eliminar_pedido(pedido_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para eliminar pedidos'}), 403
    pedido = db.session.get(Pedido, pedido_id)
    if not pedido:
        return jsonify({'error': 'Pedido no encontrado'}), 404
    try:
        if pedido.estado == 'Entregado':
            _aplicar_impacto_stock(pedido, -1)
        db.session.delete(pedido)
        db.session.commit()
        return jsonify({'mensaje': f'Pedido #{pedido_id} eliminado'})
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/pedidos/<int:pedido_id>/estado', methods=['PUT'])
@login_required
def actualizar_estado(pedido_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para mover pedidos'}), 403
    pedido = db.session.get(Pedido, pedido_id)
    if not pedido:
        return jsonify({'error': 'Pedido no encontrado'}), 404
    try:
        data = request.get_json() or {}
        nuevo = (data.get('estado') or '').strip()
        if nuevo not in ESTADOS_PEDIDO:
            return jsonify({'error': f'Estado inválido. Válidos: {", ".join(ESTADOS_PEDIDO)}'}), 400
        permitidos = TRANSICIONES_PEDIDO.get(pedido.estado, ())
        if nuevo not in permitidos:
            return jsonify({'error': (
                f'Transición inválida: {pedido.estado} → {nuevo}. '
                f'Desde {pedido.estado} solo se permite: '
                f'{" o ".join(permitidos) if permitidos else "ninguna"}')}), 400

        if nuevo == 'Terminado':
            # Al terminar el pedido, los ítems que sigan en 'pendiente' se
            # marcan automáticamente como 'listo' en ese mismo momento, para
            # que el progreso quede en 100% y no haya inconsistencias en los
            # reportes. Ya no se rechaza por ítems sin completar.
            for item in pedido.items:
                if item.estado_item == 'pendiente':
                    item.estado_item = 'listo'
                    item.fecha_estado = hora_ecuador()

        pedido.estado = nuevo
        if nuevo == 'Entregado' and pedido.fecha_entregado is None:
            pedido.fecha_entregado = hora_ecuador()
            _aplicar_impacto_stock(pedido, 1)
        db.session.commit()
        return jsonify({'mensaje': f'Pedido #{pedido.id} ahora está {nuevo}',
                        'pedido': pedido_a_dict(pedido)})
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/pedidos/<int:pedido_id>/retroceder', methods=['PUT'])
@login_required
def retroceder_pedido(pedido_id):
    pedido = db.session.get(Pedido, pedido_id)
    if not pedido:
        return jsonify({'error': 'Pedido no encontrado'}), 404
    try:
        data = request.get_json() or {}
        observacion = (data.get('observacion') or '').strip()
        if not observacion:
            return jsonify({
                'error': 'La observación del retroceso es obligatoria'}), 400

        # Estado anterior según el actual. Solo Procesando/Terminado retroceden.
        estados_anteriores = {'Procesando': 'En Cola', 'Terminado': 'Procesando', 'Facturado': 'Terminado'}
        anterior = estados_anteriores.get(pedido.estado)
        if not anterior:
            return jsonify({'error': (
                f'No se puede retroceder un pedido en estado "{pedido.estado}". '
                'Solo se permite desde Procesando, Terminado o Facturado.')}), 400

        # Guardar el estado actual de cada ítem antes de retroceder, y restaurar
        # estado_item desde el previo si existe. Como acabamos de guardarlo, el
        # retroceso NO altera el estado individual de los ítems (quedan como
        # estaban); el snapshot queda disponible en estado_item_previo.
        for item in pedido.items:
            item.estado_item_previo = item.estado_item
            if item.estado_item_previo is not None:
                item.estado_item = item.estado_item_previo

        pedido.observacion_retroceso = observacion
        pedido.estado = anterior
        db.session.commit()
        return jsonify({'mensaje': f'Pedido #{pedido.id} regresado a {anterior}',
                        'pedido': pedido_a_dict(pedido)})
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/pedidos/<int:pedido_id>/items/<int:item_id>/estado', methods=['PUT'])
@login_required
def actualizar_estado_item(pedido_id, item_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar ítems de pedidos'}), 403
    pedido = db.session.get(Pedido, pedido_id)
    if not pedido:
        return jsonify({'error': 'Pedido no encontrado'}), 404
    item = db.session.get(PedidoItem, item_id)
    if not item or item.pedido_id != pedido_id:
        return jsonify({'error': 'Ítem no encontrado en este pedido'}), 404
    try:
        data = request.get_json() or {}
        conflicto = _comprobar_estado_pedido(data, pedido)
        if conflicto is not None:
            return conflicto
        nuevo = (data.get('estado') or '').strip()
        if nuevo not in ESTADOS_ITEM_PEDIDO:
            return jsonify({'error': (
                f'Estado inválido. Válidos: '
                f'{", ".join(ESTADOS_ITEM_PEDIDO)}')}), 400

        if nuevo == 'suspendido':
            observacion = (data.get('observacion') or '').strip()
            if not observacion:
                return jsonify({'error':
                    'La observación es obligatoria para suspender un ítem'}), 400
            item.observacion = observacion

        if nuevo == 'listo' and item.estado_item == 'entregado_parcial':
            return jsonify({'error': (
                'Este ítem ya está en Entrega parcial; quítalo primero '
                'si quieres marcarlo Listo')}), 400

        item.estado_item = nuevo
        item.fecha_estado = hora_ecuador()
        # Coherencia: si al des-completar un ítem el pedido ya estaba
        # 'Terminado', lo devolvemos a 'Procesando' para que no quede
        # "Terminado" con ítems pendientes.
        if pedido.estado in ('Terminado', 'Facturado') and _items_incompletos(pedido):
            pedido.estado = 'Procesando'
        db.session.commit()
        return jsonify({
            'mensaje': f'Ítem #{item.id} ahora está {nuevo}',
            'item': {
                'id': item.id, 'codigo': item.codigo,
                'descripcion': item.descripcion, 'cantidad': item.cantidad,
                'estado_item': item.estado_item,
                'fecha_estado': _fmt_fecha(item.fecha_estado),
                'observacion': item.observacion,
            },
            'progreso': _progreso_pedido(pedido),
        })
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/pedidos/<int:pedido_id>/items/<int:item_id>/entregas',
               methods=['POST'])
@login_required
def registrar_entrega_item(pedido_id, item_id):
    """Registra una salida parcial de `cantidad_entregada` unidades del ítem.
    Cuando la suma de entregas alcanza item.cantidad, el ítem pasa a 'listo'
    automáticamente (y así el progreso del pedido avanza solo)."""
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar ítems de pedidos'}), 403
    pedido = db.session.get(Pedido, pedido_id)
    if not pedido:
        return jsonify({'error': 'Pedido no encontrado'}), 404
    item = db.session.get(PedidoItem, item_id)
    if not item or item.pedido_id != pedido_id:
        return jsonify({'error': 'Ítem no encontrado en este pedido'}), 404
    try:
        data = request.get_json() or {}
        conflicto = _comprobar_estado_pedido(data, pedido)
        if conflicto is not None:
            return conflicto
        cantidad = _entero(data.get('cantidad_entregada'),
                           'cantidad_entregada', minimo=1)
        observacion = (data.get('observacion') or '').strip() or None

        entregado_previo = sum(e.cantidad_entregada for e in item.entregas)
        if entregado_previo + cantidad > item.cantidad:
            restante = item.cantidad - entregado_previo
            return jsonify({'error': (
                f'No se puede entregar {cantidad}: solo faltan {restante} '
                f'de {item.cantidad} unidades por entregar')}), 400

        item.entregas.append(EntregaParcialItem(
            cantidad_entregada=cantidad, observacion=observacion))

        total_entregado = entregado_previo + cantidad
        if total_entregado >= item.cantidad:
            item.estado_item = 'listo'
            item.fecha_estado = hora_ecuador()

        db.session.commit()
        return jsonify({
            'mensaje': (f'Salida de {cantidad} uds registrada en el ítem '
                        f'#{item.id}'),
            'pedido': pedido_a_dict(pedido),
        })
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/pedidos/<int:pedido_id>/items/<int:item_id>/entregas/'
               '<int:entrega_id>', methods=['DELETE'])
@login_required
def eliminar_entrega_item(pedido_id, item_id, entrega_id):
    """Elimina un movimiento de entrega parcial. Si al quitarlo la suma cae por
    debajo del total pedido y el ítem estaba en 'listo' (por haber alcanzado el
    total), vuelve a 'pendiente'."""
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar ítems de pedidos'}), 403
    pedido = db.session.get(Pedido, pedido_id)
    if not pedido:
        return jsonify({'error': 'Pedido no encontrado'}), 404
    item = db.session.get(PedidoItem, item_id)
    if not item or item.pedido_id != pedido_id:
        return jsonify({'error': 'Ítem no encontrado en este pedido'}), 404
    entrega = db.session.get(EntregaParcialItem, entrega_id)
    if not entrega or entrega.item_id != item_id:
        return jsonify({'error': 'Movimiento de entrega no encontrado'}), 404
    try:
        conflicto = _comprobar_estado_pedido(request.get_json(silent=True), pedido)
        if conflicto is not None:
            return conflicto
        db.session.delete(entrega)
        db.session.flush()

        total_entregado = sum(e.cantidad_entregada for e in item.entregas)
        if total_entregado < item.cantidad and item.estado_item == 'listo':
            item.estado_item = 'pendiente'
            item.fecha_estado = hora_ecuador()

        # Coherencia: si al revertir el ítem el pedido ya estaba 'Terminado',
        # lo devolvemos a 'Procesando' (ver _items_incompletos).
        if pedido.estado in ('Terminado', 'Facturado') and _items_incompletos(pedido):
            pedido.estado = 'Procesando'

        db.session.commit()
        return jsonify({
            'mensaje': f'Movimiento de entrega #{entrega_id} eliminado',
            'pedido': pedido_a_dict(pedido),
        })
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/pedidos/<int:pedido_id>/items/<int:item_id>/modo-parcial',
               methods=['PATCH'])
@login_required
def cambiar_modo_parcial_item(pedido_id, item_id):
    """Activa o desactiva el modo de entregas parciales de un ítem según
    {activo: true|false}. Es un interruptor de doble sentido; desactivarlo NO
    borra las entregas ya registradas (solo se ocultan y el ítem vuelve a contar
    como normal en el progreso mientras el modo esté apagado)."""
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar ítems de pedidos'}), 403
    pedido = db.session.get(Pedido, pedido_id)
    if not pedido:
        return jsonify({'error': 'Pedido no encontrado'}), 404
    item = db.session.get(PedidoItem, item_id)
    if not item or item.pedido_id != pedido_id:
        return jsonify({'error': 'Ítem no encontrado en este pedido'}), 404
    try:
        data = request.get_json() or {}
        conflicto = _comprobar_estado_pedido(data, pedido)
        if conflicto is not None:
            return conflicto
        if type(data.get('activo')) is not bool:
            raise ValueError('activo debe ser true o false')
        item.modo_entregas_parciales = data['activo']
        db.session.commit()
        estado = 'activado' if item.modo_entregas_parciales else 'desactivado'
        return jsonify({
            'mensaje': f'Modo entregas parciales {estado} en el ítem #{item.id}',
            'pedido': pedido_a_dict(pedido),
        })
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


# ── Pre-acabados (Comunicación Corte ↔ Impresión: Faltantes / Mermas) ─────

@main_bp.route('/api/pedidos/<int:pedido_id>/items/<int:item_id>/faltantes',
               methods=['POST'])
@login_required
def reportar_faltante_preacabados(pedido_id, item_id):
    """Corte notifica a Impresión un faltante o merma en tiempo real."""
    pedido = db.session.get(Pedido, pedido_id)
    if not pedido:
        return jsonify({'error': 'Pedido no encontrado'}), 404
    item = db.session.get(PedidoItem, item_id)
    if not item or item.pedido_id != pedido_id:
        return jsonify({'error': 'Ítem no encontrado en este pedido'}), 404

    data = request.get_json() or {}
    for campo in ('unidad', 'motivo', 'departamento_origen'):
        if data.get(campo) is not None and not isinstance(data[campo], str):
            return jsonify({'error': f'{campo} debe ser texto'}), 400
    cantidad = data.get('cantidad_faltante') or data.get('cantidad')
    try:
        cantidad = _entero(cantidad, 'Cantidad faltante', minimo=1)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    unidad = (data.get('unidad') or 'etiquetas').strip().lower()
    if unidad not in ['etiquetas', 'planchas']:
        unidad = 'etiquetas'

    motivo = (data.get('motivo') or '').strip()
    departamento = (data.get('departamento_origen') or 'Corte').strip()

    try:
        faltante = ReporteFaltante(
            item_id=item.id,
            cantidad_faltante=cantidad,
            unidad=unidad,
            departamento_origen=departamento,
            motivo=motivo,
            resuelto=False,
            fecha=hora_ecuador(),
            usuario_id=getattr(current_user, 'id', None)
        )
        db.session.add(faltante)
        db.session.commit()

        return jsonify({
            'mensaje': f'Alerta de Pre-acabados enviada a Impresión: {cantidad} {unidad} faltantes',
            'faltante': faltante_a_dict(faltante),
            'pedido': pedido_a_dict(pedido),
        }), 201
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/pedidos/faltantes/<int:faltante_id>/resolver',
               methods=['PUT'])
@login_required
def resolver_faltante_preacabados(faltante_id):
    """Impresión marca como resuelto / reimpreso el faltante reportado por Corte."""
    faltante = db.session.get(ReporteFaltante, faltante_id)
    if not faltante:
        return jsonify({'error': 'Reporte de faltante no encontrado'}), 404

    try:
        faltante.resuelto = True
        faltante.fecha_resolucion = hora_ecuador()
        db.session.commit()

        item = db.session.get(PedidoItem, faltante.item_id)
        pedido = db.session.get(Pedido, item.pedido_id) if item else None

        return jsonify({
            'mensaje': 'Faltante de Pre-acabados marcado como resuelto / reimpreso',
            'faltante': faltante_a_dict(faltante),
            'pedido': pedido_a_dict(pedido) if pedido else None,
        })
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/pedidos/faltantes/<int:faltante_id>',
               methods=['DELETE'])
@login_required
def eliminar_faltante_preacabados(faltante_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para eliminar este reporte'}), 403
    faltante = db.session.get(ReporteFaltante, faltante_id)
    if not faltante:
        return jsonify({'error': 'Reporte de faltante no encontrado'}), 404

    try:
        item = db.session.get(PedidoItem, faltante.item_id)
        pedido = db.session.get(Pedido, item.pedido_id) if item else None
        db.session.delete(faltante)
        db.session.commit()
        return jsonify({
            'mensaje': 'Reporte de faltante eliminado',
            'pedido': pedido_a_dict(pedido) if pedido else None,
        })
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/pedidos/contador-activos', methods=['GET'])
@login_required
def contador_activos():
    contador = Pedido.query.filter(Pedido.estado != 'Entregado').count()
    return jsonify({'contador': contador})


def _parse_entrega(valor):
    """fecha_entrega se guarda como string datetime-local (YYYY-MM-DDTHH:MM).
    Devuelve un datetime naive para comparar contra hora_ecuador(), o None si
    está vacío o no parsea."""
    if not valor:
        return None
    try:
        dt = datetime.fromisoformat(valor)
    except (ValueError, TypeError):
        return None
    if dt.tzinfo:
        import pytz
        dt = dt.astimezone(pytz.timezone('America/Guayaquil')).replace(tzinfo=None)
    return dt



@main_bp.route('/api/pedidos/<int:pedido_id>/factura', methods=['POST'])
@login_required
@roles_required('admin', 'jefe')
def subir_factura(pedido_id):
    p = Pedido.query.get_or_404(pedido_id)
    if 'archivo' not in request.files:
        return jsonify({'error': 'No se envió archivo'}), 400
    file = request.files['archivo']
    if not file.filename:
        return jsonify({'error': 'Archivo sin nombre'}), 400

    extension = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    formatos = {'png': 'PNG', 'jpg': 'JPEG', 'jpeg': 'JPEG', 'webp': 'WEBP'}
    if extension not in {'pdf', *formatos}:
        return jsonify({'error': 'Formato no permitido. Use PDF, PNG, JPG, JPEG o WEBP'}), 400
    try:
        datos = file.read()
        if extension == 'pdf':
            if not datos.startswith(b'%PDF-'):
                raise ValueError('Firma PDF inválida')
            with pdfplumber.open(io.BytesIO(datos)) as documento:
                if not documento.pages:
                    raise ValueError('El PDF no contiene páginas')
        else:
            with PILImage.open(io.BytesIO(datos)) as imagen:
                if imagen.format != formatos[extension]:
                    raise ValueError('El contenido no coincide con la extensión')
                imagen.verify()
            with PILImage.open(io.BytesIO(datos)) as imagen:
                imagen.load()
    except Exception:
        return jsonify({'error': 'El archivo no es un PDF o una imagen válida para su extensión'}), 400

    filename = secure_filename(f"factura_{p.id}_{uuid4().hex}_{file.filename}")
    uploads_dir = _carpeta_facturas()
    ruta = os.path.join(uploads_dir, filename)
    try:
        os.makedirs(uploads_dir, exist_ok=True)
        file.stream.seek(0)
        file.save(ruta)
        p.url_factura = f"/uploads/facturas/{filename}"
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        try:
            if os.path.isfile(ruta):
                os.remove(ruta)
        except OSError:
            current_app.logger.exception('No se pudo eliminar la factura sin referencia')
        if isinstance(e, StaleDataError):
            return _conflicto_guardado()
        return jsonify({'error': f'No se pudo guardar la factura: {e}'}), 400
    
    return jsonify({
        'mensaje': 'Factura subida exitosamente',
        'pedido': pedido_a_dict(p)
    })

@main_bp.route('/api/pedidos/monitor-tv', methods=['GET'])
@login_required
def monitor_tv():
    """Datos para el monitor tipo TV: 4 conteos + tarjetas de pedidos activos.
    Todos los conteos usan datos reales (mismos criterios que el semáforo del
    Kanban de Producción); 'progreso' es el mismo % de ítems listos que usa
    Producción (_progreso_pedido), no un campo inventado."""
    ahora = hora_ecuador()
    hoy = ahora.date()

    en_riesgo_total = 0
    para_hoy_total = 0
    completados_hoy = 0
    activos = []  # (entrega_dt, pedido, en_riesgo)

    entregados_hoy = (Pedido.query
                      .filter(Pedido.estado == 'Entregado',
                              Pedido.fecha_entregado.isnot(None))
                      .all())
    completados_hoy = sum(
        1 for p in entregados_hoy if p.fecha_entregado.date() == hoy)

    pedidos_activos = (Pedido.query
                       .options(selectinload(Pedido.items).selectinload(PedidoItem.entregas))
                       .filter(Pedido.estado != 'Entregado')
                       .all())
    for p in pedidos_activos:
        entrega_dt = _parse_entrega(p.fecha_entrega)

        # Para hoy: la fecha de entrega cae hoy y NO está entregado.
        if entrega_dt and entrega_dt.date() == hoy:
            para_hoy_total += 1

        # En riesgo = atrasado
        en_riesgo = (
            entrega_dt is not None and
            entrega_dt < ahora and
            p.estado not in ('Terminado', 'Facturado', 'Retiro en Fábrica', 'Entregado')
        )
        if en_riesgo:
            en_riesgo_total += 1

        activos.append((entrega_dt, p, en_riesgo))

    # Más urgentes primero: por fecha de entrega ascendente; los sin fecha, al final.
    activos.sort(key=lambda t: (t[0] is None, t[0] or datetime.max))

    # Logo del cliente (solo para las tarjetas del monitor TV, ver
    # docs/base-datos.md — no se expone en pedido_a_dict a propósito para que
    # no aparezca en Producción ni en la lista de Pedidos activos).
    mapa_logos = {
        (c.nombre or '').strip().upper(): f'/uploads/logos/{c.logo_filename}'
        for c in Cliente.query.filter(Cliente.logo_filename.isnot(None)).all()
    }

    pedidos_out = [{
        'id': p.id,
        'cliente': p.cliente,
        'orden_compra': p.orden_compra,
        'estado': p.estado,
        'en_riesgo': en_riesgo,
        'fecha_entrega': p.fecha_entrega,
        'total_items': p.total_items,
        'total_unidades': p.total_unidades,
        'progreso': _progreso_pedido(p),
        'logo_url': mapa_logos.get((p.cliente or '').strip().upper()),
        'url_factura': p.url_factura,
    } for (_dt, p, en_riesgo) in activos]

    return jsonify({
        'activos': len(activos),
        'en_riesgo': en_riesgo_total,
        'para_hoy': para_hoy_total,
        'completados_hoy': completados_hoy,
        'pedidos': pedidos_out,
    })


def _fmt_fecha_entrega(valor):
    """fecha_entrega se guarda como string datetime-local (YYYY-MM-DDTHH:MM).
    Se formatea igual que el frontend (dd/mm/aaaa HH:MM); si no parsea, se
    devuelve tal cual."""
    if not valor:
        return '—'
    try:
        return datetime.fromisoformat(valor).strftime('%d/%m/%Y %H:%M')
    except (ValueError, TypeError):
        return valor


def _celda_imagen_pdf(catalogo, celda_estilo):
    """Miniatura (máx 110x110pt, proporción preservada) para la celda Imagen
    del PDF de un ítem. Solo aplica a códigos 'especial' con imagen_referencia
    JPG/PNG; si el adjunto es PDF se deja un texto en vez de la miniatura;
    en cualquier otro caso (normal, sin imagen, o el archivo no existe en
    disco) la celda queda vacía."""
    if not catalogo or catalogo.tipo_codigo != 'especial' or not catalogo.imagen_referencia:
        return ''
    nombre = catalogo.imagen_referencia
    if nombre.lower().endswith('.pdf'):
        return Paragraph('(ver PDF adjunto)', celda_estilo)
    ruta = os.path.join(current_app.config['UPLOAD_FOLDER'], nombre)
    if not os.path.isfile(ruta):
        return ''
    try:
        ancho_natural, alto_natural = ImageReader(ruta).getSize()
        escala = min(110 / ancho_natural, 110 / alto_natural)
        return Image(ruta, width=ancho_natural * escala, height=alto_natural * escala)
    except Exception:
        return ''


def _sanitizar_nombre_archivo(valor):
    """Reemplaza cualquier carácter fuera de [alfanumérico, -, _] por '_' para
    que el string sea seguro como nombre de archivo (evita '/', espacios, etc)."""
    return ''.join(
        caracter if caracter.isalnum() or caracter in ('-', '_') else '_'
        for caracter in (valor or '')
    ).strip('_')


@main_bp.route('/api/pedidos/<int:pedido_id>/pdf', methods=['GET'])
@login_required
def pedido_pdf(pedido_id):
    pedido = db.session.get(Pedido, pedido_id)
    if not pedido:
        return jsonify({'error': 'Pedido no encontrado'}), 404

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        topMargin=2 * cm, bottomMargin=2 * cm,
        leftMargin=2 * cm, rightMargin=2 * cm,
        title=f'Pedido {pedido.id}')
    estilos = getSampleStyleSheet()
    celda = ParagraphStyle('celda', parent=estilos['Normal'],
                           fontSize=9, leading=12)
    pie = ParagraphStyle('pie', parent=estilos['Normal'],
                         fontSize=8, textColor=colors.grey)

    elementos = [
        Paragraph(
            f'<b>Cliente:</b> {escape(pedido.cliente or "—")}',
            estilos['Normal'],
        ),
        Paragraph(
            f'<b>Orden de Compra:</b> '
            f'{escape(pedido.orden_compra or "—")}',
            estilos['Normal'],
        ),
        Paragraph(
            f'<b>Fecha de emisión:</b> '
            f'{escape(_fmt_fecha(pedido.fecha_emision) or "—")}',
            estilos['Normal'],
        ),
        Paragraph(
            f'<b>Fecha de entrega:</b> '
            f'{escape(_fmt_fecha_entrega(pedido.fecha_entrega))}',
            estilos['Normal'],
        ),
        Spacer(1, 0.5 * cm),
    ]

    # Una sola consulta de catálogo por ítem alimenta tanto la celda de
    # imagen como la lista de materiales (evita duplicar la búsqueda).
    materiales_usados = {}  # material_id → nombre, dedupe preservando orden
    filas = [['N°', 'Código', 'Descripción', 'Cantidad', 'Referencia']]
    for idx, item in enumerate(pedido.items, start=1):
        catalogo = _catalogo_item(item, pedido.cliente)

        if catalogo and catalogo.material_id and catalogo.material_id not in materiales_usados:
            if catalogo.material:
                materiales_usados[catalogo.material_id] = catalogo.material.nombre

        filas.append([
            str(idx),
            Paragraph(escape(item.codigo or 'S/C'), celda),
            Paragraph(escape(item.descripcion or ''), celda),
            str(item.cantidad if item.cantidad is not None else ''),
            _celda_imagen_pdf(catalogo, celda),
        ])

    tabla = Table(filas, colWidths=[1.2 * cm, 2.8 * cm, 5.5 * cm, 2 * cm, 4 * cm],
                  repeatRows=1)
    tabla.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e40af')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),
        ('ALIGN', (3, 0), (3, -1), 'CENTER'),
        ('ALIGN', (4, 0), (4, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1),
         [colors.white, colors.HexColor('#f1f5f9')]),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    elementos.append(tabla)

    if materiales_usados:
        elementos.append(Spacer(1, 0.7 * cm))
        elementos.append(Paragraph('<b>MATERIALES A UTILIZAR</b>', estilos['Normal']))
        elementos.append(Spacer(1, 0.15 * cm))
        for nombre_material in materiales_usados.values():
            elementos.append(Paragraph(f'• {escape(nombre_material)}', celda))

    elementos.append(Spacer(1, 1 * cm))
    elementos.append(Paragraph(
        f'Generado el {_fmt_fecha(hora_ecuador())}', pie))

    doc.build(elementos)
    buffer.seek(0)
    cliente_sanitizado = _sanitizar_nombre_archivo(pedido.cliente) or 'SIN_CLIENTE'
    orden_sanitizada = _sanitizar_nombre_archivo(pedido.orden_compra) or 'SN'
    nombre_archivo = f'{cliente_sanitizado}_{orden_sanitizada}'
    return send_file(
        buffer,
        as_attachment=request.args.get('inline') != '1',
        download_name=f'{nombre_archivo}.pdf',
        mimetype='application/pdf')


# ── Catálogo ──────────────────────────────────────────────────────────────

def _validar_producto(data, producto_id=None):
    """Valida y normaliza el payload de catálogo. Devuelve dict de campos."""
    codigo = (data.get('codigo') or '').strip().upper() or '-'
    descripcion = (data.get('descripcion') or '').strip()
    if not descripcion:
        raise ValueError('La descripción es obligatoria')
    campos = {
        'codigo': codigo,
        'descripcion': descripcion,
        'cliente': (data.get('cliente') or '').strip() or None,
        'largo_plancha_impresa': _flotante(data.get('largo_plancha_impresa'), 'largo_plancha_impresa'),
        'largo_rollo': _flotante(data.get('largo_rollo'), 'largo_rollo'),
        'ancho_rollo': _flotante(data.get('ancho_rollo'), 'ancho_rollo'),
    }
    if codigo != '-':
        coincidencias = ProductoCatalogo.query.filter(
            db.func.upper(db.func.trim(ProductoCatalogo.codigo)) == codigo,
            db.func.upper(db.func.trim(db.func.coalesce(ProductoCatalogo.cliente, '')))
            == (campos['cliente'] or '').upper(),
        )
        if producto_id is not None:
            coincidencias = coincidencias.filter(ProductoCatalogo.id != producto_id)
        if coincidencias.first():
            raise ValueError('Ese código ya existe para ese cliente (sin distinguir mayúsculas)')
    for campo in ('cant_etiquetas_plancha', 'cant_planchas',
                  'cant_rollos', 'cant_etiquetas_rollo'):
        campos[campo] = _entero(data.get(campo) or 0, campo)
    material_id = data.get('material_id')
    if material_id:
        if not db.session.get(Material, material_id):
            raise ValueError('El material vinculado no existe')
        campos['material_id'] = material_id
    else:
        campos['material_id'] = None
    tipo_codigo = (data.get('tipo_codigo') or 'normal').strip().lower()
    if tipo_codigo not in ('normal', 'especial'):
        raise ValueError("tipo_codigo debe ser 'normal' o 'especial'")
    campos['tipo_codigo'] = tipo_codigo

    # ── Planificación Gráfica (Paso 5) ──
    campos['tiempo_base_minutos'] = _flotante(
        data.get('tiempo_base_minutos') if data.get('tiempo_base_minutos') is not None else 1.0,
        'tiempo_base_minutos'
    )
    if campos['tiempo_base_minutos'] <= 0:
        raise ValueError('tiempo_base_minutos debe ser mayor a 0')
    maquina_req = (data.get('maquina_requerida') or '').strip() or None
    if not maquina_req and (codigo == '90006718' or tipo_codigo == 'especial'):
        maquina_req = 'Mesp'
    if maquina_req and maquina_req not in ('M1', 'M2', 'Mesp'):
        raise ValueError('Máquina requerida inválida')
    campos['maquina_requerida'] = maquina_req
    return campos


@main_bp.route('/api/catalogo', methods=['GET'])
@login_required
def get_catalogo():
    productos = ProductoCatalogo.query.order_by(ProductoCatalogo.codigo).all()
    return jsonify([producto_a_dict(pr) for pr in productos])


@main_bp.route('/api/catalogo', methods=['POST'])
@login_required
@roles_required('jefe', 'admin')
def crear_producto():
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar el catálogo'}), 403
    try:
        campos = _validar_producto(request.get_json() or {})
        producto = ProductoCatalogo(**campos)
        db.session.add(producto)
        db.session.commit()
        return jsonify({'mensaje': 'Producto agregado al catálogo',
                        'producto': producto_a_dict(producto)}), 201
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Ese código ya existe para ese cliente'}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/catalogo/<int:producto_id>', methods=['PUT'])
@login_required
@roles_required('admin', 'jefe')
def editar_producto(producto_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar el catálogo'}), 403
    producto = db.session.get(ProductoCatalogo, producto_id)
    if not producto:
        return jsonify({'error': 'Producto no encontrado'}), 404
    try:
        campos = _validar_producto(request.get_json() or {}, producto_id=producto_id)
        for campo, valor in campos.items():
            setattr(producto, campo, valor)
        db.session.commit()
        return jsonify({'mensaje': 'Producto actualizado',
                        'producto': producto_a_dict(producto)})
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Ese código ya existe para ese cliente'}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/catalogo/<int:producto_id>', methods=['DELETE'])
@login_required
@roles_required('admin', 'jefe')
def eliminar_producto(producto_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar el catálogo'}), 403
    producto = db.session.get(ProductoCatalogo, producto_id)
    if not producto:
        return jsonify({'error': 'Producto no encontrado'}), 404
    try:
        db.session.delete(producto)
        db.session.commit()
        return jsonify({'mensaje': f'Producto {producto.codigo} eliminado'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


# ── Imagen/PDF de referencia del catálogo ──────────────────────────────────

def _extension_permitida(nombre):
    return ('.' in nombre and
            nombre.rsplit('.', 1)[1].lower()
            in current_app.config['ALLOWED_EXTENSIONS'])


def _borrar_imagen_disco(nombre):
    """Elimina del disco el archivo de referencia si existe (sin fallar si no)."""
    if not nombre:
        return
    ruta = safe_join(current_app.config['UPLOAD_FOLDER'], nombre)
    if ruta and os.path.isfile(ruta):
        try:
            os.remove(ruta)
        except OSError:
            pass


@main_bp.route('/api/catalogo/<int:producto_id>/imagen', methods=['POST'])
@login_required
@roles_required('admin', 'jefe')
def subir_imagen_catalogo(producto_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar el catálogo'}), 403
    producto = db.session.get(ProductoCatalogo, producto_id)
    if not producto:
        return jsonify({'error': 'Producto no encontrado'}), 404
    archivo = request.files.get('archivo')
    if not archivo or not archivo.filename:
        return jsonify({'error': 'No se envió ningún archivo'}), 400
    if not _extension_permitida(archivo.filename):
        return jsonify({'error': 'Formato no permitido. Use JPG, PNG o PDF'}), 400
    try:
        carpeta = current_app.config['UPLOAD_FOLDER']
        os.makedirs(carpeta, exist_ok=True)
        ext = archivo.filename.rsplit('.', 1)[1].lower()
        nombre = f'{producto_id}_{uuid4().hex}.{ext}'
        anterior = producto.imagen_referencia
        archivo.save(os.path.join(carpeta, nombre))
        producto.imagen_referencia = nombre
        db.session.commit()
        _borrar_imagen_disco(anterior)
        return jsonify({'imagen_url': f'/uploads/catalogo/{nombre}',
                        'imagen_referencia': nombre})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/catalogo/<int:producto_id>/imagen', methods=['DELETE'])
@login_required
@roles_required('admin', 'jefe')
def eliminar_imagen_catalogo(producto_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar el catálogo'}), 403
    producto = db.session.get(ProductoCatalogo, producto_id)
    if not producto:
        return jsonify({'error': 'Producto no encontrado'}), 404
    try:
        anterior = producto.imagen_referencia
        producto.imagen_referencia = None
        db.session.commit()
        _borrar_imagen_disco(anterior)
        return jsonify({'mensaje': 'Imagen de referencia eliminada'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/uploads/catalogo/<path:filename>', methods=['GET'])
def servir_imagen_catalogo(filename):
    # Sin login: solo referencial y accesible desde la red interna.
    # send_from_directory hace safe join y evita path traversal.
    return send_from_directory(current_app.config['UPLOAD_FOLDER'], filename)


def _entero_consumo(valor, campo):
    # Límite común con Number.MAX_SAFE_INTEGER del cliente y con IDs de SQLite.
    try:
        numero = _entero(valor, campo, minimo=1)
    except (ValueError, OverflowError):
        raise ValueError(f'{campo} debe ser un entero positivo finito')
    return entero_seguro(numero, campo)


def _respuesta_consumo(resultado, parametros, lote=False):
    """Ambos formatos usan el mismo cálculo; PDF rechaza revisiones antiguas.

    La huella se calcula sólo con información reconstruida del servidor.
    El timestamp de generación no forma parte de ella. No se guarda en DB.
    """
    resultado['version_calculo'] = 'consumo-mrp-estricto-v1'
    resultado['parametros'] = parametros
    canonico = json.dumps(resultado, sort_keys=True, ensure_ascii=True,
                          separators=(',', ':'), allow_nan=False)
    revision = sha256(canonico.encode('utf-8')).hexdigest()
    resultado['revision_calculo'] = revision
    resultado['generado_en_ecuador'] = hora_ecuador().isoformat(timespec='seconds') + '-05:00'
    if not request.path.endswith('/pdf'):
        return jsonify(resultado)
    esperada = (request.get_json() or {}).get('revision_calculo')
    if not isinstance(esperada, str) or not re.fullmatch(r'[0-9a-f]{64}', esperada):
        return jsonify({'error': 'Calcula el consumo antes de descargar el PDF.',
                        'codigo': 'revision_calculo_requerida'}), 400
    if esperada != revision:
        return jsonify({'error': 'Cambió el catálogo, el pedido o la disponibilidad. Recalcula antes de descargar el PDF.',
                        'codigo': 'calculo_desactualizado'}), 409
    buffer = generar_pdf_consumo(resultado, lote=lote)
    response = send_file(buffer, as_attachment=True, mimetype='application/pdf',
                         download_name='consumo_lote.pdf' if lote else 'consumo_individual.pdf')
    response.headers['Cache-Control'] = 'no-store'
    return response


def _faltantes_consumo(rows):
    return jsonify({'error': 'Completa o corrige los datos indicados para calcular el consumo.',
                    'datos_faltantes': rows}), 400


@main_bp.route('/api/calculadora/planchas/pdf', methods=['POST'], endpoint='calcular_planchas_pdf')
@main_bp.route('/api/calculadora/planchas', methods=['POST'])
@login_required
def calcular_planchas_mrp():
    """Consumo individual y PDF con el mismo rendimiento estricto del MRP."""
    data = request.get_json() or {}
    try:
        cantidad = _entero_consumo(data.get('cantidad'), 'cantidad')
        for campo in ('codigo', 'cliente'):
            if data.get(campo) is not None and not isinstance(data[campo], str):
                raise ValueError(f'{campo} debe ser texto')
        producto_id = data.get('producto_id')
        if producto_id not in (None, ''):
            producto = db.session.get(ProductoCatalogo, _entero_consumo(producto_id, 'producto_id'))
        else:
            codigo = (data.get('codigo') or '').strip().upper()
            if not codigo:
                raise ValueError('Selecciona un producto del catálogo')
            consulta = ProductoCatalogo.query.filter(db.func.upper(db.func.trim(ProductoCatalogo.codigo)) == codigo)
            if data.get('cliente') is not None:
                consulta = consulta.filter(db.func.upper(db.func.trim(db.func.coalesce(ProductoCatalogo.cliente, '')))
                                           == data['cliente'].strip().upper())
            candidatos = consulta.limit(2).all()
            if len(candidatos) > 1:
                raise ValueError('Código compartido: selecciona el producto por su ID o indica el cliente')
            producto = candidatos[0] if candidatos else None
        if producto is None:
            return jsonify({'error': 'Producto no encontrado en el catálogo'}), 404
        datos, faltantes = _datos_produccion_mrp(producto)
        if faltantes:
            return _faltantes_consumo([{'cliente': producto.cliente, 'codigo': producto.codigo,
                                       'descripcion': producto.descripcion, 'campos': faltantes}])
        resultado = calcular_consumo(producto, cantidad, datos)
        resultado['materiales_bodega'] = consolidar_materiales([resultado], {producto.id: producto})
        return _respuesta_consumo(resultado, {'producto_id': producto.id, 'cantidad': cantidad})
    except (ValueError, OverflowError, ZeroDivisionError) as exc:
        return jsonify({'error': f'No se puede calcular con estos valores: {exc}'}), 400


# ── Clientes ──────────────────────────────────────────────────────────────

def _validar_cliente(data):
    codigo = (data.get('codigo') or '').strip().upper()
    if not codigo:
        raise ValueError('El código es obligatorio')
    nombre = (data.get('nombre') or '').strip()
    if not nombre:
        raise ValueError('El nombre es obligatorio')
    return {
        'codigo': codigo,
        'nombre': nombre,
        'ruc': (data.get('ruc') or '').strip() or None,
        'direccion_facturacion': (data.get('direccion_facturacion') or '').strip() or None,
        'direccion_entrega': (data.get('direccion_entrega') or '').strip() or None,
        'contacto_principal': (data.get('contacto_principal') or '').strip() or None,
        'horarios_entrega': (data.get('horarios_entrega') or '').strip() or None,
        'plazos_entrega': (data.get('plazos_entrega') or '').strip() or None,
    }


@main_bp.route('/api/clientes', methods=['GET'])
@login_required
def get_clientes():
    clientes = Cliente.query.order_by(Cliente.nombre).all()
    return jsonify([cliente_a_dict(c) for c in clientes])


@main_bp.route('/api/clientes', methods=['POST'])
@login_required
@roles_required('jefe', 'admin')
def crear_cliente():
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar clientes'}), 403
    try:
        campos = _validar_cliente(request.get_json() or {})
        cliente = Cliente(**campos)
        db.session.add(cliente)
        db.session.commit()
        return jsonify({'mensaje': 'Cliente agregado',
                        'cliente': cliente_a_dict(cliente)}), 201
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Ese código de cliente ya existe'}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/clientes/<int:cliente_id>', methods=['PUT'])
@login_required
@roles_required('admin', 'jefe')
def editar_cliente(cliente_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar clientes'}), 403
    cliente = db.session.get(Cliente, cliente_id)
    if not cliente:
        return jsonify({'error': 'Cliente no encontrado'}), 404
    try:
        campos = _validar_cliente(request.get_json() or {})
        for campo, valor in campos.items():
            setattr(cliente, campo, valor)
        db.session.commit()
        return jsonify({'mensaje': 'Cliente actualizado',
                        'cliente': cliente_a_dict(cliente)})
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Ese código de cliente ya existe'}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/clientes/<int:cliente_id>', methods=['DELETE'])
@login_required
@roles_required('admin', 'jefe')
def eliminar_cliente(cliente_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar clientes'}), 403
    cliente = db.session.get(Cliente, cliente_id)
    if not cliente:
        return jsonify({'error': 'Cliente no encontrado'}), 404
    try:
        db.session.delete(cliente)
        db.session.commit()
        return jsonify({'mensaje': f'Cliente {cliente.nombre} eliminado'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


LOGO_MAX_BYTES = 200 * 1024
LOGO_MAX_DIMENSION = 200


def _carpeta_logos():
    # Misma carpeta raíz de uploads que el catálogo, subcarpeta 'logos'.
    return os.path.join(os.path.dirname(current_app.config['UPLOAD_FOLDER']), 'logos')


def _borrar_logo_disco(nombre):
    if not nombre:
        return
    ruta = safe_join(_carpeta_logos(), nombre)
    if ruta and os.path.isfile(ruta):
        try:
            os.remove(ruta)
        except OSError:
            pass


@main_bp.route('/api/clientes/<int:cliente_id>/logo', methods=['POST'])
@login_required
@roles_required('admin', 'jefe')
def subir_logo_cliente(cliente_id):
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar clientes'}), 403
    cliente = db.session.get(Cliente, cliente_id)
    if not cliente:
        return jsonify({'error': 'Cliente no encontrado'}), 404
    archivo = request.files.get('archivo')
    if not archivo or not archivo.filename:
        return jsonify({'error': 'No se envió ningún archivo'}), 400
    if not archivo.filename.lower().endswith('.png'):
        return jsonify({'error': 'Solo se permiten imágenes PNG'}), 400

    datos = archivo.read()
    if len(datos) > LOGO_MAX_BYTES:
        return jsonify({'error': 'La imagen no debe superar 200KB'}), 400
    try:
        imagen = PILImage.open(io.BytesIO(datos))
        formato = imagen.format
        ancho, alto = imagen.size
    except Exception:
        return jsonify({'error': 'El archivo no es una imagen PNG válida'}), 400
    if formato != 'PNG':
        return jsonify({'error': 'Solo se permiten imágenes PNG'}), 400
    if ancho > LOGO_MAX_DIMENSION or alto > LOGO_MAX_DIMENSION:
        return jsonify({'error': 'La imagen debe ser PNG de máximo 200×200px'}), 400

    try:
        carpeta = _carpeta_logos()
        os.makedirs(carpeta, exist_ok=True)
        nombre = f'{cliente.id}_{uuid4().hex}.png'
        anterior = cliente.logo_filename
        with open(os.path.join(carpeta, nombre), 'wb') as f:
            f.write(datos)
        cliente.logo_filename = nombre
        db.session.commit()
        _borrar_logo_disco(anterior)
        return jsonify({'logo_url': f'/uploads/logos/{nombre}',
                        'logo_filename': nombre})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400



@main_bp.route('/uploads/facturas/<path:filename>', methods=['GET'])
@login_required
@roles_required('admin', 'jefe')
def servir_factura(filename):
    tipos = {'pdf': 'application/pdf', 'png': 'image/png',
             'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'webp': 'image/webp'}
    extension = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if extension not in tipos:
        return jsonify({'error': 'Formato de factura no permitido'}), 404
    uploads_dir = _carpeta_facturas()
    respuesta = send_from_directory(uploads_dir, filename, as_attachment=False,
                                    download_name=os.path.basename(filename),
                                    mimetype=tipos[extension])
    respuesta.headers['X-Content-Type-Options'] = 'nosniff'
    return respuesta


def _carpeta_facturas():
    return os.path.join(os.path.dirname(current_app.config['UPLOAD_FOLDER']), 'facturas')

@main_bp.route('/uploads/logos/<path:filename>', methods=['GET'])
def servir_logo_cliente(filename):
    # Sin login: solo referencial y accesible desde la red interna (mismo
    # criterio que /uploads/catalogo).
    return send_from_directory(_carpeta_logos(), filename)


# ── Excel ─────────────────────────────────────────────────────────────────

def _mapear_categoria(valor):
    v = str(valor or '').strip().lower()
    for cat in CATEGORIAS_VALIDAS:
        if v == cat.lower():
            return cat
    if 'tinta' in v:
        return 'Tintas'
    if 'herramienta' in v:
        return 'Herramientas'
    return 'Materia Prima'


def _mapear_tipo(valor):
    v = str(valor or '').strip().lower()
    for tipo in TIPOS_VALIDOS:
        if v == tipo.lower():
            return tipo
    if 'tinta' in v:
        return 'Tinta'
    if 'cinta' in v:
        return 'Cinta'
    return 'Sustrato'


def _clave_columna(header):
    h = str(header or '').strip().lower()
    if not h:
        return None
    if 'sku' in h or 'codigo' in h or 'código' in h:
        return 'codigo_barras'
    if 'nombre' in h or 'descrip' in h:
        return 'nombre'
    if 'categor' in h:
        return 'categoria'
    if 'tipo' in h:
        return 'tipo'
    if 'metros' in h:
        return 'metros_por_rollo'
    if 'minimo' in h or 'mínimo' in h:
        return 'stock_minimo'
    if 'stock' in h or 'cantidad' in h or 'rollos' in h:
        return 'stock_actual'
    if 'proveedor' in h:
        return 'proveedor'
    if 'ancho' in h:
        return 'ancho_material_cm'
    if 'color' in h:
        return 'color'
    if 'capacidad' in h:
        return 'capacidad'
    if 'gramaje' in h:
        return 'gramaje'
    return None


@main_bp.route('/api/importar/excel', methods=['POST'])
@login_required
def importar_excel():
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para importar'}), 403
    archivo = request.files.get('archivo') or request.files.get('file')
    if not archivo:
        return jsonify({'error': 'No se envió ningún archivo Excel'}), 400
    try:
        wb = load_workbook(archivo, data_only=True)
        ws = wb.active
        filas = ws.iter_rows(values_only=True)
        encabezados = next(filas, None)
        if not encabezados:
            return jsonify({'error': 'El archivo Excel está vacío'}), 400
        columnas = {}
        for idx, header in enumerate(encabezados):
            clave = _clave_columna(header)
            if clave and clave not in columnas:
                columnas[clave] = idx
        if 'codigo_barras' not in columnas or 'nombre' not in columnas:
            return jsonify({'error': 'El Excel debe tener columnas de código (SKU) y nombre'}), 400

        creados, actualizados, omitidos = 0, 0, 0
        for fila in filas:
            def celda(clave):
                idx = columnas.get(clave)
                return fila[idx] if idx is not None and idx < len(fila) else None

            codigo = str(celda('codigo_barras') or '').strip().upper()
            nombre = str(celda('nombre') or '').strip()
            if not codigo or not nombre:
                omitidos += 1
                continue
            try:
                cantidad = _entero(celda('stock_actual') or 0, 'stock')
                stock_minimo = _entero(celda('stock_minimo') or 0, 'stock mínimo')
            except ValueError:
                omitidos += 1
                continue

            existente = Material.query.filter_by(codigo_barras=codigo).first()
            if existente:
                existente.stock_actual += cantidad
                _actualizar_estado(existente)
                actualizados += 1
                continue

            categoria = _mapear_categoria(celda('categoria'))
            m = Material(
                codigo_barras=codigo,
                nombre=nombre,
                categoria=categoria,
                tipo=_mapear_tipo(celda('tipo')),
                unidad_medida=MAPEO_UNIDAD.get(categoria),
                clasificacion=MAPEO_CLASIFICACION.get(categoria),
                metros_por_rollo=_flotante(celda('metros_por_rollo') or 0, 'metros'),
                stock_actual=cantidad,
                stock_minimo=stock_minimo,
                stock_critico=stock_minimo,
                proveedor=str(celda('proveedor') or '').strip() or None,
                color=str(celda('color') or '').strip() or None,
                capacidad=str(celda('capacidad') or '').strip() or None,
                gramaje=str(celda('gramaje') or '').strip() or None,
                ancho_material_cm=_flotante(celda('ancho_material_cm'), 'ancho')
                if celda('ancho_material_cm') not in (None, '') else None,
            )
            _actualizar_estado(m)
            db.session.add(m)
            creados += 1

        db.session.commit()
        return jsonify({'mensaje': 'Importación completa',
                        'creados': creados,
                        'actualizados': actualizados,
                        'omitidos': omitidos})
    except StaleDataError:
        return _conflicto_guardado()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400


@main_bp.route('/api/exportar/excel', methods=['GET'])
@login_required
def exportar_excel():
    wb = Workbook()
    ws = wb.active
    ws.title = 'Inventario'
    ws.append(['SKU', 'Nombre', 'Categoría', 'Tipo', 'Metros por Rollo',
               'Stock Actual', 'Stock Mínimo', 'Estado',
               'Unidad', 'Color', 'Capacidad', 'Gramaje', 'Proveedor',
               'Ancho (cm)'])
    for m in Material.query.order_by(Material.nombre).all():
        ws.append([m.codigo_barras, m.nombre, m.categoria, m.tipo,
                   m.metros_por_rollo, m.stock_actual, m.stock_minimo,
                   m.estado, m.unidad_medida, m.color, m.capacidad,
                   m.gramaje, m.proveedor, m.ancho_material_cm])
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return send_file(
        buffer,
        as_attachment=True,
        download_name='inventario_sgp.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


# ── Reportes ──────────────────────────────────────────────────────────────

@main_bp.route('/api/reportes/stock', methods=['GET'])
@login_required
def reporte_stock():
    try:
        desde, hasta = _rango_fechas()
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    consulta = Movimiento.query
    if desde:
        consulta = consulta.filter(Movimiento.fecha >= desde)
    if hasta:
        consulta = consulta.filter(Movimiento.fecha < hasta)

    agrupado = {}
    for mov in consulta.all():
        if mov.material_id not in agrupado:
            agrupado[mov.material_id] = {
                'material': mov.material.nombre if mov.material else 'Material eliminado',
                'sku': mov.material.codigo_barras if mov.material else 'N/A',
                'unidad_medida': mov.material.unidad_medida if mov.material else None,
                'total_entradas': 0,
                'total_salidas': 0,
                'stock_resultante': mov.material.stock_actual if mov.material else 0,
            }
        if mov.tipo_movimiento == 'Entrada':
            agrupado[mov.material_id]['total_entradas'] += mov.cantidad
        else:
            agrupado[mov.material_id]['total_salidas'] += mov.cantidad

    resultado = sorted(agrupado.values(), key=lambda r: r['material'])
    return jsonify(resultado)


def _filtrar_reporte_pedidos(consulta, cliente, estado):
    """Aplica los filtros opcionales de cliente (LIKE case-insensitive) y
    estado compartidos entre /api/reportes/pedidos y su versión en PDF."""
    if estado:
        consulta = consulta.filter(Pedido.estado == estado)
    if cliente:
        consulta = consulta.filter(
            Pedido.cliente.ilike(f"%{cliente}%"))
    return consulta


@main_bp.route('/api/reportes/pedidos', methods=['GET'])
@login_required
def reporte_pedidos():
    try:
        desde, hasta = _rango_fechas()
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    cliente = (request.args.get('cliente') or '').strip()
    estado = (request.args.get('estado') or '').strip()
    consulta = _filtrar_reporte_pedidos(Pedido.query, cliente, estado)
    if desde:
        consulta = consulta.filter(Pedido.fecha_entregado >= desde)
    if hasta:
        consulta = consulta.filter(Pedido.fecha_entregado < hasta)
    pedidos = consulta.order_by(Pedido.fecha_entregado.desc()).all()
    return jsonify([pedido_a_dict(p) for p in pedidos])


def _estado_item_label(valor):
    return {
        'listo': 'Listo',
        'suspendido': 'Suspendido',
        'entregado_parcial': 'Entrega parcial',
    }.get(valor, 'Pendiente')


@main_bp.route('/api/reportes/pedidos/pdf', methods=['POST'])
@login_required
def reporte_pedidos_pdf():
    data = request.get_json() or {}
    for campo in ('desde', 'hasta', 'cliente', 'estado'):
        if data.get(campo) is not None and not isinstance(data[campo], str):
            return jsonify({'error': f'{campo} debe ser texto'}), 400
    desde_str = (data.get('desde') or '').strip()
    hasta_str = (data.get('hasta') or '').strip()
    try:
        desde = datetime.fromisoformat(desde_str) if desde_str else None
        hasta = datetime.fromisoformat(hasta_str) if hasta_str else None
        if hasta and hasta.time() == datetime.min.time():
            hasta = hasta + timedelta(days=1)
    except (ValueError, OverflowError):
        return jsonify({'error': 'Formato de fecha inválido — usar ISO (YYYY-MM-DD)'}), 400

    cliente = (data.get('cliente') or '').strip()
    estado = (data.get('estado') or '').strip()
    consulta = _filtrar_reporte_pedidos(Pedido.query, cliente, estado)
    if desde:
        consulta = consulta.filter(Pedido.fecha_entregado >= desde)
    if hasta:
        consulta = consulta.filter(Pedido.fecha_entregado < hasta)
    pedidos = consulta.order_by(Pedido.fecha_entregado.desc()).all()

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        topMargin=2 * cm, bottomMargin=2 * cm,
        leftMargin=2 * cm, rightMargin=2 * cm,
        title='Reporte de Pedidos')
    estilos = getSampleStyleSheet()
    celda = ParagraphStyle('celda', parent=estilos['Normal'],
                           fontSize=9, leading=12)
    nota = ParagraphStyle('nota', parent=estilos['Normal'], fontSize=8,
                          leading=11, fontName='Helvetica-Oblique',
                          textColor=colors.HexColor('#854d0e'))
    pie = ParagraphStyle('pie', parent=estilos['Normal'],
                         fontSize=8, textColor=colors.grey)

    filtros_aplicados = (
        f'Desde: {desde_str or "—"}  ·  Hasta: {hasta_str or "—"}  ·  '
        f'Cliente: {cliente or "Todos"}  ·  Estado: {estado or "Todos"}'
    )
    elementos = [
        Paragraph('<b>Reporte de Pedidos</b>', estilos['Title']),
        Paragraph(escape(filtros_aplicados), estilos['Normal']),
        Paragraph(f'Total de pedidos: {len(pedidos)}', estilos['Normal']),
        Spacer(1, 0.7 * cm),
    ]

    if not pedidos:
        elementos.append(Paragraph(
            'No se encontraron pedidos con los filtros aplicados.', estilos['Normal']))

    for idx, pedido in enumerate(pedidos):
        elementos.append(Paragraph(
            f'<b>Cliente:</b> {escape(pedido.cliente or "—")}', estilos['Normal']))
        elementos.append(Paragraph(
            f'<b>Orden de Compra:</b> {escape(pedido.orden_compra or "—")}', estilos['Normal']))
        elementos.append(Paragraph(
            f'<b>Fecha de entrega:</b> {escape(_fmt_fecha_entrega(pedido.fecha_entrega))}',
            estilos['Normal']))
        elementos.append(Paragraph(
            f'<b>Estado:</b> {escape(pedido.estado or "—")}', estilos['Normal']))
        elementos.append(Paragraph(
            f'<b>Total unidades:</b> {pedido.total_unidades}', estilos['Normal']))
        elementos.append(Spacer(1, 0.4 * cm))

        filas = [['Código', 'Descripción', 'Cantidad', 'Estado']]
        filas_nota = []  # índices (dentro de `filas`) de filas de nota, para SPAN
        for item in pedido.items:
            filas.append([
                Paragraph(escape(item.codigo or 'S/C'), celda),
                Paragraph(escape(item.descripcion or ''), celda),
                str(item.cantidad if item.cantidad is not None else ''),
                Paragraph(escape(_estado_item_label(item.estado_item)), celda),
            ])
            if item.estado_item in ('suspendido', 'entregado_parcial') and item.observacion:
                filas.append([Paragraph(
                    f'<i>Nota: {escape(item.observacion)}</i>', nota), '', '', ''])
                filas_nota.append(len(filas) - 1)

        estilo_tabla = [
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e40af')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('ALIGN', (2, 0), (2, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1),
             [colors.white, colors.HexColor('#f1f5f9')]),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]
        # Las filas de nota van después en la lista de comandos, así que su
        # BACKGROUND amarillo pisa el alternado de ROWBACKGROUNDS de arriba.
        for fila_idx in filas_nota:
            estilo_tabla.append(('SPAN', (0, fila_idx), (-1, fila_idx)))
            estilo_tabla.append(
                ('BACKGROUND', (0, fila_idx), (-1, fila_idx), colors.HexColor('#fef9c3')))

        tabla = Table(filas, colWidths=[3 * cm, 7 * cm, 2.5 * cm, 3.5 * cm],
                      repeatRows=1)
        tabla.setStyle(TableStyle(estilo_tabla))
        elementos.append(tabla)

        if idx < len(pedidos) - 1:
            elementos.append(PageBreak())

    elementos.append(Spacer(1, 1 * cm))
    elementos.append(Paragraph(f'Generado el {_fmt_fecha(hora_ecuador())}', pie))

    doc.build(elementos)
    buffer.seek(0)
    return send_file(
        buffer, as_attachment=True,
        download_name='reporte_pedidos.pdf', mimetype='application/pdf')


# ── Reporte MRP: Previsión y Prevención de Materiales por Lote ───────────

@main_bp.route('/api/reportes/mrp-lote/pdf', methods=['POST'], endpoint='reporte_mrp_lote_pdf')
@main_bp.route('/api/reportes/mrp-lote', methods=['POST'])
@login_required
def reporte_mrp_lote():
    """MRP estricto y PDF. Lectura del catálogo, pedidos y disponibilidad."""
    data = request.get_json() or {}
    try:
        ids = data.get('pedidos_ids')
        if not isinstance(ids, list) or not ids:
            raise ValueError('Selecciona al menos un pedido')
        ids = sorted(set(_entero_consumo(valor, 'pedidos_ids') for valor in ids))
        pedidos = Pedido.query.filter(Pedido.id.in_(ids)).order_by(Pedido.id).all()
        no_encontrados = sorted(set(ids) - {pedido.id for pedido in pedidos})
        if no_encontrados:
            return jsonify({'error': 'No están disponibles todos los pedidos seleccionados.',
                            'pedidos_no_encontrados': no_encontrados}), 404
        fuera_cola = [pedido.id for pedido in pedidos if pedido.estado != 'En Cola']
        if fuera_cola:
            return jsonify({'error': 'Selecciona únicamente pedidos En Cola; actualiza la selección.',
                            'pedidos_fuera_cola': fuera_cola}), 400

        grupos, faltantes = {}, []
        for pedido in pedidos:
            if not pedido.items:
                faltantes.append({'cliente': pedido.cliente, 'codigo': f'#ORD-{pedido.id}',
                                  'descripcion': '', 'campos': ['Agregar ítems al pedido']})
            for item in pedido.items:
                try:
                    cantidad = _entero_consumo(item.cantidad, f'Cantidad del ítem {item.id} del pedido {pedido.id}')
                except ValueError as exc:
                    faltantes.append({'cliente': pedido.cliente, 'codigo': item.codigo,
                                      'descripcion': item.descripcion, 'campos': [str(exc)]})
                    continue
                codigo = (item.codigo or '').strip().upper()
                if codigo in ('', '-', 'S/C'):
                    codigo = '-'
                clave = ((pedido.cliente or '').strip().upper(), codigo,
                         (item.descripcion or '').strip() if codigo == '-' else '')
                if clave not in grupos:
                    grupos[clave] = {'producto': _catalogo_item(item, pedido.cliente),
                                     'cliente': pedido.cliente, 'codigo': codigo,
                                     'descripcion': item.descripcion, 'cantidad': 0,
                                     'origen': set(), 'descripciones': set()}
                grupo = grupos[clave]
                grupo['cantidad'] += cantidad
                _entero_consumo(grupo['cantidad'], 'Cantidad agrupada del producto')
                grupo['origen'].add(f'#ORD-{pedido.id} ({pedido.cliente}, OC {pedido.orden_compra or "S/N"})')
                grupo['descripciones'].add((item.descripcion or '').strip())
        for grupo in grupos.values():
            grupo['datos'], campos = _datos_produccion_mrp(grupo['producto'])
            if campos:
                faltantes.append({'cliente': grupo['cliente'], 'codigo': grupo['codigo'],
                                  'descripcion': grupo['descripcion'], 'campos': campos})
        if faltantes:
            return _faltantes_consumo(faltantes)

        items, productos = [], {}
        for _, grupo in sorted(grupos.items()):
            producto = grupo['producto']
            productos[producto.id] = producto
            calculado = calcular_consumo(producto, grupo['cantidad'], grupo['datos'])
            calculado['pedidos_origen'] = sorted(grupo['origen'])
            calculado['descripciones_pedido'] = sorted(grupo['descripciones'])
            if grupo['descripciones'] != {(producto.descripcion or '').strip()}:
                calculado['advertencias'].append('La descripción del pedido difiere del catálogo; se usa el producto coincidente por cliente y código.')
            items.append(calculado)
        materiales = consolidar_materiales(items, productos)
        # Sumas de magnitudes sin redondear. Las fracciones de rollos son exactas.
        total_rollos = sum((Fraction(item['rollos_fraccion']) for item in items), Fraction(0))
        total_metros = sum((Fraction(item['planchas_totales']) * Fraction(str(item['largo_plancha_cm'])) / 100
                            for item in items), Fraction(0))
        total_area = sum((Fraction(item['planchas_totales']) * Fraction(str(item['largo_plancha_cm'])) / 100
                         * Fraction(str(item['ancho_rollo_m'])) for item in items), Fraction(0))
        # Cada producto puede ser seguro por separado y su suma exceder el
        # entero exacto de JavaScript. Validar antes de JSON y del mismo PDF.
        totales_enteros = {
            'total_pedidos': len(pedidos),
            'total_etiquetas': sum(item['cantidad_total'] for item in items),
            'total_planchas': sum(item['planchas_totales'] for item in items),
            'total_rollos_necesarios': sum(material['rollos_necesarios'] for material in materiales),
            'total_bultos_empaque': sum(item['bultos'] for item in items),
        }
        totales_enteros = {campo: entero_seguro(valor, campo) for campo, valor in totales_enteros.items()}
        for pedido in pedidos:
            if pedido.total_unidades is not None:
                entero_seguro(pedido.total_unidades, f'Total de unidades del pedido {pedido.id}')
        resultado = {
            'totales': {
                **totales_enteros,
                'total_rollos': numero_finito(total_rollos), 'total_rollos_fraccion': str(total_rollos),
                'total_metros_lineales': numero_finito(total_metros), 'total_metros_cuadrados': numero_finito(total_area),
            },
            'pedidos_seleccionados': [
                {'id': pedido.id, 'revision': pedido.revision, 'cliente': pedido.cliente,
                 'orden_compra': pedido.orden_compra, 'estado': pedido.estado,
                 'fecha_entrega': pedido.fecha_entrega, 'total_unidades': pedido.total_unidades}
                for pedido in pedidos
            ],
            'items_agrupados': items, 'materiales_bodega': materiales,
        }
        return _respuesta_consumo(resultado, {'pedidos_ids': ids}, lote=True)
    except (ValueError, OverflowError, ZeroDivisionError) as exc:
        return jsonify({'error': f'No se puede calcular el lote con estos valores: {exc}'}), 400


# ── Planificador Gráfico y Algoritmo de Asignación 24/7 (Paso 5) ─────────

MAQUINAS_DISPONIBLES = [
    {
        'id': 'M1',
        'nombre': 'Máquina M1 (Prensa Estándar)',
        'tipo': 'flexo_estandar',
        'descripcion': 'Impresión flexográfica estándar para etiquetas y cintas',
    },
    {
        'id': 'M2',
        'nombre': 'Máquina M2 (Alta Velocidad)',
        'tipo': 'alta_velocidad',
        'descripcion': 'Línea rápida de alta productividad para corridas mayores',
    },
    {
        'id': 'Mesp',
        'nombre': 'Máquina Mesp (Especial / 1.27m)',
        'tipo': 'especial',
        'descripcion': 'Sustratos especiales y anchos mayores (ej. código 90006718)',
    },
]


def _calcular_tiempo_pedido_minutos(pedido):
    """Calcula el tiempo total estimado en minutos para producir un pedido,
    y detecta si requiere una máquina exclusiva (ej. Mesp)."""
    minutos_totales = 0.0
    maquinas_requeridas = set()

    for item in pedido.items:
        codigo = (item.codigo or '').strip().upper()
        cant = item.cantidad or 0

        # Buscar en catálogo
        cat = _catalogo_item(item, pedido.cliente)

        t_base = cat.tiempo_base_minutos if (cat and cat.tiempo_base_minutos is not None) else 0.05
        if not math.isfinite(t_base) or t_base <= 0:
            raise ValueError(f'Pedido #ORD-{pedido.id}: tiempo de producción inválido para {codigo}')
        # Tiempo por ítem = cantidad * tiempo_base_minutos
        tiempo_item = cant * t_base
        minutos_totales += tiempo_item

        # Máquina requerida
        if codigo == '90006718':
            maquinas_requeridas.add('Mesp')
        elif cat:
            if cat.maquina_requerida:
                maquinas_requeridas.add(cat.maquina_requerida)
            elif cat.tipo_codigo == 'especial':
                maquinas_requeridas.add('Mesp')

    if len(maquinas_requeridas) > 1:
        raise ValueError(f'Pedido #ORD-{pedido.id}: restricciones de máquinas exclusivas incompatibles ({", ".join(sorted(maquinas_requeridas))})')
    maquina_requerida = next(iter(maquinas_requeridas), None)
    if maquina_requerida and maquina_requerida not in ('M1', 'M2', 'Mesp'):
        raise ValueError(f'Pedido #ORD-{pedido.id}: máquina requerida inválida')
    if not math.isfinite(minutos_totales):
        raise ValueError(f'Pedido #ORD-{pedido.id}: duración fuera del rango permitido')

    # Margen mínimo de preparación/set-up: 10 minutos
    minutos_totales = max(10.0, minutos_totales)
    return round(minutos_totales, 1), maquina_requerida


@main_bp.route('/api/produccion/planificador', methods=['GET'])
@login_required
def get_planificador():
    """Retorna las órdenes activas ('En Cola' y 'Procesando') organizadas para el
    Diagrama de Gantt continuo 24/7 y la lista de pedidos pendientes sin asignar."""
    ahora = hora_ecuador()
    pedidos_activos = Pedido.query.filter(
        Pedido.estado.in_(['En Cola', 'Procesando'])
    ).order_by(Pedido.id).all()

    maquinas_map = {m['id']: [] for m in MAQUINAS_DISPONIBLES}
    sin_asignar = []

    for p in pedidos_activos:
        p_dict = pedido_a_dict(p)
        try:
            minutos, maq_req = _calcular_tiempo_pedido_minutos(p)
        except (ValueError, OverflowError) as exc:
            minutos, maq_req = None, None
            p_dict['error_planificacion'] = str(exc)
        p_dict['minutos_calculados'] = minutos
        p_dict['maquina_requerida_fija'] = maq_req

        if p.maquina_asignada and p.maquina_asignada in maquinas_map:
            maquinas_map[p.maquina_asignada].append(p_dict)
        else:
            sin_asignar.append(p_dict)

    return jsonify({
        'ahora': ahora.isoformat(),
        'maquinas': MAQUINAS_DISPONIBLES,
        'lineas_tiempo': maquinas_map,
        'sin_asignar': sin_asignar,
    })


@main_bp.route('/api/produccion/auto-asignar', methods=['POST'])
@login_required
def auto_asignar_produccion():
    """Algoritmo de asignación y optimización lineal de carga (Makespan Minimization)
    para máquinas que operan 24/7.
    Respeta la restricción estricta de maquina_requerida (ej. Mesp para 90006718),
    y distribuye de forma óptima los pedidos flexibles entre M1 y M2."""
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para planificar producción'}), 403

    ahora = hora_ecuador()
    data = request.get_json() or {}
    pedidos_ids = data.get('pedidos_ids')
    if pedidos_ids is not None:
        if not isinstance(pedidos_ids, list) or not pedidos_ids:
            return jsonify({'error': 'Selecciona al menos un pedido'}), 400
        try:
            pedidos_ids = sorted(set(_entero_consumo(valor, 'pedidos_ids') for valor in pedidos_ids))
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        pedidos_en_cola = Pedido.query.filter(
            Pedido.id.in_(pedidos_ids)
        ).order_by(Pedido.id).all()
        no_encontrados = sorted(set(pedidos_ids) - {p.id for p in pedidos_en_cola})
        if no_encontrados:
            return jsonify({'error': 'No están disponibles todos los pedidos seleccionados.',
                            'pedidos_no_encontrados': no_encontrados}), 404
        fuera_cola = [p.id for p in pedidos_en_cola if p.estado != 'En Cola']
        if fuera_cola:
            return jsonify({'error': 'Selecciona únicamente pedidos En Cola; actualiza la selección.',
                            'pedidos_fuera_cola': fuera_cola}), 400
    else:
        pedidos_en_cola = Pedido.query.filter(
            Pedido.estado == 'En Cola'
        ).order_by(Pedido.id).all()

    if not pedidos_en_cola:
        return jsonify({'error': 'No hay pedidos en cola para asignar'}), 400

    # 1. Determinar el tiempo de inicio de cada máquina (Ready Time).
    ready_times = {}
    for m in MAQUINAS_DISPONIBLES:
        mid = m['id']
        en_proceso = Pedido.query.filter(
            Pedido.estado.in_(['En Cola', 'Procesando']),
            Pedido.maquina_asignada == mid,
            Pedido.id.notin_([p.id for p in pedidos_en_cola])
        ).order_by(Pedido.fecha_fin_produccion.desc()).first()

        if en_proceso and en_proceso.fecha_fin_produccion and en_proceso.fecha_fin_produccion > ahora:
            ready_times[mid] = en_proceso.fecha_fin_produccion
        else:
            ready_times[mid] = ahora

    # 2. Clasificar pedidos entre restringidos (exclusivos) y flexibles (M1 / M2)
    restringidos = []
    flexibles = []

    try:
        for p in pedidos_en_cola:
            minutos, maq_req = _calcular_tiempo_pedido_minutos(p)
            if maq_req:
                restringidos.append((p, minutos, maq_req))
            else:
                flexibles.append((p, minutos))

        # Validar el horizonte completo antes de modificar cualquier reserva.
        # Conserva el algoritmo LPT y el margen mínimo originales.
        propuestas = []
        for p, duracion, maq in restringidos:
            inicio = ready_times[maq]
            fin = inicio + timedelta(minutes=duracion)
            propuestas.append((p, maq, inicio, fin, duracion))
            ready_times[maq] = fin
        flexibles.sort(key=lambda x: x[1], reverse=True)
        for p, duracion in flexibles:
            maq = min(('M1', 'M2'), key=lambda m: ready_times[m])
            inicio = ready_times[maq]
            fin = inicio + timedelta(minutes=duracion)
            propuestas.append((p, maq, inicio, fin, duracion))
            ready_times[maq] = fin
    except (ValueError, OverflowError) as exc:
        db.session.rollback()
        return jsonify({'error': f'No se puede planificar la selección: {exc}'}), 400

    for p, maq, inicio, fin, duracion in propuestas:
        p.maquina_asignada = maq
        p.minutos_estimados = duracion
        p.fecha_inicio_produccion = inicio
        p.fecha_fin_produccion = fin

    db.session.commit()

    makespan_minutos = max((ready_times[m] - ahora).total_seconds() / 60.0 for m in ready_times)

    return jsonify({
        'mensaje': f'{len(pedidos_en_cola)} pedidos auto-asignados exitosamente con operación continua 24/7',
        'total_asignados': len(pedidos_en_cola),
        'makespan_horas': round(makespan_minutos / 60.0, 2),
        'ready_times': {k: v.isoformat() for k, v in ready_times.items()},
        'pedidos': [pedido_a_dict(p) for p in pedidos_en_cola]
    })


@main_bp.route('/api/produccion/asignar-manual', methods=['PUT'])
@login_required
def asignar_manual_produccion():
    """Permite el Drag & Drop manual en el Gantt: actualiza la máquina asignada
    y las fechas, o elimina la reserva al recibir maquina=null."""
    if not puede_operar_seccion():
        return jsonify({'error': 'No tienes permisos para modificar asignaciones'}), 403

    data = request.get_json() or {}
    pedido_id = data.get('pedido_id')
    maquina = data.get('maquina')
    fecha_inicio_str = data.get('fecha_inicio')
    duracion_minutos = data.get('duracion_minutos')

    if not pedido_id or 'maquina' not in data:
        return jsonify({'error': 'Faltan parámetros (pedido_id, maquina)'}), 400
    try:
        pedido_id = _entero(pedido_id, 'pedido_id', minimo=1)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    if maquina is not None and maquina not in ('M1', 'M2', 'Mesp'):
        return jsonify({'error': 'Máquina inválida'}), 400

    pedido = db.session.get(Pedido, pedido_id)
    if not pedido:
        return jsonify({'error': 'Pedido no encontrado'}), 404
    if pedido.estado not in ('En Cola', 'Procesando'):
        return jsonify({'error': 'Solo se pueden planificar pedidos En Cola o Procesando'}), 400

    if maquina is None:
        pedido.maquina_asignada = None
        pedido.fecha_inicio_produccion = None
        pedido.fecha_fin_produccion = None
        pedido.minutos_estimados = None
        db.session.commit()
        return jsonify({
            'mensaje': f'Pedido #{pedido.id} devuelto a la cola sin asignar',
            'pedido': pedido_a_dict(pedido),
        })

    try:
        minutos_calc, maq_req = _calcular_tiempo_pedido_minutos(pedido)
    except (ValueError, OverflowError) as exc:
        return jsonify({'error': str(exc)}), 400
    if maq_req and maq_req != maquina:
        return jsonify({
            'error': f'Restricción técnica: Este pedido contiene códigos especiales (ej. 90006718) que requieren exclusivamente la máquina {maq_req}.'
        }), 400

    try:
        duracion = _flotante(duracion_minutos, 'duracion_minutos') if duracion_minutos is not None else (pedido.minutos_estimados or minutos_calc)
        if duracion <= 0:
            raise ValueError('La duración debe ser mayor a 0')
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if fecha_inicio_str:
        try:
            inicio = datetime.fromisoformat(fecha_inicio_str)
            if inicio.tzinfo:
                import pytz
                inicio = inicio.astimezone(pytz.timezone('America/Guayaquil')).replace(tzinfo=None)
        except (TypeError, ValueError):
            return jsonify({'error': 'Formato de fecha de inicio inválido (usar ISO)'}), 400
    else:
        ultimo = Pedido.query.filter(
            Pedido.maquina_asignada == maquina,
            Pedido.id != pedido.id,
            Pedido.estado.in_(['En Cola', 'Procesando'])
        ).order_by(Pedido.fecha_fin_produccion.desc()).first()
        inicio = ultimo.fecha_fin_produccion if (ultimo and ultimo.fecha_fin_produccion and ultimo.fecha_fin_produccion > hora_ecuador()) else hora_ecuador()

    try:
        fin = inicio + timedelta(minutes=duracion)
    except (OverflowError, ValueError):
        return jsonify({'error': 'La duración excede el rango permitido'}), 400
    conflicto = Pedido.query.filter(
        Pedido.id != pedido.id,
        Pedido.estado.in_(['En Cola', 'Procesando']),
        Pedido.maquina_asignada == maquina,
        Pedido.fecha_inicio_produccion < fin,
        Pedido.fecha_fin_produccion > inicio,
    ).first()
    if conflicto:
        return jsonify({'error': f'La máquina {maquina} ya está ocupada por el pedido #ORD-{conflicto.id} en ese horario'}), 400

    pedido.maquina_asignada = maquina
    pedido.minutos_estimados = duracion
    pedido.fecha_inicio_produccion = inicio
    pedido.fecha_fin_produccion = fin

    db.session.commit()

    return jsonify({
        'mensaje': f'Pedido #{pedido.id} asignado a {maquina}',
        'pedido': pedido_a_dict(pedido)
    })


# ==========================================
# RUTAS PARA USUARIOS (CONFIGURACIÓN)
# ==========================================
@main_bp.route('/api/usuarios', methods=['GET'])
@login_required
@roles_required('admin', 'jefe')
def get_usuarios():
    usuarios = Usuario.query.all()
    return jsonify([usuario_a_dict(u) for u in usuarios])


def _campos_usuario(data, nuevo=False):
    campos = {}
    for campo in ('username', 'password', 'rol'):
        valor = data.get(campo, '')
        if valor is None:
            valor = ''
        if not isinstance(valor, str):
            raise ValueError(f'{campo} debe ser texto')
        campos[campo] = valor.strip() if campo != 'password' else valor
    if nuevo and not all(campos.values()):
        raise ValueError('Todos los campos son obligatorios')
    if len(campos['username']) > 80:
        raise ValueError('El nombre de usuario admite hasta 80 caracteres')
    if campos['rol'] and campos['rol'] not in ('admin', 'jefe', 'empleado', 'operador'):
        raise ValueError('Rol inválido')
    return campos


def _permisos_cuenta(data, rol):
    permisos = validar_permisos(data.get('permisos'))
    if rol in ('admin', 'jefe') and permisos is not None:
        raise ValueError('Admin y jefe conservan acceso completo para administrar el sistema')
    return json.dumps(permisos, ensure_ascii=False) if permisos is not None else None

@main_bp.route('/api/usuarios', methods=['POST'])
@login_required
@roles_required('admin', 'jefe')
def crear_usuario():
    try:
        data = request.get_json() or {}
        campos = _campos_usuario(data, nuevo=True)
        permisos_json = _permisos_cuenta(data, campos['rol'])
        if Usuario.query.filter_by(username=campos['username']).first():
            return jsonify({'error': 'El nombre de usuario ya existe'}), 400
        u = Usuario(username=campos['username'], rol=campos['rol'], permisos_json=permisos_json)
        u.set_password(campos['password'])
        db.session.add(u)
        db.session.commit()
        return jsonify({'mensaje': 'Usuario creado', 'usuario': usuario_a_dict(u)})
    except (ValueError, IntegrityError) as error:
        db.session.rollback()
        return jsonify({'error': str(error) if isinstance(error, ValueError) else 'El nombre de usuario ya existe'}), 400

@main_bp.route('/api/usuarios/<int:id>', methods=['PUT'])
@login_required
@roles_required('admin', 'jefe')
def editar_usuario(id):
    u = Usuario.query.get_or_404(id)
    try:
        data = request.get_json() or {}
        campos = _campos_usuario(data)
        if 'permisos' in data:
            permisos_json = _permisos_cuenta(data, campos['rol'] or u.rol)
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    username, password, rol = (campos['username'], campos['password'], campos['rol'])
    if current_user.id == u.id and rol and rol != u.rol:
        return jsonify({'error': 'No puedes cambiar tu propio rol para evitar perder acceso'}), 400
    
    if username and username != u.username:
        if Usuario.query.filter_by(username=username).first():
            return jsonify({'error': 'El nombre de usuario ya existe'}), 400
        u.username = username
        
    if rol:
        if rol != u.rol:
            # Al cambiar el rol no reactivar una configuración antigua oculta.
            u.permisos_json = None
        u.rol = rol
        
    if password:
        u.set_password(password)

    if 'permisos' in data:
        u.permisos_json = permisos_json
        
    try:
        db.session.commit()
        return jsonify({'mensaje': 'Usuario actualizado', 'usuario': usuario_a_dict(u)})
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'El nombre de usuario ya existe'}), 400


@main_bp.route('/api/usuarios/<int:id>/permisos', methods=['PUT'])
@login_required
@roles_required('admin', 'jefe')
def actualizar_permisos_usuario(id):
    import json
    u = db.session.get(Usuario, id)
    if u is None:
        return jsonify({'error': 'Usuario no encontrado'}), 404
    data = request.get_json() or {}
    if 'permisos' not in data:
        return jsonify({'error': 'Debes indicar los permisos'}), 400
    try:
        permisos = validar_permisos(data['permisos'])
        if u.rol in ('admin', 'jefe') and permisos is not None:
            raise ValueError('Admin y jefe conservan acceso completo para administrar el sistema')
        u.permisos_json = json.dumps(permisos, ensure_ascii=False) if permisos is not None else None
        db.session.commit()
        return jsonify({'mensaje': 'Permisos actualizados', 'usuario': usuario_a_dict(u)})
    except ValueError as error:
        db.session.rollback()
        return jsonify({'error': str(error)}), 400

@main_bp.route('/api/usuarios/<int:id>', methods=['DELETE'])
@login_required
@roles_required('admin', 'jefe')
def eliminar_usuario(id):
    u = Usuario.query.get_or_404(id)
    if current_user.id == u.id:
        return jsonify({'error': 'No puedes eliminarte a ti mismo'}), 400
    try:
        Movimiento.query.filter_by(usuario_id=u.id).update({'usuario_id': None})
        ReporteFaltante.query.filter_by(usuario_id=u.id).update({'usuario_id': None})
        db.session.delete(u)
        db.session.commit()
        return jsonify({'mensaje': 'Usuario eliminado'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Error al eliminar usuario: {str(e)}'}), 400
