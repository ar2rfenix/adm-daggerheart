// scripts/damage-apply.mjs
// Нанесение урона: расчёт ран по порогам, NPC авто-нанесение, диалог защиты PC

// -------------------------
// Compat
// -------------------------
const hasV2 = !!foundry?.applications?.api?.ApplicationV2;
const HandlebarsMixin = foundry?.applications?.api?.HandlebarsApplicationMixin;
const BaseApp = hasV2 ? foundry.applications.api.ApplicationV2 : Application;

// -------------------------
// Damage type short label
// -------------------------
function _dmgTypeShort(key) {
  const k = String(key || "").trim().toLowerCase();
  if (k === "physical") return "физ.";
  if (k === "magical")  return "маг.";
  if (k === "direct")   return "прям.";
  return k;
}

// -------------------------
// Wounds calculation by thresholds
// -------------------------
function calcWounds(dmg, noticeable, heavy) {
  const n = Math.max(1, Math.trunc(Number(noticeable) || 1));
  const h = Math.max(1, Math.trunc(Number(heavy) || 1));

  if (dmg <= 0) return { wounds: 0, severity: "none" };
  if (dmg < n)  return { wounds: 1, severity: "minor" };
  if (dmg < h)  return { wounds: 2, severity: "noticeable" };
  if (dmg < h * 2) return { wounds: 3, severity: "heavy" };
  return { wounds: 4, severity: "critical" };
}

function severityRu(sev) {
  if (sev === "none")       return "Вы не получите ран";
  if (sev === "minor")      return "Низкий урон";
  if (sev === "noticeable") return "Ощутимый урон";
  if (sev === "heavy")      return "Тяжёлый урон";
  if (sev === "critical")   return "Колоссальный урон";
  return sev;
}

function woundsRu(n) {
  if (n <= 0) return "0 ран";
  if (n === 1) return "1 рану";
  if (n >= 2 && n <= 4) return `${n} раны`;
  return `${n} ран`;
}

// -------------------------
// Resolve token → actor
// -------------------------
function _resolveActor(tokenId, sceneId) {
  try {
    const scene = sceneId ? game.scenes?.get(sceneId) : canvas?.scene;
    if (!scene) return null;
    const td = scene.tokens?.get(tokenId);
    return td?.actor ?? null;
  } catch (_e) {
    return null;
  }
}

// -------------------------
// NPC: apply wounds + stress
// -------------------------
async function applyDamageToNpc(actor, dmg, stress) {
  const sys = actor?.system;
  if (!sys) return;

  const noticeable = sys.damageThresholds?.noticeable ?? 1;
  const heavy = sys.damageThresholds?.heavy ?? 1;

  const { wounds } = calcWounds(dmg, noticeable, heavy);

  const updates = {};

  if (wounds > 0) {
    const curHp = Number(sys.resources?.hp?.value ?? 0);
    updates["system.resources.hp.value"] = curHp + wounds;
  }

  if (stress > 0) {
    const curStress = Number(sys.resources?.stress?.value ?? 0);
    updates["system.resources.stress.value"] = curStress + stress;
  }

  if (Object.keys(updates).length) {
    await actor.update(updates);
  }

  console.log(`[ADM] NPC "${actor.name}": +${wounds} wounds, +${stress} stress (dmg=${dmg})`);
}

// ═══════════════════════════════════════════
// PC Defense Dialog
// ═══════════════════════════════════════════

class ADMDefenseDialog extends (HandlebarsMixin ? HandlebarsMixin(BaseApp) : BaseApp) {

  static DEFAULT_OPTIONS = hasV2
    ? {
        id: "adm-defense-{id}",
        window: { title: "Защита", resizable: false },
        classes: ["adm-daggerheart", "adm-defense-app"],
        width: 340,
        height: "auto",
      }
    : {
        id: "adm-defense",
        title: "Защита",
        classes: ["adm-daggerheart", "adm-defense-app"],
        width: 340,
        height: "auto",
        resizable: false,
      };

  static PARTS = hasV2
    ? { body: { template: "systems/adm-daggerheart/templates/partials/defense-dialog.hbs" } }
    : undefined;

  get template() {
    return "systems/adm-daggerheart/templates/partials/defense-dialog.hbs";
  }

  constructor(actor, { dmg, damageType, stress } = {}, opts = {}) {
    super(opts);
    this.actor = actor;
    this._dmg = Math.max(0, Math.trunc(Number(dmg) || 0));
    this._damageType = String(damageType || "physical");
    this._stress = Math.max(0, Math.trunc(Number(stress) || 0));

    // State
    this._armorUsed = 0;        // сколько раз использовали броню
    this._cancelWoundCount = 0; // сколько раз нажали «Отменить 1 рану»
    this._extraArmorCount = 0;  // сколько раз нажали «Позволить трату доп. брони»

    this._committed = false;
    this._admBound = false;
  }

