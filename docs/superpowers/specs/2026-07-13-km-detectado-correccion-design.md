# Corrección de odómetro desde la foto (kmDetectado) + ancla resistente

**Fecha:** 2026-07-13 · **Aprobado por:** Navares (Opción A del análisis del caso eco 86)

## Problema

Una captura mala de odómetro (eco 86 hoy: 1,682 en vez de ~16,8xx) anula el km/l de
esa carga Y contamina la siguiente (el odómetro malo se vuelve ancla →
"salto improbable"). El campo `ValidacionCarga.kmDetectado` existe y se muestra en el
drawer, pero ni se puede capturar ni influye en el km/l. El re-registro del chofer es
lento/incierto y genera duplicados.

## Diseño

1. **Motor (`computeFuelMetrics`)** — km EFECTIVO = `review.kmDetectado ?? km`
   (finito y > 0). Aplica en: agrupación de llenado partido, distancia/ancla, y la
   regla de unidad "odómetro no fiable" (PASO 2A). El dato crudo del chofer NUNCA se
   modifica (overlay auditable, mismo principio que la anulación).
2. **Ancla resistente** — un RETROCESO no promueve su odómetro como ancla: se
   conserva la última fiable y la lectura rechazada queda "pendiente".
   - Typo (86): la siguiente carga mide contra la ancla buena → solo se pierde 1
     intervalo, no 2 (aun sin corrección humana).
   - Reset real de tablero: si la siguiente lectura es coherente con la pendiente
     (delta en (0, MAX_KM_JUMP]) y sigue en retroceso vs la ancla vieja, se adopta el
     nuevo tren: km/l medido contra la pendiente (con su estado tanque-lleno).
   - La pendiente se limpia cuando un intervalo vuelve a medir plausible vs la ancla.
   - La alerta "Odómetro retrocede" NO cambia: `kmDesdeAnterior` sigue mostrando el
     delta negativo del registro crudo (el chip es la señal para ir a corregir).
3. **Captura (drawer de validación)** — input numérico "Odómetro real (según foto)"
   en el slot de odómetro, solo con permiso de escritura. Guardar/limpiar persiste
   `kmDetectado` (+ `fuenteDeteccion:"manual"`, revisadoPor, ts) vía
   `upsertValidacionCarga`; update optimista con rollback como handleValidate.
   ⚠️ La mutación es in-situ sobre `load.review` ⇒ `bumpFuelDatasetVersion()` antes de
   re-render (el memo de métricas ahora depende de kmDetectado).
4. **API (`client.ts`)** — `ValidacionCargaInput` += `kmDetectado?: number | null`,
   `fuenteDeteccion?: string` (el modelo AppSync ya tiene los campos, Fase E).

Fase E (visión IA) queda como siguiente paso: pre-llenará kmDetectado con confianza;
auto-aplicar solo con confianza alta — fuera del alcance de este cambio.

## Pruebas (TDD, fuelAnalysis puro)

- Corrección: kmDetectado restaura el km/l del registro corregido Y ancla la
  siguiente carga en el valor corregido.
- Typo sin corrección: retroceso conserva ancla → la siguiente carga tiene km/l
  contra la ancla buena (hoy salía "salto improbable").
- Reset real: 2ª lectura coherente con la pendiente → km/l contra la pendiente y el
  tren nuevo queda de ancla.
- La pendiente se limpia tras un intervalo plausible (no "revive" con un typo
  posterior parecido).
- El chip de retroceso (kmDesdeAnterior negativo) se conserva en el registro malo
  sin corregir.
