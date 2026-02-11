// systems/adm-daggerheart/module/status/modifiers/resilience.mjs

import { registerModifier } from "./registry.mjs";

const OPTIONS = [
  { value: "resist_phy", label: "Сопротивление физ." },
  { value: "resist_mag", label: "Сопротивление маг." },
  { value: "vuln_phy",   label: "Уязвимость физ." },
  { value: "vuln_mag",   label: "Уязвимость маг." },
  { value: "immune_phy", label: "Иммунитет физ." },
  { value: "immune_mag", label: "Иммунитет маг." },
];

function _buildOptionsHTML(selected) {
  const sel = String(selected ?? "").trim();
  return OPTIONS.map(o => {
    const isSel = o.value === sel ? " selected" : "";
    return `<option value="${o.value}"${isSel}>${o.label}</option>`;
  }).join("");
}

export const resilienceModifier = {
  type: "resilience",
  label: "Устойчивость",
  kind: "persistent",
  formatValue(value) {
    const v = String(value ?? "").trim();
    const hit = OPTIONS.find(o => o.value === v);
    return hit ? hit.label : v;
  },

  // UI: строка модификатора в редакторе статусов
  renderEditorRowHTML({ mod, helpers }) {
    const { escapeHTML } = helpers;
    const nm = this.normalize(mod);
    const v = String(nm.value ?? "resist_phy").trim() || "resist_phy";

    return `
<div class="adm-status-mod-row" data-mod-type="resilience">
  <div class="adm-status-mod-col">
    <div class="adm-status-mod-title">${escapeHTML(this.label)}</div>
    <select name="modValue">
      ${_buildOptionsHTML(v)}
    </select>
  </div>

  <button type="button" class="adm-status-mod-del" data-action="adm-status-mod-del" title="Удалить">×</button>
</div>`;
  },

  // UI: чтение строки модификатора из DOM
  readEditorRow({ row }) {
    const value = String(row?.querySelector?.('[name="modValue"]')?.value ?? "").trim();
    return { type: "resilience", value };
  },

  // Нормализация входных данных (на будущее — совместимость с возможными старыми ключами)
  normalize(mod) {
    const mm = mod ?? {};
    let type = String(mm.type ?? "resilience").trim() || "resilience";
    if (type === "resist") type = "resilience";

    const value =
      mm.value != null ? String(mm.value).trim()
      : mm.mode != null ? String(mm.mode).trim()
      : "resist_phy";

    // защита от мусорных значений
    const ok = new Set(OPTIONS.map(o => o.value));
    const safeValue = ok.has(value) ? value : "resist_phy";

    return { type, value: safeValue };
  },

  // Пока не влияет на статы (подключим позже в модификации входящего урона)
  accumulate() {},
};

registerModifier(resilienceModifier);
