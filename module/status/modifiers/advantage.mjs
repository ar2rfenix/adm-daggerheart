// systems/adm-daggerheart/module/status/modifiers/advantage.mjs
// Modifier type: Преимущество / Помеха (Advantage / Disadvantage)

import { registerModifier } from "./registry.mjs";

const EDGE_TYPES = [
  { value: "advantage",    label: "Преимущество" },
  { value: "disadvantage", label: "Помеха" },
];

const TRAIT_OPTIONS = [
  { value: "all",       label: "Все" },
  { value: "strength",  label: "Сила" },
  { value: "agility",   label: "Проворность" },
  { value: "finesse",   label: "Искусность" },
  { value: "instinct",  label: "Чутьё" },
  { value: "presence",  label: "Влияние" },
  { value: "knowledge", label: "Знание" },
];

// Русские метки для атрибутов (короткие)
const TRAIT_LABEL_RU = {
  all: "Все",
  strength: "Сила",
  agility: "Проворность",
  finesse: "Искусность",
  instinct: "Чутьё",
  presence: "Влияние",
  knowledge: "Знание",
};

function _buildSelectHTML(options, selected) {
  const sel = String(selected ?? "").trim();
  return options.map(o => {
    const isSel = o.value === sel ? " selected" : "";
    return `<option value="${o.value}"${isSel}>${o.label}</option>`;
  }).join("");
}

export const advantageModifier = {
  type: "advantage",
  label: "Преимущество/Помеха",
  kind: "persistent",

  /**
   * Stored mod structure:
   * {
   *   type: "advantage",
   *   value: "advantage" | "disadvantage",
   *   trait: "all" | "strength" | ... | "knowledge",
   *   context: "" | "reaction" | "attack"
   * }
   */

  normalize(mod) {
    const mm = mod ?? {};
    const value = EDGE_TYPES.some(e => e.value === mm.value)
      ? mm.value : "advantage";
    const trait = TRAIT_OPTIONS.some(t => t.value === mm.trait)
      ? mm.trait : "all";
    const ctx = (mm.context === "reaction" || mm.context === "attack")
      ? mm.context : "";
    return { type: "advantage", value, trait, context: ctx };
  },

  /**
   * Format for status list display on creature sheet.
   * PC: "Помеха: Сила (Реакция)" / "Преимущество: Все"
   * NPC: "Помеха (Атака)" / "Преимущество (Реакция)"
   * We pass the full mod object as JSON string via value; formatValue receives it.
   */
  formatValue(rawValue, { actor } = {}) {
    let parsed;
    try { parsed = typeof rawValue === "object" ? rawValue : JSON.parse(rawValue); }
    catch (_e) { parsed = {}; }

    const nm = this.normalize(parsed);
    const edgeLabel = nm.value === "disadvantage" ? "Помеха" : "Преимущество";
    const traitLabel = TRAIT_LABEL_RU[nm.trait] || "";
    const ctxLabel = nm.context === "reaction" ? "Реакция"
                   : nm.context === "attack" ? "Атака" : "";

    const isNpc = actor?.type === "npc";

    if (isNpc) {
      // NPC: "Помеха (Атака)" or "Преимущество"
      return ctxLabel ? `${edgeLabel} (${ctxLabel})` : edgeLabel;
    }

    // PC: "Помеха: Сила (Реакция)" or "Преимущество: Все"
    let text = edgeLabel;
    if (traitLabel) text += `: ${traitLabel}`;
    if (ctxLabel) text += ` (${ctxLabel})`;
    return text;
  },

  // UI: editor row in status dialog
  renderEditorRowHTML({ mod, helpers }) {
    const { escapeHTML } = helpers;
    const nm = this.normalize(mod);

    const isReaction = nm.context === "reaction";
    const isAttack = nm.context === "attack";

    return `
<div class="adm-status-mod-row" data-mod-type="advantage">
  <div class="adm-status-mod-col">
    <div class="adm-status-mod-title">${escapeHTML(this.label)}</div>
    <select name="modValue">
      ${_buildSelectHTML(EDGE_TYPES, nm.value)}
    </select>
  </div>

  <div class="adm-status-mod-col">
    <div class="adm-status-mod-title">Атрибут</div>
    <select name="modTrait">
      ${_buildSelectHTML(TRAIT_OPTIONS, nm.trait)}
    </select>
  </div>

  <div class="adm-status-mod-col">
    <div class="adm-status-mod-title">&nbsp;</div>
    <label style="white-space:nowrap;cursor:pointer;">
      <input type="checkbox" name="modCtxReaction" ${isReaction ? "checked" : ""} /> Реакция
    </label>
    <label style="white-space:nowrap;cursor:pointer;">
      <input type="checkbox" name="modCtxAttack" ${isAttack ? "checked" : ""} /> Атака
    </label>
  </div>

  <button type="button" class="adm-status-mod-del" data-action="adm-status-mod-del" title="Удалить">×</button>
</div>`;
  },

  // Read from editor DOM row
  readEditorRow({ row }) {
    const value = String(row?.querySelector?.('[name="modValue"]')?.value ?? "advantage").trim();
    const trait = String(row?.querySelector?.('[name="modTrait"]')?.value ?? "all").trim();
    const isReaction = !!row?.querySelector?.('[name="modCtxReaction"]')?.checked;
    const isAttack = !!row?.querySelector?.('[name="modCtxAttack"]')?.checked;

    // Only one context can be active
    let context = "";
    if (isReaction) context = "reaction";
    else if (isAttack) context = "attack";

    return { type: "advantage", value, trait, context };
  },

  // No stat accumulation — this modifier affects roll dialogs, not stats
  accumulate() {},
};

