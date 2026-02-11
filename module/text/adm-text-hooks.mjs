// systems/adm-daggerheart/module/text/adm-text-hooks.mjs
import { admToggleTokenRing } from "../../scripts/rings.mjs";

import { admSyncActorStatusMods, admEvalStatusValue } from "../status/status-modifiers.mjs";

import {
  admPathForLabel,
  admIsMagicLabel,
  admMagicValue,
} from "../status/adm-terms.mjs";

import { admDamageRollToChat } from "../../scripts/damage-helper.mjs";



const SCOPE = "adm-daggerheart";
const FLAG_ITEM_DEFS = "statusDefs";
const FLAG_APPLIED = "appliedStatusDefs";

let __socket = null;

/**
 * Инициализация: сокеты + глобальный обработчик кликов.
 */
export function admTextHooksInit() {
  _initSockets();
  _installGlobalClickHandler();
  _installResButtonStyles();
}

/**
 * Применить подмены в HTML-строке (после enrichHTML).
 * Заменяет [/st Имя] -> <button ...>Имя</button>, но ТОЛЬКО если:
 * - передан item
 * - у item есть статус с name==Имя и activator=="button"
 */
export function admApplyTextReplacements(htmlString, { actor = null, item = null, caster = null } = {}) {
  let html = String(htmlString ?? "");
  if (!html) return html;

  const hasST   = html.includes("[/st");
  const hasI    = html.includes("[/i");
  const hasDmgFormula = /\[\/r[pmd]\s/i.test(html);

  const hasFear   = /\[\s*(?:страх|fear)\s*[+\-]\s*\d+\s*\]/i.test(html);
  const hasWounds = /\[\s*(?:рана|раны|ран|wound|wounds)\s*[+\-]\s*\d+\s*\]/i.test(html);
  const hasStress = /\[\s*(?:стресс|stress)\s*[+\-]\s*\d+\s*\]/i.test(html);
  const hasHope   = /\[\s*(?:надежда|hope)\s*[+\-]\s*\d+\s*\]/i.test(html);
  const hasRangeTags = /\[\s*(?:вплотную|близко|средняя|далеко|оч\.?\s*далеко)\s*\]/i.test(html);

  // [Сила] / [Знание] / ... / [Магия]
  const hasTraitTags = /\[\s*(?:магия|magic|сила|проворность|искусность|чутьё|влияние|знание|strength|agility|finesse|instinct|presence|knowledge)\s*\]/i.test(html);

  // ВАЖНО: добавили hasTraitTags и hasDmgFormula в ранний выход
  if (!hasST && !hasI && !hasFear && !hasWounds && !hasStress && !hasHope && !hasRangeTags && !hasTraitTags && !hasDmgFormula) return html;

  // [/st ...] — только если есть item и у него есть статусы "button"
  if (hasST && item) {
    const defs = _readItemStatusDefs(item);
    if (defs.length) {
      html = html.replace(/\[\/st\s+([^\]]+)\]/gi, (m, innerRaw) => {
        const parsed = _admParseStSpec(innerRaw);
        const name = parsed.name;
        const opts = parsed.opts;

        if (!name) return m;

        const def = defs.find((d) => String(d?.name ?? "").trim().toLowerCase() === name.toLowerCase());
        if (!def) return m;

        const when = String(def?.when ?? "equip"); // equip | backpack | button
        if (when !== "button") return m;

        const itemUuid  = item.uuid ?? "";
        const actorUuid = actor?.uuid ?? "";

        const safeName   = foundry.utils.escapeHTML(name);
        const safeItem   = foundry.utils.escapeHTML(itemUuid);
        const safeCaster = foundry.utils.escapeHTML(actorUuid);

        const safeOpts = foundry.utils.escapeHTML(encodeURIComponent(JSON.stringify(opts)));

        return `
<button type="button"
class="admth-st-btn"
        data-action="adm-st-apply"
        data-st-name="${safeName}"
        data-st-item-uuid="${safeItem}"
        data-st-caster-uuid="${safeCaster}"
        data-st-opts="${safeOpts}">
  ${safeName}
</button>`.trim();
      });
    }
  }

  if (hasI) {
    html = _replaceInlineInfo(html, actor, caster);
  }

  if (hasFear) {
    html = html.replace(/\[\s*(страх|fear)\s*([+\-])\s*(\d+)\s*\]/gi, (_m, _label, sign, num) => {
      const n = Number(num || 0) || 0;
      const delta = sign === "-" ? -n : n;

      const safeDelta = foundry.utils.escapeHTML(String(delta));
      const labelText = _admFearText(delta);
      const safeLabel = foundry.utils.escapeHTML(labelText);
      const tip = foundry.utils.escapeHTML(`Страх ${delta > 0 ? "+" : ""}${delta}`);

      return `
<button type="button"
        class="adm-fear-btn adm-has-tooltip"
        data-action="adm-fear-delta"
        data-fear-delta="${safeDelta}"
        data-tooltip="${tip}">
  ${safeLabel}
</button>`.trim();
    });
  }

  if (hasWounds) {
    html = html.replace(/\[\s*(рана|раны|ран|wound|wounds)\s*([+\-])\s*(\d+)\s*\]/gi, (_m, _label, sign, num) => {
      const n = Number(num || 0) || 0;
      const delta = sign === "-" ? -n : n;

      const safeDelta = foundry.utils.escapeHTML(String(delta));
      const safeActor = foundry.utils.escapeHTML(String(actor?.uuid ?? ""));
      const labelText = _admResText("hp", delta);
      const safeLabel = foundry.utils.escapeHTML(labelText);
      const tip = foundry.utils.escapeHTML(`Раны ${delta > 0 ? "+" : ""}${delta}`);

      const bgClass = delta > 0 ? "admth-bg-red" : "admth-bg-green";
      const iconHTML = `<i class="fa-solid fa-droplet" style="color: #9d2b2b; opacity: 0.85;"></i>`;

      return `
<button type="button"
        class="admth-res-btn ${bgClass} adm-has-tooltip"
        data-action="adm-res-delta"
        data-res-key="hp"
        data-res-delta="${safeDelta}"
        data-actor-uuid="${safeActor}"
        data-tooltip="${tip}">
  ${iconHTML}&nbsp;${safeLabel}
</button>`.trim();
    });
  }

  if (hasStress) {
    html = html.replace(/\[\s*(стресс|stress)\s*([+\-])\s*(\d+)\s*\]/gi, (_m, _label, sign, num) => {
      const n = Number(num || 0) || 0;
      const delta = sign === "-" ? -n : n;

      const safeDelta = foundry.utils.escapeHTML(String(delta));
      const safeActor = foundry.utils.escapeHTML(String(actor?.uuid ?? ""));
      const labelText = _admResText("stress", delta);
      const safeLabel = foundry.utils.escapeHTML(labelText);
      const tip = foundry.utils.escapeHTML(`Стресс ${delta > 0 ? "+" : ""}${delta}`);

      const bgClass = delta > 0 ? "admth-bg-red" : "admth-bg-green";
      const iconHTML = `<i class="fa-solid fa-droplet" style=" color: #2b869d; opacity: 0.85;"></i>`;

      return `
<button type="button"
        class="admth-res-btn ${bgClass} adm-has-tooltip"
        data-action="adm-res-delta"
        data-res-key="stress"
        data-res-delta="${safeDelta}"
        data-actor-uuid="${safeActor}"
        data-tooltip="${tip}">
  ${iconHTML}&nbsp;${safeLabel}
</button>`.trim();
    });
  }

  if (hasHope) {
    html = html.replace(/\[\s*(надежда|hope)\s*([+\-])\s*(\d+)\s*\]/gi, (_m, _label, sign, num) => {
      const n = Number(num || 0) || 0;
      const delta = sign === "-" ? -n : n;

      const safeDelta = foundry.utils.escapeHTML(String(delta));
      const safeActor = foundry.utils.escapeHTML(String(actor?.uuid ?? ""));
      const labelText = _admResText("hope", delta);
      const safeLabel = foundry.utils.escapeHTML(labelText);
      const tip = foundry.utils.escapeHTML(`Надежда ${delta > 0 ? "+" : ""}${delta}`);

      const bgClass = delta > 0 ? "admth-bg-green" : "admth-bg-red";
      const iconHTML = `<i class="fa-solid fa-khanda" style="color: #f3c267;"></i>`;

      return `
<button type="button"
        class="admth-res-btn ${bgClass} adm-has-tooltip"
        data-action="adm-res-delta"
        data-res-key="hope"
        data-res-delta="${safeDelta}"
        data-actor-uuid="${safeActor}"
        data-tooltip="${tip}">
  ${iconHTML}&nbsp;${safeLabel}
</button>`.trim();
    });
  }

  if (hasRangeTags) {
    html = html.replace(
      /\[\s*(вплотную|близко|средняя|далеко|оч\.?\s*далеко)\s*\]/gi,
      (match, raw, offset, full) => {
        const key = String(raw ?? "").trim().toLowerCase();

        const mapKey =
          key === "вплотную" ? "melee" :
          key === "близко" ? "veryClose" :
          key === "средняя" ? "close" :
          key === "далеко" ? "far" :
          "veryFar";

        const before = String(full ?? "").slice(Math.max(0, (offset ?? 0) - 120), offset ?? 0);
        const beforeText = before
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;|&#160;/gi, " ")
          .replace(/\u00A0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

        const within = /(?:^|[\s.,;:!?])в\s*пределах\s*$/.test(beforeText);

        const label =
          mapKey === "melee"
            ? "Вплотную"
            : within
            ? (mapKey === "veryClose" ? "Близкой дистанции" :
               mapKey === "close"     ? "Средней дистанции" :
               mapKey === "far"       ? "Дальней дистанции" :
                                       "Оч. дальней дистанции")
            : (mapKey === "veryClose" ? "Близко" :
               mapKey === "close"     ? "Средняя" :
               mapKey === "far"       ? "Далеко" :
                                       "Оч. Далеко");

        const tip = "Показать на сцене";

        const safeKey = foundry.utils.escapeHTML(mapKey);
        const safeLabel = foundry.utils.escapeHTML(label);
        const safeTip = foundry.utils.escapeHTML(tip);

        return `
<button type="button"
        class="admth-range-btn adm-has-tooltip"
        data-action="adm-range-toggle"
        data-range-key="${safeKey}"
        data-adm-tooltip="${safeTip}">
  ${safeLabel}
</button>`.trim();
      }
    );
  }

  // [/rp ...] / [/rm ...] / [/rd ...] -> кнопка урона с формулой
  if (hasDmgFormula) {
    html = _replaceDamageFormulaTags(html, { actor, caster });
  }

  // [Сила] / [Знание] / ... -> кнопка окна броска
  // [Магия] -> кнопка с ЛУЧШИМ атрибутом, помеченным как магический (actor.flags.adm-daggerheart.magicTraits)
  if (hasTraitTags) {
    html = _replaceTraitRollButtons(html, { actor, caster });
  }

  return html;
}

function _admParseStSpec(innerRaw) {
  const raw = String(innerRaw ?? "").trim();
  if (!raw) return { name: "", opts: [] };

  // делим по | с любыми пробелами вокруг
  const parts = raw.split(/\s*\|\s*/g).map(s => String(s ?? "").trim()).filter(Boolean);

  const name = parts[0] ?? "";
  const opts = parts.slice(1);

  return { name, opts };
}

function _admHasStOpt(opts, optName) {
  const needle = String(optName ?? "").trim().toLowerCase();
  if (!needle) return false;

  const list = Array.isArray(opts) ? opts : [];
  return list.some(o => String(o ?? "").trim().toLowerCase() === needle);
}

/* -------------------------------------------- */
/* Click handler                                */
/* -------------------------------------------- */
function _installResButtonStyles() {
  const STYLE_ID = "adm-text-hooks-res-btn-style";
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.admth-res-btn,
.admth-fear-btn,
.admth-st-btn,
.admth-range-btn,
.admth-trait-btn,
.admth-dmgf-btn{
  display:inline-flex;
  align-items:center;
  padding:0 7px;
  line-height:1;
  min-height:18px;
  height:18px;
  font-size:12px;
  outline:none;
  box-shadow:none;
  cursor:pointer;
  background: #242238;
}

#chat-log .admth-res-btn,
#chat-log .admth-fear-btn,
#chat-log .admth-st-btn,
#chat-log .admth-range-btn,
#chat-log .admth-trait-btn,
#chat-log .admth-dmgf-btn{
  display:inline-block;
  vertical-align:baseline;
  height:auto;
  line-height:1.2;
  padding:0 6px;
  border-radius:4px;
}

/* красный горизонтальный градиент */
.admth-res-btn.admth-bg-red{
  border: none; border-radius: 0; color: white;
  background: linear-gradient(
    90deg,
    rgba(255, 0, 0, 0) 0%,
    rgb(114 31 32) 30%,
    rgb(114 31 32) 70%,
    rgba(255, 0, 0, 0) 100%
  );
}

/* зелёный горизонтальный градиент */
.admth-res-btn.admth-bg-green{
  border: none; border-radius: 0; color: white;
  background: linear-gradient(
    90deg,
    rgba(255, 0, 0, 0) 0%,
    rgb(89 127 39) 30%,
    rgb(89 127 39) 70%,
    rgba(255, 0, 0, 0) 100%
  );
}

/* кнопка формулы урона */
.admth-dmgf-btn{
  border: 1px solid #32516e;
  border-radius: 4px;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, rgb(156 2 2 / 92%) 0%, rgb(42 109 120 / 60%) 100%);
}
.admth-dmgf-btn:hover{
  background: linear-gradient(135deg, rgb(180 10 10 / 95%) 0%, rgb(50 130 140 / 70%) 100%);
}
.admth-dmgf-btn.admth-dmgf--mag{
  background: linear-gradient(135deg, rgb(70 20 130 / 90%) 0%, rgb(42 80 140 / 60%) 100%);
}
.admth-dmgf-btn.admth-dmgf--mag:hover{
  background: linear-gradient(135deg, rgb(90 30 160 / 95%) 0%, rgb(50 95 160 / 70%) 100%);
}
.admth-dmgf-btn.admth-dmgf--dir{
  background: linear-gradient(135deg, rgb(120 100 20 / 90%) 0%, rgb(80 70 30 / 60%) 100%);
}
.admth-dmgf-btn.admth-dmgf--dir:hover{
  background: linear-gradient(135deg, rgb(150 125 25 / 95%) 0%, rgb(100 90 40 / 70%) 100%);
}
`.trim();

  document.head.appendChild(style);
}

function _installGlobalClickHandler() {
  if (globalThis.__admTextHooksClickInstalled) return;
  globalThis.__admTextHooksClickInstalled = true;

  document.addEventListener(
    "click",
    async (ev) => {
      const btn = ev.target?.closest?.("[data-action]");
      if (!btn) return;

      const action = btn.dataset.action;

      if (action === "adm-st-apply") {
        ev.preventDefault();
        ev.stopPropagation();
        await _onApplyStatusButton(btn);
        return;
      }

      if (action === "adm-fear-delta") {
        ev.preventDefault();
        ev.stopPropagation();
        await _onFearDeltaButton(btn);
        return;
      }

      if (action === "adm-range-toggle") {
        ev.preventDefault();
        ev.stopPropagation();
        await _onRangeToggleButton(btn);
        return;
      }

      if (action === "adm-roll-open") {
        ev.preventDefault();
        ev.stopPropagation();
        await _onRollOpenButton(btn);
        return;
      }

      if (action === "adm-res-delta") {
        ev.preventDefault();
        ev.stopPropagation();
        await _onResDeltaButton(btn);
        return;
      }

      if (action === "adm-dmg-formula") {
        ev.preventDefault();
        ev.stopPropagation();
        await _onDmgFormulaButton(btn);
        return;
      }

      if (action === "adm-applied-status-del") {
        ev.preventDefault();
        ev.stopPropagation();
        await _onRemoveAppliedStatus(btn);
        return;
      }
    },
    true
  );
}

async function _admDeleteSourceItemFromCaster(item, caster) {
  try {
    const parent = item?.parent;

    // Если это owned item (предмет актёра) — удаляем напрямую
    if (parent instanceof Actor) {
      await item.delete();
      return;
    }

    // Если это world item, но у кастера есть owned-копия с таким id — удаляем её
    if (caster instanceof Actor) {
      const owned = caster.items?.get?.(item.id) ?? null;
      if (owned) {
        await caster.deleteEmbeddedDocuments("Item", [owned.id]);
        return;
      }
    }

    ui?.notifications?.warn?.("Не удалось удалить предмет: источник не является предметом актёра.");
  } catch (e) {
    console.error(e);
    ui?.notifications?.error?.("Ошибка при удалении предмета.");
  }
}

async function _onApplyStatusButton(btn) {
  const statusName = String(btn.dataset.stName ?? "").trim();
  const itemUuid   = String(btn.dataset.stItemUuid ?? "").trim();
  const casterUuid = String(btn.dataset.stCasterUuid ?? "").trim();

  // опции
  let opts = [];
  try {
    const raw = String(btn.dataset.stOpts ?? "").trim();
    if (raw) opts = JSON.parse(decodeURIComponent(raw));
  } catch (_e) {
    opts = [];
  }

  if (!statusName || !itemUuid) return;

  const item = await fromUuid(itemUuid).catch(() => null);
  if (!item) {
    ui?.notifications?.warn?.("Источник статуса не найден (item).");
    return;
  }

  const caster = casterUuid ? await fromUuid(casterUuid).catch(() => null) : null;

  const defs = _readItemStatusDefs(item);
  const def = defs.find((d) => String(d?.name ?? "").trim().toLowerCase() === statusName.toLowerCase());

  if (!def) {
    ui?.notifications?.warn?.(`Статус «${statusName}» не найден в предмете.`);
    return;
  }

  if (String(def.when ?? "equip") !== "button") {
    ui?.notifications?.warn?.(`Статус «${statusName}» не в режиме «Кнопка».`);
    return;
  }

  // Собираем таргеты именно как токены (нужен tokenId для FX)
  const targetTokens = Array.from(game.user?.targets ?? [])
    .filter(t => t?.id && t?.actor);

  if (!targetTokens.length) {
    ui?.notifications?.warn?.("Нет таргетов. Выделите цели (Target) и нажмите кнопку ещё раз.");
    return;
  }

  // ВАЖНО: payload должен быть ДО цикла (у вас сейчас он отсутствует в месте вставки)
  const payload = {
    statusName: String(def.name ?? statusName),
    img: String(def.img ?? "icons/svg/aura.svg"),
    when: "backpack",
    text: String(def.text ?? ""),
    mods: Array.isArray(def.mods) ? def.mods : [],
    source: {
      type: "item",
      uuid: item.uuid ?? itemUuid,
      name: item.name ?? "Предмет",
      casterUuid: caster?.uuid ?? "",
      casterName: caster?.name ?? (game.user?.name ?? "Игрок"),
      // statusId можно добавить, если у def есть уникальный id; иначе пусто
      statusId: String(def?.id ?? ""),
    },
  };

  // Применяем к каждому таргету и передаём tokenId (для FX)
  for (const tok of targetTokens) {
    await _applyToActor(tok.actor, payload, { tokenId: tok.id });
  }

  // [/st Имя|Удалить] => удалить предмет-источник у того, кто нажал (caster)
  if (_admHasStOpt(opts, "Удалить")) {
    await _admDeleteSourceItemFromCaster(item, caster);
  }
}



async function _applyToActor(targetActor, payload, { tokenId = null } = {}) {
  const actorUuid = targetActor?.uuid;
  if (!actorUuid) return;

  const isGM = !!game.user?.isGM;

  if (isGM) {
    await _gmApplyStatusToActor(actorUuid, payload, { tokenId });
    return;
  }

  if (__socket?.executeAsGM) {
    await __socket.executeAsGM("gmApplyStatusToActor", actorUuid, payload, { tokenId });
    return;
  }

  ui?.notifications?.error?.("SocketLib не готов. Нужен GM для применения статуса.");
}


async function _onRemoveAppliedStatus(btn) {
  const actorUuid = String(btn.dataset.actorUuid ?? "").trim();
  const statusId = String(btn.dataset.statusId ?? "").trim();
  if (!actorUuid || !statusId) return;

  const isGM = !!game.user?.isGM;

  if (isGM) {
    await _gmRemoveAppliedStatus(actorUuid, statusId);
    return;
  }

  if (__socket?.executeAsGM) {
    await __socket.executeAsGM("gmRemoveAppliedStatus", actorUuid, statusId);
    return;
  }

  ui?.notifications?.error?.("SocketLib не готов. Нужен GM для снятия статуса.");
}
async function _onRangeToggleButton(btn) {
  const rangeKey = String(btn.dataset.rangeKey ?? "").trim();
  if (!rangeKey) return;

  // ВАЖНО: подстройте значения под вашу систему.
  // cells = сколько клеток прибавлять к радиусу токена (rings.mjs).
  const RANGE_TO_CELLS = {
      melee: 1,       // Вплотную
      veryClose: 3,   // Близко
      close: 6,       // Средняя
      far: 9,         // Далеко
      veryFar: 12,    // Очень далеко
  };

  const cells = Number(RANGE_TO_CELLS[rangeKey]);
  if (!Number.isFinite(cells) || cells <= 0) return;

  // приоритет: таргеты -> контролируемые токены
  const targetTokens = Array.from(game.user?.targets ?? []).filter(t => t?.id);
  const controlled = canvas?.tokens?.controlled ?? [];
  const tokens = targetTokens.length ? targetTokens : controlled;

  if (!tokens.length) {
    ui?.notifications?.warn?.("Нет таргетов и нет выделенных токенов.");
    return;
  }

  for (const t of tokens) {
    try { admToggleTokenRing(t, cells); } catch (_e) {}
  }
}
async function _onRollOpenButton(btn) {
  const actorUuid = String(btn.dataset.actorUuid ?? "").trim();
  const traitKey = String(btn.dataset.traitKey ?? "").trim().toLowerCase();
  if (!actorUuid || !traitKey) return;

  const a = await fromUuid(actorUuid).catch(() => null);
  if (!a || !(a instanceof Actor)) {
    ui?.notifications?.warn?.("Актёр для броска не найден.");
    return;
  }

  // Если у вас другой критерий PC/NPC — скажете, поправлю.
  if (String(a.type ?? "").toLowerCase() === "npc") {
    admOpenNpcRollDialog(a, { trait: traitKey });
  } else {
    admOpenPcRollDialog(a, { trait: traitKey });
  }
}

async function _onFearDeltaButton(btn) {
  const raw = String(btn.dataset.fearDelta ?? "").trim();
  const delta = Number(raw);

  if (!Number.isFinite(delta) || delta === 0) return;

  const isGM = !!game.user?.isGM;

  if (isGM) {
    await _gmApplyFearDelta(delta);
    return;
  }

  if (__socket?.executeAsGM) {
    await __socket.executeAsGM("gmApplyFearDelta", delta);
    return;
  }

  ui?.notifications?.error?.("SocketLib не готов. Нужен GM для изменения Страха.");
}
async function _onResDeltaButton(btn) {
  const resKey = String(btn.dataset.resKey ?? "").trim();     // hp | stress | hope
  const raw = String(btn.dataset.resDelta ?? "").trim();
  const delta = Number(raw);

  if (!resKey) return;
  if (!Number.isFinite(delta) || delta === 0) return;

  // 1) если есть таргеты — применяем к ним
  const targets = Array.from(game.user?.targets ?? []).map((t) => t?.actor).filter(Boolean);
  if (targets.length) {
    for (const a of targets) await _applyResDeltaToActor(a, resKey, delta);
    return;
  }

  // 2) иначе пробуем actor из контекста (передан в admApplyTextReplacements)
  const actorUuid = String(btn.dataset.actorUuid ?? "").trim();
  if (actorUuid) {
    const a = await fromUuid(actorUuid).catch(() => null);
    if (a) await _applyResDeltaToActor(a, resKey, delta);
    else ui?.notifications?.warn?.("Актёр для изменения ресурса не найден.");
    return;
  }

  ui?.notifications?.warn?.("Нет таргетов и не указан актёр для изменения ресурса.");
}

async function _applyResDeltaToActor(targetActor, resKey, delta) {
  const actorUuid = targetActor?.uuid;
  if (!actorUuid) return;

  const isGM = !!game.user?.isGM;

  if (isGM) {
    await _gmApplyActorResourceDelta(actorUuid, resKey, delta);
    return;
  }

  if (__socket?.executeAsGM) {
    await __socket.executeAsGM("gmApplyActorResourceDelta", actorUuid, resKey, delta);
    return;
  }

  ui?.notifications?.error?.("SocketLib не готов. Нужен GM для изменения ресурса.");
}


function _replaceInlineInfo(html, actor, caster) {
  if (!html || !actor) return html;

  // [/i ...] -> число
  return String(html).replace(/\[\/i\s*([^\]]+)\]/gi, (_m, rawKey) => {
    const key = String(rawKey ?? "").trim();
    if (!key) return "0";
    return String(_inlineInfoValue(actor, key, caster));
  });
}

function _inlineInfoValue(actor, key, caster) {
  const raw = String(key ?? "").trim();
  if (!raw) return 0;

  // 1) Если это выражение (есть операторы/скобки) — вычисляем через общий вычислитель статусов
  // Он уже умеет и "@", и токены без "@", и скобки.
  if (/[+\-*/()]/.test(raw)) {
    // ВАЖНО: выражения считаем от ТЕКУЩЕГО актёра (того, чей лист/статус смотрим)
    return admEvalStatusValue(actor, raw) ?? 0;
  }

  // 2) Магия (один токен) — как раньше: от кастера, если передан
  if (admIsMagicLabel(raw)) return admMagicValue(caster ?? actor);

  // 3) Обычный токен (один параметр)
  const path = admPathForLabel(raw);
  if (path) return Number(foundry.utils.getProperty(actor, path) ?? 0) || 0;

  return 0;
}

// ------------------------------------------------------------
// Damage formula tags: [/rp ...] [/rm ...] [/rd ...]
//   /rp = physical, /rm = magical, /rd = direct
//   Формула: Мастерство_d6+3, (Сила+Уклонение)_d4, ((Сила-3)_d8dl1)/2
//   Имена атрибутов подменяются числами, _ перед d задаёт количество костей.
// ------------------------------------------------------------

function _replaceDamageFormulaTags(html, { actor = null, caster = null } = {}) {
  const a = actor ?? caster;
  if (!a) return html;

  return String(html).replace(/\[\/r([pmd])\s+([^\]]+)\]/gi, (_m, typeChar, rawFormula) => {
    const dmgType = typeChar.toLowerCase() === "p" ? "physical"
                  : typeChar.toLowerCase() === "m" ? "magical"
                  : "direct";

    const resolved = _resolveDamageFormula(rawFormula, a, caster);
    if (!resolved) return _m; // не удалось разобрать — оставляем как есть

    const typeLabel = dmgType === "physical" ? "физ."
                    : dmgType === "magical" ? "маг."
                    : "прям.";

    const btnLabel = `${resolved} ${typeLabel}`;

    const safeFormula = foundry.utils.escapeHTML(resolved);
    const safeType = foundry.utils.escapeHTML(dmgType);
    const safeBtnLabel = foundry.utils.escapeHTML(btnLabel);

    const typeCls = dmgType === "magical" ? " admth-dmgf--mag"
                  : dmgType === "direct" ? " admth-dmgf--dir"
                  : "";

    return `<button type="button"
        class="admth-dmgf-btn${typeCls}"
        data-action="adm-dmg-formula"
        data-dmg-formula="${safeFormula}"
        data-dmg-type="${safeType}">${safeBtnLabel}</button>`;
  });
}

/**
 * Resolve a damage formula with attribute substitution.
 *   Мастерство_d6+3  (mastery=2) → 2d6+3
 *   (Сила+Уклонение)_d4  (4+3=7) → 7d4
 *   ((Сила+Уклонение)_d4)/2  → ceil(7/2)=4 → 4d4
 *   Чутьё_d8dl1  (2) → 2d8dl1
 *
 * Алгоритм:
 *  1) Подменяем имена атрибутов числами (_substituteAttrTokens)
 *  2) Вычисляем чисто-числовые скобки
 *  3) Ищем паттерн:  [outer(] count_dSides[mods][+-flatMod] [)/outerOp]
 *  4) Применяем outerOp к count и flatMod (с округлением вверх)
 */
function _resolveDamageFormula(rawFormula, actor, caster) {
  let s = String(rawFormula ?? "").trim();
  if (!s) return null;

  // Step 1: substitute attribute names → numbers
  s = _substituteAttrTokens(s, actor, caster);

  // Step 2: evaluate innermost pure-math parentheses repeatedly
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/\(([0-9+\-*/.\s]+)\)/g, (_m, expr) => {
      const v = _safeMathEval(expr);
      return v !== null ? String(v) : _m;
    });
  }

  // Step 3: detect outer wrapper (...)/N or (...)*N
  let outerOp = null;
  let outerVal = 1;
  const outerRe = /^\((.+)\)\s*([*/])\s*(\d+)$/;
  const outerMatch = s.match(outerRe);
  if (outerMatch) {
    s = outerMatch[1].trim();
    outerOp = outerMatch[2];
    outerVal = parseInt(outerMatch[3], 10) || 1;
  }

  // Step 4: parse count_dSides[mods][+-flatMod]
  const diceRe = /^(\d+)_d(\d+)((?:[a-z<>=!]+\d*)*)([+-]\d+(?:\.\d+)?)?$/i;
  const dm = s.match(diceRe);
  if (!dm) return null;

  let count = parseInt(dm[1], 10) || 1;
  const sides = parseInt(dm[2], 10) || 6;
  const mods = dm[3] || "";
  let flatMod = dm[4] ? parseFloat(dm[4]) : 0;

  // Step 5: apply outer operation
  if (outerOp === "/") {
    count = Math.ceil(count / outerVal);
    flatMod = flatMod >= 0
      ? Math.ceil(flatMod / outerVal)
      : -Math.ceil(Math.abs(flatMod) / outerVal);
  } else if (outerOp === "*") {
    count = Math.ceil(count * outerVal);
    flatMod = Math.ceil(flatMod * outerVal);
  }

  count = Math.max(1, count);

  // Build final formula string
  let result = `${count}d${sides}${mods}`;
  if (flatMod > 0) result += `+${flatMod}`;
  else if (flatMod < 0) result += `${flatMod}`;

  return result;
}

/**
 * Substitute attribute tokens (Сила, Мастерство, Чутьё, Магия, etc.)
 * with their numeric values. Uses admPathForLabel + admMagicValue.
 */
function _substituteAttrTokens(raw, actor, caster) {
  let expr = String(raw ?? "").trim();
  if (!expr) return "0";

  const base = caster ?? actor;

  // Replace Cyrillic/Latin attribute names that are NOT part of _dX (keep _ boundary)
  expr = expr.replace(
    /([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9]*)/g,
    (m) => {
      // skip the 'd' in _dX notation and roll modifiers like dl, kh
      if (/^d\d+/i.test(m)) return m;
      if (/^(?:dl|dh|kh|kl)\d*$/i.test(m)) return m;

      const t = m.trim();
      if (admIsMagicLabel(t)) return String(admMagicValue(base) || 0);

      const path = admPathForLabel(t);
      if (path) return String(Number(foundry.utils.getProperty(base, path) ?? 0) || 0);

      return m;
    }
  );

  return expr;
}

/**
 * Safe math evaluator: only digits and +-/* with parentheses.
 * Returns integer (ceil for positive fractions) or null on error.
 */
function _safeMathEval(expr) {
  const s = String(expr ?? "").replace(/\s+/g, "").replace(/,/g, ".");
  if (!s) return null;
  if (!/^[0-9+\-*/().]+$/.test(s)) return null;

  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`return (${s});`)();
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.ceil(n);
  } catch (_e) {
    return null;
  }
}

/**
 * Click handler: кнопка [/rp ...] → бросок урона
 */
async function _onDmgFormulaButton(btn) {
  const formula = String(btn.dataset.dmgFormula ?? "").trim();
  const dmgType = String(btn.dataset.dmgType ?? "physical").trim();

  if (!formula) {
    ui?.notifications?.warn?.("Пустая формула урона.");
    return;
  }

  // Собираем таргеты из выделенных токенов
  const targets = [];
  for (const t of game.user?.targets ?? []) {
    const token = t.document ?? t;
    targets.push({
      tokenId: String(token.id ?? ""),
      sceneId: String(canvas?.scene?.id ?? ""),
      name: String(token.name ?? t.name ?? "?"),
      ok: true,
    });
  }

  await admDamageRollToChat(formula, dmgType, targets, false);
}

// ------------------------------------------------------------
// Trait roll buttons: [Сила] / [Магия]
// ------------------------------------------------------------

function _admLocMaybe(keyOrText) {
  if (!keyOrText) return "";
  const s = String(keyOrText);
  try {
    const loc = game?.i18n?.localize?.(s);
    if (loc && loc !== s) return String(loc);
  } catch (_e) {}
  return s;
}

function _admTraitLabel(traitKey) {
  const key = String(traitKey ?? "").trim().toLowerCase();
  if (!key) return "";
  const map = CONFIG.ADM_DAGGERHEART?.traits ?? {};
  const v = map[key];
  return _admLocMaybe(v) || key;
}

function _admBestMagicTraitKey(actor) {
  try {
    const flags = actor?.getFlag?.("adm-daggerheart", "magicTraits") || {};
    const keys = Object.entries(flags)
      .filter(([, on]) => !!on)
      .map(([k]) => String(k).trim().toLowerCase())
      .filter(Boolean);

    if (!keys.length) return "";

    let bestKey = "";
    let bestVal = -999999;

    for (const k of keys) {
      const v = Number(actor?.system?.traits?.[k]?.value ?? 0) || 0;
      if (v > bestVal) {
        bestVal = v;
        bestKey = k;
      }
    }

    return bestKey;
  } catch (_e) {
    return "";
  }
}

function _replaceTraitRollButtons(html, { actor = null, caster = null } = {}) {
  const a = actor ?? caster;
  const actorUuid = String(a?.uuid ?? "").trim();
  if (!actorUuid) return html;

  return String(html).replace(/\[\s*([^\]]+?)\s*\]/g, (m, rawInner) => {
    const inner = String(rawInner ?? "").trim();
    if (!inner) return m;

    // не трогаем уже обработанные теги
    if (/^\/(?:st|i|r[pmd])\b/i.test(inner)) return m;

    // не трогаем ресурсные теги с +/-
    if (/[+\-]\s*\d+/.test(inner)) return m;

    // не трогаем дальности
    if (/^(?:вплотную|близко|средняя|далеко|оч\.?\s*далеко)$/i.test(inner)) return m;

    // [Магия] -> лучший магический атрибут
    if (admIsMagicLabel(inner)) {
      const bestKey = _admBestMagicTraitKey(a);
      if (!bestKey) return m;

      const label = _admTraitLabel(bestKey) || inner;

      const safeLabel = foundry.utils.escapeHTML(String(label));
      const safeActor = foundry.utils.escapeHTML(actorUuid);
      const safeKey = foundry.utils.escapeHTML(bestKey);

      return `
