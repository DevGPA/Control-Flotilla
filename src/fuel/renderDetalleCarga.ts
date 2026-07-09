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
  canWrite: boolean;
  onValidate: (
    loadId: string,
    kind: FuelEvidenceKind | "all",
    verdict: FuelVerdict,
    nota?: string,
  ) => void;
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
    const recorrido = metrics.kmDesdeAnterior;
    const odoActual = metrics.km;
    const odoAnterior = odoActual != null && recorrido != null ? odoActual - recorrido : null;

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
    addRow("Odómetro anterior", odoAnterior != null ? `${NUM.format(odoAnterior)} km` : "—");
    addRow("Odómetro de esta carga", odoActual != null ? `${NUM.format(odoActual)} km` : "—");
    addRow("Recorrido", recorrido != null ? `${NUM.format(recorrido)} km` : "—");
    addRow(
      `Litros${metrics.litrosFill != null ? " (llenado completo)" : ""}`,
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
    // Evento con km/l pero NO fiel (tanque no lleno): se muestra el número, pero se avisa que
    // no representa la eficiencia real (el supuesto tanque-lleno → tanque-lleno no se cumple).
    if (metrics.cargaParcial) {
      const nf = document.createElement("div");
      nf.className = "fv-calc-action";
      nf.textContent =
        "⚠ Rendimiento no fiel: carga parcial (tanque no lleno) — no cuenta para el ranking ni las alertas.";
      card.appendChild(nf);
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
    card.appendChild(box);
  }
  return card;
}

export function renderDetalleCarga(deps: RenderDetalleCargaDeps): void {
  const { body, load, metrics, resolveUrl, canWrite, onValidate } = deps;

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
  const rendCard = buildRendimientoCard(load, metrics, deps.statTipo, deps.statUnidad);
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
      det.textContent = `IA detectó: ${slot.detected}`;
      formCol.appendChild(det);
    }
    if (slot.hint) {
      const h = document.createElement("div");
      h.className = "fv-hint";
      h.textContent = slot.hint;
      formCol.appendChild(h);
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
        const url = resolveUrl(p.fname);
        const img = document.createElement("img");
        img.className = "fv-photo";
        img.loading = "lazy";
        img.alt = slot.label;
        if (url) img.src = url;
        img.addEventListener("click", () => {
          if (url) deps.onPhotoClick ? deps.onPhotoClick(url) : window.open(url, "_blank");
        });
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
      const url = resolveUrl(p.fname);
      const img = document.createElement("img");
      img.className = "fv-photo fv-photo-sm";
      img.loading = "lazy";
      img.alt = p.col;
      if (url) img.src = url;
      img.addEventListener("click", () => {
        if (url) deps.onPhotoClick ? deps.onPhotoClick(url) : window.open(url, "_blank");
      });
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
