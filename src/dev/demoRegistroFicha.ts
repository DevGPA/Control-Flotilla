// Vista LOCAL de Fleet — el registro de Taller como ficha (spec 2026-09-30 §8).
//
// SOLO corre con `npm run dev` y la URL ?e2e=1&demo=registro-ficha: main.ts la importa
// detrás de `import.meta.env.DEV`, así que nunca entra al build de producción. Siembra
// CINCO visitas INVENTADAS (liga activa con hallazgos, sin nada, cerrada con liga-cierre,
// liga revocada con promesa vencida, cerrada legado) y abre la primera, para ver la ficha,
// los hallazgos agrupados, Guardar con cambios y los nombres con las funciones REALES de
// la app. Todo lo que tocaría la nube o el disco es un doble que no escribe nada.
import { visitaKeyDe } from "../api/tallerPartidas";
import {
  MOTIVOS_RECHAZO,
  autorizar,
  gastoDerivado,
  montoPendienteDeFirma,
  pendientesDeFirma,
  rechazar,
  type Partida,
} from "../taller/partidas";
import { fichaRegistro } from "../taller/ficha";
import { ordenarHallazgos } from "../taller/seguimiento";
import { hayCambios } from "../taller/cambiosFormulario";
import { describirRevocadaPor, nombreDeUsuario, type Directorio } from "../taller/nombreUsuario";

// La ventana se trata como un diccionario a propósito: los globales del monolito
// (renderTaller, openTallerModal, saveTallerDB…) no tienen tipos, y los puentes que sí
// los tienen no deben obligar a la demo a fabricar objetos completos de producción.
const w = window as unknown as Record<string, unknown>;
const llamar = (nombre: string, ...args: unknown[]): unknown => {
  const f = w[nombre];
  return typeof f === "function" ? (f as (...a: unknown[]) => unknown)(...args) : undefined;
};

