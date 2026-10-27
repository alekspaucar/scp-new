# Proprint — SGP nueva interfaz

Proyecto independiente construido con la interfaz Next.js entregada y las funciones operativas de SGP. Su backend Flask, base SQLite, archivos y sesiones pertenecen a esta carpeta. No necesita ejecutar el proyecto Angular anterior ni conectarse al servidor de la planta.

## Revisión integral — 27 de octubre de 2026

Se contrastaron las funciones del original con cada área nueva. Se completaron referencias, enlaces, operaciones por lote, captura y recuperación de errores, permisos y validación de planificación. El Gantt usa una agenda compacta, pendientes visibles y asignación al siguiente espacio; fecha/duración son opcionales y la cronología muestra un día acotado.

Verificación actual: **227 pruebas backend, 103 de cliente y 18 de navegador aprobadas**, más el recorrido completo de 18 comprobaciones sin errores JavaScript. Compilación y tipos aprobados. Se revisaron visualmente todas las páginas de cuatro PDFs y la interfaz en escritorio y móvil. Consulta `docs/2026-10-27-cobertura-funcional.md` para funciones, reglas y límites de la evidencia.

## Abrir la aplicación

Desde esta carpeta, con Node.js 22.16 o posterior y Python 3.14 (versión utilizada para verificar la entrega):

```sh
npm ci
npm run setup
npm run dev
```

Abre **http://localhost:3000**. En el primer acceso elige tu usuario y una contraseña de al menos 10 caracteres. Esa cuenta tendrá rol jefe. No hay una contraseña predeterminada ni se copiaron cuentas del SGP anterior.

### Cuenta inicial en Render

Cuando Render ejecuta esta aplicación de producción con `INSTALLATION_TOKEN`
configurado, crea una única cuenta administradora al arrancar: usuario `admin`
y contraseña `12345`. La cuenta no se vuelve a crear si ya existe una base de
datos. Cambia esa contraseña desde Configuración → Usuarios al primer ingreso.

El mismo comando inicia frontend en `127.0.0.1:3000` y API en `127.0.0.1:5101`. `Ctrl+C` detiene ambos procesos. Para iniciarlos por separado: `npm run dev:api` y `npm run dev:web`.

Para ejecutar la versión compilada:

```sh
npm run build
npm start
```

Si el puerto 5101 está ocupado, exporta `SGP_NUEVA_PORT=5103` **antes de compilar y arrancar**. El frontend y el backend deben usar el mismo valor; el puerto 5001 está expresamente rechazado. Las opciones de `.env.example` son una referencia: configura las variables opcionales en la terminal de arranque.

## Funciones disponibles

| Área | Funciones |
|---|---|
| Monitor y pedidos | Indicadores reales, tres estados productivos, Facturado, retiros, cuenta regresiva, filtros y archivo de entregados |
| Pedidos | Captura manual o escáner, cliente rápido, catálogo por cliente, múltiples ítems, revisión, lectura documental, edición, PDF e impresión |
| Producción | Inicio de pedidos en cola, controles de ítem y parciales solo en Procesando, historial y consulta de pedidos listos |
| Pre-acabados | Reportar faltantes de corte, corregir pendientes, registrar reposición e historial |
| Planificador | Agenda compacta por M1/M2/Mesp, línea de tiempo desplegable, asignación manual, arrastre, reprogramación, autoasignación y regreso a cola |
| Bodega | Inventario por categoría, unidad y SKU, alertas, entradas/salidas por escáner o cantidad, historial y Excel |
| Datos maestros | Catálogo con rendimientos y maquinaria, referencias, clientes y logos, borradores y guardado/eliminación por lote |
| Usuarios | Cuentas y permisos por sección, lectura/edición/sin acceso y revocación comprobada en el servidor |
| Cálculos y reportes | Calculadora individual, MRP por lote, disponibilidad de material, stock/pedidos por filtros, PDF/impresión y Excel |

La interfaz conserva los paneles translúcidos, paleta índigo/menta y temas claro/oscuro de la referencia. Menú, tablas y ventanas se adaptan a móvil. La hora se presenta en America/Guayaquil.

## Datos propios y aislamiento

| Ubicación | Uso |
|---|---|
| `sgp-nueva.sqlite3` | Base activa de esta instalación, en la raíz del proyecto nuevo |
| `backend/instance/.session-secret` | Clave privada persistente de las sesiones; no publicar |
| `backend/uploads/catalogo/` | Referencias JPG/PNG/PDF |
| `backend/uploads/logos/` | Logos de clientes |
| `backend/uploads/facturas/` | Facturas PDF/imagen |
| `backend/.venv/` | Dependencias Python propias; se recrean con setup |

