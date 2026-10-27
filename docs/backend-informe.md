# Backend independiente — informe de integración

Fecha: 2026-10-24. Tarea 1 del plan aprobado. Trabajo limitado a `backend/**` y este informe, dentro de `/private/tmp/sgp-nueva-hVmGDG`. Sin Git, subagentes ni servidores duraderos. No se editó, ejecutó ni importó código de la instalación original.

Actualización de integración: este informe describe la primera etapa de 50 pruebas. La revisión posterior añadió revisiones de concurrencia en Material/Pedido, identidad de sesiones, permisos atómicos y MIME de facturas exclusivamente en esta copia. El resultado final es 99 pruebas aprobadas; consulta `backend/docs/backend-correcciones.md` y `docs/estado-migracion.md` para los contratos vigentes. Catálogo y Clientes se editan por el permiso efectivo de Configuración; la administración de usuarios sigue reservada a admin/jefe.

## Contrato de configuración para main

| Variable | Comportamiento |
| --- | --- |
| `SGP_NUEVA_DATABASE_URL` | Única variable de BD admitida. URL SQLite con ruta **absoluta**, exclusivamente bajo `backend/instance`. Por defecto `sqlite:////…/backend/instance/sgp-nueva.sqlite3`. Rechaza otras bases, rutas relativas, memoria, parámetros URI y escapes por enlaces simbólicos. |
| `SGP_NUEVA_UPLOADS_DIR` | Raíz de adjuntos propia. Por defecto `backend/uploads`; admite subdirectorios exclusivamente dentro de esa raíz. Contiene `catalogo`, `logos` y `facturas`. |
| `SGP_NUEVA_UPLOAD_FOLDER` | Alias compatible para la misma **raíz** de adjuntos. Si ambas variables están presentes, deben resolver al mismo directorio. Internamente `app.config['UPLOAD_FOLDER']` apunta a `<raíz>/catalogo`, conservando el contrato de las rutas copiadas. |
| `SGP_NUEVA_PORT` | Por defecto `5101`. Solo enteros `1024..65535`, excluyendo expresamente `5001`. `5102` admitido para integración. |

`DATABASE_URL`, `SECRET_KEY`, `SGP_INITIAL_ADMIN_PASSWORD`, `PORT`, `FLASK_DEBUG` y carpetas heredadas no configuran esta instalación. **No existe override `SGP_NUEVA_SECRET_KEY`**: el secreto aleatorio propio persiste en `backend/instance/.session-secret`, modo `0600`, con archivo de bloqueo también privado para inicialización simultánea entre procesos. Cookie `sgp_nueva_session`, HttpOnly, SameSite=Lax, sesión de diez horas. Una sesión sobrevive a recrear la aplicación con la misma BD y secreto.

Se comprueban las rutas resueltas antes de crear almacenamiento, incluyendo raíces, subdirectorios, ficheros existentes y sidecars de SQLite. Cada petición vuelve a comprobar enlaces agregados después del arranque; un escape devuelve JSON 403.

Ejemplo de entorno de pruebas desde la raíz del proyecto nuevo:

```sh
SGP_NUEVA_DATABASE_URL="sqlite:///$PWD/backend/instance/e2e.sqlite3" \
SGP_NUEVA_UPLOADS_DIR="$PWD/backend/uploads/e2e" \
SGP_NUEVA_PORT=5102 \
backend/.venv/bin/python backend/run.py
```

El backend siempre enlaza `127.0.0.1`, sin debug ni reloader. No se ejecutó ese comando de servidor durante este trabajo. Next usa 3001 para pruebas y 3000 al entregar, según coordinación con main.

## Endpoints de instalación y sesión

- `GET /api/health`: `200 {"status":"ok","proyecto":"sgp-nueva-interfaz"}`.
- `GET /api/instalacion`: `200 {"requiere_configuracion": boolean}`.
- `POST /api/instalacion`: objeto `{username,password}`, usuario no vacío de hasta 80 caracteres y contraseña de al menos 10. Solo conexión loopback, Host local y Origin local cuando está presente. No se confía en `X-Forwarded-For`. Un cuerpo inválido devuelve 400; acceso no local, 403.
- La instalación toma `BEGIN IMMEDIATE`, comprueba usuarios vacíos e inserta el primer `jefe` dentro de esa misma transacción. Retorna `201` con `usuario_a_dict` directamente, inicia sesión y establece la cookie. Otro intento retorna 409; contención SQLite que supere su espera retorna 503. La prueba simultánea obtuvo exactamente un 201 y un 409, con una sola fila de usuario.
- `POST /api/login`: conserva la respuesta plana con los campos de `usuario_a_dict` y el campo histórico `mensaje`; sin envoltura `usuario`/`data`. `GET /api/sesion` retorna el usuario plano.
- Salida conservada en `GET /logout`. Next debe reenviar `/api/**`, `/uploads/**` y `/logout`. Conviene enlazar también Next a loopback para mantener local el acceso inicial.
- LoginManager responde JSON 401. Errores 403/404 responden JSON. Se eliminó el servicio Angular y la configuración CORS de planta.

## Semilla optativa

```sh
backend/.venv/bin/python backend/seed_demo.py --crear-demo
```

Sin el flag explícito termina con código 2 antes de crear una aplicación. No hay carga automática de demo ni creación automática de cuentas, contraseñas o adjuntos.

