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
};
