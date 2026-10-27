"""Consumo de planificación. No modifica modelos ni descuenta existencias."""
import math
from fractions import Fraction


MAX_SAFE_INTEGER = 9007199254740991


def entero_seguro(valor, campo):
    """Contador exacto y representable en JSON/JavaScript, antes de formatear."""
    if isinstance(valor, bool) or not isinstance(valor, (int, Fraction)) or valor.denominator != 1 or valor < 0:
        raise ValueError(f'{campo} debe ser un entero no negativo')
    if valor > MAX_SAFE_INTEGER:
        raise ValueError(f'{campo} supera el máximo admitido ({MAX_SAFE_INTEGER})')
    return int(valor)


def _misma_longitud(a, b):
    # Sólo tolera ruido de la representación decimal, no diferencias físicas
    # ni porcentajes de merma supuestos. La comparación permanece racional.
    return abs(a - b) <= max(abs(a), abs(b)) / 1_000_000_000


PRODUCTION_FIELDS = (
    ('cant_etiquetas_plancha', 'Etiquetas por plancha'),
    ('cant_planchas', 'Planchas base'),
    ('cant_rollos', 'Rollos base'),
    ('cant_etiquetas_rollo', 'Etiquetas por rollo'),
    ('largo_plancha_impresa', 'Largo de plancha (cm)'),
    ('largo_rollo', 'Largo de rollo (m)'),
    ('ancho_rollo', 'Ancho de rollo (m)'),
)


def numero_finito(valor):
    """No convertir una magnitud positiva en cero por desbordamiento numérico."""
    numero = float(valor)
    if not math.isfinite(numero) or (valor != 0 and numero == 0):
        raise ValueError('Magnitud fuera del rango numérico; revisa rendimientos y medidas del catálogo')
    return numero


def datos_produccion(producto):
    """Conserva la precedencia del MRP estricto y expone sus estimaciones."""
    if producto is None:
        return None, ['Producto único del catálogo para cliente, código y descripción si no tiene código']
    originales, faltantes, advertencias = {}, [], []
    for campo, etiqueta in PRODUCTION_FIELDS:
        valor = getattr(producto, campo)
        valido = (type(valor) in (int, float) and math.isfinite(valor) and valor >= 0)
        if valido and campo.startswith('cant_'):
            valido = float(valor).is_integer() and valor <= MAX_SAFE_INTEGER
        originales[campo] = valor if valido else None
        if valor is not None and not valido:
            faltantes.append(f'{etiqueta}: corregir valor inválido')

    def positivo(campo):
        valor = originales[campo]
        return valor if valor is not None and valor > 0 else 0

    ep, pb, rb, er, lp, lr, ar = (positivo(campo) for campo, _ in PRODUCTION_FIELDS)
    if not ep:
        faltantes.append('Etiquetas por plancha (> 0)')
    base = Fraction(int(pb), int(rb)) if pb and rb else None
    if er and ep:
        capacidad = Fraction(int(er), int(ep))
        fuente = 'Etiquetas por rollo / Etiquetas por plancha'
        if base and not math.isclose(float(capacidad), float(base), rel_tol=0.001):
            advertencias.append('Etiquetas por rollo no coincide con Planchas base / Rollos base; se prioriza Etiquetas por rollo.')
    elif base:
        capacidad, fuente = base, 'Planchas base / Rollos base'
    else:
        geometria = Fraction(str(lr)) * 100 / Fraction(str(lp)) if lr and lp else Fraction(0)
        capacidad = Fraction(math.floor(geometria))
        fuente = 'Largos: piso(Largo rollo × 100 / Largo plancha), estimación sin merma'
        if capacidad:
            advertencias.append('Rendimiento estimado por geometría, sin merma ni preparación de máquina.')
    if not capacidad:
        faltantes.append('Rendimiento: Etiquetas por rollo, o Planchas base y Rollos base, o largos compatibles')
    elif capacidad.denominator != 1:
        advertencias.append('El rendimiento tiene fracciones de plancha por rollo; el consumo es proporcional. Confirma el aprovechamiento de planchas parciales en planta.')

    largo_calculado = False
    if not lp and lr and capacidad:
        lp = numero_finito(Fraction(str(lr)) * 100 / capacidad)
        largo_calculado = True
        advertencias.append('Largo de plancha estimado desde Largo rollo y rendimiento; supone aprovechamiento íntegro del rollo.')
    if not lp:
        faltantes.append('Largo de plancha (cm), o Largo de rollo (m) para derivarlo')
    if not ar:
        faltantes.append('Ancho de rollo (m, > 0)')
    if capacidad and lp and lr and not largo_calculado and not math.isclose(float(capacidad) * lp / 100, lr, rel_tol=0.02):
        advertencias.append('El rendimiento por rollo difiere de los largos guardados; revisa el catálogo de producción.')
    if not producto.material:
        advertencias.append('Sin material vinculado: disponibilidad de bodega desconocida.')
    return {
        'ep': ep, 'capacidad_exacta': capacidad, 'lp': lp, 'ar': ar,
        'datos_produccion': originales, 'fuente_rendimiento_rollo': fuente,
        'largo_plancha_calculado': largo_calculado, 'advertencias': advertencias,
    }, faltantes


