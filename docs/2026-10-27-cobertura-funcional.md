# SGP nueva interfaz: funciones y revisión integral

Fecha: 27 de octubre de 2026.

## Criterio de trabajo

Se contrastaron las pantallas, acciones y contratos del SGP original con la nueva interfaz. El Baúl aportó contexto histórico; cuando una nota difería del código actual, se siguió la función implementada. El original se consultó solo en lectura.

La interfaz conserva Next.js, backend Flask y SQLite independientes. La cuenta, los pedidos y los adjuntos de la instalación del usuario se conservan. Las pruebas usan cuentas, archivos y base descartables en otra carpeta.

## Qué hace cada área

| Área | Funciones disponibles y cómo se usan |
|---|---|
| Acceso | Iniciar/cerrar sesión; primera cuenta explícita; permisos por módulo y nivel. Un cambio de cuenta descarta el espacio y los borradores de la anterior. |
| Monitor | Tablero por estado, indicadores de planta, búsqueda por cliente, reloj Ecuador con color guardado, cuenta regresiva y pantalla completa. Retiros en Fábrica tiene su vista separada. |
| Pedidos | Crear, revisar, guardar, buscar, filtrar, paginar, editar y eliminar. Ítems múltiples con filas automáticas, catálogo por cliente, escáner, PDF/foto con revisión manual y cliente rápido. IDs y revisiones conservan el historial. |
| Detalle | Progreso y círculo pequeño, ítems, observaciones, fechas, referencias de producto, PDF del pedido, factura y último motivo de retroceso disponible. Los documentos secundarios se despliegan al necesitarlos. |
| Producción | Los ítems se abren dentro de la tarjeta. En Cola ofrece Iniciar; Procesando permite estados individuales, suspensión, parciales y faltantes; Por entregar queda en consulta. Un aviso en línea permite terminar al alcanzar el 100 %. |
| Parciales | Activar/desactivar sin borrar historial, registrar cantidades, consultar y eliminar entregas. Las salidas parciales no descuentan bodega. Las confirmaciones de esta interfaz llevan precondiciones para rechazar cambios concurrentes. |
| Pre-acabados | Reportar faltantes en etiquetas/planchas, causas frecuentes, pendientes/resueltos, búsqueda, reposición, corrección y eliminación con confirmación. La corrección conserva el reemplazo si falla la limpieza del reporte anterior. |
| Planificador | Agenda compacta por M1/M2/Mesp. Pendientes visibles y asignación al siguiente espacio libre; fecha/duración manuales opcionales. Organizar cola mantiene las restricciones y reservas en proceso. Cronograma secundario por día y arrastre entre máquinas compatibles. |
| Inventario | Búsqueda, categorías, SKU, ficha técnica, altas, edición y bajas; suma al SKU existente; estados y niveles de stock; indicador de movimientos de siete días dentro del historial disponible; Excel y recuperación de conflictos de saldo. |
| Operaciones | Entrada/salida por escaneo rápido o cantidad manual, observación, confirmación del resultado e historial con unidades. Un error de escaneo permite continuar con el siguiente código. |
| Configuración → Productos | Catálogo, clientes sugeridos/texto libre, rendimientos, dimensiones, material, maquinaria y referencia imagen/PDF. Borradores y guardado/eliminación por lote conservan las filas que fallan. |
| Configuración → Clientes | Identificación, facturación/entrega, contacto, horarios/plazos y logo. Continúa dentro de Configuración; el enlace anterior sigue abriendo esa sección. |
| Configuración → Usuarios | Cuentas, roles, permisos, contraseñas opcionales de edición, borradores y operaciones por lote. La cuenta propia queda protegida y las operaciones se vinculan a la identidad que las inició. |
| Configuración → Datos | Salud de la instalación e importación/exportación de inventario. Elegir o arrastrar Excel prepara el archivo; importar requiere confirmar su suma de stock. |
| Calculadora | Buscar por cliente/código/producto, preseleccionar por enlace, incrementos rápidos y consumo individual. Muestra planchas, rollos, metros, superficie y empaque; fórmulas y detalle quedan plegados. Descarga PDF del cálculo consultado. |
| Reportes | Stock por intervalo de movimientos, pedidos por filtros y consumo MRP por lote. CSV/impresión de stock, PDF de pedidos, Excel completo y PDF de consumo por lote. Exportar utiliza los filtros o revisión del cálculo aplicado. |

