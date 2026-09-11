// Stub de PRUEBA del módulo virtual `$amplify/env/taller-portal`.
//
// En despliegue, Amplify genera ese módulo durante el build del backend y ahí
// vive la config de datos que `getAmplifyDataClientConfig` consume. En vitest
// no existe ningún backend, así que `handler.ts` no se podía ni IMPORTAR: el
// análisis de imports de Vite falla antes de que `vi.mock` alcance a intervenir
// (probado: "Failed to resolve import $amplify/env/taller-portal").
//
// Por eso `vite.config.ts` mapea ese especificador a este archivo — SOLO bajo
// `test.alias`, nunca en el `resolve.alias` del build de la app. El contenido
// es irrelevante para las pruebas: `getAmplifyDataClientConfig` va mockeado y
// el harness nunca habla con AWS. Valores ficticios a propósito (repo público).
export const env: Record<string, string> = {
  AMPLIFY_DATA_DEFAULT_NAME: "stub-de-prueba",
  TALLER_PORTAL_SECRET: "",
};
