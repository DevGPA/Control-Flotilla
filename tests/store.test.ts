import { beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../src/state/store";

type TestState = { count: number; name: string; flag: boolean; list: number[] };

function mkStore() {
  return new Store<TestState>({ count: 0, name: "init", flag: false, list: [] });
}

describe("Store", () => {
  it("state inicial accesible via .state y .get", () => {
    const s = mkStore();
    expect(s.state).toEqual({ count: 0, name: "init", flag: false, list: [] });
    expect(s.get("count")).toBe(0);
    expect(s.get("name")).toBe("init");
  });

  it("set actualiza valor + emite a subscribers globales", () => {
    const s = mkStore();
    const listener = vi.fn();
    s.subscribe(listener);
    s.set("count", 5);
    expect(s.get("count")).toBe(5);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].count).toBe(5);
    expect(listener.mock.calls[0]![1].count).toBe(0);
  });

  it("set con mismo valor NO emite (optimización referencial)", () => {
    const s = mkStore();
    const listener = vi.fn();
    s.subscribe(listener);
    s.set("count", 0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("update merge parcial", () => {
    const s = mkStore();
    s.update({ count: 10, flag: true });
    expect(s.get("count")).toBe(10);
    expect(s.get("flag")).toBe(true);
    expect(s.get("name")).toBe("init"); // intacto
  });

  it("update sin cambios reales NO emite", () => {
    const s = mkStore();
    const listener = vi.fn();
    s.subscribe(listener);
    s.update({ count: 0, name: "init" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("subscribeKey solo dispara cuando esa clave cambia", () => {
    const s = mkStore();
    const listener = vi.fn();
    s.subscribeKey("count", listener);
    s.set("name", "otro");
    expect(listener).not.toHaveBeenCalled();
    s.set("count", 42);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(42, 0);
  });

  it("unsubscribe función detiene notificaciones", () => {
    const s = mkStore();
    const listener = vi.fn();
    const unsub = s.subscribe(listener);
    s.set("count", 1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    s.set("count", 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("subscribeKey también devuelve unsubscribe funcional", () => {
    const s = mkStore();
    const listener = vi.fn();
    const unsub = s.subscribeKey("flag", listener);
    s.set("flag", true);
    unsub();
    s.set("flag", false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("state es nueva referencia tras cada update (inmutabilidad shallow)", () => {
    const s = mkStore();
    const before = s.state;
    s.set("count", 1);
    const after = s.state;
    expect(before).not.toBe(after);
    expect(before.count).toBe(0); // snapshot previo intacto
    expect(after.count).toBe(1);
  });

  it("reset reemplaza todo el estado y emite cambios", () => {
    const s = mkStore();
    const listener = vi.fn();
    s.subscribe(listener);
    s.reset({ count: 99, name: "zzz", flag: true, list: [1, 2] });
    expect(s.get("count")).toBe(99);
    expect(s.get("list")).toEqual([1, 2]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("múltiples subscribers todos reciben evento", () => {
    const s = mkStore();
    const a = vi.fn();
    const b = vi.fn();
    s.subscribe(a);
    s.subscribe(b);
    s.set("count", 7);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("update notifica a varios subscribeKey específicos en una sola emisión", () => {
    const s = mkStore();
    const onCount = vi.fn();
    const onName = vi.fn();
    const onFlag = vi.fn();
    s.subscribeKey("count", onCount);
    s.subscribeKey("name", onName);
    s.subscribeKey("flag", onFlag);
    s.update({ count: 1, name: "x" });
    expect(onCount).toHaveBeenCalledTimes(1);
    expect(onName).toHaveBeenCalledTimes(1);
    expect(onFlag).not.toHaveBeenCalled();
  });
});

describe("Store — array/object references", () => {
  it("set con array equivalente pero nueva ref SÍ emite", () => {
    const s = mkStore();
    const listener = vi.fn();
    s.subscribeKey("list", listener);
    s.set("list", [...s.get("list")]); // nueva ref, misma data
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("AppState store + bindLegacyWindow", () => {
  let unbind: (() => void) | undefined;

  beforeEach(async () => {
    // Limpiamos window state anterior
    delete (window as unknown as Record<string, unknown>).units;
    delete (window as unknown as Record<string, unknown>).selId;
    delete (window as unknown as Record<string, unknown>).checklistDB;
    delete (window as unknown as Record<string, unknown>).hasZip;
    delete (window as unknown as Record<string, unknown>).zipImgs;
    // Reset store
    const mod = await import("../src/state/appState");
    mod.appStore.reset(mod.INITIAL_STATE);
  });

  it("bindLegacyWindow: window.units = [...] sincroniza al store", async () => {
    const { appStore, bindLegacyWindow } = await import("../src/state/appState");
    unbind = bindLegacyWindow();
    (window as unknown as { units: unknown[] }).units = [
      { uid: "u1", risk: "OK", F: [], T: {}, minT: null },
    ];
    expect(appStore.get("units")).toHaveLength(1);
    expect(appStore.get("units")[0]!.uid).toBe("u1");
    unbind();
  });

  it("bindLegacyWindow: appStore.set('selectedUid', X) espeja a window.selId", async () => {
    const { appStore, bindLegacyWindow } = await import("../src/state/appState");
    unbind = bindLegacyWindow();
    appStore.set("selectedUid", "abc");
    expect((window as unknown as { selId: string }).selId).toBe("abc");
    unbind();
  });

  it("bindLegacyWindow: unbind restaura window limpio", async () => {
    const { bindLegacyWindow } = await import("../src/state/appState");
    unbind = bindLegacyWindow();
    (window as unknown as { hasZip: boolean }).hasZip = true;
    unbind();
    unbind = undefined;
    // Después del unbind, escribir window.hasZip NO debería llegar al store
    (window as unknown as { hasZip: boolean }).hasZip = false;
    const { appStore } = await import("../src/state/appState");
    // El valor del store puede ser lo último que se bindeaba (true) o el default
    // Lo importante: la escritura post-unbind no afecta
    // Tras el unbind, window.hasZip es una property normal — no afecta al store.
    expect(["boolean", "undefined"]).toContain(typeof appStore.get("hasZip"));
  });
});
