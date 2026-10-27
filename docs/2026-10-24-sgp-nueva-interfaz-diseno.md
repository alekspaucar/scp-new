# SGP Proprint — Proyecto independiente con nueva interfaz

Fecha: 2026-10-24, America/Guayaquil.
Estado: aprobado por el usuario el 2026-10-24; implementación en curso.

## Pedido y ubicación

Crear un SGP nuevo y funcional usando el frontend entregado por el usuario en:

`/Users/erickvzh/Desktop/nueva interfaz/erp-manufacturing-dashboard`

El sistema SGP actual en `/Users/erickvzh/Desktop/SGP/sgp_docs_completo` se utiliza exclusivamente como referencia de lectura. El usuario creará posteriormente el repositorio Git del nuevo proyecto.

## Protección del proyecto principal

- Todas las escrituras del producto estarán dentro de la carpeta nueva.
- El backend nuevo será una copia física independiente de los archivos de código necesarios, adaptada dentro del proyecto nuevo. No se enlazará ni importará el backend desde la carpeta original.
- No se copiarán la base de datos, usuarios, contraseñas, secretos ni adjuntos de la instalación original. El nuevo proyecto comenzará con almacenamiento propio vacío y una opción explícita de datos de demostración.
- La configuración nueva usará variables con prefijo `SGP_NUEVA_`; ignorará `DATABASE_URL`, rutas de adjuntos y secretos heredados del SGP principal. El arranque comprobará que sus rutas de escritura pertenecen a la carpeta nueva y que no resuelven mediante enlaces al proyecto original.
- El backend escuchará en `127.0.0.1:5101` y el frontend en `127.0.0.1:3000`, con nombre de cookie propio. No se contactará al servidor de planta ni a Render.
- No se ejecutarán servicios, importaciones Python, compilaciones, migraciones, semillas, cambios Git o instalaciones dentro del proyecto principal.
- Se comparará al terminar una huella de los archivos del proyecto principal con la tomada durante el análisis. Cualquier diferencia externa se investigará, sin restaurar ni sobrescribir cambios del usuario.

Huella inicial de 201 archivos del proyecto principal, incluyendo código, documentación, build y base SQLite; excluye `.git`, dependencias y cachés:

`d8886c49d87cfae5213af21976f8b8caf04e4608f28e55b8562927dd7e98c711`

El árbol original ya tiene cambios locales de trabajos anteriores. Se preservarán tal como están.

## Fuentes revisadas y cómo se resuelven diferencias

Se revisaron `000_HOME.md`, la nota `002_Proyectos/SGP_Proprint.md` y las 20 notas de su carpeta en Obsidian. Incluyen arquitectura, módulos, API, roles, responsive, despliegue, deuda técnica, fase 2 y auditoría del Excel de planta.

Se contrastan con el código actual, los servicios HTTP y los documentos recientes del proyecto principal. La copia de Obsidian contiene notas sincronizadas en septiembre que todavía describen como pendientes funciones presentes en octubre, entre ellas usuarios, permisos por sección, MRP por lote y planificación. Para migrar el funcionamiento existente prevalece el código actual. Los documentos históricos aportan contexto y futuras ampliaciones, no cambian silenciosamente las reglas de negocio.

El frontend recibido es Next.js App Router + React + TypeScript + Tailwind CSS 4. Su pantalla única usa datos estáticos, formularios sin persistencia, una fórmula MRP ilustrativa, cuatro máquinas de ejemplo y varias acciones aún sin conectar. Se conserva su lenguaje visual y se sustituyen esas demostraciones por las funciones del SGP.

## Arquitectura elegida para esta propuesta

Se conserva Next.js y React, sin convertir la interfaz a Angular. Esta es una decisión técnica de la propuesta, basada en el frontend recibido.

Estructura prevista:

