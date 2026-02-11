// systems/adm-daggerheart/module/status/modifiers/instant_attribute.mjs

import { registerModifier } from "./registry.mjs";

export const instantAttributeModifier = {
  type: "instantAttribute",
  label: "Моментальный атрибут",
  kind: "instant",

  // UI: строка модификатора в редакторе статусов
  renderEditorRowHTML({ mod, helpers }) {
    const { escapeHTML, buildAttrOptionsHTML } = helpers;
    const nm = this.normalize(mod);
    const p = String(nm.path ?? "").trim();
    const v = String(nm.value ?? "0");

    return `
<div class="adm-status-mod-row" data-mod-type="instantAttribute">
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
    return { type: "instantAttribute", path, value };
  },

  normalize(mod) {
    const mm = mod ?? {};
    let type = String(mm.type ?? "instantAttribute").trim() || "instantAttribute";

    const path = String(mm.path ?? mm.attrPath ?? "").trim();
    const value =
      mm.value != null ? String(mm.value).trim()
      : mm.attrDelta != null ? String(mm.attrDelta).trim()
      : "0";

    return { type, path, value };
  },

  async computeInstant({ mod, actor, rollValue }) {
    return await rollValue(mod?.value, actor);
  }
};

registerModifier(instantAttributeModifier);
