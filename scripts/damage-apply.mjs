// scripts/damage-apply.mjs
// Нанесение урона: расчёт ран по порогам, NPC авто-нанесение, диалог защиты PC, undo

// -------------------------
// Compat
// -------------------------
const hasV2 = !!foundry?.applications?.api?.ApplicationV2;
const HandlebarsMixin = foundry?.applications?.api?.HandlebarsApplicationMixin;
const BaseApp = hasV2 ? foundry.applications.api.ApplicationV2 : Application;

// -------------------------
// Undo stack
// Каждый элемент = { messageId, entries: [{ actorId, hpDelta, stressDelta, armorDelta }] }
// -------------------------
const _undoStack = [];

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
async function applyDamageToNpc(actor, dmg, stress, tokenId, sceneId) {
  const sys = actor?.system;
  if (!sys) return null;

  const noticeable = sys.damageThresholds?.noticeable ?? 1;
  const heavy = sys.damageThresholds?.heavy ?? 1;

  const { wounds } = calcWounds(dmg, noticeable, heavy);

  const updates = {};
  let hpDelta = 0, stressDelta = 0;

  if (wounds > 0) {
    hpDelta = wounds;
    const curHp = Number(sys.resources?.hp?.value ?? 0);
    updates["system.resources.hp.value"] = curHp + wounds;
  }

  if (stress > 0) {
    stressDelta = stress;
    const curStress = Number(sys.resources?.stress?.value ?? 0);
    updates["system.resources.stress.value"] = curStress + stress;
  }

  if (Object.keys(updates).length) {
    await actor.update(updates);
  }

  console.log(`[ADM] NPC "${actor.name}": +${wounds} wounds, +${stress} stress (dmg=${dmg})`);
  return { actorId: actor.id, tokenId: tokenId || null, sceneId: sceneId || null, hpDelta, stressDelta, armorDelta: 0 };
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

  constructor(actor, { dmg, damageType, stress, tokenId, sceneId } = {}, opts = {}) {
    super(opts);
    this.actor = actor;
    this._dmg = Math.max(0, Math.trunc(Number(dmg) || 0));
    this._damageType = String(damageType || "physical");
    this._stress = Math.max(0, Math.trunc(Number(stress) || 0));
    this._tokenId = tokenId || null;
    this._sceneId = sceneId || null;

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

  // --- Прямой урон: бронёй нельзя защититься ---
  get _isDirect() {
    return this._damageType === "direct";
  }

  // --- Можно ли ещё нажать кнопку брони ---
  get _canUseArmor() {
    if (this._isDirect) return false;
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
      isDirect: this._isDirect,
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
      if (this._isDirect) {
        armorBtn.disabled = true;
        armorBtn.classList.remove("is-active");
      } else {
        const fullyUsed = this._armorUsed > 0 && this._armorUsed >= this._maxArmorClicks;
        armorBtn.classList.toggle("is-active", fullyUsed);
        armorBtn.disabled = !ctx.canUseArmor && this._armorUsed === 0;
        if (this._armorUsed > 0) armorBtn.disabled = false;
      }
    }
    const armorText = root.querySelector("[data-adm-defense-armor-text]");
    if (armorText) armorText.textContent = `${ctx.armorValue}/${ctx.armorMax}`;

    // Extra armor button: disabled for direct damage
    const extraBtn = root.querySelector("[data-adm-defense-extra-armor]");
    if (extraBtn) extraBtn.disabled = this._isDirect;

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
    let hpDelta = 0, stressDelta = 0, armorDelta = 0;

    // Wounds (hp)
    if (wounds > 0) {
      hpDelta = wounds;
      const curHp = Number(sys.resources?.hp?.value ?? 0);
      updates["system.resources.hp.value"] = curHp + wounds;
    }

    // Stress
    if (this._stress > 0) {
      stressDelta = this._stress;
      const curStress = Number(sys.resources?.stress?.value ?? 0);
      updates["system.resources.stress.value"] = curStress + this._stress;
    }

    // Spend armor (increment value toward max)
    if (this._armorUsed > 0) {
      armorDelta = this._armorUsed;
      const curArmor = Number(sys.resources?.armor?.value ?? 0);
      const maxArmor = Number(sys.resources?.armor?.max ?? 0);
      updates["system.resources.armor.value"] = Math.min(maxArmor, curArmor + this._armorUsed);
    }

    if (Object.keys(updates).length) {
      await actor.update(updates);
    }

    // Record for undo
    const entry = { actorId: actor.id, tokenId: this._tokenId, sceneId: this._sceneId, hpDelta, stressDelta, armorDelta };
    if (this._undoBatchRef) {
      this._undoBatchRef.entries.push(entry);
    } else {
      _undoStack.push({ messageId: null, entries: [entry] });
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
export function openDefenseDialog(actor, { dmg, damageType, stress, tokenId, sceneId } = {}, undoBatch = null) {
  const app = new ADMDefenseDialog(actor, { dmg, damageType, stress, tokenId, sceneId });
  if (undoBatch) app._undoBatchRef = undoBatch;
  if (hasV2) app.render({ force: true });
  else app.render(true);
  return app;
}

// ═══════════════════════════════════════════
// Public: apply damage to all targets in a message
// ═══════════════════════════════════════════
export async function applyDamageFromMessage(state, messageId) {
  if (!state) return;

  const allTargets = [
    ...(state.hitTargets ?? []),
    ...(state.missTargets ?? []),
  ];

  const damageType = String(state.damageType || "physical");

  // Create undo batch for this entire "Нанести урон" click
  const batch = { messageId: messageId || null, entries: [] };

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

    if (actor.type === "npc") {
      const entry = await applyDamageToNpc(actor, dmg, stress, t.tokenId, t.sceneId);
      if (entry) batch.entries.push(entry);
    } else {
      // PC — диалог; передаём ссылку на batch, чтобы записать туда при коммите
      openDefenseDialog(actor, { dmg, damageType, stress, tokenId: t.tokenId, sceneId: t.sceneId }, batch);
    }
  }

  _undoStack.push(batch);
}

// ═══════════════════════════════════════════
// Public: undo last damage application
// ═══════════════════════════════════════════
export async function undoLastDamage() {
  if (!_undoStack.length) {
    console.log("[ADM] Undo: nothing to undo");
    return null;
  }

  const batch = _undoStack.pop();

  for (const entry of batch.entries) {
    const actor = (entry.tokenId ? _resolveActor(entry.tokenId, entry.sceneId) : null)
                  ?? game.actors?.get(entry.actorId);
    if (!actor) continue;

    const sys = actor.system;
    const updates = {};

    if (entry.hpDelta) {
      const cur = Number(sys?.resources?.hp?.value ?? 0);
      updates["system.resources.hp.value"] = Math.max(0, cur - entry.hpDelta);
    }

    if (entry.stressDelta) {
      const cur = Number(sys?.resources?.stress?.value ?? 0);
      updates["system.resources.stress.value"] = Math.max(0, cur - entry.stressDelta);
    }

    if (entry.armorDelta) {
      const cur = Number(sys?.resources?.armor?.value ?? 0);
      updates["system.resources.armor.value"] = Math.max(0, cur - entry.armorDelta);
    }

    if (Object.keys(updates).length) {
      await actor.update(updates);
      console.log(`[ADM] Undo: ${actor.name} hp-${entry.hpDelta} stress-${entry.stressDelta} armor-${entry.armorDelta}`);
    }
  }

  return batch.messageId;
}

// ═══════════════════════════════════════════
// Public: standalone defense dialog (from armor icon)
// ═══════════════════════════════════════════
export { openDefenseDialog as admOpenDefenseDialog };
