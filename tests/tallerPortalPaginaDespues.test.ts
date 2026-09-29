// Antes y después en la LIGA (spec 2026-09-28 §5): se EJECUTA el <script> real que
// sirve paginaProveedor() dentro de happy-dom, con fetch simulado. Nada de copias del
// script: si la página cambia, esta prueba ve el cambio.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paginaProveedor } from "../amplify/functions/taller-portal/pagina";

type P = Record<string, unknown>;

const PAGINA = paginaProveedor("tok");
const SCRIPT = PAGINA.slice(PAGINA.indexOf("<script>") + 8, PAGINA.lastIndexOf("</script>"));
const META = /<meta id="pt-token"[^>]*>/.exec(PAGINA)![0];
const CUERPO = PAGINA.slice(PAGINA.indexOf("<body>") + 6, PAGINA.indexOf("<script>"));

let llamadas: { url: string; metodo: string; body: unknown }[] = [];
let respuestaTerminar: { status: number; body: unknown } = { status: 200, body: {} };
const fetchOriginal = globalThis.fetch;

const partida = (sobre: P): P => ({
  partidaId: "p-1",
  descripcion: "Balatas delanteras",
  tipo: "refaccion",
  precio: 1850,
  precioAutorizado: 1850,
  estado: "autorizada",
  motivoRechazo: null,
  fotos: ["k-antes.jpg"],
  evidenciaFinal: [],
  terminadoEn: null,
  ...sobre,
});

async function asentar() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

async function montar(partidas: P[]) {
  const datos = {
    unidad: { eco: "E-01", placa: "AAA111", submarca: "X", sucursal: "Y", area: "Z" },
    visita: {
      tipo: "Correctivo",
      fechaEntrada: "2026-09-01",
      km: 85000,
      estadoOperativo: "reparando",
      fsalidaEst: "2026-09-20",
    },
    partidas,
  };
  // eslint-disable-next-line no-restricted-syntax -- montaje de prueba con el HTML REAL servido
  document.head.innerHTML = META;
  // eslint-disable-next-line no-restricted-syntax -- idem
  document.body.innerHTML = CUERPO;
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const metodo = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    llamadas.push({ url: u, metodo, body });
    const resp = (b: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => b }) as unknown as Response;
    if (u.startsWith("/api/visita")) return resp(datos);
    if (u.startsWith("/api/foto")) return resp({ url: "https://ejemplo.test/foto.jpg" });
    if (u.startsWith("/api/terminar"))
      return resp(respuestaTerminar.body, respuestaTerminar.status);
    return resp({ error: "no encontrado" }, 404);
  }) as unknown as typeof fetch;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- se ejecuta el script REAL servido
  new Function(SCRIPT)();
  await asentar();
}

const tarjeta = (desc: string): HTMLElement => {
  const t = Array.from(document.querySelectorAll<HTMLElement>(".hallazgo")).find((n) =>
    (n.textContent ?? "").includes(desc),
  );
  if (!t) throw new Error(`no hay tarjeta "${desc}"`);
  return t;
};
const boton = (raiz: ParentNode, texto: string) =>
  Array.from(raiz.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    (b.textContent ?? "").includes(texto),
  );

