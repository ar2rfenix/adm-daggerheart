// systems/adm-daggerheart/module/sheets/npc-sheet.mjs

import { admApplyTextReplacements } from "../text/adm-text-hooks.mjs";

// Foundry v13+
const TE = foundry?.applications?.ux?.TextEditor?.implementation;

/* -------------------------------------------- */
/* Utils                                        */
/* -------------------------------------------- */

function _loc(keyOrText) {
  if (!keyOrText) return "";
  const s = String(keyOrText);
  try {
    const loc = game?.i18n?.localize?.(s);
    if (loc && loc !== s) return loc;
  } catch (_e) {}
  return s;
}

function _normStr(v) {
  return String(v ?? "").trim();
}

function _clampInt(n, min, max) {
  const x = Math.trunc(Number(n ?? 0) || 0);
  return Math.max(min, Math.min(max, x));
}

function _abilityBucketFromSystem(sys) {
  const t = _normStr(sys?.abilityType).toLowerCase();
  if (t === "action") return "actions";
  if (t === "passive") return "passives";
  if (t === "reaction") return "reactions";

  const c = _normStr(sys?.category).toLowerCase();
  if (c === "actions" || c === "passives" || c === "reactions") return c;

  return "";
}

function _typeLabel(bucket) {
  if (bucket === "actions") return "Действие";
  if (bucket === "passives") return "Пассивное";
  if (bucket === "reactions") return "Реакция";
  return "";
}

// --- EnemyAbility: default img swap ---
const ADM_ENEMY_ABILITY_DEFAULT_IMG = "icons/svg/item-bag.svg";

const ADM_ENEMY_ABILITY_TYPE_IMG = {
  actions:   "icons/magic/air/fog-gas-smoke-swirling-orange.webp",
  passives:  "icons/magic/air/fog-gas-smoke-swirling-blue.webp",
  reactions: "icons/magic/air/fog-gas-smoke-swirling-yellow.webp",
};

function _normImg(p) {
  return String(p ?? "").trim().replaceAll("\\", "/");
}

function _isDefaultEnemyAbilityImg(img) {
  const a = _normImg(img);
  const b = _normImg(ADM_ENEMY_ABILITY_DEFAULT_IMG);
  if (!a || !b) return false;
  // сравнение по хвосту, чтобы не зависеть от относительных путей
  return a.endsWith(b);
}

function _pickEnemyAbilityImgFromSystem(sys) {
  const bucket = _abilityBucketFromSystem(sys); // уже есть у вас выше
  return ADM_ENEMY_ABILITY_TYPE_IMG[bucket] || ADM_ENEMY_ABILITY_DEFAULT_IMG;
}


// Сортировка вкладки "Умения": Пассивные -> Действия -> Реакции
function _bucketWeight(bucket) {
  if (bucket === "passives") return 0;
  if (bucket === "actions") return 1;
  if (bucket === "reactions") return 2;
  return 9;
}

function _compareAbilities(a, b) {
  const wa = _bucketWeight(a.bucket);
  const wb = _bucketWeight(b.bucket);
  if (wa !== wb) return wa - wb;

  const sa = Number(a.sort ?? 0);
  const sb = Number(b.sort ?? 0);
  if (sa !== sb) return sa - sb;

  return String(a.name ?? "").localeCompare(String(b.name ?? ""), "ru");
}

function _getNpcStress(actor) {
  const cur = Number(actor?.system?.resources?.stress?.value ?? 0) || 0;
  const max = Number(actor?.system?.resources?.stress?.max ?? 0) || 0;
  return { cur, max };
}

async function _setNpcStress(actor, next) {
  const upd = {};
  foundry.utils.setProperty(upd, "system.resources.stress.value", next);
  await actor.update(upd);
}

// глобальный Fear хранится в world settings (как у вас в init)
function _getGlobalFear() {
  const cur = Number(game.settings.get("daggerheart", "fear") ?? 0) || 0;
  const homebrew = game.settings.get("daggerheart", "homebrew") ?? {};
  const max = Number(homebrew?.maxFear ?? 12) || 12;
  return { cur, max };
}

async function _setGlobalFear(next) {
  await game.settings.set("daggerheart", "fear", next);
}

/* -------------------------------------------- */
/* VM builder                                   */
/* -------------------------------------------- */

