// Stub de tipos para el módulo virtual que Amplify genera en build.
// En deploy, `$amplify/env/admin-users` exporta `env` con los env vars de la
// función + la config de datos inyectada por allow.resource. tsc local no lo ve,
// así que declaramos el shape aquí. El bundler de Amplify usa el módulo real.
declare module "$amplify/env/admin-users" {
  export const env: Record<string, string>;
}
