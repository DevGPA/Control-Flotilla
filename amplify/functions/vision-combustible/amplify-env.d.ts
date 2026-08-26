// Stub de tipos para el módulo virtual que Amplify genera en build: en deploy,
// `$amplify/env/vision-combustible` exporta `env` con los env vars + la config de
// datos inyectada por allow.resource (mismo patrón que opsgpa-receptor).
declare module "$amplify/env/vision-combustible" {
  export const env: Record<string, string>;
}
