# Informe de pedidos, monitor, producción y pre-acabados

Fecha: 2026-10-24. Trabajo realizado exclusivamente en `/private/tmp/sgp-nueva-hVmGDG`.

## Entrega e integración

Exports nombrados listos para Workspace:

| Archivo en `components/orders/` | Export y contrato |
| --- | --- |
| `monitor.tsx` | `Monitor` |
| `order-list.tsx` | `OrderList` |
| `production.tsx` | `Production` |
| `preacabados.tsx` | `Preacabados` |
| `order-editor.tsx` | `OrderEditor({ order?: Order, onClose, onSaved })` |
| `order-detail.tsx` | `OrderDetail({ id: number, onClose, onChanged?, production? })` |

Soporte interno: `order-board.tsx`, `shortages.tsx`, `orders.css`. Los componentes importan el CSS propio y reutilizan las clases originales y los componentes comunes. No se modificaron los contratos compartidos, la configuración raíz ni archivos de otros módulos. No se usó Git, instalaciones ni subagentes. No se ejecutaron servicios, imports, pruebas o builds en el proyecto original.

## Flujos implementados y evidencia de código

| Brecha cubierta | Evidencia |
| --- | --- |
| Monitor real y métricas globales | `Monitor` consulta `GET pedidos/monitor-tv`; usa directamente `activos`, `en_riesgo`, `para_hoy` y `completados_hoy`. La búsqueda por cliente filtra tarjetas sin alterar los indicadores. |
| Tres columnas operativas | `OrderBoard`: En Cola, Procesando y Por entregar (`Terminado` + `Facturado`), ordenadas por fecha prometida. Retiro en Fábrica tiene vista separada en monitor y sección propia en producción. |
| Urgencia y pantalla de planta | `OrderCard` muestra fecha, semáforo, countdown, unidades y progreso; reloj cada 15 segundos. `Monitor` usa la API nativa de pantalla completa y captura sus errores. |
| Summaries sin ítems | Las tarjetas del monitor no acceden a `items`; abrir una tarjeta pasa el ID a `OrderDetail`, que consulta `GET pedidos/:id`. |
| Listado y archivo | `OrderList` consulta `GET pedidos`; vistas Activos/Todos/Archivo, búsqueda por ID/cliente/OC y filtro por estado. Detalle, edición con consulta fresca por ID, PDF y borrado confirmado. |
| Creación y edición completas | `OrderEditor`: cliente de texto con autocompletado, creación rápida mediante el endpoint del pedido, catálogo filtrado por cliente, códigos manuales/S/C, OC opcional normalizada a S/N y fecha/hora de Ecuador. |
| Cambio de cliente | `changeClient` limpia códigos y reinicia texto/cantidad del escáner al cambiar la identidad normalizada del cliente. Conserva descripciones, cantidades, IDs, claves y mínimos por entregas. El catálogo se vuelve a filtrar por el cliente actual; no se conserva una selección de producto anterior. |
| Identidad de códigos sin código | El código `-` escrito, escaneado, importado o elegido del catálogo se conserva en el borrador y el payload. El selector muestra S/C como etiqueta para esos productos, con su descripción exacta; las filas sin código no se fusionan por código al escanear. Solo el código vacío se normaliza a S/C al guardar. |
| Captura manual y escaneo | Entre 1 y 50 filas; selección del catálogo, descripciones manuales, cantidades enteras positivas, filas por lote y captura por Enter. Reescanear un código suma su cantidad. |
| Identidad de ítems | El editor conserva `id` en PUT y usa claves estables por fila; no permite cantidades menores a las entregas previamente registradas. Quitar un ítem persistido requiere confirmación. |
| Edición concurrente | `OrderEditor` captura `order.revision` al abrir y envía `revision` únicamente en PUT. Un 409 muestra el error y un aviso, conserva el borrador y bloquea revisión/guardado; el sondeo del padre no cambia la revisión del borrador. No se usa `revision_actual` del error para reenviar ítems antiguos. |
| Recuperación explícita de versión | Botón «Recargar pedido y descartar este borrador»: confirma el descarte y hace GET por ID. Solo ante éxito y revisión válida reemplaza cliente, OC, fecha, todos los ítems/IDs/mínimos, revisión y estado de referencia; limpia escáner/revisión previa y permite revisar de nuevo sin cerrar. Si falla GET, conserva el borrador y ofrece reintento. Si la versión vigente está Entregado y el usuario no es jefe, bloquea la edición. |
| Revisión antes de guardar | Pantalla de resumen de cliente/OC/fecha, filas y total de unidades. Los fallos de guardado conservan el borrador y permiten reintentar o volver a editar. |
| Lectura documental revisable | Solo creación (`!order` tanto en la interfaz como en la guarda de `readDocument`): `POST pedidos/leer-documento`, multipart `archivo`. Completa campos detectados y agrega/actualiza filas coincidentes. Si cambia cliente, primero descarta códigos anteriores; las coincidencias por descripción reciben el código y cantidad detectados. Advierte sobre campos detectados, hora ausente, falta de ítems y límite de filas. Checkbox de revisión manual obligatorio antes de guardar una importación. |
| Detalle y documentos | Cabecera, ítems, cantidades, estado, avance y fechas; PDF descargable y apertura para impresión desde el visor; consulta y sustitución de factura con errores visibles. |
| Transiciones reales | `PUT pedidos/:id/estado` con `{ estado }`; se confirma cada transición. Terminar explica que los pendientes pasarán a listos y que los parciales pueden estar incompletos. |
| Facturación recuperable | `InvoiceForm`: autorización explícita sin documento o `POST pedidos/:id/factura` seguido de `PUT .../estado` a Facturado. Si se guarda el adjunto y falla el estado, conserva la URL guardada y reintenta solo la transición. El adjunto también permanece disponible al reabrir el detalle. |
| Retiro y entrega | Facturado permite Retiro en Fábrica o Entregado; Retiro permite Entregado. Confirmación de entrega con explicación del efecto de stock, delegado al backend. |
| Retrocesos | `PUT pedidos/:id/retroceder` con `{ observacion }`, formulario Modal y mínimo 10 caracteres sin contar espacios extremos. |
| Estados por ítem | `PUT pedidos/:id/items/:itemId/estado`, incluyendo pendiente/listo/suspendido/entregado_parcial. Suspender exige observación; el estado Entrega parcial requiere pasar primero a pendiente antes de listo, como exige el backend. |
| Entregas parciales | `PATCH .../modo-parcial` con `{ activo }`; `POST .../entregas` con `{ cantidad_entregada, observacion }`; historial y `DELETE .../entregas/:id`, ambos confirmados. Se validan cantidad entera positiva y saldo; sin nuevas salidas mientras el ítem esté suspendido o el pedido entregado. |
| Faltantes por ítem | `POST .../faltantes` con cantidad, unidad etiquetas/planchas, motivo obligatorio y departamento. Resolución con confirmación de reposición por Impresión mediante `PUT pedidos/faltantes/:id/resolver`; eliminación confirmada mediante DELETE. |
| Pre-acabados completo | Obtiene todos los faltantes de los ítems de `GET pedidos`, incluso de pedidos archivados; filtros Pendientes/Resueltos/Todos y búsqueda; enlace al detalle y acciones según permiso. |
| Corrección de faltantes | Como no existe PUT/PATCH de faltantes, el formulario explica la corrección mediante creación del reemplazo y eliminación del anterior. Conserva el ID del reemplazo para reintentar únicamente la eliminación si falla ese segundo paso. |
| AQL explícitamente futuro | Panel sin acción ficticia: pendiente acordar matriz de muestreo y criterios de aceptación de planta, conforme al diseño aprobado. |
| Cargas, errores y vacíos | `DataState` con recarga, `Feedback` para mutaciones/descargas y vacíos específicos. Bloqueo de doble envío mediante `useTask`; controles independientes por ítem y reporte. |
| Borradores durante sondeo | Formularios con estado local inicializado una sola vez y claves estables por ID. La actualización de pedidos no vuelve a inicializar notas, cantidades, filas ni archivos seleccionados. |

