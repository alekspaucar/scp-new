# Auditoría de pedidos — 2026-10-27

Estado: **componentes estables y entrega terminada para integración**. Raíz de trabajo: `/private/tmp/sgp-completo-20261027`. Original y notas del Baúl utilizados exclusivamente en lectura. No se modificaron destino, backend, tipos, CSS compartido, archivos de app, Git ni bases; no se iniciaron servicios ni navegadores.

## Coordinación para integración

- **Carrera de estado/revisión: cliente resuelto con contrato compatible aprobado.** Las cuatro mutaciones de `ItemDetail` envían `estado_pedido_esperado: 'Procesando'` y `revision_pedido_esperada`: PUT estado, PATCH modo-parcial, POST entrega y DELETE entrega, este último con cuerpo JSON explícito. La revisión se copia de `order.revision` al iniciar cada acción, **antes de esperar la confirmación**; no se sustituye por una revisión recién recibida para forzar el envío. El backend worker implementa ambas precondiciones opcionales bajo el bloqueo de escritura y devuelve 409 ante cambios. Las llamadas históricas sin los campos mantienen su comportamiento original; no se impone una restricción global incompatible. Faltantes conserva su contrato sin nuevas precondiciones. Cuatro regresiones comprueban cuerpos completos/métodos/rutas y otras cuatro verifican que la revisión 4 se conserva aunque pase a 5 mientras se confirma; la comprobación de servidor/DB corresponde al backend worker.
- **Imágenes para `pedidos:ver`: resuelto y probado.** El detalle consume primero `imagen_url`, `imagen_referencia` y `material_sku` opcionales de cada ítem de GET `pedidos/:id`. `ProductReference` acepta el subconjunto mínimo de datos, sin exigir un Product completo. Un lector de Pedidos ve la imagen y el material del DTO sin consultar catálogo; `servir_imagen_catalogo` ya admite ese permiso, sin ampliar accesos. Una referencia explícitamente nula no se sustituye por otra del catálogo. Para DTO antiguos sin el campo se mantiene la resolución anterior si el usuario tiene acceso al catálogo. El padre modificó los tipos compartidos y el backend worker incorporó el serializador opcional solo al GET de detalle; este worker no editó esos archivos.
- **Último retroceso: resuelto y probado.** El contrato nuevo serializa `observacion_retroceso: string | null`. El detalle normal y el desplegable muestran «Último retroceso» y el texto recibido cuando existe; con null/ausencia no se muestra el bloque. Sigue sin existir una bitácora completa de suspensiones o cambios de estado. No se inventó historial ni nuevos registros.
- **Importación.** El HTML original permite documento solo al crear (`pedidos.html:36`), aunque el método TypeScript tiene una guarda más amplia. Se mantiene solo creación. Un primer caso de prueba interpretó el método como funcionalidad de edición; fue corregido al contrastarlo con el HTML, sin ampliar el flujo.

No se pudieron enviar actualizaciones al chat ancestro mediante `send_message_to_thread`: la herramienta devuelve que no admite envío al ancestro nativo. Este documento y el informe final son el canal de entrega de contratos.

El hallazgo inicial del servidor se conserva como antecedente de la precondición opcional acordada, no como una solicitud de cambiar las reglas históricas. Este worker comprobó en lectura `pedido_a_dict(..., incluir_referencias=False)`, el flag True solo en GET de detalle y el campo de último retroceso. **No ejecutó operaciones contra una base ni declara resultados de la suite backend**. Además del cuerpo enviado al servidor, la protección local tiene una regresión ejecutada: una confirmación de estado de ítem pendiente no envía PUT si el pedido vivo deja Procesando.

**P1 de revisión: resuelto en el cliente.** La entrega tenía una guarda general que seguía siendo verdadera si el pedido permanecía Procesando aunque el ítem cambiara. Ahora, tras confirmar, se comprueban también el modo parcial vigente, que el ítem no esté suspendido y que exista saldo suficiente para la cantidad solicitada. Cuatro casos fallaron antes del cambio por un POST indebido y ahora no envían ninguna petición: suspensión, modo parcial apagado, saldo cero y saldo positivo menor que la salida solicitada. Cambios aún no recibidos por el cliente quedan sujetos a las precondiciones de estado/revisión del servidor. La referencia explícita `imagen_url: null` para ítems sin catálogo ya es respetada por el cliente; el respaldo se limita a DTO antiguos sin ese campo.

