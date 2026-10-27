# Auditoría funcional de gestión — 2026-10-27

Trabajo limitado a `/private/tmp/sgp-completo-20261027`. Se compararon el código Angular original, sus plantillas y `sgp-frontend/src/app/services/api.service.ts`, los contratos Flask originales y preparados y las notas del Baúl `inventario`, `operaciones`, `base-datos` y `roles-permisos`. El original y el Baúl se consultaron únicamente en lectura. No se iniciaron servicios ni se ejecutaron importaciones, compilaciones o pruebas en el original. No hubo cambios en cuentas, bases, adjuntos reales, proyecto de entrega, Git, dependencias ni archivos compartidos.

Comprobación SHA-256 contra `docs/original-manifest-before.json`: **201 archivos originales comprobados; 0 modificados o ausentes**.

## Archivos de esta entrega

- `components/management/catalog.tsx`, `clients.tsx`, `users.tsx`, `settings.tsx`, `settings.css`.
- `components/management/inventory.tsx`, `operations.tsx`, `bodega.css`.
- `tests/management-audit.test.ts` y este informe.

Se conserva la interfaz Geist existente, Clientes dentro de Configuración, `confirmAction`, controles por permisos y revisión optimista de materiales. No se modifica `lib`, tipos comunes, backend, componentes compartidos, estilos globales ni pruebas de navegador existentes.

## Diferencias corregidas

1. El catálogo vuelve a ofrecer el directorio de clientes mediante autocompletado nativo, conservando cliente esporádico como texto libre. Si falla el directorio se muestra el error sin impedir introducir texto.
2. Borrar un rendimiento o medida opcional vuelve a guardarlo como cero, igual que el original. El tiempo base conserva su validación positiva. La ficha de material acepta el límite original de ancho cero y sigue rechazando valores negativos o no finitos.
3. Un escaneo rápido rechazado limpia su código y prepara la devolución del foco. Volver al código manual siempre vacía la cantidad, evitando reutilizar accidentalmente la cantidad anterior.
4. Usuarios recupera borradores, guardar por lote, selección de filas/visibles y eliminación por lote. Se conservan cuenta, permisos y contraseña pendiente de las filas que fallan; solo se retiran los éxitos. La propia cuenta queda excluida de las selecciones destructivas y el manejador vuelve a comprobarlo.
5. Las escrituras vuelven a comprobar permisos actuales después de una confirmación y entre filas o fases de una subida. La suma de stock también consulta el permiso del padre si el editor desapareció durante la confirmación.
6. Inventario recupera el indicador de movimientos de siete días, dejando explícito que se calcula entre los últimos 50 registros. La ficha técnica vuelve a mostrar el stock crítico.
7. Configuración e Inventario admiten arrastrar el Excel además de elegirlo. Preparar o cancelar el archivo no inicia su importación; la confirmación mantiene la explicación de suma de stock.

## Matriz de evidencia original → cobertura nueva

Rutas originales relativas a `/Users/erickvzh/Desktop/SGP/sgp_docs_completo`; destinos relativos a la copia preparada. `I`, `O` y `C` designan `sgp-frontend/src/app/pages/inventario/inventario.ts`, `operaciones/operaciones.ts` y `configuracion/configuracion.ts`, respectivamente. Las plantillas `.html` de las tres pantallas se contrastaron con sus manejadores. «Prueba» significa ejecución de manejadores TSX, sin navegador; «contraste» significa lectura de implementación y contrato, pendiente del recorrido integrado del padre.

