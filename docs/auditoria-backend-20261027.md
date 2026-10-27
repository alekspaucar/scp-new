# Auditoría backend SGP — 27 de octubre de 2026

## Alcance y límites

Comparación de texto/AST de `app/routes/main.py`, `app/routes/auth.py`, `app/models.py` y `app/permisos.py` del original `/Users/erickvzh/Desktop/SGP/sgp_docs_completo` contra `backend/app/` de `/private/tmp/sgp-completo-20261027`. El original se usó exclusivamente en lectura: sin importarlo, ejecutarlo, migrarlo, probarlo ni escribir en él. También se leyeron los nombres de sus pruebas como referencia; no se ejecutaron esas suites.

Cambios de esta auditoría: exclusivamente `backend/app/routes/main.py`, `backend/tests/test_functional_audit.py` y este documento, dentro de stage. No se modificaron `config.py`, `seed_demo.py`, frontend, destino final ni servicios. No se copió ninguna cuenta, base o adjunto real; no se usó Git.

Antes de ejecutar se inspeccionó `backend/tests/conftest.py`: cada caso crea SQLite y uploads descartables con UUID bajo stage/backend/instance y stage/backend/uploads, limpia variables `SGP_NUEVA_*`, fija la base y uploads propios y elimina las carpetas al terminar. La aplicación y migraciones ejecutadas pertenecen únicamente a stage y usan esas bases descartables. Las pruebas de arranque/configuración existentes conservan su comportamiento original.

## Resultado comprobado

- Suite inicial de stage: **99 passed, 12 warnings, 6.80 s**.
- Primera reproducción: **24 failed, 2.65 s**, antes de corregir planificación, modo parcial, filtros y zona horaria. Después: **24 passed, 2.18 s**.
- Segunda reproducción: **12 failed, 58 deselected, 1.60 s**, antes de validar tipos de cliente y fecha al crear/editar pedidos.
- Suite completa antes del seguimiento: **169 passed, 15 warnings, 15.51 s**, sin fallos ni casos omitidos. Son **99 casos anteriores + 70 casos nuevos**. De los nuevos, 36 reprodujeron defectos antes de corregirlos y 34 comprueban paridad/efectos de negocio.
- Seguimiento acotado de indicadores, JSON y unidades: reproducción de unidades **5 failed, 10 passed, 70 deselected, 2.28 s**. Indicadores y validación de JSON ya funcionaban; no se modificaron sus implementaciones.
- Suite completa tras el seguimiento de indicadores/JSON/unidades: **184 passed, 15 warnings, 19.88 s**, sin fallos ni casos omitidos. Son **99 anteriores + 85 de auditoría**: 41 casos reprodujeron defectos antes de corregirlos y 44 comprueban paridad/comportamiento existente. Los 15 nuevos casos del seguimiento son 2 de indicadores, 8 de cuerpos JSON no objeto y 5 de unidades.
- Referencias del detalle y último motivo: reproducción **4 failed, 1 passed, 85 deselected, 1.18 s**. Tras implementar, la suite mostró 5 comparaciones de esta misma auditoría que esperaban que creación y detalle tuvieran DTO idéntico: `test_auto_assignment_overflow_rolls_back_entire_batch` y los 4 casos de `test_assignment_cannot_ignore_incompatible_exclusive_machines`. Se ajustaron a comparar el mismo GET antes/después, conservando su verificación de no mutación. Resultado posterior: **189 passed, 15 warnings, 16.59 s**.
- Precondición opcional de estado: reproducción **11 failed, 4 passed, 90 deselected, 1.89 s**. Los 4 casos con Procesando actual ya funcionaban; faltaban el rechazo de 4 editores con estado antiguo y 7 validaciones del valor opcional.
- Suite completa antes de los últimos dos hallazgos de revisión: **204 passed, 15 warnings, 18.19 s**, sin fallos ni casos omitidos. Total: **99 anteriores + 105 de auditoría** (56 reproducciones previas a corrección y 49 casos de paridad/comportamiento existente).
- Nulos explícitos y precondición de revisión de ítems: reproducción **19 failed, 4 passed, 105 deselected, 2.80 s**. Los nuevos casos abarcan 3 referencias sin coincidencia, las cuatro mutaciones con revisión actual/antigua, suspensión/modo apagado/cambio de cantidad mientras el pedido sigue Procesando, 8 tipos/valores inválidos y revisión enviada sin estado esperado.
- Suite previa al ajuste del test de factura: **1 failed, 226 passed, 15 warnings, 21.32 s**. Total recogido: **227 casos = 99 anteriores + 128 de auditoría**. Los 128 de auditoría pasaron (75 reproducciones previas a corrección y 53 comprobaciones de paridad/comportamiento existente).
- El fallo era `tests/test_critical_corrections.py::test_invoice_optimistic_conflict_rolls_back_and_removes_unreferenced_upload`: comparaba POST creación (DTO resumido sin referencias) con GET detalle (con referencias nulas explícitas). El **coordinador** ajustó el baseline a GET antes de subir factura, manteniendo la comparación estricta del GET completo después del conflicto y las comprobaciones de 409/archivo eliminado. Este worker no editó ese archivo ni amplió el DTO de creación para acomodar el test.
- Primera repetición posterior: **1 failed, 226 passed, 15 warnings, 20.68 s**, por un 403 intermitente en `test_nonobject_json_is_400_on_login_and_writes_but_401_without_session[payload1]`, petición POST `/api/pedidos/99999/items/99999/entregas` con `[{}]`. Ese mismo caso aislado pasó después (**1 passed, 0.61 s**) sin cambios de código. No se confirmó la causa; las suites concurrentes que crean enlaces de almacenamiento comparten las raíces inspeccionadas por `validate_storage`, por lo que no conviene solaparlas.
- **Última suite completa verificada: 227 passed, 15 warnings, 19.55 s**, sin fallos ni casos omitidos. Incluye los **128/128 casos de auditoría** y el test de factura cuyo baseline ajustó el coordinador. No hubo cambios de producción ni de pruebas entre el 403 intermitente, su repetición aislada y esta ejecución completa aprobada.
- Las 15 advertencias son `LegacyAPIWarning` de `Query.get()` de Flask-SQLAlchemy: 12 en `test_critical_corrections.py`, 3 en `test_functional_audit.py`.