## Permisos

- Cabecera, creación, edición y borrado: `pedidos/editar`. Editar un pedido Entregado solo se muestra a `jefe`, además del permiso de edición.
- Estados, retrocesos, ítems, parciales y faltantes: `pedidos/editar` **o** `produccion/editar`.
- Factura y autorización como Facturado: `pedidos/editar`.
- Monitor/listado requieren lectura de Pedidos; producción requiere lectura de Producción; pre-acabados admite Pedidos o Producción. El detalle admite además lectura de Reportes, coincidiendo con el backend.
- Clientes y catálogo se consultan únicamente dentro de un editor autorizado abierto, sin sondeo de catálogos ni solicitudes auxiliares en las vistas de solo lectura.
- Las respuestas 401/403 siguen el cliente API y la sesión compartidos. El backend conserva la autoridad final sobre permisos y validaciones.

## Comprobación realizada

Comando en la copia de trabajo: `npm run typecheck -- --incremental false`.

Resultado: salida 0, sin diagnósticos TypeScript globales. No se generó caché incremental. Se contrastaron manualmente métodos, rutas y payloads con `backend/app/routes/main.py` y la política `backend/app/permisos.py`.

Revisión posterior de OrderEditor: se repitió el mismo typecheck tras corregir cambio de cliente, lector exclusivo de creación y preservación del código `-`; nuevamente salida 0. La revisión también detectó y corrigió la ruta de cambio de cliente por OCR, que podía conservar códigos del cliente anterior. Se confirmó en `_catalogo_item` que la descripción exacta participa en la identidad de los productos sin código, y en `_validar_items_pedido` que un `-` explícito se conserva.

