/**
 * Detalle de una carga/solicitud con VALIDACIÓN DE EVIDENCIAS lado-a-lado (P0).
 * Pone el valor capturado junto a su foto, grande, con semáforo y acciones de
 * validar/discrepancia. DOM API segura (sin innerHTML con datos). Soporta Fase 1
 * (manual) y Fase 2 (IA pre-llena valorDetectado) con el mismo layout.
 */
import type { FuelEntry, FuelMetrics, FuelEvidenceKind, FuelVerdict, FuelPhoto } from "./types";
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
  resolveUrl: (fname: string) => string | null;
  canWrite: boolean;
  onValidate: (
    loadId: string,
    kind: FuelEvidenceKind | "all",
    verdict: FuelVerdict,
    nota?: string,
  ) => void;
  onPhotoClick?: (url: string) => void;
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
