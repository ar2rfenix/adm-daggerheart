// systems/adm-daggerheart/module/status/adm-terms.mjs

const MAX_SUFFIX = "_Макс";

function _loc(key) {
  try {
    const s = game?.i18n?.localize?.(key);
    return String(s ?? key);
  } catch (_e) {
    return String(key ?? "");
  }
}

// ----------------------------
// Лейблы по системным путям
// ----------------------------
export function admLabelForPath(path) {
  const p = String(path ?? "").trim();
  if (!p) return "";

  // Traits
  const mTrait = p.match(/^system\.traits\.([a-z]+)\.value$/i);
  if (mTrait) {
    const k = String(mTrait[1]).toUpperCase();
    return _loc(`DAGGERHEART.TRAITS.${k}`);
  }

  // Resources
  if (p === "system.resources.hp.value") return _loc("DAGGERHEART.RES.HP");
  if (p === "system.resources.hp.max")   return _loc("DAGGERHEART.RES.HP") + MAX_SUFFIX;

  if (p === "system.resources.stress.value") return _loc("DAGGERHEART.RES.STRESS");
  if (p === "system.resources.stress.max")   return _loc("DAGGERHEART.RES.STRESS") + MAX_SUFFIX;

  if (p === "system.resources.armor.value") return _loc("DAGGERHEART.RES.ARMOR");
  if (p === "system.resources.armor.max")   return _loc("DAGGERHEART.RES.ARMOR") + MAX_SUFFIX;

  if (p === "system.resources.hope.value") return _loc("DAGGERHEART.RES.HOPE");
  if (p === "system.resources.hope.max")   return _loc("DAGGERHEART.RES.HOPE") + MAX_SUFFIX;

  if (p === "system.resources.fear.value") return _loc("DAGGERHEART.RES.FEAR");
  if (p === "system.resources.fear.max")   return _loc("DAGGERHEART.RES.FEAR") + MAX_SUFFIX;

if (p === "system.resources.dodge.value") return `${_loc("DAGGERHEART.RES.DODGE")} / СЛ`;


  // Thresholds
  if (p === "system.damageThresholds.noticeable") return _loc("DAGGERHEART.THRESHOLDS.NOTICEABLE");
  if (p === "system.damageThresholds.heavy")      return _loc("DAGGERHEART.THRESHOLDS.HEAVY");

  // Progress
  if (p === "system.level")   return _loc("DAGGERHEART.LEVEL");
  if (p === "system.mastery") return _loc("DAGGERHEART.MASTERY");

  return p;
}

// ----------------------------
// Пути по "лейблам" (рус/локализованные)
// ----------------------------
let __labelToPathCache = null;
let __cacheLang = null;

export function admInvalidateTermCaches() {
  __labelToPathCache = null;
  __cacheLang = null;
}

export function admBuildLabelToPathMap() {
  const lang = String(game?.i18n?.lang ?? "");
  if (__labelToPathCache && __cacheLang === lang) return __labelToPathCache;

  const map = Object.create(null);

  const add = (path) => {
    const label = admLabelForPath(path);
    if (!label) return;
    map[String(label).trim().toLowerCase()] = path;
  };

  // traits
  ["AGILITY","STRENGTH","FINESSE","INSTINCT","PRESENCE","KNOWLEDGE"].forEach((k) => {
    add(`system.traits.${k.toLowerCase()}.value`);
  });

  // resources value/max
  [
    "system.resources.hp.value",
    "system.resources.hp.max",
    "system.resources.stress.value",
    "system.resources.stress.max",
    "system.resources.armor.value",
    "system.resources.armor.max",
    "system.resources.hope.value",
    "system.resources.hope.max",
    "system.resources.fear.value",
    "system.resources.fear.max",
    "system.resources.dodge.value",
    "system.damageThresholds.noticeable",
    "system.damageThresholds.heavy",
    "system.level",
    "system.mastery",
  ].forEach(add);

  __labelToPathCache = map;
  __cacheLang = lang;
  return map;
}

export function admPathForLabel(label) {
  const s = String(label ?? "").trim();
  if (!s) return "";
  if (s.startsWith("system.")) return s;

  const map = admBuildLabelToPathMap();
  return map[s.toLowerCase()] || "";
}

// ----------------------------
// "Магия" — отдельный токен (не path)
// ----------------------------
export function admIsMagicLabel(label) {
  const s = String(label ?? "").trim().toLowerCase();
  // здесь можно добавить англ/другие синонимы при необходимости
  return s === "магия" || s === "magic";
}

export function admMagicValue(actor) {
  try {
    const flags = actor?.getFlag?.("adm-daggerheart", "magicTraits") || {};
    let max = 0;
    for (const [traitKey, on] of Object.entries(flags)) {
      if (!on) continue;
      const v = Number(actor.system?.traits?.[traitKey]?.value ?? 0) || 0;
      if (v > max) max = v;
    }
    return max;
  } catch (_e) {
    return 0;
  }
}
