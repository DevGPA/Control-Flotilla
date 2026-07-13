# Export "Solicitudes (Excel)" — réplica del layout de MoreApp

**Fecha:** 2026-07-13 · **Aprobado por:** Navares

## Problema

Tesorería dispersa combustible a partir del export "Submissions" de MoreApp
("CARGA DE GASOLINA \<fecha\>.xlsx"). Con la migración a Operaciones-GPA ese export ya
no cubre Monterrey/Cedis (piloto OPS), mientras que la app SÍ tiene todos los
registros (MoreApp + OPS). Se necesita descargar desde la app un archivo con la
MISMA estructura para no romper el flujo de curaduría manual de Tesorería.

## Alcance

- Una fila por **solicitud** (tipo `solicitud`; las cargas no entran) del **filtro
  activo** del módulo Combustible, excluyendo anuladas — mismo contrato que el
  layout Toka.
- Incluye registros MoreApp y OPS. Orden: fecha/hora ascendente (empate: eventoId).
- Botón nuevo "Solicitudes (Excel)" junto a "Layout Toka".

## Estructura del archivo

- Hoja `Submissions`, 30 columnas con los encabezados EXACTOS del export de MoreApp
  (ver `SOLICITUDES_HEADER` en `src/fuel/solicitudesLayout.ts`).
- **Números editables** (no texto): `Monto a cargar ($)`, `precio`,
  `Precio estimado x litros`, `Maximo litros a cargar`, `Necesidad`, `Kilometraje`.
- **Fechas reales de Excel**: `On` (cierre del formulario) y `Fecha y Hora`.
- Celdas vacías cuando el dato no existe en la nube: `By`, `Summary`,
  `Location - Latitude/Longitude`, `Nombre del Solicitante - id`;
  `Nombre del Solicitante - MAIL` solo disponible en registros OPS.
- `Serial Number`: número para folios MoreApp ("12292" → 12292), texto para OPS
  (`OPS-…`).
- `# Economico - RESPONSABLE`: el **área** del catálogo de Unidades (equivalente
  funcional de LOGISTICA/ALMACEN), en mayúsculas.
- Fotos y firma: nombre de archivo interno de la app (no el UUID de MoreApp).
- Nombre del archivo: `solicitudes_gasolina_YYYY-MM-DD.xlsx` (fecha de descarga).

## Componentes

1. **`src/fuel/mapEntry.ts` + `types.ts`**: exponer campos que ya están en `datos`
   pero no se mapean: `observaciones`, `precioCatalogo` (número), `necesidad`
   (número 0–1), `emailNotificar`, `mailSolicitante` (OPS `datos.mail`).
2. **`src/fuel/solicitudesLayout.ts`** (módulo puro, sin DOM/xlsx): header + filas
   como AoA con `Date` para fechas. Testeable con vitest (fixtures MoreApp y OPS).
3. **`src/fuel/wire.ts`**: handler del botón — `ctx.filtered` → módulo puro →
   `XLSX.utils.aoa_to_sheet(..., {cellDates:true})` → descarga; aviso resumen
   "N solicitudes exportadas · sucursal filtrada: X" (guardia contra exports
   accidentalmente filtrados, como el incidente Toka de hoy).
4. **`Control de flotilla.html`**: botón `fuel-export-solicitudes` junto a
   `fuel-export-toka` (sin scripts inline nuevos → no requiere csp:sync).

## Errores y avisos

- 0 solicitudes en el filtro → notify warn, no se genera archivo.
- Si el filtro de sucursal está activo, el aviso lo dice explícitamente.

## v2 — Formato profesional (mismo día, pedido del usuario)

El archivo pasa a 2 hojas, renderizadas con **ExcelJS** (chunk on-demand; xlsx CE no
escribe estilos — Toka sigue en xlsx):

1. **"Solicitudes"** (hoja de trabajo): título "Solicitudes de Combustible · GPA" +
   línea de contexto (fecha export, conteo, total, rango, sucursal del filtro);
   17 columnas legibles (Folio, Fecha y hora, Sucursal, Económico, Placas, Submarca,
   Área, Combustible, Niveles, Necesidad %, Precio $/L, Máx. litros, **Monto a
   cargar $**, Observaciones, Solicitante, **Fuente MoreApp/Operaciones-GPA** para
   cazar duplicados del piloto); encabezado teal congelado con autofiltro, zebra,
   formatos `$#,##0`/`%`/fecha y **fila TOTAL con fórmula SUM viva** (curar montos a
0 recalcula solo). Módulos: `buildSolicitudesVista` (puro, en solicitudesLayout)
   - `src/fuel/solicitudesExcel.ts` (render + descarga).
2. **"Submissions"**: la réplica exacta de 30 columnas (compatibilidad total).

Gotcha documentado: ExcelJS serializa fechas por valor UTC (xlsx corrige a local);
`utcWallClock()` re-crea el instante con los componentes locales para que Excel
muestre la hora de la sucursal.

## Pruebas

- Golden del encabezado (30 strings exactos).
- Fixture MoreApp: mapeo completo de fila, números como número, fechas como Date.
- Fixture OPS: Serial texto `OPS-…`, MAIL poblado, campos MoreApp-only vacíos.
- Exclusión de cargas y anuladas; orden por fechaHora.
- mapEntry: nuevos campos desde `datos` (incl. variantes "$26.63" → 26.63).
