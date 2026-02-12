// systems/adm-daggerheart/module/roll/roll.mjs
// UI-окна бросков (только окно + выбор атрибута, без механики броска)
import { admPcRollToChat, admNpcRollToChat } from "../../scripts/roll-helper.mjs";
import { computeEdgeForRoll } from "../status/modifiers/advantage.mjs";

// =========================
// Utils
// =========================
function _loc(keyOrText) {
  if (!keyOrText) return "";
  const s = String(keyOrText);
  try {
    const loc = game?.i18n?.localize?.(s);
    if (loc && loc !== s) return loc;
  } catch (_e) {}
  return s;
}

function _getTraitsList(selectedKey = "") {
  const map = CONFIG.ADM_DAGGERHEART?.traits ?? {};
  const sel = String(selectedKey || "").trim().toLowerCase();
  return Object.entries(map).map(([k, v]) => {
    const key = String(k).trim().toLowerCase();
    return { key, label: _loc(v) || key, selected: key === sel };
  });
}

function _normalizeExperiences(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    return Object.keys(raw)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => raw[k]);
  }
  return [];
}

function _getActorExperiences(actor) {
  const exps = _normalizeExperiences(actor?.system?.experiences);
  return exps
    .map((e, idx) => ({
      id: String(idx),
      name: String(e?.name ?? "").trim(),
      gainText: String(e?.gainText ?? "").trim(),
      value: Number(e?.value ?? 0) || 0,
      active: false,
    }))
    .filter((e) => e.name);
}

function _asInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function _clampInt(n, min, max) {
  const x = Math.trunc(Number(n ?? 0) || 0);
  return Math.max(min, Math.min(max, x));
}

// --- PC Hope (actor.resources.hope.value) ---
function _getActorHope(actor) {
  const cur = Number(actor?.system?.resources?.hope?.value ?? 0) || 0;
  const max = Number(actor?.system?.resources?.hope?.max ?? 0) || 0;
  return { cur, max };
}

async function _setActorHope(actor, next) {
  if (!actor) return;
  const upd = {};
  foundry.utils.setProperty(upd, "system.resources.hope.value", next);
  await actor.update(upd);
}

// --- NPC Fear (global setting daggerheart:fear) ---
function _getGlobalFear() {
  const cur = Number(game.settings.get("daggerheart", "fear") ?? 0) || 0;
  const homebrew = game.settings.get("daggerheart", "homebrew") ?? {};
  const max = Number(homebrew?.maxFear ?? 12) || 12;
  return { cur, max };
}

async function _setGlobalFear(next) {
  await game.settings.set("daggerheart", "fear", next);
}

function _dieSvgCandidates(sides) {
  const n = _asInt(sides, 12);
  const base = `icons/svg/d${n}`;
  return [`${base}-grey.svg`, `${base}.svg`];
}

function _route(p) {
  try {
    return foundry.utils.getRoute(p);
  } catch (_e) {
    return `/${String(p).replace(/^\/+/, "")}`;
  }
}

function _dieSvgSrcDefault(sides) {
  return _route(_dieSvgCandidates(sides)[0]);
}

function _setDieMask(el, src) {
  if (!el) return;
  el.style.setProperty("--adm-die-svg", `url("${src}")`);
}

// =========================
// Compat v11/v12/v13
// =========================
const hasV2 = !!foundry?.applications?.api?.ApplicationV2;
const HandlebarsMixin = foundry?.applications?.api?.HandlebarsApplicationMixin;
const BaseApp = hasV2 ? foundry.applications.api.ApplicationV2 : Application;

function _mergeLegacyOptions(base, extra) {
  try {
    return foundry.utils.mergeObject(base, extra);
  } catch (_e) {
    return mergeObject ? mergeObject(base, extra) : { ...base, ...extra };
  }
}

// =========================
// PC Roll Dialog
// =========================
class ADMRollPCDialog extends (HandlebarsMixin ? HandlebarsMixin(BaseApp) : BaseApp) {
  static DEFAULT_OPTIONS = hasV2
    ? {
        id: "adm-roll-pc",
        window: { title: "Проверка атрибута", resizable: false },
        classes: ["adm-daggerheart", "adm-roll-app"],
        width: 520,
        height: "auto",
      }
    : _mergeLegacyOptions(super.defaultOptions, {
        id: "adm-roll-pc",
        title: "Проверка атрибута",
        classes: ["adm-daggerheart", "adm-roll-app"],
        width: 520,
        height: "auto",
        resizable: false,
      });

