// Stub de tipos para el módulo virtual que Amplify genera en build: en deploy,
// `$amplify/env/taller-portal` exporta `env` con los env vars + la config de
// datos inyectada por allow.resource.
declare module "$amplify/env/taller-portal" {
  export const env: Record<string, string>;
}
