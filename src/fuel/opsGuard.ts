/**
 * Candados de ESCRITURA para registros originados en Operaciones-GPA (spec 2026-07-30 §2.5).
 *
 * No son permisos —el enforcement real es AppSync—: son candados contra CORROMPER datos.
 * Puro, sin DOM ni red → testeable con vitest.
 */
import type { FuelEntry } from "./types";
import { OPS_SOURCE } from "../opsgpa/contract";

/**
 * Statuses de Ops que ya son FINALES: no llegará otro veredicto por el puente.
 * Por PREFIJO y sin distinguir género: en producción conviven "Aprobada"/"Aprobado" y
 * "Rechazada"/"Rechazado". Un `=== "Aprobada"` dejaría fuera cientos de registros.
 */
const OPS_STATUS_FINAL = /^(aproba|rechaza)/i;

/**
 * ¿Lo escribió el puente de Ops? Sin `fuente` ⇒ MoreApp (nunca la estampó).
 *
 * Compara contra `OPS_SOURCE`, la MISMA constante que el puente escribe en `datos.fuente`
 * (`src/opsgpa/contract.ts`). Con un literal duplicado, cambiar el valor del contrato haría
 * que el candado dejara de aplicar en silencio: fallo ABIERTO, sin que nada se rompa.
 */
export function esOrigenOps(e: Pick<FuelEntry, "fuente">): boolean {
  return e.fuente === OPS_SOURCE;
}

/** ¿El status de Ops ya es definitivo? Se decide por NEGACIÓN de la lista de finales. */
export function opsStatusEsFinal(e: Pick<FuelEntry, "opsStatus">): boolean {
  return OPS_STATUS_FINAL.test(String(e.opsStatus ?? "").trim());
}

/**
 * ¿Se puede validar a mano? NO mientras Ops no haya decidido.
 *
 * La validación manual escribe `fuenteDeteccion: "manual"`, y la regla de no-pisado del
 * receptor (amplify/functions/opsgpa-receptor/handler.ts:188) hace que el puente JAMÁS
 * vuelva a tocar ese veredicto: el registro quedaría congelado y la aprobación de Ops
 * nunca entraría. Cubre "Pendiente", "Por corregir" y cualquier status futuro.
 *
 * Cuando Ops YA decidió sí se permite: el no-pisado existe precisamente para que el
 * criterio humano de tesorería tenga la última palabra sobre el veredicto del puente.
 */
export function puedeValidarManual(e: Pick<FuelEntry, "fuente" | "opsStatus">): boolean {
  return !esOrigenOps(e) || opsStatusEsFinal(e);
}

/**
 * ¿Se puede corregir el odómetro en FC? NO para registros de Ops, en ningún status.
 *
 * Ops es la fuente de verdad y ya tiene su propio override con autoría (`kmForzadoPor`),
 * que además llega a FC. Si además se corrigiera aquí, una corrección posterior de Ops
 * pisaría `kmCapturado` mientras `kmDetectado` seguiría ganando en computeFuelMetrics
 * (fuelAnalysis.ts:196-202) → el km/l se calcularía con el valor viejo y nadie lo vería.
 * Costo operativo de este candado: cero — los 32 errores vivos son todos de MoreApp.
 */
export function puedeCorregirKm(e: Pick<FuelEntry, "fuente">): boolean {
  return !esOrigenOps(e);
}

/** Motivo legible del bloqueo de validación para la UI. Cadena vacía = no hay bloqueo. */
export function motivoBloqueo(e: Pick<FuelEntry, "fuente" | "opsStatus">): string {
  if (puedeValidarManual(e)) return "";
  return `Esperando a Operaciones-GPA (${e.opsStatus ?? "sin status"}). El veredicto llega por el puente: validar aquí lo congelaría y la decisión de Ops ya no entraría.`;
}