<button type="button"
        class="admth-trait-btn adm-has-tooltip"
        data-action="adm-roll-open"
        data-actor-uuid="${safeActor}"
        data-trait-key="${safeKey}"
        data-tooltip="Бросок">
  ${safeLabel}
</button>`.trim();
    }

    // обычный атрибут: через label->path
    const path = admPathForLabel(inner);
    const mm = String(path ?? "").match(/^system\.traits\.([a-z]+)\.value$/i);
    if (!mm) return m;

    const traitKey = String(mm[1]).toLowerCase();
    const label = _admTraitLabel(traitKey) || inner;

    const safeLabel = foundry.utils.escapeHTML(String(label));
    const safeActor = foundry.utils.escapeHTML(actorUuid);
    const safeKey = foundry.utils.escapeHTML(traitKey);

    return `
<button type="button"
        class="admth-trait-btn adm-has-tooltip"
        data-action="adm-roll-open"
        data-actor-uuid="${safeActor}"
        data-trait-key="${safeKey}"
        data-tooltip="Бросок">
  ${safeLabel}
</button>`.trim();
  });
}



// ------------------------------------------------------------
// FX: вспышка/анимация при наложении статуса (Sequencer/JB2A)
// ------------------------------------------------------------

const __ADM_FX_DEFAULT = {
  file: "modules/JB2A_DnD5e/Library/1st_Level/Cure_Wounds/CureWounds_01_Blue_200x200.webm",
  scale: 2.5,
  below: true,
};

async function _flashTokenOnceLocal({ tokenId, fx = null } = {}) {
  try {
    const t = canvas?.tokens?.get(tokenId);
    if (!t) return;

    // нет Sequencer — тихо выходим
    if (typeof Sequence === "undefined") return;

    const cfg = { ...__ADM_FX_DEFAULT, ...(fx || {}) };
    if (!cfg.file) return;

    const seq = new Sequence()
      .effect()
      .file(cfg.file)
      .atLocation(t)
      .scaleToObject(Number(cfg.scale) || __ADM_FX_DEFAULT.scale);

    if (cfg.below) seq.belowTokens();
    else seq.aboveTokens();

    await seq.play();
  } catch (e) {
    console.warn("[ADM][FX] flashTokenOnceLocal error:", e);
  }
}



/* -------------------------------------------- */
/* SocketLib                                    */
/* -------------------------------------------- */

function _initSockets() {
  const tryInit = () => {
    const sl = globalThis.socketlib ?? game.socketlib;
    if (!sl) return false;

    try {
      __socket = sl.registerSystem
        ? sl.registerSystem("adm-daggerheart")
        : sl.registerModule("adm-daggerheart");
__socket.register("gmTransferItem", _gmTransferItem);

      __socket.register("gmApplyStatusToActor", _gmApplyStatusToActor);
      __socket.register("gmRemoveAppliedStatus", _gmRemoveAppliedStatus);
      __socket.register("gmApplyFearDelta", _gmApplyFearDelta);
	  __socket.register("flashTokenOnce", _flashTokenOnceLocal);

__socket.register("gmApplyActorResourceDelta", _gmApplyActorResourceDelta);
      // удобно для проверки из консоли
      globalThis.__admTextSocket = __socket;


      console.log("[ADM] SocketLib registered:", __socket);
      return true;
    } catch (e) {
      console.error("[ADM] SocketLib register failed:", e);
      return false;
    }
  };

  // 1) если socketlib уже готов — инициализируем сразу (ВАЖНО)
  if (tryInit()) return;

  // 2) иначе ждём событие
  Hooks.once("socketlib.ready", () => {
    tryInit();
  });

  // 3) подстраховка: если событие не пришло, но объект появился позже
  Hooks.once("ready", () => {
    if (!__socket) tryInit();
  });
}


/* -------------------------------------------- */
/* GM handlers                                  */
/* -------------------------------------------- */
async function _gmApplyFearDelta(delta) {
  if (!game.user?.isGM) return;

  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) return;

  // maxFear из daggerheart.homebrew.maxFear
  let maxFear = 12;
  try {
    const hb = game.settings.get("daggerheart", "homebrew");
    maxFear = Number(hb?.maxFear ?? 12) || 12;
  } catch {}

  const clamp = (n, a, b) => Math.min(Math.max(Number(n) || 0, a), b);

  const cur = Number(game.settings.get("daggerheart", "fear") ?? 0) || 0;
  const next = clamp(cur + d, 0, maxFear);

  if (next === cur) return;

  await game.settings.set("daggerheart", "fear", next);


}
async function _gmApplyActorResourceDelta(actorUuid, resKey, delta) {
  if (!game.user?.isGM) return;

  const actor = await fromUuid(actorUuid).catch(() => null);
  if (!actor || !(actor instanceof Actor)) return;

  const key = String(resKey ?? "").trim(); // hp | stress | hope
  if (!["hp", "stress", "hope"].includes(key)) return;

  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) return;

  const cur = Number(actor.system?.resources?.[key]?.value ?? 0) || 0;
  const max = Number(actor.system?.resources?.[key]?.max ?? 0) || 0;

  // если минус и не хватает — ничего не делаем, показываем сообщение
  // Минус:
  // - Раны/Стресс: можно "переснять" больше текущего — просто клипуем до 0
  // - Надежда: если не хватает — не меняем и показываем сообщение
  if (d < 0 && (cur + d) < 0) {
    if (key === "hope") {
      const need = Math.abs(d);
      const resName = _admResName(key);
      ui?.notifications?.warn?.(`${actor.name}: недостаточно ресурса «${resName}» (есть ${cur}, нужно ${need}).`);
      return;
    }
    // hp/stress: ок, дальше сработает clamp до 0
  }

  const clamp = (n, a, b) => Math.min(Math.max(Number(n) || 0, a), b);
  const next = clamp(cur + d, 0, max);

  if (next === cur) return;

  await actor.update({ [`system.resources.${key}.value`]: next });
}

async function _gmApplyStatusToActor(actorUuid, payload, { tokenId = null } = {}) {
  const actor = await fromUuid(actorUuid).catch(() => null);
  if (!actor || !(actor instanceof Actor)) return;
  if (!actor.isOwner && !game.user?.isGM) return;

  const arrRaw = actor.getFlag(SCOPE, FLAG_APPLIED);
  const arr = Array.isArray(arrRaw) ? arrRaw.filter(Boolean) : [];

  const srcUuid = String(payload?.source?.uuid ?? "");
  const casterUuid = String(payload?.source?.casterUuid ?? "");
  const name = String(payload?.statusName ?? "Статус");
  const statusId = String(payload?.source?.statusId ?? payload?.statusId ?? "");

  const idx = arr.findIndex((x) =>
    String(x?.source?.uuid ?? "") === srcUuid &&
    String(x?.source?.statusId ?? "") === statusId &&
    String(x?.source?.casterUuid ?? "") === casterUuid
  );

  const text = String(payload?.text ?? "");
  const mods = Array.isArray(payload?.mods) ? payload.mods : [];

  const instance = {
    id: foundry.utils.randomID(),
    name,
    img: String(payload?.img ?? "icons/svg/aura.svg"),
    when: "backpack",
    text,
    mods,
    source: {
      ...(payload?.source ?? {}),
      statusId,
    },
  };

  if (idx >= 0) arr[idx] = { ...arr[idx], ...instance, id: arr[idx].id };
  else arr.push(instance);

  await actor.setFlag(SCOPE, FLAG_APPLIED, arr);

  // применить модификаторы сразу
  await admSyncActorStatusMods(actor);

  // FX: запустить у ВСЕХ клиентов по tokenId (если есть)
  if (tokenId && __socket?.executeForEveryone) {
    try {
      await __socket.executeForEveryone("flashTokenOnce", { tokenId });
    } catch (e) {
      console.warn("[ADM][FX] executeForEveryone failed:", e);
    }
  }
}


async function _gmRemoveAppliedStatus(actorUuid, statusId) {
  const actor = await fromUuid(actorUuid).catch(() => null);
  if (!actor || !(actor instanceof Actor)) return;
  if (!actor.isOwner && !game.user?.isGM) return;

  const arrRaw = actor.getFlag(SCOPE, FLAG_APPLIED);
  const arr = Array.isArray(arrRaw) ? arrRaw.filter(Boolean) : [];

  const next = arr.filter((x) => String(x?.id ?? "") !== String(statusId));

  await actor.setFlag(SCOPE, FLAG_APPLIED, next);

  // пересчитать модификаторы
  await admSyncActorStatusMods(actor);
}

/* -------------------------------------------- */
/* Helpers                                      */
/* -------------------------------------------- */

function _readItemStatusDefs(item) {
  const raw = item?.getFlag?.(SCOPE, FLAG_ITEM_DEFS);
  const arr = Array.isArray(raw) ? raw.filter(Boolean) : [];

  for (const d of arr) {
    if (!d) continue;
    if (!d.when) d.when = "equip";
    if (!Array.isArray(d.mods)) d.mods = [];
  }

  return arr;
}
function _admRuPlural(n, one, few, many) {
  const x = Math.abs(Number(n) || 0);
  const mod10 = x % 10;
  const mod100 = x % 100;

  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function _admFearText(n) {
  const word = _admRuPlural(n, "Страх", "Страха", "Страхов");
  return `${Math.abs(Number(n) || 0)} ${word}`;
}
function _admResName(key) {
  if (key === "hp") return "Раны";
  if (key === "stress") return "Стресс";
  if (key === "hope") return "Надежда";
  return "Ресурс";
}

function _admResText(key, delta) {
  const n = Math.abs(Number(delta) || 0);

  if (key === "hp") {
    // 1 Рану / 2 Раны / 5 Ран
    const word = _admRuPlural(n, "Рану", "Раны", "Ран");
    return `${n} ${word}`;
  }

  if (key === "stress") {
    // 1 Стресс / 2 Стресса / 5 Стресса
    const word = _admRuPlural(n, "Стресс", "Стресса", "Стресса");
    return `${n} ${word}`;
  }

  if (key === "hope") {
    // 1 Надежду / 2 Надежды / 5 Надежды
    const word = _admRuPlural(n, "Надежду", "Надежды", "Надежды");
    return `${n} ${word}`;
  }

  return `${n}`;
}
function _normName(s) {
  return String(s ?? "").trim().toLowerCase();
}
function _normKind(k) {
  return String(k ?? "item").trim().toLowerCase();
}

async function _gmTransferItem({ fromActorUuid, toActorUuid, itemId } = {}) {
  try {
    // Безопасность: выполняется только на стороне ГМа через executeAsGM
    const fromA = fromActorUuid ? await fromUuid(String(fromActorUuid)).catch(() => null) : null;
    const toA   = toActorUuid ? await fromUuid(String(toActorUuid)).catch(() => null) : null;

    if (!fromA || !toA) return { ok: false, reason: "Актёр не найден." };

    const id = String(itemId || "").trim();
    if (!id) return { ok: false, reason: "Некорректный itemId." };

    const item = fromA.items?.get?.(id);
    if (!item) return { ok: false, reason: "Предмет у отправителя не найден." };

    // ограничение: если расходник — проверить лимит у получателя
    if (item.type === "gear") {
      const kind = _normKind(item.system?.kind ?? "item");
      if (kind === "consumable") {
        const nm = _normName(item.name);
        const count = (toA.items ?? []).filter((i) => {
          if (i.type !== "gear") return false;
          const k = _normKind(i.system?.kind ?? "item");
          if (k !== "consumable") return false;
          return _normName(i.name) === nm;
        }).length;

        if (count >= 5) {
          return { ok: false, reason: `У получателя уже есть 5 расходников «${item.name}».` };
        }
      }
    }

    // создаём копию у получателя
    const obj = item.toObject();
    delete obj._id;

    obj.flags ??= {};
    obj.flags["adm-daggerheart"] ??= {};
    obj.flags["adm-daggerheart"].container = "backpack";

    // дефолт для gear.kind
    if (obj.type === "gear") {
      obj.system ??= {};
      if (!obj.system.kind) obj.system.kind = "item";
    }

    const created = await toA.createEmbeddedDocuments("Item", [obj]);
    const createdItem = created?.[0];
    if (!createdItem) return { ok: false, reason: "Не удалось создать предмет у получателя." };

    // удаляем у отправителя (только после успешного создания)
    try {
      await fromA.deleteEmbeddedDocuments("Item", [id]);
    } catch (delErr) {
      // откат: пытаемся удалить созданный у получателя
      try { await toA.deleteEmbeddedDocuments("Item", [createdItem.id]); } catch (_e) {}
      console.error(delErr);
      return { ok: false, reason: "Не удалось удалить предмет у отправителя (выполнен откат)." };
    }

    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, reason: "Ошибка на стороне ГМа (см. консоль)." };
  }
}