```text
erp-manufacturing-dashboard/
  app/                    Rutas y pantallas Next.js
  components/             Navegación, formularios, tablas y ventanas
  lib/                    Tipos, cliente HTTP, sesión y formato de fechas
  backend/
    app/                  Copia independiente del backend y reglas de acceso
    config.py             Configuración exclusiva de esta instalación
    run.py                Servicio en 5101
    requirements.txt
    instance/             Base SQLite propia, ignorada por Git
    uploads/              Adjuntos propios, ignorados por Git
  scripts/                Arranque y preparación del proyecto nuevo
  docs/                   Diseño, mapa de migración, estado y guía de uso
  .env.example            Variables documentadas, sin secretos reales
  README.md               Instalación, inicio, validación y límites conocidos
```

Next.js enviará `/api`, adjuntos y descargas al backend nuevo desde el servidor. El navegador usará el mismo origen para la sesión y los documentos. Se mantendrán las validaciones, transacciones y permisos del backend existente al adaptar su copia; el frontend no duplicará cálculos de stock como fuente de verdad.

Las pantallas se dividirán en rutas/componentes y una capa tipada de datos. Se mostrarán estados de carga, errores con recuperación, vacíos y confirmaciones. Los datos se actualizarán con una única fuente compartida, evitando sondeos duplicados por menús ocultos. Los formularios abiertos no se perderán por una actualización de fondo.

## Diseño y navegación

Conservar la identidad de la interfaz entregada: fondo azul niebla, paneles translúcidos, índigo, acentos menta/ámbar/coral, barra lateral plegable y sus temas claro/oscuro. Usar su guía de colores y tipografía. La referencia visual es esta carpeta, no las pantallas Angular antiguas.

La interfaz de operación estará en español, con fecha y hora de Ecuador. Reemplazar nombres, fechas, máquinas, valoraciones en euros, indicadores de conexión y métricas ficticias por valores verificados o estados vacíos.

Navegación funcional: Monitor, Pedidos, Producción, Gantt, Calculadora MRP, Pre-acabados, Inventario, Operaciones, Reportes, Clientes y Configuración. Clientes puede reutilizar la misma pantalla administrada en Configuración. Compras y Zebra, que no tienen implementación real, tendrán un estado explícito de futura ampliación en lugar de acciones ficticias.

En móvil, menú realmente utilizable, formularios y ventanas con desplazamiento vertical, tarjetas legibles y tablas anchas con desplazamiento horizontal. Los botones solo aparecerán cuando el permiso efectivo permita usarlos. La interfaz conservará el acceso a la sesión y la salida incluso cuando un usuario no tenga secciones habilitadas.

## Alcance funcional de la primera entrega

### Sesión y permisos

- Login real contra la copia del backend y verificación mediante `/api/sesion`.
- Roles actuales: jefe, admin, empleado y operador; niveles por sección: ninguno, ver, editar.
- Gestión de usuarios y permisos exclusivos de admin/jefe, con los límites del sistema actual sobre la propia cuenta y los pedidos ya entregados.
- Cambios y revocaciones de permisos reflejados en navegación y acciones, con control definitivo en cada endpoint del backend.
- Primera cuenta creada únicamente mediante una contraseña elegida para la instalación nueva. No reutilizar automáticamente credenciales de la planta.

### Monitor y pedidos

- Conteos reales de pedidos activos, riesgo, entregas del día y completados; filtros por cliente y estados operativos.
- Columnas En Cola, Procesando y Por entregar; esta última agrupa Terminado/Facturado como el frontend actual. Vista separada de Retiro en Fábrica y archivo de Entregados.
- Detalle con ítems, cantidades, progreso, fecha prometida, semáforo y cuenta regresiva.
- Crear/editar pedido con cliente existente o creación rápida, orden de compra (vacía al crear equivale a S/N), fecha y hora, ítems de catálogo filtrados por cliente, códigos manuales y trabajos sin código. Conservar captura de ítems por escaneo y su cantidad, hasta 50 filas manuales y revisión antes de confirmar.
- Revisión de importación de PDF/imagen antes de guardar. El OCR seguirá requiriendo Tesseract; si no está disponible se informará sin impedir la captura manual.
- PDF de pedido, impresión desde el navegador, subida y consulta de factura y retrocesos con motivo obligatorio.
- Ciclo real: En Cola → Procesando → Terminado → Facturado → Entregado, con alternativa Facturado → Retiro en Fábrica → Entregado. Facturado admite autorización sin PDF. Terminar marca listos los ítems pendientes; no exige que todos los parciales estén completos. Los efectos en stock seguirán los endpoints actuales. Entregar, borrar o corregir un pedido se confirmará antes de enviar.

