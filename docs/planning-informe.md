# Informe de planificación, calculadora y reportes

Fecha: 2026-10-24. Carpeta de trabajo: `/private/tmp/sgp-nueva-hVmGDG`.

## Alcance entregado

Archivos creados:

- `components/planning/gantt.tsx`, exportación nombrada `Gantt`.
- `components/planning/calculator.tsx`, exportación nombrada `Calculator`.
- `components/planning/reports.tsx`, exportación nombrada `Reports`.
- `components/planning/planning.css`, estilos propios de esta carpeta.
- Este informe.

Se leyeron el diseño aprobado y la sección 5 del plan, los contratos compartidos, `app/globals.css`, las rutas de `backend/app/routes/main.py` y sus permisos en `backend/app/permisos.py`. Se reutilizan `Order`, `Planner`, `Product` y `Calculation`, el cliente API, la sesión y los componentes compartidos sin modificarlos. Los tipos del JSON MRP son interfaces locales.

No se realizaron instalaciones, operaciones Git, subagentes ni cambios de configuración. No se ejecutaron servicios, importaciones, pruebas o compilaciones en el proyecto original. Todas las escrituras de esta entrega se hicieron mediante `apply_patch` en la carpeta temporal y dentro del alcance indicado.

## Gantt

- Consulta real: `GET produccion/planificador`; máquinas M1, M2 y Mesp según el backend.
- Escala continua 24/7: inicio y ancho de cada barra se calculan con diferencias temporales reales, sin comprimir fines de semana o noches. Ancho mínimo de 1000 px, desplazamiento horizontal, tres escalas y divisiones con fecha/hora de Ecuador. Las reservas muy cortas conservan su proporción; las tarjetas de detalle mantienen legibles sus datos y acciones.
- Tarjetas de órdenes asignadas y cola con OC, cliente, estado, inicio, fin, duración y restricción de máquina. La duración de una reserva con fechas válidas se obtiene del intervalo real.
- Formulario Modal por orden con máquina, `fecha_inicio` y `duracion_minutos`; envío `PUT produccion/asignar-manual`. Las fechas del formulario se envían con zona `-05:00`.
- Arrastre entre máquinas: asigna al final de la ocupación de destino según la lógica vigente del servidor; para elegir una hora precisa se utiliza el formulario. Arrastre y botón de vuelta a cola envían `maquina: null` al mismo endpoint.
- Autoasignación de todos los pedidos En Cola, con confirmación que advierte la reprogramación de reservas existentes: `POST produccion/auto-asignar`. Presenta `makespan_horas` y el mensaje recibido.
- Solo `can('produccion', 'editar')` habilita controles de edición y arrastre. Las consultas requieren `can('produccion')`.
- Tras guardar o recibir un error se vuelve a consultar el plan. Los conflictos se muestran con el texto del servidor; el formulario conserva sus valores para corregir y reintentar. La API conserva la autoridad sobre compatibilidad y solapamientos.

## Calculadora

- Catálogo real mediante `GET catalogo`, filtros locales por cliente y código/descripción, selección por ID para códigos repetidos entre clientes.
- Cantidad entera positiva con incremento de 1 y validación de entero seguro; cálculo manual mediante `POST calculadora/planchas { producto_id, cantidad }`.
- Presenta planchas, rollos decimales/completos, planchas sobrantes, metros lineales, m², paquetes de 200, residuo y total de bultos.
- Advertencias concordantes con `calcular_planchas_mrp`: valores ausentes/cero de etiquetas por plancha y planchas por rollo sustituyen por 1; largo de plancha por 0 cm; ancho de rollo por 1,52 m. Material no vinculado se informa sin afirmar disponibilidad.
- Explica que esta fórmula individual no utiliza Rollos (base), Etiquetas por rollo ni Largo del rollo y puede diferir del MRP por lote. No se reproduce una fórmula genérica ni se agregan mermas ficticias.
- Cambiar entradas invalida el resultado. Los errores permiten reintentar con la selección y cantidad conservadas. Las advertencias del resultado se guardan junto al cálculo presentado.
- Acceso por `can('calculadora')`; el POST es una consulta, disponible también con nivel ver.

## Reportes de stock y pedidos

