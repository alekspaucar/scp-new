# Registro — plan: 2026-10-24-plan-implementacion.md

Diseño aprobado por el usuario. Original exclusivamente de lectura; sin Git nuevo.

## Cruces de tareas

| Productor | Consumidor | Contrato revisado |
|---|---|---|
| Backend | Cliente | API relativa, cookies con nombre propio y errores JSON |
| Cliente/sesión | Todas las vistas | api/jsonRequest/upload/download/useResource/useSession |
| Pedidos | Producción/Monitor | OrderEditor y OrderDetail; IDs de ítem conservados |
| Gestión | Pedidos/MRP | Cliente+código/descripcion, unidades y dimensiones actuales |
| Diseño/CSS | Todas las vistas | Paneles originales y componentes compartidos accesibles |

Comprobación de consistencia: cada tarea tiene conjunto de archivos y resultados propios; la integración y comprobaciones finales dependen de todas.

## Decisiones

- Construcción temporal en carpeta propia de /private/tmp antes de copiar la entrega, porque la carpeta solicitada está fuera del área de escritura habilitada. La copia final requiere la autorización de archivos que ya aprobó el usuario; no amplía el alcance.
- No se usan scripts de skill que requieran crear un repositorio o escribir en el principal.

## Integración y revisión

- Tareas 1–5 implementadas y revisadas por archivos; instalación y tipos de frontend comprobados.
- Pruebas previas de dominio: 4 fallos funcionales observados antes de implementar permisos, fechas y progreso; luego 4/4 pasan. Dos pruebas HTTP completan 6/6.
- Revisión independiente: siete hallazgos importantes. Corregidos en esta instalación: identidad de sesiones, revisión optimista de pedido/material, creación atómica de cuenta/permisos, permisos delegados de catálogo/clientes, generación de sesión y MIME inline de facturas.
- La regresión de código de ítem detectó la etiqueta contaminada por el datalist y un escaneo pendiente descartable; se añadieron etiquetas inequívocas y bloqueo antes de revisar.
- Una regresión adicional de Calculadora encontró cliente nulo al ordenar el catálogo; se conserva como opción Sin cliente asignado y ya pasa.
- Cinco pruebas de regresión de navegador pasan con API de pruebas propia. El recorrido completo también pasa, sin errores JS; capturas revisadas.
- Decisión: incorporar protección de concurrencia y sesiones exclusivamente en la copia, porque los casos reproducidos podían perder historial o conceder acceso. No cambiar las reglas acordadas de consumo, AQL o maquinaria.
- Tarea 6 completa: entrega copiada sin bases/cuentas/adjuntos de pruebas; entorno Python recreado y dependencias npm instaladas en destino. 99/99 pruebas backend y 7/7 pruebas Node pasan allí; tipos/build aprobados y dependencias Python consistentes.
- Protección adicional verificada RED→GREEN: el proxy también rechaza el puerto anterior escrito con ceros iniciales.
- Servicio compilado arrancado desde destino en 3000/5101. Huella del original idéntica (201 archivos, d8886c49d87cfae5213af21976f8b8caf04e4608f28e55b8562927dd7e98c711).
- Las instancias de integración 3001/5102 se apagaron. Los datos de pruebas permanecen únicamente en el montaje temporal; la instalación entregada conserva pendiente la elección del primer usuario.
