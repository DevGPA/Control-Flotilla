export type RiskLevel = "Urgente" | "Revisar" | "Completar" | "OK";

export type Finding = {
  cat: "Llantas" | "Checklist" | "Documentos" | "Fluidos";
  text: string;
  lv: RiskLevel;
};

export type TireReadings = Record<string, number>;

export type AnalyzeResult = {
  max: RiskLevel;
  F: Finding[];
  T: TireReadings;
  minT: number | null;
};

export type ExcelRow = Record<string, string | number | Date | undefined>;

export type ReportKind = "semanal" | "mensual";

export type WeeklyEntry = {
  uid: string;
  eco?: string;
  plate?: string;
  branch?: string;
  fecha?: string;
  aceiteRisk?: RiskLevel;
  radiadorRisk?: RiskLevel;
  carroceriaRisk?: RiskLevel;
  llantaRisk?: RiskLevel;
  risk?: RiskLevel;
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
  photos?: string[];
  km?: number | string;
};

/** Marks for completed findings per unit, keyed by finding text. */
export type ChecklistDB = Record<string, Record<string, { done?: boolean }>>;
