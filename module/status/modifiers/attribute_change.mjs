// systems/adm-daggerheart/module/status/modifiers/attribute_change.mjs

import { registerModifier } from "./registry.mjs";

export const attributeChangeModifier = {
  type: "attribute",
  label: "Атрибут",
  kind: "persistent",

  // UI: строка модификатора в редакторе статусов
  renderEditorRowHTML({ mod, helpers }) {
    const { escapeHTML, buildAttrOptionsHTML } = helpers;
    const nm = this.normalize(mod);
    const p = String(nm.path ?? "").trim();
    const v = String(nm.value ?? "0");

    return `
<div class="adm-status-mod-row" data-mod-type="attribute">
  <div class="adm-status-mod-col">
    <div class="adm-status-mod-title">${escapeHTML(this.label)}</div>
    <select name="modPath">
      ${buildAttrOptionsHTML(p)}
    </select>
  </div>

  <div class="adm-status-mod-col">
    <div class="adm-status-mod-title">Значение</div>
    <input type="text" name="modValue" value="${escapeHTML(v)}" />
  </div>

  <button type="button" class="adm-status-mod-del" data-action="adm-status-mod-del" title="Удалить">×</button>
</div>`;
  },

  // UI: чтение строки модификатора из DOM
  readEditorRow({ row }) {
    const path = String(row?.querySelector?.('[name="modPath"]')?.value ?? "").trim();
    const value = String(row?.querySelector?.('[name="modValue"]')?.value ?? "").trim();
    return { type: "attribute", path, value };
  },

  normalize(mod) {
    const mm = mod ?? {};
    let type = String(mm.type ?? "attribute").trim() || "attribute";
    if (type === "attr") type = "attribute";

    const path = String(mm.path ?? mm.attrPath ?? "").trim();
    const value =
      mm.value != null ? String(mm.value).trim()
      : mm.attrDelta != null ? String(mm.attrDelta).trim()
      : "0";

    return { type, path, value };
  },

  accumulate({ out, mod, actor, evalValue }) {
    const path = String(mod?.path ?? "").trim();
    if (!path) return;

    const v = evalValue(mod?.value, actor);
    if (!v) return;

    out[path] = (out[path] ?? 0) + v;
  },
};

registerModifier(attributeChangeModifier);
