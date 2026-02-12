// systems/adm-daggerheart/module/sheets/actor-sheets.mjs
import { admSyncItemStatusMods, admEvalStatusValue } from "../status/status-modifiers.mjs";
import { admApplyTextReplacements } from "../text/adm-text-hooks.mjs";
import { admLabelForPath } from "../status/adm-terms.mjs";
import { admBuildEnemyAbilitiesVM, admNpcHandleDrop } from "./npc-sheet.mjs";
import { admOpenDefenseDialog } from "../../scripts/damage-apply.mjs";
import { admPostCurrencyClicksSummary, admPostItemToChat } from "../../scripts/messages.mjs";
import { admToggleTokenRing } from "../../scripts/rings.mjs";
import { admOpenPcRollDialog, admOpenNpcRollDialog } from "../roll/roll.mjs";
import { getModifier } from "../status/modifiers/registry.mjs";

globalThis.admApplyTextReplacements = admApplyTextReplacements;




const { HandlebarsApplicationMixin } = foundry.applications.api;
const __ADM_TAB_STORE_KEY = "__admActorSheetTabStoreV1";
const __admTabStore = (globalThis[__ADM_TAB_STORE_KEY] = globalThis[__ADM_TAB_STORE_KEY] || new Map());

function _admTabStoreKey(actor, groupKey = "main") {
  const a = actor?.uuid;
  const g = String(groupKey || "main").trim() || "main";
  return a ? `${a}::${g}` : null;
}

function _admGetStoredTab(actor, groupKey = "main") {
  const k = _admTabStoreKey(actor, groupKey);
  return k ? (__admTabStore.get(k) || null) : null;
}

function _admSetStoredTab(actor, groupKey = "main", tab) {
  const k = _admTabStoreKey(actor, groupKey);
  if (!k) return;
  __admTabStore.set(k, String(tab || "").trim());
}


function getGlobalTooltip() {
  let tip = document.getElementById("adm-dh-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "adm-dh-tooltip";
    tip.className = "adm-tooltip";
    tip.setAttribute("aria-hidden", "true");
    tip.style.display = "none";
    document.body.appendChild(tip);
  }
  return tip;
}

function admDebounce(fn, ms = 350) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function getPropertyByPath(obj, path) {
  return foundry.utils.getProperty(obj, path);
}

function normalizeExperiences(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    return Object.keys(raw)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => raw[k]);
  }
  return [];
}

function normalizeExperiencesForRoll(raw) {
  // приводит actor.system.experiences к массиву объектов {id,name,value,active,gainText}
  if (!raw) return [];

  let arr = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (raw && typeof raw === "object") {
    arr = Object.keys(raw)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => raw[k]);
  }

  return (arr || [])
    .filter(Boolean)
    .map((e, i) => ({
      id: String(e?.id ?? e?._id ?? i),
      name: String(e?.name ?? "").trim(),
      value: Number(e?.value ?? 0) || 0,
      active: !!e?.active,
      gainText: String(e?.gainText ?? "").trim(),
    }))
    .filter((e) => e.name);
}


function _num(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

// =========================
// Currency helpers (Actor)
// =========================
const ADM_CURRENCY_PATH = "system.currency";

// radix: base-10 для конвертации (10 монет = 1 горсть, 10 горстей = 1 мешок, 10 мешков = 1 сундук)
// при переполнении используем "кап": 10/10/10/1
const ADM_CUR = {
  coin:    { max: 10, weight: 1,    label: "Монеты" },
  handful: { max: 10, weight: 10,   label: "Горсти" },
  bag:     { max: 10, weight: 100,  label: "Мешки" },
  chest:   { max: 1,  weight: 1000, label: "Сундук" },
};



function _admClampInt(n, min, max) {
  const x = Number(n);
  const v = Number.isFinite(x) ? Math.trunc(x) : min;
  return Math.max(min, Math.min(max, v));
}

function _admDefaultCurrency() {
  return {
    coin:    { value: 0, max: 10 },
    handful: { value: 0, max: 10 },
    bag:     { value: 0, max: 10 },
    chest:   { value: 0, max: 1  },
  };
}

function _admReadCurrency(actor) {
  const cur = foundry.utils.getProperty(actor, ADM_CURRENCY_PATH);
  const def = _admDefaultCurrency();

  const out = {
    coin:    { value: 0, max: 10 },
    handful: { value: 0, max: 10 },
    bag:     { value: 0, max: 10 },
    chest:   { value: 0, max: 1  },
  };

  for (const k of ["coin", "handful", "bag", "chest"]) {
    const max = def[k].max;
    const rawVal = cur?.[k]?.value ?? def[k].value;
    out[k].value = _admClampInt(rawVal, 0, max);
    out[k].max = max;
  }

  return out;
}

function _admCurrencyMaxTotal() {
  // cap: 10 + 10*10 + 10*100 + 1*1000 = 2110
  return (ADM_CUR.coin.max * ADM_CUR.coin.weight)
    + (ADM_CUR.handful.max * ADM_CUR.handful.weight)
    + (ADM_CUR.bag.max * ADM_CUR.bag.weight)
    + (ADM_CUR.chest.max * ADM_CUR.chest.weight);
}


function _admCurrencyToTotal(currency) {
  const c = currency ?? _admDefaultCurrency();
  const coin    = _admClampInt(c.coin?.value,    0, 10);
  const handful = _admClampInt(c.handful?.value, 0, 10);
  const bag     = _admClampInt(c.bag?.value,     0, 10);
  const chest   = _admClampInt(c.chest?.value,   0, 1);

  return coin * ADM_CUR.coin.weight
       + handful * ADM_CUR.handful.weight
       + bag * ADM_CUR.bag.weight
       + chest * ADM_CUR.chest.weight;
}

function _admTotalToCurrency(total) {
  let t = _admClampInt(total, 0, _admCurrencyMaxTotal());

  const chest = Math.min(1, Math.floor(t / ADM_CUR.chest.weight));
  t -= chest * ADM_CUR.chest.weight;

  const bag = Math.min(10, Math.floor(t / ADM_CUR.bag.weight));
  t -= bag * ADM_CUR.bag.weight;

  const handful = Math.min(10, Math.floor(t / ADM_CUR.handful.weight));
  t -= handful * ADM_CUR.handful.weight;

  const coin = Math.min(10, t); // остаток 0..10 (в режиме cap возможно 10)

  return {
    coin:    { value: coin,    max: 10 },
    handful: { value: handful, max: 10 },
    bag:     { value: bag,     max: 10 },
    chest:   { value: chest,   max: 1  },
  };
}


function _admApplyCurrencyDelta(currency, key, delta) {
  const k = String(key || "").trim();
  if (!ADM_CUR[k]) return currency;

  const d = Number(delta) || 0;
  if (!d) return currency;

  const w = ADM_CUR[k].weight;
  const curTotal = _admCurrencyToTotal(currency);

  // -------------------------
  // УМНОЕ УМЕНЬШЕНИЕ
  // -------------------------
  if (d < 0) {
    // обычный сундук
    if (k === "chest" && currency.chest.value > 0) {
      return _admTotalToCurrency(curTotal - w);
    }

    // скрытый сундук (10/10/10/0)
    if (
      k === "chest" &&
      currency.chest.value === 0 &&
      currency.coin.value === 10 &&
      currency.handful.value === 10 &&
      currency.bag.value === 10
    ) {
      return {
        coin:    { value: 0, max: 10 },
        handful: { value: 0, max: 10 },
        bag:     { value: 0, max: 10 },
        chest:   { value: 0, max: 1 },
      };
    }

    // денег меньше, чем стоимость операции → ничего не делаем
    if (curTotal < w) return currency;

    return _admTotalToCurrency(curTotal - w);
  }
  // -------------------------
  // Сундук: если уже 1 — второй клик ничего не делает
  // (не трогаем низшие валюты вообще)
  // -------------------------
  if (d > 0 && k === "chest" && currency.chest.value >= 1) {
    return currency;
  }
  // -------------------------
  // УВЕЛИЧЕНИЕ (как было)
  // -------------------------
  const nextTotal = curTotal + w;
  return _admTotalToCurrency(nextTotal);
}



async function _admEnsureCurrencyOnActor(actor) {
  const cur = foundry.utils.getProperty(actor, ADM_CURRENCY_PATH);
  if (cur && typeof cur === "object") return;

  await actor.update({ [ADM_CURRENCY_PATH]: _admDefaultCurrency() }, { render: false });
}


function _signed(n) {
  const x = Number(n) || 0;
  return x >= 0 ? `+${x}` : `${x}`;
}

function _loc(keyOrText) {
  if (!keyOrText) return "";
  const s = String(keyOrText);
  try {
    const loc = game?.i18n?.localize?.(s);
    if (loc && loc !== s) return loc;
  } catch (e) {}
  return s;
}
function _cardDomainLabel(raw) {
  const k = String(raw ?? "").trim();
  if (!k) return "";
  const key = `DAGGERHEART.CARD.DOMAIN.${k.toUpperCase()}`;
  const loc = game.i18n.localize(key);
  return (loc && loc !== key) ? loc : k;
}

function _cardTypeLabel(raw) {
  const k = String(raw ?? "").trim();
  if (!k) return "";
  const key = `DAGGERHEART.CARD.TYPE.${k.toUpperCase()}`;
  const loc = game.i18n.localize(key);
  return (loc && loc !== key) ? loc : k;
}
function _cardTemplateLabel(raw) {
  const k = String(raw ?? "").trim();
  if (!k) return "";
  const key = `DAGGERHEART.CARD.TEMPLATE.${k.toUpperCase()}`;
  const loc = game.i18n.localize(key);
  return (loc && loc !== key) ? loc : k;
}

function _locMap(map) {
  const out = {};
  for (const [k, v] of Object.entries(map ?? {})) out[k] = _loc(v);
  return out;
}


function _damageTypeShort(dmgType) {
  const t = String(dmgType || "").toLowerCase();
  if (t === "physical") return "ФИЗ.";
  if (t === "magical") return "МАГ.";
  if (t === "direct")  return "ПРЯМ.";
  return t ? t.toUpperCase() : "";
}
async function _admRollTraitFromSheet(sheet, traitKey, ev) {
  const key = String(traitKey || "").trim();
  if (!key) return;

  // В режиме редактирования не открываем окно
  if (sheet?._admEditMode) return;

  const actor = sheet?.actor;
  if (!actor) return;

  ev?.preventDefault?.();
  ev?.stopPropagation?.();

  // Только открыть окно и сразу выставить выбранный атрибут
  console.log("ADM roll dialog open", { actor: actor?.name, key });
  admOpenPcRollDialog(actor, { trait: key });

}

function _admOpenWeaponAttackDialog(sheet, itemId, ev) {
  if (!sheet || !itemId) return;

  // В режиме редактирования не открываем окно
  if (sheet?._admEditMode) return;

  const actor = sheet.actor;
  if (!actor) return;

  const item = actor.items?.get?.(itemId);
  if (!item) return;

  const sys = item.system ?? {};

  // атрибут оружия (подстраховка под разные поля)
  const trait =
    String(
      sys.attribute ??
      sys.attr ??
      sys.attackAttribute ??
      sys.attackTrait ??
      sys.trait ??
      sys.rollTrait ??
      ""
    )
      .trim()
      .toLowerCase();

  // мод атаки из оружия
  const mod = Number(sys.attackMod ?? 0) || 0;

  ev?.preventDefault?.();
  ev?.stopPropagation?.();

  const weaponDamageFormula = String(sys.damage ?? sys.damageFormula ?? "").trim();
  const weaponDamageType = String(sys.damageType ?? sys.damageKind ?? "").trim();
  const attackAnimation = String(sys.attackAnimation ?? "").trim();

  admOpenPcRollDialog(actor, {
    trait: trait || "agility",
    mod,

    weaponName: item.name,
    weaponUuid: item.uuid,

    // NEW: имя анимации атаки (для триггера в сообщении)
    attackAnimation,

    // урон/тип — чтобы кнопка появилась даже без fromUuid в helper
    weaponDamageFormula,
    weaponDamageType,
  });
}


// Status helpers (Actor)
// =========================
const ADM_STATUS_FLAG_SCOPE = "adm-daggerheart";

function _normWhen(v, fallback = "equip") {
  let w = String(v ?? "").trim().toLowerCase();

  // русские значения (если где-то остались)
  if (w === "при экипировке") w = "equip";
  if (w === "при получении") w = "backpack";
  if (w === "кнопка") w = "button";

  // whitelist
  if (w !== "equip" && w !== "backpack" && w !== "button") w = fallback;

  return w;
}

const ADM_STATUS_FLAG_KEY = "statusDefs";
const ADM_ACTOR_STATUS_FLAG_KEY = "actorStatusDefs";
// =========================
// Cards helpers (MODULE SCOPE)
// =========================
function _admMainCardSortRank(it) {
  // берём template из VM (вы уже возвращаете templateRaw в buildCardVM)
  const tpl = String(it?.template ?? "").trim().toLowerCase();

  // 0: class, 1: subclass, 2: всё остальное
  if (tpl === "class") return 0;
  if (tpl === "subclass") return 1;
  return 2;
}

function _admSortMainCards(arr) {
  return (arr || [])
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const ra = _admMainCardSortRank(a.it);
      const rb = _admMainCardSortRank(b.it);
      if (ra !== rb) return ra - rb;

      // внутри группы: по имени
      const na = String(a.it?.nameWithTemplate ?? a.it?.name ?? "").toLocaleLowerCase("ru");
      const nb = String(b.it?.nameWithTemplate ?? b.it?.name ?? "").toLocaleLowerCase("ru");
      const cmp = na.localeCompare(nb, "ru", { sensitivity: "base" });
      if (cmp !== 0) return cmp;

      // стабилизация
      return a.i - b.i;
    })
    .map(x => x.it);
}