def calcular_consumo(producto, cantidad, datos):
    """Única fórmula para producto individual y grupo de productos de un lote.

    Fraction evita redondear antes de ceil/floor. Metros y m² se devuelven sin
    redondeo intermedio; el formato visual no interviene en la disponibilidad.
    """
    ep, capacidad = int(datos['ep']), datos['capacidad_exacta']
    planchas = math.ceil(Fraction(cantidad, ep))
    rollos = Fraction(planchas) / capacidad
    completos = math.floor(rollos)
    resto = Fraction(planchas) - completos * capacidad
    metros = Fraction(planchas) * Fraction(str(datos['lp'])) / 100
    area = metros * Fraction(str(datos['ar']))
    for valor in (planchas, completos, math.ceil(rollos), planchas * ep):
        entero_seguro(valor, 'Contador del consumo individual')
    material = producto.material
    return {
        'producto': {'id': producto.id, 'codigo': producto.codigo,
                     'cliente': producto.cliente, 'descripcion': producto.descripcion,
                     'material_sku': material.codigo_barras if material else None},
        'codigo': producto.codigo, 'cliente': producto.cliente,
        'descripcion': producto.descripcion, 'cantidad_total': cantidad,
        'cantidad_etiquetas': cantidad, 'pedidos_origen': [],
        'cant_etiquetas_plancha': ep, 'planchas_por_rollo': numero_finito(capacidad),
        'capacidad_rollo_fraccion': str(capacidad),
        'planchas_totales': planchas, 'etiquetas_capacidad': planchas * ep,
        'etiquetas_excedentes': planchas * ep - cantidad,
        'rollos_decimal': numero_finito(rollos), 'rollos_fraccion': str(rollos),
        'rollos_completos': completos, 'rollos_necesarios': math.ceil(rollos),
        'planchas_sobrantes': numero_finito(resto), 'planchas_restantes_fraccion': str(resto),
        'largo_plancha_cm': datos['lp'], 'ancho_rollo_m': datos['ar'],
        'metros_lineales': numero_finito(metros), 'metros_cuadrados': numero_finito(area),
        'datos_produccion': datos['datos_produccion'],
        'fuente_rendimiento_rollo': datos['fuente_rendimiento_rollo'],
        'largo_plancha_calculado': datos['largo_plancha_calculado'],
        'advertencias': list(datos['advertencias']),
        'paquetes_200': cantidad // 200, 'residuo_empaque': cantidad % 200,
        'bultos': math.ceil(Fraction(cantidad, 200)),
        'total_bultos': math.ceil(Fraction(cantidad, 200)),
        'material_id': producto.material_id,
        'material_sku': material.codigo_barras if material else None,
        'material_nombre': material.nombre if material else 'Sin material vinculado',
        'formulas': [
            f'Planchas = techo({cantidad} etiquetas / {ep} etiquetas por plancha) = {planchas}.',
            f'Rendimiento = {capacidad} planchas por rollo. Fuente: {datos["fuente_rendimiento_rollo"]}.',
            f'Rollos teóricos = {planchas} / ({capacidad}) = {rollos}; completos teóricos = piso = {completos}; enteros a disponer = techo = {math.ceil(rollos)}.',
            f'Planchas restantes por consumir = {planchas} - {completos} × ({capacidad}) = {resto}. No son sobrantes de inventario.',
            f'Metros = {planchas} × {datos["lp"]} cm / 100. Superficie = metros × {datos["ar"]} m.',
            f'Empaque de 200: piso({cantidad} / 200) = {cantidad // 200} paquetes completos; residuo = {cantidad % 200} etiquetas; bultos = techo = {math.ceil(Fraction(cantidad, 200))}.',
            f'Capacidad de las planchas = {planchas * ep} etiquetas; excedente por redondeo = {planchas * ep - cantidad}.',
            'Techo redondea hacia arriba; piso hacia abajo. Fracciones exactas para rollos y redondeos; metros y m² sin redondeo intermedio.',
        ],
    }


