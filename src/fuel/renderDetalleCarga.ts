/**
 * Detalle de una carga/solicitud con VALIDACIÓN DE EVIDENCIAS lado-a-lado (P0).
 * Pone el valor capturado junto a su foto, grande, con semáforo y acciones de
 * validar/discrepancia. DOM API segura (sin innerHTML con datos). Soporta Fase 1
 * (manual) y Fase 2 (IA pre-llena valorDetectado) con el mismo layout.
 */
import type {
  FuelEntry,
  FuelMetrics,
  FuelEvidenceKind,
  FuelVerdict,
  FuelPhoto,
  FuelStat,
} from "./types";
import type { RecorridoInfo } from "./fuelAnalysis";
import type { KmplVida } from "./fuelAnalysis";
import { MOTIVO_SIN_KMPL_LABEL, MOTIVO_SIN_KMPL_ACCIONABLE } from "./fuelAnalysis";
import { evidenceKindOf } from "./mapEntry";

const PESO = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat("es-MX");
const NUM1 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }); // litros: 1 decimal, igual que la tabla

export type RenderDetalleCargaDeps = {
  body: HTMLElement;
  titleEl?: HTMLElement | null;
  metaEl?: HTMLElement | null;
  load: FuelEntry;
  metrics?: FuelMetrics;
  /** km/l de referencia de su TIPO de unidad (para comparar el evento en el detalle). */
  statTipo?: FuelStat;
  /** km/l de referencia de su propia unidad (histórico). */
  statUnidad?: FuelStat;
  /** Recorrido del ciclo (solicitud → siguiente solicitud) de esta entrada. */
  recorrido?: RecorridoInfo;
  /** email del validador → nombre legible (para "Revisado por …"). */
  nombreValidador?: (email?: string | null) => string;
  resolveUrl: (fname: string) => string | null;
  /** Perf F3-3: fallback async cuando resolveUrl (mapa pre-firmado) no tiene la foto —
   *  con la hidratación por ventana, las evidencias de cargas viejas se firman
   *  on-demand al abrir el detalle (window.__cloudGetPhotoUrl). */
  resolveUrlAsync?: (fname: string) => Promise<string | null>;
  canWrite: boolean;
  onValidate: (
    loadId: string,
    kind: FuelEvidenceKind | "all",
    verdict: FuelVerdict,
    nota?: string,
  ) => void;
  /** Corrección del odómetro leída de la foto (kmDetectado); null = quitar. */
  onKmDetectado?: (loadId: string, km: number | null) => void;
  /** km/L de VIDA de la unidad (Σkm/Σlitros del histórico) — referencia robusta. */
  kmplVida?: KmplVida;
  onPhotoClick?: (url: string) => void;
  /** ¿La sesión es admin? (muestra Anular/Restaurar; el enforcement real es AppSync). */
  esAdmin?: boolean;
  /** Abre el flujo de anulación de este registro (solo admin). */
  onAnular?: () => void;
  /** Restaura este registro anulado (solo admin). */
  onRestaurar?: () => void;
};

const VERDICT_META: Record<FuelVerdict, { cls: string; txt: string }> = {
  ok: { cls: "fv-ok", txt: "✓ Coincide" },
  warn: { cls: "fv-warn", txt: "⚠ Revisar" },
  bad: { cls: "fv-bad", txt: "✕ No coincide" },
  pendiente: { cls: "fv-pend", txt: "• Pendiente" },
};

type Slot = {
  kind: FuelEvidenceKind;
  label: string;
  value: string;
  hint?: string;
  detected?: string;
  /** Origen del valor detectado: "ia" (visión) o "manual" (corregido en validación). */
  detectedFuente?: "manual" | "ia";
};

