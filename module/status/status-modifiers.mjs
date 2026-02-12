// systems/adm-daggerheart/module/status/status-modifiers.mjs
// Полная замена файла целиком.

import { admPathForLabel, admIsMagicLabel, admMagicValue } from "./adm-terms.mjs";
import { getModifier } from "./modifiers/registry.mjs";
import { admOpenPcRollDialog, admOpenNpcRollDialog } from "../roll/roll.mjs";

// регистрируем встроенные модификаторы
import "./modifiers/attribute_change.mjs";
import "./modifiers/instant_attribute.mjs";
import "./modifiers/resilience.mjs";
import "./modifiers/advantage.mjs";

const FLAG_SCOPE = "adm-daggerheart";

// защита от двойного запуска sync на одном актёре (updateActor очередь + ручной вызов)
const __ADM_STATUS_SYNC_LOCK_KEY = "__admStatusSyncLockV1";
const __admStatusSyncLock =
  (globalThis[__ADM_STATUS_SYNC_LOCK_KEY] =
    globalThis[__ADM_STATUS_SYNC_LOCK_KEY] || new Set());

// Статусы на предметах
const FLAG_STATUS_DEFS = "statusDefs";

// Статусы на актёре (локальные, вручную)
const FLAG_ACTOR_STATUS_DEFS = "actorStatusDefs";

// Статусы на актёре, наложенные кнопкой из текста (/st)
const FLAG_APPLIED_STATUS_DEFS = "appliedStatusDefs";

// applied-слепок для предметов (чтобы корректно снимать/пересчитывать)
const ITEM_APPLIED_KEY = "__appliedStatusMods";

// applied-слепок для актёра (для actorStatusDefs + appliedStatusDefs)
const ACTOR_APPLIED_KEY = "__appliedActorStatusMods";

// ------------------------------------------------------------
// Public
// ------------------------------------------------------------

/** Для отображения в чарнике (и для отладки) */
export function admEvalStatusValue(actor, raw) {
  return _evalModValue(raw, actor);
}

/**
 * Применить/снять моды статусов от одного предмета.
 * forcedContainer: "equipped" | "backpack" | null
 * deleting: true -> desired = {} (всё снять)
 */
export async function admSyncItemStatusMods(actor, item, { forcedContainer = null, deleting = false } = {}) {
  if (!actor || !(actor instanceof Actor) || !actor.isOwner) return;
  if (!item) return;

  const DBG = !!globalThis.__ADM_STATUS_DEBUG;
  const log = (...a) => DBG && console.log("[ADM:STATUS][ITEM]", ...a);

  const appliedBefore = _readItemApplied(item);
  const desiredNow = deleting ? {} : _computeDesiredFromItem(item, actor, { forcedContainer });
  const delta = _diffMaps(appliedBefore, desiredNow);

  log("SYNC", { actor: actor.name, item: item.name, deleting, forcedContainer, appliedBefore, desiredNow, delta });

  if (Object.keys(delta).length) {
    const actorUpdate = {};
    for (const [path, d] of Object.entries(delta)) {
      const cur = Number(foundry.utils.getProperty(actor, path) ?? 0);
      actorUpdate[path] = cur + (Number(d) || 0);
    }

    log("ACTOR_UPDATE", actorUpdate);

    // важно: не даём updateActor-хуку ставить очередь повторно
    await actor.update(actorUpdate, { render: false, admStatusSync: true });
    _renderActorApps(actor);
  }

  // никогда не unsetFlag при deleting — предмет и так исчезает
  if (!deleting) {
    await _writeItemApplied(item, desiredNow);
  }
}

/**
 * Применить/снять моды статусов, записанных НА АКТЁРЕ:
 * - flags.actorStatusDefs (локальные)
 * - flags.appliedStatusDefs (наложенные кнопкой /st)
 *
 * Плюс: моментальные моды (instantAttribute) — срабатывают, затем статус удаляется.
 */
