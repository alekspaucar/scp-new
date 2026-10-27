# Correcciones críticas del backend nuevo

Fecha de ejecución: 24 de octubre de 2026.

## Alcance y estado

Trabajo exclusivo en `/private/tmp/sgp-nueva-hVmGDG/backend`. No se usaron Git ni subagentes. No se consultó ni ejecutó el SGP principal. No se reiniciaron servidores ni se borraron o reinicializaron bases de E2E o del principal.

**Listo para reinicio manual del backend nuevo en API 5102.** El proceso actual no tiene recarga: aún necesita ese reinicio para cargar las correcciones. El puerto predeterminado continúa siendo 5101; la selección de 5102 sigue mediante `SGP_NUEVA_PORT`. No se arrancó ningún servidor durante este trabajo. La validación HTTP se realizó con clientes de prueba Flask y bases desechables; el E2E con frontend 3001 corresponde al flujo de MAIN.

## Evidencia RED y GREEN

Los tests se escribieron y ejecutaron antes de modificar el código de aplicación.

| Ejecución | Resultado | Evidencia |
| --- | --- | --- |
| Regresiones iniciales contra código anterior | 43 fallos esperados, 5 controles aprobados | [red-critical.log](../tests/red-critical.log) |
| Regresión adicional: limpiar factura ante conflicto ORM | 1 fallo esperado por archivo sin referencia | [red-invoice-conflict.log](../tests/red-invoice-conflict.log) |
| Regresiones finales | **49 aprobadas** en 4,60 s | [green-critical.log](../tests/green-critical.log) |
| Suite completa final | **99 aprobadas** en 6,56 s | [green-suite-critical.log](../tests/green-suite-critical.log) |

Comandos, ejecutados desde este backend con su propio entorno:

```sh
.venv/bin/python -m pytest tests/test_critical_corrections.py -q --tb=short
.venv/bin/python -m pytest -q --tb=short
```

La suite final reúne las 50 pruebas existentes y 49 nuevas. Emitió 12 advertencias `LegacyAPIWarning` de SQLAlchemy por rutas que utilizan el existente `Query.get()`/`get_or_404()`. No hubo fallos.

Todas las bases de prueba se crearon en `backend/instance/test-*/test.sqlite3`; todos sus adjuntos quedaron en `backend/uploads/test-*/`. El fixture elimina únicamente esos directorios desechables al terminar. No se imprimieron secretos ni se activó depuración.

## 1. Identidad de sesión ligada a la cuenta

Causa: Flask-Login guardaba solo el ID numérico. SQLite podía reutilizar el mayor ID eliminado y una cookie anterior autenticaba a la cuenta nueva.

`Usuario.get_id()` devuelve ahora `id:sha256(password_hash)`. El hash de contraseña ya incluye una sal aleatoria; incluso una cuenta nueva con la misma contraseña tiene otra identidad. El cargador valida estructura, ID dentro del rango SQLite y token completo mediante `hmac.compare_digest`. Rechaza IDs legacy, tokens mal formados y digest incorrecto. Cambiar la contraseña invalida las sesiones emitidas con el hash anterior. No se agregó ninguna columna para este cambio.

Regresiones: eliminar al operador con ID mayor, crear un administrador con exactamente ese ID y verificar `GET /api/sesion` y `/api/usuarios` con la cookie anterior: **401**. También se verifican el cambio de contraseña, seis formas de token inválido y la persistencia de sesiones nuevas tras reiniciar la aplicación mediante la suite existente.

### Contrato para MAIN

- La cookie conserva el nombre `sgp_nueva_session`; el frontend no interpreta su identidad interna.
- Las respuestas de login/sesión mantienen el ID público numérico y el formato de usuario anterior.
- Las cookies emitidas antes de esta corrección requieren iniciar sesión de nuevo después del reinicio.
- Un cambio de contraseña invalida también la sesión actual si corresponde a esa cuenta; la siguiente consulta de sesión devuelve 401.