const DH_SCOPE = "adm-daggerheart";
const CARD_BUCKET_FLAG = "cardBucket"; // "main" | "domains"
// =========================
// Class card -> Actor sync
// =========================
const CLASS_PRIMARY_FLAG = "classPrimaryCardId";
const CLASS_BASELINE_FLAG = "classBaselineStats";

// попытка достать ран/уклонение из карты класса (подстраховка по именам полей)
function _admReadClassStatsFromCard(itemOrObj) {
  const sys = itemOrObj?.system ?? itemOrObj?.data?.system ?? {};

  const hpMax = Number(sys.maxWounds ?? 0) || 0;     // ✅ ран из карты класса
  const dodge = Number(sys.evasion ?? 0) || 0;       // ✅ уклонение из карты класса

  return { hpMax, dodge };
}


function _admIsClassCard(itemOrObj) {
  const t = String(itemOrObj?.type ?? itemOrObj?.data?.type ?? "").toLowerCase();
  if (!t.includes("card")) return false;
  const tpl = String(itemOrObj?.system?.template ?? itemOrObj?.data?.system?.template ?? "")
    .trim()
    .toLowerCase();
  return tpl === "class";
}

async function _admApplyClassToActor(actor, classCardItem) {
  if (!actor?.isOwner) return;
  if (!_admIsClassCard(classCardItem)) return;

  const alreadyPrimary = String(actor.getFlag(DH_SCOPE, CLASS_PRIMARY_FLAG) ?? "").trim();
  if (alreadyPrimary) return; // уже назначено (это не первая карта)

  // сохранить baseline (для отката)
  const baseline = {
    hpMax: Number(foundry.utils.getProperty(actor, "system.resources.hp.max") ?? 0) || 0,
    dodge: Number(foundry.utils.getProperty(actor, "system.resources.dodge.value") ?? 0) || 0,
  };

  await actor.setFlag(DH_SCOPE, CLASS_BASELINE_FLAG, baseline);
  await actor.setFlag(DH_SCOPE, CLASS_PRIMARY_FLAG, String(classCardItem.id));

  const { hpMax, dodge } = _admReadClassStatsFromCard(classCardItem);

  // применить
  const updates = {};
  updates["system.resources.hp.max"] = Math.max(0, Math.trunc(hpMax));
  updates["system.resources.dodge.value"] = Math.max(0, Math.trunc(dodge));

  // clamp текущих ранений под новый max
  const curHp = Number(foundry.utils.getProperty(actor, "system.resources.hp.value") ?? 0) || 0;
  const nextHp = Math.max(0, Math.min(curHp, updates["system.resources.hp.max"]));
  updates["system.resources.hp.value"] = nextHp;

  await actor.update(updates, { render: false });
}

async function _admRollbackClassOnActorIfPrimaryDeleted(actor, deletedItem) {
  if (!actor?.isOwner) return;
  if (!_admIsClassCard(deletedItem)) return;

  const primaryId = String(actor.getFlag(DH_SCOPE, CLASS_PRIMARY_FLAG) ?? "").trim();
  if (!primaryId) return;

  // откатываем только если удалили "первую" (primary)
  if (String(deletedItem.id) !== primaryId) return;

  const baseline = actor.getFlag(DH_SCOPE, CLASS_BASELINE_FLAG);
  const hpMax = Number(baseline?.hpMax ?? 0) || 0;
  const dodge = Number(baseline?.dodge ?? 0) || 0;

  const updates = {};
  updates["system.resources.hp.max"] = Math.max(0, Math.trunc(hpMax));
  updates["system.resources.dodge.value"] = Math.max(0, Math.trunc(dodge));

  const curHp = Number(foundry.utils.getProperty(actor, "system.resources.hp.value") ?? 0) || 0;
  const nextHp = Math.max(0, Math.min(curHp, updates["system.resources.hp.max"]));
  updates["system.resources.hp.value"] = nextHp;

  await actor.update(updates, { render: false });

  await actor.unsetFlag(DH_SCOPE, CLASS_PRIMARY_FLAG);
  await actor.unsetFlag(DH_SCOPE, CLASS_BASELINE_FLAG);
}

// hook на удаление embedded item
Hooks.on("deleteItem", async (item, options, userId) => {
  try {
    const actor = item?.parent;
    if (!actor) return;
    if (actor.documentName !== "Actor") return;
    if (actor.type !== "character") return;

    await _admRollbackClassOnActorIfPrimaryDeleted(actor, item);
  } catch (e) {
    console.error("ADM class rollback hook failed:", e);
  }
});

function _normStr(v) {
  return String(v ?? "").trim().toLowerCase();
}
// =========================
// Subclass -> Magic Attribute checkbox auto-toggle (Actor flag: magicTraits)
// =========================

function _admIsSubclassCard(itemOrObj) {
  const t = String(itemOrObj?.type ?? itemOrObj?.data?.type ?? "").toLowerCase();
  if (!t.includes("card")) return false;
  const tpl = String(itemOrObj?.system?.template ?? itemOrObj?.data?.system?.template ?? "")
    .trim()
    .toLowerCase();
  return tpl === "subclass";
}

function _admReadSubclassMagicAttrKey(itemOrObj) {
  const sys = itemOrObj?.system ?? itemOrObj?.data?.system ?? {};
  const raw =
    sys.magicAttribute ??
    sys.magicAttr ??
    sys.magicTrait ??
    sys.spellTrait ??
    "";
  const key = String(raw ?? "").trim().toLowerCase();
  return key || "";
}

async function _admSetActorMagicTraitFlag(actor, traitKey, enabled) {
  if (!actor?.isOwner) return;
  const k = String(traitKey ?? "").trim().toLowerCase();
  if (!k) return;

  // хранится объектом в флаге magicTraits (см. character.hbs)
  const path = `flags.${DH_SCOPE}.magicTraits.${k}`;
  await actor.update({ [path]: !!enabled }, { render: false });
}

function _admActorHasSubclassWithMagicKey(actor, traitKey, excludeId = "") {
  const k = String(traitKey ?? "").trim().toLowerCase();
  if (!k) return false;

  const ex = String(excludeId ?? "");
  return actor.items.some((it) => {
    if (!it) return false;
    if (ex && String(it.id) === ex) return false;
    if (!_admIsSubclassCard(it)) return false;

    const mk = _admReadSubclassMagicAttrKey(it);
    return mk === k;
  });
}

// Когда добавили подкласс — включаем галочку атрибута
Hooks.on("createItem", async (item, options, userId) => {
  try {
    const actor = item?.parent;
    if (!actor) return;
    if (actor.documentName !== "Actor") return;
    if (actor.type !== "character") return;
    if (!_admIsSubclassCard(item)) return;

    const key = _admReadSubclassMagicAttrKey(item);
    if (!key) return;

    await _admSetActorMagicTraitFlag(actor, key, true);
  } catch (e) {
    console.error("ADM subclass magicTrait create hook failed:", e);
  }
});

// Когда удалили подкласс — выключаем галочку ТОЛЬКО если больше нет подклассов с тем же атрибутом
Hooks.on("deleteItem", async (item, options, userId) => {
  try {
    const actor = item?.parent;
    if (!actor) return;
    if (actor.documentName !== "Actor") return;
    if (actor.type !== "character") return;
    if (!_admIsSubclassCard(item)) return;

    const key = _admReadSubclassMagicAttrKey(item);
    if (!key) return;

    const stillHas = _admActorHasSubclassWithMagicKey(actor, key, item.id);
    if (stillHas) return;

    await _admSetActorMagicTraitFlag(actor, key, false);
  } catch (e) {
    console.error("ADM subclass magicTrait delete hook failed:", e);
  }
});

function _isCardItem(item) {
  const t = String(item?.type ?? "").toLowerCase();
  return t.includes("card"); // card, domainCard, mainCard, etc.
}

// НЕ привязываемся к именам. Пытаемся понять "доменные" по наличию доменных полей в system.
function _isDomainCardItem(itemOrObj) {
  const sys = itemOrObj?.system ?? itemOrObj?.data?.system ?? {};
  const tpl = String(sys?.template ?? "").trim().toLowerCase();
  return tpl === "domain";
}

function _getCardBucket(item) {
  const b = String(item?.getFlag?.(DH_SCOPE, CARD_BUCKET_FLAG) ?? "").trim().toLowerCase();
  return (b === "domains" || b === "main") ? b : "";
}

async function _setCardBucket(item, bucket) {
  const b = String(bucket ?? "").trim().toLowerCase();
  const v = (b === "domains") ? "domains" : "main";
  await item.update({ [`flags.${DH_SCOPE}.${CARD_BUCKET_FLAG}`]: v }, { render: false });
}

function _normalizeStatusMod(m) {
  const mm = m ?? {};
  let type = String(mm.type ?? "attribute").trim() || "attribute";
  if (type === "attr") type = "attribute";
  const path = String(mm.path ?? mm.attrPath ?? "").trim();
  const value = mm.value != null ? String(mm.value).trim() : "0";
  return { type, path, value };
}

function _readStatusDefsFromItem(item) {
  const raw = item?.getFlag?.(ADM_STATUS_FLAG_SCOPE, ADM_STATUS_FLAG_KEY);
  const arr = Array.isArray(raw) ? raw.filter(Boolean) : [];

  for (const d of arr) {
    if (!d) continue;
    d.when = _normWhen(d.when ?? d.activator, "equip");
delete d.activator;

    if (!Array.isArray(d.mods)) d.mods = [];

    // миграция старого формата
    if (d.attrPath && d.attrDelta != null && d.mods.length === 0) {
      d.mods.push({ type: "attribute", path: String(d.attrPath), value: String(d.attrDelta) });
    }

    d.mods = Array.isArray(d.mods) ? d.mods.map(_normalizeStatusMod) : [];
    delete d.attrPath;
    delete d.attrDelta;
  }

  return arr;
}

function _statusLabelFromPath(path) {
  const p = String(path ?? "").trim();
  if (!p) return "";

  // 1) ваш маппер терминов
  try {
    const label = admLabelForPath(p);
    if (label && label !== p) return String(label);
  } catch (_e) {}

  // 2) (опционально) глобальный маппер, если когда-то появится
  const fn = globalThis.__admStatusLabelForPathRU;
  if (typeof fn === "function") {
    try {
      const label = fn(p);
      if (label) return String(label);
    } catch (_e) {}
  }

  // 3) traits fallback
  const m = p.match(/^system\.traits\.([a-z]+)\.value$/i);
  if (m) {
    const traitKey = String(m[1]).toLowerCase();
    const locKey =
      CONFIG.ADM_DAGGERHEART?.traits?.[traitKey] ??
      `DAGGERHEART.TRAITS.${String(traitKey).toUpperCase()}`;
    return _loc(locKey);
  }

  return _loc(p) || p;
}



function admReadFieldValue(el) {
  if (!el) return null;

  if (el.type === "checkbox") return !!el.checked;

  if (el.type === "number") {
    const n = Number(el.value);
    return Number.isFinite(n) ? n : 0;
  }

  return String(el.value ?? "");
}

function _admSelectMapForPath(path) {
  const CFG = CONFIG.ADM_DAGGERHEART ?? {};
  const p = String(path ?? "");

  if (p === "system.npcType") return CFG.npcTypes ?? {};
  if (p === "system.range") return CFG.ranges ?? {};
  if (p === "system.damageType") return (CFG.weapon?.damageTypes ?? CFG.damageTypes ?? {});
  return null;
}

function _admNormalizeSelectKey(path, rawValue) {
  const map = _admSelectMapForPath(path); // ВАЖНО: это "сырой" CFG-словарь (key -> i18nKey/label)
  if (!map) return rawValue;

  const v0 = String(rawValue ?? "").trim();
  if (!v0) return v0;

  const keys = Object.keys(map);

  // 1) кандидаты на совпадение по ключу
  const tail = v0.includes(".") ? (v0.split(".").pop() || "") : "";
  const cands = [
    v0,
    v0.toLowerCase(),
    v0.toUpperCase(),
    tail,
    tail.toLowerCase(),
    tail.toUpperCase(),
  ].filter(Boolean);

  // 1.1) прямое совпадение по ключам конфига
  for (const c of cands) {
    if (Object.prototype.hasOwnProperty.call(map, c)) return c;
  }

  // 1.2) совпадение ключей без учёта регистра (часто ключи нижним регистром)
  const lowerKeys = new Map(keys.map((k) => [String(k).toLowerCase(), k]));
  for (const c of cands) {
    const hit = lowerKeys.get(String(c).toLowerCase());
    if (hit != null) return hit;
  }

  // 2) если в документе лежит ЛЕЙБЛ (локализованный текст) — делаем reverse-lookup:
  //    сравниваем rawValue с локализованным map[key]
  //    (это как раз случай "прокликал — стало норм", потому что до клика лежал label)
  for (const k of keys) {
    const lbl = _loc(map[k]); // локализация i18n ключа или текста
    if (!lbl) continue;
    if (String(lbl).trim() === v0) return k;
  }

  // 3) если пришёл i18n ключ целиком (например DAGGERHEART.RANGE.MELEE)
  //    пробуем хвост сопоставить ещё раз (уже делали выше, но оставим явный фоллбек)
  if (tail) {
    const hit = lowerKeys.get(String(tail).toLowerCase());
    if (hit != null) return hit;
  }

  return v0;
}


