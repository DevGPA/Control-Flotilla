// dedupTallerCloudRows — deduplicación PURA de filas Taller del cloud (Fase C2,
// audit 2026-06-04 P1 #10/#11). Los re-keys históricos (fechaEntrada con
// fallback a updatedAt regenerado) dejaron filas duplicadas del MISMO registro
// lógico con claves distintas. Hasta que la limpieza física corra (C2d), la
// vista dedup-ea en lectura: agrupa por el id legacy y se queda con UNA fila.
//
// Derivación de id IDÉNTICA al hydrate: datos.id ?? folio ?? `${unitUid}_${fechaEntrada}`.
// Ganador determinista (todos los clientes eligen la misma fila):
//   1. datos.updatedAt mayor (ISO string compare)
//   2. updatedAt del modelo (Amplify) mayor
//   3. fechaEntrada mayor, prefiriendo claves NO-`sin-fecha:`
// Pura: testeable sin Amplify.

export type TallerCloudRowLike = {
  unitUid: string;
  fechaEntrada: string;
  folio?: string | null;
  datos?: unknown;
  updatedAt?: string | null;
};

export function tallerRowLegacyId(t: TallerCloudRowLike): string {
  const datos = parseDatos(t.datos);
  return String(datos.id ?? t.folio ?? `${t.unitUid}_${t.fechaEntrada}`);
}

function parseDatos(raw: unknown): { id?: unknown; updatedAt?: unknown } {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as { id?: unknown; updatedAt?: unknown };
    } catch {
      return {};
    }
  }
  return raw as { id?: unknown; updatedAt?: unknown };
}

function beats(a: TallerCloudRowLike, b: TallerCloudRowLike): boolean {
  const aDatos = parseDatos(a.datos);
  const bDatos = parseDatos(b.datos);
  const aUpd = String(aDatos.updatedAt ?? "");
  const bUpd = String(bDatos.updatedAt ?? "");
  if (aUpd !== bUpd) return aUpd > bUpd;
  const aModelUpd = String(a.updatedAt ?? "");
  const bModelUpd = String(b.updatedAt ?? "");
  if (aModelUpd !== bModelUpd) return aModelUpd > bModelUpd;
  const aSin = a.fechaEntrada.startsWith("sin-fecha:");
  const bSin = b.fechaEntrada.startsWith("sin-fecha:");
  if (aSin !== bSin) return !aSin; // prefiere clave con fecha real
  return a.fechaEntrada > b.fechaEntrada;
}

export function dedupTallerCloudRows<T extends TallerCloudRowLike>(rows: T[]): T[] {
  const winners = new Map<string, T>();
  for (const row of rows) {
    const id = tallerRowLegacyId(row);
    const cur = winners.get(id);
    if (!cur || beats(row, cur)) winners.set(id, row);
  }
  return [...winners.values()];
}
