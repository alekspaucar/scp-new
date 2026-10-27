# Informe de inventario y operaciones

Fecha: 2026-10-24.
Montaje de trabajo: `/private/tmp/sgp-nueva-hVmGDG`.
Referencia: diseño aprobado `docs/2026-10-24-sgp-nueva-interfaz-diseno.md`, sección Inventario y operaciones; plan `docs/2026-10-24-plan-implementacion.md`, restricciones globales y tarea 4.

## Archivos entregados

- `components/management/inventory.tsx`: exportación nombrada `Inventory`; editor y consulta de movimientos por material.
- `components/management/operations.tsx`: exportación nombrada `Operations`; tabla `MovementHistory` reutilizada por Inventario.
- `components/management/bodega.css`: estilos limitados a bodega, tablas, filtros, avisos y formularios adaptables; conserva las clases y paleta iniciales.
- Este informe.

No se modificaron contratos compartidos, configuración raíz ni otros módulos de gestión. No se instalaron dependencias, se ejecutó Git ni se utilizaron subagentes. El proyecto original solo se consultó como texto; no se ejecutaron allí importaciones, servicios, pruebas o compilaciones.

## Cobertura y evidencia de código

| Requisito | Implementación / evidencia |
| --- | --- |
| Inventario real | `Inventory` consume `GET materiales` mediante `useResource`, condicionado a `can('inventario')`. |
| Búsqueda y filtros | Búsqueda por SKU, nombre/descripción, categoría, tipo y estado; selectores independientes de categoría, tipo y estado; limpieza de filtros. |
| Paginación | `PAGE_SIZE = 15`, reinicio al cambiar filtros y ajuste de página cuando disminuye el número de resultados. |
| Indicadores verificables | Referencias; materiales Crítico/Agotado según la API; stock en rollos de Materia Prima; stock en unidades de Tintas/Herramientas. Sin valoración monetaria ni suma entre unidades distintas. Mientras no hay respuesta se muestra «—». |
| Alta y edición | `MaterialEditor`, formulario en `Modal`, `POST materiales` y `PUT materiales/:id`. Guarda SKU (solo alta), nombre, categoría, tipo, proveedor, stock actual, mínimo, metros/rollo, ancho, acabado y color. |
| SKU inmutable | Campo `readOnly` al editar y exclusión del SKU del payload de `PUT`. |
| Alta de SKU existente | Aviso permanente sobre suma de stock; detección del SKU en la lista; confirmación adicional con código, cantidad y unidad. El mensaje final procede de la respuesta del servidor, también si el SKU apareció entre consultas. |
| Validaciones | Enteros seguros: stock nuevo ≥ 1, stock editado ≥ 0, mínimo ≥ 0. SKU/nombre/proveedor obligatorios. Metros opcionales no negativos y ancho estrictamente positivo para Materia Prima/Sustrato. |
| Campos por categoría | Materia Prima ofrece Sustrato/Cinta, metros, acabado y ancho para Sustrato; Tintas fija Tinta; Herramientas fija Sustrato como el frontend de referencia. Campos exclusivos se envían como 0/null al dejar de aplicar. |
| Unidad y clasificación | No se envían como fuente de verdad. Listado/historial usan `unidad_medida` del material. El formulario anticipa rollos para Materia Prima y unidades para Tintas/Herramientas. |
| Eliminación | Confirmación y `DELETE materiales/:id`; conserva y muestra el rechazo del backend si hay catálogo o movimientos asociados. |
| Excel | `GET exportar/excel` para consulta; `upload('importar/excel', file)` para edición, utilizando el helper compartido que envía multipart con campo `archivo`. Muestra creados, actualizados y omitidos reales. Advierte y confirma la suma de stock de las importaciones. |
| Historial vinculado | Cada fila abre `MaterialHistory` en Modal, consulta `GET movimientos` y filtra el SKU. No existen acciones de borrado de movimientos. |
| Captura rápida | Formulario independiente: SKU + Enter registra cantidad 1 con `POST movimientos`. |
| Captura manual | SKU, cantidad entera positiva y observación opcional. Enter en SKU lleva a cantidad; Enter en cantidad o botón registra. La lista auxiliar de materiales es accesible con permiso de Operaciones. |
| Payload de movimientos | `codigo_barras`, `tipo_movimiento`, `cantidad`, `observacion`. Nunca utiliza un campo `sku` para registrar. |
| Doble envío / foco | Bloqueo síncrono con referencia y `useTask`; códigos, cantidad y observación en `readOnly` durante la solicitud, botones bloqueados. Éxito limpia ambos códigos/observación, restablece cantidad 1 y foco rápido, y conserva Entrada/Salida. |
| Permisos | Consulta y edición independientes por módulo. Lectores ven historial y estados; no ven editores ni formularios de registro. La exportación es consulta; la importación requiere edición de Inventario. Los handlers de escritura vuelven a comprobar el permiso. |
| Errores y estados | `DataState` para carga/error/reintento, `Empty` para listas vacías/filtros, `Feedback` para errores de servidor/validación y éxito. Un fallo de mutación conserva el formulario y permite corregir/reintentar. Un fallo de recarga posterior no presenta el guardado como fallido. |
| Actualizaciones de fondo | Sondeo compartido de 12 s; el editor conserva su estado local y no se reinicia al recibir materiales. El historial solo se consulta en Inventario mientras está abierto. |