async function _admFixSelectDefaults(sheet, html) {
  if (!sheet?.actor?.isOwner) return;
  if (!html) return;

  const SELECT_PATHS = ["system.npcType", "system.range", "system.damageType"];

  const fixes = {};

  for (const path of SELECT_PATHS) {
    const el = html.querySelector(`select[name="${path}"]`);
    if (!el) continue;

    // текущее значение из документа (истина), а не из DOM
    const docValRaw = foundry.utils.getProperty(sheet.actor, path);

    // нормализуем (умеет reverse-lookup по локализованному тексту/ключам)
    let wanted = _admNormalizeSelectKey(path, docValRaw);

    // если в документе пусто/мусор — берём первый option как дефолт
    if (!wanted || !String(wanted).trim()) {
      wanted = el.options?.[0]?.value ?? "";
    }

    // если wanted всё ещё невалиден (нет такой опции) — тоже падаем на первый option
    if (wanted && el.querySelector(`option[value="${CSS.escape(String(wanted))}"]`) == null) {
      wanted = el.options?.[0]?.value ?? "";
    }

    // 1) чинит отображение прямо сейчас
    if (wanted) el.value = String(wanted);

    // 2) чинит данные в актёре, чтобы не требовалось "прокликивать"
    const docValStr = docValRaw == null ? "" : String(docValRaw);
    if (wanted && docValStr !== String(wanted)) {
      fixes[path] = String(wanted);
    }
  }

  if (Object.keys(fixes).length) {
    await sheet.actor.update(fixes, { render: false });
  }
}


async function admEnrichFeatureHTML(text, actor, item = null, caster = null) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";

  const rollData = actor?.getRollData?.() ?? actor?.system ?? {};

  try {
    const enriched = await foundry.applications.ux.TextEditor.enrichHTML(raw, {
      async: true,
      secrets: false,
      documents: true,
      links: true,
      rolls: true,
      rollData,
      relativeTo: actor ?? null,
    });

    // глобальные подмены: [/st ...] и [/i ...]
    return admApplyTextReplacements(enriched, { actor, item, caster });
  } catch (_e) {
    return foundry.utils.escapeHTML(raw);
  }
}





export class ADMBaseActorSheet extends HandlebarsApplicationMixin(
  foundry.applications.sheets.ActorSheetV2
) {
  static DEFAULT_OPTIONS = {
    classes: ["adm-daggerheart", "sheet", "actor"],
    width: 700,
    height: 700,
    minWidth: 700,
    minHeight: 700,
    maxWidth: 700,
    maxHeight: 700,
    resizable: false,
    form: {
      submitOnChange: false,
      closeOnSubmit: false,
    },
  };

  _admEditMode = false;
_admActiveTab = "equip";
  _toggleEditMode() {
    this._admEditMode = !this._admEditMode;
    this.render({ force: true });
  }

  /** @override */
async _prepareContext(options) {
  const context = await super._prepareContext(options);

  context.system = this.document.system;
  context.actor = this.actor;

  const CFG = CONFIG.ADM_DAGGERHEART ?? {};

  // 1) НЕ локализованный конфиг (для value в <option>)
  context.config = {
    ...CFG,
    ranges: CFG.ranges ?? {},
    npcTypes: CFG.npcTypes ?? {},
    damageTypes: (CFG.weapon?.damageTypes ?? CFG.damageTypes ?? {}),
    weapon: CFG.weapon ?? {},
  };

  // 2) Локализованный конфиг (для текста в UI)
  context.configL = {
    ranges: _locMap(context.config.ranges),
    npcTypes: _locMap(context.config.npcTypes),
    damageTypes: _locMap(context.config.damageTypes),
  };

  // --- Labels for render (если в режиме просмотра показываешь текст, а не <select>) ---
  function _normKey(v) {
    return String(v ?? "").trim();
  }

  function _labelFromMap(mapObj, rawKey) {
    const k0 = _normKey(rawKey);
    if (!k0) return "";

    if (mapObj?.[k0] != null) return _loc(mapObj[k0]);
    const kl = k0.toLowerCase();
    if (mapObj?.[kl] != null) return _loc(mapObj[kl]);
    const ku = k0.toUpperCase();
    if (mapObj?.[ku] != null) return _loc(mapObj[ku]);

    if (k0.includes(".")) {
      const tail = k0.split(".").pop() || "";
      if (mapObj?.[tail] != null) return _loc(mapObj[tail]);
      const taill = tail.toLowerCase();
      if (mapObj?.[taill] != null) return _loc(mapObj[taill]);
      const tailu = tail.toUpperCase();
      if (mapObj?.[tailu] != null) return _loc(mapObj[tailu]);
    }

    return _loc(k0);
  }

  context.npcTypeLabel = _labelFromMap(context.config.npcTypes, context.system?.npcType);
  context.rangeLabel = _labelFromMap(context.config.ranges, context.system?.range);
  context.damageTypeLabel = _labelFromMap(context.config.damageTypes, context.system?.damageType);

  // Attack mod text
  {
    const raw = String(context.system?.attackMod ?? "").trim();
    const n = Number(raw);
    if (!raw) context.attackModText = "0";
    else if (Number.isFinite(n)) context.attackModText = n >= 0 ? `+${n}` : `${n}`;
    else context.attackModText = raw;
  }

  context.isEditMode = this._admEditMode;
  context.magicTraits = this.actor.getFlag("adm-daggerheart", "magicTraits") || {};

  const mastery = Number(context.system?.mastery ?? 1);
  context.masteryStars = Array.from({ length: Math.max(0, mastery) }, (_, i) => i);

  // -------------------------
  // Weapons: Equipped / Backpack
  // -------------------------
  const weapons = this.actor.items.filter((i) => i.type === "weapon");

  const equipped = weapons.filter((i) => i.getFlag("adm-daggerheart", "container") === "equipped");
  const backpack = weapons.filter((i) => {
    const c = i.getFlag("adm-daggerheart", "container");
    return !c || c === "backpack";
  });

  const buildWeaponVM = async (it) => {
    const sys = it.system ?? {};

    const weaponTypeKey = sys.weaponType ?? sys.type ?? sys.weaponClass ?? "";
    const gripKey = sys.grip ?? sys.hold ?? "";
    const rangeKey = sys.range ?? sys.distance ?? sys.weaponRange ?? "";

    const attrKey = sys.attribute ?? sys.attr ?? sys.attackAttribute ?? sys.trait ?? "";

    const weaponAtkMod = _num(sys.attackMod ?? sys.attackModifier ?? sys.modAttack ?? sys.toHit ?? 0);
    const actorTraitVal = _num(this.actor.system?.traits?.[attrKey]?.value ?? 0);
    const attackTotal = actorTraitVal + weaponAtkMod;

    const attrShort =
      CONFIG.ADM_DAGGERHEART?.traitShort?.[attrKey] ??
      String(attrKey || "");

    const attrFull =
      _loc(CONFIG.ADM_DAGGERHEART?.traits?.[attrKey]) ??
      String(attrKey || "");

    const attackTextShort = `${String(attrShort).toUpperCase()} ${_signed(attackTotal)}`.trim();
    const attackTextFull  = `${String(attrFull)} ${_signed(attackTotal)}`.trim();

    const dmgFormula = String(sys.damageFormula ?? sys.damage ?? sys.formula ?? "").trim();
    const dmgTypeKey = sys.damageType ?? sys.damageKind ?? sys.dmgType ?? "";

    const damageTypeText =
      _damageTypeShort(dmgTypeKey) ||
      _loc(CONFIG.ADM_DAGGERHEART?.weapon?.damageTypes?.[dmgTypeKey]) ||
      String(dmgTypeKey || "");

    const weaponTypeLabel =
      _loc(CONFIG.ADM_DAGGERHEART?.weapon?.weaponTypes?.[weaponTypeKey]) ||
      _loc(weaponTypeKey);

    const gripLabel = _loc(CONFIG.ADM_DAGGERHEART?.weapon?.grips?.[gripKey]) || _loc(gripKey);
    const rangeLabel = _loc(CONFIG.ADM_DAGGERHEART?.ranges?.[rangeKey]) || _loc(rangeKey);

    const featureText = String(sys.feature ?? sys.properties ?? sys.notes ?? "").trim();
    const featureHTML = await admEnrichFeatureHTML(featureText, this.actor, it);

    const tier = sys.tier ?? sys.level ?? null;

    return {
      id: it.id,
      img: it.img,
      name: it.name,
      tier,
rangeKey, 
      weaponTypeLabel,
      rangeLabel,
      gripLabel,

      attackText: attackTextFull,
      attackTextShort,
      attackTextFull,

      damageText: dmgFormula ? `${dmgFormula}` : "",
      damageTypeText,

      featureText,
      featureHTML,
    };
  };

  context.equippedWeapons = await Promise.all(equipped.map(buildWeaponVM));
  context.backpackWeapons = await Promise.all(backpack.map(buildWeaponVM));
  


  // -------------------------
// Relic: Equipped / Backpack (как броня, только 1)
// -------------------------
const relics = this.actor.items.filter((i) => i.type === "relic");

const equippedRelicItems = relics.filter(
  (i) => i.getFlag("adm-daggerheart", "container") === "equipped"
);

const backpackRelicItems = relics.filter((i) => {
  const c = i.getFlag("adm-daggerheart", "container");
  return !c || c === "backpack";
});

// берём только одну (если вдруг больше — показываем первую)
const equippedRelicItem = equippedRelicItems[0] ?? null;

const buildRelicVM = async (it) => {
  const sys = it.system ?? {};
  const tier = sys.tier ?? sys.level ?? null;

  const descText = String(sys.description ?? sys.notes ?? sys.feature ?? "").trim();
  const descriptionHTML = await admEnrichFeatureHTML(descText, this.actor, it);

  return {
    id: it.id,
    img: it.img,
    name: it.name,
    tier,
    descriptionHTML,
  };
};

context.equippedRelic = equippedRelicItem ? await buildRelicVM(equippedRelicItem) : null;
context.backpackRelics = await Promise.all(backpackRelicItems.map(buildRelicVM));

// -------------------------
// Gear (Items/Consumables) — Backpack only, split by kind
// -------------------------
const gearItems = this.actor.items.filter((i) => i.type === "gear");

const backpackGearItems = gearItems.filter((i) => {
  const c = i.getFlag("adm-daggerheart", "container");
  return !c || c === "backpack";
});

const buildGearVM = async (it) => {
  const sys = it.system ?? {};
  const descText = String(sys.description ?? sys.notes ?? sys.feature ?? "").trim();
  const descriptionHTML = await admEnrichFeatureHTML(descText, this.actor, it);

  const kind = String(sys.kind ?? "item").trim().toLowerCase() || "item"; // "item" | "consumable"

  return {
    id: it.id,
    img: it.img,
    name: it.name,
    kind,
    descriptionHTML,
  };
};

const _byName = (a, b) =>
  String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "ru", { sensitivity: "base" });

const allGear = await Promise.all(backpackGearItems.map(buildGearVM));

context.backpackConsumables = allGear
  .filter((it) => it?.kind === "consumable")
  .sort(_byName); // ✅ одинаковые будут рядом

context.backpackItems = allGear
  .filter((it) => it?.kind !== "consumable")
  .sort(_byName);

// (оставим на всякий случай, если где-то ещё используется)
context.backpackGear = allGear;


// -------------------------
// Armor: Equipped / Backpack
// -------------------------
const armors = this.actor.items.filter((i) => i.type === "armor");

const equippedArmorItems = armors.filter(
  (i) => i.getFlag("adm-daggerheart", "container") === "equipped"
);

const backpackArmorItems = armors.filter((i) => {
  const c = i.getFlag("adm-daggerheart", "container");
  return !c || c === "backpack";
});

// берём только одну (если вдруг больше — показываем первую)
const equippedArmorItem = equippedArmorItems[0] ?? null;

const buildArmorVM = async (it) => {
  const sys = it.system ?? {};

  const tier = sys.tier ?? sys.level ?? null;

  // поля брони (как ты задавал в ТЗ):
  const baseDefense = _num(sys.baseDefense ?? sys.armor ?? sys.defense ?? 0);

  const noticeable = _num(
    sys.damageThresholds?.noticeable ?? sys.noticeableThreshold ?? sys.noticeable ?? 0
  );

  const heavy = _num(
    sys.damageThresholds?.heavy ?? sys.heavyThreshold ?? sys.heavy ?? 0
  );
  


  // описание (TinyMCE/HTML)
  const descText = String(sys.description ?? sys.notes ?? "").trim();
  const descriptionHTML = await admEnrichFeatureHTML(descText, this.actor, it);

  return {
    id: it.id,
    img: it.img,
    name: it.name,
    tier,
    baseDefense,
    noticeable,
    heavy,
    descriptionHTML,
  };
};

context.equippedArmor = equippedArmorItem ? await buildArmorVM(equippedArmorItem) : null;
context.backpackArmor = await Promise.all(backpackArmorItems.map(buildArmorVM));
    // -------------------------
// Backpack tabs flags + default tab (priority rule)
// -------------------------
context.hasBackpackWeapons = (context.backpackWeapons?.length ?? 0) > 0;
context.hasBackpackArmor   = (context.backpackArmor?.length ?? 0) > 0;
context.hasBackpackRelics  = (context.backpackRelics?.length ?? 0) > 0;
context.hasBackpackItems   = (context.backpackItems?.length ?? 0) > 0;
context.hasBackpackConsumables = (context.backpackConsumables?.length ?? 0) > 0;

// ✅ при открытии чарника активная вкладка по приоритету
context.backpackDefaultTab =
  context.hasBackpackConsumables ? "consumables" :
  context.hasBackpackItems       ? "items" :
  context.hasBackpackWeapons     ? "weapons" :
  context.hasBackpackArmor       ? "armor" :
  context.hasBackpackRelics      ? "relics" :
  "items";
  // -------------------------
  // Active statuses (items / actor / applied)
  // -------------------------
  const activeStatuses = [];

  for (const it of this.actor.items) {
    const defs = _readStatusDefsFromItem(it);
    if (!defs.length) continue;

    const container = it.getFlag("adm-daggerheart", "container") || "backpack";
    const isEquipped = container === "equipped";

    for (const def of defs) {
      const when = _normWhen(def.when ?? def.activator, "equip");
      if (when === "button") continue;

      const isActive = when === "backpack" ? true : isEquipped;
      if (!isActive) continue;

      const textHTML = def.text ? await admEnrichFeatureHTML(String(def.text), this.actor, it) : "";

     const modBuckets = {};
      const otherMods = [];
      for (const m of def.mods ?? []) {
        const mType = String(m.type ?? "attribute").trim() || "attribute";

        if (mType === "attribute") {
          const path = String(m.path ?? "").trim();
          if (!path) continue;
          const delta = admEvalStatusValue(this.actor, m.value);
          if (!delta) continue;
          const label = admLabelForPath(path) || path;
          if (!modBuckets[path]) modBuckets[path] = { label, delta: 0 };
          modBuckets[path].delta += delta;
        } else {
          const modDef = getModifier(mType);
          if (!modDef) continue;
          const rawValue = String(m.value ?? "").trim();
const formatted = typeof modDef.formatValue === "function"
  ? String(modDef.formatValue(rawValue))
  : rawValue;
if (formatted) otherMods.push({ label: formatted, value: "" });
        }
      }

      const traitMods = Object.values(modBuckets)
        .filter((x) => x && x.delta)
        .sort((a, b) => String(a.label).localeCompare(String(b.label), "ru"))
        .map((x) => ({ label: String(x.label), value: _signed(x.delta) }))
        .concat(otherMods);


      const statusImg = String(def?.img ?? it?.img ?? "icons/svg/aura.svg");

      const isStatusItem = it.type === "status";
      activeStatuses.push({
        img: statusImg,
        name: String(def.name ?? "Статус"),
        sourceId: it.id,
        sourceName: it.name,
        textHTML,
        traitMods,
        isStatusItem,
        statusItemId: isStatusItem ? it.id : null,
        statusItemActorId: isStatusItem ? this.actor.id : null,
        statusItemActorUuid: isStatusItem ? this.actor.uuid : null,
      });
    }
  }

  try {
    const raw = this.actor.getFlag(ADM_STATUS_FLAG_SCOPE, ADM_ACTOR_STATUS_FLAG_KEY);
    const defs = Array.isArray(raw) ? raw.filter(Boolean) : [];

    for (const def0 of defs) {
      const def = def0 ?? {};
      const id = String(def.id || foundry.utils.randomID());
      const name = String(def.name ?? "Статус");
      const when = String(def.when ?? "backpack");

      if (when !== "backpack") continue;

      const textHTML = def.text ? await admEnrichFeatureHTML(String(def.text), this.actor, null) : "";

     const modBuckets = {};
      const otherMods = [];
      const mods = Array.isArray(def.mods) ? def.mods : [];

      for (const m of mods) {
        const mType = String(m.type ?? "attribute").trim() || "attribute";

        if (mType === "attribute") {
          const path = String(m.path ?? "").trim();
          if (!path) continue;
          const delta = admEvalStatusValue(this.actor, m.value);
          if (!delta) continue;
          const label = _statusLabelFromPath(path) || path;
          if (!modBuckets[path]) modBuckets[path] = { label, delta: 0 };
          modBuckets[path].delta += delta;
        } else {
          const modDef = getModifier(mType);
          if (!modDef) continue;
          const rawValue = String(m.value ?? "").trim();
const formatted = typeof modDef.formatValue === "function"
  ? String(modDef.formatValue(rawValue))
  : rawValue;
if (formatted) otherMods.push({ label: formatted, value: "" });
        }
      }

      const traitMods = Object.values(modBuckets)
        .filter((x) => x && x.delta)
        .sort((a, b) => String(a.label).localeCompare(String(b.label), "ru"))
        .map((x) => ({ label: String(x.label), value: _signed(x.delta) }))
        .concat(otherMods);

      const statusImg = String(def?.img ?? "icons/svg/aura.svg");

      activeStatuses.push({
        img: statusImg,
        id,
        isActorStatus: true,
        name,
        sourceId: null,
        sourceName: "",
        textHTML,
        traitMods,
      });
    }
  } catch (e) {}

  const appliedRaw = this.actor.getFlag("adm-daggerheart", "appliedStatusDefs");
  const appliedDefs = Array.isArray(appliedRaw) ? appliedRaw.filter(Boolean) : [];

  for (const def of appliedDefs) {
    const casterUuid = String(def?.source?.casterUuid ?? "").trim();
    const caster = casterUuid ? await fromUuid(casterUuid).catch(() => null) : null;

    const textHTML = def.text ? await admEnrichFeatureHTML(String(def.text), this.actor, null, caster) : "";

 const modBuckets = {};
    const otherMods = [];
    for (const m of def.mods ?? []) {
      const mType = String(m.type ?? "attribute").trim() || "attribute";

      if (mType === "attribute") {
        const path = String(m.path ?? "").trim();
        if (!path) continue;
        const delta = admEvalStatusValue(this.actor, m.value);
        if (!delta) continue;
        const label = admLabelForPath(path) || path;
        if (!modBuckets[path]) modBuckets[path] = { label, delta: 0 };
        modBuckets[path].delta += delta;
      } else {
        const modDef = getModifier(mType);
        if (!modDef) continue;
        const rawValue = String(m.value ?? "").trim();
const formatted = typeof modDef.formatValue === "function"
  ? String(modDef.formatValue(rawValue))
  : rawValue;
if (formatted) otherMods.push({ label: formatted, value: "" });
      }
    }

    const traitMods = Object.values(modBuckets)
      .filter((x) => x && x.delta)
      .sort((a, b) => String(a.label).localeCompare(String(b.label), "ru"))
      .map((x) => ({ label: String(x.label), value: _signed(x.delta) }))
      .concat(otherMods);

    const srcName = String(def?.source?.name ?? "Предмет");
    const casterName = String(def?.source?.casterName ?? "");

    const statusImg = String(def?.img ?? "icons/svg/aura.svg");

    activeStatuses.push({
      img: statusImg,
      name: String(def.name ?? "Статус"),
      sourceId: null,
      sourceName: casterName ? `${srcName} — ${casterName}` : srcName,
      textHTML,
      traitMods,
      isApplied: true,
      appliedStatusId: String(def.id ?? ""),
      actorUuid: String(this.actor.uuid ?? ""),
    });
  }

  activeStatuses.sort((a, b) => {
    const group = (s) => {
      if (s.isStatusItem) return 0;
      if (s.isActorStatus) return 1;
      if (s.isApplied) return 2;
      return 3;
    };

    const g = group(a) - group(b);
    if (g !== 0) return g;

    const n = String(a.name || "").localeCompare(String(b.name || ""), "ru");
    if (n !== 0) return n;

    return String(a.sourceName || "").localeCompare(String(b.sourceName || ""), "ru");
  });

  context.statusTabCount = activeStatuses.filter((s) => s?.isActorStatus || s?.isApplied).length;
  context.activeStatuses = activeStatuses;
// -------------------------
// NPC: enemy abilities list (для enemy-inventory.hbs)
// -------------------------
// -------------------------
// NPC: enemy abilities list (для enemy-inventory.hbs)
// -------------------------
if (this.actor?.type === "npc") {
  const vm = await admBuildEnemyAbilitiesVM(this.actor);

  context.enemyAbilities = vm.all;
  context.enemyAbilitiesActions = vm.actions;
  context.enemyAbilitiesPassives = vm.passives;
  context.enemyAbilitiesReactions = vm.reactions;

  // ✅ флаги для HBS (скрывать вкладки, если пусто)
  context.hasEnemyActions   = (vm.actions?.length ?? 0) > 0;
  context.hasEnemyPassives  = (vm.passives?.length ?? 0) > 0;
  context.hasEnemyReactions = (vm.reactions?.length ?? 0) > 0;
} else {
  context.enemyAbilities = [];
  context.enemyAbilitiesActions = [];
  context.enemyAbilitiesPassives = [];
  context.enemyAbilitiesReactions = [];

  context.hasEnemyActions = false;
  context.hasEnemyPassives = false;
  context.hasEnemyReactions = false;
}


  // -------------------------
  // Cards: Main / Domain (reserve + equipped)
  // -------------------------
  const allCards = this.actor.items.filter((i) => {
    const t = String(i.type ?? "").toLowerCase();
    return t.includes("card");
  });

const _ruDecl = (n, one, few, many) => {
  const x = Math.abs(Number(n) || 0);
  const m10 = x % 10;
  const m100 = x % 100;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1) return one;
  if (m10 >= 2 && m10 <= 4) return few;
  return many;
};

