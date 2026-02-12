// systems/adm-daggerheart/module/status/modifiers/marks.mjs
// Modifier type: Отметки (Marks) — interactive UI widgets on status effects

import { registerModifier } from "./registry.mjs";

const VARIANT_OPTIONS = [
  { value: "dots",       label: "Пункты" },
  { value: "counter",    label: "Счётчик" },
  { value: "playerList", label: "Список: Игроки" },
  { value: "text",       label: "Текст" },
];

const VARIANTS_SET = new Set(VARIANT_OPTIONS.map(o => o.value));

function _buildVariantSelectHTML(selected) {
  const sel = String(selected ?? "dots").trim();
  return VARIANT_OPTIONS.map(o => {
    const isSel = o.value === sel ? " selected" : "";
    return `<option value="${o.value}"${isSel}>${o.label}</option>`;
  }).join("");
}

export const marksModifier = {
  type: "marks",
  label: "Отметки",
  kind: "persistent",

  /**
   * Stored mod structure:
   * {
   *   type: "marks",
   *   variant: "dots" | "counter" | "playerList" | "text",
   *   value: "4",        // formula for max (dots/counter only)
   *   noOwner: false,    // playerList only: exclude item owner from list
   * }
   */

  normalize(mod) {
    const mm = mod ?? {};
    const variant = VARIANTS_SET.has(mm.variant) ? mm.variant : "dots";
    const value = (variant === "dots" || variant === "counter")
      ? String(mm.value ?? "1").trim() || "1"
      : "";
    const noOwner = variant === "playerList" ? !!mm.noOwner : false;
    return { type: "marks", variant, value, noOwner };
  },

  formatValue(rawValue) {
    let parsed;
    try { parsed = typeof rawValue === "object" ? rawValue : JSON.parse(rawValue); }
    catch (_e) { parsed = {}; }

    const nm = this.normalize(parsed);
    const vLabel = VARIANT_OPTIONS.find(o => o.value === nm.variant)?.label ?? nm.variant;
    return `Отметки: ${vLabel}`;
  },

  renderEditorRowHTML({ mod, helpers }) {
    const { escapeHTML } = helpers;
    const nm = this.normalize(mod);

    const showValue = nm.variant === "dots" || nm.variant === "counter";
    const showNoOwner = nm.variant === "playerList";

    return `
<div class="adm-status-mod-row" data-mod-type="marks">
  <div class="adm-status-mod-col">
    <div class="adm-status-mod-title">${escapeHTML(this.label)}</div>
    <select name="modVariant" data-adm-marks-variant>
      ${_buildVariantSelectHTML(nm.variant)}
    </select>
  </div>

  <div class="adm-status-mod-col adm-marks-value-col" ${showValue ? "" : 'style="display:none"'}>
    <div class="adm-status-mod-title">Макс. (формула)</div>
    <input type="text" name="modValue" value="${escapeHTML(nm.value)}" placeholder="4" />
  </div>

  <div class="adm-status-mod-col adm-marks-noowner-col" ${showNoOwner ? "" : 'style="display:none"'}>
    <label style="display:flex; align-items:center; gap:4px; white-space:nowrap; margin-top:18px;">
      <input type="checkbox" name="modNoOwner" ${nm.noOwner ? "checked" : ""} />
      Без владельца
    </label>
  </div>

  <button type="button" class="adm-status-mod-del" data-action="adm-status-mod-del" title="Удалить">×</button>
</div>`;
  },

  readEditorRow({ row }) {
    const variant = String(row?.querySelector?.('[name="modVariant"]')?.value ?? "dots").trim();
    const value = String(row?.querySelector?.('[name="modValue"]')?.value ?? "1").trim();
    const noOwner = !!row?.querySelector?.('[name="modNoOwner"]')?.checked;
    return { type: "marks", variant, value, noOwner };
  },

  // No stat accumulation — purely UI
  accumulate() {},
};

registerModifier(marksModifier);