export async function admSyncActorStatusMods(actor, { forcedDefs = null } = {}) {
  if (!actor || !(actor instanceof Actor) || !actor.isOwner) return;

  const lockKey = actor.uuid || `actor:${actor.id}`;
  if (__admStatusSyncLock.has(lockKey)) return;
  __admStatusSyncLock.add(lockKey);

  try {
    const DBG = !!globalThis.__ADM_STATUS_DEBUG;
    const log = (...a) => DBG && console.log("[ADM:STATUS][ACTOR]", ...a);

    const appliedBefore = _readActorApplied(actor);

    const plan = await _computeActorPlan(actor, { forcedDefs });
    const desiredNow = plan.desired;

    const deltaPersistent = _diffMaps(appliedBefore, desiredNow);

    // persistent delta + instant delta
    const inc = {};
    for (const [path, d] of Object.entries(deltaPersistent)) inc[path] = (inc[path] ?? 0) + (Number(d) || 0);
    for (const [path, d] of Object.entries(plan.instantDelta)) inc[path] = (inc[path] ?? 0) + (Number(d) || 0);

    log("SYNC", {
      actor: actor.name,
      appliedBefore,
      desiredNow,
      deltaPersistent,
      instantDelta: plan.instantDelta,
      consume: plan.consume
    });

    if (Object.keys(inc).length) {
      const actorUpdate = {};
      for (const [path, d] of Object.entries(inc)) {
        const cur = Number(foundry.utils.getProperty(actor, path) ?? 0);
        actorUpdate[path] = cur + (Number(d) || 0);
      }

      log("ACTOR_UPDATE", actorUpdate);

      // защита от рекурсивного updateActor-хука
      await actor.update(actorUpdate, { render: false, admStatusSync: true });
      _renderActorApps(actor);
    }

    // applied слепок — только persistent
    await _writeActorApplied(actor, desiredNow);

    // Удалить моментальные статусы с актёра сразу после срабатывания
    if (plan.consume.appliedIds.length || plan.consume.localIds.length) {
      await _consumeInstantStatuses(actor, plan.consume, { forcedDefs });
      _renderActorApps(actor);
    }
  } finally {
    __admStatusSyncLock.delete(lockKey);
  }
}

/**
 * Авто-хуки
 */
export function admStatusModsInit() {
  // миграция старых данных (activator -> when, удалить activator)
  Hooks.once("ready", () => {
    // чтобы не было гонки обновлений с игроков
    if (!game?.user?.isGM) return;
    _migrateAllStatusDefs().catch((e) => console.error(e));
  });

  // --- items ---
  Hooks.on("createItem", (item) => {
    const actor = item?.parent;
    if (!actor || !(actor instanceof Actor) || !actor.isOwner) return;
    _queueItem(actor, item, { forcedContainer: null, deleting: false });
  });

  Hooks.on("preDeleteItem", (item) => {
    const actor = item?.parent;
    if (!actor || !(actor instanceof Actor) || !actor.isOwner) return;

    admSyncItemStatusMods(actor, item, { forcedContainer: null, deleting: true }).catch((e) => console.error(e));
  });

  Hooks.on("updateItem", (item, changes) => {
    const actor = item?.parent;
    if (!actor || !(actor instanceof Actor) || !actor.isOwner) return;

    // игнорируем собственные служебные апдейты applied
    const appliedChangedFlat = changes?.[`flags.${FLAG_SCOPE}.${ITEM_APPLIED_KEY}`] !== undefined;
    const appliedChangedNested =
      foundry.utils.getProperty(changes, `flags.${FLAG_SCOPE}.${ITEM_APPLIED_KEY}`) !== undefined;
    if (appliedChangedFlat || appliedChangedNested) return;

    const containerChangedFlat = changes?.[`flags.${FLAG_SCOPE}.container`] !== undefined;
    const containerChangedNested = foundry.utils.getProperty(changes, `flags.${FLAG_SCOPE}.container`) !== undefined;

    const defsChangedFlat = changes?.[`flags.${FLAG_SCOPE}.${FLAG_STATUS_DEFS}`] !== undefined;
    const defsChangedNested = foundry.utils.getProperty(changes, `flags.${FLAG_SCOPE}.${FLAG_STATUS_DEFS}`) !== undefined;

    if (!containerChangedFlat && !containerChangedNested && !defsChangedFlat && !defsChangedNested) return;

    _queueItem(actor, item, { forcedContainer: null, deleting: false });
  });

  // --- actors ---
  Hooks.on("updateActor", (actor, changes, options) => {
    if (!actor || !(actor instanceof Actor) || !actor.isOwner) return;
    if (options?.admStatusSync) return;

    // игнорируем собственные applied-апдейты
    const appliedChangedFlat = changes?.[`flags.${FLAG_SCOPE}.${ACTOR_APPLIED_KEY}`] !== undefined;
    const appliedChangedNested =
      foundry.utils.getProperty(changes, `flags.${FLAG_SCOPE}.${ACTOR_APPLIED_KEY}`) !== undefined;
    if (appliedChangedFlat || appliedChangedNested) return;

    const localChanged =
      changes?.[`flags.${FLAG_SCOPE}.${FLAG_ACTOR_STATUS_DEFS}`] !== undefined ||
      foundry.utils.getProperty(changes, `flags.${FLAG_SCOPE}.${FLAG_ACTOR_STATUS_DEFS}`) !== undefined;

    const appliedChanged =
      changes?.[`flags.${FLAG_SCOPE}.${FLAG_APPLIED_STATUS_DEFS}`] !== undefined ||
      foundry.utils.getProperty(changes, `flags.${FLAG_SCOPE}.${FLAG_APPLIED_STATUS_DEFS}`) !== undefined;

    if (!localChanged && !appliedChanged) return;

    _queueActor(actor);
  });
}