### Producción, entregas y pre-acabados

- Kanban con acciones reales, detalle por ítem y actualización independiente de controles en curso.
- Estados de ítem, suspensión con observación, entregas parciales y su historial, con límites por cantidad y estado.
- Reporte de faltantes por ítem, unidad y motivo, consulta de pendientes y resueltos y reposición confirmada por Impresión.
- La pantalla llamada Control de calidad en la maqueta se conectará inicialmente a estos pre-acabados, que son lo que sus tarjetas de faltantes representan. Se distinguirá de una futura inspección AQL formal.

### Planificador Gantt

- Máquinas reales M1, M2 y Mesp, con línea de tiempo continua y las restricciones del backend actual.
- Cola de órdenes sin reserva, asignación manual, arrastre, controles equivalentes para teclado/móvil, reprogramación y regreso a la cola.
- Autoasignación con el algoritmo existente, fechas persistentes, tiempos estimados y mensajes de conflicto.
- Regresar a la cola elimina la reserva de máquina; no modifica el estado productivo, las entregas ni el stock del pedido.

### Inventario y operaciones

- Crear, editar, eliminar y buscar materiales por SKU, descripción, categoría, tipo y estado.
- Unidades reales del código actual: rollos para materia prima y unidades para tintas/herramientas. Las notas antiguas describen ml para tintas; no se aplicará esa conversión a espaldas de la planta. Se presentará la unidad de cada material tal como la devuelva la nueva copia de la API.
- Campos específicos de cada material, límites de stock, clasificación derivada y asociación al catálogo.
- Operaciones por código de barras o escritura manual, Entrada/Salida y cantidad positiva; Enter registra y vuelve al campo de escaneo.
- Bloqueo de doble registro mientras se guarda, reinicio de cantidad a 1 y conservación del tipo de movimiento.
- Historial real con usuario, fecha, unidad y observación; movimientos históricos sin botones de borrado.
- Importación de Excel y exportación del inventario, con permisos propios de Inventario y sin alterar la instalación original.

### Catálogo, clientes y usuarios

- Catálogo con código por cliente, descripción, rendimientos, dimensiones, material, tipo especial, referencia adjunta, tiempo base y máquina requerida.
- Respetar el tratamiento actual de códigos repetibles entre clientes y los registros sin código, sin confundir `S/C` en pedidos con `-` en catálogo.
- Clientes con código, nombre, RUC, direcciones, contacto, horarios, plazos y logo.
- Edición guardada explícitamente, cancelación sin efectos y confirmaciones de eliminación.
- Selección y guardado/eliminación por lote cuando corresponda, mostrando errores parciales y conservando los borradores no guardados. Las columnas anchas mantendrán desplazamiento horizontal superior/inferior sincronizado.
- Usuarios y permisos reales dentro de Configuración. No simular tres conexiones de base de datos cuando el backend opera una sola base relacional.

### Calculadora y reportes

- Sustituir la fórmula de superficie con un 8% ficticio de la maqueta por el endpoint de cálculo basado en el catálogo del SGP.
- Resultados de planchas, consumo, metros, área y paquetes de 200 con residuo, mostrando datos incompletos y estimaciones cuando corresponda.
- Reportes de stock y pedidos con sus filtros y PDF/Excel según el backend.
- MRP por lote de pedidos en cola: agrupación por cliente/producto, cálculo con rendimientos actuales, advertencias de datos faltantes y comparación con bodega. No registrar consumos al consultar el informe.

