/**
 * Statuses de Operaciones-GPA que NO son un veredicto: "Anulado" y "Por corregir".
 *
 * Contexto (brief Ops 2026-07-27): Ops dejó de parchar en sitio los registros
 * capturados en la unidad equivocada. Ahora una reasignación crea un registro NUEVO
 * en la unidad correcta (evento `creacion`, folio nuevo) y marca el VIEJO con
 * `status="Anulado"` (evento `cambio_estado`). Aparte introdujeron "Por corregir",
 * un estado retenido: el autorizador devuelve el registro para corregir un campo y
 * luego vuelve a Pendiente → Aprobada.
 *
 * ⚠️ Por qué esto importa: el receptor procesa `creacion` y `cambio_estado`
 * IDÉNTICAMENTE (`evento.evento` no ramifica nada) y hace el upsert completo antes de
 * mirar el status. Un status que no se reconozca deja el registro VIVO y responde 200
 * → el registro reasignado se cuenta DOS VECES, sin DLQ y sin alarma. En checklists es
 * peor que contable: la unidad equivocada queda con una inspección aprobada que nunca
 * tuvo y su semáforo de riesgo miente.
 *
 * Los predicados son deliberadamente TOLERANTES (género, caja, espacios, acentos)
 * porque el vocabulario exacto de Ops no está confirmado y el modo de falla de no
 * reconocerlo es silencioso. Mismo criterio que `mapValidacion` con "aproba"/"rechaza".
 */

import {
  refIdChecklist,
  refIdCombustible,
  refIdSemanal,
  type AnulacionModulo,
} from "../anulacion/anulacion";
import { loadIdOf } from "../fuel/mapEntry";
import { OPS_EVENT_PREFIX, type CargaCombustibleInput } from "./contract";
import type { ChecklistInput, SemanalInput } from "./mapChecklist";

/** Normaliza un status venido del blob JSON de Ops: string, minúsculas, sin bordes. */
function norm(status: unknown): string {
  return String(status ?? "")
    .trim()
    .toLowerCase();
}

/** "Anulado" / "Anulada" / "ANULADO" → true. El registro quedó sustituido por otro. */
export function esStatusAnulado(status: unknown): boolean {
  return norm(status).startsWith("anulad");
}

/**
 * "Por corregir" / "Por corrección" → true. Estado RETENIDO, no final.
 *
 * El prefijo común de ambas grafías es "corre", no "correc": `corregir` es corre-G-ir y
 * `corrección` es corre-C-ción. Un `startsWith` con cualquiera de las dos deja fuera a la
 * otra. La alternancia `(g|c)` cubre las dos sin abrir la puerta a falsos positivos como
 * "por correo".
 */
export function esStatusPorCorregir(status: unknown): boolean {
  return /^por\s+corre[gc]/.test(norm(status));
}

/**
 * ¿El status viene del vocabulario que Ops REALMENTE usa?
 *
 * Medido contra producción el 2026-08-11 sobre 903 registros del puente, el universo
 * completo es: "Aprobada"/"Aprobado" (871), "Rechazada" (21), "Pendiente" (9) y
 * "Por corregir" (2). `Anulad*` se acepta porque lo fija el brief, aunque nunca haya
 * llegado. Vacío cuenta como conocido: hay eventos legítimos sin status.
 *
 * Un status FUERA de esta lista significa que Ops cambió su vocabulario, y ese es
 * justamente el escenario en el que un registro sustituido se colaría como vivo. Por eso la
 * lista vive AQUÍ y no duplicada: el receptor la usa para avisar en CloudWatch y la UI para
 * marcar la fila, de modo que no puedan divergir.
 */
export function esStatusOpsConocido(status: unknown): boolean {
  const s = norm(status);
  return (
    !s ||
    s.startsWith("aproba") ||
    s.startsWith("rechaza") ||
    s.startsWith("pendiente") ||
    esStatusAnulado(s) ||
    esStatusPorCorregir(s)
  );
}

/**
 * ¿Este registro puede actualizar el catálogo de unidades (`Unit`)?
 *
 * NO cuando está Anulado. La fila `Unit` que escriben mapMensual/mapSemanal **no se
 * filtra por anulación** (`window.__fleetUnits` se arma con `units.map(...)`, no con los
 * checklists vigentes), así que upsertearla desde un Anulado puede: crear una unidad
 * fantasma que infla el total de flota, pisar `economicoId`/`marca`/`area` de la unidad
 * correcta, y colisionar el join de combustible (`unidadPorEco` es first-wins por
 * económico). Un registro invalidado no manda sobre el catálogo — mismo razonamiento
 * que ya justifica `omitirEnUpdate: ["sucursal"]` en el receptor.
 */
