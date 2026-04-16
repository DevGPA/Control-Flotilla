export type FilterState = {
  tab?: "inspecciones" | "taller" | "semanales" | "historial";
  filter?: string;
  branch?: string;
  search?: string;
  unit?: string;
  periodo?: string;
};

const KEYS: (keyof FilterState)[] = ["tab", "filter", "branch", "search", "unit", "periodo"];

export function readUrlState(href: string = location.href): FilterState {
  const url = new URL(href);
  const out: FilterState = {};
  for (const k of KEYS) {
    const v = url.searchParams.get(k);
    if (v != null && v !== "") (out as Record<string, string>)[k] = v;
  }
  return out;
}

export function writeUrlState(patch: Partial<FilterState>, replace = true): void {
  const url = new URL(location.href);
  const current = readUrlState();
  const next: FilterState = { ...current, ...patch };
  for (const k of KEYS) {
    const v = next[k];
    if (v == null || v === "" || (k === "filter" && v === "all") || (k === "branch" && v === "all")) {
      url.searchParams.delete(k);
    } else {
      url.searchParams.set(k, String(v));
    }
  }
  const target = url.pathname + (url.search ? url.search : "") + url.hash;
  if (replace) history.replaceState(null, "", target);
  else history.pushState(null, "", target);
}

export function onUrlStateChange(handler: (s: FilterState) => void): () => void {
  const fn = () => handler(readUrlState());
  window.addEventListener("popstate", fn);
  return () => window.removeEventListener("popstate", fn);
}
