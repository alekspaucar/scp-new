# SGP nueva interfaz — Plan de implementación

> Ejecutar los módulos dentro del proyecto nuevo; el usuario aprobó el diseño y la construcción completa el 2026-10-24. No inicializar Git.

Objetivo: convertir la interfaz Next.js entregada en un SGP funcional con una instalación Flask independiente.
Diseño: `2026-10-24-sgp-nueva-interfaz-diseno.md`.

## Restricciones globales

- Referencia de solo lectura: `/Users/erickvzh/Desktop/SGP/sgp_docs_completo`.
- Entrega: `/Users/erickvzh/Desktop/nueva interfaz/erp-manufacturing-dashboard`.
- El montaje temporal vive en `/private/tmp/sgp-nueva-hVmGDG`; se entregará mediante copia física, sin enlaces a la referencia.
- Base y adjuntos propios; ignorar DATABASE_URL/SECRET_KEY de la instalación anterior. Cookie propia; API 5101 y web 3000.
- Conservar reglas operativas verificadas y lenguaje visual de la interfaz entregada.
- Sin Git, despliegues remotos, base de planta ni credenciales copiadas.

## Foco de revisión

1. Una variable heredada o un enlace simbólico no debe permitir escribir fuera del almacenamiento propio.
2. Permisos revocados y respuestas 401/403 deben retirar acciones y conservar una salida de sesión usable.
3. Fechas sin zona del backend se interpretan en Ecuador; no convertir el día prometido según la zona del navegador.
4. Formularios, ítems e historiales deben conservar identidad y borradores al sondear o ante errores parciales.
5. Fallos en descargas, factura en dos pasos, datos MRP incompletos o red caída deben mostrar resultado real y permitir reintento.

## Tareas y contratos

### 1. Backend aislado

Archivos: `backend/config.py`, `backend/app/__init__.py`, `backend/app/routes/auth.py`, `backend/run.py`, `backend/seed_demo.py`, `backend/tests/test_isolation.py`, `backend/requirements.txt`.

- [ ] Escribir pruebas de aislamiento: DATABASE_URL heredada ignorada; ruta de BD fuera de backend/instance rechazada; uploads externos/enlaces rechazados; cookie diferenciada.
- [ ] Verificar fallo antes de cambiar configuración; adaptar solo la copia.
- [ ] Conservar modelos, rutas y permisos existentes; añadir salud, respuestas JSON para errores de sesión y primer acceso de instalación local.
- [ ] Crear cuenta inicial con contraseña elegida en primer acceso, de forma atómica y solo con base vacía. No ofrecer credenciales fijas.
- [ ] Semilla de demostración opcional, identificable e idempotente, usando únicamente los archivos de la instalación nueva.
- [ ] Ejecutar pruebas del backend y flujo real de sesión/material/pedido.

### 2. Cliente y navegación

Archivos: `lib/types.ts`, `lib/api.ts`, `lib/domain.ts`, `components/session-provider.tsx`, `components/workspace.tsx`, `components/shared.tsx`, `app/layout.tsx`, `app/page.tsx`, `app/[section]/page.tsx`, `next.config.mjs`, `tests/domain.test.ts`.

Contrato: `api<T>(path, RequestInit?)`; `jsonRequest(method, body)`; `upload<T>(path, File)`; `download(path,name,init?,inline?)`. Rutas API relativas sin `/api` inicial. `useResource<T>(path|null,interval?)` devuelve `{data,loading,error,reload}`. `useSession()` devuelve `{user,loading,error,can,isManager,refresh,login,logout}`. `can(module,level='ver')` refleja el mapa de sesión, no localStorage.

- [ ] Pruebas previas de permisos y fechas de Ecuador.
- [ ] Instalar dependencias únicamente del proyecto nuevo y mantener errores TypeScript activos.
- [ ] Proveedor de sesión real, configuración inicial y login; navegación con rutas propias, menú móvil, tema persistido y estados de desconexión reales.
- [ ] Componentes compartidos Panel/Heading/Modal/Feedback/DataState/Status, formato de números/fechas y desplazamiento de tablas sincronizado.

