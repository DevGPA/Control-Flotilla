/**
 * Guardar solo con cambios (spec 2026-09-30 §4.5). Capa PURA.
 *
 * Un control `readOnly` no cuenta, ni en la foto ni al comparar: `_bnRepintar →
 * _tfGastoPintar` reescribe `#tf-gasto` con el derivado y lo pasa de editable a
 * readOnly (o al revés) sin que la persona toque nada; si contara, Guardar se
 * encendería solo después de firmar o se quedaría encendido con el valor ya revertido.
 */
export type FotoCampos = Record<string, { valor: string; readOnly: boolean }>;

export function hayCambios(foto: FotoCampos, actual: FotoCampos): boolean {
  for (const id of Object.keys(foto)) {
    const a = foto[id];
    const b = actual[id];
    if (!a || !b) continue;
    if (a.readOnly || b.readOnly) continue;
    if (a.valor !== b.valor) return true;
  }
  return false;
}