## Reglas conservadas

- Flujo: En Cola → Procesando → Terminado → Facturado → Entregado. Facturado también admite Retiro en Fábrica antes de Entregado.
- Parciales no descuentan inventario; la entrega completa aplica el descuento histórico por ítem, limitado al stock. Edición/eliminación revierte los movimientos realmente vinculados.
- Consumo y MRP comparten cálculo estricto, unidades y fracciones. Los datos ausentes se señalan; no se inventa disponibilidad cuando los rollos son incompatibles.
- El PDF de consumo se reconstruye y contrasta con la revisión consultada. Cambios de catálogo, pedidos o stock exigen recalcular.
- Planificar no descuenta material. Los conflictos de máquina, fechas y restricciones se validan antes de guardar.
- Los permisos se aplican en servidor, además de los controles visuales. Las precondiciones nuevas de ítem son opcionales para conservar compatibilidad con el contrato original.

## Comprobaciones y evidencia

Se contrastaron las 55 rutas de negocio originales y las dos descargas de consumo añadidas a esta interfaz, además de acceso/sesiones y permisos. Resultado nuevo de esta revisión:

- **227 pruebas de backend aprobadas**; 15 avisos de API antigua de SQLAlchemy, sin fallos.
- **103 pruebas de cliente/dominio aprobadas**, incluidas regresiones de pedidos, gestión, consumo y reportes.
- **18 pruebas Playwright aprobadas**: nueve de permisos/sesión/concurrencia/enlaces, cuatro de planificación y cinco de interfaz. Se revisaron escritorio y móvil a 360/390 px, temas claro/oscuro, menú, cierre flotante y cambio de tamaño.
- **Recorrido completo de 18 comprobaciones aprobado**, desde captura hasta parcial/faltante, planificación, bodega, consumo, factura y entrega. Sin errores JavaScript.
- Compilación de producción y TypeScript aprobados tanto en la instalación descartable como desde la carpeta definitiva. Se repitieron allí las 227 pruebas backend y las 103 de cliente, también sin fallos.
- PDFs descargados de la aplicación: consumo individual (2 páginas), lote (3), reporte de pedidos (2) y pedido (1). Todas sus páginas se renderizaron y revisaron visualmente; no se encontraron textos cortados ni superpuestos. El ejemplo de 100 etiquetas produjo 10 planchas, 1 rollo, 10 m y 15 m², coherentes con el catálogo de prueba.
- Revisión independiente final sin hallazgos importantes pendientes en las correcciones de concurrencia, identidad y referencias.

La base del usuario se verificó antes de integrar: integridad correcta, 1 cuenta, 19 pedidos, 25 ítems, 12 materiales, 32 movimientos, 7 clientes y 14 productos. Se guardó una copia previa propia en `backend/instance/backups/antes-revision-integral-20261027T130904.sqlite3`. No se incluyen cuentas, bases ni archivos descartables en la entrega. Tras arrancar, la base activa y su clave de sesiones conservan los mismos bytes; los 201 archivos del principal conservan sus hashes. Servicio final verificado en `http://localhost:3000`, API5101: acceso existente, protección de pedidos sin sesión y cero errores JavaScript.

Los informes de cada área detallan fuente, caso reproducido y corrección:

- `auditoria-pedidos-20261027.md`
- `auditoria-gestion-20261027.md`
- `auditoria-reportes-20261027.md`
- `auditoria-backend-20261027.md`

## Límites comprobables

- AQL formal, Compras y Zebra no tienen funciones implementadas en las rutas del original revisado; siguen como ampliaciones.
- OCR depende de Tesseract. Red de planta, teléfono físico, impresoras e impresión industrial requieren revisión en esos equipos; no se simulan como conectados.
- El historial de movimientos del contrato original devuelve hasta 50 registros. El indicador de siete días informa ese límite; no promete contar registros anteriores que la API no devuelve.
- Excel conserva el contrato de inventario original; no sustituye una copia íntegra de la base y sus adjuntos.
- Las pruebas describen escenarios ejecutados; no garantizan ausencia de errores para todas las combinaciones posibles de datos externos.
