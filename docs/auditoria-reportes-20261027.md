# Auditoría de Calculadora y Reportes — 2026-10-27

## Alcance y entrega

Worker independiente 4. Únicos archivos escritos en `/private/tmp/sgp-completo-20261027`:

- `components/planning/calculator.tsx`
- `components/planning/reports.tsx`
- `components/planning/consumption.css` (nuevo; todos los selectores limitados a Calculadora/Reportes)
- `tests/reports-audit.test.ts` (nuevo)
- `docs/auditoria-reportes-20261027.md` (este informe)

El original `/Users/erickvzh/Desktop/SGP/sgp_docs_completo` se consultó exclusivamente mediante lecturas. No se ejecutó, importó ni probó. Sin escrituras en Gantt, `planning.css`, shared, lib, tipos, backend, base de datos, Git, destino final o JARVIS. No se iniciaron servicios ni navegadores; los puertos 3001/5102 y los recorridos finales pertenecen al padre.

## Fuentes y criterio

Fuentes originales revisadas completas: `sgp-frontend/src/app/pages/reportes/reportes.ts`, `reportes.html`, `components/calculadora-planchas/calculadora-planchas.ts`, `calculadora-planchas.html`; también `services/calculadora.service.ts`, sus consumidores de Sidebar/MobileNav, y las funciones de calculadora, reportes y MRP de `app/routes/main.py`.

Fuentes actuales en stage: los dos componentes, `lib/api.ts`, `lib/consumption-types.ts`, tipos y sesión; lectura de `backend/app/routes/main.py`, `backend/app/services/consumption.py`, política de permisos y plan `docs/2026-10-27-revision-integral-plan.md`.

JARVIS: `000_HOME.md`, `002_Proyectos/SGP_Proprint/reportes.md`, `fase2-planificacion-preacabados.md` y `roles-permisos.md`. Las notas son contexto histórico: por ejemplo, «todos los usuarios con sesión pueden ver reportes» está superado por los permisos efectivos por módulo. Tampoco se interpreta una fórmula documentada del Excel como motivo para restaurar los valores por defecto incorrectos de la calculadora antigua.