/** Construye los slots de evidencia (valor capturado + tipo de foto). */
function buildSlots(load: FuelEntry, metrics?: FuelMetrics): Slot[] {
  const slots: Slot[] = [];
  const kmStr = load.km != null ? `${NUM.format(load.km)} km` : "—";
  const kmHint =
    metrics && metrics.kmDesdeAnterior != null && metrics.kmDesdeAnterior < 0
      ? `⚠ El odómetro retrocede ${NUM.format(Math.abs(metrics.kmDesdeAnterior))} km vs la carga anterior`
      : undefined;
  slots.push({
    kind: "odometro",
    label: "Kilometraje / horómetro",
    value: kmStr,
    hint: kmHint,
    detected:
      load.review?.kmDetectado != null ? `${NUM.format(load.review.kmDetectado)} km` : undefined,
    detectedFuente: load.review?.fuenteDeteccion,
  });

  if (load.tipo === "carga") {
    slots.push({
      kind: "medidor",
      label: "Combustible cargado",
      value:
        load.litros != null
          ? `${NUM1.format(load.litros)} L${load.seLlenoTanque ? ` · tanque ${load.seLlenoTanque}` : ""}`
          : "—",
      detected:
        load.review?.litrosDetectado != null
          ? `${NUM1.format(load.review.litrosDetectado)} L`
          : undefined,
    });
    const dollarL =
      load.monto != null && load.litros ? PESO.format(load.monto / load.litros) + "/L" : "";
    slots.push({
      kind: "ticket",
      label: "Ticket / monto",
      value:
        load.monto != null ? `${PESO.format(load.monto)}${dollarL ? ` · ${dollarL}` : ""}` : "—",
    });
  } else {
    slots.push({
      kind: "medidor",
      label: "Nivel del tanque",
      value: `${load.nivelAntes ?? "—"} → ${load.nivelDeseado ?? "—"}${load.maxLitros != null ? ` · máx ${NUM.format(load.maxLitros)} L` : ""}`,
      detected: load.review?.nivelDetectado ?? undefined,
    });
  }
  return slots;
}

/**
 * Perf F3-3: pinta una foto del drawer tolerando que el mapa pre-firmado no la tenga
 * (hidratación por ventana → evidencias de cargas viejas se firman on-demand).
 * El click lee img.src al momento (la URL puede llegar async después del render).
 */
function wirePhoto(img: HTMLImageElement, fname: string, deps: RenderDetalleCargaDeps): void {
  const url = deps.resolveUrl(fname);
  if (url) {
    img.src = url;
  } else if (deps.resolveUrlAsync) {
    img.style.opacity = "0.35"; // placeholder tenue mientras se firma
    deps
      .resolveUrlAsync(fname)
      .then((u) => {
        if (u) {
          img.src = u;
          img.style.opacity = "";
        }
      })
      .catch(() => {
        /* firma falló — la foto queda como placeholder */
      });
  }
  img.addEventListener("click", () => {
    const current = img.src;
    if (!current) return;
    deps.onPhotoClick ? deps.onPhotoClick(current) : window.open(current, "_blank");
  });
}

function photosOfKind(load: FuelEntry, kind: FuelEvidenceKind): FuelPhoto[] {
  return load.photos.filter((p) => evidenceKindOf(p.col) === kind);
}

/**
 * Tarjeta "Cómo se calcula el rendimiento": la cadena odómetro ant.→actual = km ÷ litros = km/l
 * (con comparación vs su tipo/unidad), o —si no hay km/l— el motivo explicado. Solo cargas.
 */