def consolidar_materiales(items, productos):
    """Redondea una vez por material; mezclar medidas impide confirmar stock."""
    grupos = {}
    for item in items:
        producto = productos[item['producto']['id']]
        material = producto.material
        clave = f'material-{material.id}' if material else f'producto-{producto.id}'
        if clave not in grupos:
            unidad_correcta = material is not None and (material.unidad_medida or '').strip().lower() == 'rollos'
            stock = material.stock_actual if unidad_correcta else None
            if type(stock) not in (int, float) or not math.isfinite(stock) or stock < 0 or not float(stock).is_integer():
                stock = None
            elif stock is not None:
                stock = entero_seguro(int(stock), 'Stock actual del material en rollos')
            grupos[clave] = {
                'clave': clave, 'sku': item['material_sku'] or 'N/D',
                'nombre': item['material_nombre'], 'ancho_m': item['ancho_rollo_m'],
                'planchas_totales': 0, 'rollos_completos': 0,
                'planchas_adicionales': Fraction(0), 'metros_lineales': Fraction(0),
                'metros_cuadrados': Fraction(0), 'rollos_estimados': Fraction(0),
                'stock_actual_rollos': stock, 'advertencias': [], '_medidas': set(),
            }
        grupo = grupos[clave]
        largo_efectivo = Fraction(item['capacidad_rollo_fraccion']) * Fraction(str(item['largo_plancha_cm'])) / 100
        largo_guardado = item['datos_produccion']['largo_rollo']
        largo_nominal = Fraction(str(largo_guardado)) if largo_guardado else largo_efectivo
        grupo['_medidas'].add((item['ancho_rollo_m'], largo_efectivo, largo_nominal))
        if not _misma_longitud(largo_efectivo, largo_nominal):
            grupo['advertencias'].append('El rendimiento y largo de plancha implican una longitud efectiva distinta del largo de rollo del catálogo; disponibilidad desconocida.')
        largo_bodega = material.metros_por_rollo if material else None
        if largo_bodega is not None and largo_bodega != 0:
            if type(largo_bodega) not in (int, float) or not math.isfinite(largo_bodega) or largo_bodega < 0:
                grupo['advertencias'].append('Metros por rollo de bodega inválidos; disponibilidad desconocida.')
            elif not (_misma_longitud(largo_efectivo, Fraction(str(largo_bodega)))
                      and _misma_longitud(largo_nominal, Fraction(str(largo_bodega)))):
                grupo['advertencias'].append('La longitud efectiva o nominal del rollo no coincide con metros por rollo de bodega; disponibilidad desconocida.')
        grupo['planchas_totales'] = entero_seguro(grupo['planchas_totales'] + item['planchas_totales'], 'Planchas totales del material')
        grupo['rollos_completos'] = entero_seguro(grupo['rollos_completos'] + item['rollos_completos'], 'Rollos completos del material')
        grupo['planchas_adicionales'] += Fraction(item['planchas_restantes_fraccion'])
        if grupo['planchas_adicionales'] > MAX_SAFE_INTEGER:
            raise ValueError(f'Planchas adicionales del material supera el máximo admitido ({MAX_SAFE_INTEGER})')
        grupo['rollos_estimados'] += Fraction(item['rollos_fraccion'])
        metros = Fraction(item['planchas_totales']) * Fraction(str(item['largo_plancha_cm'])) / 100
        grupo['metros_lineales'] += metros
        grupo['metros_cuadrados'] += metros * Fraction(str(item['ancho_rollo_m']))
        if material and material.ancho_material_cm and not math.isclose(material.ancho_material_cm / 100, item['ancho_rollo_m'], rel_tol=0.001):
            grupo['advertencias'].append('El ancho del catálogo no coincide con el ancho de bodega; confirmar compatibilidad antes de usar el stock.')
        if material and (material.unidad_medida or '').strip().lower() != 'rollos':
            grupo['advertencias'].append('La unidad del material de bodega no es rollos; disponibilidad desconocida.')
    for grupo in grupos.values():
        medidas = grupo.pop('_medidas')
        ancho_ref, efectivo_ref, nominal_ref = next(iter(medidas))
        if any(ancho != ancho_ref or not _misma_longitud(efectivo, efectivo_ref)
               or not _misma_longitud(nominal, nominal_ref) for ancho, efectivo, nominal in medidas):
            grupo['ancho_m'] = None if len({ancho for ancho, _, _ in medidas}) > 1 else grupo['ancho_m']
            grupo['advertencias'].append('El material reúne productos con anchos o longitudes efectivas/nominales de rollo distintas; la suma de fracciones es orientativa y no confirma disponibilidad.')
        exactos = grupo['rollos_estimados']
        grupo['rollos_fraccion'] = str(exactos)
        grupo['rollos_necesarios'] = entero_seguro(math.ceil(exactos), 'Rollos necesarios del material')
        grupo['suficiente_stock'] = (grupo['stock_actual_rollos'] >= grupo['rollos_necesarios']
                                    if grupo['stock_actual_rollos'] is not None and not grupo['advertencias'] else None)
        if grupo['stock_actual_rollos'] is None:
            grupo['advertencias'].append('Stock en rollos desconocido; no se interpreta como cero.')
        grupo['advertencias'] = list(dict.fromkeys(grupo['advertencias']))
        for campo in ('rollos_estimados', 'planchas_adicionales', 'metros_lineales', 'metros_cuadrados'):
            grupo[campo] = numero_finito(grupo[campo])
    return list(grupos.values())