export function debeMantenerCatalogo(status: unknown, sustituido = false): boolean {
  return !esStatusAnulado(status) && !sustituido;
}

/**
 * Nombres posibles del campo que lleva el rastro hacia el registro SUSTITUTO.
 *
 * Confirmado por el brief de Ops del 2026-07-29: el rastro es `answers.reasignadoA` en el
 * registro anulado (y `reasignadoDe` en el nuevo), con la forma
 * `{ id, folio, vehicleId, economico, sucursal, por, en }`. Los otros dos nombres quedan
 * como red de seguridad barata hasta ver el primer evento real en producción.
 *
 * ⚠️ `reasignadoDe` NO va aquí: marca el registro **NUEVO** (apunta hacia atrás, al
 * sustituido). Tratarlo como rastro de sustitución anularía el registro BUENO y esconderría
 * el dato válido de todos los cálculos — peor que el doble conteo que esto viene a evitar.
 * Estaba en la lista y era inofensivo solo porque la anulación se gateaba únicamente por el
 * status; al gatearla también por el rastro, dejarlo sería un bug de datos.
 */
const CANDIDATOS_RASTRO = ["reasignadoA", "folioNuevo", "nuevoFolio"] as const;

interface RastroReasignacion {
  /** Folio del sustituto en la convención de FC ("OPS-<id>"). */
  folio?: string;
  /** Quién hizo la reasignación en Ops. */
  por?: unknown;
  /** Cuándo la hizo. */
  en?: unknown;
}

/**
 * Rastro de la reasignación. Acepta el candidato como string suelto o como objeto.
 *
 * ⚠️ La llave del registro dentro del objeto se llama **`id`** (así lo documenta Ops), no
 * `registroId`; se aceptan ambos por robustez. El folio derivado usa el prefijo de FC —
 * NO se toma el `folioSolicitud`/`folio` de Ops si viniera con otra convención.
 */
function rastroReasignacion(ops: Record<string, unknown>): RastroReasignacion | null {
  for (const campo of CANDIDATOS_RASTRO) {
    const v = ops[campo];
    if (typeof v === "string" && v.trim()) return { folio: v.trim() };
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const folio = String(o.folio ?? "").trim();
      const id = String(o.id ?? o.registroId ?? "").trim();
      return {
        folio: folio || (id ? `${OPS_EVENT_PREFIX}${id}` : undefined),
        por: o.por,
        en: o.en,
      };
    }
  }
  return null;
}

/**
 * Metadatos de la anulación a partir del registro plano de Ops.
 *
 * Quién/cuándo se buscan en tres lugares, en este orden:
 *  1. DENTRO del rastro (`reasignadoA.por` / `.en`) — la forma que documenta Ops y la que
 *     de verdad describe la reasignación.
 *  2. El campo `reasignacion` viejo (`{en, por, de:{…}}`), que existe en registros de prod
 *     anteriores al cambio.
 *  3. `autorizadoPor` / `fechaAut` — último respaldo; describen la aprobación, no la
 *     reasignación, así que solo se usan si no hay nada mejor.
 *
 * `ahora` se inyecta para que la función quede pura y el `ts` (obligatorio en el modelo)
 * nunca salga vacío.
 */
export function metaAnulacionDeOps(ops: Record<string, unknown>, ahora: string): AnulacionOpsMeta {
  const rastro = rastroReasignacion(ops);
  const rea = (ops.reasignacion ?? {}) as Record<string, unknown>;
  return {
    status: ops.status,
    anuladoPor: rastro?.por ?? rea.por ?? ops.autorizadoPor,
    ts: rastro?.en ?? rea.en ?? ops.fechaAut,
    folioNuevo: rastro?.folio,
    // Señal ESTRUCTURAL de que este registro fue sustituido, independiente del vocabulario.
    // Medido en prod 2026-08-11: los únicos statuses que Ops ha emitido en 903 registros son
    // "Aprobada/Aprobado", "Rechazada", "Pendiente" y "Por corregir" — "Anulado" NUNCA
    // llegó, así que la palabra sigue sin confirmarse contra un evento real. Gatear solo por
    // ella dejaría pasar un "Cancelado" y el sustituido se contaría dos veces en silencio.
    sustituido: rastro !== null,
    ahora,
  };
}