function buildRendimientoCard(
  load: FuelEntry,
  metrics: FuelMetrics | undefined,
  statTipo: FuelStat | undefined,
  statUnidad: FuelStat | undefined,
  kmplVida?: KmplVida,
): HTMLElement | null {
  if (load.tipo !== "carga") return null; // las solicitudes no tienen km/l
  const card = document.createElement("div");
  card.className = "fv-card fv-rend";
  const head = document.createElement("div");
  head.className = "fv-cardhead";
  head.textContent = "Cómo se calcula el rendimiento";
  card.appendChild(head);

  const kmpl = metrics?.kmPorLitro ?? null;
  if (kmpl != null && metrics) {
    const litros = metrics.litrosFill ?? metrics.litros ?? null;
    // Motor de ventanas: la distancia/odómetro de referencia son los EXTREMOS de la
    // ventana entre llenos (no el segmento carga→carga).
    const recorrido = metrics.ventanaKmDesde ?? metrics.kmDesdeAnterior;
    const odoActual = metrics.km;
    const odoAnterior =
      metrics.ventanaDesdeKm ??
      (odoActual != null && recorrido != null ? odoActual - recorrido : null);

    const chain = document.createElement("div");
    chain.className = "fv-calc";
    const addRow = (lbl: string, val: string, strong = false) => {
      const r = document.createElement("div");
      r.className = strong ? "fv-calc-row fv-calc-total" : "fv-calc-row";
      const a = document.createElement("span");
      a.className = "fv-calc-lbl";
      a.textContent = lbl;
      const b = document.createElement("span");
      b.className = "fv-calc-val";
      b.textContent = val;
      r.appendChild(a);
      r.appendChild(b);
      chain.appendChild(r);
    };
    const nVentana = metrics.ventanaCargas ?? 1;
    addRow(
      nVentana > 1 ? "Odómetro del lleno anterior" : "Odómetro anterior",
      odoAnterior != null ? `${NUM.format(odoAnterior)} km` : "—",
    );
    addRow("Odómetro de esta carga", odoActual != null ? `${NUM.format(odoActual)} km` : "—");
    addRow(
      nVentana > 1 ? "Recorrido de la ventana" : "Recorrido",
      recorrido != null ? `${NUM.format(recorrido)} km` : "—",
    );
    addRow(
      nVentana > 1
        ? `Litros de la ventana (${nVentana} cargas${metrics.ventanaInferida ? " · lleno inferido" : ""})`
        : `Litros${metrics.ventanaInferida ? " (lleno inferido)" : ""}`,
      litros != null ? `${NUM1.format(litros)} L` : "—",
    );
    addRow("Rendimiento", `${kmpl.toFixed(2)} km/l`, true);
    card.appendChild(chain);

    // Comparación con baseline (su unidad / su tipo) — usa el km/l ponderado por volumen.
    const refs: string[] = [];
    const uniVol = statUnidad?.kmplVol ?? statUnidad?.mean;
    const tipoVol = statTipo?.kmplVol ?? statTipo?.mean;
    if (uniVol != null && Number.isFinite(uniVol))
      refs.push(`esta unidad ${uniVol.toFixed(2)} km/l`);
    if (kmplVida) refs.push(`de vida ${kmplVida.kmpl.toFixed(2)} km/l`);
    if (tipoVol != null && Number.isFinite(tipoVol) && tipoVol > 0) {
      const pct = Math.round(((kmpl - tipoVol) / tipoVol) * 100);
      refs.push(
        `su tipo${load.tipoUnidad ? ` (${load.tipoUnidad})` : ""} ${tipoVol.toFixed(2)} km/l · ${pct >= 0 ? "+" : ""}${pct}%`,
      );
    }
    if (refs.length) {
      const cmp = document.createElement("div");
      cmp.className = "fv-calc-cmp";
      cmp.textContent = `Referencia: ${refs.join(" · ")}`;
      card.appendChild(cmp);
    }

  } else {
    // Sin km/l: explicar el motivo (no dejar el "—" desnudo).
    const motivo = metrics?.motivoSinKmpl;
    const box = document.createElement("div");
    box.className = "fv-calc-none";
    const t = document.createElement("div");
    t.className = "fv-calc-none-title";
    t.textContent = "Sin rendimiento en esta carga";
    box.appendChild(t);
    const d = document.createElement("div");
    d.textContent = motivo
      ? MOTIVO_SIN_KMPL_LABEL[motivo]
      : "No se pudo calcular el rendimiento de esta carga.";
    box.appendChild(d);
    if (motivo && MOTIVO_SIN_KMPL_ACCIONABLE[motivo]) {
      const tag = document.createElement("div");
      tag.className = "fv-calc-action";
      tag.textContent = "⚠ Dato por revisar (captura)";
      box.appendChild(tag);
    }
    if (kmplVida) {
      const vida = document.createElement("div");
      vida.className = "fv-calc-cmp";
      vida.textContent = `Referencia — km/L de vida de la unidad: ${kmplVida.kmpl.toFixed(2)} (${NUM.format(kmplVida.km)} km / ${NUM.format(Math.round(kmplVida.litros))} L)`;
      box.appendChild(vida);
    }
    card.appendChild(box);
  }
  return card;
}