const _ruStress = (n) => _ruDecl(n, "стресс", "стресса", "стрессов");

// пытаемся привести Призыв к виду: "Призыв 2 стресса"
const _formatRecall = (sys) => {
  const raw =
    sys?.recallText ??
    sys?.recall ??
    sys?.recallCost ??
    sys?.recallValue ??
    "";

  if (raw == null) return "";

  // число уже числом
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = Math.max(0, Math.trunc(raw));
    if (!n) return "";
    return `Призыв ${n} ${_ruStress(n)}`;
  }

  const s = String(raw).trim();
  if (!s) return "";

  // 1) "2", "2 stress", "2 стресса", "stress 2" и т.п.
  // вытаскиваем первое число
  const mNum = s.match(/(\d+)/);
  const n = mNum ? Math.max(0, parseInt(mNum[1], 10) || 0) : 0;

  // определяем, что это именно стресс (если встречается слово)
  const isStress = /(stress|стресс)/i.test(s);

  if (n && isStress) return `Призыв ${n} ${_ruStress(n)}`;

  // 2) если число есть, но слово не распознали — хотя бы "Призыв 2"
  if (n) return `Призыв ${n}`;

  // 3) иначе — как текст
  return `Призыв ${_loc(s)}`;
};

// === ЗАМЕНА: весь блок buildCardVM целиком ===
// Найдите в actor-sheets.mjs текущую функцию `const buildCardVM = async (it) => { ... }`
// и замените ЕЁ ПОЛНОСТЬЮ на этот вариант.

