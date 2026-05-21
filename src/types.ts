export type RiskLevel = "Urgente" | "Revisar" | "Completar" | "OK";

export type Finding = {
  cat: "Llantas" | "Checklist" | "Documentos" | "Fluidos" | "Mantenimiento";
  text: string;
  lv: RiskLevel;
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
};

/** Marks for completed findings per unit, keyed by finding text. */
export type ChecklistDB = Record<string, Record<string, { done?: boolean }>>;