### 3. Pedidos y producción

Archivos: `components/orders/monitor.tsx`, `order-list.tsx`, `order-editor.tsx`, `order-detail.tsx`, `production.tsx`, `preacabados.tsx`.

- [ ] Consultar datos y catálogos según permisos; crear/editar pedidos con filas y escáner por ítem, importación documental revisable y resumen previo.
- [ ] Monitor con conteos globales, filtros, retiros y countdown; listado con archivo, búsqueda, edición, borrado confirmado y PDF.
- [ ] Ventana de detalle reutilizada con estados, parciales, historial, faltantes y documentos.
- [ ] Factura en dos etapas recuperable, autorización sin PDF, retiro/entrega y retrocesos con motivo.
- [ ] Bloquear solo la operación en curso y conservar borradores; nunca reiniciar formularios por sondeo.

### 4. Bodega y datos maestros

Archivos: `components/management/inventory.tsx`, `operations.tsx`, `settings.tsx`, `clients.tsx`, `catalog.tsx`, `users.tsx`.

- [ ] Inventario con unidades reales, filtros, paginación y formularios por categoría, SKU inmutable y suma de stock al crear SKU existente.
- [ ] Operaciones con escaneo/Enter, cantidades, prevención de doble envío, foco y últimos movimientos.
- [ ] Catálogo/clientes con edición, selección, operaciones de lote, cancelación, referencias/logos y tablas anchas con doble scroll.
- [ ] Usuarios y permisos efectivos; proteger la propia cuenta y aplicar revocaciones.
- [ ] Importar/exportar Excel con permiso de Inventario, además del acceso de Configuración.

### 5. Gantt, calculadora y reportes

Archivos: `components/planning/gantt.tsx`, `calculator.tsx`, `reports.tsx`.

- [ ] Máquinas M1/M2/Mesp, escala continua, asignación/arrastre/reprogramación, vuelta a cola y autoasignación reales.
- [ ] Calculadora con producto de catálogo y cantidad; explicar predeterminados actuales y mostrar planchas/metros/área/empaque.
- [ ] Reportes stock/pedidos con fechas, cliente, estados, PDF/impresión y Excel.
- [ ] MRP por lote con selección, desglose de datos, advertencias y disponibilidad desconocida distinta a insuficiente; invalidar resultados al cambiar selección.

### 6. Integración, entrega y revisión

Archivos: `app/globals.css`, `README.md`, `.env.example`, `scripts/dev.mjs`, `scripts/setup.mjs`, `.gitignore`, `docs/estado-migracion.md`, `tests/e2e.mjs`.

- [ ] Mantener paleta/espaciado/transparencias originales; corregir solo lo necesario para datos reales, formularios y móvil.
- [ ] Pruebas de flujo real con base de pruebas propia: instalación inicial/login, pedido persistido, movimiento, parcial, faltante, Gantt, documentos y usuario de lectura.
- [ ] Compilar Next.js sin omitir errores de tipos; revisar visualmente claro/oscuro y móvil.
- [ ] Revisar con un lector independiente las fronteras de aislamiento, permisos y mutaciones.
- [ ] Copiar entrega únicamente a nueva interfaz, instalar su entorno propio y verificar arranque allí.
- [ ] Comparar la huella del SGP original y documentar el resultado.

## Registro de decisiones

- El usuario reservó Git para después: no se ejecutan los pasos de commits/worktrees de las skills.
- La primera contraseña se elige en una pantalla inicial local; no se copia un usuario de la planta ni se entrega una contraseña universal.
- La copia del backend conserva la semántica operativa existente. Sus mejoras futuras de stock o AQL se documentan sin introducir cambios implícitos.
