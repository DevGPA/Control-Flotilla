/**
 * Visor de fotos del taller. Un solo overlay reutilizado por el registro de la
 * unidad y por la bandeja de entrada.
 *
 * Reglas del repo que aplican aquí: cero `innerHTML` (todo createElement +
 * textContent) y las URLs son FIRMADAS y por demanda — la misma función que ya
 * usa la miniatura de la bandeja, nunca un índice del bucket.
 */
const ID = "taller-visor-fotos";

/** Limpieza de la instancia viva. Abrir un visor cierra el anterior DE VERDAD:
 *  quitar el nodo no basta, su escucha de teclado sobrevive en `document`. */
let cerrarActual: (() => void) | null = null;

export function abrirVisorFotos(opts: {
  llaves: readonly string[];
  inicial?: number;
  titulo?: string;
  subtitulo?: string;
  url: (llave: string) => Promise<string | null>;
}): void {
  const { llaves, titulo, subtitulo, url } = opts;
  if (!llaves.length) return;
  cerrarActual?.();

  let i = Math.min(Math.max(opts.inicial ?? 0, 0), llaves.length - 1);
  const devolverFoco = document.activeElement as HTMLElement | null;
  let generacion = 0;

  const overlay = document.createElement("div");
  overlay.id = ID;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Fotos del taller");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(11,15,25,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px";

  const cabecera = document.createElement("div");
  cabecera.style.cssText =
    "position:absolute;top:16px;left:24px;right:24px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px";
  const textos = document.createElement("div");
  textos.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0";
  const t1 = document.createElement("span");
  t1.style.cssText = "font-size:13px;font-weight:700;color:#e2e8f0";
  t1.textContent = titulo ?? "Foto del taller";
  const t2 = document.createElement("span");
  t2.style.cssText = "font-size:11px;color:#94a3b8";
  textos.append(t1, t2);

  const btnCerrar = document.createElement("button");
  btnCerrar.type = "button";
  btnCerrar.setAttribute("aria-label", "Cerrar");
  btnCerrar.textContent = "✕";
  btnCerrar.style.cssText =
    "min-width:44px;min-height:44px;border-radius:6px;border:1px solid rgba(148,170,205,.25);background:transparent;color:#e2e8f0;cursor:pointer;font-size:14px";
  cabecera.append(textos, btnCerrar);

  const img = document.createElement("img");
  img.alt = "Foto del taller";
  img.style.cssText =
    "max-width:90vw;max-height:78vh;object-fit:contain;border-radius:10px;background:#1a2234";
  const aviso = document.createElement("div");
  aviso.style.cssText = "font-size:11px;color:#94a3b8";

  const fila = document.createElement("div");
  fila.style.cssText = "display:flex;align-items:center;gap:18px";
  const flecha = (etiqueta: string, paso: number): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", etiqueta);
    b.textContent = paso < 0 ? "‹" : "›";
    b.style.cssText =
      "min-width:44px;min-height:44px;border-radius:22px;border:none;background:rgba(226,232,240,.12);color:#e2e8f0;font-size:20px;cursor:pointer";
    b.addEventListener("click", () => mover(paso));
    b.style.visibility = llaves.length > 1 ? "visible" : "hidden";
    return b;
  };
  fila.append(flecha("Foto anterior", -1), img, flecha("Foto siguiente", 1));

  overlay.append(cabecera, fila, aviso);

  function pintar(): void {
    const gen = ++generacion;
    t2.textContent = `${subtitulo ? subtitulo + " · " : ""}foto ${i + 1} de ${llaves.length}`;
    img.removeAttribute("src");
    aviso.textContent = "Cargando…";
    const llave = llaves[i] as string;
    void url(llave)
      .then((u) => {
        // Respuesta vieja: el usuario ya avanzo/retrocedio (o cerro). Se descarta.
        if (gen !== generacion) return;
        if (!u) {
          aviso.textContent = "Foto no disponible";
          return;
        }
        img.src = u;
        aviso.textContent = "";
      })
      .catch(() => {
        if (gen !== generacion) return;
        aviso.textContent = "Foto no disponible";
      });
  }

  function mover(paso: number): void {
    i = (i + paso + llaves.length) % llaves.length;
    pintar();
  }

  function cerrar(): void {
    if (cerrarActual === cerrar) cerrarActual = null;
    generacion++; // invalida cualquier respuesta de pintar() que siga en vuelo
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    devolverFoco?.focus?.();
  }
  cerrarActual = cerrar;

  // Trampa de foco (spec §6.3): mientras el visor está abierto, Tab no debe
  // escapar hacia el modal de abajo. Los controles focusables del overlay son
  // sus botones — las flechas se ocultan (visibility:hidden) cuando solo hay
  // una foto, y esas NO cuentan para el ciclo.
  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") cerrar();
    else if (ev.key === "ArrowRight") mover(1);
    else if (ev.key === "ArrowLeft") mover(-1);
    else if (ev.key === "Tab") {
      const focos = Array.from(overlay.querySelectorAll("button")).filter(
        (b) => b.style.visibility !== "hidden",
      );
      if (!focos.length) return;
      const primero = focos[0]!;
      const ultimo = focos[focos.length - 1]!;
      const activo = document.activeElement;
      const dentro = activo != null && overlay.contains(activo);
      if (ev.shiftKey) {
        if (!dentro || activo === primero) {
          ev.preventDefault();
          ultimo.focus();
        }
      } else if (!dentro || activo === ultimo) {
        ev.preventDefault();
        primero.focus();
      }
    }
  }

  btnCerrar.addEventListener("click", cerrar);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) cerrar();
  });
  document.addEventListener("keydown", onKey);

  document.body.appendChild(overlay);
  img.onerror = () => {
    aviso.textContent = "Foto no disponible";
  };
  pintar();
  btnCerrar.focus();
}