Comando final, ejecutado desde `/private/tmp/sgp-completo-20261027/backend`:

```sh
PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=/private/tmp/sgp-completo-20261027/backend \
'/Users/erickvzh/Desktop/nueva interfaz/erp-manufacturing-dashboard/backend/.venv/bin/python' \
  -m pytest -q -p no:cacheprovider --tb=short --show-capture=no
```

Se usó el intérprete del destino autorizado, pero los imports de aplicación y las pruebas se resolvieron en stage. No hubo peticiones de esta auditoría a servicios vivos; todas las comprobaciones funcionales usaron el cliente de pruebas de Flask. El coordinador gestiona los servicios 3001/5102 y su reinicio.

## Defectos reproducidos y correcciones

| Defecto observado antes de corregir | Corrección mínima en main.py | Evidencia nueva |
| --- | --- | --- |
| Autoasignar `[id_valido, true/objeto/texto/decimal/negativo]` asignaba una parte o provocaba un error de SQLite. | Validación de IDs antes de consultar; enteros positivos seguros; deduplicación. | `test_auto_assignment_rejects_invalid_ids_without_assigning_valid_selection` (5 casos). |
| IDs inexistentes o pedidos Procesando mezclados con En Cola se omitían y el resto se guardaba como éxito. | Selección completa obligatoria: 404 con `pedidos_no_encontrados`, o 400 con `pedidos_fuera_cola`, sin modificar reservas. | `test_auto_assignment_rejects_missing_ids_atomically`, `test_auto_assignment_rejects_nonqueued_selection_atomically`. |
| Duraciones extremas válidas como flotante desbordaban `timedelta` durante la autoasignación. | Preparar y validar todas las propuestas antes de modificar pedidos; error JSON 400 y rollback. | `test_auto_assignment_overflow_rolls_back_entire_batch`. |
| Un pedido con ítems que requieren máquinas exclusivas distintas terminaba usando una sola y omitiendo otra restricción. | Detectar restricciones incompatibles, rechazar asignación manual/automática y mantener el pedido visible con explicación en agenda. | `test_assignment_cannot_ignore_incompatible_exclusive_machines` (4 casos). |
| `activo: "false"` activaba parciales; números, null y listas también se convertían silenciosamente a booleanos. | Exigir booleano real para el interruptor existente. | `test_partial_mode_requires_boolean_without_mutating_order` (4 casos). |
| Los filtros del PDF admitían objetos/listas como vacíos o provocaban errores al llamar `.strip()`; sumar un día a 9999-12-31 fallaba en reportes JSON y PDF. | Validación de tipos y del desbordamiento del límite superior, con respuesta JSON 400. | `test_order_report_pdf_invalid_filters_return_json_error` (5), `test_report_end_date_overflow_is_validation_error` (2). |
| Monitor eliminaba el offset de una fecha ISO; 13:00 UTC se comparaba como 13:00 Ecuador en lugar de 08:00. | Convertir primero a America/Guayaquil; conservar las fechas locales sin zona y los criterios originales de riesgo. | `test_monitor_normalizes_timezone_before_comparing_deadline`. |
| Crear/editar pedidos convertía objetos/listas/flotantes en nombres de clientes y números/objetos en fechas. Un booleano podía interpretarse como ID. | Validar tipos antes de resolver/crear cliente: nombre o ID entero; fecha en texto. Se conservan los formatos flexibles de fecha existentes. | `test_order_rejects_malformed_customer_and_deadline_without_creating_records` (12 casos, con comprobación de que no quedan clientes/pedidos nuevos). |

