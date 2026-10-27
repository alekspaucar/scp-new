# Informe: catálogo, clientes, usuarios y configuración

Fecha: 2026-10-24. Trabajo realizado únicamente en `/private/tmp/sgp-nueva-hVmGDG`.

## Archivos entregados

- `components/management/settings.tsx`: export nombrado `Settings({ initialTab?: string })`.
- `components/management/catalog.tsx`: export nombrado `Catalog`.
- `components/management/clients.tsx`: export nombrado `Clients`.
- `components/management/users.tsx`: export nombrado `Users`.
- `components/management/settings.css`: estilos propios con prefijo `management-`.
- Este informe.

No se editaron contratos compartidos, configuración raíz, dependencias ni archivos del SGP original. No se utilizó Git, subagentes, instalaciones ni servicios. Se siguió el diseño aprobado y la tarea 4 del plan, limitando las decisiones y cambios a estos módulos. La revisión es propia; main realizará la revisión integrada.

## Funciones implementadas y evidencia

| Área | Implementación | Evidencia en código / contrato consultado |
| --- | --- | --- |
| Navegación | Pestañas `catalogue`, `clientes`, `usuarios`, `instalacion`; `initialTab="clientes"` abre clientes directamente. | `Settings`, `normalizedTab`; permisos derivados de `useSession`. |
| Consultas | Solo consulta la pestaña activa; se conservan borradores y selección al cambiar de pestaña. | Prop `active` en hijos y rutas `null` en `useResource` cuando están inactivos. |
| Estados | Carga, errores de lectura con Reintentar, errores de escritura y vacíos; una lectura fallida no se anuncia como una base vacía. | `DataState`, `Feedback`, `Empty`, condiciones sobre `resource.error`. |
| Catálogo | Alta, edición, eliminación confirmada, búsqueda por código/cliente/descripción/material/tipo/máquina. | `GET/POST catalogo`, `PUT/DELETE catalogo/:id`; contratos de `_validar_producto` y `producto_a_dict` en `backend/app/routes/main.py`. |
| Metadatos de producto | Los cuatro rendimientos, tres dimensiones, material existente, tipo normal/especial, tiempo base y máquina M1/M2/Mesp. | Lista `numbers`, selector de `materiales`, `payload` explícito. Largo de plancha en **cm**; largo/ancho de rollo en **m**, conforme al cálculo del servidor. |
| Códigos | Código existente de producto y cliente de solo lectura; catálogo sin código usa `-`; cliente de producto como texto libre; duplicados por distintos clientes los valida el servidor. | `readOnly` condicionado al ID; normalización de código vacío a `-`; no se convierte a `S/C`. |
| Referencias | Elegir y previsualizar imagen, abrir PDF/archivo elegido, subir/reemplazar y eliminar con confirmación al guardar. | `POST/DELETE catalogo/:id/imagen`; el selector guarda un `File`, sin iniciar subidas. |
| Clientes | CRUD real, búsqueda y todos los metadatos: código, nombre, RUC, dos direcciones, contacto, horarios y plazos. | `GET/POST clientes`, `PUT/DELETE clientes/:id`; campos de `_validar_cliente` y `cliente_a_dict`. |
| Logos | Vista previa local, validación PNG por extensión y firma, hasta 200 KiB y 200 × 200 píxeles; reemplazo al guardar. | `chooseLogo`, `createImageBitmap`, `POST clientes/:id/logo`; el servidor confirma formato/tamaño/dimensiones antes de persistir. |
| Recuperación de adjuntos | Primero guarda datos base y conserva inmediatamente el ID devuelto; después envía el adjunto. Si falla esta segunda fase, mantiene ID, formulario, archivo y error para reintentar mediante PUT, sin repetir el POST de creación. | `persist` en catálogo/clientes y `savedBase`; la lista evita duplicar el registro persistido y su borrador mediante `draftIds`. |
| Borradores/lotes | Editores Modal, Cancelar sin solicitudes, Preparar para lote sin solicitudes, selección por fila y de visibles, guardado explícito y eliminación por lote. | `saveOne`, `saveBatch`, `remove` en catálogo/clientes. Operaciones por fila, sin inventar endpoints de lote. |
| Fallos parciales | Continúa las demás filas; retira solo borradores/selecciones exitosos. Conserva las filas fallidas, archivos, ID y errores específicos, con resumen del lote. | Captura individual en cada bucle; `clearDraft` solo para éxitos; errores de guardado y eliminación visibles por separado. |
| Tablas | Tablas semánticas anchas con desplazamiento superior/inferior sincronizado. | Uso de `ScrollTable` compartido en catálogo, clientes y usuarios. |
| Permisos de datos maestros | Lecturas autorizadas por los módulos consumidores; escritura requiere admin/jefe y `configuracion/editar`. | Condiciones `readable`, `editable`, equivalentes a `backend/app/permisos.py` y decoradores de roles. |
| Usuarios | CRUD exclusivo admin/jefe, búsqueda, cuatro roles, contraseña inicial y cambio opcional de contraseña. | `GET/POST usuarios`, `PUT/DELETE usuarios/:id`; payload exacto `{ username, password, rol }`, respuesta `{ usuario }`. |
| Permisos de usuario | Editor de siete módulos con `ninguno`, `ver`, `editar`; borrador cancelable; restablecer valores del rol envía `null`. | `PUT usuarios/:id/permisos`, payload `{ permisos: mapaCompleto }` o `{ permisos: null }`; claves procedentes de `moduleLabels`. |
| Protección de cuenta | Propio rol deshabilitado, eliminación propia deshabilitada y comprobada en manejadores; admin/jefe conservan los siete permisos de edición. | `ownAccount`, validaciones de `save/remove`, `managerRole`; coincide con `/usuarios`. |
| Recuperación de usuarios | Conserva ID si la cuenta se creó y falló la actualización de permisos; permite reintento de la misma cuenta. Al cambiar la propia cuenta, refresca la sesión incluso ante fallo parcial. | `savedBase`, actualización de `editor.id`, `finally { refresh() }` para la propia cuenta. |
| Instalación | Consulta real de salud y configuración inicial, una sola base relacional; actualización manual y estados de error. | `GET health` → `{ status, proyecto }`, `GET instalacion` → `{ requiere_configuracion }`; definidos en `backend/app/routes/auth.py`. |
| Excel | Importación solo con `inventario/editar`; confirmación explica suma de stock; muestra creados, actualizados y omitidos del servidor. Exportación autorizada por inventario/reportes/configuración. | `POST importar/excel` con multipart `archivo`; `GET exportar/excel` mediante `download`. |
| Ampliaciones | AQL formal, Zebra y Compras se presentan pendientes, sin botones ficticios ni simulación de impresora. | Sección «Ampliaciones pendientes» en Instalación y datos. |