const buildCardVM = async (it) => {
  const sys = it.system ?? {};

  const _normKey = (v) => String(v ?? "").trim();
  const _tail = (s) => (String(s || "").includes(".") ? (String(s).split(".").pop() || "") : String(s || ""));

  const _i18nPick = (baseKey, raw) => {
    const v0 = _normKey(raw);
    if (!v0) return "";

    if (v0.includes(".")) {
      const loc = game.i18n.localize(v0);
      if (loc && loc !== v0) return loc;
    }

    const t0 = _tail(v0);
    const cands = [
      v0, t0,
      v0.toUpperCase(), t0.toUpperCase(),
      v0.toLowerCase(), t0.toLowerCase(),
    ].filter(Boolean);

    for (const c of cands) {
      const key = `${baseKey}.${String(c).toUpperCase()}`;
      const loc = game.i18n.localize(key);
      if (loc && loc !== key) return loc;
    }

    return v0;
  };

  // template (сырой ключ) — нужен для HBS условий
  const templateRaw = String(
    sys.template ?? sys.templateKey ?? sys.templateId ?? sys.templateSlug ?? ""
  ).trim().toLowerCase();

  const domainKeyOrLabel =
    sys.domain ?? sys.domainKey ?? sys.domainId ?? sys.domainName ?? sys.domainLabel ?? "";
  const domainLabel = _i18nPick("DAGGERHEART.CARD.DOMAIN", domainKeyOrLabel);

  const cardTypeKeyOrLabel =
    sys.cardType ?? sys.type ?? sys.typeKey ?? sys.cardTypeLabel ?? sys.typeLabel ?? "";
  const cardTypeLabel = _i18nPick("DAGGERHEART.CARD.TYPE", cardTypeKeyOrLabel);

  const tplKeyOrLabel =
    sys.template ?? sys.templateKey ?? sys.templateId ?? sys.templateLabel ?? "";
  const templateLabel = _i18nPick("DAGGERHEART.CARD.TEMPLATE", tplKeyOrLabel);

  // описание обычных карт: расширяем набор полей
  const descText =
    String(
      sys.description ??
      sys.text ??
      sys.body ??
      sys.content ??
      sys.rules ??
      sys.feature ??
      sys.notes ??
      ""
    ).trim();

  const descriptionHTML = await admEnrichFeatureHTML(descText, this.actor, it);

  // ---------- SUBCLASS extras ----------
  // атрибут магии (ключ traits)
  const magicAttrKey = String(
    sys.magicAttribute ?? sys.magicAttr ?? sys.magicTrait ?? sys.spellTrait ?? ""
  ).trim().toLowerCase();

  const magicAttributeLabel =
    magicAttrKey
      ? (_loc(CONFIG.ADM_DAGGERHEART?.traits?.[magicAttrKey]) || _loc(magicAttrKey))
      : "";

  // три текста подкласса
  const baseText =
    String(
      sys.baseText ?? sys.base ?? sys.baseDescription ?? sys.baseRules ?? ""
    ).trim();

  const specText =
    String(
      sys.specText ?? sys.specializationText ?? sys.specialization ?? sys.spec ?? ""
    ).trim();

  const masteryText =
    String(
      sys.masteryText ?? sys.mastery ?? sys.masteryDescription ?? ""
    ).trim();

  const baseTextHTML = baseText ? await admEnrichFeatureHTML(baseText, this.actor, it) : "";
  const specTextHTML = specText ? await admEnrichFeatureHTML(specText, this.actor, it) : "";
  const masteryTextHTML = masteryText ? await admEnrichFeatureHTML(masteryText, this.actor, it) : "";

  // имя с типом (для обычных основных карт)
  const nameWithTemplate =
    templateLabel ? `${templateLabel} ${String(it.name ?? "")}`.trim() : String(it.name ?? "").trim();

  // recall pretty (как у вас было)
  const _ruDecl = (n, one, few, many) => {
    const x = Math.abs(Number(n) || 0);
    const m10 = x % 10;
    const m100 = x % 100;
    if (m100 >= 11 && m100 <= 14) return many;
    if (m10 === 1) return one;
    if (m10 >= 2 && m10 <= 4) return few;
    return many;
  };
  const _ruStress = (n) => _ruDecl(n, "стресс", "стресса", "стрессов");

  const _formatRecall = (sys0) => {
    const raw =
      sys0?.recallText ??
      sys0?.recall ??
      sys0?.recallCost ??
      sys0?.recallValue ??
      sys0?.recallAmount ??
      sys0?.recallStress ??
      "";

    if (raw == null) return "";
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const n = Math.max(0, Math.trunc(raw));
      return n ? `Призыв ${n} ${_ruStress(n)}` : "";
    }

    const s = String(raw).trim();
    if (!s) return "";

    const mNum = s.match(/(\d+)/);
    const n = mNum ? Math.max(0, parseInt(mNum[1], 10) || 0) : 0;
    const isStress = /(stress|стресс)/i.test(s);

    if (n && isStress) return `Призыв ${n} ${_ruStress(n)}`;
    if (n) return `Призыв ${n}`;
    return `Призыв ${s}`;
  };

  const recallPretty = _formatRecall(sys);

  const domainLineParts = [];
  if (cardTypeLabel && domainLabel) domainLineParts.push(`${cardTypeLabel} домена ${domainLabel}`);
  else if (cardTypeLabel) domainLineParts.push(`${cardTypeLabel}`);
  else if (domainLabel) domainLineParts.push(`Домен ${domainLabel}`);
  if (recallPretty) domainLineParts.push(recallPretty);
  const domainLine = domainLineParts.join(" | ");

  return {
    id: it.id,
    img: it.img,
    name: it.name,

    // ✅ важно для HBS: template ключ
    template: templateRaw,

    templateLabel,
    nameWithTemplate,

    descriptionHTML,

    // доменные (если нужно где-то ещё)
    domainLabel,
    cardTypeLabel,
    recallPretty,
    domainLine,

    level: sys.level ?? sys.tier ?? null,

    // subclass поля (будут пустыми у обычных карт — и это ок)
    magicAttributeLabel,
    baseTextHTML,
    specTextHTML,
    masteryTextHTML,
  };
};







  const mainCardsItems = [];
  const domainEquippedItems = [];
  const domainReserveItems = [];

  for (const it of allCards) {
    const isDomain = _isDomainCardItem(it);

    // bucket: если уже есть — используем, если нет — вычисляем и не ломаем
    const bucket = _getCardBucket(it) || (isDomain ? "domains" : "main");

    // если bucket не проставлен — поставим один раз (чтобы дальше не зависеть от шаблонов)
    if (!_getCardBucket(it)) {
      // без await, чтобы не тормозить рендер, но безопасно: можно и await
      it.setFlag(DH_SCOPE, CARD_BUCKET_FLAG, bucket).catch(() => {});
    }

    if (bucket === "main") {
      mainCardsItems.push(it);
      continue;
    }

    // domains bucket
    const c = it.getFlag(DH_SCOPE, "container") || "backpack";
    if (c === "equipped") domainEquippedItems.push(it);
    else domainReserveItems.push(it);
  }

context.mainCards = await Promise.all(mainCardsItems.map(buildCardVM));

// ✅ сортировка: класс -> подкласс -> остальное
context.mainCards = _admSortMainCards(context.mainCards);

context.equippedDomainCards = await Promise.all(domainEquippedItems.map(buildCardVM));
context.backpackDomainCards = await Promise.all(domainReserveItems.map(buildCardVM));


  return context;
}





  _installTooltip(html) {
    html?.querySelectorAll?.(".adm-tooltip")?.forEach((e) => e.remove());

    const tip = getGlobalTooltip();
    if (!tip) return () => {};

    let current = null;

    const hide = () => {
      current = null;
      tip.setAttribute("aria-hidden", "true");
      tip.textContent = "";
      tip.style.display = "none";
    };

    const position = (x, y) => {
      const pad = 10;
      const rect = tip.getBoundingClientRect();

      let left = x + 12;
      let top = y + 12;

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (left + rect.width + pad > vw) left = Math.max(pad, x - rect.width - 12);
      if (top + rect.height + pad > vh) top = Math.max(pad, y - rect.height - 12);

      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };

    const isTipEl = (t) => t?.closest?.(".adm-has-tooltip[data-adm-tooltip]") || null;

    const show = (el, ev) => {
      const text = String(el?.dataset?.admTooltip || "").trim();
      if (!text) return hide();

      current = el;
      tip.textContent = text;
      tip.setAttribute("aria-hidden", "false");
      tip.style.display = "block";
      position(ev.clientX, ev.clientY);
    };

    const onOver = (ev) => {
      const el = isTipEl(ev.target);
      if (!el) return;
      show(el, ev);
    };

    const onMove = (ev) => {
      if (!current) return;
      const still = isTipEl(ev.target);
      if (still !== current) return hide();
      position(ev.clientX, ev.clientY);
    };

    const onOut = (ev) => {
      if (!current) return;
      const to = ev.relatedTarget;
      if (to && current.contains(to)) return;
      hide();
    };

    const onDown = () => hide();

    html.addEventListener("pointerover", onOver);
    html.addEventListener("pointermove", onMove);
    html.addEventListener("pointerout", onOut);
    html.addEventListener("pointerdown", onDown, true);
    html.addEventListener("contextmenu", onDown, true);

    hide();

    return () => {
      html.removeEventListener("pointerover", onOver);
      html.removeEventListener("pointermove", onMove);
      html.removeEventListener("pointerout", onOut);
      html.removeEventListener("pointerdown", onDown, true);
      html.removeEventListener("contextmenu", onDown, true);
      hide();
    };
  }

  _ensureHeaderEditControl() {
    const root = this.element;
    if (!root) return;

    const header = root.querySelector?.(".window-header");
    if (!header) return;

    const controls =
      header.querySelector(".window-controls") ||
      header.querySelector(".header-controls") ||
      header;

    controls.querySelectorAll(".adm-header-edit").forEach((e) => e.remove());

    const btn = document.createElement("a");
    btn.classList.add("header-control", "adm-header-edit");
    btn.setAttribute("role", "button");
    btn.setAttribute("aria-label", game.i18n.localize("DAGGERHEART.UI.EDIT_TOGGLE"));
    btn.dataset.tooltip = game.i18n.localize("DAGGERHEART.UI.EDIT_TOGGLE");
    btn.innerHTML = `<i class="fas fa-cog"></i>`;

    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      this._toggleEditMode();
    });

    const close =
      controls.querySelector(".header-control.close") ||
      controls.querySelector('[data-action="close"]') ||
      null;

    controls.insertBefore(btn, close);
  }

  async _openImagePicker(current) {
    return new Promise((resolve) => {
      const fp = new FilePicker({
        type: "image",
        current: current || "",
        callback: (path) => resolve(path),
      });
      fp.render(true);
    });
  }

  _bindImagePickers(html) {
    html
      ?.querySelectorAll?.("[data-action='pick-img'], [data-action='pick-image']")
      ?.forEach((el) => {
        el.addEventListener("click", (ev) => this._onPickImageClick(ev), { passive: false });
      });
  }

  async _onPickImageClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    if (!this.document?.isOwner) return;

    const current = this.actor?.img || this.document?.img || "";
    const path = await this._openImagePicker(current);
    if (!path) return;

await this.actor.update({ img: path }, { render: true });
ui?.actors?.render?.(true);
this.render({ force: true });

  }

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);

    this._ensureHeaderEditControl();

    requestAnimationFrame(() => {
      if (!this.element) return;
      try {
        this.setPosition({ width: 700, height: 700 });
      } catch (e) {}
    });
  }

async _openInventoryContext(itemId, ev) {
  const item = this.actor.items.get(itemId);
  if (!item) return;
  // Передача разрешена только для: weapon, armor, relic, gear (item/consumable)
  const kind = String(item.system?.kind ?? "item").trim().toLowerCase();

  const isTransferAllowed =
    item.type === "weapon" ||
    item.type === "armor" ||
    item.type === "relic" ||
    (item.type === "gear" && (kind === "item" || kind === "consumable"));

  const MENU_ID = "adm-inv-context-menu";
  let menu = document.getElementById(MENU_ID);

  if (!menu) {
    menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.className = "adm-inv-context-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-hidden", "true");
    menu.style.display = "none";

menu.innerHTML = `
  <button type="button" class="adm-inv-context-item" data-adm-action="toChat" role="menuitem">
    <i class="fas fa-comment"></i><span>Показать в чат</span>
  </button>

  <div class="adm-inv-context-item adm-has-submenu" data-adm-transfer-root role="menuitem" aria-haspopup="true" hidden>
    <i class="fas fa-share-from-square"></i><span>Передать</span>
    <i class="fas fa-chevron-right adm-inv-context-subchev" aria-hidden="true"></i>

    <div class="adm-inv-context-sub" role="menu" aria-label="Передать">
      <div class="adm-inv-context-subtitle">Персонажи</div>
      <div class="adm-inv-context-sublist" data-adm-sublist="transfer"></div>
    </div>
  </div>

  <button type="button" class="adm-inv-context-item" data-adm-action="edit" role="menuitem">
    <i class="fas fa-edit"></i><span>Редактировать</span>
  </button>

  <div class="adm-inv-context-sep" aria-hidden="true"></div>

  <button type="button" class="adm-inv-context-item is-danger" data-adm-action="remove" role="menuitem">
    <i class="fas fa-trash"></i><span>Удалить</span>
  </button>
`;



    document.body.appendChild(menu);
	// стабильное поведение подменю "Передать" (без hover-глюков в браузерах)
try {
  const subRoot = menu.querySelector(".adm-has-submenu");
  const subMenu = menu.querySelector(".adm-inv-context-sub");
  if (subRoot && subMenu) {
    let closeT = null;

    const open = () => {
      if (closeT) { clearTimeout(closeT); closeT = null; }
      subRoot.classList.add("is-open");
    };

    const close = () => {
      if (closeT) clearTimeout(closeT);
      closeT = setTimeout(() => subRoot.classList.remove("is-open"), 180);
    };

    subRoot.addEventListener("mouseenter", open);
    subRoot.addEventListener("mouseleave", close);

    subMenu.addEventListener("mouseenter", open);
    subMenu.addEventListener("mouseleave", close);
  }
} catch (e) {
  console.error(e);
}

  }

  const hide = () => {
    menu.setAttribute("aria-hidden", "true");
    menu.style.display = "none";
    menu.__admCtx = null;
  };

  // разовый биндинг (через флаг на DOM)
  if (!menu.__admBound) {
    menu.__admBound = true;

 menu.addEventListener("click", async (e) => {
const transferBtn = e.target.closest?.("[data-adm-transfer-to]");
if (transferBtn) {


    e.preventDefault();
    e.stopPropagation();

    const ctx = menu.__admCtx;
    const sheet = ctx?.sheet;
    const itemId = String(ctx?.itemId || "");
    const toActorUuid = String(transferBtn.dataset.admTransferTo || "");

    const hide = () => {
      menu.setAttribute("aria-hidden", "true");
      menu.style.display = "none";
      menu.__admCtx = null;
    };

    hide();

    if (!sheet || !itemId || !toActorUuid) return;

    const fromActorUuid = String(sheet.actor?.uuid || "");
    if (!fromActorUuid) return;

    // локально проверим, что предмет живой
    const live = sheet.actor?.items?.get?.(itemId);
    if (!live) return;
const liveKind = String(live.system?.kind ?? "item").trim().toLowerCase();
const isAllowedNow =
  live.type === "weapon" ||
  live.type === "armor" ||
  live.type === "relic" ||
  (live.type === "gear" && (liveKind === "item" || liveKind === "consumable"));

if (!isAllowedNow) return;

    // сокет должен быть доступен глобально (см. правки adm-text-hooks.mjs)
    const sock = globalThis.__admTextSocket;
    if (!sock?.executeAsGM) {
      ui?.notifications?.error?.("SocketLib не инициализирован.");
      return;
    }

    try {
      const res = await sock.executeAsGM("gmTransferItem", {
        fromActorUuid,
        toActorUuid,
        itemId,
      });

      if (res?.ok) {
        ui?.notifications?.info?.(`Передано: ${live.name}`);
        sheet.render({ force: true });
      } else {
        ui?.notifications?.warn?.(res?.reason || "Не удалось передать предмет.");
      }
    } catch (err) {
      console.error(err);
      ui?.notifications?.error?.("Ошибка передачи (см. консоль).");
    }
    return;
  }

  const btn = e.target.closest?.("[data-adm-action]");
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  const act = String(btn.dataset.admAction || "");
  const ctx = menu.__admCtx;

  const hide = () => {
    menu.setAttribute("aria-hidden", "true");
    menu.style.display = "none";
    menu.__admCtx = null;
  };

  hide();

  const sheet = ctx?.sheet;
  const id = String(ctx?.itemId || "");
  if (!sheet || !id) return;

  const live = sheet.actor?.items?.get?.(id);
  if (!live) return;

  if (act === "toChat") {
    try { await admPostItemToChat(sheet.actor, live); } catch (err) { console.error(err); }
    return;
  }

  if (act === "edit") {
    try { live.sheet?.render(true); } catch (err) { console.error(err); }
    return;
  }

  if (act === "remove") {
    const ok = await Dialog.confirm({
      title: "Удалить",
      content: `<p>Удалить «${foundry.utils.escapeHTML(live.name || "Предмет")}»?</p>`,
      defaultYes: false,
    });
    if (!ok) return;

    try {
      await sheet.actor.deleteEmbeddedDocuments("Item", [id]);
    } catch (err) {
      console.error("ADM deleteEmbeddedDocuments failed:", err, { id });
    }

    sheet.render({ force: true });
  }
}, true);


    const onDocDown = (e) => {
      if (menu.style.display === "none") return;
      if (e.target === menu || menu.contains(e.target)) return;
      hide();
    };

    const onKey = (e) => {
      if (menu.style.display === "none") return;
      if (e.key === "Escape") hide();
    };

    window.addEventListener("pointerdown", onDocDown, true);
    window.addEventListener("contextmenu", onDocDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
  }

  // текущий контекст для обработчика кликов
  menu.__admCtx = { sheet: this, itemId };
  const transferRoot = menu.querySelector("[data-adm-transfer-root]");
if (transferRoot) {
  transferRoot.hidden = !isTransferAllowed;
  if (!isTransferAllowed) transferRoot.classList.remove("is-open");
}

// заполнить подменю "Передать" — онлайн пользователи, кроме ГМа
try {
if (isTransferAllowed) {
  const list = menu.querySelector(`[data-adm-sublist="transfer"]`);
  if (list) {
    list.innerHTML = "";

const meUserId = String(game.user?.id || "");
const meActorUuid = String(this.actor?.uuid || "");

const users = (game?.users ?? [])
  .filter((u) => u && !u.isGM)            // ДМ не нужен в списке
  .filter((u) => u.character)             // только те, у кого есть привязанный персонаж
  .filter((u) => String(u.character.uuid) !== meActorUuid) // не передавать самому себе
  .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));

    // показываем только тех, у кого есть привязанный персонаж
    for (const u of users) {
      const a = u.character;
      if (!a) continue;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "adm-inv-context-subitem";
      btn.dataset.admTransferTo = String(a.uuid);
btn.innerHTML = `
  <img class="adm-inv-context-subicon" src="${a.img || "icons/svg/mystery-man.svg"}" alt="" />
  <span class="adm-inv-context-subname">
    ${foundry.utils.escapeHTML(u.name || "Игрок")}${u.active ? "" : " (оффлайн)"}
  </span>
`;
      list.appendChild(btn);
    }

    if (!list.children.length) {
      const empty = document.createElement("div");
      empty.className = "adm-inv-context-subempty";
      empty.textContent = "Нет доступных игроков";
      list.appendChild(empty);
    }
}}
} catch (e) {
  console.error(e);
}

  // позиционирование
  const x = Number(ev?.clientX ?? 0) || 0;
  const y = Number(ev?.clientY ?? 0) || 0;

  menu.setAttribute("aria-hidden", "false");
  menu.style.display = "block";

  const pad = 8;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = x + 8;
  let top = y + 8;

  if (left + rect.width + pad > vw) left = Math.max(pad, vw - rect.width - pad);
  if (top + rect.height + pad > vh) top = Math.max(pad, vh - rect.height - pad);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}




