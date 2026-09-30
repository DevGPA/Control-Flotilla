// Vista LOCAL de Fleet — antes y después por hallazgo (spec 2026-09-28 §8.1).
//
// SOLO corre con `npm run dev` y la URL ?e2e=1&demo=antes-despues: main.ts la importa
// detrás de `import.meta.env.DEV`, así que nunca entra al build de producción. Siembra
// UNA visita INVENTADA con hallazgos en cada estado y abre su registro, para ver la
// fila, el visor A+ y el aviso al dar salida con las funciones REALES de la app.
// Todo lo que tocaría la nube o el disco es un doble que no escribe nada: ni DynamoDB,
// ni S3, ni el IndexedDB local.
import { visitaKeyDe } from "../api/tallerPartidas";
import {
  MOTIVOS_RECHAZO,
  gastoDerivado,
  montoPendienteDeFirma,
  pendientesDeFirma,
} from "../taller/partidas";

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

// Un dibujo DISTINTO por llave: si dos llaves compartieran imagen, tocar la miniatura 2
// no cambiaría la foto grande y la demo (y su prueba) no dejarían ver que la tira funciona.
const gastado = (texto: string) => dibujo("#3f3a36", "#8a5a33", 4, texto, "#fca5a5");
const nuevo = (texto: string) => dibujo("#334155", "#cbd5e1", 12, texto, "#bbf7d0");
const FOTOS: Record<string, string> = {
  "demo/antes-balatas-delanteras.png": gastado("delanteras · balata 2 mm · disco rayado"),
  "demo/antes-balatas-traseras.png": gastado("traseras · balata 2 mm · disco rayado"),
  "demo/despues-balatas-traseras-1.png": nuevo("balata nueva 12 mm · vista 1"),
  "demo/despues-balatas-traseras-2.png": nuevo("balata nueva 12 mm · vista 2"),
  "demo/antes-amortiguador.png": gastado("amortiguador · fuga de aceite"),
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
// En el navegador normal puede haber tokens de Cognito guardados de un login anterior en
// localhost, y la sesión admin de mentira abre en la UI caminos que escriben directo con el
// cliente de Amplify, sin pasar por los puentes de arriba (Accesorios, la captura manual de
// hallazgos). Amplify habla por fetch (Cognito, AppSync) y por XHR (subidas a S3).
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
    new TypeError(`[demo antes-despues] red externa bloqueada: ${String(u)}`);
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

// Pegado ARRIBA y sin atrapar clics: abajo tapaba los botones del pie del registro
// (✓ Finalizar, Guardar) y el "Pantalla completa" del ANTES en el visor A+.
function avisoDemo(): void {
  const b = document.createElement("div");
  b.id = "demo-antes-despues";
  b.setAttribute("role", "status");
  b.style.cssText =
    "position:fixed;left:50%;top:0;transform:translateX(-50%);z-index:10000;max-width:calc(100vw - 24px);pointer-events:none;background:#b45309;color:#fff;font:600 11px system-ui;padding:3px 12px;border-radius:0 0 8px 8px;box-shadow:0 4px 12px rgba(0,0,0,.25)";
  b.textContent =
    "MODO DEMO · datos inventados · nada se guarda · abre «Autorizadas» en la lista de hallazgos";
  document.body.appendChild(b);
}

export async function montarDemo(): Promise<void> {
  const lista = await esperar(
    () =>
      typeof w.renderTaller === "function" &&
      typeof w.openTallerModal === "function" &&
      typeof w.__abrirVisorAntesDespues === "function" &&
      typeof w.__avisoSinDespues === "function",
  );
  if (!lista) {
    console.error("[demo antes-despues] la app no terminó de cargar");
    return;
  }
  if (w.__cloudSession) {
    console.warn("[demo antes-despues] hay una sesión real abierta: la demo no corre");
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
    email: "demo@ejemplo.test",
    tenantId: "demo",
    groups: ["admin"],
    sucursal: "",
  };
  llamar("applyRolePermissions");
  // Lo que publicaría la hidratación, que con ?e2e=1 no corre: estos puentes solo los
  // publica hydrateFromCloud (src/api/cloudHydrate.ts). Van las MISMAS funciones reales
  // que pinta el registro: la llave de la visita, los motivos del rechazo (sin ellos la
  // fila de la propuesta revienta), el gasto derivado de #tf-gasto y las pendientes de
  // firma del aviso de "✓ Finalizar". __guardarDecisionPartida NO: escribe en la nube.
  w.__visitaKeyDe = visitaKeyDe;
  w.__MOTIVOS_RECHAZO = MOTIVOS_RECHAZO;
  w.__gastoDerivado = gastoDerivado;
  w.__montoPendienteDeFirma = montoPendienteDeFirma;
  w.__pendientesDeFirma = pendientesDeFirma;
  w.__tallerHibrido = true;
  w.__tallerHibridoDesconocido = false;
  w.__tallerPartidasCargadas = true;
  w.__anuladasActivas = new Map();
  llamar("applyTallerHibridoGate");

  const entry = {
    id: "demo-antes-despues",
    unitKey: "demo-antes-despues",
    eco: "06",
    plate: "PRB0006",
    brand: "Nissan NP300 (demo)",
    sucursal: "GDL",
    area: "Mantenimiento",
    tipo: "Correctivo",
    estado: "En Reparación",
    km: 85000,
    fentrada: "2026-09-14",
    freporte: "2026-09-14",
    fsalidaEst: "2026-09-20",
    fsalidaReal: "",
    tecnico: "Taller de ejemplo",
    comentario: "DEMO — datos inventados",
    updatedAt: new Date().toISOString(),
  };
  w.tallerEntries = [entry];
  const vk = llamar("__visitaKeyDe", entry) as string;
  const base = {
    visitaKey: vk,
    creadoPor: "liga:PRB0006|2026-09-14",
    creadoEn: "2026-09-14T16:00:00.000Z",
    propuestoEn: "2026-09-14T17:00:00.000Z",
    decididoPor: "riesgos@ejemplo.test",
    decididoEn: "2026-09-15T10:00:00.000Z",
    evidenciaFinal: [] as string[],
  };
  w.__tallerPartidas = new Map([
    [
      vk,
      [
        {
          ...base,
          partidaId: "d-1",
          descripcion: "Balatas delanteras desgastadas",
          tipo: "refaccion",
          precio: 1850,
          precioAutorizado: 1850,
          estado: "autorizada",
          fotos: ["demo/antes-balatas-delanteras.png"],
        },
        {
          ...base,
          partidaId: "d-2",
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
          terminadoEn: "2026-09-16T15:00:00.000Z",
        },
        {
          ...base,
          partidaId: "d-3",
          descripcion: "Ajuste de freno de mano",
          tipo: "manoObra",
          precio: 350,
          precioAutorizado: 350,
          estado: "terminada",
          fotos: [],
          terminadoEn: "2026-09-16T16:00:00.000Z",
        },
        {
          ...base,
          partidaId: "d-4",
          descripcion: "Amortiguador trasero con fuga",
          tipo: "refaccion",
          precio: 2400,
          estado: "propuesta",
          fotos: ["demo/antes-amortiguador.png"],
          decididoPor: undefined,
          decididoEn: undefined,
        },
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
  llamar("showView", "taller");
  llamar("tlSwitch", "activas");
  llamar("renderTaller");
  llamar("openTallerModal", entry.id);
}