El algoritmo de asignación conserva LPT entre M1/M2, maquinaria exclusiva, cálculo cantidad × tiempo base, fallback de 0.05 minutos cuando falta catálogo y mínimo de preparación de 10 minutos. Se conserva la validación de solapamiento y las reservas ajenas a la selección. Las pruebas concurrentes observan un único ganador para retirar el último rollo, entregar 60 de 100 unidades y reservar dos pedidos en la misma máquina/horario.

## Contratos que debe conocer el coordinador

- La asignación manual sigue admitiendo omitir `fecha_inicio` y `duracion_minutos`: usa la duración guardada/calculada y coloca el pedido después de la última reserva activa futura de esa máquina. `maquina: null` libera la reserva. No se exige `revision` nueva para esta acción.
- En `GET /api/produccion/planificador`, solamente los pedidos con cálculo inválido incorporan `error_planificacion: string` y `minutos_calculados: null`; `maquina_requerida_fija` queda null en ese caso. Los pedidos válidos conservan sus campos/tipos. La agenda responde 200 para permitir corregir o liberar la reserva de un pedido incompatible.
- Autoasignación rechaza la selección completa cuando hay IDs inválidos (400), ausentes (404) o estados fuera de En Cola (400). Los IDs numéricos enviados como texto entero siguen aceptándose.
- Modo parcial exige `{activo: true|false}` real. Pedidos exigen cliente como texto/ID entero y fecha como texto. Los clientes normales actuales no requieren cambios.
- Permanecen intactos los contratos estrictos de consumo, `revision_calculo`, PDF reconstruido y rechazado si el snapshot cambió, y la precondición `revision` de edición de cabeceras (428/400/409). No se modificaron los servicios de consumo ni los modelos de revisión.
- Seguimiento autorizado: `movimiento_a_dict` y cada fila de `GET /api/reportes/stock` añaden `unidad_medida`, tomada de `Material.unidad_medida`. Esto incluye GET movimientos y la respuesta de POST movimientos. Devuelve null si el material ya no existe; no inventa rollos ni una unidad histórica. Los campos/cantidades anteriores se conservan.
- Referencias autorizadas: `pedido_a_dict(p, incluir_referencias=False)` conserva el formato resumido por defecto. Solo GET `/api/pedidos/:id` activa referencias para los primeros 50 ítems de su DTO. Una coincidencia única resuelta con `_catalogo_item(item, pedido.cliente)` devuelve `imagen_url`, `imagen_referencia` y `material_sku`; esos valores pueden ser null si el producto no tiene adjunto/material. **Sin coincidencia única, las tres claves se incluyen explícitamente con valor null**: el consumidor no debe sustituir ese resultado negativo por una asociación aproximada de catálogo. Solo después de los primeros 50 se omiten las claves. No añade referencias a listados, monitor ni respuestas de mutación, ni cambia permisos o crea endpoints.
- El DTO de pedido incorpora `observacion_retroceso`, texto o null: es el último motivo almacenado, **no un historial completo**. La UI puede etiquetarlo como último motivo.
- Precondición opcional: PUT estado del ítem, PATCH modo parcial, POST entrega y DELETE entrega aceptan `estado_pedido_esperado` en su objeto JSON (también en el cuerpo de DELETE). Si se proporciona debe ser un texto exacto de `ESTADOS_PEDIDO`; inválido devuelve JSON 400 con `codigo: estado_pedido_esperado_invalido`. Si no coincide con el estado actual, devuelve JSON 409 con `codigo: estado_pedido_desactualizado` y `estado_actual`, antes de cambiar datos y bajo el `BEGIN IMMEDIATE` existente. Sin campo se conserva el comportamiento original. No se exige Procesando globalmente: la nueva UI puede enviar `'Procesando'` como precondición de su editor. No se aplica a faltantes/preacabados, cabeceras o cambios de estado del pedido.
- Las mismas cuatro mutaciones también aceptan **`revision_pedido_esperada`**, independientemente del campo de estado. Debe ser un entero positivo real (no booleano, decimal ni texto); valor inválido devuelve JSON 400 con `codigo: revision_invalida`. Si difiere de `pedido.revision`, devuelve JSON 409 con `codigo: revision_desactualizada` y `revision_actual`. La comparación ocurre bajo el mismo bloqueo de escritura y antes de mutar datos. La UI debe enviar la revisión capturada al abrir/iniciar su edición; no consultar una revisión nueva al confirmar una operación antigua. Así se detectan cambios de suspensión, modo parcial, cantidades y cualquier modificación versionada del pedido aunque su estado siga Procesando. Si no se proporciona, conserva el comportamiento anterior. Faltantes/preacabados no adquieren una nueva precondición.