export async function admBuildEnemyAbilitiesVM(actor) {
  const items = actor?.items?.filter?.((i) => i.type === "enemyAbility") ?? [];

  const all = [];
  const actions = [];
  const passives = [];
  const reactions = [];

  for (const it of items) {
    const sys = it.system ?? {};

    const rangeKey = _normStr(sys.range || "none");
    const rangeLabel =
      rangeKey && rangeKey !== "none"
        ? (_loc(CONFIG.ADM_DAGGERHEART?.ranges?.[rangeKey]) || "")
        : "";

    const bucket = _abilityBucketFromSystem(sys);
    const typeLabel = _typeLabel(bucket);

    const fear = Number(sys.fear ?? 0) || 0;
    const stress = Number(sys.stress ?? 0) || 0;

    const counterValue = Number(sys.counter?.value ?? 0) || 0;
    const counterMax = Number(sys.counter?.max ?? 0) || 0;

    const notesRaw = _normStr(sys.notes || sys.description || sys.text || "");
    const hasNotes = !!notesRaw;

    let notesHTML = notesRaw;
    try {
      if (hasNotes && TE?.enrichHTML) {
        notesHTML = await TE.enrichHTML(notesRaw, {
          async: true,
          secrets: false,
          documents: true,
          links: true,
          rolls: true,
          relativeTo: it,
        });
      }
    } catch (_e) {
      notesHTML = notesRaw;
    }

    try {
      if (hasNotes) {
        notesHTML = admApplyTextReplacements(notesHTML, {
          actor,
          item: it,
          caster: null,
        });
      }
    } catch (_e) {}

    const summaryParts = [];
    if (typeLabel) summaryParts.push(typeLabel);
    if (rangeLabel) summaryParts.push(rangeLabel);

    const vm = {
      id: it.id,
      img: it.img,
      name: it.name,

      sort: Number(it.sort ?? 0),

      bucket,
      rangeKey,
      rangeLabel,

      fear,
      stress,
      fearIcons: Array.from({ length: Math.max(0, fear) }),
      stressIcons: Array.from({ length: Math.max(0, stress) }),

      counterValue,
      counterMax,

      summary: summaryParts.join(" • "),

      hasNotes,
      notesHTML,
    };

    all.push(vm);

    if (bucket === "actions") actions.push(vm);
    else if (bucket === "passives") passives.push(vm);
    else if (bucket === "reactions") reactions.push(vm);
  }

  all.sort(_compareAbilities);
  actions.sort(_compareAbilities);
  passives.sort(_compareAbilities);
  reactions.sort(_compareAbilities);

  return {
    all,
    actions,
    passives,
    reactions,
    hasActions: actions.length > 0,
    hasPassives: passives.length > 0,
    hasReactions: reactions.length > 0,
  };

}

/* -------------------------------------------- */
/* Rerender hooks                               */
/* -------------------------------------------- */

let __admNpcAbilitiesRerenderHooked = false;

export function admNpcInitEnemyAbilitiesRerender() {
  if (__admNpcAbilitiesRerenderHooked) return;
  __admNpcAbilitiesRerenderHooked = true;

  const rerenderIfNpcEnemyAbility = (doc) => {
    const a = doc?.parent;
    if (!a || a.type !== "npc") return;
    if (doc.type !== "enemyAbility") return;

    for (const app of Object.values(a.apps ?? {})) {
      try {
        app.render?.(false);
      } catch (_e) {}
    }
  };

  Hooks.on("createItem", rerenderIfNpcEnemyAbility);
  Hooks.on("updateItem", rerenderIfNpcEnemyAbility);
  Hooks.on("deleteItem", rerenderIfNpcEnemyAbility);
}

/* -------------------------------------------- */
/* Clicks: GLOBAL delegated (CAPTURE)           */
/* -------------------------------------------- */

let __admNpcEnemyAbilityClicksInstalled = false;

export function admNpcInitEnemyAbilityClicks() {
  if (__admNpcEnemyAbilityClicksInstalled) return;
  __admNpcEnemyAbilityClicksInstalled = true;

  // ВАЖНО: только pointerdown, capture.
  // Это позволяет "перехватить" событие раньше других делегатов (adm-text-hooks и т.п.)
  document.addEventListener("pointerdown", _onEnemyAbilityPointerDown, true);

  // ПКМ для counter -1
  document.addEventListener("contextmenu", _onEnemyAbilityContext, true);

}

function _findRowAndActor(ev) {
  const t = ev?.target;
  if (!t) return null;

  const row = t.closest?.(".adm-skill-row[data-item-id]");
  if (!row) return null;

  const inv = row.closest?.(".adm-inv");
  if (!inv) return null;

  // Надёжно: actor uuid прямо в контейнере (вы уже вывели data-actor-uuid)
  const actorUuid = inv.dataset?.actorUuid;
  if (actorUuid) {
    const actor = fromUuidSync?.(actorUuid);
    if (actor && actor.type === "npc") return { row, actor };
  }

  // Fallback: через appid в composedPath
  const path = typeof ev.composedPath === "function" ? ev.composedPath() : [];
  let appId = null;

  for (const el of path) {
    if (el?.dataset?.appid) { appId = el.dataset.appid; break; }
  }
  if (!appId) {
    for (const el of path) {
      const host = el?.closest?.("[data-appid]");
      if (host?.dataset?.appid) { appId = host.dataset.appid; break; }
    }
  }
  if (!appId) return null;

  const app = ui?.windows?.[appId];
  const actor = app?.actor ?? app?.document;
  if (!actor || actor.type !== "npc") return null;

  return { row, actor };
}