| Función / campos implementados originalmente | Evidencia original | Cobertura nueva y resultado |
| --- | --- | --- |
| Consulta de inventario, recarga periódica y manual | `I:cargar`, constructor; `GET /api/materiales` | `Inventory`, `useResource`, botón Actualizar. Se conserva consulta periódica y se añade estado de error explícito. Contraste. |
| Buscar SKU/nombre, categoría, paginación de 15 filas | `I:filtrados`, `paginados`, `cambiarCategoria`, `buscar` | `inventory.tsx`: mismos filtros/paginación; además tipo/estado y limpiar filtros. Contraste. |
| Contar críticos/agotados y mostrar estado | `I:criticos`, `estadoClases`, plantilla | Métrica y `Status` conservados; umbrales y estado siguen siendo del servidor. Contraste. |
| Movimientos de siete días y valor estimado sin precio | `I:121`, plantilla de KPI | Se recupera contador de siete días, con alcance parcial de 50. Valor estimado original era un guion sin datos; no se inventa valoración. Prueba del contador. |
| Alta y edición: SKU, descripción, proveedor, cantidad, mínimo | `I:FORM_VACIO`, `formValido`, `guardar`; POST/PUT materiales | `MaterialEditor`: todos los campos, enteros seguros, alta ≥1, edición/mínimo ≥0; SKU guardado de solo lectura. Prueba del payload y revisión. |
| Categorías Materia Prima/Tintas/Herramientas; tipo Sustrato/Cinta o Tinta fija | `I:categorias`, `alCambiarCategoria`, `unidadActual` | Formulario condicional conservado. Categoría deriva unidad/clasificación en Flask; no se envían valores inventados. Contraste. |
| Materia Prima: metros por rollo, ancho solo Sustrato, acabado; color para todas | `I:guardar`, `anchoRequerido`, plantilla | Todos conservados; campos no aplicables nulos/0. Se restaura ancho ≥0. Prueba del límite cero. |
| SKU existente suma stock conservando ficha | `I:guardar`; `app/routes/main.py:crear_material` | Detección y confirmación explícitas; POST aditivo conservado. Prueba de no envío tras revocar permiso durante confirmación. |
| Enter del escáner avanza campos del inventario sin guardar | `I:focoSiguiente:265`, plantilla `keydown.enter` | Manejador del formulario conservado, salta campos no editables; solo guardar explícitamente envía. Contraste; foco real para padre. |
| Eliminar material con confirmación y restricciones de vínculos/movimientos | `I:pedirEliminar`, `confirmarEliminar`; DELETE materiales | `Inventory.remove`, confirmación propia, errores reales. Se comprueba permiso tras confirmar. Contraste. |
| Ficha: clasificación, tipo, largo, ancho, proveedor, stock crítico, color/acabado | Plantilla inventario, detalle escritorio/móvil | `inventory.tsx:Ver ficha` contiene todos; añade capacidad/gramaje ya devueltos por el servidor y enlace al historial parcial del SKU. Contraste. |
| Evitar sobrescritura concurrente de material, mejora ya existente en nueva interfaz | Contrato preparado `_comprobar_revision`, PUT materiales | Se conserva revisión leída, respuesta 409, carga explícita de stock/revisión actuales y reintento manual. Prueba: primera revisión 7, segunda 8 con stock 9. |
| Operaciones Entrada por defecto y Salida seleccionable | `O:tipo`, `setTipo` | Botones con estado y retorno al campo rápido; se mantiene el tipo al guardar. Contraste. |
| Escaneo rápido Enter registra exactamente 1 movimiento de 1 | `O:registrarRapido`, `enviarMovimiento` | Formulario rápido conserva payload `{ codigo_barras, tipo_movimiento, cantidad: 1 }`, bloqueo por referencia y campo de solo lectura durante petición. Prueba de rechazo y siguiente código limpio. |
| Flujo manual: Enter del código pasa a cantidad, código vacío y cantidad inválida bloquean | `O:irACantidad`, `registrarManual`, validadores | Se conservan validaciones y avance de foco; volver al código siempre exige cantidad nueva. Prueba de cantidad vacía después de reenfocar. |
| Éxito limpia ambos códigos, cantidad vuelve a 1 y foco rápido; error manual conserva entradas | `O:enviarMovimiento:131` | `Operations.register` conserva éxito y error manual; recupera limpieza/foco tras error rápido. Foco real para padre. |
| Historial permanente de últimos 50: fecha Ecuador, SKU, material, tipo, cantidad, usuario, observación | `O:cargarMovimientos`, plantilla; `GET movimientos` | `MovementHistory`: todos visibles, unidades resueltas por materiales, sin eliminación. Fechas mediante conversor Ecuador ya compartido. Contraste. |
| Configuración con Producción/Clientes/Usuarios y búsqueda | `C:cambiarTab`, filtrados; plantilla | `Settings`: Productos/Clientes/Usuarios/Datos. Clientes sigue dentro de Configuración; las pestañas inactivas conservan borradores. Contraste. |
| Catálogo: código, cliente, descripción; código vacío usa `-`, código repetible entre clientes | `C:guardarFila`; `_validar_producto:1691` original | `Catalog.payload`, código existente bloqueado y duplicados validados por servidor. Cliente libre preservado. Prueba del cliente libre. |
| Autocompletado contra clientes, sin exigir coincidencia | `C:sugerenciasClienteFila:392`, plantilla catálogo | `Catalog`: `GET clientes`, datalist por nombre con código, error recuperable y texto libre. Prueba de sugerencia y payload. |
| Cuatro rendimientos enteros: etiquetas/plancha, planchas, rollos, etiquetas/rollo | `C:camposEnteros:47`, `guardarFila` | Los cuatro se envían y validan; campo borrado vuelve a cero. Prueba del rendimiento borrado. |
| Tres medidas decimales: largo plancha, largo rollo, ancho rollo | `C:camposDecimales`, `_validar_producto` | Conservadas y no negativas. Se conservan unidades del cálculo implementado: largo plancha cm, largo/ancho rollo m. Contraste. |
| Material vinculado del inventario y tipo normal/especial | `C:guardarFila`, selectores de plantilla | Selectores preservados, opción histórica si lectura auxiliar falta. FK y tipo se envían en payload. Contraste. |
| Tiempo base y máquina requerida M1/M2/Mesp | `C:guardarFila`, `_validar_producto` | Campos editables en interfaz nueva; tiempo >0 y regla Mesp para especial/90006718 conservados en servidor. Contraste. |
| Alta, editar fila bloqueada, guardar individual, cancelar, eliminación confirmada | `C:editarFila`, `guardarFila`, `confirmarEliminar` | Editores modales de catálogo/clientes/usuarios. Cancelar no realiza solicitud. Confirmaciones propias preservadas. Contraste y pruebas de guardado/borradores. |
| Fila nueva completamente vacía desaparece al salir | `C:alSalirFila:356` | Equivalente modal: cancelar/cerrar descarta alta local; no se crea una fila remota vacía. Borradores se preparan explícitamente y validados. Contraste. |
| Guardar todos, seleccionar fila/visibles, eliminar selección en las tres tablas | `C:guardarTodos:573`, selección y eliminación masiva | Catálogo/clientes conservados; usuarios recuperado. Se puede preparar varios borradores y guardar los seleccionados, o seleccionar todos. Pruebas de no POST al preparar, éxito parcial y fallo de eliminación. |
| Conservar filas fallidas, mostrar error y reintentar sin duplicar altas | `C:guardarTodos`, `guardarFila`, mezcla en `cargar` | Borradores con clave estable, ID confirmado y errores por fila. Solo éxitos se retiran. Pruebas de lote y referencia fallida. |
| Referencias JPG/JPEG/PNG/PDF: ver, subir, reemplazar, eliminar | `C:abrirRefImagen`, `alSeleccionarImagen`, `eliminarImagen`; API imagen POST/DELETE | `Catalog`: vista local, apertura guardada, subir/reemplazar al guardar y eliminar confirmado. Prueba de fallo de upload → PUT al ID 12, sin repetir POST. |
| Clientes: código, nombre, RUC, direcciones facturación/entrega, contacto, horarios y plazos | `C:camposCliente`, `guardarFila`; `_validar_cliente` | Todos los campos y CRUD conservados en `Clients`; búsqueda incluye esos metadatos. Contraste. |
| Logo de cliente: elección, vista previa, subida posterior al alta y reemplazo | `C:alSeleccionarLogo`, `subirLogoTrasGuardar:523`; POST logo | Validación PNG/firma/tamaño/dimensiones ya existente se conserva; se revalida permiso antes del segundo envío. No hay DELETE logo original ni nuevo. Contraste. |
| Usuarios: nombre, cuatro roles, contraseña inicial y cambio opcional | `C:USUARIO_VACIO`, `guardarFila`, plantilla; rutas usuarios | `Users`: mismos datos y protección del rol propio; borradores y lotes restaurados. Prueba de conservación de contraseña únicamente en la fila fallida. |
| Usuarios: siete permisos ninguno/ver/editar y restaurar valores de rol | `C:abrirPermisos`, `guardarPermisos:262`; PUT permisos | Editor cancelable conserva matriz; admin/jefe acceso completo; cambiar rol restablece configuración. Guardado atómico cuenta/permisos ya soportado por backend preparado. Contraste. |
| No borrar propia cuenta, no cambiar propio rol | Rutas originales editar/eliminar usuario | Selectores/botones bloqueados y comprobación en payload/eliminación. Prueba de selección masiva excluyendo cuenta 99. |
| Excel desde Configuración: seleccionar o arrastrar, importar, contadores | `C:alSeleccionar`, `alSoltar:798`, `importar`; API multipart `archivo` | Datos dentro de Configuración e Inventario conservan selección y drag/drop, suma aditiva confirmada y resultados reales. Prueba sin upload al preparar/cancelar y un upload tras confirmar. |
| Exportación Excel de inventario | `ApiService:exportarExcel`, GET exportar/excel | Descarga conservada en Inventario y Datos. Permisos de lectura según inventario/reportes/configuración. Contraste; archivo real para padre. |
| Scroll horizontal superior/inferior independiente por tabla y versión móvil | Plantilla Configuración y métodos sincronizarScroll | `ScrollTable` existente se conserva, CSS local adaptable; columnas completas siguen accesibles por desplazamiento. Contraste; layout/foco para padre. |
| Ver/editar por módulo y usuarios solo gestores | Sesión original y política endpoint; Baúl histórico | Gating conservado; comprobación actualizada entre confirmación, filas y subida. Pruebas de revocación en catálogo/clientes/material. |
| AQL, Compras y Zebra | No aparecen como acciones implementadas en las pantallas/servicios/rutas revisadas | Permanecen como información pendiente en Datos; no se inventan integraciones. Contraste. |