## Matriz de endpoints

Inventario estático: **55 declaraciones de ruta en main.py original, 57 en stage**, sin rutas de negocio originales ausentes. Las dos adicionales son los PDFs de consumo ya existentes en stage antes de esta auditoría. En auth hay 3 rutas de sesión originales conservadas y 3 de salud/instalación propias; las dos rutas de distribución Angular se sustituyen por la aplicación Next.js y no se sirven desde Flask. `GET /api/indicadores` pertenece al blueprint nuevo de indicadores.

La prueba `test_all_business_routes_require_session_and_enforce_revocation` recorre **las 57 rutas reales de main**, sustituye IDs/filenames y comprueba 401 sin sesión y 403 con permisos `ninguno`. Esa prueba acredita el bloqueo de acceso, no todos los caminos positivos posibles de cada endpoint. La columna de evidencia distingue las comprobaciones funcionales positivas principales. Los nombres abreviados se refieren a pruebas de `test_functional_audit.py`; cuando procede se nombra otra suite.

| Método y ruta | Paridad / regla conservada | Evidencia funcional |
| --- | --- | --- |
| GET /api/materiales | Lista y estados calculados. | `material_crud…`, `test_operations.py`. |
| POST /api/materiales | Crear o sumar al SKU existente; unidad/clasificación por categoría. | `material_crud…`. |
| PUT /api/materiales/:id | Cabecera con revisión; sin restaurar stock desde una edición antigua. | `material_crud…`, `test_critical_corrections.py`. |
| DELETE /api/materiales/:id | Impedir borrar material con movimientos o catálogo. | `material_crud…`, `catalog_code_uniqueness…`. |
| GET /api/materiales/contador-criticos | Crítico/Agotado. | `material_crud…`. |
| GET /api/movimientos | Historial descendente, hasta 50; unidad del material añadida en seguimiento. | `test_operations.py`, `delivered_edit_and_delete…`, `stock_and_movement_rows_include_material_units…`, `orphaned_movement_units…`. |
| POST /api/movimientos | Entrada/Salida entera, no sobrepasar existencias; unidad añadida al movimiento devuelto. | `test_operations.py`, `concurrent_stock_partial…`, `stock_and_movement_rows_include_material_units…`. |
| GET /api/pedidos | Cabecera, progreso, entregas y faltantes. | `partial_history…`, `order_rejects_malformed…`. |
| POST /api/pedidos | Cliente por nombre/ID, alta rápida, ítems y totales. | Helpers de pedidos, `client_crud…`, `order_rejects_malformed…`. |
| POST /api/pedidos/leer-documento | PDF/OCR de prellenado; no crea pedido automáticamente. | `document_pdf_extraction…` para PDF real y entradas inválidas; OCR de imagen no ejecutado. |
| GET /api/pedidos/:id | Detalle con historial, IDs y referencias acotadas/seguras por cliente; nulos explícitos sin coincidencia; último motivo de retroceso. | `partial_history…`, `order_reader_gets_customer_safe_detail…` (código normal y '-'), `detail_references_stop_at_fifty…`, `ambiguous_blank_code…`, `detail_nonmatching_catalog_explicitly_nulls…`, `order_dto_exposes_only_last_stored…`. Test crítico de factura aprobado tras adaptar su baseline el coordinador. |
| PUT /api/pedidos/:id | IDs/historial conservados, cantidades >= entregadas, revisión y stock de Entregado. | `partial_history…`, `delivered_edit_and_delete…`, `test_critical_corrections.py`. |
| DELETE /api/pedidos/:id | Revertir neto real de stock entregado, conservar movimientos. | `delivered_edit_and_delete…`. |
| PUT /api/pedidos/:id/estado | En Cola→Procesando→Terminado→Facturado→Retiro/Entregado; terminar marca pendientes listos. | `backward_transition…`, helpers `advance`, `test_operations.py`. |
| PUT /api/pedidos/:id/retroceder | Solo estados establecidos; observación obligatoria, conservar ítems. | `backward_transition…`. |
| PUT /api/pedidos/:id/items/:item/estado | Listo/pendiente/suspendido/parcial; motivo al suspender y coherencia del pedido; estado/revisión esperados opcionales. | `order_pdf_and_report_filters…`, `item_and_delivery_ids…`, `test_critical_corrections.py`, `expected_order_state_allows…`, `expected_order_revision_guards_all_four…`. |
| POST /api/pedidos/:id/items/:item/entregas | Límites y completar automáticamente; no consumir stock aquí; estado/revisión esperados opcionales. | `partial_history…`, `concurrent_stock_partial…`, `test_operations.py`, `expected_order_state_allows…`, `expected_order_revision_guards_all_four…`, `pending_delivery_cannot_overwrite…`, `revision_precondition_is_independent…`. |
| DELETE /api/pedidos/:id/items/:item/entregas/:entrega | Recalcular avance y reabrir pedido terminado cuando corresponde; estado/revisión esperados opcionales. | `partial_history…`, `expected_order_state_allows…`, `expected_order_revision_guards_all_four…`. |
| PATCH /api/pedidos/:id/items/:item/modo-parcial | Interruptor bidireccional sin borrar movimientos; estado/revisión esperados opcionales. | `partial_history…`, `partial_mode_requires_boolean…`, `expected_order_state_allows…`, `expected_order_state_rejects_invalid…`, `expected_order_revision_guards_all_four…`, `expected_order_revision_requires_positive_integer…`. |
| POST /api/pedidos/:id/items/:item/faltantes | Alertas Corte/Impresión, cantidades/unidades/motivo. | `partial_history…`, `item_and_delivery_ids…`. |
| PUT /api/pedidos/faltantes/:id/resolver | Resolución y fecha. | `partial_history…`, `test_operations.py`. |
| DELETE /api/pedidos/faltantes/:id | Eliminar reporte autorizado. | `partial_history…`. |
| GET /api/pedidos/contador-activos | Todos excepto Entregado. | `backward_transition…`. |
| POST /api/pedidos/:id/factura | Validar contenido/extensión y rollback de archivo al fallar guardado. | `test_critical_corrections.py`: formatos válidos y conflicto optimista. |
| GET /api/pedidos/monitor-tv | Riesgo/progreso, clientes/logos, fechas. | `monitor_normalizes_timezone…`, `client_crud…`. |
| GET /api/pedidos/:id/pdf | Cliente/OC/ítems/materiales e imagen especial; inline opcional. | `order_pdf_and_report_filters…`, `catalog_code_uniqueness…`; lectura de contenido PDF. |
| GET /api/catalogo | Productos y rendimientos. | Helpers y pruebas de consumo. |
| POST /api/catalogo | Código por cliente; '-' repetible; dimensiones/tiempo/máquina. | `catalog_code_uniqueness…`, `duplicate_items_and_no_code…`. |
| PUT /api/catalogo/:id | Edición y vínculo con material. | `delivered_edit_and_delete…`, `order_revision_and_catalog…`. |
| DELETE /api/catalogo/:id | Borrar producto. | `catalog_code_uniqueness…`. |
| POST /api/catalogo/:id/imagen | Subida referencial por extensión. | `catalog_code_uniqueness…`. |
| DELETE /api/catalogo/:id/imagen | Quitar referencia y archivo tras commit. | `catalog_code_uniqueness…`. |
| GET /uploads/catalogo/:filename | Archivo dentro del storage propio y sujeto a permisos. | `catalog_code_uniqueness…`, bloqueo transversal, `test_isolation.py`. |
| POST /api/calculadora/planchas | Consumo estricto, fracciones y disponibilidad; sin descuento. | `calculator_and_batch…`, `calculator_reports_missing…`, `consumption_keeps_fractional…`, cantidades inválidas (6). |
| POST /api/calculadora/planchas/pdf | Adición previa de stage: mismo snapshot reconstruido. | `calculator_and_batch…`, `order_revision_and_catalog…`. |
| GET /api/clientes | Directorio auxiliar autorizado. | `client_crud…`, `document_pdf_extraction…`. |
| POST /api/clientes | Alta y unicidad del código. | `client_crud…`. |
| PUT /api/clientes/:id | Datos de contacto/facturación/entrega. | `client_crud…`. |
| DELETE /api/clientes/:id | Directorio independiente; pedido conserva el nombre. | `client_crud…`. |
| POST /api/clientes/:id/logo | PNG hasta 200 KB y 200×200. | `client_crud…`: PNG válido, contenido inválido, extensión y exceso de dimensión. |
| GET /uploads/facturas/:filename | Archivo propio, tipo validado inline y nosniff. | `test_critical_corrections.py`. |
| GET /uploads/logos/:filename | Logo dentro de storage propio y sujeto a permisos. | `client_crud…`, bloqueo transversal. |
| POST /api/importar/excel | Sumar SKU existente, crear nuevo, omitir filas sin identidad/cantidad inválida, rollback ante error de medida. | `import_is_additive…`, `import_invalid_measurement…`. |
| GET /api/exportar/excel | XLSX real con campos y existencias. | `import_is_additive…`: apertura y lectura con openpyxl. |
| GET /api/reportes/stock | Entradas/salidas por rango; stock resultante actual; unidad del material añadida en seguimiento. | `stock_report_counts…`, `report_end_date_overflow…`, `stock_and_movement_rows_include_material_units…`, `orphaned_movement_units…`. |
| GET /api/reportes/pedidos | Filtros cliente/estado; fechas sobre fecha_entregado. | `order_pdf_and_report_filters…`, `report_end_date_overflow…`. |
| POST /api/reportes/pedidos/pdf | Mismos filtros de negocio, notas y escape de texto. | `order_pdf_and_report_filters…`, `order_report_pdf_invalid_filters…`. |
| POST /api/reportes/mrp-lote | Cliente/código y descripción si '-', suma exacta, compatibilidad material, solo En Cola. | `duplicate_items_and_no_code…`, `calculator_and_batch…`, `mrp_incompatible_material…`. |
| POST /api/reportes/mrp-lote/pdf | Adición previa de stage: snapshot consistente con lote/stock/catálogo. | `calculator_and_batch…`, `order_revision_and_catalog…`. |
| GET /api/produccion/planificador | M1/M2/Mesp, activas y sin asignar. | Pruebas manual/automática y conflictos exclusivos. |
| POST /api/produccion/auto-asignar | LPT, máquinas fijas, reservas ajenas y validación completa. | Pruebas `auto_assignment…`, `assignment_cannot_ignore…`. |
| PUT /api/produccion/asignar-manual | Máquina/hora/duración, solapamiento y liberar reserva. | `manual_assignment_conflicts…`, `concurrent_stock_partial…`, `test_operations.py` omitiendo duración. |
| GET /api/usuarios | Solo gestores. | `test_critical_corrections.py`, bloqueo transversal. |
| POST /api/usuarios | Cuenta+permisos atómicos. | `test_critical_corrections.py`, `manager_self_protection…`. |
| PUT /api/usuarios/:id | Rol/contraseña/permisos; no cambiar rol propio. | `test_critical_corrections.py`, `manager_self_protection…`. |
| PUT /api/usuarios/:id/permisos | Permisos completos o null para restaurar rol; efecto en sesión existente. | `test_critical_corrections.py`, `test_operations.py`. |
| DELETE /api/usuarios/:id | No borrarse; anular referencias de usuario y cerrar acceso de sesión eliminada. | `manager_self_protection…`, `test_critical_corrections.py`. |
| POST /api/login | Contraseña y sesión permanente de la instalación. | `test_isolation.py`, `test_critical_corrections.py`. |
| GET /api/sesion | Identidad/permisos actuales, no credenciales. | `test_isolation.py`, revocación y cookies antiguas en suite crítica. |
| GET /logout | Cerrar sesión. | `test_isolation.py`, `test_operations.py`. |
| GET /api/health | Adición previa: salud propia. | `test_isolation.py`. |
| GET /api/instalacion | Adición previa: estado de configuración propia. | `test_isolation.py`. |
| POST /api/instalacion | Adición previa: primera cuenta local explícita y atómica. | `test_isolation.py`, incluidos accesos remotos y concurrencia. |
| GET /api/indicadores | Adición previa de stage: contadores por permisos y cuenta actual. | `indicators_positive_counts…`, `indicators_permissions_revocation_and_account_switch…`: conteos reales, fecha local/límites diarios, faltantes deduplicados por pedido para alertas, restricción por módulo, revocación y cambio de identidad. |
| GET /app y /app/:path | Distribución Angular del original, sustituida por Next.js. | `test_isolation.py` acredita 404 deliberado de Flask. |

