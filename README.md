# Mis Finanzas

App web personal para registrar ingresos, gastos, ahorro e inversiones mes a mes, con conexión a una base de datos SQLite para guardar los datos de forma persistente.

## Requisitos

- Node.js 18 o superior
- npm

## Instalación

1. Abre la carpeta del proyecto.
2. Ejecuta:
   ```bash
   npm install
   ```
3. Inicia el servidor:
   ```bash
   npm start
   ```
4. Abre en el navegador:
   ```text
   http://localhost:3000
   ```

## Base de datos

La app crea automáticamente una base de datos SQLite en la carpeta `data/finanzas.db` con estas tablas:

- `config`: guarda la moneda y el presupuesto de deuda.
- `movimientos`: guarda ingresos, gastos, ahorro e inversiones.
- `tarjetas`: guarda las tarjetas y deudas para planificar pagos.

## Qué incluye

- **Resumen del mes:** ingresos, gastos fijos, gastos variables, ahorro + inversión, dinero disponible y ahorro acumulado. También muestra los gastos por categoría, la comparación con la regla 50/30/20 y cuánto más o menos gastaste que el mes anterior.
- **Movimientos:** registro de ingresos, gastos fijos, gastos variables, ahorro e inversión. Los que marques como "se repite" se copian al mes siguiente con un botón.
- **Mes a mes:** gráfico de los últimos 12 meses y una tabla comparativa con el % de ahorro y la variación del gasto.
- **Tarjetas y deudas:** compara la **bola de nieve** (primero el menor saldo), la **avalancha** (primero la mayor tasa) y el pago de solo mínimos. Te recomienda una estrategia y te dice cuánto pagar a cada tarjeta este mes.

## Copia de seguridad

La app sigue teniendo la opción de exportar e importar un respaldo JSON, pero los datos principales se almacenan en SQLite para una persistencia real.