## Contratos y límites para el padre

- No se encontró un endpoint faltante que bloquee estas correcciones. El backend preparado ya admite `permisos` dentro de POST/PUT usuarios de forma atómica; se mantiene ese contrato y no se vuelve al doble envío del original.
- `GET movimientos` devuelve los últimos 50 globales, sin paginación/total de siete días ni unidad en cada fila. La UI informa el límite del contador y del historial por SKU y resuelve unidades desde `materiales`. Un total exacto de siete días o unidad histórica independiente de cambios posteriores de categoría necesita ampliar contrato; no se cambia backend desde este trabajo.
- No existe `DELETE clientes/:id/logo` en original ni preparado. Reemplazo PNG sí existe; no se introduce eliminación ficticia.
- La exportación Excel original/preparada no incluye `acabado` ni `cantidad_ml`; importación/exportación no son una copia completa de todos los metadatos. Se conserva el contrato actual. Si se exige respaldo íntegro de ficha, corresponde al padre ampliar ambos extremos.
- Baúl conserva datos históricos desactualizados: menciona tintas en ml, ausencia de UI de usuarios y todo el catálogo en mayúsculas. El código actual implementado usa tintas en unidades, tiene usuarios/permisos y normaliza el código; los demás textos no se fuerzan a mayúsculas. Se sigue código/contrato verificables.
- Subidas y datos base siguen siendo pasos separados para catálogo/clientes. Un fallo de archivo no deshace la ficha ya guardada; ID, archivo y error permanecen para reintentar. Borradores y contraseñas pendientes están solo en memoria de la pantalla, sin persistencia local.