Genera dos clientes, tres materiales (Disponible/Crítico/Agotado), dos productos con rendimientos utilizables por MRP y cinco pedidos identificados `DEMO-SGP-*`: dos En Cola, uno Procesando, uno Terminado y uno Facturado sin PDF. Incluye producto restringido a Mesp, reserva M1, parcial de 200 unidades y faltantes pendiente y resuelto. Usa fechas relativas a Ecuador. Puede ejecutarse antes de configurar al primer jefe.

La semilla es transaccional y se identifica por códigos y órdenes de compra `DEMO-*`. Repetirla conserva cantidades y modificaciones operativas de registros existentes. Se verificó tanto por llamada directa como ejecutando la CLI dos veces en procesos independientes, siempre con BD de pruebas propia. No se ofrece borrado automático que pueda eliminar datos modificados por el operador.

## Cambios y preservación de reglas

Cambios principales en `config.py`, `app/__init__.py`, `app/routes/auth.py`; se añadieron `run.py`, `seed_demo.py` y `tests/`.

`models.py` y `permisos.py` se conservaron. En `main.py` el único cambio fue retirar la búsqueda alternativa de facturas en `app/uploads/facturas`, necesaria para que todos los adjuntos pertenezcan a `backend/uploads`. Se retiró el fichero de prueba heredado `app/uploads/facturas/factura_22_test.pdf`, cuyo contenido era texto ficticio. No se copiaron DB, usuarios, secretos ni adjuntos del sistema original.

Se conserva la semántica existente: los parciales no descuentan stock; Entregado descuenta rollos por ítem hasta el stock disponible; Terminado marca pendientes como listos; una transición repetida se rechaza. MRP y Gantt no consumen stock. Devolver a la cola elimina la reserva de máquina, conservando el estado del pedido.

## Evidencia RED → GREEN

Las pruebas de configuración y bootstrap se escribieron **antes** de modificar su implementación.

| Registro en `backend/tests/` | Resultado observado |
| --- | --- |
| `red.log` | 12 fallos y 10 errores con la copia original: configuración heredada y ausencia de validación. Los errores posteriores también reflejan que la clase antigua fijaba la URL al importar y los directorios temporales ya se habían limpiado. No se cuentan como demostraciones individuales del nuevo bootstrap. |
| `red-bootstrap.log` | Prueba separada de concurrencia: dos 404 frente a los 201/409 requeridos; endpoint inexistente. |
| `red-health.log` | Prueba separada: salud respondía 404 HTML en lugar del JSON requerido. |
| `red-seed.log` | Dos fallos: no existía el módulo de semilla. |
| `red-env-contract.log` | Dos fallos antes del ajuste solicitado: nombre de variable de uploads y aceptación de SQLite relativa. |
| `red-port-alias.log` | Cuatro fallos antes del último ajuste: 1023 y 5001 admitidos, alias ausente y conflicto entre aliases no rechazado; siete pruebas existentes pasaban. |
| `green.log` | **50 passed** en la ejecución final, sin fallos. |

Comando final:

```sh
backend/.venv/bin/python -m pytest backend/tests -q --tb=short
```

Cobertura realizada: variables heredadas ignoradas; SQLite absoluta y confinada; uploads externos; enlaces de raíces, BD, journal y adjuntos; enlace agregado tras arrancar; secreto privado y persistente; salud; errores JSON; validación/localidad de instalación con IPv4/IPv6, Host, Origin y forwarded IP; carrera simultánea y segundo intento denegado; login/logout/cookie y reinicio de aplicación; permisos de lectura y revocación inmediata; movimientos y estados de stock; pedido persistido, parciales, resolución de faltantes y flujo hasta Entregado; MRP con cálculo esperado; Gantt M1/M2/Mesp, asignación persistida y vuelta a cola; CLI demo idempotente sin usuarios; puerto/reloader mediante una aplicación simulada que no abre sockets.

Todas las BD usadas por estas pruebas estuvieron dentro de `backend/instance`, con subdirectorios temporales propios. Los uploads de prueba estuvieron dentro de `backend/uploads`. Las fixtures limpian sus registros; se retiró también la BD relativa creada por el RED específico. Esta tarea no dejó su propia BD de demostración ni usuarios de prueba. Durante la integración main creó `backend/instance/e2e.sqlite3`; ese archivo se conserva y no se modifica ni limpia desde esta tarea. Los archivos privados de sesión también pertenecen al montaje temporal.

## Entorno y revisión final

Se creó `backend/.venv` con `python3` propio: Python 3.14.3. La instalación en sandbox falló por resolución de red; se repitió con `require_escalated` y terminó correctamente, solo en esa `.venv`. Se instalaron todas las versiones exactas de `requirements.txt` y pytest 9.1.1. **No hizo falta modificar requirements**. `pip check`: `No broken requirements found`.

Dependencias principales efectivamente probadas: Flask 3.1.0, Flask-SQLAlchemy 3.1.1, Flask-Login 0.6.3, SQLAlchemy 2.1.6, Werkzeug 3.1.9, Pillow 12.3.0, pdfplumber 0.11.10, reportlab 4.2.5. Flask-Cors permanece como dependencia fijada de la copia, pero no se importa ni habilita.

Autorrevisión final sin Git ni segundo agente, por instrucción del usuario. Se revisaron las fronteras de escritura, el bloqueo del bootstrap, los contratos de sesión y la conservación de las reglas de negocio. Main realizará la revisión independiente y los tests del navegador/proxy. No se validaron visualmente UI, OCR con Tesseract ni impresión real. Para trasladar la entrega, recrear la `.venv` en destino; los entornos Python no son portables. El secreto puede regenerarse en destino si se desea una instalación completamente nueva, sin sesiones heredadas del montaje temporal.