  static PARTS = hasV2
    ? { body: { template: "systems/adm-daggerheart/templates/partials/roll-pc.hbs" } }
    : undefined;

  get template() {
    return "systems/adm-daggerheart/templates/partials/roll-pc.hbs";
  }

  constructor(actor, opts = {}) {
    super(opts);
    this.actor = actor;

    this._admState = {
      trait: String(opts.trait ?? "").trim().toLowerCase() || "agility",

      weaponName: String(opts.weaponName ?? "").trim(),
      weaponUuid: String(opts.weaponUuid ?? "").trim(),
  attackAnimation: String(
    opts.attackAnimation ?? opts.weaponAttackAnimation ?? opts.anim ?? ""
  ).trim(),

      weaponDamageFormula: String(opts.weaponDamageFormula ?? opts.damage ?? "").trim(),
      weaponDamageType: String(opts.weaponDamageType ?? opts.damageType ?? "").trim(),

      // обратная совместимость
      damage: String(opts.damage ?? "").trim(),
      damageType: String(opts.damageType ?? "").trim(),

      isReaction: !!opts.isReaction,
      hopeDie: _asInt(opts.hopeDie ?? 12, 12),
      fearDie: _asInt(opts.fearDie ?? 12, 12),
      mod: _asInt(opts.mod ?? 0, 0),
      adv: _asInt(opts.adv ?? 0, 0),
      dis: _asInt(opts.dis ?? 0, 0),

      experiences:
        Array.isArray(opts.experiences) && opts.experiences.length
          ? opts.experiences.map((e, idx) => ({
              id: String(e?.id ?? e?._id ?? idx),
              name: String(e?.name ?? "").trim(),
              value: Number(e?.value ?? 0) || 0,
              active: !!e?.active,
            })).filter((e) => e.name)
          : _getActorExperiences(actor),
    };



    // транзакция: тратим hope при кликах по опытам
    this._admCommit = false; // true только если нажали "roll"
    this._admHopeSpent = 0;  // сколько hope списали в этом окне

    this._admGlobalHandlers = null;
    this._admBound = false;

    // Edge from statuses (advantage/disadvantage)
    this._admStatusEdge = { advDelta: 0, disDelta: 0, labels: [] };
    this._recomputeStatusEdge();
  }

  _recomputeStatusEdge() {
    const isAttack = !!(this._admState.weaponUuid || this._admState.weaponName);
    this._admStatusEdge = computeEdgeForRoll(
      this.actor,
      this._admState.trait,
      this._admState.isReaction,
      isAttack,
    );
  }

  async _prepareContext() {
    const ctx = await super._prepareContext?.();
    const out = ctx ?? {};

    out.traits = _getTraitsList(this._admState.trait);
    out.isReaction = this._admState.isReaction;

    out.dieOptions = [8, 10, 12, 20];
    out.hopeDie = this._admState.hopeDie;
    out.fearDie = this._admState.fearDie;
    out.mod = this._admState.mod;

    out.adv = (this._admState.adv || 0) + (this._admStatusEdge.advDelta || 0);
    out.dis = (this._admState.dis || 0) + (this._admStatusEdge.disDelta || 0);

    out.hopeDieSrc = _dieSvgSrcDefault(out.hopeDie);
    out.fearDieSrc = _dieSvgSrcDefault(out.fearDie);
    out.advDieSrc = _dieSvgSrcDefault(6);
    out.disDieSrc = _dieSvgSrcDefault(6);

    out.experiences = this._admState.experiences;
    out.statusEdgeLabels = this._admStatusEdge.labels;
    return out;
  }