async function _onEnemyAbilityPointerDown(ev) {
  const t = ev.target;
  if (!t) return;

  // берём ближайший data-action
  const wrap = t.closest?.("[data-action]");
  if (!wrap) return;

  const action = wrap.getAttribute("data-action");
  if (action !== "apply-fear" && action !== "apply-stress" && action !== "counter") return;

  const ctx = _findRowAndActor(ev);
  if (!ctx) return;

  // ЖЁСТКО останавливаем, чтобы второй обработчик не получил событие
  ev.preventDefault();
  ev.stopPropagation();
  if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();

  const { row, actor } = ctx;
  const itemId = row.getAttribute("data-item-id");
  const item = actor.items?.get?.(itemId);

  const amount = Math.max(0, Math.trunc(Number(wrap.getAttribute("data-amount")) || 0));



  // FEAR (GLOBAL): -amount
  if (action === "apply-fear") {
    if (!amount) return;

    const { cur, max } = _getGlobalFear();

    if (cur <= 0) {
      ui.notifications?.warn?.("Нельзя уменьшить страх: уже минимум.");
      return;
    }
    if (cur - amount < 0) {
      ui.notifications?.warn?.("Нельзя уменьшить страх: уйдёт ниже минимума.");
      return;
    }

    const next = _clampInt(cur - amount, 0, max);
    await _setGlobalFear(next);
    return;
  }

  // STRESS (NPC): +amount (строго, без частичного добавления)
  if (action === "apply-stress") {
    if (!amount) return;

    const { cur, max } = _getNpcStress(actor);

    if (max > 0 && cur >= max) {
      ui.notifications?.warn?.("Нельзя добавить стресс: уже максимум.");
      return;
    }
    if (max > 0 && cur + amount > max) {
      ui.notifications?.warn?.("Нельзя добавить стресс: достигнут максимум.");
      return;
    }

    await _setNpcStress(actor, cur + amount);
    return;
  }

  // COUNTER (ITEM): ЛКМ +1
  if (action === "counter") {
    if (!item) return;

    const cur = Number(item.system?.counter?.value ?? 0) || 0;
    const max = Number(item.system?.counter?.max ?? 0) || 0;

    const next = max > 0 ? _clampInt(cur + 1, 0, max) : (cur + 1);
    await item.update({ "system.counter.value": next });
    return;
  }
}

async function _onEnemyAbilityContext(ev) {
  const t = ev.target;
  if (!t) return;

  const wrap = t.closest?.('[data-action="counter"]');
  if (!wrap) return;

  const ctx = _findRowAndActor(ev);
  if (!ctx) return;

  ev.preventDefault();
  ev.stopPropagation();
  if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();

  const { row, actor } = ctx;
  const itemId = row.getAttribute("data-item-id");
  const item = actor.items?.get?.(itemId);
  if (!item) return;

  const cur = Number(item.system?.counter?.value ?? 0) || 0;
  const max = Number(item.system?.counter?.max ?? 0) || 0;


  const next = max > 0 ? _clampInt(cur - 1, 0, max) : Math.max(0, cur - 1);
  await item.update({ "system.counter.value": next });
}

/* -------------------------------------------- */
/* Drop handler                                 */
/* -------------------------------------------- */

export async function admNpcHandleDrop(sheet, event) {
  let data = null;
  try {
    const raw = event.dataTransfer?.getData("text/plain");
    data = raw ? JSON.parse(raw) : null;
  } catch (_e) {
    data = null;
  }

  if (!data || data.type !== "Item") return false;

  let dropped = null;
  try {
    if (data.uuid) dropped = await fromUuid(data.uuid);
    if (!dropped && Item?.implementation?.fromDropData) {
      dropped = await Item.implementation.fromDropData(data);
    }
  } catch (_e) {
    dropped = null;
  }

  if (!dropped || dropped.type !== "enemyAbility") return false;

  event.preventDefault();

  if (dropped.parent?.id === sheet.actor?.id) return true;

const obj = dropped.toObject();
delete obj._id;

// если у перетаскиваемого умения дефолтная картинка (мешок) — подменяем по типу
if (_isDefaultEnemyAbilityImg(obj.img)) {
  obj.img = _pickEnemyAbilityImgFromSystem(obj.system ?? {});
}

await sheet.actor.createEmbeddedDocuments("Item", [obj]);
return true;

}