registerModifier(advantageModifier);

// ═══════════════════════════════════════════
// Public API: collect advantage/disadvantage from actor statuses
// ═══════════════════════════════════════════

/**
 * Gather all advantage/disadvantage modifiers active on an actor.
 * Returns array of { edge: "advantage"|"disadvantage", trait, context, statusName }
 */
export function collectEdgeMods(actor) {
  if (!actor) return [];

  const FLAG_SCOPE = "adm-daggerheart";
  const results = [];

  const _pushMods = (mods, statusName) => {
    for (const m of (mods ?? [])) {
      if (String(m?.type || "").trim() !== "advantage") continue;
      const nm = advantageModifier.normalize(m);
      results.push({
        edge: nm.value,        // "advantage" | "disadvantage"
        trait: nm.trait,        // "all" | specific trait key
        context: nm.context,   // "" | "reaction" | "attack"
        statusName,
      });
    }
  };

  const _processActiveDefs = (defs, fallbackName, isEquipped) => {
    if (!Array.isArray(defs)) return;
    for (const def of defs) {
      const when = String(def?.when || "equip").trim();
      if (when === "button") continue;
      const isActive = when === "backpack" ? true : isEquipped;
      if (!isActive) continue;
      _pushMods(def.mods, String(def?.name || fallbackName || "Статус"));
    }
  };

  // 1. Item statuses
  for (const item of (actor.items ?? [])) {
    const container = String(item.getFlag?.(FLAG_SCOPE, "container") || "backpack");
    const isEquipped = container === "equipped";
    const defs = item.getFlag?.(FLAG_SCOPE, "statusDefs");
    if (Array.isArray(defs)) _processActiveDefs(defs, item.name, isEquipped);
  }

  // 2. Actor local statuses (always active)
  const actorDefs = actor.getFlag?.(FLAG_SCOPE, "actorStatusDefs");
  if (Array.isArray(actorDefs)) _processActiveDefs(actorDefs, "", true);

  // 3. Applied statuses (always active)
  const appliedDefs = actor.getFlag?.(FLAG_SCOPE, "appliedStatusDefs");
  if (Array.isArray(appliedDefs)) _processActiveDefs(appliedDefs, "", true);

  return results;
}

/**
 * Given an actor and roll context, compute net advantage/disadvantage delta
 * and collect label texts for display in the roll dialog.
 *
 * @param {Actor} actor
 * @param {string} traitKey  - selected trait key (e.g. "agility")
 * @param {boolean} isReaction
 * @param {boolean} isAttack - true if roll was opened from weapon/attack
 * @returns {{ advDelta: number, disDelta: number, labels: string[] }}
 */
export function computeEdgeForRoll(actor, traitKey, isReaction, isAttack) {
  const mods = collectEdgeMods(actor);
  let advDelta = 0;
  let disDelta = 0;
  const labels = [];

  const tk = String(traitKey || "").trim().toLowerCase();

  for (const m of mods) {
    // Check trait match
    if (m.trait !== "all" && m.trait !== tk) continue;

    // Check context match
    if (m.context === "reaction" && !isReaction) continue;
    if (m.context === "attack" && !isAttack) continue;

    // Match!
    if (m.edge === "advantage") {
      advDelta += 1;
    } else {
      disDelta += 1;
    }

    // Build label for roll dialog status section
    const isNpc = actor?.type === "npc";
    const edgeLabel = m.edge === "disadvantage" ? "Помеха" : "Преимущество";
    const traitLabel = TRAIT_LABEL_RU[m.trait] || "";
    const ctxLabel = m.context === "reaction" ? "(Реакция)"
                   : m.context === "attack" ? "(Атака)" : "";

    let label;
    if (isNpc) {
      label = `${edgeLabel}. ${ctxLabel} от ${m.statusName}`.trim();
    } else {
      const parts = [edgeLabel + "."];
      if (traitLabel && m.trait !== "all") parts.push(traitLabel);
      if (ctxLabel) parts.push(ctxLabel);
      parts.push(`от ${m.statusName}`);
      label = parts.join(" ");
    }
    labels.push(label);
  }

  return { advDelta, disDelta, labels };
}