## Modelos, permisos y reglas preservadas

Los nueve modelos funcionales y sus relaciones están presentes: Usuario, Material, Movimiento, Pedido, PedidoItem, EntregaParcialItem, ReporteFaltante, ProductoCatalogo y Cliente. Las diferencias previas de stage en Usuario/Material/Pedido proporcionan cookies ligadas a la contraseña y revisiones optimistas; esta auditoría no modificó modelos. El listener de cambios hijos mantiene la revisión de pedido y sus pruebas críticas anteriores siguen aprobadas.

Las nueve funciones de permisos coinciden por AST con el original; el mapa de reglas de stage solo añade las dos rutas de PDF de consumo. Se conservan las diferencias operativas: gestionar cuentas requiere admin/jefe; editar cabecera de Entregado requiere jefe; editar producción no concede edición del catálogo o de la cabecera. Todas las rutas de negocio rechazan accesos directos sin permiso. Los POST de reportes/calculadora siguen siendo operaciones de lectura según la política existente.

El descuento al entregar sigue siendo el de negocio original: por ítem/catálogo del cliente, `ceil(cantidad / cant_etiquetas_rollo)`, limitado a existencias reales. La reversión sigue los movimientos con `pedido_origen_id`, no el catálogo actual ni la observación. Se verificó cambiar de material en catálogo entre entrega y edición y luego eliminar el pedido: los dos materiales recuperan exactamente las existencias correspondientes, sin stock ficticio. Los parciales siguen sin consumir bodega; el interruptor puede apagarse y encenderse conservando las entregas. No se forzó una nueva regla global de estado para operar ítems porque el backend original no la impone; solo se comprueba el estado esperado cuando el consumidor lo envía expresamente.