beforeEach(() => {
  llamadas = [];
  respuestaTerminar = { status: 200, body: {} };
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("liga · refacción autorizada", () => {
  it("ofrece subir la foto del trabajo terminado, no un 'terminar' directo", async () => {
    await montar([partida({})]);
    const t = tarjeta("Balatas delanteras");
    expect(boton(t, "Subir foto del trabajo terminado")).toBeDefined();
    expect(boton(t, "Marcar como terminado")).toBeUndefined();
  });

  it("al abrir el panel, 'Marcar como terminado' nace deshabilitado y la regla se ve", async () => {
    await montar([partida({})]);
    boton(tarjeta("Balatas delanteras"), "Subir foto del trabajo terminado")!.click();
    const t = tarjeta("Balatas delanteras");
    expect(boton(t, "Marcar como terminado")!.disabled).toBe(true);
    expect(t.textContent).toContain("Una refacción necesita al menos una foto de la pieza nueva.");
  });
});

describe("liga · mano de obra autorizada", () => {
  const mo = () =>
    partida({
      partidaId: "mo-1",
      descripcion: "Ajuste de freno de mano",
      tipo: "manoObra",
      precio: 350,
      precioAutorizado: 350,
      fotos: [],
    });

  it("ofrece terminar directo y la foto como opcional", async () => {
    await montar([mo()]);
    const t = tarjeta("Ajuste de freno");
    expect(boton(t, "Marcar como terminado")).toBeDefined();
    expect(boton(t, "Agregar foto (opcional)")).toBeDefined();
  });

  it("terminar manda POST /api/terminar con fotos vacías y la tarjeta queda Terminada", async () => {
    respuestaTerminar = {
      status: 200,
      body: {
        partidaId: "mo-1",
        estado: "terminada",
        evidenciaFinal: [],
        terminadoEn: "2026-09-16T15:00:00.000Z",
      },
    };
    await montar([mo()]);
    boton(tarjeta("Ajuste de freno"), "Marcar como terminado")!.click();
    await asentar();
    const post = llamadas.find((l) => l.url.startsWith("/api/terminar"));
    expect(post?.metodo).toBe("POST");
    expect(post?.body).toEqual({ partidaId: "mo-1", fotos: [] });
    const t = tarjeta("Ajuste de freno");
    expect(t.textContent).toContain("Terminada");
    expect(t.textContent).toContain("Este hallazgo ya no se puede cambiar.");
    // Sin foto del después: el lado DESPUÉS lo dice.
    expect(t.textContent).toContain("Sin foto");
  });

  it("409 ⇒ avisa que ya estaba terminado y recarga la visita", async () => {
    respuestaTerminar = { status: 409, body: { error: "ya terminado" } };
    await montar([mo()]);
    const antes = llamadas.filter((l) => l.url.startsWith("/api/visita")).length;
    boton(tarjeta("Ajuste de freno"), "Marcar como terminado")!.click();
    await asentar();
    expect(llamadas.filter((l) => l.url.startsWith("/api/visita")).length).toBe(antes + 1);
  });

  it("falla de red ⇒ 'No se pudo enviar' y el botón se puede volver a tocar", async () => {
    respuestaTerminar = { status: 500, body: { error: "error interno" } };
    await montar([mo()]);
    const b = boton(tarjeta("Ajuste de freno"), "Marcar como terminado")!;
    b.click();
    await asentar();
    expect(tarjeta("Ajuste de freno").textContent).toContain("No se pudo enviar");
    expect(b.disabled).toBe(false);
  });
});

describe("liga · terminada, propuesta y demás estados", () => {
  it("terminada muestra ANTES y DESPUÉS y que ya no se puede cambiar", async () => {
    await montar([
      partida({
        estado: "terminada",
        evidenciaFinal: ["k-despues.jpg"],
        terminadoEn: "2026-09-16T15:00:00.000Z",
      }),
    ]);
    const t = tarjeta("Balatas delanteras");
    const pies = Array.from(t.querySelectorAll("figcaption")).map((f) => f.textContent);
    expect(pies).toEqual(["ANTES", "DESPUÉS"]);
    expect(t.textContent).toContain("Este hallazgo ya no se puede cambiar.");
    expect(boton(t, "Subir foto")).toBeUndefined();
    // Se pidió la URL firmada de la foto del después.
    expect(llamadas.some((l) => l.url.includes("key=k-despues.jpg"))).toBe(true);
  });

  it("propuesta explica que el botón aparece cuando GPA lo autorice", async () => {
    await montar([partida({ estado: "propuesta", precioAutorizado: null })]);
    const t = tarjeta("Balatas delanteras");
    expect(t.textContent).toContain("El botón del después aparece cuando GPA lo autorice.");
    expect(boton(t, "Subir foto")).toBeUndefined();
  });

  it.each(["borrador", "rechazada"])("%s no trae nada del después", async (estado) => {
    await montar([partida({ estado, precioAutorizado: null })]);
    const t = tarjeta("Balatas delanteras");
    expect(boton(t, "Subir foto")).toBeUndefined();
    expect(boton(t, "Marcar como terminado")).toBeUndefined();
    expect(t.querySelector("figcaption")).toBeNull();
  });
});

describe("liga · totales (Review Focus 1)", () => {
  it("terminar un hallazgo NO baja el total Autorizado", async () => {
    respuestaTerminar = {
      status: 200,
      body: {
        partidaId: "mo-1",
        estado: "terminada",
        evidenciaFinal: [],
        terminadoEn: "2026-09-16T15:00:00.000Z",
      },
    };
    await montar([
      partida({
        partidaId: "mo-1",
        descripcion: "Ajuste de freno de mano",
        tipo: "manoObra",
        precio: 350,
        precioAutorizado: 350,
        fotos: [],
      }),
      partida({
        partidaId: "p-2",
        descripcion: "Balatas traseras",
        estado: "terminada",
        precio: 1650,
        precioAutorizado: 1650,
        evidenciaFinal: ["k.jpg"],
      }),
    ]);
    const autorizado = () => document.getElementById("tot-autorizado")!.textContent;
    expect(autorizado()).toBe("$2,000.00");
    boton(tarjeta("Ajuste de freno"), "Marcar como terminado")!.click();
    await asentar();
    expect(autorizado()).toBe("$2,000.00");
  });
});

describe("liga · terminar OTRO hallazgo no cierra el panel del después ya abierto", () => {
  const refaccionA = () => partida({});
  const manoObraB = () =>
    partida({
      partidaId: "mo-1",
      descripcion: "Ajuste de freno de mano",
      tipo: "manoObra",
      precio: 350,
      precioAutorizado: 350,
      fotos: [],
    });

  it("200 en B: el panel abierto de A sigue abierto, con sus fotos", async () => {
    respuestaTerminar = {
      status: 200,
      body: {
        partidaId: "mo-1",
        estado: "terminada",
        evidenciaFinal: [],
        terminadoEn: "2026-09-16T15:00:00.000Z",
      },
    };
    await montar([refaccionA(), manoObraB()]);
    boton(tarjeta("Balatas delanteras"), "Subir foto del trabajo terminado")!.click();
    boton(tarjeta("Ajuste de freno"), "Marcar como terminado")!.click();
    await asentar();
    const a = tarjeta("Balatas delanteras");
    expect(a.textContent).toContain("Foto del trabajo terminado");
    expect(boton(a, "Marcar como terminado")!.disabled).toBe(true);
    expect(tarjeta("Ajuste de freno").textContent).toContain("Terminada");
  });

  it("409 en B: el panel de A sobrevive incluso al re-render de cargar()", async () => {
    respuestaTerminar = { status: 409, body: { error: "ya terminado" } };
    await montar([refaccionA(), manoObraB()]);
    boton(tarjeta("Balatas delanteras"), "Subir foto del trabajo terminado")!.click();
    boton(tarjeta("Ajuste de freno"), "Marcar como terminado")!.click();
    await asentar();
    const a = tarjeta("Balatas delanteras");
    expect(a.textContent).toContain("Foto del trabajo terminado");
    expect(boton(a, "Marcar como terminado")!.disabled).toBe(true);
  });
});
