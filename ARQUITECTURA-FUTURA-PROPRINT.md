# Arquitectura futura de PROPRINT

> Actualización 2026-10-24: este documento se conserva como referencia de la maqueta recibida. El backend independiente, pedidos, usuarios, catálogo, clientes, inventario, planificación y reportes ya fueron conectados en esta entrega. El estado vigente y sus límites están en `README.md` y `docs/estado-migracion.md`. Zebra, AQL formal y Compras continúan pendientes.

## Objetivo
Este documento deja una ruta de crecimiento para convertir el frontend actual en una plataforma operativa conectada a producción, clientes, usuarios e impresión industrial.

## 1. Impresión Zebra

Crear un módulo de etiquetas accesible desde Pedidos y Configuración:

- Plantillas ZPL versionadas por tipo de etiqueta.
- Vista previa antes de imprimir.
- Selección de impresora Zebra, ancho de etiqueta y densidad.
- Cola de impresión con estados: pendiente, enviada, impresa y error.
- Reimpresión controlada con registro de usuario, fecha y pedido.
- Endpoint servidor para enviar ZPL de forma segura; nunca exponer credenciales en el navegador.

Flujo recomendado: seleccionar pedido → elegir plantilla → previsualizar → seleccionar impresora → imprimir → guardar auditoría.

## 2. Configuración de bases de datos

La pantalla de Configuración debe crecer con tres conexiones separadas:

### Base de datos de producción
- Pedidos, máquinas, turnos, operaciones y consumos.
- Pruebas de conexión y estado de sincronización.
- Lectura/escritura con permisos por rol.

### Base de datos de clientes
- Empresas, contactos, direcciones y condiciones comerciales.
- Asociación entre cliente y pedido.
- Validación de datos y control de duplicados.

### Base de datos de usuarios
- Usuarios, roles, permisos y sesiones.
- Alta, baja, bloqueo y restablecimiento de acceso.
- Registro de auditoría para cambios sensibles.

Las cadenas de conexión y secretos deben vivir únicamente en variables de entorno del servidor. La interfaz debe mostrar solo nombres, estado y fecha de última sincronización.

## 3. Administración de usuarios

Roles iniciales sugeridos:

- **Administrador:** configuración, usuarios y auditoría.
- **Planificador:** Gantt, pedidos y prioridades.
- **Producción:** ejecución, pausas y consumos.
- **Calidad:** incidencias y liberaciones.
- **Consulta:** lectura sin modificaciones.

Añadir después invitaciones, autenticación robusta, permisos por planta y exportación de auditoría.

## 4. Evolución técnica del frontend

1. Separar cada vista en componentes y rutas propias.
2. Sustituir datos de demostración por APIs tipadas.
3. Incorporar validación de formularios y estados de carga/error.
4. Usar una capa de datos con caché y actualización en tiempo real.
5. Añadir pruebas de componentes y pruebas de flujos críticos.
6. Mantener accesibilidad, modo claro/oscuro y diseño responsive.

## 5. Próximos entregables

- API de pedidos y producción.
- Persistencia del Gantt con reservas de máquina.
- Integración Zebra en entorno de pruebas.
- Pantalla de conexiones de Configuración.
- Gestión de usuarios con roles.
- Auditoría, métricas y monitoreo.
