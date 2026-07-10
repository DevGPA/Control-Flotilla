// Helper — leer paleta Tremor desde CSS vars de :root para pasársela a ECharts.
// Las vars viven en src/styles/main.css; cuando cambia data-theme="dark"
// los valores se re-resuelven porque el navegador recalcula las custom props.

export type ThemeMode = "light" | "dark";

export type TremorPalette = {
  mode: ThemeMode;
  bg: string;
  bg2: string;
  bg3: string;
  ln: string;
  text: string;
  textSub: string;
  R: string; // rose-600 / rose-400 pastel dark
  A: string; // amber-600
  G: string; // emerald-600
  B: string; // blue-700 secondary
  O: string; // orange-600
  ac: string; // blue-600 primary
  ac2: string; // blue-700 hover
};

function readVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || "#000000";
}

export function getThemeMode(): ThemeMode {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

// Perf F1-8: memoizar por modo de tema. Antes cada chart llamaba getTremorPalette() y
// cada llamada hacía ~13 getComputedStyle (reflow forzado); al pintar el dashboard de 9
// charts eran ~117 lecturas de estilo. La paleta es función pura del modo (light/dark),
// así que cacheamos por modo: getThemeMode() es un getAttribute barato, y solo re-leemos
// las CSS vars cuando el usuario alterna el tema. Auto-invalidante, sin observadores.
let _paletteCache: TremorPalette | null = null;

export function getTremorPalette(): TremorPalette {
  const mode = getThemeMode();
  if (_paletteCache && _paletteCache.mode === mode) return _paletteCache;
  _paletteCache = {
    mode,
    bg: readVar("--bg"),
    bg2: readVar("--bg2"),
    bg3: readVar("--bg3"),
    ln: readVar("--ln"),
    text: readVar("--w1"),
    textSub: readVar("--s2"),
    R: readVar("--R"),
    A: readVar("--A"),
    G: readVar("--G"),
    B: readVar("--B"),
    O: readVar("--O"),
    ac: readVar("--ac"),
    ac2: readVar("--ac2"),
  };
  return _paletteCache;
}

// Observador — dispara callback cuando data-theme cambia (user click toggle).
// Úsalo para resyncar colores de charts sin re-renderizar todo.
export function onThemeChange(cb: (mode: ThemeMode) => void): () => void {
  const obs = new MutationObserver(() => {
    cb(getThemeMode());
  });
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
