# Revisión integral de SGP nueva interfaz

**Objetivo:** contrastar todas las funciones que existen en el SGP actual, completar diferencias en la nueva interfaz y comprobar los flujos con almacenamiento de pruebas independiente.

**Arquitectura:** conservar Next.js/React, Flask y SQLite propios. Usar el original exclusivamente en lectura y el Baúl como referencia histórica; el código actual decide qué funciones están implementadas. Conservar las preferencias de Geist local, confirmaciones propias, Clientes en Configuración, controles por ítem solo en Procesando y Producción desplegable.

## Límites

- Original: `/Users/erickvzh/Desktop/SGP/sgp_docs_completo`, sin escrituras ni ejecución.
- Entrega: `/Users/erickvzh/Desktop/nueva interfaz/erp-manufacturing-dashboard`, conservando cuenta, base y adjuntos.
- Construcción y pruebas: `/private/tmp/sgp-completo-20261027`, puertos 3001/5102, base y credenciales descartables. No usar sesiones ni datos reales para mutaciones de verificación.
- Sin crear Git, publicar ni modificar el servidor de planta.
- AQL, Compras y Zebra solo se migran si existen como funciones implementadas en el original; no inventar tablas de normas ni integración física.

## Tareas

- [x] Inventariar rutas, acciones, reglas y contratos originales/nuevos; elaborar matriz de cobertura con evidencia.
- [x] Revisar Pedidos, Monitor, Producción, PDF/factura, estados, parciales, faltantes e historial; corregir regresiones con pruebas.
- [x] Revisar Inventario, Operaciones, Clientes, Catálogo, Usuarios y permisos; completar diferencias y validación de entradas.
- [x] Revisar API, sesiones, concurrencia, almacenamiento, permisos y cálculos; reproducir y corregir fallos concretos sin alterar reglas operativas acordadas.
- [x] Simplificar Planificador: agenda por máquina, acción de asignación clara, detalle progresivo, línea temporal secundaria y móvil; mantener restricciones y conflictos.
- [x] Contrastar Calculadora y Reportes (stock, pedidos, MRP, Excel/CSV/PDF) y completar enlaces/descargas.
- [x] Ejecutar suites backend/cliente, recorridos de navegador y compilación; revisar escritorio, móvil y temas. Registrar límites físicos externos.
- [x] Integrar cambios en destino, reiniciar solo servicio propio, contrastar manifiesto del original y actualizar documentación/Baúl.

## Casos de revisión

- Respuestas de sesión antiguas, permisos revocados y formularios abiertos al cambiar de estado.
- Pedidos con códigos repetidos, filas vacías, escaneo/importación pendientes y cantidades límite.
- Entregas/retrocesos con stock, parciales, faltantes y edición concurrente sin perder historial.
- Rendimiento incompleto, unidades incompatibles y PDF que debe corresponder al cálculo consultado.
- Planificación sin fechas, reservas cruzadas, máquina fija, operación desde celular y carga fallida recuperable.

## Evidencia

Manifiesto de lectura del original: `original-manifest-before.json`, 201 archivos. Las cifras de pruebas de entregas anteriores son históricas; esta revisión registrará resultados nuevos.

Resultados de la revisión: 227 pruebas backend, 103 de cliente y 18 de navegador aprobadas; recorrido completo de 18 comprobaciones sin errores JavaScript. Compilación de la copia de pruebas aprobada. Integración terminada: compilación y tipos de la carpeta definitiva aprobados; 227 pruebas backend y 103 de cliente repetidas allí sin fallos; acceso/API en localhost:3000 verificados sin errores JavaScript. Base nueva y clave de sesión conservadas byte por byte; 201 archivos del principal sin cambios. Baúl actualizado al cierre.
