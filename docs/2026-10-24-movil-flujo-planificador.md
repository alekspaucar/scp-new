# Móvil, flujo de producción y planificador

Solicitud del 2026-10-24: menú móvil legible, progreso circular pequeño, cierre de ventanas siempre accesible, acciones por estado como en SGP y un planificador más breve.

## Interfaz

- Menú móvil opaco en ambos temas, por encima de la sombra. Navegación con desplazamiento propio y controles de al menos 44 px. Se cierra al cambiar de sección, pulsar Escape o volver al ancho de escritorio.
- Las ventanas comparten un botón de cierre circular superpuesto. El contenido se desplaza por dentro; la X permanece en la esquina. Las confirmaciones propias conservan su comportamiento.
- El resumen del pedido muestra un círculo de 26 px junto al porcentaje. Conserva el avance calculado; limita solo la representación visual a 0–100.

## Flujo contrastado con el original

Se consultó, sin modificar, `sgp-frontend/src/app/pages/produccion/produccion.html` del principal. Los controles por ítem están dentro de `p.estado === 'Procesando'`; En Cola muestra Iniciar y Por entregar es informativo.

- Estado, Entrega, Faltante y edición de su historial aparecen únicamente en Procesando y con permiso de edición.
- En Cola conserva los ítems en consulta y la acción Iniciar producción. El historial vacío se oculta.
- Por entregar conserva los ítems en consulta. La facturación y entrega siguen disponibles en sus pantallas correspondientes, sin añadir esos controles al Kanban de Producción.
- Se preservan endpoints, reglas de consumo, permisos, confirmaciones y bloqueo de acciones compartido.

## Planificación

Vista inicial compacta por máquina, con reservas y horarios. La línea de tiempo completa queda plegada; se conservan asignación manual, reprogramación, devolución a cola, autoasignación, restricciones por máquina y validación del servidor.

## Aislamiento

Cambios limitados al frontend nuevo y esta documentación. Sin cambios en la base, cuentas, adjuntos, backend o Git. El principal se consultó únicamente en lectura.

## Comprobaciones realizadas

- Compilación final de Next.js y revisión TypeScript correctas.
- Revisión visual en Brave con ancho emulado de 390 px: menú claro/oscuro opaco y legible, Producción con ítems en consulta en Cola y Por entregar, y agenda del planificador en una columna.
- En escritorio se comprobó el anillo junto a 67 %, la X superpuesta al desplazar un detalle con historial y la agenda de tres máquinas con cronograma plegado. Se restauró el tema oscuro que estaba seleccionado.
- No se añadieron ni ejecutaron pruebas automatizadas ni se guardaron cambios de pedidos, reservas o inventario durante el recorrido visual. No sustituye una revisión en un teléfono físico.
- El agregado de los 201 archivos del principal permanece en `d8886c49d87cfae5213af21976f8b8caf04e4608f28e55b8562927dd7e98c711`.
- Servicio independiente reiniciado: `http://localhost:3000`, API `127.0.0.1:5101`. Estado correspondiente a esta sesión.