  // legacy v11
  getData(options = {}) {
    const out = super.getData ? super.getData(options) : {};

    out.traits = _getTraitsList(this._admState.trait);
    out.isReaction = this._admState.isReaction;

    out.dieOptions = [8, 10, 12, 20];
    out.hopeDie = this._admState.hopeDie;
    out.fearDie = this._admState.fearDie;
    out.mod = this._admState.mod;

    out.adv = (this._admState.adv || 0) + (this._admStatusEdge.advDelta || 0);
    out.dis = (this._admState.dis || 0) + (this._admStatusEdge.disDelta || 0);

    out.hopeDieSrc = _dieSvgSrcDefault(out.hopeDie);
    out.fearDieSrc = _dieSvgSrcDefault(out.fearDie);
    out.advDieSrc = _dieSvgSrcDefault(6);
    out.disDieSrc = _dieSvgSrcDefault(6);

    out.experiences = this._admState.experiences;
    out.statusEdgeLabels = this._admStatusEdge.labels;
    return out;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this._bindUI();
  }

  activateListeners(html) {
    super.activateListeners?.(html);
    this.element = html?.[0] ?? html;
    this._bindUI();
  }

  async close(options = {}) {
    this._unbindGlobalHandlers();

    // если окно закрыли крестиком/esc (или cancel) — вернуть всю потраченную надежду
    if (!this._admCommit && this._admHopeSpent > 0) {
      try {
        const { cur, max } = _getActorHope(this.actor);
        const next = max > 0 ? _clampInt(cur + this._admHopeSpent, 0, max) : (cur + this._admHopeSpent);
        await _setActorHope(this.actor, next);
      } catch (_e) {}

      // сброс активных опытов в локальном состоянии
      try {
        for (const e of this._admState.experiences) e.active = false;
      } catch (_e) {}
      this._admHopeSpent = 0;
    }

    return super.close ? super.close(options) : undefined;
  }

