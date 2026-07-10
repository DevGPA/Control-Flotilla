// Stub de tipos para el módulo virtual que Amplify genera en build (mismo patrón
// que moreapp-webhook/amplify-env.d.ts): en deploy, `$amplify/env/opsgpa-receptor`
// exporta `env` con los env vars + la config de datos inyectada por allow.resource.
declare module "$amplify/env/opsgpa-receptor" {
  export const env: Record<string, string>;
}
