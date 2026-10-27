"""Política única de acceso: niveles por sección y consumidores de cada API."""
import json

MODULOS = ('pedidos', 'produccion', 'operaciones', 'inventario', 'reportes',
           'configuracion', 'calculadora')
NIVELES = ('ninguno', 'ver', 'editar')
GESTORES = ('admin', 'jefe')


def permisos_por_rol(rol):
    permisos = dict.fromkeys(MODULOS, 'ninguno')
    if rol in GESTORES:
        return dict.fromkeys(MODULOS, 'editar')
    if rol in ('empleado', 'operador'):
        permisos.update(pedidos='ver', produccion='ver', calculadora='ver')
    return permisos


def validar_permisos(permisos):
    if permisos is None:
        return None
    if not isinstance(permisos, dict) or set(permisos) != set(MODULOS):
        raise ValueError('Debes indicar los permisos de todas las secciones válidas')
    if any(not isinstance(nivel, str) or nivel not in NIVELES for nivel in permisos.values()):
        raise ValueError('Permiso inválido: utiliza Sin acceso, Solo ver o Ver y editar')
    return {modulo: permisos[modulo] for modulo in MODULOS}


def permisos_efectivos(usuario):
    if usuario.rol in GESTORES:
        return permisos_por_rol(usuario.rol)
    if usuario.permisos_json is None:
        return permisos_por_rol(usuario.rol)
    try:
        return validar_permisos(json.loads(usuario.permisos_json)) or dict.fromkeys(MODULOS, 'ninguno')
    except (ValueError, TypeError):
        # Un valor histórico corrupto nunca concede acceso adicional.
        return dict.fromkeys(MODULOS, 'ninguno')


def usuario_a_dict(usuario):
    return {'id': usuario.id, 'username': usuario.username, 'rol': usuario.rol,
            'permisos': permisos_efectivos(usuario),
            'permisos_personalizados': usuario.permisos_json is not None}


def tiene_permiso(usuario, modulo, nivel='ver'):
    if not usuario.is_authenticated:
        return False
    actual = permisos_efectivos(usuario).get(modulo, 'ninguno')
    return actual == 'editar' or (nivel == 'ver' and actual == 'ver')


def lectura(*modulos):
    return tuple((modulo, 'ver') for modulo in modulos)


def escritura(*modulos):
    return tuple((modulo, 'editar') for modulo in modulos)


LECTURA_PEDIDOS = lectura('pedidos', 'produccion', 'reportes')
LECTURA_CATALOGO = (lectura('configuracion', 'produccion', 'reportes', 'calculadora')
                    + escritura('pedidos'))
EDICION_ITEMS = escritura('pedidos', 'produccion')

# POST de informes/calculadora son lecturas. Los datos auxiliares se autorizan
# por las pantallas que los consumen, sin conceder edición de esos recursos.
REGLAS_ENDPOINT = {
    'get_materiales': lectura('inventario', 'operaciones', 'reportes', 'configuracion'),
    'crear_material': escritura('inventario'),
    'editar_material': escritura('inventario'),
    'eliminar_material': escritura('inventario'),
    'contador_criticos': lectura('inventario'),
    'get_movimientos': lectura('inventario', 'operaciones', 'reportes'),
    'procesar_movimiento': escritura('operaciones'),
    'get_pedidos': LECTURA_PEDIDOS,
    'crear_pedido': escritura('pedidos'),
    'leer_documento_pedido': escritura('pedidos'),
    'get_pedido': LECTURA_PEDIDOS,
    'editar_pedido': escritura('pedidos'),
    'eliminar_pedido': escritura('pedidos'),
    'actualizar_estado': EDICION_ITEMS,
    'retroceder_pedido': EDICION_ITEMS,
    'actualizar_estado_item': EDICION_ITEMS,
    'registrar_entrega_item': EDICION_ITEMS,
    'eliminar_entrega_item': EDICION_ITEMS,
    'cambiar_modo_parcial_item': EDICION_ITEMS,
    'reportar_faltante_preacabados': EDICION_ITEMS,
    'resolver_faltante_preacabados': EDICION_ITEMS,
    'eliminar_faltante_preacabados': EDICION_ITEMS,
    'contador_activos': lectura('pedidos', 'produccion'),
    'subir_factura': escritura('pedidos'),
    'monitor_tv': lectura('pedidos'),
    'pedido_pdf': LECTURA_PEDIDOS,
    'get_catalogo': LECTURA_CATALOGO,
    'crear_producto': escritura('configuracion'),
    'editar_producto': escritura('configuracion'),
    'eliminar_producto': escritura('configuracion'),
    'subir_imagen_catalogo': escritura('configuracion'),
    'eliminar_imagen_catalogo': escritura('configuracion'),
    'servir_imagen_catalogo': LECTURA_CATALOGO + lectura('pedidos'),
    'calcular_planchas_mrp': lectura('calculadora'),
    'calcular_planchas_pdf': lectura('calculadora'),
    'get_clientes': lectura('configuracion', 'pedidos', 'produccion', 'reportes'),
    'crear_cliente': escritura('configuracion'),
    'editar_cliente': escritura('configuracion'),
    'eliminar_cliente': escritura('configuracion'),
    'subir_logo_cliente': escritura('configuracion'),
    'servir_factura': LECTURA_PEDIDOS,
    'servir_logo_cliente': lectura('configuracion', 'pedidos', 'produccion', 'reportes'),
    'importar_excel': escritura('inventario'),
    'exportar_excel': lectura('inventario', 'reportes', 'configuracion'),
    'reporte_stock': lectura('reportes'),
    'reporte_pedidos': lectura('reportes'),
    'reporte_pedidos_pdf': lectura('reportes'),
    'reporte_mrp_lote': lectura('reportes'),
    'reporte_mrp_lote_pdf': lectura('reportes'),
    'get_planificador': lectura('produccion'),
    'auto_asignar_produccion': escritura('produccion'),
    'asignar_manual_produccion': escritura('produccion'),
}
ENDPOINTS_USUARIOS = {'get_usuarios', 'crear_usuario', 'editar_usuario',
                     'eliminar_usuario', 'actualizar_permisos_usuario'}


def puede_acceder_endpoint(usuario, endpoint):
    if endpoint in ENDPOINTS_USUARIOS:
        return usuario.is_authenticated and usuario.rol in GESTORES
    reglas = REGLAS_ENDPOINT.get(endpoint, ())
    return any(tiene_permiso(usuario, modulo, nivel) for modulo, nivel in reglas)


def endpoint_escritura(endpoint):
    return (endpoint in ENDPOINTS_USUARIOS and endpoint != 'get_usuarios') or any(
        nivel == 'editar' for _, nivel in REGLAS_ENDPOINT.get(endpoint, ()))