  _bindUI() {
    const root = this.element;
    if (!root || this._admBound) return;
    this._admBound = true;

    const closeAllMenus = () => {
      root.querySelectorAll("[data-adm-die-menu]").forEach((m) => (m.hidden = true));
      root.querySelectorAll('[data-adm-action="toggle-die-menu"]').forEach((b) => {
        b.setAttribute("aria-expanded", "false");
      });
    };


    const toggleMenu = (target) => {
      const t = String(target || "").trim().toLowerCase();
      if (!t) return;

      const btn = root.querySelector(
        `[data-adm-action="toggle-die-menu"][data-adm-die-target="${CSS.escape(t)}"]`
      );
      const menu = root.querySelector(`[data-adm-die-menu="${CSS.escape(t)}"]`);
      if (!btn || !menu) return;

      const willOpen = !!menu.hidden;
      closeAllMenus();
      menu.hidden = !willOpen;
      btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
    };

    // --- маска с гарантированным выставлением (сначала default, потом проверка candidates) ---
    const applyDieMaskWithFallback = (maskEl, sides) => {
      if (!maskEl) return;

      _setDieMask(maskEl, _dieSvgSrcDefault(sides));

      const candidates = _dieSvgCandidates(sides).map(_route);

      const probe = async (src) => {
        try {
          const r = await fetch(src, { method: "GET" });
          return !!r?.ok;
        } catch (_e) {
          return false;
        }
      };

      (async () => {
        for (const src of candidates) {
          if (await probe(src)) {
            _setDieMask(maskEl, src);
            return;
          }
        }
      })();
    };

    applyDieMaskWithFallback(root.querySelector('[data-adm-die-img="hope"]'), this._admState.hopeDie);
    applyDieMaskWithFallback(root.querySelector('[data-adm-die-img="fear"]'), this._admState.fearDie);
    applyDieMaskWithFallback(root.querySelector('[data-adm-die-img="adv"]'), 6);
    applyDieMaskWithFallback(root.querySelector('[data-adm-die-img="dis"]'), 6);

    const setDie = (target, value) => {
      const t = String(target || "").trim().toLowerCase();
      const v = Number(value);
      if (!t) return;
      if (![8, 10, 12, 20].includes(v)) return;

      if (t === "hope") this._admState.hopeDie = v;
      if (t === "fear") this._admState.fearDie = v;

      const icon = root.querySelector(`[data-adm-die-icon="${CSS.escape(t)}"]`);
      if (icon) icon.textContent = `d${v}`;

      const maskEl = root.querySelector(`[data-adm-die-img="${CSS.escape(t)}"]`);
      if (maskEl) applyDieMaskWithFallback(maskEl, v);

      const menu = root.querySelector(`[data-adm-die-menu="${CSS.escape(t)}"]`);
      if (menu) {
        menu.querySelectorAll(".adm-roll-diemenu-item").forEach((b) => b.classList.remove("is-active"));
        const active = menu.querySelector(
          `[data-adm-action="pick-die"][data-adm-die-target="${CSS.escape(t)}"][data-adm-die-value="${CSS.escape(
            String(v)
          )}"]`
        );
        if (active) active.classList.add("is-active");
      }
    };

    const setCounter = (which, v) => {
      const key = which === "adv" ? "adv" : "dis";
      const n = Math.max(0, _asInt(v, 0));
      this._admState[key] = n;
      // Display combined: manual + status edge
      const statusDelta = key === "adv"
        ? (this._admStatusEdge.advDelta || 0)
        : (this._admStatusEdge.disDelta || 0);
      const el = root.querySelector(`[data-adm-die-icon="${CSS.escape(key)}"]`);
      if (el) el.textContent = String(n + statusDelta);
    };

    const bumpCounter = (which, delta) => {
      const key = which === "adv" ? "adv" : "dis";
      setCounter(key, _asInt(this._admState[key], 0) + (Number(delta) || 0));
    };

    // поля
    root.querySelectorAll("[data-adm-field]").forEach((el) => {
      el.addEventListener("change", () => this._readFormState(), { passive: true });
      el.addEventListener("input", () => this._readFormState(), { passive: true });
    });

    // опыты -> тратим/возвращаем надежду
    const expCheckboxes = Array.from(root.querySelectorAll("[data-adm-exp-id]"));

    const updateExpLocks = () => {
      const { cur } = _getActorHope(this.actor);
      const noHope = cur <= 0;
      for (const cb of expCheckboxes) cb.disabled = noHope && !cb.checked;
    };

    for (const cb of expCheckboxes) {
      cb.addEventListener("change", async () => {
        const id = String(cb.dataset.admExpId || "");
        const exp = this._admState.experiences.find((x) => String(x.id) === id);
        if (!exp) return;

        // включили -> -1 hope
        if (cb.checked) {
          const { cur, max } = _getActorHope(this.actor);
          if (cur <= 0) {
            cb.checked = false;
            exp.active = false;
            updateExpLocks();
            return;
          }

          const next = max > 0 ? _clampInt(cur - 1, 0, max) : Math.max(0, cur - 1);
          try {
            await _setActorHope(this.actor, next);
            this._admHopeSpent += 1;
            exp.active = true;
          } catch (_e) {
            cb.checked = false;
            exp.active = false;
          }

          updateExpLocks();
          return;
        }

        // выключили -> +1 hope
        {
          const { cur, max } = _getActorHope(this.actor);
          const next = max > 0 ? _clampInt(cur + 1, 0, max) : (cur + 1);

          try {
            await _setActorHope(this.actor, next);
            this._admHopeSpent = Math.max(0, this._admHopeSpent - 1);
            exp.active = false;
          } catch (_e) {
            cb.checked = true;
            exp.active = true;
          }

          updateExpLocks();
        }
      });
    }

    updateExpLocks();

    // ПКМ на adv/dis без меню браузера
    const advBtn = root.querySelector('[data-adm-action="bump-adv"]');
    const disBtn = root.querySelector('[data-adm-action="bump-dis"]');
    if (advBtn) advBtn.addEventListener("contextmenu", (e) => e.preventDefault());
    if (disBtn) disBtn.addEventListener("contextmenu", (e) => e.preventDefault());

    // делегирование кликов
    root.addEventListener(
      "click",
      (ev) => {
        const btn = ev.target?.closest?.("[data-adm-action]");
        if (!btn) return;

        const act = String(btn.dataset.admAction || "");

        if (act === "toggle-die-menu") {
          ev.preventDefault();
          ev.stopPropagation();
          toggleMenu(btn.dataset.admDieTarget);
          return;
        }

        if (act === "pick-die") {
          ev.preventDefault();
          ev.stopPropagation();
          setDie(btn.dataset.admDieTarget, btn.dataset.admDieValue);
          closeAllMenus();
          return;
        }

        if (act === "bump-adv") {
          ev.preventDefault();
          ev.stopPropagation();
          bumpCounter("adv", +1);
          return;
        }

        if (act === "bump-dis") {
          ev.preventDefault();
          ev.stopPropagation();
          bumpCounter("dis", +1);
          return;
        }

        if (act === "cancel" || act === "roll") {
          this._onAction(ev);
        }
      },
      true
    );

    // ПКМ: -1
    root.addEventListener(
      "contextmenu",
      (ev) => {
        const btn = ev.target?.closest?.("[data-adm-action]");
        if (!btn) return;

        const act = String(btn.dataset.admAction || "");
        if (act === "bump-adv") {
          ev.preventDefault();
          ev.stopPropagation();
          bumpCounter("adv", -1);
          return;
        }
        if (act === "bump-dis") {
          ev.preventDefault();
          ev.stopPropagation();
          bumpCounter("dis", -1);
          return;
        }
      },
      true
    );

    this._bindGlobalHandlers(closeAllMenus);
  }