_bindInventoryContextMenu(html) {
  const root = html;
  if (!root) return;

  // один раз на текущий DOM
  if (root.__admInvCtxDelegatedBound) return;
  root.__admInvCtxDelegatedBound = true;

  root.addEventListener(
    "contextmenu",
    (ev) => {
      // 1) Никогда не перехватываем ПКМ в полях ввода/редакторах
      if (ev.target?.closest?.("input,select,textarea,[contenteditable='true']")) return;

      // 2) Ищем itemId на любом предке
      const host =
        ev.target?.closest?.(
          ".adm-inv-icon[data-item-id], .adm-inv-name[data-item-id], .adm-inv-card[data-item-id], [data-item-id]"
        ) || null;

      const itemId = host?.dataset?.itemId;
      if (!itemId) return;

      // 3) Если ПКМ был по ссылке/кнопке ВНЕ карточки — не трогаем
      //    Но если ссылка/кнопка внутри карточки (обычный кейс) — меню должно открываться.
      const interactive = ev.target?.closest?.("button,a,[data-action]") || null;
      if (interactive) {
        const insideCard = !!interactive.closest?.(".adm-inv-card,[data-item-id]");
        if (!insideCard) return;
      }

      ev.preventDefault();
      ev.stopPropagation();

      this._openInventoryContext(itemId, ev);
    },
    true
  );
}



_bindDomainCardSpoilers(html) {
  const root = html;
  if (!root) return;

  // один раз на текущий DOM
  if (root.__admDomainSpoilersBound) return;
  root.__admDomainSpoilersBound = true;

  root.addEventListener(
    "click",
    (ev) => {
      // клик только по "шапке" доменной карты
      const head = ev.target?.closest?.(".adm-domaincard-head");
      if (!head) return;

      // не трогаем клики по интерактивным элементам
      if (ev.target?.closest?.("button,a,input,select,textarea,[data-action]")) return;

      // вся карточка доменной карты
      const card = head.closest?.(".adm-inv-card--domain");
      if (!card) return;

      // спойлер лежит рядом (внутри card), а не внутри head
      const spoiler = card.querySelector?.(".adm-domaincard-spoiler");
      if (!spoiler) return;

      ev.preventDefault();
      ev.stopPropagation();

      spoiler.hidden = !spoiler.hidden;
    },
    true
  );
}

  
_bindRightTabs(html) {
  const root = html;
  if (!root) return;

  const groups = Array.from(root.querySelectorAll("[data-adm-tabs]"));
  if (!groups.length) return;

  for (const tabs of groups) {
    // защита от повторного бинда в рамках одного DOM
    if (tabs.__admTabsBound) continue;
    tabs.__admTabsBound = true;

    const groupKey = String(tabs.getAttribute("data-adm-tabs") || "").trim() || "main";
    const buttons = Array.from(tabs.querySelectorAll("[data-adm-tab]"));
	const storedTab = _admGetStoredTab(this.actor, groupKey);

    if (!buttons.length) continue;

    const valid = new Set(buttons.map((b) => String(b.dataset.admTab || "")).filter(Boolean));

    // ✅ ВАЖНО: панели берём ТОЛЬКО для текущей группы,
    // иначе вкладки рюкзака скрывают панели "экипировка/статусы".
    const panels = (() => {
      const all = Array.from(root.querySelectorAll("[data-adm-panel]"));

      // новые неймспейсные панели: "group:tab"
      const scoped = all.filter((p) => {
        const key = String(p.dataset.admPanel || "");
        return key.startsWith(`${groupKey}:`);
      });

      // старый режим: panel="tab" — разрешаем только для main
      if (groupKey === "main") {
        const old = all.filter((p) => {
          const key = String(p.dataset.admPanel || "");
          return !key.includes(":"); // только не неймспейсные
        });
        return [...new Set([...scoped, ...old])];
      }

      return scoped;
    })();

    const setTab = (key) => {
      const tab = valid.has(key) ? key : (buttons[0]?.dataset?.admTab || "");
      if (!tab) return;
// сохраняем выбор вкладки (переживёт любой render)
_admSetStoredTab(this.actor, groupKey, tab);

      // UI: активная кнопка
      for (const b of buttons) b.classList.toggle("is-active", b.dataset.admTab === tab);

      // UI: панели — ТОЛЬКО этой группы
      const wantKey = `${groupKey}:${tab}`;

      for (const p of panels) {
        const panelKey = String(p.dataset.admPanel || "");

        // новое: "group:tab"
        const isNamespaced = panelKey.includes(":");
        const isOnNamespaced = isNamespaced && panelKey === wantKey;

        // старое: "tab" (только для main)
        const isOnOld = !isNamespaced && groupKey === "main" && panelKey === tab;

        const isOn = isOnNamespaced || isOnOld;

        p.classList.toggle("is-active", isOn);
        if (isOn) p.removeAttribute("hidden");
        else p.setAttribute("hidden", "");
      }
    };

    // дефолт
const defaultFromAttr = String(tabs.getAttribute("data-adm-default") || "").trim();

// приоритет: сохранённое -> data-adm-default -> первая кнопка
const defaultTab =
  (storedTab && valid.has(storedTab)) ? storedTab :
  (defaultFromAttr && valid.has(defaultFromAttr)) ? defaultFromAttr :
  (buttons[0]?.dataset?.admTab || "");

setTab(defaultTab);


    tabs.addEventListener("click", (ev) => {
      const btn = ev.target.closest?.("[data-adm-tab]");
      if (!btn) return;
      ev.preventDefault();
      setTab(String(btn.dataset.admTab || ""));
    });
  }
}





  /** @override */
_attachPartListeners(partId, html) {
  super._attachPartListeners(partId, html);
  if (partId !== "body") return;

  this._ensureHeaderEditControl();

  // Tooltip
  this._installTooltip(html);

  // Инвентарь: ПКМ по картинке
  this._bindInventoryContextMenu(html);
  this._bindDomainCardSpoilers(html);

// Tabs (Equipment / Statuses)
this._bindRightTabs(html);

// =========================
// Trait roll: клик по названию атрибута (Сила/Проворность/и т.д.)
// =========================
if (!html.__admTraitRollBound) {
  html.__admTraitRollBound = true;

  // клик
  html.addEventListener("click", (ev) => {
    const t = ev.target instanceof Element ? ev.target : ev.target?.parentElement;

    // 1) Trait roll
    const el = t?.closest?.('[data-action="adm-roll-trait"][data-trait]');
    if (el) {
      // не мешаем интерактиву внутри, НО разрешаем клик по самому чипу и его детям
      const block = t?.closest?.("button,a,input,select,textarea,[data-action]");
      if (block && block !== el) return;

      ev.preventDefault();
      ev.stopPropagation();

      const traitKey = String(el.dataset.trait || "").trim();
      _admRollTraitFromSheet(this, traitKey, ev);
      return;
    }
// 2) NPC standard attack: клик по названию стандартной атаки
// 2) NPC standard attack: клик по названию стандартной атаки
const npcAtk = t?.closest?.('[data-action="adm-open-npc-attack-roll"], .adm-npc-attack-name');
if (npcAtk) {
  if (this.actor?.type !== "npc") return;
  if (this._admEditMode) return;
  if (t?.closest?.("button,a,input,select,textarea,[data-action]") && !npcAtk.contains(t)) return;

  ev.preventDefault();
  ev.stopPropagation();

  // 1) мод атаки: сначала пытаемся взять с элемента (если вы его туда кладёте),
  // затем — из system.attackMod
  const mod =
    Number(npcAtk?.dataset?.attackMod ?? npcAtk?.dataset?.mod ?? this.actor?.system?.attackMod ?? 0) || 0;

  // 2) опыты: нормализуем в массив и оставляем только то, что нужно окну
const expsRaw = normalizeExperiencesForRoll(this.actor?.system?.experiences);

  const experiences = (expsRaw || [])
    .filter(Boolean)
    .map((e) => ({
      name: String(e?.name ?? "").trim(),
      value: Number(e?.value ?? 0) || 0,
      gainText: String(e?.gainText ?? "").trim(),
    }))
    .filter((e) => e.name); // без пустых

  // 3) trait (если вы хотите, чтобы атака сразу ставила атрибут)
  const trait = String(npcAtk?.dataset?.trait ?? "").trim().toLowerCase();

  // ВАЖНО: передаём и mod, и attackMod (на случай, если в roll.mjs ожидается другое имя поля)
  // урон/тип урона берём из data-атрибутов на элементе атаки (npc.hbs),
  // fallback — из actor.system (если атрибутов нет)
  const weaponDamageFormula =
    String(npcAtk?.dataset?.admDamage ?? this.actor?.system?.attackDamage ?? "").trim();

  const dmgTypeKey =
    String(npcAtk?.dataset?.admDamageType ?? this.actor?.system?.damageType ?? "").trim();

  const weaponDamageTypeShort = _damageTypeShort(dmgTypeKey);

admOpenNpcRollDialog(this.actor, {
  trait: trait || undefined,
  mod,
  attackMod: mod,
  experiences,

  attackAnimation: String(this.actor?.system?.attackAnimation ?? "").trim(),
  attackName: String(this.actor?.system?.defaultAttackName ?? "").trim(),

  // ✅ это нужно, чтобы в чате появилась кнопка урона
  weaponDamageFormula: weaponDamageFormula || undefined,

  // ✅ ВАЖНО: roll-helper ждёт СЫРОЙ КЛЮЧ (physical/magical/direct), а не short
  weaponDamageType: dmgTypeKey || "",
});


  return;


  return;
}



    // 2) Weapon attack: клик по строке атаки (оружие)
    const atk = t?.closest?.(".adm-inv-attack");
    if (atk) {
      // не мешаем интерактивным элементам
      if (t?.closest?.("button,a,input,select,textarea,[data-action]")) return;

      const card = atk.closest?.(".adm-inv-card");
      const itemId = card?.dataset?.itemId || "";
      if (itemId) _admOpenWeaponAttackDialog(this, itemId, ev);
      return;
    }
	// 3) Weapon attack: ЛКМ по названию оружия или по картинке (открывает окно броска)
const weaponClick = t?.closest?.(".adm-inv-name, .adm-inv-icon");
if (weaponClick) {
  // не мешаем интерактивным элементам
  if (t?.closest?.("button,a,input,select,textarea,[data-action]")) return;
  if (this._admEditMode) return;

  // itemId берём с самого элемента, а если нет — с карточки
  const card = weaponClick.closest?.(".adm-inv-card");
  const itemId =
    String(weaponClick.dataset?.itemId || card?.dataset?.itemId || "").trim();

  if (!itemId) return;

  const item = this.actor?.items?.get?.(itemId);
  if (!item) return;
  if (String(item.type) !== "weapon") return;

  ev.preventDefault();
  ev.stopPropagation();

  _admOpenWeaponAttackDialog(this, itemId, ev);
  return;
}

  }, true);

  // Enter/Space
  html.addEventListener("keydown", (ev) => {
    const t = ev.target instanceof Element ? ev.target : ev.target?.parentElement;
    const el = t?.closest?.('[data-action="adm-roll-trait"][data-trait]');
    if (!el) return;

    if (ev.key !== "Enter" && ev.key !== " ") return;

    const block = t?.closest?.("button,a,input,select,textarea,[data-action]");
    if (block && block !== el) return;

    ev.preventDefault();
    ev.stopPropagation();

    const traitKey = String(el.dataset.trait || "").trim();
    _admRollTraitFromSheet(this, traitKey, ev);
  }, true);
}


// FIX: чтобы дефолтные значения в <select> реально сохранялись без "прокликивания"
_admFixSelectDefaults(this, html);

// =========================
// Rings: клик по дистанции стандартной атаки (NPC)
// =========================
html.querySelectorAll('[data-action~="adm-toggle-range-ring"]').forEach((el) => {
  el.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const key = String(el.dataset.rangeKey || "").trim();
    if (!key) return;

    try {
      await admToggleTokenRing(this.actor, key);
    } catch (e) {
      console.error(e);
    }
  });
});