// ------------------------------------------------------------
// Debounce
// ------------------------------------------------------------

const __itemTimers = new Map();
const __actorTimers = new Map();

function _queueItem(actor, item, { forcedContainer = null, deleting = false } = {}) {
  const key = `${actor.id}:${item.id}`;
  const prev = __itemTimers.get(key);
  if (prev) clearTimeout(prev);

  const t = setTimeout(() => {
    __itemTimers.delete(key);
    admSyncItemStatusMods(actor, item, { forcedContainer, deleting }).catch((e) => console.error(e));
  }, 20);

  __itemTimers.set(key, t);
}

function _queueActor(actor) {
  const key = `actor:${actor.id}`;
  const prev = __actorTimers.get(key);
  if (prev) clearTimeout(prev);

  const t = setTimeout(() => {
    __actorTimers.delete(key);
    admSyncActorStatusMods(actor).catch((e) => console.error(e));
  }, 20);

  __actorTimers.set(key, t);
}

// ------------------------------------------------------------
// Desired calc (ITEMS)
// ------------------------------------------------------------
function _armorNumbers(item) {
  const sys = item?.system ?? {};
  const armor = Number(sys.baseDefense ?? sys.armor ?? sys.defense ?? 0) || 0;

  const noticeable = Number(
    sys.damageThresholds?.noticeable ?? sys.noticeableThreshold ?? sys.noticeable ?? 0
  ) || 0;

  const heavy = Number(
    sys.damageThresholds?.heavy ?? sys.heavyThreshold ?? sys.heavy ?? 0
  ) || 0;

  return { armor, noticeable, heavy };
}