  // --- Макс кликов брони: 1 базовый + extraArmorCount ---
  get _maxArmorClicks() {
    return 1 + this._extraArmorCount;
  }

  // --- Можно ли ещё нажать кнопку брони ---
  get _canUseArmor() {
    const sys = this.actor?.system;
    const cur = Number(sys?.resources?.armor?.value ?? 0);
    const max = Number(sys?.resources?.armor?.max ?? 0);
    // Доступная броня = max - (cur + уже потрачено)
    // cur — текущее значение, мы его увеличиваем при трате (cur → max)
    const available = max - cur - this._armorUsed;
    return available > 0 && this._armorUsed < this._maxArmorClicks;
  }

  // --- Effective damage after armor steps ---
  get _effectiveDmg() {
    const sys = this.actor?.system;
    const n = Math.max(1, sys?.damageThresholds?.noticeable ?? 1);
    const h = Math.max(1, sys?.damageThresholds?.heavy ?? 1);

    let dmg = this._dmg;
    for (let i = 0; i < this._armorUsed; i++) {
      const cur = calcWounds(dmg, n, h);
      if (cur.severity === "critical")   dmg = h * 2 - 1;
      else if (cur.severity === "heavy") dmg = h - 1;
      else if (cur.severity === "noticeable") dmg = n - 1;
      else if (cur.severity === "minor") dmg = 0;
    }
    return dmg;
  }

  get _currentWounds() {
    const sys = this.actor?.system;
    const n = sys?.damageThresholds?.noticeable ?? 1;
    const h = sys?.damageThresholds?.heavy ?? 1;
    let { wounds } = calcWounds(this._effectiveDmg, n, h);
    wounds = Math.max(0, wounds - this._cancelWoundCount);
    return wounds;
  }

  // =========================
  // Context for template
  // =========================
  _buildContext() {
    const sys = this.actor?.system;
    const n = sys?.damageThresholds?.noticeable ?? 1;
    const h = sys?.damageThresholds?.heavy ?? 1;
    const effDmg = this._effectiveDmg;
    const { severity } = calcWounds(effDmg, n, h);
    const wounds = this._currentWounds;

    const armorVal = Number(sys?.resources?.armor?.value ?? 0);
    const armorMax = Number(sys?.resources?.armor?.max ?? 0);
    const displayArmor = armorVal + this._armorUsed;

    const noWounds = wounds <= 0;

    return {
      dmg: this._dmg,
      damageTypeLabel: _dmgTypeShort(this._damageType),
      severityLabel: noWounds ? "Вы не получите ран" : severityRu(severity),
      woundsLabel: noWounds ? "" : woundsRu(wounds),
      noWounds,
      stress: this._stress,
      armorValue: Math.min(displayArmor, armorMax),
      armorMax,
      armorActive: this._armorUsed > 0 && this._armorUsed >= this._maxArmorClicks,
      canUseArmor: this._canUseArmor,
    };
  }

  async _prepareContext() {
    return this._buildContext();
  }

  getData(options = {}) {
    return this._buildContext();
  }

  // =========================
  // Render hooks
  // =========================
  _onRender(_context, _options) { this._bindUI(); }
  activateListeners(html) { this._bindUI(); }

