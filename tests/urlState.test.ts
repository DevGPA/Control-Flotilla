import { describe, expect, it } from "vitest";
import { readUrlState } from "../src/state/urlState";

describe("readUrlState", () => {
  it("parsea query params conocidos", () => {
    const s = readUrlState("https://x.test/?tab=taller&filter=Urgente&branch=Norte&search=ABC&unit=u1&periodo=2026-W15");
    expect(s).toEqual({
      tab: "taller",
      filter: "Urgente",
      branch: "Norte",
      search: "ABC",
      unit: "u1",
      periodo: "2026-W15",
    });
  });

  it("ignora params desconocidos y vacíos", () => {
    const s = readUrlState("https://x.test/?foo=bar&filter=&branch=Sur");
    expect(s).toEqual({ branch: "Sur" });
  });
});