Estos datos están excluidos por `.gitignore`. Conserva copias de seguridad de la base y los adjuntos antes de operar con datos reales. Recompilar no los sustituye.

La API ignora `DATABASE_URL`, `SECRET_KEY` y la contraseña inicial del SGP anterior. Por defecto usa `sgp-nueva.sqlite3` en la raíz. `SGP_NUEVA_DATABASE_URL` permite elegir ese mismo archivo o una SQLite absoluta dentro de `backend/instance` para instalaciones separadas y pruebas. Los adjuntos se restringen a `backend/uploads` mediante `SGP_NUEVA_UPLOADS_DIR` (o su alias `SGP_NUEVA_UPLOAD_FOLDER`). Se rechazan rutas o enlaces que escapen de estas carpetas. La cookie se llama `sgp_nueva_session`.

Si actualizas una instalación que aún usa `backend/instance/sgp-nueva.sqlite3`, detén su servicio y ejecuta `backend/.venv/bin/python backend/move_database.py --a-raiz`. Conserva registros y cuentas, verifica la integridad y deja una copia previa dentro de `backend/instance/backups`. Nunca reemplaza una base ya existente en la raíz. Las sesiones conservan su clave privada original.

No se inicializó Git. Puedes crear un repositorio para esta carpeta cuando decidas hacerlo. Evita incluir `.env`, `.venv`, `instance`, `uploads`, `node_modules`, `.next` o `artifacts`.

## Datos de demostración optativos

Después de preparar el backend, puedes crear ejemplos **exclusivamente en esta instalación**:

```sh
backend/.venv/bin/python backend/seed_demo.py --crear-demo
```

La acción crea registros `DEMO-SGP-*`, materiales, clientes y catálogo de demostración. No crea usuarios. Repetirla no duplica ni reinicia los ejemplos ya modificados. La aplicación funciona con base vacía; esta carga no se ejecuta al arrancar.

Para un recorrido con todas las pantallas pobladas:

```sh
backend/.venv/bin/python backend/seed_demo.py --crear-demo --ampliar
```

En la entrega del 24 de octubre se cargaron 18 pedidos, 23 ítems, 12 materiales, 14 productos, 6 clientes y 27 movimientos, con ejemplos de parciales, faltantes y planificación. Los registros llevan `DEMO` y no son datos de la planta. La cuenta que ya había creado el usuario se conservó.

## Uso sencillo

- En Nuevo pedido, **Filas** aparece antes de los ítems. Escribe el total deseado (1–50); aparecen inmediatamente sin botón. Si reduces filas con datos, debes confirmar antes de descartarlas.
- **Configuración → Clientes** reúne contactos y direcciones de facturación/entrega.
- **Configuración** reúne productos, clientes, usuarios y herramientas de datos.
- **Producción** abre los ítems dentro de la tarjeta. En Cola muestra **Iniciar producción**; Estado, Entrega y Faltante aparecen solo en **Procesando**. Por entregar queda en consulta; los flujos de facturación y entrega conservan sus pantallas.
- **Planificador** muestra una agenda compacta por máquina. La línea de tiempo completa se abre cuando se necesita.
- El menú móvil tiene fondo sólido. Las ventanas conservan la **X** visible mientras desplazas su contenido y el resumen del pedido incluye un círculo pequeño de progreso.
- Las confirmaciones usan ventanas del sistema con botones claros; no usan mensajes del navegador.
- Geist Sans se sirve localmente desde `public/fonts`, con su licencia OFL. Toda la interfaz comparte esa fuente, también las ventanas, códigos y fechas.
- La ayuda detallada está plegada y se abre cuando se necesita. Los errores y avisos que afectan los datos permanecen visibles.

## Reglas conservadas y límites

