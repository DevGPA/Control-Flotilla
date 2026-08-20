/**
 * Decide qué fotos de una carga van a la visión IA (Fase 1) — puro, sin AWS.
 *
 * Lee el `datos` (JSON) de CargaCombustible y extrae el mapa col→fname de las 4
 * evidencias que la visión sabe leer. Gate deliberado: sin `fotoTicket` ni `fotoBomba`
 * no hay evidencia de montos que leer → devuelve vacío y el receptor NO invoca la
 * Lambda (las SOLICITUDES caen aquí: sus fotos son `photo`/`fotos[i]`, otro dominio).
 */

const CAMPOS_VISION = ["fotoTicket", "fotoBomba", "fotoAntes", "fotoDespues"] as const;

export function fnamesParaVision(datosJson: string | null | undefined): Record<string, string> {
  let photos: unknown;
  try {
    photos = (JSON.parse(String(datosJson ?? "")) as { photos?: unknown }).photos;
  } catch {
    return {};
  }
  if (!Array.isArray(photos)) return {};

  const mapa: Record<string, string> = {};
  for (const p of photos as { col?: unknown; fname?: unknown }[]) {
    const col = String(p?.col ?? "");
    const fname = String(p?.fname ?? "");
    if (!fname || mapa[col]) continue;
    if ((CAMPOS_VISION as readonly string[]).includes(col)) mapa[col] = fname;
  }

  if (!mapa.fotoTicket && !mapa.fotoBomba) return {};
  return mapa;
}
