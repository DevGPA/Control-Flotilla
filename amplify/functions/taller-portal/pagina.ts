// Stub temporal — Task 6 lo reemplaza por completo con la página real del
// portal (lee la visita, muestra las partidas, formulario de captura). Este
// archivo existe SOLO para que `handler.ts` (que hace `await import("./pagina")`)
// resuelva en el typecheck de Task 5; no tiene lógica propia.

export function paginaProveedor(_token: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Portal de taller — GPA</title>
</head>
<body style="font:16px/1.6 system-ui;max-width:34em;margin:12vh auto;padding:0 1.5em;color:#0f172a">
<h1 style="font-size:1.4em">El portal se está preparando</h1>
<p>Esta liga es válida, pero la página todavía no está lista. Vuelve a intentarlo más tarde.</p>
</body>
</html>`;
}