html.querySelectorAll('[data-action="adm-toggle-range-ring"]').forEach((el) => {
  if (el.__admRingBound) return;
  el.__admRingBound = true;

  el.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    // редактирование — не трогаем
    if (this._admEditMode) return;

    const key = String(ev.currentTarget?.dataset?.rangeKey || "").trim();

    const RANGE_TO_CELLS = {
      melee: 1,       // Вплотную
      veryClose: 3,   // Близко
      close: 6,       // Средняя
      far: 9,         // Далеко
      veryFar: 12,    // Очень далеко
    };

    const cells = RANGE_TO_CELLS[key];
    if (!cells) return;

    const tokens = this.actor?.getActiveTokens?.(true, true) ?? [];
    if (!tokens.length) {
      ui?.notifications?.warn?.("Токен этого актёра не найден на сцене.");
      return;
    }

    for (const t of tokens) {
      admToggleTokenRing(t, cells);
    }
  });
});

  // =========================
  // Currency UI (click / right click)
  // =========================
  const __curDeltaStore = new Map();     // key -> number
  const __curDeltaTimers = new Map();    // key -> timeoutId
  // накопление “накликанных” изменений (для сообщения в чат)
  const __curClickNet = new Map(); // key -> net delta (может быть >1)
  let __curChatTimer = null;

  const _currencyLabels = {
    coin: ADM_CUR.coin.label,
    handful: ADM_CUR.handful.label,
    bag: ADM_CUR.bag.label,
    chest: ADM_CUR.chest.label,
  };

  const _queueCurrencyChat = () => {
    if (__curChatTimer) clearTimeout(__curChatTimer);

    __curChatTimer = setTimeout(async () => {
      // снимаем слепок и очищаем
      const snap = new Map(__curClickNet);
      __curClickNet.clear();
      __curChatTimer = null;

      // если по факту ничего нет — не пишем
      let hasAny = false;
      for (const v of snap.values()) {
        if (Number(v) !== 0) { hasAny = true; break; }
      }
      if (!hasAny) return;

      await admPostCurrencyClicksSummary(this.actor, snap, _currencyLabels);
    }, 2000);
  };

  const _trackCurrencyClick = (key, delta) => {
    const k = String(key || "").trim();
    const d = Number(delta) || 0;
    if (!k || !d) return;

    // сундук: никогда не накапливаем больше 1 за “пачку кликов”
    if (k === "chest") {
      __curClickNet.set(k, _admClampInt(d, -1, 1));
    } else {
      const prev = __curClickNet.get(k) ?? 0;
      __curClickNet.set(k, prev + d);
    }

    _queueCurrencyChat();
  };

  const _renderCurrencyCell = (key, value) => {
    const numEl = html.querySelector(`[data-currency-num="${CSS.escape(String(key))}"]`);
    if (numEl) numEl.textContent = String(value);

    const deltaEl = html.querySelector(`[data-currency-delta="${CSS.escape(String(key))}"]`);
    const d = __curDeltaStore.get(key) ?? 0;

    if (deltaEl) {
      if (!d) {
        deltaEl.hidden = true;
        deltaEl.textContent = "";
      } else {
        deltaEl.hidden = false;
        deltaEl.textContent = `(${_signed(d)})`;
      }
    }
  };

const _bumpDelta = (key, delta) => {
  const k = String(key);
  const d = Number(delta) || 0;

  // ✅ сундук: не накапливаем (+3). показываем только последний (+1) или (-1)
  const prev = __curDeltaStore.get(k) ?? 0;
  const next = (k === "chest") ? _admClampInt(d, -1, 1) : (prev + d);

  __curDeltaStore.set(k, next);

  const oldT = __curDeltaTimers.get(k);
  if (oldT) clearTimeout(oldT);

  const t = setTimeout(() => {
    __curDeltaStore.set(k, 0);
    const deltaEl = html.querySelector(`[data-currency-delta="${CSS.escape(String(k))}"]`);
    if (deltaEl) {
      deltaEl.hidden = true;
      deltaEl.textContent = "";
    }
  }, 2000);

  __curDeltaTimers.set(k, t);
};


  const _applyCurrencyClick = async (key, delta) => {
    if (this._admEditMode) return;
    if (!this.actor?.isOwner) return;

    await _admEnsureCurrencyOnActor(this.actor);

    const cur = _admReadCurrency(this.actor);
    const next = _admApplyCurrencyDelta(cur, key, delta);
// ✅ если клик ничего не изменил (например chest уже 1 и жмём +1) — ничего не показываем и не пишем
if (
  cur.coin.value === next.coin.value &&
  cur.handful.value === next.handful.value &&
  cur.bag.value === next.bag.value &&
  cur.chest.value === next.chest.value
) {
  return;
}

    // пишем в актёра
    await this.actor.update(
      {
        "system.currency.coin.value": next.coin.value,
        "system.currency.handful.value": next.handful.value,
        "system.currency.bag.value": next.bag.value,
        "system.currency.chest.value": next.chest.value,
      },
      { render: false }
    );
    // учёт “накликанного” (для сообщения через 2 сек тишины)
    _trackCurrencyClick(key, delta);

    // обновляем UI без полного render
    _renderCurrencyCell("coin", next.coin.value);
    _renderCurrencyCell("handful", next.handful.value);
    _renderCurrencyCell("bag", next.bag.value);
    _renderCurrencyCell("chest", next.chest.value);

    _bumpDelta(key, delta);
    _renderCurrencyCell(key, next[key].value);
  };

html.querySelectorAll(".adm-currency-cell[data-currency]").forEach((el) => {
  const key = String(el.dataset.currency || "").trim();
  if (!key) return;

  // ЛКМ
  el.addEventListener("click", (ev) => {
    // если вдруг кликнули по элементу с кнопкой/ссылкой внутри — не мешаем
    if (ev.target?.closest?.("button,a,[data-action]")) return;

    ev.preventDefault();
    ev.stopPropagation();
    _applyCurrencyClick(key, +1);
  });

  // ПКМ
  el.addEventListener("contextmenu", (ev) => {
    if (ev.target?.closest?.("button,a,[data-action]")) return;

    ev.preventDefault();
    ev.stopPropagation();
    _applyCurrencyClick(key, -1);
  });
});


const DH_SCOPE = "adm-daggerheart";

function _normStr(v) {
  return String(v ?? "").trim().toLowerCase();
}





function _weaponMeta(item) {
  const sys = item?.system ?? {};

  // type: primary|secondary (основное|дополнительное)
  const rawType = _normStr(sys.weaponType ?? sys.type ?? sys.weaponClass ?? sys.weapon_slot ?? "");
  let weaponType = "primary";
  if (rawType.includes("secondary") || rawType.includes("off") || rawType.includes("доп")) weaponType = "secondary";
  if (rawType.includes("primary") || rawType.includes("main") || rawType.includes("осн")) weaponType = "primary";

  // grip: one_handed|two_handed
  const rawGrip = _normStr(sys.grip ?? sys.hold ?? sys.weaponGrip ?? "");
  const isTwoHanded =
    rawGrip.includes("two") ||
    rawGrip.includes("2") ||
    rawGrip.includes("дву") ||
    rawGrip.includes("two_handed") ||
    rawGrip.includes("twohand");

  return {
    weaponType,           // "primary" | "secondary"
    isTwoHanded,          // boolean
  };
}

function _isEquipped(item) {
  const c = item?.getFlag?.(DH_SCOPE, "container") || "backpack";
  return c === "equipped";
}

function _equippedWeapons() {
  return this.actor.items.filter((i) => i.type === "weapon" && _isEquipped(i));
}

async function _setItemContainerWithMods(actor, item, container) {
  // 1) применяем/снимаем моды с учётом forcedContainer
  await admSyncItemStatusMods(actor, item, { forcedContainer: container, deleting: false });

  // 2) фиксируем контейнер на предмете
  await item.update({ [`flags.${DH_SCOPE}.container`]: container }, { render: false });

  // 3) FIX: после смены max — текущие значения не должны быть выше max
  //    (кейс: value=4, max стал 0 -> получаем 4/0)
  try {
    const max = Number(foundry.utils.getProperty(actor, "system.resources.armor.max") ?? 0) || 0;
    const cur = Number(foundry.utils.getProperty(actor, "system.resources.armor.value") ?? 0) || 0;

    const clamped = Math.max(0, Math.min(cur, max));
    if (clamped !== cur) {
      await actor.update({ "system.resources.armor.value": clamped }, { render: false });
    }
  } catch (_e) {}
}

async function _equipWeaponWithRules(actor, item) {
  const meta = _weaponMeta(item);
  const equipped = _equippedWeapons.call(this);

  // Собираем кандидатов на снятие экипировки
  const toUnequip = [];

  // Если экипируем двуручное — снимаем ВСЁ остальное оружие
  if (meta.isTwoHanded) {
    for (const w of equipped) {
      if (w.id === item.id) continue;
      toUnequip.push(w);
    }
  } else {
    // Одноручное — двуручное рядом быть не может
    for (const w of equipped) {
      if (w.id === item.id) continue;

      const wm = _weaponMeta(w);
      if (wm.isTwoHanded) toUnequip.push(w);
    }

    // Одноручное: в слоте primary/secondary может быть только 1
    for (const w of equipped) {
      if (w.id === item.id) continue;

      const wm = _weaponMeta(w);
      if (!wm.isTwoHanded && wm.weaponType === meta.weaponType) {
        toUnequip.push(w);
      }
    }
  }

  // Уникализируем
  const uniq = new Map();
  for (const w of toUnequip) uniq.set(w.id, w);

  // Сначала снимаем лишнее
  for (const w of uniq.values()) {
    await _setItemContainerWithMods(actor, w, "backpack");
  }

  // Потом экипируем выбранное
  await _setItemContainerWithMods(actor, item, "equipped");
}

