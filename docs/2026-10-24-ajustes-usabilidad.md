# Ajustes de uso — 24 de octubre de 2026

## Solicitud

Control de filas antes de los ítems, sin botón; letra coherente en todo el sistema; aclarar Clientes/Configuración; reducir texto; poblar únicamente la base del proyecto nuevo y ubicarla en su raíz.

## Decisiones

- **Filas** significa el total visible (1–50). Cambiarlo agrega filas vacías o solicita confirmación antes de quitar filas con datos. Vaciar el campo temporalmente no elimina ítems.
- Se conserva Arial/Helvetica de la interfaz entregada. Controles nativos, fechas, códigos y números comparten la misma familia; se quita la letra monoespaciada.
- Clientes pasa a una pantalla propia de contactos y direcciones. Configuración mantiene productos, cuentas y datos.
- Títulos y acciones breves; explicaciones secundarias bajo Ayuda. Conflictos, advertencias de stock/importación y datos incompletos permanecen visibles.
- Una base relacional activa: `sgp-nueva.sqlite3` en la raíz del proyecto nuevo. No se usan archivos del SGP anterior. Se preservó la cuenta ya creada y su clave de sesión.
- Carga ficticia: 18 pedidos, 23 ítems, 12 materiales, 14 productos, 6 clientes, 27 movimientos, 2 parciales y 3 faltantes. No se crearon contraseñas ni cuentas adicionales.

## Alcance de ejecución

Se trabaja en una copia temporal y se integran los archivos exclusivamente en `/Users/erickvzh/Desktop/nueva interfaz/erp-manufacturing-dashboard`. No se inicializa Git. El servicio nuevo se reinicia después de compilar. No se añaden ni ejecutan pruebas automatizadas en este ajuste.
