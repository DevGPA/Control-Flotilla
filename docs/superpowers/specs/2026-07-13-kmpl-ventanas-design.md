# km/l por VENTANA entre tanques llenos

**Fecha:** 2026-07-13 · **Aprobado por:** Navares (plan completo en
`~/.claude/plans/genera-el-plan-mas-concurrent-pretzel.md`)

## Problema

El km/l por intervalo carga→carga exigía tanque lleno en AMBOS extremos: con ~47% de
cargas parciales en la flota (unidad 47: 39/51 rendimientos "no fiel"), la mayoría del
rendimiento se perdía y una carga parcial contaminaba dos intervalos.

## Diseño

**Conservación de combustible**: entre un lleno en km A y el siguiente lleno en km B,
todos los litros cargados en medio (parciales incluidos) son el consumo exacto de
B−A. El motor (`computeFuelMetrics`) abre ventana en cada lleno efectivo, acumula
litros y la cierra en el siguiente lleno; el km/l vive en la carga de cierre
(`ventanaKmDesde/ventanaDesdeKm/ventanaCargas/ventanaInferida`, `litrosFill` = Σ).

- **Lleno efectivo** = "Si" del chofer O inferido (litros ≥ 95% del tanque,
  `VENTANA_INFIERE_LLENO`, decisión Navares) — señalado "lleno inferido" en la UI.
- **Robustez**: retroceso-typo intermedio NO rompe (sus litros cuentan; conserva su
  chip); rompen el salto adoptado, la carga sin litros y el reset de tablero adoptado
  (que reabre en la lectura pendiente si era llena). El segmento carga→carga se
  conserva para las alertas de odómetro (`kmDesdeAnterior`).
- **Motivos nuevos** (no accionables): `parcial_en_ventana`, `sin_lleno_previo`,
  `ventana_rota`. `cargaParcial` ("no fiel") se ELIMINÓ: todo km/l emitido es fiel.
- **Baseline** pondera con la distancia de la ventana; alertas rendimiento/fuga
  operan sobre cierres (fieles por construcción).
- **Alerta `parciales-cronicos`**: ≥60% de las últimas 8 cargas sin lleno (mín. 6) →
  chip en la carga más reciente; palanca de corrección en campo.
- **`computeKmplVida`**: referencia por unidad Σkm fiables/Σlitros (ignora llenado);
  visible en el detalle.
- **Historial**: las métricas se calculan en el front → todo el histórico se re-mide
  al desplegar, sin backfill.

## Validación A/B (1,465 cargas reales de prod)

- Unidad 47: 12 lecturas fieles → 27 ventanas, kmplVol 6.02 (predicho ~6).
- flotaKmplVol 5.781 → 5.801 (+0.3%); 38 → 40 unidades con baseline.
- Unidades que siempre llenan: sin cambio (86: 7.72→7.75; 73: 8.11→8.10).
- Fuga real del eco 73 sigue disparando; demás alertas idénticas.
- `parciales-cronicos` identifica 9 unidades: 22, 23, 32, 44, 45, 46, 48, 56, 76.
- Cambio de expectativa consciente: en fuelKmDetectado, el intervalo tras un typo
  ahora divide entre TODOS los litros de la ventana (600/70≈8.57, antes 600/30=20 —
  artefacto del motor viejo).