**P2 de coincidencia de referencias: resuelto.** `productForItem`, compartido por la captura y el respaldo del detalle, ahora compara la descripción sin código exactamente como `_catalogo_item`: `product.descripcion === item.descripcion.trim()`. Cliente y código siguen sin distinguir mayúsculas. Regresión observada en rojo antes del cambio: el ítem `-` / `etiqueta` elegía incorrectamente el catálogo `-` / `ETIQUETA`. Ahora no coincide; ` ETIQUETA ` sí coincide después de recortar la descripción del ítem. También se comprueban S/C y un código normal con diferencias de mayúsculas. Se actualizó el comentario del comparador. La autoridad del DTO explícitamente nulo permanece comprobada.

## Evidencia y criterio

Abreviaturas de las fuentes originales:

- `P.ts` / `P.html`: `sgp-frontend/src/app/pages/pedidos/pedidos.ts` / `pedidos.html`.
- `M.ts` / `M.html`: `sgp-frontend/src/app/pages/pedidos-monitor/pedidos-monitor.ts` / `pedidos-monitor.html`.
- `R.ts` / `R.html`: `sgp-frontend/src/app/pages/produccion/produccion.ts` / `produccion.html`.
- `API`: `app/routes/main.py` del original.

Se leyeron TypeScript y plantillas HTML completos; las plantillas se contrastaron además sin clases/comentarios para inventariar controles y condiciones. Se consultaron `pedidos.md`, `produccion.md` y `fase2-planificacion-preacabados.md` del Baúl. Las notas del Baúl son históricas: por ejemplo, describen menos estados que los seis presentes en el código. La matriz usa el código ejecutable como autoridad.

`Node` en la matriz significa casos del nuevo `tests/orders-audit.mjs`. El archivo ejecuta los componentes y sus manejadores reales tras transpilar TS/TSX en memoria. Controla únicamente el planificador de hooks y los límites de sesión/API/confirmación; no inicia HTTP, navegador ni DB. No sustituye acciones del componente por expectativas simuladas. `Inspección` significa revisión de código; **no equivale a prueba de navegador o de persistencia**.

## Matriz de funciones