function _computeDesiredFromItem(item, actor, { forcedContainer = null } = {}) {
  const container = forcedContainer ?? (item.getFlag(FLAG_SCOPE, "container") || "backpack");
  const isEquipped = container === "equipped";

  const defs = _readItemStatusDefs(item);
  if (!defs.length) return {};

  const out = {};

  for (const def of defs) {
    const when = _normalizeWhen(def?.when, "equip");

    // кнопка — никогда не авто-применяем
    if (when === "button") continue;

    // активность
    const active = when === "backpack" ? true : isEquipped;
    if (!active) continue;

    for (const m0 of def.mods ?? []) {
      const m = _normalizeMod(m0);
      const handler = getModifier(m.type);
      if (!handler) continue;

      // instant на предметах не применяем тут (они должны срабатывать только при наложении на актёра)
      if (handler.kind === "instant") continue;

      if (handler.accumulate) {
        handler.accumulate({ out, mod: m, actor, evalValue: _evalModValue });
      }
    }
  }
// Броня: применяем цифры напрямую при экипировке (без статуса внутри предмета)
if (isEquipped && item?.type === "armor") {
  const { armor, noticeable, heavy } = _armorNumbers(item);

  if (armor) out["system.resources.armor.max"] = (out["system.resources.armor.max"] ?? 0) + armor;
  if (noticeable) out["system.damageThresholds.noticeable"] =
    (out["system.damageThresholds.noticeable"] ?? 0) + noticeable;
  if (heavy) out["system.damageThresholds.heavy"] =
    (out["system.damageThresholds.heavy"] ?? 0) + heavy;
}

  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

// ------------------------------------------------------------
// Plan calc (ACTOR): persistent + instant + consume ids
// ------------------------------------------------------------

function _readActorStatusDefs(actor, flagKey) {
  const raw = actor.getFlag(FLAG_SCOPE, flagKey);
  const arr = Array.isArray(raw) ? raw.filter(Boolean) : [];
  return _normalizeStatusDefsArray(arr, { defaultWhen: "backpack" });
}

async function _computeActorPlan(actor, { forcedDefs = null } = {}) {
  const desired = {};
  const instantDelta = {};
  const consume = { localIds: [], appliedIds: [] };

  const localDefs = Array.isArray(forcedDefs)
    ? _normalizeStatusDefsArray(forcedDefs, { defaultWhen: "backpack" })
    : _readActorStatusDefs(actor, FLAG_ACTOR_STATUS_DEFS);

  const appliedDefs = _readActorStatusDefs(actor, FLAG_APPLIED_STATUS_DEFS);

  const applyOneDef = async (def, origin) => {
    const when = _normalizeWhen(def?.when, "backpack");
    const active = when === "backpack";
    if (!active) return;

    // - локальные статусы считаем от цели (actor)
    // - applied (/st) считаем от кастера, если casterUuid записан
    const casterActor = (origin === "applied") ? _getCasterActorFromDef(def) : null;

    const evalValue = (raw, a) => _evalModValue(raw, a, casterActor);
    const rollValue = (raw, a) => _rollModValue(raw, a, casterActor);

    let hasInstant = false;

    for (const m0 of def.mods ?? []) {
      const m = _normalizeMod(m0);
      const handler = getModifier(m.type);
      if (!handler) continue;

      const path = String(m.path ?? "").trim();
      if (!path) continue;

      if (handler.kind === "instant") {
        hasInstant = true;

        const dv = handler.computeInstant
          ? await handler.computeInstant({ mod: m, actor, rollValue })
          : 0;

        const n = Number(dv) || 0;
        if (n) instantDelta[path] = (instantDelta[path] ?? 0) + n;

        continue;
      }

      if (handler.accumulate) {
        handler.accumulate({ out: desired, mod: m, actor, evalValue });
      }
    }

    // если в статусе есть instant-моды — статус должен исчезнуть
    if (hasInstant) {
      const id = String(def?.id ?? "").trim();
      if (!id) return;

      if (origin === "local") consume.localIds.push(id);
      if (origin === "applied") consume.appliedIds.push(id);
    }
  };

  for (const d of localDefs) await applyOneDef(d, "local");
  for (const d of appliedDefs) await applyOneDef(d, "applied");

  for (const k of Object.keys(desired)) if (!desired[k]) delete desired[k];
  for (const k of Object.keys(instantDelta)) if (!instantDelta[k]) delete instantDelta[k];

  return { desired, instantDelta, consume };
}

async function _consumeInstantStatuses(actor, consume, { forcedDefs = null } = {}) {
  const localIds = new Set(consume?.localIds ?? []);
  const appliedIds = new Set(consume?.appliedIds ?? []);

  // local (actorStatusDefs)
  if (localIds.size) {
    const raw = Array.isArray(forcedDefs)
      ? forcedDefs
      : (actor.getFlag(FLAG_SCOPE, FLAG_ACTOR_STATUS_DEFS) ?? []);

    const arr = Array.isArray(raw) ? raw : [];
    const next = arr.filter((d) => !localIds.has(String(d?.id ?? "")));

    if (!Array.isArray(forcedDefs)) {
      await actor.setFlag(FLAG_SCOPE, FLAG_ACTOR_STATUS_DEFS, next, { render: false, admStatusSync: true });
    }
  }

  // applied (/st)
  if (appliedIds.size) {
    const raw = actor.getFlag(FLAG_SCOPE, FLAG_APPLIED_STATUS_DEFS);
    const arr = Array.isArray(raw) ? raw : [];
    const next = arr.filter((d) => !appliedIds.has(String(d?.id ?? "")));

    await actor.setFlag(FLAG_SCOPE, FLAG_APPLIED_STATUS_DEFS, next, { render: false, admStatusSync: true });
  }
}

// ------------------------------------------------------------
// Applied storage (array формат + миграция старого вложенного)
// ------------------------------------------------------------

function _readItemApplied(item) {
  const raw = item.getFlag(FLAG_SCOPE, ITEM_APPLIED_KEY);

  if (Array.isArray(raw)) {
    const out = {};
    for (const row of raw) {
      const p = String(row?.path ?? "").trim();
      const v = Number(row?.value ?? 0);
      if (!p || !Number.isFinite(v) || v === 0) continue;
      out[p] = (out[p] ?? 0) + v;
    }
    return out;
  }

  if (raw && typeof raw === "object") {
    const flat = {};
    _flattenNumericLeaves(raw, "", flat);
    return flat;
  }

  return {};
}

async function _writeItemApplied(item, map) {
  const entries = Object.entries(map ?? {})
    .map(([path, value]) => ({ path: String(path), value: Number(value) || 0 }))
    .filter((x) => x.path && Number.isFinite(x.value) && x.value !== 0);

  await item.setFlag(FLAG_SCOPE, ITEM_APPLIED_KEY, entries);
}

function _readActorApplied(actor) {
  const raw = actor.getFlag(FLAG_SCOPE, ACTOR_APPLIED_KEY);

  if (Array.isArray(raw)) {
    const out = {};
    for (const row of raw) {
      const p = String(row?.path ?? "").trim();
      const v = Number(row?.value ?? 0);
      if (!p || !Number.isFinite(v) || v === 0) continue;
      out[p] = (out[p] ?? 0) + v;
    }
    return out;
  }

  if (raw && typeof raw === "object") {
    const flat = {};
    _flattenNumericLeaves(raw, "", flat);
    return flat;
  }

  return {};
}

async function _writeActorApplied(actor, map) {
  const entries = Object.entries(map ?? {})
    .map(([path, value]) => ({ path: String(path), value: Number(value) || 0 }))
    .filter((x) => x.path && Number.isFinite(x.value) && x.value !== 0);

  await actor.setFlag(FLAG_SCOPE, ACTOR_APPLIED_KEY, entries);
}

function _flattenNumericLeaves(obj, prefix, out) {
  if (!obj || typeof obj !== "object") return;

  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;

    if (typeof v === "number") {
      if (Number.isFinite(v) && v !== 0) out[p] = (out[p] ?? 0) + v;
      continue;
    }

    if (v && typeof v === "object") _flattenNumericLeaves(v, p, out);
  }
}