  _bindUI() {
    if (this._admBound) return;
    this._admBound = true;

    const root = this.element instanceof HTMLElement
      ? this.element
      : this.element?.[0] ?? this.element;

    if (!root) return;

    // --- Editable damage input ---
    const dmgInput = root.querySelector("[data-adm-defense-dmg]");
    if (dmgInput) {
      dmgInput.addEventListener("input", () => {
        const v = Math.max(0, Math.trunc(Number(dmgInput.value) || 0));
        this._dmg = v;
        this._refreshUI(root);
      });
      dmgInput.addEventListener("blur", () => {
        dmgInput.value = this._dmg;
      });
    }

    // --- Armor button ---
    const armorBtn = root.querySelector("[data-adm-defense-armor]");
    if (armorBtn) {
      armorBtn.addEventListener("click", () => {
        if (this._canUseArmor) {
          this._armorUsed++;
        } else if (this._armorUsed > 0) {
          this._armorUsed = Math.max(0, this._armorUsed - 1);
        }
        this._refreshUI(root);
      });
    }

    // --- Cancel wound button (repeatable) ---
    const cancelBtn = root.querySelector("[data-adm-defense-cancel-wound]");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        this._cancelWoundCount++;
        this._refreshUI(root);
      });
    }

    // --- Extra armor button (repeatable) ---
    const extraBtn = root.querySelector("[data-adm-defense-extra-armor]");
    if (extraBtn) {
      extraBtn.addEventListener("click", () => {
        this._extraArmorCount++;
        this._refreshUI(root);
      });
    }

    // --- Submit ---
    const submitBtn = root.querySelector("[data-adm-defense-submit]");
    if (submitBtn) {
      submitBtn.addEventListener("click", async () => {
        await this._applyDamage();
      });
    }
  }

  _refreshUI(root) {
    if (!root) return;
    const ctx = this._buildContext();

    // Severity text
    const sevEl = root.querySelector("[data-adm-defense-severity]");
    if (sevEl) {
      if (this._currentWounds <= 0) {
        sevEl.textContent = "Вы не получите ран.";
      } else {
        sevEl.textContent = `${ctx.severityLabel}, вы получите ${ctx.woundsLabel}.`;
      }
    }

    // Armor button: active only when ALL allowed clicks are used up
    const armorBtn = root.querySelector("[data-adm-defense-armor]");
    if (armorBtn) {
      const fullyUsed = this._armorUsed > 0 && this._armorUsed >= this._maxArmorClicks;
      armorBtn.classList.toggle("is-active", fullyUsed);
      armorBtn.disabled = !ctx.canUseArmor && this._armorUsed === 0;
      if (this._armorUsed > 0) armorBtn.disabled = false;
    }
    const armorText = root.querySelector("[data-adm-defense-armor-text]");
    if (armorText) armorText.textContent = `${ctx.armorValue}/${ctx.armorMax}`;

    // Submit button
    const submitBtn = root.querySelector("[data-adm-defense-submit]");
    if (submitBtn) {
      if (this._currentWounds <= 0) {
        submitBtn.textContent = "Закончить без ран";
      } else {
        submitBtn.innerHTML = `Получить <span data-adm-defense-submit-text>${woundsRu(this._currentWounds)}</span>`;
      }
    }
  }

  // =========================
  // Apply: commit wounds + stress + spend armor
  // =========================
  async _applyDamage() {
    if (this._committed) return;
    this._committed = true;

    const actor = this.actor;
    const sys = actor?.system;
    if (!sys) return;

    const wounds = this._currentWounds;
    const updates = {};

    // Wounds (hp)
    if (wounds > 0) {
      const curHp = Number(sys.resources?.hp?.value ?? 0);
      updates["system.resources.hp.value"] = curHp + wounds;
    }

    // Stress
    if (this._stress > 0) {
      const curStress = Number(sys.resources?.stress?.value ?? 0);
      updates["system.resources.stress.value"] = curStress + this._stress;
    }

    // Spend armor (increment value toward max)
    if (this._armorUsed > 0) {
      const curArmor = Number(sys.resources?.armor?.value ?? 0);
      const maxArmor = Number(sys.resources?.armor?.max ?? 0);
      updates["system.resources.armor.value"] = Math.min(maxArmor, curArmor + this._armorUsed);
    }

    if (Object.keys(updates).length) {
      await actor.update(updates);
    }

    console.log(`[ADM] PC "${actor.name}": +${wounds} wounds, +${this._stress} stress, +${this._armorUsed} armor used`);

    await this.close();
  }

  // =========================
  // Close
  // =========================
  async close(options = {}) {
    this._admBound = false;
    return super.close(options);
  }
}

// ═══════════════════════════════════════════
// Public: open defense dialog for a PC
// ═══════════════════════════════════════════
export function openDefenseDialog(actor, { dmg, damageType, stress } = {}) {
  const app = new ADMDefenseDialog(actor, { dmg, damageType, stress });
  if (hasV2) app.render({ force: true });
  else app.render(true);
  return app;
}

// ═══════════════════════════════════════════
// Public: apply damage to all targets in a message
// ═══════════════════════════════════════════
export async function applyDamageFromMessage(state) {
  if (!state) return;

  const allTargets = [
    ...(state.hitTargets ?? []),
    ...(state.missTargets ?? []),
  ];

  const damageType = String(state.damageType || "physical");

  for (const t of allTargets) {
    if (t.excluded) continue;

    const dmg = Math.max(0, Math.trunc(Number(t.dmg) || 0));
    const stress = Math.max(0, Math.trunc(Number(t.stress) || 0));
    if (dmg <= 0 && stress <= 0) continue;

    const actor = _resolveActor(t.tokenId, t.sceneId);
    if (!actor) {
      console.warn(`[ADM] Cannot resolve actor for token ${t.tokenId}`);
      continue;
    }

    const isNpc = actor.type === "npc";

    if (isNpc) {
      await applyDamageToNpc(actor, dmg, stress);
    } else {
      openDefenseDialog(actor, { dmg, damageType, stress });
    }
  }
}

// ═══════════════════════════════════════════
// Public: standalone defense dialog (from armor icon)
// ═══════════════════════════════════════════
export { openDefenseDialog as admOpenDefenseDialog };