  _bindGlobalHandlers(closeAllMenus) {
    if (this._admGlobalHandlers) return;

    const root = this.element;

    const onDocDown = (e) => {
      if (!root || !root.isConnected) return;
      if (e.target && root.contains(e.target)) return;
      closeAllMenus();
    };

    const onKey = (e) => {
      if (!root || !root.isConnected) return;
      if (e.key === "Escape") closeAllMenus();
    };

    window.addEventListener("pointerdown", onDocDown, true);
    window.addEventListener("keydown", onKey, true);
    this._admGlobalHandlers = { onDocDown, onKey };
  }

  _unbindGlobalHandlers() {
    const h = this._admGlobalHandlers;
    if (!h) return;
    window.removeEventListener("pointerdown", h.onDocDown, true);
    window.removeEventListener("keydown", h.onKey, true);
    this._admGlobalHandlers = null;
  }

  _readFormState() {
    const root = this.element;
    if (!root) return;

    const trait = root.querySelector(`[data-adm-field="trait"]`)?.value ?? "";
    const isReaction = !!root.querySelector(`[data-adm-field="isReaction"]`)?.checked;
    const mod = _asInt(root.querySelector(`[data-adm-field="mod"]`)?.value, 0);

    this._admState.trait = String(trait).trim().toLowerCase();
    this._admState.isReaction = isReaction;
    this._admState.mod = mod;

    // Recompute status edge on trait/reaction change
    this._recomputeStatusEdge();
    this._updateStatusEdgeUI();
  }

  _updateStatusEdgeUI() {
    const root = this.element;
    if (!root) return;
    const wrap = root.querySelector("[data-adm-status-edge-list]");
    if (wrap) {
      const labels = this._admStatusEdge.labels;
      wrap.innerHTML = labels.length
        ? labels.map(l => `<div>${l}</div>`).join("")
        : `<div style="opacity:.75;">—</div>`;
    }
    // Update adv/dis dice counters (manual + status edge)
    const advEl = root.querySelector('[data-adm-die-icon="adv"]');
    const disEl = root.querySelector('[data-adm-die-icon="dis"]');
    if (advEl) advEl.textContent = String((this._admState.adv || 0) + (this._admStatusEdge.advDelta || 0));
    if (disEl) disEl.textContent = String((this._admState.dis || 0) + (this._admStatusEdge.disDelta || 0));
  }

  async _onAction(ev) {
    ev.preventDefault();
    ev.stopPropagation();

const btn = ev.target?.closest?.("[data-adm-action]");
const act = String(btn?.dataset?.admAction || "");

    if (act === "cancel") {
      // cancel = не commit -> close() вернет hope
      return void this.close();
    }
if (act === "roll") {
  this._admCommit = true;

  // Inject status edge into adv/dis
  const rollState = { ...this._admState };
  rollState.adv = (rollState.adv || 0) + (this._admStatusEdge.advDelta || 0);
  rollState.dis = (rollState.dis || 0) + (this._admStatusEdge.disDelta || 0);

  await admPcRollToChat(this.actor, rollState);

  return void this.close();
}

  }
}

// =========================
// NPC Roll Dialog
// =========================
class ADMRollNPCDialog extends (HandlebarsMixin ? HandlebarsMixin(BaseApp) : BaseApp) {
  static DEFAULT_OPTIONS = hasV2
    ? {
        id: "adm-roll-npc",
        window: { title: "Бросок НПС", resizable: false },
        classes: ["adm-daggerheart", "adm-roll-app"],
        width: 520,
        height: "auto",
      }
    : _mergeLegacyOptions(super.defaultOptions, {
        id: "adm-roll-npc",
        title: "Бросок НПС",
        classes: ["adm-daggerheart", "adm-roll-app"],
        width: 520,
        height: "auto",
        resizable: false,
      });

