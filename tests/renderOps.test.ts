import { describe, it, expect, vi } from "vitest";
import {
  renderSucursalesOps,
  renderRadar,
  renderReincidentes,
  renderCostoUnidad,
} from "../src/analytics/renderOps";
import type { SucursalOps, RadarOps, Reincidente, CostoUnidad } from "../src/analytics/opsTablero";

const mkSuc = (overrides: Partial<SucursalOps> = {}): SucursalOps => ({
  sucursal: "GDL",
  total: 10,
  conCheck: 8,
  pct: 80,
  urgentes: 2,
  revisar: 3,
  ...overrides,
});

const mkReinc = (overrides: Partial<Reincidente> = {}): Reincidente => ({
  eco: "42",
  sucursal: "GDL",
  mesesUrgente: 3,
  visitasTaller: 2,
  gastoTaller: 12500,
  ultimoRiesgo: "Urgente",
  tallerKey: "uk-42",
  ...overrides,
});

function mount(): HTMLElement {
  document.body.replaceChildren();
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

describe("renderSucursalesOps", () => {
  it("pinta tabla con barra de cobertura y severidades", () => {
    const c = mount();
    renderSucursalesOps(c, [mkSuc(), mkSuc({ sucursal: "MTY", pct: 50, urgentes: 0 })]);
    expect(c.querySelectorAll("tbody tr")).toHaveLength(2);
    const fill = c.querySelector(".ops-bar-fill") as HTMLElement;
    expect(fill.style.width).toBe("80%");
    expect(fill.dataset.nivel).toBe("warn");
    expect(c.textContent).toContain("8/10 · 80%");
  });

  it("clic en fila dispara callback con la sucursal", () => {
    const c = mount();
    const spy = vi.fn();
    renderSucursalesOps(c, [mkSuc()], spy);
    (c.querySelector("tbody tr") as HTMLElement).click();
    expect(spy).toHaveBeenCalledWith("GDL");
  });

  it("XSS: nombre de sucursal malicioso no inyecta HTML", () => {
    const c = mount();
    renderSucursalesOps(c, [mkSuc({ sucursal: "<img onerror=x src=x>" })]);
    expect(c.querySelector("img")).toBeFalsy();
  });

  it("vacío → mensaje y reemplaza contenido previo", () => {
    const c = mount();
    c.appendChild(document.createElement("table"));
    renderSucursalesOps(c, []);
    expect(c.querySelectorAll("table")).toHaveLength(0);
    expect(c.querySelector(".ops-empty")).toBeTruthy();
  });
});

describe("renderRadar", () => {
  const radar: RadarOps = {
    vencidos: 2,
    proximos: 1,
    items: [
      {
        eco: "10",
        sucursal: "GDL",
        que: "Seguro",
        detalle: "vencido hace 5 días",
        dias: -5,
        severidad: "vencido",
      },
      {
        eco: "11",
        sucursal: "MTY",
        que: "Servicio",
        detalle: "vencido por km",
        dias: null,
        severidad: "vencido",
      },
      {
        eco: "12",
        sucursal: "GDL",
        que: "Verificación",
        detalle: "vence en 3 días",
        dias: 3,
        severidad: "proximo",
      },
    ],
  };

  it("pinta chips de conteo y filas con severidad", () => {
    const c = mount();
    renderRadar(c, radar);
    const chips = c.querySelectorAll(".ops-chip");
    expect(chips[0]!.textContent).toBe("2 vencidos");
    expect(chips[1]!.textContent).toBe("1 por vencer");
    expect(c.querySelectorAll(".ops-radar-item")).toHaveLength(3);
    expect((c.querySelector(".ops-radar-item") as HTMLElement).dataset.sev).toBe("bad");
  });

  it("singular: '1 vencido'", () => {
    const c = mount();
    renderRadar(c, { ...radar, vencidos: 1 });
    expect(c.querySelector(".ops-chip")!.textContent).toBe("1 vencido");
  });

  it("XSS en detalle/eco no inyecta", () => {
    const c = mount();
    renderRadar(c, {
      vencidos: 1,
      proximos: 0,
      items: [
        {
          eco: "<script>x</script>",
          sucursal: "GDL",
          que: "Seguro",
          detalle: "<img src=x>",
          dias: -1,
          severidad: "vencido",
        },
      ],
    });
    expect(c.querySelector("script,img")).toBeFalsy();
  });

  it("sin items → empty positivo", () => {
    const c = mount();
    renderRadar(c, { vencidos: 0, proximos: 0, items: [] });
    expect(c.querySelector(".ops-empty")!.textContent).toContain("al corriente");
  });
});

describe("renderReincidentes", () => {
  it("pinta tabla con gasto formateado en pesos", () => {
    const c = mount();
    renderReincidentes(c, [mkReinc()]);
    expect(c.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(c.textContent).toMatch(/\$\s?12,500/);
  });

  it("clic abre expediente SOLO cuando hay tallerKey", () => {
    const c = mount();
    const spy = vi.fn();
    renderReincidentes(c, [mkReinc(), mkReinc({ eco: "43", tallerKey: "" })], spy);
    const filas = c.querySelectorAll("tbody tr");
    (filas[0] as HTMLElement).click();
    (filas[1] as HTMLElement).click();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toMatchObject({ eco: "42", tallerKey: "uk-42" });
    expect(filas[1]!.classList.contains("ops-row-click")).toBe(false);
  });

  it("XSS en eco no inyecta", () => {
    const c = mount();
    renderReincidentes(c, [mkReinc({ eco: "<img onerror=x>" })]);
    expect(c.querySelector("img")).toBeFalsy();
  });

  it("vacío → empty positivo", () => {
    const c = mount();
    renderReincidentes(c, []);
    expect(c.querySelector(".ops-empty")!.textContent).toContain("Ninguna unidad reincidente");
  });
});

describe("renderCostoUnidad", () => {
  const mkCosto = (overrides: Partial<CostoUnidad> = {}): CostoUnidad => ({
    eco: "45",
    unidad: "RAM 2016",
    sucursal: "GDL",
    visitas: 4,
    gasto: 80000,
    tallerKey: "uk-45",
    ...overrides,
  });

  it("pinta tabla con marca/año y gasto en pesos", () => {
    const c = mount();
    renderCostoUnidad(c, [mkCosto()]);
    expect(c.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(c.textContent).toContain("RAM 2016");
    expect(c.textContent).toMatch(/\$\s?80,000/);
  });

  it("clic abre expediente solo con tallerKey", () => {
    const c = mount();
    const spy = vi.fn();
    renderCostoUnidad(c, [mkCosto(), mkCosto({ eco: "99", tallerKey: "" })], spy);
    const filas = c.querySelectorAll("tbody tr");
    (filas[0] as HTMLElement).click();
    (filas[1] as HTMLElement).click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("XSS en unidad no inyecta", () => {
    const c = mount();
    renderCostoUnidad(c, [mkCosto({ unidad: "<img onerror=x>" })]);
    expect(c.querySelector("img")).toBeFalsy();
  });

  it("vacío → mensaje", () => {
    const c = mount();
    renderCostoUnidad(c, []);
    expect(c.querySelector(".ops-empty")).toBeTruthy();
  });
});