Regresión de navegador diagnosticada por main: los campos tienen ahora nombres accesibles explícitos y únicos (`Código para escanear`, `Código del ítem 1`, etc.), independientes del texto del datalist. `validate` bloquea la revisión mientras `scan.trim()` tenga contenido y muestra exactamente: «Agrega el escaneo pendiente o limpia el código antes de revisar.». Se conserva el escaneo para agregarlo o limpiarlo; no se pasa al resumen ni se guarda silenciosamente sin él. Typecheck global repetido tras este ajuste: salida 0, sin diagnósticos. La nueva comprobación en navegador y sus tests quedan a cargo de main; no se modificaron tests compartidos.

Revisión de concurrencia: typecheck global repetido después de integrar `Order.revision`, detección de 409 y recarga explícita del borrador: salida 0, sin diagnósticos. Cambios limitados al editor y este informe; sin modificaciones al backend, contratos compartidos ni tests. La validación real del 409 y de la recuperación en navegador queda coordinada por main tras reiniciar la API.

No se ejecutaron builds, servicios, pruebas automatizadas ni navegación en esta tarea. La integración de Workspace y la validación en navegador corresponden al coordinador principal.

## Límites reales y comprobaciones de integración pendientes

- OCR depende de Tesseract. El endpoint lee la primera página del PDF o el texto de una imagen; no conserva ese documento como adjunto. Ante fallos, el editor conserva la captura manual. La factura es el adjunto persistente que expone el contrato actual del pedido.
- Corregir un faltante no es una transacción única porque el backend no ofrece actualización. Si se abandona el formulario después de crear el reemplazo y antes de eliminar el anterior, ambos quedan visibles y se puede eliminar el anterior desde su acción. Una respuesta perdida de creación no dispone de clave de idempotencia en el backend.
- Las reglas de descuento de stock y completado se delegan al backend; el frontend no recalcula ni escribe stock.
- Confirmar en navegador el ciclo completo En Cola → Procesando → Terminado → Facturado → Entregado y la variante de retiro, con permisos solo lectura y de edición separados.
- Interrumpir el segundo paso de facturación, reintentar sin subir nuevamente el archivo y comprobar la factura al reabrir.
- Mantener borradores de cabecera, notas de suspensión y cantidades durante varios sondeos; validar historial y borrado de una entrega parcial.
- Revisar archivos OCR sin fecha/hora y sin ítems; comprobar filas 1/50, códigos manuales y catálogos de clientes distintos.
- Confirmar en navegador que cambiar cliente con filas y escáner en curso conserva descripciones/cantidades y limpia códigos/escáner; que editar no muestra lector; y que dos productos `-` del mismo cliente conservan sus descripciones distintas al seleccionar y guardar.
- Abrir dos editores, agregar un ítem o entrega desde otro usuario y confirmar que el PUT del borrador antiguo recibe 409 sin perder sus campos. Cancelar la confirmación de recarga debe conservarlos; aceptar debe recuperar todos los ítems y revisión actuales y exigir una nueva revisión. Comprobar también fallo de GET y cambio concurrente a Entregado con usuario no jefe.
- Revisar pantalla completa, móvil, tema oscuro, descarga/impresión y revocación de permisos con la navegación integrada.