function dibujo(
  fondo: string,
  disco: string,
  grosor: number,
  texto: string,
  colorTexto: string,
): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">` +
    `<rect width="160" height="120" fill="${fondo}"/>` +
    `<circle cx="72" cy="62" r="50" fill="${disco}"/><circle cx="72" cy="62" r="17" fill="#1f2937"/>` +
    `<rect x="112" y="30" width="30" height="64" rx="7" fill="#b91c1c"/>` +
    `<rect x="${112 - grosor}" y="38" width="${grosor}" height="48" rx="2" fill="#a8a29e"/>` +
    `<text x="80" y="114" font-size="8" fill="${colorTexto}" text-anchor="middle" font-family="sans-serif">${texto}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const gastado = (texto: string) => dibujo("#3f3a36", "#8a5a33", 4, texto, "#fca5a5");
const nuevo = (texto: string) => dibujo("#334155", "#cbd5e1", 12, texto, "#bbf7d0");
const FOTOS: Record<string, string> = {
  "demo/antes-balatas-delanteras.png": gastado("delanteras · balata 2 mm · disco rayado"),
  "demo/antes-balatas-traseras.png": gastado("traseras · balata 2 mm · disco rayado"),
  "demo/despues-balatas-traseras-1.png": nuevo("balata nueva 12 mm · vista 1"),
  "demo/despues-balatas-traseras-2.png": nuevo("balata nueva 12 mm · vista 2"),
  "demo/antes-amortiguador.png": gastado("amortiguador · fuga de aceite"),
  "demo/antes-bomba.png": gastado("bomba de agua · fuga"),
};

async function esperar(cond: () => boolean, ms = 20_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// La red externa, cortada desde la página (lo mismo que hace la prueba e2e con page.route).
// La sesión admin de mentira abre en la UI caminos que escriben directo con el cliente de
// Amplify; Amplify habla por fetch (Cognito, AppSync) y por XHR (subidas a S3).
function cortarRedExterna(): void {
  const esLocal = (u: string | URL): boolean => {
    const url = new URL(String(u), window.location.href);
    return (
      url.protocol === "data:" ||
      url.protocol === "blob:" ||
      ["localhost", "127.0.0.1"].includes(url.hostname)
    );
  };
  const bloqueada = (u: string | URL) =>
    new TypeError(`[demo registro-ficha] red externa bloqueada: ${String(u)}`);
  const fetchReal = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = input instanceof Request ? input.url : input;
    return esLocal(u) ? fetchReal(input, init) : Promise.reject(bloqueada(u));
  };
  const abrirReal = XMLHttpRequest.prototype.open as (...a: unknown[]) => void;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...a: unknown[]) {
    const u = a[1] as string | URL;
    if (!esLocal(u)) throw bloqueada(u);
    abrirReal.apply(this, a);
  } as typeof XMLHttpRequest.prototype.open;
}

// Subs INVENTADOS (repo público) y un directorio simulado que "llega" 2 s después.
const SUB_ANA = "11111111-2222-4333-8444-555555555555";
const SUB_LUIS = "22222222-2222-4333-8444-555555555555";
const SUB_YO = "44444444-2222-4333-8444-555555555555";
const SUB_NADIE = "33333333-2222-4333-8444-555555555555";
const DIRECTORIO: Directorio = new Map([
  [SUB_ANA, { cognitoSub: SUB_ANA, email: "ana@ejemplo.test", nombre: "Ana López" }],
  [SUB_LUIS, { cognitoSub: SUB_LUIS, email: "luis@ejemplo.test", nombre: "" }],
  [SUB_YO, { cognitoSub: SUB_YO, email: "demo@ejemplo.test", nombre: "Navares" }],
]);
const YO = { sub: SUB_YO, email: "demo@ejemplo.test" };
const hoy = new Date();
const dia = (d: number): string =>
  new Date(hoy.getTime() + d * 86400000).toISOString().slice(0, 10);
const iso = (d: number): string => new Date(hoy.getTime() + d * 86400000).toISOString();

// `_tallerEditId` es una variable interna del script del monolito (no vive en window): la demo
// envuelve openTallerModal para recordar qué registro está abierto y poder reabrirlo al
// cambiar de rol o de apagador.
let abiertoId: string | null = null;
function recordarRegistroAbierto(): void {
  const abrirReal = w.openTallerModal as (id?: string) => void;
  w.openTallerModal = (id?: string) => {
    abiertoId = typeof id === "string" ? id : null;
    abrirReal(id);
  };
}

// Pegado ARRIBA y sin atrapar clics (lección de la demo del antes y después).
function avisoDemo(): void {
  const b = document.createElement("div");
  b.id = "demo-registro-ficha";
  b.setAttribute("role", "status");
  b.style.cssText =
    "position:fixed;left:50%;top:0;transform:translateX(-50%);z-index:10000;max-width:calc(100vw - 24px);pointer-events:none;background:#b45309;color:#fff;font:600 11px system-ui;padding:3px 12px;border-radius:0 0 8px 8px;box-shadow:0 4px 12px rgba(0,0,0,.25)";
  b.textContent = "MODO DEMO · datos inventados · nada se guarda · registro como ficha";
  document.body.appendChild(b);
}

// Selector fijo: rol y apagador. Cambia la sesión de mentira y repinta el registro abierto.
function selectorDemo(): void {
  const box = document.createElement("div");
  box.id = "demo-rol";
  box.style.cssText =
    "position:fixed;right:12px;top:8px;z-index:10000;display:flex;gap:6px;align-items:center;background:#0f172a;color:#fff;font:600 11px system-ui;padding:4px 8px;border-radius:8px";
  const rol = document.createElement("select");
  rol.id = "demo-rol-sel";
  for (const [v, t] of [
    ["admin", "Admin"],
    ["riesgos", "Riesgos"],
    ["viewer", "Viewer"],
  ]) {
    const o = document.createElement("option");
    o.value = v!;
    o.textContent = t!;
    rol.appendChild(o);
  }
  const apag = document.createElement("label");
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.id = "demo-apagador";
  chk.checked = true;
  apag.append(chk, document.createTextNode(" esquema híbrido"));
  const aplicar = (): void => {
    const grupos =
      rol.value === "admin"
        ? ["admin"]
        : rol.value === "riesgos"
          ? ["operativo", "riesgos"]
          : ["viewer"];
    (w.__cloudSession as Record<string, unknown>).groups = grupos;
    w.__tallerHibrido = chk.checked;
    llamar("applyRolePermissions");
    llamar("applyTallerHibridoGate");
    llamar("renderTaller");
    if (abiertoId && document.getElementById("taller-modal")?.classList.contains("open")) {
      llamar("openTallerModal", abiertoId);
    }
  };
  rol.addEventListener("change", aplicar);
  chk.addEventListener("change", aplicar);
  box.append(document.createTextNode("Ver como:"), rol, apag);
  document.body.appendChild(box);
}

export async function montarDemo(): Promise<void> {
  const lista = await esperar(
    () =>
      typeof w.renderTaller === "function" &&
      typeof w.openTallerModal === "function" &&
      typeof w.__abrirVisorAntesDespues === "function",
  );
  if (!lista) {
    console.error("[demo registro-ficha] la app no terminó de cargar");
    return;
  }
  if (w.__cloudSession) {
    console.warn("[demo registro-ficha] hay una sesión real abierta: la demo no corre");
    return;
  }

  // Frontera con la nube y con el disco: dobles que NO escriben.
  cortarRedExterna();
  w.saveTallerDB = async () => {};
  w.__cloudReplaceTaller = async () => {};
  w.__cloudSyncTaller = async (arr: unknown[]) => ({ ok: arr.length, errors: [] });
  w.__cloudHydrate = async () => ({});
  w.__urlFotoPartida = async (k: string) => FOTOS[k] ?? null;

  w.__cloudSession = {
    username: "demo@ejemplo.test",
    email: "demo@ejemplo.test",
    tenantId: "demo",
    groups: ["admin"],
    sucursal: "",
  };
  llamar("applyRolePermissions");
  // Lo que publicaría la hidratación, que con ?e2e=1 no corre: las MISMAS funciones reales.
  w.__visitaKeyDe = visitaKeyDe;
  w.__MOTIVOS_RECHAZO = MOTIVOS_RECHAZO;
  w.__gastoDerivado = gastoDerivado;
  w.__montoPendienteDeFirma = montoPendienteDeFirma;
  w.__pendientesDeFirma = pendientesDeFirma;
  w.__ordenarHallazgos = ordenarHallazgos;
  w.__hayCambios = hayCambios;
  w.__fichaRegistro = (
    e: unknown,
    ps: Partida[],
    o: { hibrido: boolean | undefined; confiables: boolean },
  ) =>
    fichaRegistro(e as Parameters<typeof fichaRegistro>[0], ps, {
      ahora: new Date().toISOString(),
      hibrido: o.hibrido,
      confiables: o.confiables,
    });
  // El directorio "llega" 2 s después, como en la nube: primero el respaldo y luego el nombre.
  let directorio: Directorio | null = null;
  w.__nombreDeUsuario = (c: string) => nombreDeUsuario(c, directorio, YO);
  w.__describirRevocadaPor = (c: string) => describirRevocadaPor(c, directorio, YO);
  w.__directorioUsuarios = {
    cargar: () =>
      new Promise<boolean>((r) =>
        setTimeout(() => {
          directorio = DIRECTORIO;
          r(true);
        }, 2000),
      ),
  };
  // Doble LOCAL de la firma: cambia la partida en memoria. El botón de la fila ya llama a
  // __cloudHydrate (doble) y a _bnRepintar después, así que aquí no se repinta.
  w.__guardarDecisionPartida = async (
    partidaId: string,
    visitaKey: string,
    decision: "autorizar" | "rechazar",
    motivo?: string,
    nota?: string,
  ) => {
    const mapa = w.__tallerPartidas as Map<string, Partida[]>;
    const ps = mapa.get(visitaKey) ?? [];
    const i = ps.findIndex((x) => x.partidaId === partidaId);
    if (i < 0) return;
    const cuando = new Date().toISOString();
    ps[i] =
      decision === "autorizar"
        ? autorizar(ps[i]!, "demo@ejemplo.test", cuando)
        : rechazar(ps[i]!, motivo ?? "Otro", nota, "demo@ejemplo.test", cuando);
  };
  w.__tallerHibrido = true;
  w.__tallerHibridoDesconocido = false;
  w.__tallerPartidasCargadas = true;
  w.__anuladasActivas = new Map();
  llamar("applyTallerHibridoGate");

  const base = {
    brand: "Nissan NP300 (demo)",
    sucursal: "GDL",
    area: "Mantenimiento",
    tipo: "Correctivo",
    km: 85000,
    tecnico: "Taller Frenos del Bajío (demo)",
    comentario: "DEMO — datos inventados",
    updatedAt: new Date().toISOString(),
  };
  const visitas = [
    {
      ...base,
      id: "demo-v1",
      unitKey: "demo-u06",
      eco: "06",
      plate: "PRB0006",
      estado: "En Reparación",
      fentrada: dia(-5),
      freporte: dia(-5),
      fsalidaEst: dia(1),
      fsalidaReal: "",
      estadoOperativo: "reparando",
      kmTaller: 85120,
      fsalidaEstTaller: dia(2),
      ligaVersion: 1,
      ligaCreadaEn: iso(-5),
      ligaCreadaPor: SUB_ANA,
    },
    {
      ...base,
      id: "demo-v2",
      unitKey: "demo-u07",
      eco: "07",
      plate: "PRB0007",
      estado: "En Diagnóstico",
      fentrada: dia(-1),
      freporte: dia(-1),
      fsalidaEst: "",
      fsalidaReal: "",
      tecnico: "",
    },
    {
      ...base,
      id: "demo-v3",
      unitKey: "demo-u08",
      eco: "08",
      plate: "PRB0008",
      estado: "Finalizado",
      fentrada: dia(-12),
      freporte: dia(-12),
      fsalidaEst: dia(-8),
      fsalidaReal: dia(-7),
      ligaVersion: 2,
      ligaCreadaEn: iso(-12),
      ligaCreadaPor: SUB_ANA,
      ligaRevocadaEn: iso(-7),
      ligaRevocadaPor: "cierre:ana@ejemplo.test",
    },
    {
      ...base,
      id: "demo-v4",
      unitKey: "demo-u09",
      eco: "09",
      plate: "PRB0009",
      estado: "En Reparación",
      fentrada: dia(-9),
      freporte: dia(-9),
      fsalidaEst: dia(-2),
      fsalidaReal: "",
      estadoOperativo: "esperandoRefaccion",
      kmTaller: 120400,
      fsalidaEstTaller: dia(-1),
      fsalidaEstCompromiso: dia(-3),
      ligaVersion: 2,
      ligaCreadaEn: iso(-9),
      ligaCreadaPor: SUB_LUIS,
      ligaRevocadaEn: iso(-1),
      ligaRevocadaPor: SUB_ANA,
    },
    {
      ...base,
      id: "demo-v5",
      unitKey: "demo-u10",
      eco: "10",
      plate: "PRB0010",
      estado: "Finalizado",
      fentrada: dia(-40),
      freporte: dia(-40),
      fsalidaEst: dia(-35),
      fsalidaReal: dia(-34),
      ligaVersion: 1,
      ligaCreadaEn: iso(-40),
      ligaCreadaPor: SUB_NADIE,
    },
  ];
  w.tallerEntries = visitas;
  const vk = (v: unknown): string => llamar("__visitaKeyDe", v) as string;
  const pb = (v: (typeof visitas)[number], id: string, s: Partial<Partida>): Partida =>
    ({
      visitaKey: vk(v),
      creadoPor: `liga:${v.plate}|${v.fentrada}`,
      creadoEn: iso(-4),
      propuestoEn: iso(-4),
      decididoPor: SUB_ANA,
      decididoEn: iso(-3),
      evidenciaFinal: [],
      partidaId: id,
      ...s,
    }) as Partida;
  const v1 = visitas[0]!;
  const v4 = visitas[3]!;
  w.__tallerPartidas = new Map<string, Partida[]>([
    [
      vk(v1),
      [
        pb(v1, "d-1", {
          descripcion: "Balatas delanteras desgastadas",
          tipo: "refaccion",
          precio: 1850,
          precioAutorizado: 1850,
          estado: "autorizada",
          fotos: ["demo/antes-balatas-delanteras.png"],
        }),
        pb(v1, "d-2", {
          descripcion: "Balatas traseras",
          tipo: "refaccion",
          precio: 1650,
          precioAutorizado: 1650,
          estado: "terminada",
          fotos: ["demo/antes-balatas-traseras.png"],
          evidenciaFinal: [
            "demo/despues-balatas-traseras-1.png",
            "demo/despues-balatas-traseras-2.png",
          ],
          terminadoEn: iso(-2),
        }),
        pb(v1, "d-3", {
          descripcion: "Ajuste de freno de mano",
          tipo: "manoObra",
          precio: 350,
          precioAutorizado: 350,
          estado: "terminada",
          fotos: [],
          terminadoEn: iso(-2),
        }),
        pb(v1, "d-4", {
          descripcion: "Amortiguador trasero con fuga",
          tipo: "refaccion",
          precio: 2400,
          estado: "propuesta",
          fotos: ["demo/antes-amortiguador.png"],
          decididoPor: undefined,
          decididoEn: undefined,
        }),
      ],
    ],
    [
      vk(v4),
      [
        pb(v4, "d-5", {
          descripcion: "Bomba de agua",
          tipo: "refaccion",
          precio: 3100,
          estado: "propuesta",
          fotos: ["demo/antes-bomba.png"],
          decididoPor: undefined,
          decididoEn: undefined,
        }),
      ],
    ],
  ]);

  const nav = document.getElementById("mainnav");
  if (nav) nav.style.display = "flex";
  const ldr = document.getElementById("ldr");
  if (ldr) ldr.style.display = "none";
  const dz = document.getElementById("dz");
  if (dz) dz.style.display = "none";
  avisoDemo();
  selectorDemo();
  recordarRegistroAbierto();
  llamar("showView", "taller");
  llamar("tlSwitch", "activas");
  llamar("renderTaller");
  llamar("openTallerModal", v1.id);
}