// ------------------------------------------------------------
// Status defs normalization + MIGRATION
// ------------------------------------------------------------

function _readItemStatusDefs(item) {
  const raw = item.getFlag(FLAG_SCOPE, FLAG_STATUS_DEFS);
  const arr = Array.isArray(raw) ? raw.filter(Boolean) : [];
  return _normalizeStatusDefsArray(arr, { defaultWhen: "equip" });
}

function _normalizeStatusDefsArray(arr, { defaultWhen = "equip" } = {}) {
  const out = Array.isArray(arr) ? arr.filter(Boolean).map((x) => foundry.utils.deepClone(x)) : [];

  for (const d of out) {
    const rawWhen = (d.when == null || d.when === "") ? d.activator : d.when;
    d.when = _normalizeWhen(rawWhen, defaultWhen);

    if ("activator" in d) delete d.activator;

    if (!Array.isArray(d.mods)) d.mods = [];

    // миграция старого формата attrPath/attrDelta
    if (d.attrPath && d.attrDelta != null && d.mods.length === 0) {
      d.mods.push({ type: "attribute", path: String(d.attrPath), value: String(d.attrDelta) });
    }

    d.mods = Array.isArray(d.mods) ? d.mods.map(_normalizeMod) : [];
    delete d.attrPath;
    delete d.attrDelta;
  }

  return out;
}

function _normalizeWhen(v, fallback = "equip") {
  let w = String(v ?? "").trim().toLowerCase();

  if (w === "кнопка") w = "button";
  if (w === "при экипировке") w = "equip";
  if (w === "при получении") w = "backpack";

  if (w !== "equip" && w !== "backpack" && w !== "button") w = String(fallback ?? "equip").trim().toLowerCase();
  if (w !== "equip" && w !== "backpack" && w !== "button") w = "equip";
  return w;
}