## Funciones futuras y puntos que no se deben falsear

La auditoría de Excel incluye AQL, cronometrajes detallados, laminación, residuos y formatos oficiales. No todo está implementado en el SGP actual. La primera entrega traslada lo operativo y documenta estas extensiones con enlaces a su fuente.

- AQL: la nota contiene ejemplos parciales y una inconsistencia entre `Re=0` y el rechazo al primer defecto crítico. No se fabricará una tabla ISO completa ni un dictamen certificado desde esos ejemplos. Una implementación formal requerirá contrastar la matriz completa y acordar los criterios de planta.
- Zebra: la carpeta nueva propone plantillas ZPL y una cola, pero faltan impresora, conexión y plantillas. Se documentará la ampliación y su estado pendiente; la impresión PDF existente sí se migrará.
- Compras, conexiones separadas y nuevos roles sugeridos por la maqueta son ideas futuras, no sustituyen automáticamente el flujo y permisos actuales.
- Tiempos: para la migración se conserva la planificación actual del código; la nota histórica de jornada 08:00–18:00 no reemplazará el planificador continuo de fase 2.
- Cálculos existentes: la calculadora individual todavía usa algunos valores predeterminados mientras el MRP por lote valida datos faltantes de forma estricta. La interfaz explicará esa diferencia; no prometerá que ambos algoritmos son equivalentes. El descuento actual al entregar es por rollos e ítem, se limita al stock disponible y no descuenta por cada entrega parcial. Las pruebas preservarán esta semántica; cambiarla requerirá una decisión de negocio para el proyecto nuevo.

Estos límites pueden ampliarse por indicación del usuario, dentro del proyecto nuevo.

## Datos y entrega local

Inicio con base independiente, primera cuenta propia y opción de semilla demostrativa explícita, claramente identificada. No se insertarán demostraciones en ninguna base original. No se configurarán remotos ni se inicializará Git.

Se entregarán instrucciones y comandos reproducibles para iniciar frontend/backend nuevos, configurar la primera cuenta, compilar, limpiar solo demostraciones y localizar la base y adjuntos propios. La página local prevista será `http://localhost:3000`.

El servidor que se deje abierto para revisar será exclusivamente el del proyecto nuevo, con sus puertos y archivos identificados.

## Orden de implementación

1. Aislamiento del nuevo backend, configuración de rutas y almacenamiento; cliente API tipado y sesión.
2. Navegación con la interfaz entregada; monitor y gestión de pedidos real.
3. Kanban, ítems, entregas, facturación, pre-acabados y Gantt.
4. Inventario, scanner, catálogo, clientes y usuarios/permisos.
5. Calculadora, MRP de lote, reportes y documentos.
6. Estados de error y vacío, comportamiento móvil, temas y guía de uso; validación local y comparación de la huella del proyecto original.

## Criterios de aceptación

- El proyecto nuevo se instala, compila y arranca desde su propia carpeta.
- Un pedido creado desde la nueva interfaz persiste y se consulta en Monitor/Pedidos/Producción de la base nueva.
- Ítems, faltantes, parciales, máquinas, movimientos, catálogo, clientes y permisos operan contra esa misma instalación.
- Acceso denegado y revocaciones se aplican también en el servidor; la interfaz no depende de un rol inventado en localStorage.
- Descargas PDF/Excel y adjuntos funcionan a través del origen del nuevo frontend.
- Los módulos presentes tienen acciones reales o un estado pendiente explícito; no se presentan tarjetas de ejemplo como datos de planta.
- Se conservan el lenguaje visual entregado y los temas claro/oscuro, con acceso usable desde móvil.
- El proyecto principal, su base, adjuntos, dependencias y Git permanecen sin escrituras realizadas por este trabajo.

## Decisiones aprobadas

El usuario aprobó Next.js + una copia independiente de Flask, datos nuevos en lugar de copiar la base de la planta, y paridad con las funciones ya operativas. AQL formal, compras y Zebra quedan documentados para una ampliación.
