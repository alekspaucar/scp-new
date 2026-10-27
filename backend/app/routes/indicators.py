"""Small permission-scoped counters for the shared desktop/mobile menu."""
from datetime import datetime, timedelta, timezone
from flask import Blueprint, jsonify
from flask_login import current_user, login_required
from sqlalchemy import or_

from ..models import Material, Movimiento, Pedido, PedidoItem, ProductoCatalogo, ReporteFaltante, hora_ecuador
from ..permisos import permisos_efectivos, tiene_permiso

indicators_bp = Blueprint('indicators', __name__)


def _is_overdue(value, now):
    try:
        date = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if date.tzinfo:
            date = date.astimezone(timezone(timedelta(hours=-5))).replace(tzinfo=None)
        return date < now
    except (TypeError, ValueError, AttributeError):
        return False


@indicators_bp.get('/api/indicadores')
@login_required
def module_indicators():
    result = {}

    def add(key, amount, label):
        result[key] = {'cantidad': int(amount), 'etiqueta': label}

    active = None
    alerts = 0
    if any(tiene_permiso(current_user, module) for module in ('pedidos', 'produccion', 'reportes')):
        active = Pedido.query.filter(Pedido.estado != 'Entregado').count()
        now = hora_ecuador()
        dates = Pedido.query.with_entities(Pedido.fecha_entrega).filter(
            Pedido.estado.notin_(('Entregado', 'Retiro en Fábrica'))).all()
        overdue = sum(1 for (date,) in dates if _is_overdue(date, now))
        alerts += overdue + Pedido.query.filter(Pedido.items.any(
            # Count an order once even if more than one item has shortages.
            PedidoItem.faltantes.any(ReporteFaltante.resuelto.is_(False)))).count()
    if tiene_permiso(current_user, 'pedidos'):
        for key in ('monitor', 'pedidos'):
            add(key, active, 'Pedidos activos')
    if tiene_permiso(current_user, 'produccion'):
        add('produccion', active, 'Pedidos activos')
        add('gantt', Pedido.query.filter(Pedido.estado == 'En Cola', or_(
            Pedido.maquina_asignada.is_(None), Pedido.maquina_asignada == '',
            Pedido.fecha_inicio_produccion.is_(None))).count(), 'Pedidos sin planificar')
        add('preacabados', ReporteFaltante.query.filter_by(resuelto=False).count(), 'Faltantes por reponer')
    if tiene_permiso(current_user, 'inventario'):
        critical = Material.query.filter(Material.estado.in_(('Crítico', 'Agotado'))).count()
        add('inventario', critical, 'Materiales críticos o agotados')
        alerts += critical
    if tiene_permiso(current_user, 'operaciones'):
        today = hora_ecuador().replace(hour=0, minute=0, second=0, microsecond=0)
        add('operaciones', Movimiento.query.filter(Movimiento.fecha >= today,
            Movimiento.fecha < today + timedelta(days=1)).count(), 'Movimientos de hoy')
    if tiene_permiso(current_user, 'calculadora'):
        add('calculadora', ProductoCatalogo.query.count(), 'Productos del catálogo')
    if tiene_permiso(current_user, 'reportes'):
        add('reportes', active, 'Pedidos activos para consultar')
    if tiene_permiso(current_user, 'configuracion'):
        required = (ProductoCatalogo.cant_etiquetas_plancha, ProductoCatalogo.cant_planchas,
                    ProductoCatalogo.cant_rollos, ProductoCatalogo.largo_plancha_impresa,
                    ProductoCatalogo.largo_rollo, ProductoCatalogo.ancho_rollo)
        missing = ProductoCatalogo.query.filter(or_(ProductoCatalogo.material_id.is_(None),
            *(condition for field in required for condition in (field.is_(None), field <= 0)))).count()
        add('configuracion', missing, 'Productos con datos de consumo por completar')
    add('alertas', alerts, 'Alertas de tus áreas')
    return jsonify({'contadores': result, 'cuenta_id': current_user.id,
                    'permisos': permisos_efectivos(current_user)})