## 2. Revisiones y concurrencia

Causa: el backend serializaba escritores SQLite, pero aceptaba sin condición un borrador abierto antes de los cambios de otro usuario. El PUT de pedido podía eliminar ítems ausentes en ese borrador; el PUT de material podía reponer stock antiguo.

`Material` y `Pedido` incorporan `revision INTEGER NOT NULL DEFAULT 1` y `version_id_col` de SQLAlchemy. El ORM incluye la versión leída en el predicado de UPDATE/DELETE; dos sesiones independientes no pueden sobrescribir una versión ya confirmada. El manejo de `StaleDataError` revierte la transacción y responde 409. Se conserva el turno de escritura SQLite existente.

Un evento `before_flush` incorpora al versionado del pedido los cambios de sus ítems, entregas y faltantes: alta, modificación y eliminación. Así, el historial también invalida los borradores de cabecera. Los cambios de cabecera, estado, planificación, factura y stock incrementan la versión mediante el ORM. Las revisiones son crecientes; una operación con varios flush puede incrementarlas más de una vez.

### Contrato final para MAIN

`Material.revision` y `Pedido.revision` son enteros positivos presentes en los objetos serializados, incluidos listados, detalle de pedido y respuestas que contienen `material` o `pedido`.

Enviar **la revisión del borrador al abrir el editor** junto con los campos anteriores en:

```text
PUT /api/materiales/<id>
PUT /api/pedidos/<id>
```

Ejemplo de material:

```json
{"revision": 3, "nombre": "Nombre actualizado", "stock_actual": 18}
```

Ejemplo de pedido, conservando el payload completo de cabecera e IDs de ítems:

```json
{
  "revision": 5,
  "cliente": "Cliente de ejemplo",
  "orden_compra": "OC-100",
  "fecha_entrega": "2026-12-01T12:00",
  "items": [
    {"id": 7, "codigo": "PROD-1", "descripcion": "Etiquetas", "cantidad": 100}
  ]
}
```

| Condición | HTTP | `codigo` |
| --- | --- | --- |
| Falta `revision` | 428 | `revision_requerida` |
| Es null, booleano, texto, decimal o menor que 1 | 400 | `revision_invalida` |
| Difiere de la versión almacenada | 409 | `revision_desactualizada` |
| Revisión válida y campos válidos | 200 | Respuesta de éxito anterior, con revisión en el recurso |

El conflicto detectado en la precondición añade `revision_actual` al error. Un conflicto detectado por el ORM responde 409 con el mismo `codigo`, sin garantizar `revision_actual`. Ante un conflicto, recargar el recurso y reconciliar el borrador; actualizar solo el número de revisión del payload antiguo permitiría sobrescribir cambios que el usuario aún no ha visto.

Los endpoints de estado, entregas, modo parcial, faltantes, planificación y movimientos conservan sus payloads y no exigen la nueva precondición. Sus mutaciones invalidan los borradores de cabecera. El endpoint de estado de ítem conserva su respuesta `item`/`progreso`; consultar el pedido para obtener su revisión actual. Tras guardar, usar la revisión devuelta o recargada, sin calcularla localmente.

### Migración y conservación de datos

Al crear la aplicación, una migración aditiva e idempotente agrega las columnas faltantes bajo `BEGIN IMMEDIATE`. Solo usa la base configurada que la validación existente confina a `backend/instance/`. No se ejecutó la migración sobre la base E2E durante este trabajo: se aplicará a su base configurada cuando MAIN reinicie el backend nuevo.

Se probó una base desechable existente sin columnas `revision`, dos arranques consecutivos y conservación de pedidos, ítems, movimientos y stock. No hay reconstrucción ni borrado de tablas en esta migración.

Regresiones principales:

- Borrador A agrega un ítem; se registran una entrega de 10 y un faltante de 3 sobre él; borrador B antiguo intenta cambiar la fecha: **409**, pedido completo e historial idénticos al estado previo al intento.
- Material abierto con 20, salida de 2, PUT con revisión anterior: **409**, stock **18**, movimiento conservado.
- Cada operación de ítem, entrega y faltante invalida una cabecera antigua.
- Dos peticiones concurrentes con la misma revisión producen exactamente **200 y 409**.
- Dos sesiones ORM independientes para cada modelo: la segunda escritura obsoleta lanza `StaleDataError` y conserva el primer cambio.
- La suite existente verifica que los parciales no descuentan stock y que la entrega final conserva el flujo de descuento, MRP y planificación.

## 3. Cuenta y permisos en una sola transacción

`POST /api/usuarios` y `PUT /api/usuarios/<id>` aceptan `permisos` junto con los campos de cuenta. Se valida antes de modificar la cuenta y se persiste en el mismo commit que username, password y rol. No hay una segunda petición ni un commit intermedio con permisos por defecto.

### Contrato final para MAIN

```json
{
  "username": "operador-ejemplo",
  "password": "contraseña-elegida",
  "rol": "operador",
  "permisos": {
    "pedidos": "ninguno",
    "produccion": "ninguno",
    "operaciones": "ninguno",
    "inventario": "ninguno",
    "reportes": "ninguno",
    "configuracion": "ninguno",
    "calculadora": "ninguno"
  }
}
```

- El mapa requiere exactamente esas siete claves; cada valor debe ser `ninguno`, `ver` o `editar`.
- `null` restablece los permisos por rol.
- Campo omitido en POST: permisos por rol. Omitido en PUT: conserva los personalizados; si el rol cambia, se mantiene el comportamiento previo de restablecer sus valores por defecto.
- `admin` y `jefe` mantienen acceso completo: un mapa personalizado se rechaza con 400; pueden enviar `null` u omitir el campo.
- Permisos inválidos: **400**, sin crear usuario ni modificar campos de cuenta.
- Se conservan los códigos existentes: POST **200** y PUT **200**, con `{mensaje, usuario}`. `usuario` incluye `id`, `username`, `rol`, `permisos` efectivos y `permisos_personalizados`.
- Sigue disponible `PUT /api/usuarios/<id>/permisos` para otros flujos.

Las regresiones comprueban que la primera sesión de una cuenta nueva con todos los permisos en `ninguno` recibe 403 al consultar pedidos, materiales, planificación, catálogo y clientes. También comprueban seis mapas inválidos sin creación, edición conjunta de cuenta/permisos, rechazo sin modificación de contraseña/username/rol, restablecimiento por null y revocación mediante el endpoint dedicado.

## 4. Facturas con MIME e inline

Se conserva la validación de firma PDF y de formato real de imagen durante la subida. La descarga utiliza una lista explícita de extensiones/tipos seguros y `Content-Disposition: inline` con nombre de archivo. Se conserva `X-Content-Type-Options: nosniff` y el control de acceso. Una extensión de factura fuera de la lista se rechaza con 404.

| Extensión | Content-Type |
| --- | --- |
| `.pdf` | `application/pdf` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.webp` | `image/webp` |

Se subieron documentos válidos en los cinco formatos mediante la ruta real; GET comprueba el MIME, disposición inline, nombre, nosniff y coincidencia de bytes. Una prueba adicional provoca un conflicto real del ORM al guardar la referencia de factura y comprueba **409**, rollback del pedido y eliminación del archivo sin referencia.

## Archivos de entrega

- `app/models.py`: identidad de sesión, columnas versionadas y evento de revisión de historial.
- `app/__init__.py`: validación completa de identidad y migración aditiva de revisiones.
- `app/routes/main.py`: precondiciones de edición, conflictos ORM, persistencia atómica de permisos y servicio de facturas.
- `tests/test_critical_corrections.py`: 49 regresiones y controles.
- `tests/red-critical.log`, `tests/red-invoice-conflict.log`, `tests/green-critical.log`, `tests/green-suite-critical.log`: evidencia de ejecución.
- `docs/backend-correcciones.md`: este informe y contratos para integrar.