/**
 * Destino del registro que se anula. Recibe el **input ya mapeado** (el que se persiste),
 * NUNCA el registro crudo de Ops: así el `refId` de la anulación y el que compone la
 * hidratación salen del mismo campo del mismo objeto, y la deriva entre los dos lados se
 * vuelve imposible por construcción. Es el mismo criterio que ya usa `mapValidacion` para
 * el `loadId`.
 */
export type AnulacionOpsDestino =
  | {
      modulo: "combustible";
      carga: Pick<CargaCombustibleInput, "tenantId" | "economicoId" | "tipo" | "eventoId">;
    }
  | { modulo: "checklist"; checklist: Pick<ChecklistInput, "tenantId" | "unitUid" | "fecha"> }
  | { modulo: "semanal"; semanal: Pick<SemanalInput, "tenantId" | "periodoId" | "unitUid"> };

/** Fila de `Anulacion` lista para persistir (mismo shape que el `AnulacionInput` del cliente). */
export interface AnulacionOpsInput {
  tenantId: string;
  refId: string;
  modulo: AnulacionModulo;
  motivo: string;
  anuladoPor: string;
  ts: string;
}

export interface AnulacionOpsMeta {
  status: unknown;
  /** Quién reasignó en Ops (p. ej. `reasignacion.por`). */
  anuladoPor?: unknown;
  /** Cuándo reasignó en Ops (`reasignacion.en` / `fechaAut`). */
  ts?: unknown;
  /** Folio del registro sustituto, si el evento lo trae. */
  folioNuevo?: unknown;
  /**
   * ¿Llegó el rastro que indica que ESTE registro fue sustituido (`reasignadoA`)? Es la
   * señal estructural, no léxica: dispara la anulación aunque el status traiga una palabra
   * que nadie anticipó. Lo calcula `metaAnulacionDeOps`.
   */
  sustituido?: boolean;
  /**
   * Reloj inyectado (ISO). Respaldo de `ts`, que es OBLIGATORIO en el modelo: un `""`
   * hace que AppSync rechace el create y el receptor entre en 500 → reintento → DLQ.
   * Se inyecta en lugar de leerlo aquí para que la función siga siendo pura.
   */
  ahora: string;
}

/**
 * Registro sustituido en Ops → fila de `Anulacion` de Fleet Command. `null` si no hay nada
 * que anular (el llamador no tiene que pre-filtrar).
 *
 * Dispara por DOS señales, y basta una:
 *  1. **el rastro** `reasignadoA` (estructural, `meta.sustituido`) — la señal fuerte, porque
 *     no depende de qué palabra use Ops;
 *  2. **el status** `Anulad*` — la que fija el brief, ahora como respaldo.
 *
 * NO toca `ValidacionCarga` a propósito: la anulación ya excluye el registro de todo
 * cálculo, y degradar el veredicto lo destruiría sin versionarlo — al restaurar volvería
 * como "pendiente" en vez de conservar el "Validado · Ops" real.
 */
export function mapAnulacionOps(
  destino: AnulacionOpsDestino,
  meta: AnulacionOpsMeta,
): AnulacionOpsInput | null {
  if (!esStatusAnulado(meta.status) && !meta.sustituido) return null;

  let tenantId: string;
  let refId: string;
  switch (destino.modulo) {
    case "combustible": {
      const c = destino.carga;
      tenantId = c.tenantId;
      refId = refIdCombustible(loadIdOf(c.economicoId, c.tipo, c.eventoId));
      break;
    }
    case "checklist": {
      const c = destino.checklist;
      tenantId = c.tenantId;
      refId = refIdChecklist(c.unitUid, c.fecha);
      break;
    }
    case "semanal": {
      const s = destino.semanal;
      tenantId = s.tenantId;
      refId = refIdSemanal(s.periodoId, s.unitUid);
      break;
    }
  }

  const folio = String(meta.folioNuevo ?? "").trim();
  const quien = String(meta.anuladoPor ?? "").trim();
  return {
    tenantId,
    refId,
    modulo: destino.modulo,
    // El motivo es texto HUMANO para el panel de anulados; la traza consultable por
    // máquina va en el AuditEvent que escribe el receptor (no se parsea este string).
    motivo: folio
      ? `Reasignado a ${folio} (Operaciones-GPA)`
      : "Anulado en Operaciones-GPA (reasignación)",
    // Marcador de autoría del puente, espejo de `revisadoPor` en mapValidacion.
    anuladoPor: quien ? `${quien} · ops-gpa` : "ops-gpa",
    ts: String(meta.ts ?? "").trim() || meta.ahora,
  };
}