| Función | Evidencia original | Estado nuevo / prueba |
|---|---|---|
| Crear pedido, cliente libre o existente | `P.ts:199`, `:475`; `API:702`, `:757` | Conservado en `OrderEditor`; el servidor sigue creando clientes rápidos. Se restauró el aviso explícito de cliente nuevo. Node: cliente conocido/nuevo. Persistencia: padre. |
| Catálogo por cliente, código manual, S/C y código `-` | `P.ts:117`, `:225`, `:407`; `API:131` | Conservados; vacíos se envían como S/C y `-` mantiene su identidad. Cliente/código se comparan sin distinguir mayúsculas; descripción sin código es exacta, recortando solo la del ítem como el servidor. Node: cliente ajeno, S/C, `-`, ambigüedad y `etiqueta` no coincide con `ETIQUETA`; el comparador común cubre captura y respaldo del detalle. |
| Fecha/hora Ecuador y OC opcional con S/N | `P.ts:475`; `P.html:114` | Conservados. El formulario expresa OC opcional; el original ya enviaba S/N pese al asterisco visual. Inspección del payload; fechas heredadas comprobadas por Node. |
| Entre 1 y 50 filas, revisión antes de guardar | `P.ts:210`, `:437`; `P.html:496` | Conservados. Reducir/quitar datos exige confirmación propia y avisa del historial asociado. Inspección; Node ejecuta revisión y guardado de un borrador real. |
| Edición con identidad por ítem | `P.ts:509`; `API:919` | Conservada y reforzada con revisión optimista del stage. Node verifica IDs `[7,8]` de dos líneas con código repetido, cantidades y revisión 4. |
| Conflicto de revisión | El original no exigía revisión; el stage ya la implementaba | Conservado. 409 mantiene el borrador y bloquea reenvío automático; recargar es una acción explícita. Node verifica revisión enviada y bloqueo tras conflicto. |
| Solo jefe edita Entregado | `P.ts:606`; `API:921` | Conservado en lista, editor y detalle. Las cargas para enlaces de edición vuelven a comprobar autorización. Inspección; verificación de roles persistentes/navegador: padre. |
| Enlaces `?nuevo` / `?editar=id` | `P.ts:124`, `:176` | Restaurados en `OrderList`, una vez por montaje y con carga fresca para editar. Node: abrir nuevo, abrir revisión vigente, cerrar sin reapertura por sondeo. |
| Acceso directo `/pedidos/nuevo` | Brecha de rutas Next identificada por el padre, adicional a los handlers de consulta de `P.ts:124`, `:176` | El padre informó reproducción real de 404 antes de corregir la ruta y añadió `app/pedidos/nuevo/page.tsx`, que redirige a `/pedidos?editar=id` o `/pedidos?nuevo=1`, junto con su prueba en `tests/browser-regressions.mjs`. Corrección/verificación de navegador pertenecen al padre. Los casos Node de este worker solo prueban los handlers de consulta; no prueban la resolución de rutas Next. No se editaron archivos de app ni pruebas de navegador. |
| Escaneo, Enter, cantidad y cancelación | `P.ts:243`, `:270`, `:302`; `P.html:140` | Conservados; restaurado Cancelar escaneo y exigencia de cliente previo. Node: cancelación sin añadir línea y validación de cliente. |
| Escaneos con código repetido | `P.ts:270` añadía líneas sin fusionar | El stage sumaba por código solamente. Corregido: suma solo una coincidencia de catálogo y descripción inequívoca; si hay varias filas candidatas agrega una nueva. Node reproduce y corrige la suma de 100→101 en otra descripción. Se conserva la facilidad de reescaneo del stage. |
| Escaneo pendiente antes de guardar | `P.ts:437` | Conservado. La revisión no puede omitir el código aún pendiente. El nuevo botón de cancelación ofrece una salida explícita. Inspección y regresión de cancelación; E2E existente a cargo del padre. |
| Selección o arrastre de documento | `P.html:36`; `P.ts:329`, `:339` | Solo creación, igual que el HTML original. Arrastrar/restablecer archivo restaurado. Node: arrastrar prepara el archivo sin guardar. |
| Lectura OCR/PDF revisable | `P.ts:355`; `API:881` | Conservados endpoint y revisión manual; no se persiste el documento fuente como adjunto. Se bloquea revisar con archivo aún sin leer y se permite descartarlo. Node prueba la omisión que antes llegaba al resumen. OCR real: padre. |
| Mezcla de datos importados | `P.ts:355` reemplazaba filas; stage ya tenía mezcla conservadora | Se conserva la mezcla del stage, límite de 50, advertencia de hora 00:00 y checkbox. No se amplía la importación a editar. Inspección del algoritmo; extracción real: padre. |
| Activos / archivo Entregado | `P.ts:94`, `:99`; `P.html:290` | Conservado, con vistas Activos/Todos/Entregados y estado. Inspección; flujo de entrega Node comprobado. |
| Progreso en fila de pedido | `P.html:324`, `:426` | Restaurado en `OrderList` además de detalle/tarjetas. Node: fila con progreso 25. |
| Búsqueda y paginación local | No existían en la lista original; fechas de entregados estaban en `API:2362` | Mejoras locales dentro del alcance de auditoría: busca ID/cliente/OC/código/descripción, 25 filas por página, fechas prometidas explícitas. No altera endpoints ni la semántica del reporte por fecha efectiva de entrega. Node: código, 26 filas, última página→filtro, día Ecuador y fecha heredada. |
| Eliminar pedido y reversión de stock | `P.ts:660`; `API:1007`, `:146` | Conservado con confirmación propia. Nuevo control vuelve a comprobar permiso/identidad tras confirmar. Node: revocación durante confirmación impide DELETE. Stock real: padre. |
| Descargar PDF y acceso a impresión | `P.ts:568`, `:582`; `M.ts:406`, `:424`; `API:1584` | Conservados descarga y apertura del PDF en visor. El usuario imprime desde el visor; no se afirma diálogo automático de impresión verificado. HTTP, contenido y ventanas reales: padre. |
| Referencias y materiales del PDF / detalle | `API:1553`, `:1620` | PDF original conservado. El detalle prioriza los campos de referencia por ítem del nuevo DTO y evita consultar catálogo cuando ya están presentes. Node: lector solo `pedidos:ver` ve imagen y material sin petición de catálogo; PDF del DTO gana a coincidencia de catálogo; null explícito no usa una imagen alternativa. Respaldo para DTO antiguo y captura del editor conservados. Pendiente inicial de acceso a imagen para lectores: **resuelto**. |
| Seis estados y flujo de fábrica | `API:1026`; `M.html:234`; `M.ts:513` | Conservado: Cola→Procesando→Terminado→Facturado→Retiro/Entregado. Node: Retiro en Fábrica envía exactamente `{estado:Entregado}` y una confirmación. Persistencia/stock: padre. |
| Factura y autorización sin PDF | `M.ts:439`, `:498` | Conservados en detalle; se guarda adjunto antes de autorizar y se conserva URL si el segundo paso falla. El formulario se cierra si cambia estado/permiso. Node: formulario abierto en Terminado desaparece al pasar a Entregado. Carga binaria y recuperación real: padre. |
| Monitor: indicadores, filtros, retiros y fullscreen | `M.ts:23`, `:67`, `:102`, `:540` | Conservados. Filtro afecta tarjetas y mantiene contadores de toda la planta. Retiros en vista separada; error de fullscreen visible. Inspección; fullscreen/navegador: padre. |
| Monitor: reloj y color persistente | `M.ts:151`, `:188`; `M.html:23` | Restaurados reloj Ecuador HH:mm:ss y color usando la clave original `monitor_color_reloj`, con fallo de storage tolerado. Node: controles reales presentes y solicitud de datos cada 5000 ms. Persistencia entre recargas: padre. La temperatura fija decorativa del original no se trató como sensor implementado. |
| Segundos y semáforos diferenciados | `M.ts:271`, `:290`; `R.ts:297`, `:310` | Restaurado reloj de 1 segundo y countdown con segundos, con vencimiento exacto marcado Retrasado. Monitor: verde >1 día, amarillo >0, rojo vencido; estados listos no se cuentan como urgencia de producción. Producción conserva umbrales 3/1 días. Node: segundos, instante exacto y verde a dos días en monitor. |
| Producción desplegable y solo lectura de listos | `R.html:107`, `:159`, `:295` | Conservados `inline production`, Cola solo Iniciar y listos sin transición operativa desde Producción. Node recorre Cola, Terminado, Facturado, Retiro y Entregado y comprueba ausencia de controles por ítem/entrega. |
| Aviso al cruzar 100% | `R.ts:248`; `R.html:569` | Restaurado como aviso **en línea**, con terminar u omitir y sin abrir modal automático. Node: cruce 50→100 ofrece acción; omitir no reaparece por sondeo de 100. |
| Retroceder con motivo | `R.ts:349`, `:371`; `API:1068` | Conservado mínimo 10 caracteres y confirmación propia; ítems mantienen estado. Formulario ligado al estado vivo. Nuevo campo `observacion_retroceso` se muestra como «Último retroceso». Node: texto visible en detalle normal/desplegable y ausente con null. Pendiente inicial del texto guardado pero no visible: **resuelto**; no se presenta como historial completo. |
| Estados individuales y suspensión | `R.ts:437`, `:558`; `API:1108` | Conservados pendiente/listo/suspendido/entregado_parcial y observación obligatoria de suspensión. No se permite pasar directamente de parcial a listo. Node: un formulario confirmado tarde no envía estado si el pedido ya dejó Procesando; PUT envía Procesando y la revisión capturada antes de confirmar para la carrera entre usuarios. |
| Fecha/observación de suspensión | `R.html:118`, `:122`; `API:357` | Se muestra siempre la última fecha y observación disponibles, aunque no haya entregas/faltantes; si el estado cambió se rotula como última observación de suspensión. Node reproduce la fecha antes inaccesible por historial vacío. No se afirma bitácora completa. |
| Progreso fraccional y suspendidos | `R.ts:421`; `API:298` | Conservada fórmula del servidor y `progressOf` existente. Suite Node común verifica fracción de parciales y exclusión de suspendidos. |
| Parciales: activar/desactivar, cantidades, borrar | `R.ts:581`, `:634`, `:704`; `API:1164`, `:1211`, `:1253` | Conservados cantidades enteras, saldo, bloqueo de nueva salida suspendida y confirmación de borrado. Desactivar preserva historial. Node: historial legible en Terminado sin controles mutables; PATCH/POST/DELETE envían estado esperado y revisión original por JSON. Guarda específica después de confirmar impide POST con suspensión, modo apagado, saldo cero o insuficiente. Mutaciones de DB y 409 del servidor: backend worker/padre. |
| Faltantes: unidad, causa rápida y motivo opcional | `R.ts:710`, `:724`; `R.html:737`, `:753`; `API:1285` | Corregida regresión: unidad inicial planchas, cuatro causas rápidas y motivo opcional como original. Node: envío real del manejador con motivo vacío, unidad planchas y selección Descalibre. |
| Resolver faltantes y revisar resueltos | `R.ts:757`; `API:1338` | Conservado, con confirmación de reposición e historial. Vista Pre-acabados existente agrega búsqueda/estados; no se editaron sus archivos. Inspección; reposición real: padre. |
| Corregir/eliminar faltantes | `API:1365` ofrece DELETE, no PUT de corrección | Conservado flujo preexistente del stage: crear reemplazo y luego borrar anterior, reteniendo ID para reintentar limpieza. Se detiene segundo paso si cambia permiso. No se afirma atomicidad ni idempotencia que la API no provee. |
| Sesión y exclusión mutua | Original controlaba permisos en manejadores; stage tenía bloqueo global | Bloqueo global conservado. Nuevo guard comprueba identidad, autorización, estado e instancia viva tras esperar confirmaciones. Node: segundo trabajo bloqueado, revocación antes de DELETE y cambio de estado antes de PUT. |
| Planificador y autoasignación | `R.ts:776–977`; `R.html:332–564`; `API:2807` | Fuera de archivos asignados a este worker. Se inspeccionó el enlace funcional; la implementación y verificación del padre/worker de Gantt son las evidencias finales. No se tocó. |