Diseño: se conserva Geist local y la paleta existente (`--ink` #293b58, `--muted` #63738e, `--panel-solid` #f8faff, `--field` #ffffff, `--accent` #5268cf, con sus equivalentes oscuros). Lectura de izquierda a derecha en escritorio: producto/cantidad, resultado; luego disponibilidad y detalle. En móvil se apila en ese orden y cada fila de reporte muestra sus etiquetas. Las advertencias operativas permanecen visibles; fórmulas, orígenes, consumo fraccionario y empaque detallado son desplegables.

## Matriz de cobertura funcional

Las rutas de evidencia original son relativas a la raíz original; las de entrega, a la raíz stage.

| Función real original y evidencia | Entrega y evidencia | Resultado |
|---|---|---|
| Búsqueda por código, descripción **y cliente**, `calculadora-planchas.ts:39` | `Calculator`, término recortado y selector nativo con cliente/código/descripción | Completado: se recupera búsqueda por cliente; sin elegir silenciosamente el primer código duplicado |
| Sugerencias limitadas a 10/15 y ficha de producto, `calculadora-planchas.ts:39`, `.html` | Selector nativo con todos los resultados filtrados y ficha textual | Misma elección de producto, accesible con teclado y móvil; sin truncar el catálogo |
| Preselección por código en servicio, `calculadora-planchas.ts:113,135`, `calculadora.service.ts` | Preselección mediante URL por ID, o código + cliente; enlace desde cada producto MRP | Completado. Coincidencias múltiples exigen selección explícita; ID inexistente informa y deja buscar |
| Cantidad entera positiva y limpiar selección, `calculadora-planchas.ts:54,151` | `Calculator`: cantidad segura, min/step/max y limpieza completa | Conservado; resultados anteriores se invalidan al editar |
| Incrementos +500/+1000/+5000, `calculadora-planchas.ts:157`, `.html` | `increasedQuantity`, grupo de botones, protección ante fracciones, negativos y overflow | Recuperado, partiendo de cero únicamente si el campo está vacío |
| Planchas como resultado principal, `.html` | Resumen principal «Planchas totales» | Conservado |
| Rollos completos y fracción de planchas, metros, m², paquetes/residuo/bultos, `calculo` en `.ts` | Valores del servidor; fracciones exactas y desglose progresivo | Conservado sin fórmula local ni redondeo intermedio |
| Cálculo local reactivo con defaults ep=1/pr=1/ancho=1.52 | POST explícito a cálculo estricto | Sustitución intencional: nunca fabricar rendimientos ni áreas válidas con datos ausentes |
| Aviso antiguo «no tocar / afecta datos reales», `.html` | Información de consulta sin reserva/descuento y advertencias reales de datos/compatibilidad/stock | Se retira aviso engañoso; no oculta fallos críticos |
| Catálogo, carga/errores y cambio de producto | `useResource`, `DataState`, actualizar y limpiar | Conservado, con resultado invalidado si cambia el producto consultado |
| Pestañas Stock/Pedidos/MRP, `reportes.ts:26`, `.html` | `Reports`: pestañas con tabpanel, flechas/Home/End y foco | Conservado y completado para teclado |
| Fechas desde/hasta y rango invertido, `reportes.ts:164` | `ReportFilters`, límite final incluido, formulario y limpiar filtros | Conservado; rango invertido no consulta |
| Stock: material, SKU, entradas/salidas y saldo, `reportes.html`, `reporte_stock` original | `StockReport`, CSV e impresión usan snapshot de filas y fechas | Conservado, aclarando saldo **actual**, no saldo histórico al cierre |
| Unidades del stock documentadas en JARVIS | Campo opcional `unidad_medida`, texto «Sin unidad informada» y advertencia | Preparado en frontend; contrato backend pendiente, detallado abajo |
| Excel de inventario completo, `reportes.ts:201` | `GET exportar/excel` → `inventario_sgp.xlsx` | Conservado e identificado como completo/sin filtro de fechas |
| CSV de reportes | No existe acción CSV en `reportes.ts/.html` original revisados | Se conserva y mejora el CSV ya implementado en stage: BOM, separador `;`, escape y neutralización de fórmulas, unidad y fechas consultadas |
| Impresión/PDF de stock | No existe en la página original revisada | Se conserva la mejora stage: filas consultadas, HTML escapado, unidades, detección de ventana bloqueada |
| Pedidos por cliente (contiene), estado y entrega efectiva, `reportes.ts:164`, API original | `OrdersReport`, filtros normalizados compartidos por GET y POST PDF | Conservado; nunca se sustituye el filtro aplicado por el borrador |
| Fechas prometida/efectiva, ítems y unidades, `.html` original | Tabla adaptable más OC, detalle de ítems/estado/observación | Conservado y ampliado |
| Descargar PDF e imprimir, `reportes.ts:223,239` | Descargar PDF / abrir PDF para imprimir; fallback de descarga de `download` existente | Conservado; los filtros son de última consulta correcta. Se aclara que los datos del PDF se vuelven a consultar al generarlo |
| Filtros consultados vs editados, `reportes.ts:38,190,216` | `useReportQuery`: filas/filtros/fecha se publican juntos; borrador separado | Conservado, incluso tras respuesta tardía o consulta fallida |
| Selección individual y todos los pedidos En Cola, `reportes.ts:50,98,114` | `BatchMRP`: tarjetas, selección de visibles, toda la cola, limpiar y contador de ocultos | Conservado. La búsqueda no borra pedidos ya seleccionados |
| Auto-preseleccionar/calcular toda la cola al abrir, `reportes.ts:83–87` | Selección y cálculo explícitos | Cambio deliberado de interacción: evita un lote implícito; «Seleccionar toda la cola» mantiene la operación masiva |
| Actualizar cola y descartar cálculo anterior, `reportes.ts:63` | Actualizar invalida resultado; conserva selección y muestra pedidos eliminados/fuera de cola para retirarlos | Conservado con control de cambios de fuente |
| Grupos por cliente+código y descripción si código ausente, API original MRP | Se representan `items_agrupados` del servidor sin reagrupar; claves incluyen cliente/código/id/descripción | Conservado, evitando colisiones de claves cuando se comparte producto de catálogo |
| Totales de etiquetas/planchas/rollos/m/m²/bultos, `.html` original | `MRPOutput`, valores y fracciones proporcionados por servidor | Conservado; enteros por material no se recalculan sumando techos de productos |
| Pedidos de origen y base de producción, `.html` original | Desplegables `ConsumptionDetails` y «Pedidos incluidos» | Conservado con fórmulas/medidas/fuente del rendimiento del servidor |
| `datos_faltantes` por producto, `reportes.ts:154` | `missingProductionData` / `MissingProduction` con cliente/código/descripcion/campos | Conservado y aplicado también a calculadora individual |
| Disponibilidad por material, stock suficiente/insuficiente/sin vínculo, `.html` original | `MaterialAvailability` con estado trivalente y advertencias del servidor | Conservado: null nunca equivale a cero o suficiente; compatibilidad y reservas se explican |
| Protección contra respuestas de cálculos antiguos, `generacionMrp` original | Generación, firma de fuente/entrada y limpieza al desmontar | Reforzado para cambios de catálogo/pedido mientras una consulta está pendiente |
| PDF de consumo individual y de lote | Ya existía en stage, no en original revisado | Conservado: POST con parámetros del snapshot + `revision_calculo`; 400/404/409 invalidan resultado y obligan a recalcular |
| Permisos, `puedeVer` original | `can('calculadora')` / `can('reportes')`, guardas en acciones y consultas auxiliares | Conservado. Enlace MRP→Calculadora solo con permiso de Calculadora; no exige edición para consultas |
| Tarjetas móviles originales de stock/pedidos | Tabla única con etiquetas por celda y presentación vertical a <=800px; selector MRP en tarjetas | Mismos datos, sin duplicar formularios o acciones. Detalles y foco accesibles; entradas 16px en móvil |

## Contratos que debe mantener/verificar el padre con backend

1. **Pendiente detectado: unidad de stock.** `GET /api/reportes/stock` actualmente entrega `material`, `sku`, `total_entradas`, `total_salidas`, `stock_resultante`, pero omite `unidad_medida`. Materiales mezcla rollos/ml/unidades. Añadir `unidad_medida` del material, conservando null si el material fue eliminado. El frontend ya lo acepta en tabla, CSV y HTML/PDF; mientras falte muestra ausencia y advertencia explícitas. No inferir la unidad por nombre/SKU. `material_id` sería útil para identidad, pero no es requisito de esta entrega.
2. `POST /api/calculadora/planchas`: `{producto_id, cantidad}`; respuesta completa `IndividualConsumption`. Campos nulos, medidas incompatibles o rendimientos faltantes se resuelven en backend: UI no los sustituye por 1, 0 o 1.52.
3. `POST /api/reportes/mrp-lote`: `{pedidos_ids: number[]}` de En Cola. Rechazar IDs inexistentes/fuera de cola; agrupación por cliente/código/descripción sin código; cantidades agregadas seguras. La UI envía toda la selección, también los pedidos ocultos por una búsqueda.
4. Cálculo y PDF son consultas sin mutaciones. PDF individual/lote: parámetros devueltos por el cálculo + `revision_calculo` del mismo snapshot (SHA-256 de 64 hex según API). Ante revisión distinta devolver 409; sin revisión válida 400. UI descarta resultado en 400/404/409. No reconstruir payload desde filtros/cantidad editados ni valores redondeados visibles.
5. Conservar precisión y semántica de `rollos_fraccion`, `planchas_restantes_fraccion`, `total_rollos_fraccion`, `rollos_necesarios` por **material**, m, m², paquetes completos/residuo/bultos. Remanentes por consumir no son stock sobrante. Stock desconocido/incompatible mantiene `suficiente_stock: null`; UI muestra advertencias sin derivar una disponibilidad propia.
6. Stock por fechas agrega movimientos del intervalo, manteniendo saldo actual. `hasta` de fecha calendario es inclusivo. Excel permanece inventario completo. Pedidos usa fechas de entrega efectiva; sin fechas incluye todos los estados que coincidan con los filtros.
7. El PDF de pedidos reconsulta los filtros aplicados con datos actuales. No hay revisión de filas del reporte de pedidos en el contrato actual: UI lo informa; no promete snapshot idéntico de filas.
8. Mantener autorización de lecturas auxiliares: catálogo para permiso de Calculadora; pedidos para Reportes; Excel para Reportes. POST de cálculos/PDF no requiere permiso de edición. API debe reforzar 401/403 aun si se elude la UI.
9. Preselección integrada sin shared nuevo: `/calculadora?producto_id=<id>&cantidad=<entero>` (enlace implementado desde MRP). También admite `/calculadora?codigo=<codigo>&cliente=<cliente>&cantidad=<entero>`. Un código ambiguo deja elegir al usuario. No dispara cálculo automático.

## Verificación ejecutada

Desde stage, sin servicios ni DB:

- `node --test tests/reports-audit.test.ts` — **21/21 pasan** en la ejecución final específica.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false` — **exit 0** (sin crear caché incremental).
- `npm test` — **42/42 pasan**, 0 fallos, 0 omitidas, exit 0, tras el último enlace MRP→Calculadora. Incluye las 21 pruebas específicas y el resto de la suite frontend.

Pruebas específicas ejecutan los TSX transpilados en memoria, handlers, `useReportQuery`, `lib/api.ts` y `useTask` reales; reemplazan ciclo de hooks, catálogo/cola, DOM y transporte por fixtures deterministas. No son pruebas de layout ni de un navegador React real. Comprueban URL/payloads/descargas/HTML/estado visible y descarte de respuestas, no presencia de cadenas en el código fuente.

Ciclo test-first observado: primera ejecución 5/11 pasan y 6 fallan por búsqueda por cliente, controles rápidos ausentes, prefill ausente, presentación del stock fraccionario, filtros aplicados sin normalizar y CSV sin unidad. Tras corregir el código, 11/11. Se ampliaron casos a rangos invertidos, cantidades inseguras, Excel sin filtros, impresión escapada/bloqueada, múltiples clientes, respuesta tardía, cambio de catálogo/cola y conflicto PDF. El enlace MRP→Calculadora se probó primero ausente (1/1 falló), luego implementado y validado con permiso.

Detalle reproducible de los 21 casos: títulos de `tests/reports-audit.test.ts`, desde línea 102. Cubren búsqueda, incrementos, prefill, stock trivalente, filtros y respuestas tardías/fallidas, CSV, PDF de pedidos (dos casos), PDF individual, selección MRP, datos faltantes, permisos, HTML de impresión, Excel, rango inválido, cantidad inválida, código compartido, respuesta tras cambio/desmontaje, salida de cola, conflicto PDF, magnitud pequeña y enlace condicionado por permisos.

Hallazgo externo observado durante la ejecución global intermedia: `tests/management-audit.test.ts` — «stock addition stops if permission is revoked while its material editor is unmounted», `1 !== 0`. No se editó ese código. En la siguiente suite global, tras cambios del worker correspondiente, pasó junto con las otras 40 pruebas. El estado final global se registra abajo para distinguir ese fallo transitorio de la entrega de Reportes.

## Validación final del padre

Fuentes frontend estabilizadas y CSS presente. Se notificó al padre que podía repetir Gantt; un guardado inicial incorporó el import antes de crear el CSS y causó un error temporal de recarga, ya resuelto. No hay cambios en Gantt ni selectores CSS globales sin el alcance `.consumption-view`.

El padre realizará compilación completa, navegador real, temas y tamaños 390/desktop, ventanas de PDF/impresión y revisión de descargas. No se ejecutaron esos controles en este worker para respetar el puerto y navegador del padre. Etiquetas conservadas para sus recorridos: «Calculadora MRP», «Producto», «Cantidad de etiquetas», «Planchas totales», «MRP por lote», checkbox «Seleccionar pedido <id> de <cliente>» y «Calcular MRP del lote».

## Relacionado

- `docs/2026-10-27-revision-integral-plan.md`
- `docs/planning-informe.md`
- [[SGP_Proprint]]
- [[SGP_Nueva_Interfaz]]