- Flujo: En Cola → Procesando → Terminado → Facturado → Entregado; Facturado también permite Retiro en Fábrica antes de entregar. Facturado puede autorizarse sin PDF.
- Las entregas parciales no descuentan material. El descuento de rollos ocurre al entregar el pedido completo, por ítem y limitado al stock existente, conforme al backend actual. Editar/eliminar un entregado aplica su reversión histórica. Solo jefe puede editar un entregado.
- Tintas y herramientas usan las unidades que devuelve el backend actual. No se aplica la conversión a ml mencionada por notas antiguas.
- La calculadora individual y el MRP por lote comparten ahora el cálculo estricto de consumo. Sin los datos necesarios no se inventan valores. Se indica el rendimiento aplicado, las estimaciones y discrepancias; el cálculo usa fracciones antes de redondear rollos y conserva la precisión de metros y superficie.
- Cada cálculo puede descargarse como PDF completo. Se reconstruye en el backend y se compara su revisión con el resultado consultado; si cambió catálogo, pedido o disponibilidad hay que recalcular. El PDF incluye datos, fórmulas, unidades, redondeos, empaque, disponibilidad y advertencias. Calcular no reserva ni descuenta stock.
- Reportes con rango de fechas de pedidos filtra por la fecha **real de entrega**. Pedidos aún sin entrega no aparecen al aplicar ese intervalo.
- El historial de movimientos devuelve los últimos 50 registros globales, también cuando se filtra por material.
- OCR de imágenes requiere Tesseract instalado con idiomas de lectura. Sin él, la captura manual y la lectura de PDF con texto siguen disponibles; el servidor informa el error de OCR.
- La inspección AQL formal, Compras y la impresión industrial Zebra permanecen pendientes. No se muestran como funciones conectadas. La impresión PDF del navegador sí está disponible.
- Catálogo/clientes y sus adjuntos se guardan en dos pasos. Si falla el adjunto, el formulario conserva el registro ya creado y permite reintentar sin duplicarlo. Cancelar descarta lo pendiente, sin revertir una primera fase ya guardada.
- Pedidos y materiales incluyen una revisión. Si alguien cambia el pedido o mueve stock mientras editas, el servidor rechaza el borrador antiguo con un conflicto. Conserva tus cambios hasta que decidas recargar; nunca se actualiza la revisión a ciegas sobre ítems antiguos. En Inventario puedes cargar el saldo vigente y conservar los demás campos para revisarlos antes de guardar.
- Cuentas y permisos se guardan en una sola transacción. Eliminar una cuenta o cambiar su contraseña invalida sus sesiones anteriores, aunque SQLite reutilice su número de usuario.
- No hay endpoint para borrar solo un logo de cliente; se puede reemplazar por otro PNG. Las referencias de catálogo sí admiten eliminación.

## Verificación y desarrollo

```sh
npm test
npm run typecheck
npm run build
backend/.venv/bin/python -m pip install -r backend/requirements-dev.txt
backend/.venv/bin/python -m pytest backend/tests -q
```

Las pruebas de backend crean almacenamiento temporal propio dentro de las carpetas de esta instalación. Nunca apuntan al SGP principal.

Para el recorrido automatizado del navegador, usa una **base separada**:

```sh
# Terminal 1, desde esta carpeta. Sustituye /RUTA/ABSOLUTA por esta carpeta real.
SGP_NUEVA_DATABASE_URL=sqlite:////RUTA/ABSOLUTA/backend/instance/e2e.sqlite3 \
SGP_NUEVA_UPLOADS_DIR=/RUTA/ABSOLUTA/backend/uploads/e2e \
SGP_NUEVA_PORT=5102 npm run dev:api

# Terminal 2
SGP_NUEVA_PORT=5102 npx next dev --hostname 127.0.0.1 --port 3001

# Terminal 3
npx playwright install chromium
npm run test:e2e
npm run test:browser
```

El navegador de pruebas verifica el nombre del servicio y solo admite `localhost/127.0.0.1` en puertos de pruebas 3001/3100. Guarda capturas y resultados en `artifacts`, y credenciales aleatorias de la cuenta de pruebas dentro de `backend/instance/.e2e-login.json`. No uses esa cuenta/base para el trabajo diario.

## Documentación

- `docs/2026-10-27-cobertura-funcional.md`: revisión actual de todas las áreas, evidencia y límites.
- `docs/auditoria-*-20261027.md`: matrices técnicas por área.

- `docs/2026-10-24-movil-flujo-planificador.md`: menú móvil, cierre flotante, progreso circular y flujo por estado.
- `docs/2026-10-24-redisenio-operativo.md`: fuente moderna, confirmaciones propias, desplegables, contadores, consumo y PDF.
- `docs/2026-10-24-sgp-nueva-interfaz-diseno.md`: diseño aprobado y referencias de Obsidian.
- `docs/2026-10-24-plan-implementacion.md`: tareas y contratos de integración.
- `docs/estado-migracion.md`: cobertura, comprobaciones y pendientes de la entrega.
- `docs/*-informe.md`: detalle de cada módulo y sus límites.
- `docs/interfaz-original.tsx.txt` y `docs/estilos-originales.css.txt`: referencia original entregada, preservada para consulta.
