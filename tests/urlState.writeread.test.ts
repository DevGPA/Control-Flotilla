import { beforeEach, describe, expect, it, vi } from "vitest";
import { onUrlStateChange, readUrlState, writeUrlState } from "../src/state/urlState";

describe("writeUrlState", () => {
  beforeEach(() => {
    // Empezar cada test con un URL limpio bajo happy-dom
    history.replaceState(null, "", "/");
  });

  it("escribe query params conocidos", () => {
    writeUrlState({ tab: "taller", filter: "Urgente", branch: "Norte", search: "ABC" });
    const url = new URL(location.href);
    expect(url.searchParams.get("tab")).toBe("taller");
    expect(url.searchParams.get("filter")).toBe("Urgente");
    expect(url.searchParams.get("branch")).toBe("Norte");
    expect(url.searchParams.get("search")).toBe("ABC");
  });

  it("elimina params vacíos", () => {
    writeUrlState({ tab: "taller", filter: "Urgente" });
    writeUrlState({ filter: "" });
    const url = new URL(location.href);
    expect(url.searchParams.get("tab")).toBe("taller");
    expect(url.searchParams.has("filter")).toBe(false);
  });

  it("elimina filter='all' y branch='all' (valor sentinela default)", () => {
    writeUrlState({ filter: "all", branch: "all", search: "xyz" });
    const url = new URL(location.href);
    expect(url.searchParams.has("filter")).toBe(false);
    expect(url.searchParams.has("branch")).toBe(false);
    expect(url.searchParams.get("search")).toBe("xyz");
  });

  it("merge: preserva params existentes no-tocados", () => {
    writeUrlState({ tab: "taller", branch: "Norte" });
    writeUrlState({ filter: "Urgente" });
    const s = readUrlState();
    expect(s.tab).toBe("taller");
    expect(s.branch).toBe("Norte");
    expect(s.filter).toBe("Urgente");
  });

  it("replace=true usa history.replaceState (default)", () => {
    const spy = vi.spyOn(history, "replaceState");
    writeUrlState({ tab: "taller" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("replace=false usa history.pushState", () => {
    const pushSpy = vi.spyOn(history, "pushState");
    writeUrlState({ tab: "taller" }, false);
    expect(pushSpy).toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  it("ignora claves desconocidas silenciosamente", () => {
    writeUrlState({ tab: "taller", foo: "bar" } as unknown as Parameters<typeof writeUrlState>[0]);
    const url = new URL(location.href);
    expect(url.searchParams.get("tab")).toBe("taller");
    expect(url.searchParams.has("foo")).toBe(false);
  });

  it("undefined y null tratan como borrar", () => {
    writeUrlState({ tab: "taller" });
    writeUrlState({ tab: undefined });
    expect(new URL(location.href).searchParams.has("tab")).toBe(false);
  });
});

describe("onUrlStateChange", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/");
  });

  it("dispara handler en popstate con estado actual", () => {
    const handler = vi.fn();
    const unsub = onUrlStateChange(handler);
    writeUrlState({ tab: "taller" });
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].tab).toBe("taller");
    unsub();
  });

  it("unsub desconecta el handler", () => {
    const handler = vi.fn();
    const unsub = onUrlStateChange(handler);
    unsub();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("múltiples handlers independientes", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = onUrlStateChange(a);
    const unsubB = onUrlStateChange(b);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    unsubA();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    unsubB();
  });
});
