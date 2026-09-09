export type RiskLevel = "Urgente" | "Revisar" | "Completar" | "OK";

export type Finding = {
  cat: "Llantas" | "Checklist" | "Documentos" | "Fluidos" | "Mantenimiento";
  text: string;
  lv: RiskLevel;
  /**
   * Identidad ESTABLE del hallazgo (Fase C1): `Llanta:<pos>`, `Bin:<columna>`,
   * `Fluido:<columna>`, `Mant:Servicio`, `Chk:Refaccion`. Nunca embebe valores
   * medidos/fechas/conteos. Es la clave de checklistDB y CheckDone cloud
   * (vía findingKey(f) = f.key || f.text). Opcional: findings sin key usan text.
   */
  key?: string;
};

export type TireReadings = Record<string, number>;

export type AnalyzeResult = {
  max: RiskLevel;
  F: Finding[];
  T: TireReadings;
  minT: number | null;
  /** Siempre array. Vacío = ok. analyzeRow garantiza que nunca es undefined. */
  validationErrors: string[];
};

export type ExcelRow = Record<string, string | number | Date | undefined>;

export type ReportKind = "semanal" | "mensual";

export type WeeklyEntry = {
  uid: string;
  eco?: string;
  plate?: string;
  brand?: string;
  branch?: string;
  fecha?: string;
  km?: number | string;
  responsable?: string;
  aceiteRisk?: RiskLevel;
  radiadorRisk?: RiskLevel;
  carroceriaRisk?: RiskLevel;
  llantaRisk?: RiskLevel;
  aceite?: string;
  radiador?: string;
  carroceria?: string;
  llanta?: string;
  risk?: RiskLevel;
  photos?: string[];
};

export type Unit = {
  uid: string;
  eco?: string;
  plate?: string;
  /**
   * `unitUid` TAL COMO ESTA ALMACENADO en el registro (Checklist/Semanal/Taller), que NO
   * siempre es `plate`: `plate` viene del catalogo y es la placa vigente, mientras que un
   * registro archivado bajo una placa retirada conserva la vieja. La identidad natural con
   * la que se compone el `refId` de anulacion es esta, la almacenada — si se compusiera con
   * `plate`, quien anula escribiria una llave que quien hidrata no busca y la anulacion se
   * guardaria sin excluir nada, EN SILENCIO (ver src/anulacion/anulacion.ts).
   */
  unitUid?: string;
  branch?: string;
  driver?: string;
  fecha?: string;
  odo?: string;
  nextSvc?: string;
  risk: RiskLevel;
  F: Finding[];
  T: TireReadings;
  minT: number | null;
  hasRefaccion?: boolean;
  // Campos render-time (opcionales, poblados por el pipeline legado)
  brand?: string;
  insp?: string;
  obs?: string;
  obsArr?: string[];
  // photos puede ser string[] (legacy) o objetos {fname, col, group} (nuevo).
  // Tratamos como array genérico aquí; cada renderer tipa a lo que espera.
  photos?: unknown[];
  km?: number | string;
  kmNextSvc?: number | string;
  /** Folio de registro de la submission de MoreApp (envelope.id). Solo cloud-hidratado. */
  folio?: string;
  /** Año modelo de la unidad (catálogo cloud) — para la conversación reparar-vs-reemplazar. */
  anio?: number | string;
  /** Errores de validación persistidos en resultados — una fila con ellos NO
   *  sirve como evidencia del overlay auto-resueltos (spec 2026-07-23 §2). */
  validationErrors?: string[];
  /** Keys que la inspección SÍ evaluó (spec §4; las escribe el pipeline nuevo).
   *  Ausente en filas actuales → aplica el régimen retro de evaluoKey. */
  evaluatedKeys?: string[];
  /** Montacargas (producto Gas LP). Solo cloud-hidratado; excluido de la cuenta de flota. */
  esMontacargas?: boolean;
};

/** Marks for completed findings per unit, keyed by findingKey (o texto legacy).
 *  `auto` = entrada derivada del overlay auto-resueltos (nunca persistida). */
export type ChecklistDB = Record<
  string,
  Record<string, { done?: boolean; ts?: string; by?: string; auto?: boolean }>
>;
