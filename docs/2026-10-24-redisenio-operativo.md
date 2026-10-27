# Rediseño operativo — 24 de octubre de 2026

## Petición

Cambiar realmente la tipografía de todas las pantallas y ventanas; mejorar espacios, botones y bordes; reducir texto; destacar las opciones de Nuevo pedido; confirmaciones propias; Producción desplegable como el SGP original; consumos y PDF completos; Clientes dentro de Configuración; contadores rojos y uso cómodo en celular.

## Decisiones de implementación

- Geist Sans local en CSS, con archivos y licencia dentro de `public/fonts`; no depende de Google Fonts al abrir la aplicación. Una familia para navegación, controles, fechas y diálogos. Se mantienen índigo, fondo claro y tema oscuro del diseño entregado.
- Acciones con separación uniforme, controles táctiles de al menos 44 px en móvil y bordes con mayor contraste. Formulario de una columna en pantallas pequeñas; tablas desplazables dentro de su contenedor.
- `confirmAction` es asíncrono y usa una ventana propia con Cancelar/Confirmar, cola y foco de teclado. Todas las llamadas nativas se sustituyen; cancelar nunca ejecuta el cambio.
- Producción conserva el tablero y expande el detalle dentro de la tarjeta. Los otros módulos pueden seguir usando sus ventanas de edición. Las acciones por ítem se abren cuando se necesitan.
- Importar documento y Escáner se presentan como controles visibles con icono y borde. La lectura de PDF/foto sirve para completar un pedido; no equivale a adjuntar una factura.
- Clientes queda en una pestaña de Configuración. Se conserva el acceso de enlaces anteriores a `/clientes`, abriendo esa pestaña.
- Contadores en un único endpoint, filtrados por los permisos de la cuenta. Pedidos/Monitor/Producción: activos, incluidos retiros como el original; Gantt: cola sin planificar; Pre-acabados: faltantes pendientes; Inventario: críticos/agotados; Operaciones: movimientos del día; Calculadora: productos; Reportes: pedidos activos; Configuración: productos por completar. Los ceros no se muestran y la etiqueta explica qué representa cada cifra.
- Cálculo y PDF comparten las fórmulas de consumo y validan los datos requeridos. Un resultado no reserva ni descuenta inventario; la regla de entrega real se conserva.

## Límites

El SGP principal se consulta únicamente como referencia de desplegables y contadores. Todos los cambios se integran en `Desktop/nueva interfaz/erp-manufacturing-dashboard`; su base `sgp-nueva.sqlite3`, cuentas y ejemplos se conservan. No se inicializa Git ni se despliega al servidor de la planta.

## Comprobaciones de entrega

- Compilación final Next.js y revisión de tipos completadas con salida correcta desde la carpeta definitiva. Sintaxis de 10 archivos Python revisada sin importar ni ejecutar el proyecto original.
- Revisión visual en el navegador: tipografía, bordes por estado, contadores con valores reales y detalle de Producción dentro de la tarjeta. Confirmación propia abierta y cancelada, sin cambiar el pedido.
- Vista adaptable a 390 px: Producción en una columna y Nuevo pedido con controles de importación/escáner destacados, sin recorte horizontal visible en esas pantallas.
- Revisión estática independiente: corregidos contadores antiguos tras cambio de permisos, nombres accesibles del menú colapsado, importación de líneas repetidas y bloqueo de acciones que persiste al desmontar el pedido.
- Consumos: corregidos stock falsamente suficiente con longitudes de rollo incompatibles y desbordes de enteros seguros al sumar grupos/materiales. La disponibilidad queda desconocida ante incompatibilidad; el PDF y el JSON rechazan totales fuera de rango.
- El PDF se revisó en código; no se generó ni renderizó una muestra en esta ronda. No se ejecutaron pruebas automatizadas ni se contrastaron los rendimientos ficticios contra un Excel real de planta.
- El SGP original conserva el mismo agregado SHA-256 de 201 archivos: `d8886c49d87cfae5213af21976f8b8caf04e4608f28e55b8562927dd7e98c711`. Base y cuenta actuales del proyecto nuevo preservadas, con copia previa en `backend/instance/backups`.
- Servicio compilado nuevamente disponible en `http://localhost:3000`; API propia en 5101.