  static PARTS = hasV2
    ? { body: { template: "systems/adm-daggerheart/templates/partials/roll-npc.hbs" } }
    : undefined;

  get template() {
    return "systems/adm-daggerheart/templates/partials/roll-npc.hbs";
  }

  constructor(actor, opts = {}) {
    super(opts);
    this.actor = actor;

    const attackMod = Number(opts.attackMod ?? actor?.system?.attackMod ?? 0) || 0;

    const exps =
      Array.isArray(opts.experiences) && opts.experiences.length
        ? opts.experiences
        : _getActorExperiences(actor);

this._admState = {
  trait: String(opts.trait ?? "").trim().toLowerCase() || "agility",
  attackMod,
  weaponName: String(opts.weaponName ?? "").trim(),
  weaponUuid: String(opts.weaponUuid ?? "").trim(),
      attackAnimation: String(
        opts.attackAnimation ?? opts.weaponAttackAnimation ?? opts.anim ?? ""
      ).trim(),

  // единый формат для roll-helper
  weaponDamageFormula: String(opts.weaponDamageFormula ?? "").trim(),
  weaponDamageType: String(opts.weaponDamageType ?? "").trim(),

  // обратная совместимость (если где-то уже пробрасывали damage/damageType)
  damage: String(opts.damage ?? "").trim(),
  damageType: String(opts.damageType ?? "").trim(),

  isReaction: !!opts.isReaction,
  hopeDie: _asInt(opts.hopeDie ?? 12, 12),
  fearDie: _asInt(opts.fearDie ?? 12, 12),
  mod: _asInt(opts.mod ?? 0, 0),
  adv: _asInt(opts.adv ?? 0, 0),
  dis: _asInt(opts.dis ?? 0, 0),
  experiences: _getActorExperiences(actor),
};


    // транзакция: тратим fear при кликах по опытам
    this._admCommit = false; // true только если нажали roll (любой режим)
    this._admFearSpent = 0;

    this._admBound = false;

    // Edge from statuses
    this._admStatusEdge = { advDelta: 0, disDelta: 0, labels: [] };
    this._recomputeStatusEdge();
  }

  _recomputeStatusEdge() {
    const isAttack = !!(this._admState.weaponDamageFormula || this._admState.weaponName);
    this._admStatusEdge = computeEdgeForRoll(
      this.actor,
      "all",
      this._admState.isReaction,
      isAttack,
    );
  }

  _updateStatusEdgeUI() {
    const root = this.element;
    if (!root) return;
    const wrap = root.querySelector("[data-adm-status-edge-list]");
    if (!wrap) return;
    const labels = this._admStatusEdge.labels;
    wrap.innerHTML = labels.length
      ? labels.map(l => `<div>${l}</div>`).join("")
      : `<div style="opacity:.75;">—</div>`;
  }

  async _prepareContext() {
    const ctx = await super._prepareContext?.();
    const out = ctx ?? {};

    out.isReaction = this._admState.isReaction;
    out.system = { ...(this.actor?.system || {}), attackMod: Number(this._admState.attackMod) || 0 };
    out.experiences = this._admState.experiences;

    out.expMod = this._sumActiveExp();
    out.totalMod = (Number(this._admState.attackMod) || 0) + out.expMod;

    out.statusEdgeLabels = this._admStatusEdge.labels;

    return out;
  }

  // legacy v11
  getData(options = {}) {
    const out = super.getData ? super.getData(options) : {};

    out.isReaction = this._admState.isReaction;
    out.system = { ...(this.actor?.system || {}), attackMod: Number(this._admState.attackMod) || 0 };
    out.experiences = this._admState.experiences;

    out.expMod = this._sumActiveExp();
    out.totalMod = (Number(this._admState.attackMod) || 0) + out.expMod;

    out.statusEdgeLabels = this._admStatusEdge.labels;

    return out;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this._bindUI();
  }