## Verificación ejecutada

`node --test tests/management-audit.test.ts`: **14/14 aprobadas, 0 fallos**. Se observaron fallos previos a las correcciones de autocompletado, ancho cero, escaneo rápido, cantidad manual, lotes de usuarios, contador de movimientos, drag/drop y permisos durante confirmaciones. Las pruebas existentes de revisión/recuperación se ejecutaron para comprobar su conservación.

`node node_modules/typescript/bin/tsc --noEmit --incremental false`: **salida 0, sin diagnósticos**, comprobación del proyecto preparado sin archivos emitidos.

Primera ejecución completa de `npm test`: **31 pruebas, 27 aprobadas y 4 fallidas**, todas en el archivo de otro trabajador `tests/reports-audit.test.ts`: `quick quantity controls add 500/1000/5000 and reject overflow`, `URL prefill selects an explicit id and quantity without calculating or choosing an ambiguous code`, `successful report filters are normalized and late/failed queries cannot replace their snapshot`, `stock CSV escapes formulas, quotes and newlines, includes units and queried dates`. No se modificaron esos archivos ni sus módulos.

Última ejecución completa de `npm test`, tras los cambios concurrentes del otro trabajador: **42/42 aprobadas, 0 fallos**, incluidas las 14 de gestión y los cuatro casos anteriores. A continuación volvió a ejecutarse TypeScript con `--noEmit --incremental false`: **salida 0, sin diagnósticos**.

Las pruebas de gestión ejecutan el TSX real y sus manejadores con un host mínimo de hooks; sustituyen lecturas, HTTP y confirmación por entradas controladas. Verifican payloads, ausencia de envíos, estado de borradores y decisiones de permiso, sin tocar red ni cuentas. No verifican DOM, validación nativa de formularios, foco real, renderizado visual o interacción física de escáner.

El padre conserva la compilación de producción, navegador, escritorio/móvil/temas, integración de permisos y sesiones reales descartables, descargas y subidas reales sobre almacenamiento de pruebas. No se afirma que esos recorridos se hayan ejecutado desde este trabajo.