## Archivos entregados

- `components/orders/order-action.tsx`
- `components/orders/order-board.tsx`
- `components/orders/order-detail.tsx`
- `components/orders/order-editor.tsx`
- `components/orders/order-list.tsx`
- `components/orders/order-reference.tsx` (nuevo)
- `components/orders/monitor.tsx`
- `components/orders/production.tsx`
- `components/orders/shortages.tsx`
- `components/orders/orders.css`
- `tests/orders-audit.mjs` (nuevo)
- Este documento.

Se conservaron Geist, confirmación propia, sesión compartida, lock global, revisión optimista y los IDs. No se añadieron APIs, tablas, adjuntos, normas AQL, compras ni integración Zebra.

## Verificación exacta

Ejecutada en staging, 2026-10-27:

```text
node --test tests/orders-audit.mjs
```

50 casos del worker: los 33 iniciales, cuatro de referencia/último retroceso, cuatro de cuerpos con precondiciones, cuatro de captura de revisión, cuatro de invalidez sobrevenida de entrega y uno de coincidencia exacta de descripción sin código. Las nuevas regresiones fallaron antes de modificar producción y pasaron después, sin cambiar expectativas. En la revisión P1 también fallaron las cuatro comprobaciones existentes de cuerpos al exigir el nuevo campo acordado; se corrigió la implementación. La última ejecución completa siguiente incluyó los 50 junto con los casos de los demás workers:

```text
node --test tests/*.test.ts tests/orders-audit.mjs
tests 103; pass 103; fail 0; cancelled 0; skipped 0; todo 0
exit 0

node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
exit 0; sin diagnósticos
```

Los cambios funcionales se hicieron después de observar fallos de los casos relevantes (escaneo cruzado, archivo omitido, fecha oculta, formulario obsoleto, causas/unidad, segundos, arrastre, progreso, URLs, revocación y cruce 100%). Las pruebas de preservación ya existentes no se describen como fallos previos. La corrección de criterio del caso de importación al editar está explicada en Coordinación; no se cambió la expectativa para ocultar una regresión.

`npm test` solo incluye `*.test.ts`: **no incluye automáticamente este archivo `.mjs`**. Para el cierre del padre utilizar el comando conjunto anterior o agregar `node --test tests/orders-audit.mjs` a su secuencia.

No se ejecutaron builds, navegador, suites backend ni pruebas sobre bases por este worker. La suite backend 169 y el Gantt/UI mencionados por el padre son resultados del padre, no resultados propios. Tampoco se modificaron `tests/e2e.mjs` ni las regresiones de navegador que el padre está adaptando.

Cierre anterior tras comunicar el padre la corrección de `/pedidos/nuevo`: Node 102/102 y TypeScript sin diagnósticos, con 49 casos de Pedidos. Cierre final después del P2 de descripción sin código: repetidos el comando conjunto Node y TypeScript; **103/103 casos y salida 0 sin diagnósticos**, con **50 casos de Pedidos**. Única modificación funcional de este último cierre: el comparador y su comentario en `components/orders/order-reference.tsx`.

## Pendientes acotados del padre

1. Verificación del backend worker de las precondiciones **opcionales de estado y revisión** en las cuatro rutas, incluido DELETE JSON y 409 bajo bloqueo de escritura. El cliente ya envía ambos campos y conserva la revisión anterior a confirmar, con pruebas; faltantes y API histórica sin campos conservan sus reglas.
2. Ciclo real con base aislada y documentos: factura con fallo de autorización/reintento, PDF con referencia/materiales, OCR, parciales y reversión de stock al editar/eliminar entregados.
3. Navegador: montaje/desmontaje de diálogos, foco, impresión, fullscreen, persistencia del color, escritorio/móvil/tema. Los cambios CSS solo son locales a Pedidos.
4. Integración/compilación/destino/Baúl final conforme al plan general. El pendiente de referencias para `pedidos:ver` y el texto de último retroceso están resueltos en el cliente contra el contrato compartido incorporado por el padre/backend worker.