## Límites y decisiones para integración

- No existe `DELETE clientes/:id/logo` en el backend consultado. Se implementa reemplazo del logo mediante PNG válido; no se ofrece una eliminación individual que el servidor no pueda realizar. La referencia del catálogo sí tiene DELETE y está conectada.
- `/health` devuelve disponibilidad del servicio y nombre del proyecto. No devuelve tamaño, motor, versión ni un diagnóstico de conexión SQL. La pantalla explica este alcance y no inventa métricas o conexiones independientes. `/instalacion` muestra el estado real de la primera cuenta.
- Los borradores permanecen en memoria de esta pantalla, incluidos los archivos. Sobreviven al sondeo y al cambio de pestaña; recargar la página o abandonar la ruta los descarta. La interfaz lo informa cuando existen borradores.
- Los flujos base/adjunto y cuenta/permisos son operaciones separadas del servidor. Cancelar después de un fallo parcial descarta los cambios pendientes, pero no revierte datos que ya fueron guardados; se informa cuando la primera fase fue persistida.
- La importación es aditiva para SKU existentes. No se reintenta automáticamente una mutación; ante fallo, conserva el archivo y permite reintento consciente. Un reenvío del mismo Excel puede volver a sumar stock, conforme al servidor.
- No se añadieron endpoints, cambios de esquema, pruebas ni estilos comunes; main conserva esas responsabilidades. No se alteró la semántica de inventario, producción ni permisos del backend.

## Revisión realizada

Se revisaron los payloads y respuestas contra `backend/app/routes/main.py`, `backend/app/routes/auth.py`, `backend/app/permisos.py`, modelos y contratos compartidos. Se corrigieron durante esa revisión las unidades de largo de plancha, el cliente opcional devuelto como `null`, el estado de filas fallidas y la conservación de borradores entre pestañas.

Se ejecutó el compilador TypeScript instalado en la copia mediante su API `createProgram`, con raíces limitadas a los cuatro TSX entregados, configuración existente, `noEmit: true` e `incremental: false`. Se inspeccionaron diagnósticos de esos cuatro archivos: **0 diagnósticos**. Esta comprobación estática no ejecuta la aplicación ni constituye una compilación o comprobación integrada de todo el proyecto.

No se ejecutaron navegador, servicios, pruebas ni build. Queda a main la validación integrada ya acordada: CRUD con permisos reales y revocación, cancelación, guardado/eliminación por lote con fallos parciales, subida fallida tras alta, límites PNG en el servidor, protección de la propia cuenta, Excel aditivo, temas/móvil, doble scroll y typecheck/build completos.