export type GrupoFotos = { llaves: readonly string[]; fecha?: string };

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * "14 sep" desde una fecha ISO. Una fecha SOLA (YYYY-MM-DD) se lee tal cual: `new Date`
 * la tomaría como medianoche UTC y en México saldría el día anterior. Un instante ISO usa
 * el día local. Ausente o inválida ⇒ "" (nunca "Invalid Date").
 */
export function fechaCorta(iso: string | null | undefined): string {
  const s = String(iso ?? "").trim();
  if (!s) return "";
  const sola = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (sola) {
    const mes = MESES[Number(sola[2]) - 1];
    return mes ? `${Number(sola[3])} ${mes}` : "";
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

const ID_ANTES_DESPUES = "taller-visor-antes-despues";

/** Una columna del A+: foto grande, leyenda y tira de miniaturas que cambia SOLO su lado. */
function columnaGrupo(
  etiqueta: "ANTES" | "DESPUÉS",
  color: string,
  g: GrupoFotos,
  url: (llave: string) => Promise<string | null>,
  alCerrar: Array<() => void>,
): HTMLElement {
  const lado = etiqueta === "ANTES" ? "antes" : "despues";
  const col = document.createElement("div");
  col.style.cssText = "display:flex;flex-direction:column;gap:8px;min-width:0";

  const marco = document.createElement("div");
  marco.style.cssText =
    "flex:1;min-height:240px;border-radius:10px;background:#1a2234;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative";
  const img = document.createElement("img");
  img.dataset.lado = lado;
  img.alt = `Foto de ${etiqueta === "ANTES" ? "antes" : "después"}`;
  img.style.cssText = "max-width:100%;max-height:70vh;object-fit:contain";
  const aviso = document.createElement("span");
  aviso.style.cssText = "font-size:12px;color:#94a3b8;position:absolute";
  marco.append(img, aviso);

  const n = g.llaves.length;
  const leyenda = document.createElement("div");
  leyenda.style.cssText = `font-size:11px;font-weight:800;letter-spacing:.05em;color:${color}`;
  leyenda.textContent = [
    etiqueta,
    fechaCorta(g.fecha),
    n ? `${n} foto${n === 1 ? "" : "s"}` : "sin foto",
  ]
    .filter(Boolean)
    .join(" · ");
  col.append(marco, leyenda);

  if (!n) {
    img.style.display = "none";
    aviso.textContent = "Sin foto";
    return col;
  }

  let generacion = 0;
  alCerrar.push(() => {
    generacion++; // invalida respuestas en vuelo
  });
  const pintar = (i: number): void => {
    const gen = ++generacion;
    img.removeAttribute("src");
    aviso.textContent = "Cargando…";
    void url(g.llaves[i] as string)
      .then((u) => {
        if (gen !== generacion) return;
        if (!u) {
          aviso.textContent = "Foto no disponible";
          return;
        }
        img.src = u;
        aviso.textContent = "";
      })
      .catch(() => {
        if (gen !== generacion) return;
        aviso.textContent = "Foto no disponible";
      });
  };
  img.onerror = () => {
    aviso.textContent = "Foto no disponible";
  };

  if (n > 1) {
    const tira = document.createElement("div");
    tira.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
    const botones: HTMLButtonElement[] = [];
    const marcar = (i: number): void => {
      botones.forEach((b, j) => {
        b.style.borderColor = j === i ? "#60a5fa" : "transparent";
        b.setAttribute("aria-pressed", j === i ? "true" : "false");
      });
    };
    g.llaves.forEach((llave, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.miniatura = lado;
      b.setAttribute(
        "aria-label",
        `${lado === "antes" ? "antes" : "después"}: foto ${i + 1} de ${n}`,
      );
      b.style.cssText =
        "width:56px;height:44px;padding:0;border-radius:8px;border:2px solid transparent;background:rgba(226,232,240,.12);color:#e2e8f0;cursor:pointer;overflow:hidden;font-weight:700";
      b.textContent = String(i + 1);
      void url(llave)
        .then((u) => {
          if (!u) return;
          const mini = document.createElement("img");
          mini.alt = "";
          mini.src = u;
          mini.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
          b.replaceChildren(mini);
        })
        .catch(() => {
          // Se queda el número: la miniatura es cortesía, la foto grande manda.
        });
      b.addEventListener("click", () => {
        marcar(i);
        pintar(i);
      });
      botones.push(b);
      tira.appendChild(b);
    });
    marcar(0);
    col.appendChild(tira);
  }
  pintar(0);
  return col;
}

/**
 * Visor A+ (spec 2026-09-28 §6.4, decisión 7): ANTES y DESPUÉS lado a lado, cada lado con
 * su foto grande, su leyenda ("ANTES · 14 sep · 2 fotos") y su tira de miniaturas. Es el
 * mismo overlay de pantalla completa que el visor simple (trampa de foco, Esc, un solo
 * visor vivo): abrir uno cierra el otro. Un lado sin fotos dice "Sin foto".
 * Reglas del repo: cero innerHTML; URLs firmadas por demanda con la misma `url`.
 */
export function abrirVisorAntesDespues(opts: {
  antes: GrupoFotos;
  despues: GrupoFotos;
  titulo?: string;
  subtitulo?: string;
  url: (llave: string) => Promise<string | null>;
}): void {
  const { antes, despues, titulo, subtitulo, url } = opts;
  if (!antes.llaves.length && !despues.llaves.length) return;
  cerrarActual?.();
  const devolverFoco = document.activeElement as HTMLElement | null;

  const overlay = document.createElement("div");
  overlay.id = ID_ANTES_DESPUES;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Antes y después del hallazgo");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(11,15,25,.92);display:flex;flex-direction:column;gap:12px;padding:16px 24px;overflow:auto";

  const cabecera = document.createElement("div");
  cabecera.style.cssText =
    "display:flex;align-items:flex-start;justify-content:space-between;gap:12px";
  const textos = document.createElement("div");
  textos.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0";
  const t1 = document.createElement("span");
  t1.style.cssText = "font-size:13px;font-weight:700;color:#e2e8f0";
  t1.textContent = titulo ?? "Antes y después";
  const t2 = document.createElement("span");
  t2.style.cssText = "font-size:11px;color:#94a3b8";
  t2.textContent = subtitulo ?? "";
  textos.append(t1, t2);
  const btnCerrar = document.createElement("button");
  btnCerrar.type = "button";
  btnCerrar.setAttribute("aria-label", "Cerrar");
  btnCerrar.textContent = "✕";
  btnCerrar.style.cssText =
    "min-width:44px;min-height:44px;border-radius:6px;border:1px solid rgba(148,170,205,.25);background:transparent;color:#e2e8f0;cursor:pointer;font-size:14px";
  cabecera.append(textos, btnCerrar);

  const alCerrar: Array<() => void> = [];
  const columnas = document.createElement("div");
  columnas.style.cssText =
    "display:grid;grid-template-columns:1fr 1fr;gap:16px;flex:1;min-height:0";
  columnas.append(
    columnaGrupo("ANTES", "#fda4af", antes, url, alCerrar),
    columnaGrupo("DESPUÉS", "#86efac", despues, url, alCerrar),
  );
  overlay.append(cabecera, columnas);

  function cerrar(): void {
    if (cerrarActual === cerrar) cerrarActual = null;
    alCerrar.forEach((f) => f());
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    devolverFoco?.focus?.();
  }
  cerrarActual = cerrar;

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") cerrar();
    else if (ev.key === "Tab") {
      const focos = Array.from(overlay.querySelectorAll("button"));
      if (!focos.length) return;
      const primero = focos[0]!;
      const ultimo = focos[focos.length - 1]!;
      const activo = document.activeElement;
      const dentro = activo != null && overlay.contains(activo);
      if (ev.shiftKey) {
        if (!dentro || activo === primero) {
          ev.preventDefault();
          ultimo.focus();
        }
      } else if (!dentro || activo === ultimo) {
        ev.preventDefault();
        primero.focus();
      }
    }
  }

  btnCerrar.addEventListener("click", cerrar);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) cerrar();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  btnCerrar.focus();
}