La calculadora/MRP estrictos y sus PDFs existentes no se relajaron: datos faltantes devuelven 400, cantidades inseguras se rechazan, rendimientos racionales/estimaciones se conservan, una unidad no convertible a rollos o dimensiones incompatibles no afirman disponibilidad, y cambios de pedido/catálogo/stock invalidan el PDF anterior con 409. Las pruebas comprueban que cálculo, planificación y generación de reportes no descuentan stock.

No hay endpoints implementados de AQL, Compras ni Zebra en los archivos de rutas auditados; la mención AQL original nombra un Excel de referencia para MRP. No se crearon módulos ni reglas para esos nombres. El backend original implementa exportación XLSX; no se inventó una API CSV. El campo de unidad añadido permite al consumidor distinguir rollos de tintas/herramientas en unidades, también cuando construya su CSV.

El seguimiento de cuerpos JSON probó array vacío, array con objeto, texto vacío, texto no vacío, número, true, false y null reales con `application/json`. Para cada uno recorrió todas las rutas main POST/PUT/PATCH, verificó JSON 400 con sesión autorizada y JSON 401 sin sesión; login devolvió JSON 400. También comprobó que no quedaron pedidos/materiales/clientes creados. No se reprodujo un fallo 500 en estos casos y por ello no se modificó la validación existente ni auth.py.

