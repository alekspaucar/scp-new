# Estado de migración — SGP nueva interfaz

## Estado actual — 2026-10-27

Revisión integral de funciones y contratos completada; ver `2026-10-27-cobertura-funcional.md` y las cuatro matrices `auditoria-*-20261027.md`. Se completaron diferencias de captura/referencias, gestión por lote, permisos, enlaces y consumos/reportes. Planificador más compacto, asignación al siguiente hueco y cronología diaria acotada. Las confirmaciones de ítem rechazan revisiones antiguas; cambiar de cuenta descarta borradores y detiene continuaciones pendientes.

Evidencia nueva: **227 pruebas backend, 103 de cliente, 18 Playwright y recorrido de 18 comprobaciones aprobados**, sin errores JavaScript. Compilación/tipos y revisión visual de los cuatro PDFs y de escritorio/móvil aprobadas. Las 15 advertencias SQLAlchemy son de uso de API antigua. Datos reales nuevos y clave de sesiones conservados byte por byte; copia previa propia antes de integrar. Los 201 archivos del principal siguen intactos. Servicio propio iniciado y comprobado en localhost:3000/API5101 con la cuenta existente, sin mutaciones de verificación sobre sus datos. AQL formal, Compras, Zebra y validación física siguen pendientes.

## Historial de la entrega inicial — 2026-10-24

Las cifras y el estado de primera cuenta descritos a continuación corresponden a esa fecha; no sustituyen la revisión actual. Diseño aprobado por el usuario en este chat.

## Cobertura

Se implementaron las pantallas operativas de monitor, pedidos, producción, pre-acabados, Gantt, inventario, operaciones, calculadora, reportes, catálogo, clientes y usuarios. Los servicios HTTP utilizan el backend Flask independiente; no se conservan arrays de pedidos o máquinas ficticias de la maqueta como fuente de datos.

La identidad visual de la referencia se conservó y se extendió para formularios, tablas, confirmaciones, errores, vacíos, móvil y temas. La configuración muestra una base de datos real compartida por módulos, en lugar de simular tres conexiones.

## Diferencias resueltas contra las notas

| Tema | Criterio aplicado |
|---|---|
| Usuarios y permisos | Código de octubre: siete secciones y niveles ninguno/ver/editar; admin/jefe administran usuarios |
| Estados | Seis estados actuales, con Facturado y Retiro en Fábrica |
| Planificación | Tres máquinas reales y operación continua, no cuatro líneas de ejemplo ni jornada histórica fija |
| Tintas | Unidad de la API actual: unidades; no convertir automáticamente a ml |
| MRP | Endpoint individual actual y lote estricto; se explican diferencias y datos faltantes |
| AQL/Zebra/Compras | Pendientes explícitos, conforme al alcance aprobado |

## Almacenamiento y entrega

Código principal utilizado solo como referencia. La entrega excluye la base, adjuntos, cuentas, secretos y entorno Python del proyecto original. El montaje temporal de integración usa bases de pruebas propias que no forman parte de la instalación final.

La primera cuenta de la instalación final se elige en la pantalla de acceso. La carga de demostración es un comando explícito. No se creó ni modificó un repositorio Git para el nuevo proyecto.

## Comprobaciones

La revisión independiente identificó y se corrigieron conflictos de edición, reutilización de IDs de cuentas, permisos de edición de datos maestros, respuestas de sesión antiguas y MIME de facturas. Hay pruebas de regresión que reproducen esas condiciones antes de la corrección.

El recorrido del navegador pasó con la API y una base independiente de pruebas: acceso inicial/login, pedido persistido, bloqueo de escaneo pendiente, parciales, faltante y reposición, reserva Gantt y regreso sin perder historial, scanner y movimientos, calculadora, MRP por lote e invalidación al cambiar selección, exportación con filtros consultados, factura PDF, entrega y descuento de stock, Excel, permisos de consulta y revocación. No hubo errores de JavaScript. Se revisaron capturas de escritorio y móvil, en claro y oscuro.

Cinco regresiones de navegador pasan: respuestas antiguas no deshacen login/logout; edición de Configuración delegada funciona sin conceder Usuarios; productos sin cliente no rompen Calculadora; un movimiento concurrente no se pierde al editar proveedor; un borrador viejo no elimina ítems e historial nuevos. Las pruebas de backend incluyen versiones y escrituras atómicas de permisos.

Validación desde la carpeta entregada: **99 pruebas de backend aprobadas**, **7 pruebas de cliente/dominio/proxy aprobadas**, comprobación de tipos y compilación Next.js aprobadas. Las cinco regresiones del navegador y el recorrido completo se ejecutaron contra la base de pruebas del montaje independiente. El backend emite 12 avisos de uso de una API antigua de SQLAlchemy; no hay fallos de pruebas. `pip check` no detecta dependencias rotas.

La aplicación compilada se inicia desde `/Users/erickvzh/Desktop/nueva interfaz/erp-manufacturing-dashboard` en `http://localhost:3000`, con su API propia en `127.0.0.1:5101`. La primera cuenta está pendiente de ser elegida por el dueño. La entrega excluye todas las cuentas, bases y adjuntos de verificación; no se creó Git.

La huella del proyecto principal coincide antes y después: **201 archivos**, SHA-256 agregado `d8886c49d87cfae5213af21976f8b8caf04e4608f28e55b8562927dd7e98c711`. Se incluyen código, documentación, build y base; se excluyen `.git`, dependencias y cachés. No se realizaron escrituras ni se ejecutaron servicios, imports o compilaciones dentro del principal.

## Ampliaciones pendientes

- AQL formal y certificado, tras validar la matriz completa y sus criterios.
- Zebra/ZPL con impresora y plantillas reales.
- Compras y sus reglas de aprobación.
- OCR con Tesseract y comprobación de impresoras físicas en el equipo de planta.

## Relacionado

Diseño aprobado, plan de implementación y README en este proyecto; referencias de origen: [[SGP_Proprint]], [[SGP_Proprint/fase2-planificacion-preacabados]], [[SGP_Proprint/calidad-aql]].