const setContainer = async (itemId, container) => {
  const item = this.actor.items.get(itemId);
  if (!item) return;
  // -------------------------
  // Cards: domain equip limit + buckets
  // -------------------------
  if (_isCardItem(item)) {
    const isDomain = _isDomainCardItem(item);
    const bucket = _getCardBucket(item) || (isDomain ? "domains" : "main");

    // всегда фиксируем bucket, чтобы дальше не зависеть от шаблонов
    if (!_getCardBucket(item)) {
      await _setCardBucket(item, bucket);
    }

    // Доменные карты можно экипировать (container="equipped"), но максимум 5.
    if (container === "equipped") {
      if (!isDomain) {
        ui?.notifications?.warn?.("Экипировать можно только доменные карты.");
        return;
      }

      const equippedCount = this.actor.items.filter((i) => {
        if (!_isCardItem(i)) return false;
        if (!_isDomainCardItem(i)) return false;
        const c = i.getFlag(DH_SCOPE, "container") || "backpack";
        return c === "equipped";
      }).length;

      const alreadyEquipped = (item.getFlag(DH_SCOPE, "container") || "backpack") === "equipped";

      if (!alreadyEquipped && equippedCount >= 5) {
        ui?.notifications?.warn?.("Нельзя экипировать больше 5 доменных карт.");
        return;
      }

      await _setItemContainerWithMods(this.actor, item, "equipped");
      this.render({ force: true });
      return;
    }

    // "unequip-item" у доменных должен отправлять в запас (backpack)
    if (container === "backpack") {
      await _setItemContainerWithMods(this.actor, item, "backpack");
      this.render({ force: true });
      return;
    }

    // любой другой контейнер для карт не используем
    return;
  }

// -------------------------
// Armor — по правилам (одна броня)
// -------------------------
if (item.type === "armor") {
  // снимаем
  if (container === "backpack") {
    await _setItemContainerWithMods(this.actor, item, "backpack");
    this.render({ force: true });
    return;
  }

  // экипируем: разрешаем "переодеть"
  const equippedArmor = this.actor.items.find(
    (i) => i.type === "armor" && _isEquipped(i)
  );

  // если надета другая броня — снимаем её
  if (equippedArmor && equippedArmor.id !== item.id) {
    await _setItemContainerWithMods(this.actor, equippedArmor, "backpack");
  }

  // надеваем выбранную броню
  await _setItemContainerWithMods(this.actor, item, "equipped");

  this.render({ force: true });
  return;
}

    // -------------------------
  // Relic — по правилам (одна реликвия)
  // -------------------------
  if (item.type === "relic") {
    // снять
    if (container === "backpack") {
      await _setItemContainerWithMods(this.actor, item, "backpack");
      this.render({ force: true });
      return;
    }

    // экипируем: разрешаем "переодеть"
    const equippedRelic = this.actor.items.find(
      (i) => i.type === "relic" && _isEquipped(i)
    );

    if (equippedRelic && equippedRelic.id !== item.id) {
      await _setItemContainerWithMods(this.actor, equippedRelic, "backpack");
    }

    await _setItemContainerWithMods(this.actor, item, "equipped");
    this.render({ force: true });
    return;
  }


  // Для НЕ-оружия и НЕ-брони — просто как раньше
  if (item.type !== "weapon") {
    await _setItemContainerWithMods(this.actor, item, container);
    this.render({ force: true });
    return;
  }


  // Оружие — по правилам
  if (container === "backpack") {
    await _setItemContainerWithMods(this.actor, item, "backpack");
    this.render({ force: true });
    return;
  }

  // container === "equipped"
  await _equipWeaponWithRules.call(this, this.actor, item);
  this.render({ force: true });
};









  html.querySelectorAll("[data-action='equip-item']").forEach((el) => {
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget?.dataset?.itemId;
      if (!id) return;
      setContainer(id, "equipped");
    });
  });

  html.querySelectorAll("[data-action='unequip-item']").forEach((el) => {
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget?.dataset?.itemId;
      if (!id) return;
      setContainer(id, "backpack");
    });
  });

  // Portrait picker
  html.querySelector(".adm-portrait")?.addEventListener("click", async (ev) => {
    const img = ev.target.closest(".adm-portrait-img");
    if (!img) return;

    ev.preventDefault();
    ev.stopPropagation();

    const chosen = await this._openImagePicker(this.actor.img);
if (chosen) {
  await this.actor.update({ img: chosen }, { render: true });
  ui?.actors?.render?.(true);
}

  });

  this._bindImagePickers(html);
// =========================
// NPC: создать новое умение прямо в чарнике
// (кнопка из enemy-inventory.hbs: data-action="create-enemy-ability")
// =========================
html.querySelectorAll("[data-action='create-enemy-ability']").forEach((btn) => {
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    // только для NPC и только владельцу
    if (this.actor?.type !== "npc") return;
    if (!this.actor?.isOwner) return;

    const data = {
      name: "Новое умение",
      type: "enemyAbility",
      img: "icons/svg/item-bag.svg",
      system: {
        abilityType: "action",
        range: "none",
        fear: 0,
        stress: 0,
        counter: { value: 0, max: 0 },
        notes: "",
      },
      flags: {},
    };

    try {
      const created = await this.actor.createEmbeddedDocuments("Item", [data]);
      const it = created?.[0];

      // чтобы сразу появился в списке
      this.render({ force: true });

      // открыть лист умения
      if (it) it.sheet?.render(true);
    } catch (e) {
      console.error("ADM: create enemyAbility failed:", e);
    }
  });
});

  // Universal autosave (ALL actor fields) — без рендера
  const perPathDebouncers = new Map();
  const queueSave = (path, value) => {
    let deb = perPathDebouncers.get(path);
    if (!deb) {
deb = admDebounce(async (p, v) => {
  try {
    const isActorIdentity = (p === "name" || p === "img");
    await this.actor.update({ [p]: v }, { render: isActorIdentity });

    // ✅ чтобы список актёров обновлялся сразу
    if (isActorIdentity) ui?.actors?.render?.(true);
  } catch (e) {}
}, 250);

      perPathDebouncers.set(path, deb);
    }
    deb(path, value);
  };

  html
    .querySelectorAll("input[name], select[name], textarea[name]")
    .forEach((field) => {
      const path = field.getAttribute("name");
      if (!path) return;

      if (field.dataset?.expIndex != null) return;
      if (field.disabled || field.readOnly) return;

      const handler = (ev) => {
        const el = ev.currentTarget;
        const p = el?.getAttribute("name");
        if (!p) return;
let v = admReadFieldValue(el);

// нормализация ключей для select-ов (range/npcType/damageType)
if (el.tagName === "SELECT") {
  v = _admNormalizeSelectKey(p, v);
}

queueSave(p, v);

      };

      if (field.type === "checkbox" || field.tagName === "SELECT") {
        field.addEventListener("change", handler);
        return;
      }

      field.addEventListener("input", handler);
      field.addEventListener("blur", handler);
      field.addEventListener("change", handler);
    });

  // Stepper resources
  html.querySelectorAll(".adm-stepper").forEach((el) => {
    const applyDelta = async (delta) => {
      if (this._admEditMode) return;

      const path = el.dataset.path;
      const maxPath = el.dataset.maxPath;

      const current = Number(getPropertyByPath(this.actor, path) ?? 0);
      const max = Number(getPropertyByPath(this.actor, maxPath) ?? 0);

      const next = clamp(current + delta, 0, max);
      if (next === current) return;

      await this.actor.update({ [path]: next }, { render: false });
      el.textContent = maxPath ? `${next}/${max}` : String(next);
    };

    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      applyDelta(+1);
    });

    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      applyDelta(-1);
    });
  });

  // Armor elements → open defense dialog with last damage message data
  html.querySelectorAll("[data-adm-open-defense]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      let dmg = 0, damageType = "physical", stress = 0;
      try {
        const msgId = globalThis.__admLastDmgMsgIdV1;
        if (msgId) {
          const msg = game.messages?.get(msgId);
          const st = msg?.flags?.["adm-daggerheart"]?.state;
          if (st) {
            damageType = st.damageType || "physical";
            // Ищем таргет этого актёра, иначе берём общий урон
            const allT = [...(st.hitTargets ?? []), ...(st.missTargets ?? [])];
            const mine = allT.find(t => {
              const scene = t.sceneId ? game.scenes?.get(t.sceneId) : canvas?.scene;
              const td = scene?.tokens?.get(t.tokenId);
              return td?.actor?.id === this.actor.id;
            });
            dmg = mine ? (mine.dmg ?? 0) : 0;
            stress = mine ? (mine.stress ?? 0) : 0;
          }
        }
      } catch (_e) {}

      admOpenDefenseDialog(this.actor, { dmg, damageType, stress });
    });
  });

  // Add experience
  html.querySelector("[data-action='add-exp']")?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    if (!this._admEditMode) return;

    const experiences = [...normalizeExperiences(this.actor.system.experiences)];
    experiences.push({ name: "Новый опыт", gainText: "", value: 0 });

    await this.actor.update({ "system.experiences": experiences }, { render: false });
    this.render({ force: true });
  });

  // Remove experience
  html.querySelectorAll("[data-action='del-exp']").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (!this._admEditMode) return;

      const idx = Number(ev.currentTarget?.dataset?.index);
      const experiences = [...normalizeExperiences(this.actor.system.experiences)];
      if (!Number.isInteger(idx) || idx < 0 || idx >= experiences.length) return;

      experiences.splice(idx, 1);

      await this.actor.update({ "system.experiences": experiences }, { render: false });
      this.render({ force: true });
    });
  });

  // Exp autosave
  const expSave = admDebounce(async (experiences) => {
    try {
      await this.actor.update({ "system.experiences": experiences }, { render: false });
    } catch (e) {}
  }, 350);

  html.querySelectorAll("[data-exp-index][data-exp-field]").forEach((el) => {
    const onChange = () => {
      if (!this._admEditMode) return;

      const idx = Number(el.dataset.expIndex);
      const field = String(el.dataset.expField || "");
      if (!Number.isInteger(idx) || idx < 0) return;
      if (!field) return;

      const experiences = [...normalizeExperiences(this.actor.system.experiences)];
      while (experiences.length <= idx)
        experiences.push({ name: "", gainText: "", value: 0 });

      if (field === "value") {
        const v = Math.max(0, Number(el.value || 0));
        experiences[idx][field] = v;
      } else {
        experiences[idx][field] = String(el.value ?? "");
      }

      expSave(experiences);
    };

    el.addEventListener("input", onChange);
    el.addEventListener("change", onChange);
    el.addEventListener("blur", onChange);
  });

  // Backpack: open item sheet
  html.querySelectorAll("[data-action='open-item'][data-item-id]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const itemId = ev.currentTarget?.dataset?.itemId;
      const item = this.actor.items.get(itemId);
      item?.sheet?.render(true);
    });
  });
}


}

export class ADMCharacterSheet extends ADMBaseActorSheet {
  static PARTS = {
    body: {
      template: "systems/adm-daggerheart/templates/actor/character.hbs",
      scrollable: [".adm-sheet-right", ".adm-sheet-left"],
    },
  };

  /** @override */
  async _onDrop(event) {
    let data = null;
    try {
      const raw = event.dataTransfer?.getData("text/plain");
      data = raw ? JSON.parse(raw) : null;
    } catch (e) {
      data = null;
    }

    if (!data) return super._onDrop?.(event);
    if (data.type !== "Item") return super._onDrop?.(event);

    event.preventDefault();
// Ограничение: не больше 5 расходников (gear.kind === "consumable") с одним названием (case-insensitive).
// На обычные предметы (kind === "item") лимит не распространяется.
const _normName = (s) => String(s ?? "").trim().toLowerCase();
const _normKind = (k) => String(k ?? "item").trim().toLowerCase();

const _countSameConsumables = (name) => {
  const n = _normName(name);
  if (!n) return 0;

  return this.actor.items.filter((i) => {
    if (i.type !== "gear") return false;
    const sys = i.system ?? {};
    if (_normKind(sys.kind) !== "consumable") return false;
    return _normName(i.name) === n;
  }).length;
};

    let dropped = null;
    try {
      if (data.uuid) dropped = await fromUuid(data.uuid);
      if (!dropped && Item?.implementation?.fromDropData) {
        dropped = await Item.implementation.fromDropData(data);
      }
    } catch (e) {
      dropped = null;
    }

const isCard = _isCardItem(dropped);

if (!dropped || (
  !isCard &&
  dropped.type !== "weapon" &&
  dropped.type !== "armor" &&
  dropped.type !== "gear" &&
  dropped.type !== "relic" &&
  dropped.type !== "status"
)) {
  return super._onDrop?.(event);
}



if (dropped.parent?.id === this.actor.id) {
  // если это карта — перекидываем в нужный bucket и запас
  if (_isCardItem(dropped)) {
    const isDomain = _isDomainCardItem(dropped);
    await dropped.setFlag("adm-daggerheart", CARD_BUCKET_FLAG, isDomain ? "domains" : "main");
    await dropped.setFlag("adm-daggerheart", "container", "backpack");
    return;
  }

  await dropped.setFlag("adm-daggerheart", "container", "backpack");
  return;
}


const obj = dropped.toObject();
delete obj._id;

obj.flags ??= {};
obj.flags["adm-daggerheart"] ??= {};
obj.flags["adm-daggerheart"].container = "backpack";
// cards: domain -> bucket "domains", others -> bucket "main"
if (isCard) {
  const isDomain = _isDomainCardItem(obj);
  obj.flags["adm-daggerheart"][CARD_BUCKET_FLAG] = isDomain ? "domains" : "main";

  // доменные всегда падают в запас, экипировка только кнопкой
  obj.flags["adm-daggerheart"].container = "backpack";
}

// defaults for gear
if (obj.type === "gear") {
  obj.system ??= {};
  if (!obj.system.kind) obj.system.kind = "item";
}


// enforce 5x consumables by name
if (obj.type === "gear") {
  const kind = _normKind(obj?.system?.kind ?? "item");
  if (kind === "consumable") {
    const count = _countSameConsumables(obj?.name);
    if (count >= 5) {
      ui?.notifications?.warn?.(`Нельзя иметь больше 5 расходников «${obj?.name ?? ""}».`);
      return;
    }
  }
}

// --- class card rules ---
const isClassCard = _admIsClassCard(obj);
const primaryClassId = String(this.actor.getFlag(DH_SCOPE, CLASS_PRIMARY_FLAG) ?? "").trim();

// если это НЕ первая карта класса — чистим свойство надежды у добавляемой карты
if (isClassCard && primaryClassId) {
  obj.system ??= {};
  obj.system.hopeProperty = "";
}

const created = await this.actor.createEmbeddedDocuments("Item", [obj]);
const createdItem = created?.[0] ?? null;

// если это ПЕРВАЯ карта класса — применяем ран/уклонение к актёру
if (createdItem && isClassCard && !primaryClassId) {
  await _admApplyClassToActor(this.actor, createdItem);
}


  }
}

export class ADMNpcSheet extends ADMBaseActorSheet {
  static DEFAULT_OPTIONS = {
    ...ADMBaseActorSheet.DEFAULT_OPTIONS,
    classes: ["adm-daggerheart", "sheet", "actor", "npc"],
    width: 700,
    height: 700,
  };

  static PARTS = {
    body: {
      template: "systems/adm-daggerheart/templates/actor/npc.hbs",
      scrollable: [".sheet-body"],
    },
  };

  /** @override */
  async _onDrop(event) {
    const handled = await admNpcHandleDrop(this, event);
    if (handled) return;
    return super._onDrop?.(event);
  }
}

