// Fechas compartidas del dominio — helpers puros, sin DOM ni dependencias.
//
// Regla del proyecto: NUNCA usar toISOString()/getMonth() sobre `new Date()`
// para derivar días locales (en UTC-6 el día se corre; bug documentado en
// src/dashboard/charts.ts, heatmap). Aquí todo es aritmética de strings y
// números; el "hoy" local lo inyecta el caller (ver periodoPresets.hoyLocalISO).

/** Deriva "YYYY-MM" de una fecha de checklist (ISO YYYY-MM-DD o legacy DD/MM/YYYY). */
export function monthOf(fecha: string | null | undefined): string | null {
  const s = String(fecha ?? "").trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}`;
  return null;
}

/** Meses cortos 1-indexados (índice 0 vacío, como MES_NAMES del legado). */
export const MES_CORTO: readonly string[] = [
  "",
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

/** "2026-08" → "Ago 2026". Si no parsea como YYYY-MM, devuelve el string crudo. */
export function monthLabel(ym: string): string {
  const m = String(ym ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(ym ?? "");
  const mes = parseInt(m[2]!, 10);
  const nombre = MES_CORTO[mes];
  if (!nombre) return String(ym);
  return `${nombre} ${m[1]}`;
}

/** Días del mes (mes 1-12), con bisiestos (regla gregoriana completa). */
export function diasEnMes(anio: number, mes: number): number {
  if (mes === 2) {
    const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
    return bisiesto ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}