export function renderDetalleCarga(deps: RenderDetalleCargaDeps): void {
  const { body, load, metrics, canWrite, onValidate } = deps;

  // Encabezado
  if (deps.titleEl) {
    deps.titleEl.replaceChildren();
    const tipo = document.createElement("span");
    tipo.className = "fv-tipo-badge";
    tipo.textContent = load.tipo === "carga" ? "Carga" : "Solicitud";
    deps.titleEl.appendChild(tipo);
    deps.titleEl.appendChild(
      document.createTextNode(` Unidad ${load.eco}${load.placa ? ` · ${load.placa}` : ""}`),
    );
  }
  if (deps.metaEl) {
    const kmpl =
      metrics && metrics.kmPorLitro != null ? ` · ${metrics.kmPorLitro.toFixed(2)} km/l` : "";
    deps.metaEl.textContent = `${load.sucursal || "—"} · ${load.responsable || "—"} · ${load.fechaHora || load.fecha}${kmpl}`;
  }

  body.replaceChildren();

  // Anulación admin: banner si el registro está anulado (con Restaurar para admin),
  // o botón discreto de anular para admin en registros vigentes.
  {
    const an = load.anulada;
    if (an) {
      const banner = document.createElement("div");
      banner.style.cssText =
        "display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;margin-bottom:10px;border:1px solid var(--ln);border-left:4px solid var(--R);border-radius:8px;background:var(--bg3)";
      const txt = document.createElement("div");
      txt.style.cssText = "flex:1;min-width:200px;font-size:12px";
      const t1 = document.createElement("div");
      t1.style.fontWeight = "700";
      t1.textContent = "⛔ Registro anulado — excluido de KPIs, rendimientos y reportes";
      const t2 = document.createElement("div");
      t2.style.cssText = "color:var(--s2);margin-top:2px";
      const quien = deps.nombreValidador
        ? deps.nombreValidador(an.anuladoPor)
        : (an.anuladoPor.split("@")[0] ?? an.anuladoPor);
      const fecha = /^(\d{4}-\d{2}-\d{2})/.exec(an.ts)?.[1] ?? "";
      t2.textContent = `Motivo: ${an.motivo || "—"} · ${quien}${fecha ? ` · ${fecha}` : ""}`;
      txt.appendChild(t1);
      txt.appendChild(t2);
      banner.appendChild(txt);
      if (deps.esAdmin && deps.onRestaurar) {
        const rest = document.createElement("button");
        rest.className = "fv-btn";
        rest.textContent = "↩ Restaurar";
        rest.title = "Reincorpora el registro a KPIs y cálculos (queda el rastro de la anulación)";
        rest.addEventListener("click", () => deps.onRestaurar!());
        banner.appendChild(rest);
      }
      body.appendChild(banner);
    } else if (deps.esAdmin && deps.onAnular && load.review?.verdictGlobal === "rechazada") {
      // Triage de rechazada en origen (Ops): la decisión es humana — no contar (anular) o
      // validar el gasto real con el panel de evidencias de abajo (spec 2026-07-21).
      const banner = document.createElement("div");
      banner.style.cssText =
        "display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;margin-bottom:10px;border:1px solid var(--ln);border-left:4px solid var(--R);border-radius:8px;background:var(--bg3)";
      const txt = document.createElement("div");
      txt.style.cssText = "flex:1;min-width:200px;font-size:12px";
      const t1 = document.createElement("div");
      t1.style.fontWeight = "700";
      t1.textContent = "🚫 Rechazada en Operaciones-GPA — pendiente de triage";
      const t2 = document.createElement("div");
      t2.style.cssText = "color:var(--s2);margin-top:2px";
      t2.textContent =
        'Si fue error de captura, exclúyela con "No contar". Si el gasto fue real, valida las evidencias abajo — tu veredicto tiene la última palabra.';
      txt.appendChild(t1);
      txt.appendChild(t2);
      banner.appendChild(txt);
      const noContar = document.createElement("button");
      noContar.className = "fv-btn";
      noContar.style.cssText = "color:var(--R);border-color:var(--R)";
      noContar.textContent = "⛔ No contar…";
      noContar.title =
        'Crea la anulación estándar (reversible): fuera de KPIs y cálculos, visible como "Rechazada · no contada"';
      noContar.addEventListener("click", () => deps.onAnular!());
      banner.appendChild(noContar);
      body.appendChild(banner);
    } else if (deps.esAdmin && deps.onAnular) {
      const bar = document.createElement("div");
      bar.style.cssText = "display:flex;justify-content:flex-end;margin-bottom:6px";
      const anular = document.createElement("button");
      anular.className = "fv-btn";
      anular.style.cssText = "color:var(--R);border-color:var(--R)";
      anular.textContent = "⛔ Anular registro…";
      anular.title =
        "Excluye este registro de KPIs y cálculos, con motivo y rastro de auditoría (reversible)";
      anular.addEventListener("click", () => deps.onAnular!());
      bar.appendChild(anular);
      body.appendChild(bar);
    }
  }

  // Info del ciclo + quién validó (línea contextual, antes de las fichas).
  {
    const info = document.createElement("div");
    info.className = "fv-revinfo";
    const addLine = (txt: string) => {
      const d = document.createElement("div");
      d.textContent = txt;
      info.appendChild(d);
    };
    // Área que SOLICITÓ la carga (dato por-carga de Ops; distinta del área dueña de la unidad).
    if (load.areaCarga) addLine(`🏷 Área solicitante: ${load.areaCarga}`);
    const rec = deps.recorrido;
    if (load.tipo === "solicitud" && rec) {
      const sello = rec.viaCarga ? "con carga registrada" : "sin carga registrada";
      if (rec.km != null) addLine(`🛣 Recorrido del ciclo: ${NUM.format(rec.km)} km (${sello})`);
      else if (rec.cerrado) addLine(`🛣 Recorrido del ciclo: no medible (${sello})`);
      else addLine("🛣 Recorrido del ciclo: en curso (aún sin solicitud posterior)");
    }
    const rev = load.review?.revisadoPor;
    if (rev && rev !== "ui") {
      const nombre = deps.nombreValidador ? deps.nombreValidador(rev) : (rev.split("@")[0] ?? rev);
      const fecha = /^(\d{4}-\d{2}-\d{2})/.exec(String(load.review?.ts ?? ""))?.[1];
      addLine(`✓ Revisado por ${nombre}${fecha ? ` · ${fecha}` : ""}`);
    }
    if (info.childNodes.length) body.appendChild(info);
  }

  // Cómo se calcula el rendimiento (cadena de cálculo) o por qué no hay km/l.
  const rendCard = buildRendimientoCard(load, metrics, deps.statTipo, deps.statUnidad, deps.kmplVida);
  if (rendCard) body.appendChild(rendCard);

  // Acción global (solo escritura)
  if (canWrite) {
    const bar = document.createElement("div");
    bar.className = "fv-globalbar";
    const btnAll = document.createElement("button");
    btnAll.className = "fv-btn fv-btn-ok";
    btnAll.textContent = "✓ Validar carga completa";
    btnAll.addEventListener("click", () => onValidate(load.loadId, "all", "ok"));
    bar.appendChild(btnAll);
    body.appendChild(bar);
  }

  // Fichas valor ↔ foto
  for (const slot of buildSlots(load, metrics)) {
    const card = document.createElement("div");
    card.className = "fv-card";

    const head = document.createElement("div");
    head.className = "fv-cardhead";
    head.textContent = slot.label;
    card.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "fv-grid";

    // Columna FORMULARIO
    const formCol = document.createElement("div");
    formCol.className = "fv-form";
    const fLbl = document.createElement("div");
    fLbl.className = "fv-collbl";
    fLbl.textContent = "Capturado";
    const fVal = document.createElement("div");
    fVal.className = "fv-val";
    fVal.textContent = slot.value;
    formCol.appendChild(fLbl);
    formCol.appendChild(fVal);
    if (slot.detected) {
      const det = document.createElement("div");
      det.className = "fv-detected";
      det.textContent =
        slot.detectedFuente === "ia"
          ? `IA detectó: ${slot.detected}`
          : `Corregido en validación: ${slot.detected}`;
      formCol.appendChild(det);
    }
    if (slot.hint) {
      const h = document.createElement("div");
      h.className = "fv-hint";
      h.textContent = slot.hint;
      formCol.appendChild(h);
    }
    // Corrección de odómetro desde la foto (solo cargas, con permiso de escritura):
    // alimenta kmDetectado → computeFuelMetrics lo usa como odómetro efectivo.
    if (slot.kind === "odometro" && load.tipo === "carga" && canWrite && deps.onKmDetectado) {
      const fix = document.createElement("div");
      fix.style.cssText = "margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center";
      const lbl = document.createElement("label");
      lbl.style.cssText = "font-size:11px;color:var(--s2);flex-basis:100%";
      lbl.textContent = "Odómetro real (según foto) — corrige el km/l sin tocar lo capturado:";
      const inp = document.createElement("input");
      inp.type = "number";
      inp.min = "1";
      inp.step = "1";
      inp.placeholder = "km reales";
      inp.value = load.review?.kmDetectado != null ? String(load.review.kmDetectado) : "";
      inp.style.cssText =
        "width:130px;padding:4px 8px;border:1px solid var(--ln);border-radius:6px;background:var(--bg2);color:inherit;font-size:12px";
      const save = document.createElement("button");
      save.className = "fv-btn fv-btn-ok-sm";
      save.textContent = "Corregir";
      const aplicar = () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v) && v > 0) deps.onKmDetectado!(load.loadId, v);
      };
      save.addEventListener("click", aplicar);
      inp.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") aplicar();
      });
      fix.appendChild(lbl);
      fix.appendChild(inp);
      fix.appendChild(save);
      if (load.review?.kmDetectado != null) {
        const quitar = document.createElement("button");
        quitar.className = "fv-btn";
        quitar.textContent = "Quitar corrección";
        quitar.addEventListener("click", () => deps.onKmDetectado!(load.loadId, null));
        fix.appendChild(quitar);
      }
      formCol.appendChild(fix);
    }
    grid.appendChild(formCol);

    // Columna FOTO(s)
    const photoCol = document.createElement("div");
    photoCol.className = "fv-photos";
    const photos = photosOfKind(load, slot.kind);
    if (photos.length === 0) {
      const none = document.createElement("div");
      none.className = "fv-nophoto";
      none.textContent = "Sin foto para esta evidencia";
      photoCol.appendChild(none);
    } else {
      for (const p of photos) {
        const img = document.createElement("img");
        img.className = "fv-photo";
        img.loading = "lazy";
        img.alt = slot.label;
        wirePhoto(img, p.fname, deps);
        photoCol.appendChild(img);
      }
    }
    grid.appendChild(photoCol);
    card.appendChild(grid);

    // Veredicto + acciones
    const verdict = load.review?.porEvidencia?.[slot.kind] ?? "pendiente";
    const vbar = document.createElement("div");
    vbar.className = "fv-verdictbar";
    const vchip = document.createElement("span");
    const vm = VERDICT_META[verdict];
    vchip.className = `fv-verdict ${vm.cls}`;
    vchip.textContent = vm.txt;
    vbar.appendChild(vchip);

    if (canWrite) {
      const ok = document.createElement("button");
      ok.className = "fv-btn fv-btn-ok-sm";
      ok.textContent = "Validar";
      ok.addEventListener("click", () => onValidate(load.loadId, slot.kind, "ok"));
      const bad = document.createElement("button");
      bad.className = "fv-btn fv-btn-bad-sm";
      bad.textContent = "Discrepancia";
      bad.addEventListener("click", () => onValidate(load.loadId, slot.kind, "bad"));
      vbar.appendChild(ok);
      vbar.appendChild(bad);
    }
    card.appendChild(vbar);
    body.appendChild(card);
  }

  // Otras evidencias (bomba, persona, firma)
  const otras = load.photos.filter((p) =>
    ["bomba", "firma", "unidad"].includes(evidenceKindOf(p.col)),
  );
  if (otras.length) {
    const sec = document.createElement("div");
    sec.className = "fv-card";
    const h = document.createElement("div");
    h.className = "fv-cardhead";
    h.textContent = "Otras evidencias";
    sec.appendChild(h);
    const strip = document.createElement("div");
    strip.className = "fv-strip";
    for (const p of otras) {
      const img = document.createElement("img");
      img.className = "fv-photo fv-photo-sm";
      img.loading = "lazy";
      img.alt = p.col;
      wirePhoto(img, p.fname, deps);
      strip.appendChild(img);
    }
    sec.appendChild(strip);
    body.appendChild(sec);
  }

  // Ubicación GPS (cargas)
  if (load.ubicacion) {
    const geo = document.createElement("div");
    geo.className = "fv-geo";
    geo.textContent = `📍 ${load.ubicacion}`;
    body.appendChild(geo);
  }
}

/** Deriva el veredicto global a partir de los por-evidencia (para persistir). */
export function deriveGlobalVerdict(
  por: Partial<Record<FuelEvidenceKind, FuelVerdict>>,
): "ok" | "discrepancia" | "pendiente" {
  const vals = Object.values(por);
  if (vals.some((v) => v === "bad")) return "discrepancia";
  if (vals.length > 0 && vals.every((v) => v === "ok")) return "ok";
  return "pendiente";
}
