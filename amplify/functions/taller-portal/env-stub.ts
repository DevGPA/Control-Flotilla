// Stub SOLO para vitest (ver el alias en vite.config.ts). En producción este
// módulo lo resuelve el bundler propio de Amplify/CDK al desplegar, con el
// `env` real (endpoint de AppSync + secretos inyectados por allow.resource);
// Vite nunca ve ese bundling. Un objeto vacío basta aquí: los tests de
// tallerPortalHandler.test.ts solo ejercitan las funciones puras exportadas
// por handler.ts, nunca invocan `handler()` ni tocan `getDataClient()`.
export const env: Record<string, string> = {};