- Pestañas Stock, Pedidos y MRP por lote bajo `can('reportes')`. Se consulta únicamente la pestaña activa.
- Stock: `GET reportes/stock?desde&hasta`. Tabla de entradas/salidas del intervalo y stock actual. Se explica que el stock mostrado no es un saldo histórico a la fecha de cierre.
- CSV e impresión/PDF del stock utilizan las filas y filtros de la última respuesta correcta. El CSV incluye intervalo y momento de consulta; escapa comillas y neutraliza fórmulas en campos de texto.
- Excel del inventario: `GET exportar/excel`, con etiqueta y explicación de que es el inventario completo actual. No se anuncia un endpoint inexistente de Excel de movimientos filtrados.
- Pedidos: `GET reportes/pedidos?desde&hasta&cliente&estado`. Tabla con fecha prometida, entrega efectiva, estado, unidades e ítems desplegables.
- La explicación de fechas corresponde al campo real `fecha_entregado`: al aplicar un intervalo se excluyen pedidos sin entrega efectiva. El cliente es búsqueda por contenido y los estados provienen de `orderStates`.
- Descargar y abrir PDF para imprimir usan `POST reportes/pedidos/pdf` con los filtros de la última consulta correcta, aunque los controles se hayan editado después. El PDF vuelve a consultarse en el servidor con esos filtros; no promete congelar filas frente a cambios posteriores de otros usuarios.
- `useReportQuery` publica datos y filtros juntos solo al resolver la consulta. Un error conserva la consulta anterior; Reintentar repite el intento fallido. La vista indica los filtros aplicados y los cambios aún sin consultar. Se abortan respuestas sustituidas o desmontadas.
- Errores de exportación se muestran mediante `Feedback`; se puede repetir la descarga. Si el navegador bloquea abrir un PDF, el botón de descarga sigue disponible. La impresión de stock informa explícitamente el bloqueo de ventanas.

## MRP por lote

- Consulta `GET pedidos`, restringe elegibles a estado exacto `En Cola`; búsqueda, selección individual, seleccionar/quitar todos los visibles y limpiar selección.
- `POST reportes/mrp-lote { pedidos_ids }` como consulta sin modificaciones de producción, material, movimientos o stock.
- Cambiar selección elimina inmediatamente resultado, advertencias de error y datos faltantes anteriores. Una versión de selección protege frente a respuestas tardías.
- Los errores de datos o red no borran la selección. Si un pedido seleccionado deja de estar En Cola o desaparece tras refrescar, se muestra y debe quitarse explícitamente; no se envía silenciosamente un lote diferente.
- Totales completos de pedidos, etiquetas, planchas, rollos, metros, m² y bultos.
- Tabla por cliente/producto con cantidad, planchas, rollos decimales/completos, sobrantes, metros, área, empaque y material.
- Desglose de los siete campos originales de `datos_produccion`, distinguiendo ausente de cero; `fuente_rendimiento_rollo`, rendimiento efectivo, largo aplicado/estimado, ancho y `advertencias`, junto a pedidos de origen.
- Tabla completa de `materiales_bodega`: SKU, material, ancho, planchas, rollos completos, adicionales, estimados/necesarios, metros, m², stock actual y disponibilidad. `suficiente_stock: null` se presenta como desconocida, `false` como insuficiente y `true` como suficiente. Un stock cero se conserva como cero.
- `ApiError.details.datos_faltantes` se interpreta por cliente, código, descripción y campos; se renderiza como información legible, sin volcar JSON.
- Se explica que el informe refleja el momento de cálculo y debe recalcularse después de cambios en pedidos, catálogo o bodega.

## Evidencia y validación pendiente

La revisión realizada fue estática: correspondencia de rutas, verbos y cuerpos con las funciones `get_planificador`, `asignar_manual_produccion`, `auto_asignar_produccion`, `calcular_planchas_mrp`, `reporte_stock`, `reporte_pedidos`, `reporte_pedidos_pdf` y `reporte_mrp_lote`; correspondencia de resultados y siete datos con los diccionarios serializados por el backend; controles contra `REGLAS_ENDPOINT`; lectura de los archivos finales.

Por instrucción de coordinación, no se ejecutaron pruebas, typecheck, build ni navegador: main realizará la validación integrada. No se afirma que esas verificaciones hayan pasado.

Casos que main debe cubrir al integrar:

1. Usuarios con ver/editar/sin permiso en cada módulo, incluyendo Reportes sin permisos de edición de pedidos.
2. Reservar, reprogramar, conflicto entre horarios, restricción Mesp, arrastrar entre máquinas, volver a cola y autoasignar mostrando makespan; confirmar fechas y proporciones a distintas escalas.
3. Calculadora con valores completos y ausentes/cero, cantidad inválida, mismo código de clientes distintos y error recuperable.
4. Consultar un intervalo de pedidos, editar los controles sin consultar y comprobar que PDF/impresión conservan los filtros aplicados. Verificar un intervalo sin resultados y pedidos sin `fecha_entregado`.
5. CSV e impresión de stock filtrado y Excel de inventario completo como acciones distintas.
6. MRP con varios pedidos, selección total visible, datos incompletos legibles, error que conserva selección, invalidación al cambiarla, advertencias, stock cero/insuficiente/desconocido y los siete datos originales.
7. Desplazamiento de tablas y Gantt, formulario en móvil y lectura en ambos temas.

Decisiones dentro del alcance: se ejecutó el plan aprobado en la copia temporal existente; no se aplicaron los pasos generales de Git, subagentes o pruebas de la guía de ejecución porque las instrucciones específicas los excluyen o reservan a main. No hay cambios pendientes de implementación identificados dentro de los tres módulos; queda pendiente su validación integrada.