El seguimiento del detalle comprobó lectura con permisos personalizados únicamente `pedidos: ver`: GET catálogo permanece 403, GET detalle incluye la referencia correcta y el archivo responde 200 según el permiso ya existente. El mismo código para otro cliente no alimenta las referencias de ese pedido; código '-' requiere también la descripción, y coincidencias ambiguas no eligen un producto arbitrario. Con 55 ítems se observaron como máximo 50 SELECT de catálogo en detalle y cero en listado/monitor, sin perder los ítems que exceden el límite de referencias.

La revisión posterior verifica claves explícitas a null cuando la descripción de un código '-' solo difiere por mayúsculas, el producto pertenece a otro cliente o existen coincidencias ambiguas. La resolución sigue exactamente `_catalogo_item`, también usada en PDF/stock; no se aproximaron las descripciones ni se ampliaron las consultas a listados.

El seguimiento de estado comprobó las cuatro mutaciones tras pasar de Procesando a Terminado: con expectativa antigua Procesando todas devuelven 409 y el GET completo, incluidos revisión e historial, permanece idéntico. Con Procesando actual las cuatro guardan correctamente. Siete valores inválidos se rechazan sin cambios. Las 189 pruebas previas, que no requieren este nuevo campo, siguen aprobadas.

El seguimiento de revisión comprueba que una entrega pendiente de 80 unidades no puede completar 20/100 previas y sobrescribir una suspensión nueva, aplicarse tras apagar el modo parcial ni usar una cantidad antigua tras editarla a 200. El pedido sigue Procesando en los tres casos; con revisión capturada antigua devuelve 409 y conserva íntegramente revisión, estado de ítem, modo, cantidad e historial. Las cuatro acciones también rechazan revisiones antiguas tras cambiar la cabecera y aceptan la revisión actual. La revisión funciona sin exigir el campo de estado y no se convirtió en una condición obligatoria para consumidores existentes.

## Límites de la evidencia

Los PDFs se generaron, abrieron y verificaron por contenido; no se certificó su maquetación visual ni impresión física. La extracción de PDF fue real; OCR de imágenes, red de planta e impresoras no se probaron. No se certifican todos los datos históricos reales ni todas las combinaciones posibles de catálogos; no se abrió la base real. La verificación de UI, tipos, navegador/e2e y la integración al destino corresponden al coordinador. Los últimos cambios y la suite completa de 227 casos están verificados; el ajuste del baseline de factura fue del coordinador. Se conserva arriba la evidencia del 403 intermitente observado en una repetición previa, sin atribuirle una causa confirmada. Este worker no reinició servicios ni escribió en el destino final.
