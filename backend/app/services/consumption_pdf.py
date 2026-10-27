"""PDF de consumo generado exclusivamente desde el cálculo del servidor."""
import io
import re
from html import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import LongTable, PageBreak, Paragraph, SimpleDocTemplate, Spacer, TableStyle

from .consumption import PRODUCTION_FIELDS


def numero(valor):
    if valor is None:
        return 'Sin dato'
    if isinstance(valor, bool):
        return 'Sí' if valor else 'No'
    # Ocho cifras significativas y notación científica evitan mostrar cero
    # para consumos positivos pequeños. El JSON conserva toda la precisión.
    if isinstance(valor, int):
        return str(valor)
    return format(valor, '.8g')


def generar_pdf_consumo(resultado, lote=False):
    buffer = io.BytesIO()
    styles = getSampleStyleSheet()
    body = ParagraphStyle('ConsumoBody', parent=styles['BodyText'], fontName='Helvetica',
                          fontSize=8.5, leading=12, spaceAfter=5, splitLongWords=True)
    heading = ParagraphStyle('ConsumoHeading', parent=styles['Heading2'],
                             fontSize=12, leading=16, textColor=colors.HexColor('#23426a'))

    def p(value, style=body):
        # Todos los textos de catálogo, clientes y OC entran como texto literal.
        value = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(value if value is not None else 'Sin dato'))
        return Paragraph(escape(value).replace('\n', '<br/>'), style)

    width = A4[0] - 3.2 * cm

    def tabla(headers, rows, proportions):
        data = [[p(value) for value in headers]] + [[p(value) for value in row] for row in rows]
        table = LongTable(data, colWidths=[width * part / sum(proportions) for part in proportions],
                          repeatRows=1, splitByRow=1, splitInRow=1, hAlign='LEFT')
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e8eff7')),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LINEBELOW', (0, 0), (-1, 0), .6, colors.HexColor('#7890ad')),
            ('LINEBELOW', (0, 1), (-1, -1), .25, colors.HexColor('#dbe2eb')),
            ('LEFTPADDING', (0, 0), (-1, -1), 7),
            ('RIGHTPADDING', (0, 0), (-1, -1), 7),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        return table

    title = 'Consumo de materiales por lote' if lote else 'Consumo individual de materiales'
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=1.6 * cm, rightMargin=1.6 * cm,
                            topMargin=1.5 * cm, bottomMargin=1.6 * cm,
                            title=title, author='SGP', allowSplitting=1)
    fecha = resultado['generado_en_ecuador']
    story = [p(title, styles['Title']), p(f'Fecha Ecuador: {fecha} (America/Guayaquil, UTC-05:00)'),
             p(f'Referencia del cálculo: {resultado["revision_calculo"][:16]}'),
             p('Previsión de producción. No reserva material, no modifica stock ni registra movimientos. Consumo sin merma adicional.'),
             p('Techo = redondeo hacia arriba; piso = hacia abajo. Los valores decimales del PDF se presentan con hasta 8 cifras significativas; los redondeos de rollos se hacen con fracciones exactas.')]
    items = resultado['items_agrupados'] if lote else [resultado]
    if lote:
        t = resultado['totales']
        story += [p('Totales del lote', heading), tabla(['Concepto', 'Cantidad'], [
            ['Pedidos', numero(t['total_pedidos'])], ['Etiquetas solicitadas', numero(t['total_etiquetas'])],
            ['Planchas', numero(t['total_planchas'])], ['Rollos fraccionarios (suma)', numero(t['total_rollos'])],
            ['Rollos enteros a disponer por material', numero(t['total_rollos_necesarios'])],
            ['Metros lineales (m)', numero(t['total_metros_lineales'])],
            ['Superficie (m²)', numero(t['total_metros_cuadrados'])],
            ['Bultos (sumados por producto)', numero(t['total_bultos_empaque'])],
        ], [2, 1]), p('Pedidos incluidos', heading),
            tabla(['Pedido / OC', 'Cliente', 'Entrega prometida', 'Unidades'], [
                [f'#{order["id"]}\nOC {order["orden_compra"] or "S/N"}', order['cliente'],
                 order['fecha_entrega'] or 'Sin fecha', numero(order['total_unidades'])]
                for order in resultado['pedidos_seleccionados']
            ], [1, 1.5, 1, .8])]

    story += [p('Materiales y disponibilidad actual', heading)]
    for material in resultado['materiales_bodega']:
        suficiente = material['suficiente_stock']
        disponible = 'Desconocida' if suficiente is None else 'Suficiente' if suficiente else 'Insuficiente'
        story += [p(f'{material["sku"]} · {material["nombre"]}'),
                  tabla(['Rollos teóricos', 'Enteros a disponer', 'Stock (rollos)', 'Disponibilidad'], [[
                      f'{material["rollos_fraccion"]}\naprox. {numero(material["rollos_estimados"])}',
                      numero(material['rollos_necesarios']), numero(material['stock_actual_rollos']), disponible,
                  ]], [1.3, 1, 1, 1.2]),
                  p(f'Ancho: {numero(material["ancho_m"])} m; planchas: {numero(material["planchas_totales"])}; '
                    f'completos teóricos por producto: {numero(material["rollos_completos"])} rollos; '
                    f'planchas restantes: {numero(material["planchas_adicionales"])}; '
                    f'metros: {numero(material["metros_lineales"])} m; superficie: {numero(material["metros_cuadrados"])} m².')]
        story.extend(p(f'Advertencia: {warning}') for warning in material['advertencias'])
    story += [p('Los rollos enteros a disponer del material son techo(suma de fracciones de sus productos), sin redondeos previos. '
                'Suponen que se pueden aprovechar remanentes compatibles entre productos. La disponibilidad es una fotografía actual, sin reservas de otros pedidos.')]

    for index, item in enumerate(items):
        if lote:
            story.append(PageBreak())
        story += [p(f'Producto {index + 1}: {item["codigo"]}', heading),
                  p(f'Cliente: {item["cliente"] or "Sin cliente asignado"}'), p(item['descripcion']),
                  p(f'Material: {item["material_sku"] or "Sin SKU"} · {item["material_nombre"]}')]
        if item['pedidos_origen']:
            story.append(p('Pedidos de origen:'))
            story.extend(p(order) for order in item['pedidos_origen'])
        if item.get('descripciones_pedido') and item['descripciones_pedido'] != [item['descripcion']]:
            story.append(p('Descripciones de los pedidos:'))
            story.extend(p(texto) for texto in item['descripciones_pedido'])
        story += [tabla(['Consumo / empaque', 'Cantidad'], [
            ['Etiquetas solicitadas', numero(item['cantidad_total'])],
            ['Planchas enteras a consumir', numero(item['planchas_totales'])],
            ['Etiquetas de capacidad / excedente por redondeo', f'{item["etiquetas_capacidad"]} / {item["etiquetas_excedentes"]}'],
            ['Rollos fraccionarios exactos / decimal', f'{item["rollos_fraccion"]} / aprox. {numero(item["rollos_decimal"])}'],
            ['Rollos completos teóricos / enteros a disponer', f'{item["rollos_completos"]} / {item["rollos_necesarios"]}'],
            ['Planchas restantes por consumir (no stock sobrante)', item['planchas_restantes_fraccion']],
            ['Metros lineales (m)', numero(item['metros_lineales'])],
            ['Superficie (m²)', numero(item['metros_cuadrados'])],
            ['Paquetes completos de 200 / residuo de etiquetas', f'{item["paquetes_200"]} / {item["residuo_empaque"]}'],
            ['Bultos, incluido el paquete parcial', numero(item['bultos'])],
        ], [2.7, 1.3]), p('Datos del catálogo y rendimientos aplicados', heading),
            tabla(['Dato original', 'Valor'], [
                [label, numero(item['datos_produccion'][field]) if item['datos_produccion'][field] else 'Sin dato (> 0)']
                for field, label in PRODUCTION_FIELDS
            ], [2.7, 1.3]),
            p(f'Rendimiento aplicado: {item["capacidad_rollo_fraccion"]} planchas/rollo. Fuente: {item["fuente_rendimiento_rollo"]}.'),
            p(f'Largo aplicado: {numero(item["largo_plancha_cm"])} cm ({"estimado" if item["largo_plancha_calculado"] else "guardado"}); '
              f'ancho aplicado: {numero(item["ancho_rollo_m"])} m.'), p('Fórmulas y redondeos', heading)]
        story.extend(p(formula) for formula in item['formulas'])
        story.append(p('Advertencias', heading))
        story.extend(p(warning) for warning in item['advertencias'])
        if not item['advertencias']:
            story.append(p('Sin discrepancias detectadas en los datos utilizados.'))
        story.append(Spacer(1, .3 * cm))

    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(colors.HexColor('#52647a'))
        canvas.drawString(1.6 * cm, .8 * cm, f'SGP · Ecuador {fecha}')
        canvas.drawRightString(A4[0] - 1.6 * cm, .8 * cm, f'Página {document.page}')
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)
    return buffer