function _normalizeMod(m) {
  const mm = m ?? {};
  let type = String(mm.type ?? "attribute").trim() || "attribute";

  const handler = getModifier(type);
  if (handler?.normalize) return handler.normalize(mm);

  // fallback
  const path = String(mm.path ?? mm.attrPath ?? "").trim();
  const value =
    mm.value != null ? String(mm.value).trim()
    : mm.attrDelta != null ? String(mm.attrDelta).trim()
    : "0";

  return { type, path, value };
}

// ------------------------------------------------------------
// Diff / utils
// ------------------------------------------------------------

function _diffMaps(oldMap, newMap) {
  const delta = {};
  const keys = new Set([...Object.keys(oldMap || {}), ...Object.keys(newMap || {})]);

  for (const k of keys) {
    const d = (Number(newMap?.[k]) || 0) - (Number(oldMap?.[k]) || 0);
    if (d !== 0) delta[k] = d;
  }

  return delta;
}

function _round(n) {
  if (!Number.isFinite(n)) return 0;
  if (Number.isInteger(n)) return n;
  return Math.ceil(n);
}

// ------------------------------------------------------------
// Formula evaluation
// ------------------------------------------------------------

// persistent: только математика (без дайсов)
function _evalModValue(raw, actor, casterActor = null) {
  const s0 = String(raw ?? "").trim();
  if (!s0) return 0;

  const direct = Number(s0);
  if (Number.isFinite(direct) && String(direct) === String(Number(s0))) return direct;

  const expr = _substituteTokens(s0, actor, casterActor);

  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return 0;

  let result = 0;
  try {
    // eslint-disable-next-line no-new-func
    result = Function(`return (${expr});`)();
  } catch (_e) {
    return 0;
  }

  const n = Number(result);
  if (!Number.isFinite(n)) return 0;
  return _round(n);
}

// instant: поддержка дайсов (1d4+3, -(1d4-Чутьё) и т.п.)
async function _rollModValue(raw, actor, casterActor = null) {
  const s0 = String(raw ?? "").trim();
  if (!s0) return 0;

  const expr = _substituteTokens(s0, actor, casterActor);

  // разрешаем d/D
  if (!/^[0-9dD+\-*/().\s]+$/.test(expr)) return 0;

  const hasDice = /(^|[^A-Za-z0-9_])\d*d\d+/i.test(expr);
  if (!hasDice) {
    // без дайсов — как обычная математика
    return _evalModValue(expr, actor, casterActor);
  }

  try {
    const roll = new Roll(expr);
    await roll.evaluate({ async: true });
    const n = Number(roll.total);
    if (!Number.isFinite(n)) return 0;
    return _round(n);
  } catch (_e) {
    return 0;
  }
}

function _substituteTokens(raw, actor, casterActor = null) {
  let expr = String(raw ?? "").trim();
  if (!expr) return "0";

  expr = expr.replace(/,/g, ".");

  // 1) @token / @{token}
  expr = expr.replace(/@\{([^}]+)\}|@([A-Za-zА-Яа-яЁё0-9_\.]+)/g, (_m, braced, plain) => {
    const token = String(braced ?? plain ?? "").trim();
    const n = _resolveTokenValue(token, actor, casterActor);
    return String(Number.isFinite(n) ? n : 0);
  });

  // 2) Токены без @ (кириллица + латиница)
  expr = expr.replace(
    /(^|[^A-Za-zА-Яа-яЁё0-9_\.])([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9_\.]*)(?=$|[^A-Za-zА-Яа-яЁё0-9_\.])/g,
    (_m, prefix, token) => {
      const t = String(token ?? "").trim();
      if (!t) return String(prefix ?? "");

      // число — оставляем
      if (/^\d+(\.\d+)?$/.test(t)) return `${prefix}${t}`;

      const n = _resolveTokenValue(t, actor, casterActor);
      return `${prefix}${Number.isFinite(n) ? n : 0}`;
    }
  );

  return expr;
}

