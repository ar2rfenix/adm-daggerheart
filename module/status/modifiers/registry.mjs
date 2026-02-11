// systems/adm-daggerheart/module/status/modifiers/registry.mjs

const __ADM_STATUS_MODS_REGISTRY_KEY = "__admStatusModsRegistryV1";
const __registry =
  (globalThis[__ADM_STATUS_MODS_REGISTRY_KEY] =
    globalThis[__ADM_STATUS_MODS_REGISTRY_KEY] || new Map());

/**
 * def:
 * {
 *   type: string,
 *   label: string,
 *   kind?: "persistent" | "instant",
 *   normalize?: (mod) => ({type,path,value}),
 *   // UI (редактор статусов)
 *   // renderEditorRowHTML?: ({ mod, helpers }) => string
 *   // readEditorRow?: ({ row, helpers }) => object
 *   accumulate?: ({ out, mod, actor, evalValue }) => void,        // persistent
 *   computeInstant?: async ({ mod, actor, rollValue }) => number  // instant -> delta for one path
 * }
 */
export function registerModifier(def) {
  const type = String(def?.type ?? "").trim();
  if (!type) throw new Error("ADM status modifier: missing type");
  __registry.set(type, def);
}

export function getModifier(type) {
  return __registry.get(String(type ?? "").trim()) || null;
}

export function listModifiers() {
  return Array.from(__registry.values()).map((d) => ({
    type: String(d.type),
    label: String(d.label ?? d.type),
  }));
}