  activateListeners(html) {
    super.activateListeners?.(html);
    this.element = html?.[0] ?? html;
    this._bindUI();
  }

  async close(options = {}) {
    // если окно закрыли крестиком/esc — вернуть fear, потраченный в этом окне
    if (!this._admCommit && this._admFearSpent > 0) {
      try {
        const { cur, max } = _getGlobalFear();
        const next = _clampInt(cur + this._admFearSpent, 0, max);
        await _setGlobalFear(next);
      } catch (_e) {}

      try {
        for (const e of this._admState.experiences) e.active = false;
      } catch (_e) {}
      this._admFearSpent = 0;
    }

    return super.close ? super.close(options) : undefined;
  }

  _bindUI() {
    const root = this.element;
    if (!root || this._admBound) return;
    this._admBound = true;

    // attackMod
    const attackEl = root.querySelector('[data-adm-field="attackMod"]');
    if (attackEl) {
      const onAttack = () => {
        this._admState.attackMod = _asInt(attackEl.value, 0);
        // UI-окно: можно не ререндерить полностью, но оставим как у вас
        this.render?.(false);
      };
      attackEl.addEventListener("input", onAttack, { passive: true });
      attackEl.addEventListener("change", onAttack, { passive: true });
    }

    // isReaction
    const reactEl = root.querySelector('[data-adm-field="isReaction"]');
    if (reactEl) {
      reactEl.addEventListener(
        "change",
        () => {
          this._admState.isReaction = !!reactEl.checked;
          this._recomputeStatusEdge();
          this._updateStatusEdgeUI();
        },
        { passive: true }
      );
    }

    // опыты -> тратим/возвращаем fear (global)
    const expCheckboxes = Array.from(root.querySelectorAll("[data-adm-exp-id]"));

    const updateExpLocks = () => {
      const { cur } = _getGlobalFear();
      const noFear = cur <= 0;
      for (const cb of expCheckboxes) cb.disabled = noFear && !cb.checked;
    };

    for (const cb of expCheckboxes) {
      cb.addEventListener("change", async () => {
        const id = String(cb.dataset.admExpId || "");
        const exp = this._admState.experiences.find((x) => String(x.id) === id);
        if (!exp) return;

        // включили -> -1 fear
        if (cb.checked) {
          const { cur, max } = _getGlobalFear();
          if (cur <= 0) {
            cb.checked = false;
            exp.active = false;
            updateExpLocks();
            return;
          }

          const next = _clampInt(cur - 1, 0, max);
          try {
            await _setGlobalFear(next);
            this._admFearSpent += 1;
            exp.active = true;
          } catch (_e) {
            cb.checked = false;
            exp.active = false;
          }

          updateExpLocks();
          return;
        }

        // выключили -> +1 fear
        {
          const { cur, max } = _getGlobalFear();
          const next = _clampInt(cur + 1, 0, max);

          try {
            await _setGlobalFear(next);
            this._admFearSpent = Math.max(0, this._admFearSpent - 1);
            exp.active = false;
          } catch (_e) {
            cb.checked = true;
            exp.active = true;
          }

          updateExpLocks();
        }
      });
    }

    updateExpLocks();

// roll buttons (Помеха/Обычный/Преимущество)
root.querySelectorAll('[data-adm-action="roll"]').forEach((btn) => {
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    this._admCommit = true;

let mode = String(btn.dataset.admRollMode || "normal").toLowerCase();
if (mode === "adv") mode = "advantage";
if (mode === "dis") mode = "disadvantage";

await admNpcRollToChat(this.actor, this._admState, mode);


    this.close?.();
  });
});

  }

  _sumActiveExp() {
    let sum = 0;
    for (const e of this._admState.experiences || []) {
      if (e?.active) sum += Number(e.value || 0);
    }
    return sum;
  }
}

// =========================
// Public API
// =========================
export function admOpenPcRollDialog(actor, opts = {}) {
  if (!actor) return;
  const app = new ADMRollPCDialog(actor, opts);
  if (hasV2) app.render({ force: true });
  else app.render(true);
  return app;
}

export function admOpenNpcRollDialog(actor, opts = {}) {
  if (!actor) return;
  const app = new ADMRollNPCDialog(actor, opts);
  if (hasV2) app.render({ force: true });
  else app.render(true);
  return app;
}