function _resolveTokenValue(token, actor, casterActor = null) {
  const base = casterActor ?? actor;

  const t = String(token ?? "").trim();
  if (!t || !base) return 0;

  if (admIsMagicLabel(t)) return Number(admMagicValue(base) ?? 0) || 0;

  let path = "";
  if (t.startsWith("system.") || t.includes(".")) {
    path = t;
  } else {
    path = String(admPathForLabel(t) || "").trim();
  }

  if (!path) return 0;

  const v = Number(foundry.utils.getProperty(base, path) ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function _getCasterActorFromDef(def) {
  try {
    const uuid = String(def?.source?.casterUuid ?? "").trim();
    if (!uuid) return null;

    const doc = globalThis.fromUuidSync ? fromUuidSync(uuid) : null;
    return (doc instanceof Actor) ? doc : null;
  } catch (_e) {
    return null;
  }
}

function _renderActorApps(actor) {
  try {
    for (const app of Object.values(actor?.apps ?? {})) app?.render?.(false);
  } catch (e) {
    console.error(e);
  }
}

// ------------------------------------------------------------
// Migration: activator -> when, удалить activator в данных
// ------------------------------------------------------------

async function _migrateAllStatusDefs() {
  const DBG = !!globalThis.__ADM_STATUS_DEBUG;
  const log = (...a) => DBG && console.log("[ADM:STATUS][MIGRATE]", ...a);

  for (const item of (game?.items ?? [])) {
    if (!item?.isOwner) continue;
    const changed = await _migrateDocItem(item);
    if (changed) log("migrated world item", item.name);
  }

  for (const actor of (game?.actors ?? [])) {
    if (!actor?.isOwner) continue;

    const actorChanged = await _migrateDocActor(actor);
    if (actorChanged) log("migrated actor", actor.name);

    for (const it of (actor.items ?? [])) {
      if (!it?.isOwner) continue;
      const changed = await _migrateDocItem(it);
      if (changed) log("migrated owned item", actor.name, it.name);
    }
  }
}

async function _migrateDocItem(item) {
  const raw = item.getFlag(FLAG_SCOPE, FLAG_STATUS_DEFS);
  if (!Array.isArray(raw) || !raw.length) return false;

  const { clean, changed } = _sanitizeDefsArray(raw, { defaultWhen: "equip" });
  if (!changed) return false;

  await item.setFlag(FLAG_SCOPE, FLAG_STATUS_DEFS, clean);
  return true;
}

async function _migrateDocActor(actor) {
  let changedAny = false;

  for (const key of [FLAG_ACTOR_STATUS_DEFS, FLAG_APPLIED_STATUS_DEFS]) {
    const raw = actor.getFlag(FLAG_SCOPE, key);
    if (!Array.isArray(raw) || !raw.length) continue;

    const { clean, changed } = _sanitizeDefsArray(raw, { defaultWhen: "backpack" });
    if (!changed) continue;

    await actor.setFlag(FLAG_SCOPE, key, clean);
    changedAny = true;
  }

  return changedAny;
}

function _sanitizeDefsArray(arr, { defaultWhen = "equip" } = {}) {
  let changed = false;
  const out = Array.isArray(arr) ? arr.filter(Boolean).map((x) => foundry.utils.deepClone(x)) : [];

  for (const d of out) {
    const hadActivator = d && Object.prototype.hasOwnProperty.call(d, "activator");
    const hadWhen = d && Object.prototype.hasOwnProperty.call(d, "when");

    const rawWhen = (!hadWhen || d.when == null || d.when === "") ? d.activator : d.when;
    const normWhen = _normalizeWhen(rawWhen, defaultWhen);

    if (!hadWhen || String(d.when ?? "") !== String(normWhen)) {
      d.when = normWhen;
      changed = true;
    }

    if (hadActivator) {
      delete d.activator;
      changed = true;
    }

    if (!Array.isArray(d.mods)) {
      d.mods = [];
      changed = true;
    }

    if (d.attrPath && d.attrDelta != null && d.mods.length === 0) {
      d.mods.push({ type: "attribute", path: String(d.attrPath), value: String(d.attrDelta) });
      changed = true;
    }

    if (Array.isArray(d.mods)) {
      const before = JSON.stringify(d.mods);
      d.mods = d.mods.map(_normalizeMod);
      const after = JSON.stringify(d.mods);
      if (before !== after) changed = true;
    }

    if (d.attrPath) {
      delete d.attrPath;
      changed = true;
    }
    if (d.attrDelta != null) {
      delete d.attrDelta;
      changed = true;
    }
  }

  return { clean: out, changed };
}