## Contraste con la API disponible

Revisión textual de `backend/app/routes/main.py` y `backend/app/permisos.py`:

- Categorías válidas: Materia Prima, Tintas y Herramientas; tipos válidos: Sustrato, Tinta y Cinta.
- `POST materiales` suma stock a un SKU existente y conserva la ficha. `PUT` establece stock absoluto. Ambos derivan unidad/clasificación en servidor.
- `get_materiales` admite lectura de Operaciones, sin exigir permiso adicional de Inventario.
- `get_movimientos` admite lectura de Inventario y Operaciones; devuelve los últimos 50 registros globales ordenados por fecha/id descendente. `Movement` no aporta unidad: la tabla la busca por SKU en materiales y muestra «Unidad no disponible» cuando no puede resolverla.
- `procesar_movimiento` requiere edición de Operaciones y valida cantidad, existencia y stock suficiente.
- Importar requiere edición de Inventario; exportar admite consulta de Inventario. El helper `upload` compartido añade exclusivamente `archivo`.

## Límites y validación pendiente

El historial por SKU es una vista de los últimos 50 movimientos globales, no un historial completo. Se indica expresamente tanto en la ventana como en su estado vacío. La API actual no ofrece paginación ni consulta completa por SKU; no se modificó el backend.

Se revisaron los componentes por lectura y se contrastaron sus rutas/payloads/permisos con el backend copiado. No se crearon utilidades aisladas ni pruebas que reproduzcan el framework. No se ejecutaron pruebas de integración, navegador, comprobación de tipos ni compilación: main realizará esas comprobaciones con los módulos integrados, según la división de trabajo solicitada. No se afirma que dichas comprobaciones hayan pasado.

Comprobaciones propuestas para esa integración:

1. Consultar más de 15 materiales, filtrar y cambiar de página; probar instalación vacía y errores de consulta con reintento.
2. Crear cada categoría; rechazar fracciones, negativos y ancho cero de Sustrato; editar stock cero y verificar SKU inmutable.
3. Repetir SKU y confirmar suma conservando ficha; eliminar material vinculado y comprobar el error del servidor.
4. Exportar/importar Excel y revisar contadores de filas; comprobar lector de Inventario sin importación/CRUD.
5. Probar Entrada/Salida rápida y manual, doble Enter con respuesta lenta, stock insuficiente y código inexistente; verificar códigos/cantidad/foco/tipo después del éxito.
6. Probar usuario con Operaciones únicamente, sin Inventario; verificar unidades por SKU, observaciones, fechas de Ecuador y límite del historial.
7. Revocar edición con formulario abierto; comprobar retiro de acciones y rechazo del servidor. Revisar móvil, temas y desplazamiento horizontal dentro de Modal.
