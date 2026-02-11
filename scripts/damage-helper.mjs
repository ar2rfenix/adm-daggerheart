// systems/adm-daggerheart/scripts/damage-helper.mjs
// Логика урона: бросок, переброс, добавление/удаление кубов, таргеты, устойчивость

// -------------------------
// Utils
// -------------------------
function _route(p) {
  try { return foundry.utils.getRoute(p); }
  catch (_e) { return `/${String(p).replace(/^\/+/, "")}`; }
}

function _dieSvgSrcGrey(sides) {
  const n = Math.max(2, Math.trunc(Number(sides) || 12));
  return _route(`icons/svg/d${n}-grey.svg`);
}

function _damageTypeShort(key) {
  const k = String(key || "").trim().toLowerCase();
  if (k === "physical") return "физ.";
  if (k === "magical")  return "маг.";
  if (k === "direct")   return "прям.";
  return String(k || "");
}

async function _confirm(title, content) {
  return Dialog.confirm({ title, content });
}

// -------------------------
// DSN (Dice So Nice) helpers
// -------------------------
async function _rollDieWithDsn(sides) {
  const n = Math.max(2, Math.trunc(Number(sides) || 6));
  const roll = new Roll(`1d${n}`);
  await roll.evaluate();
  const value = Number(roll.total) || 0;
  if (game.dice3d) {
    try { await game.dice3d.showForRoll(roll, game.user, true); } catch (_e) {}
  }
  return value;
}

// -------------------------
// Parse damage formula: "3d6+3" => { parts: [{count:3, sides:6, mods:""}], mod: 3 }
// Supports Foundry modifiers: kh, kl, dh, dl  (e.g. "3d8dl1+3")
// -------------------------
function _parseDamageFormula(formula) {
  const raw = String(formula || "").trim();
  if (!raw) return { parts: [], mod: 0 };

  const parts = [];
  let mod = 0;

  const diceRe = /(\d*)d(\d+)((?:[a-z<>=!]+\d*)*)/gi;
  let m;
  while ((m = diceRe.exec(raw)) !== null) {
    const count = Math.max(1, parseInt(m[1], 10) || 1);
    const sides = parseInt(m[2], 10) || 6;
    const mods = (m[3] || "").toLowerCase();
    parts.push({ count, sides, mods });
  }

  const modMatch = raw.match(/([+-]\s*\d+)\s*$/);
  if (modMatch) {
    mod = parseInt(modMatch[1].replace(/\s+/g, ""), 10) || 0;
  }

  return { parts, mod };
}

// -------------------------
// Mark active/inactive dice based on kh/kl/dh/dl modifiers.
// Considers the FULL pool: rolledDice + positive extraDice of matching sides.
// Mutates each die: sets d.active = true/false.
// -------------------------
function _markActiveDice(rolledDice, extraDice, rollMods) {
  for (const d of rolledDice) d.active = true;
  for (const d of (extraDice ?? [])) d.active = true;
  if (!rollMods || !rolledDice.length) return;

  const m = rollMods.match(/^(kh|kl|dh|dl)(\d+)$/i);
  if (!m) return;

  const type = m[1].toLowerCase();
  const modCount = parseInt(m[2], 10) || 0;
  if (modCount <= 0) return;

  // Determine which die sides the modifier applies to
  const modSides = rolledDice[0]?.sides;
  if (!modSides) return;

  // Build combined pool: rolledDice + positive extraDice of the same sides
  const pool = [];
  for (const d of rolledDice) {
    if (d.sides === modSides) pool.push(d);
  }
  for (const d of (extraDice ?? [])) {
    if (d.sides === modSides && !d.isNeg) pool.push(d);
  }
  if (!pool.length) return;

  const effectiveCount = Math.min(modCount, pool.length);
  const sorted = [...pool].sort((a, b) => a.value - b.value);
  let activeSet;

  if (type === "kh") {
    activeSet = new Set(sorted.slice(sorted.length - effectiveCount).map(d => d.id));
  } else if (type === "kl") {
    activeSet = new Set(sorted.slice(0, effectiveCount).map(d => d.id));
  } else if (type === "dh") {
    activeSet = new Set(sorted.slice(0, sorted.length - effectiveCount).map(d => d.id));
  } else if (type === "dl") {
    activeSet = new Set(sorted.slice(effectiveCount).map(d => d.id));
  }

  if (activeSet) {
    for (const d of pool) d.active = activeSet.has(d.id);
  }
}

// -------------------------
// Resilience: проверяем устойчивость токена к типу урона
// Возвращает: { multiplier: 1|2|0.5|0, kind: ""|"resist"|"immune"|"vuln" }
// -------------------------
function _getTokenResilience(token, damageType) {
  const type = String(damageType || "").trim().toLowerCase();
  if (!type || type === "direct") return { multiplier: 1, kind: "" };

  const actor = token?.actor;
  if (!actor) return { multiplier: 1, kind: "" };

  const FLAG_SCOPE = "adm-daggerheart";
  const FLAG_STATUS_DEFS = "statusDefs";
  const FLAG_ACTOR_STATUS_DEFS = "actorStatusDefs";
  const FLAG_APPLIED_STATUS_DEFS = "appliedStatusDefs";

  const allMods = [];

  const _collectDefs = (defs, activeWhen) => {
    if (!Array.isArray(defs)) return;
    for (const def of defs) {
      const when = String(def?.when || "equip").trim();
      if (when !== activeWhen) continue;
      for (const m of (def.mods ?? [])) {
        if (String(m?.type || "").trim() === "resilience") {
          allMods.push(String(m.value || "").trim());
        }
      }
    }
  };

  for (const item of (actor.items ?? [])) {
    const equipped = !!item.system?.equipped;
    if (!equipped && item.type !== "status") continue;
    const defs = item.getFlag?.(FLAG_SCOPE, FLAG_STATUS_DEFS);
    if (Array.isArray(defs)) {
      _collectDefs(defs, "equip");
      if (item.type === "status") _collectDefs(defs, "backpack");
    }
  }

  const actorDefs = actor.getFlag?.(FLAG_SCOPE, FLAG_ACTOR_STATUS_DEFS);
  if (Array.isArray(actorDefs)) _collectDefs(actorDefs, "backpack");

  const appliedDefs = actor.getFlag?.(FLAG_SCOPE, FLAG_APPLIED_STATUS_DEFS);
  if (Array.isArray(appliedDefs)) _collectDefs(appliedDefs, "backpack");

  const suffix = type === "physical" ? "phy" : type === "magical" ? "mag" : "";
  if (!suffix) return { multiplier: 1, kind: "" };

  if (allMods.includes(`immune_${suffix}`)) return { multiplier: 0, kind: "immune" };
  if (allMods.includes(`resist_${suffix}`)) return { multiplier: 0.5, kind: "resist" };
  if (allMods.includes(`vuln_${suffix}`)) return { multiplier: 2, kind: "vuln" };

  return { multiplier: 1, kind: "" };
}

// -------------------------
// Resolve token from target data
// -------------------------
function _resolveToken(tokenId, sceneId) {
  try {
    const scene = sceneId ? game.scenes?.get(sceneId) : canvas?.scene;
    if (!scene) return null;
    return scene.tokens?.get(tokenId) ?? null;
  } catch (_e) {
    return null;
  }
}

// -------------------------
// Damage color by resilience kind
// white = normal, red = resist/immune, green = vuln
// -------------------------
function _dmgColorClass(resKind) {
  if (resKind === "resist" || resKind === "immune") return "adm-dmg-val--resist";
  if (resKind === "vuln") return "adm-dmg-val--vuln";
  return "";
}

// -------------------------
// Build dice row for damage
// -------------------------
function _buildDamageDiceRow(rolledDice, extraDice) {
  const out = [];

  for (const d of rolledDice) {
    out.push({
      id: d.id,
      kind: "dmg",
      svg: _dieSvgSrcGrey(d.sides),
      scale: 1,
      text: String(d.value),
      isNeg: false,
      isDropped: d.active === false,
    });
  }

  for (const d of extraDice) {
    out.push({
      id: d.id,
      kind: "mod",
      svg: _dieSvgSrcGrey(d.sides),
      scale: 1,
      text: String(Math.abs(d.value)),
      isNeg: !!d.isNeg,
      isDropped: d.active === false,
    });
  }

  return out;
}

// -------------------------
// Sum extra dice
// -------------------------
function _sumExtraDice(arr) {
  if (!Array.isArray(arr)) return 0;
  let s = 0;
  for (const d of arr) {
    if (d.active === false) continue; // dropped by kh/kl/dh/dl
    const v = Math.trunc(Number(d?.value) || 0);
    s += d.isNeg ? -v : v;
  }
  return s;
}

// -------------------------
// Compute per-target damage + color
// -------------------------
function _computeTargetView(t, baseDmg, damageType, isHalf, isMissTarget = false) {
  const token = _resolveToken(t.tokenId, t.sceneId);
  const res = token ? _getTokenResilience(token, damageType) : { multiplier: t.resMultiplier ?? 1, kind: t.resKind ?? "" };
  t.resMultiplier = res.multiplier;
  t.resKind = res.kind;

  const srcDmg = isMissTarget
    ? (isHalf ? Math.ceil(baseDmg / 2) : 0)
    : baseDmg;

  // Apply resilience first
  const resDmg = Math.max(0, Math.ceil(srcDmg * res.multiplier));

  let dmg;
  if (t.excluded) {
    dmg = 0;
  } else if (t.override === "x2") {
    dmg = resDmg * 2;
  } else if (t.override === "half") {
    dmg = Math.ceil(resDmg / 2);
  } else if (t.override === "zero") {
    dmg = 0;
  } else {
    dmg = resDmg;
  }

  // Apply flat modifier (±N from per-target scroll)
  if (t.flatMod && !t.excluded) dmg = Math.max(0, dmg + t.flatMod);

  t.dmg = dmg;
  t.dmgColor = t.excluded ? "" : _dmgColorClass(res.kind);
}

// -------------------------
// MAIN: create damage chat message
// -------------------------
export async function admDamageRollToChat(damageFormula, damageType, targets, isCrit) {
  const parsed = _parseDamageFormula(damageFormula);
  if (!parsed.parts.length) return;

  const rollParts = parsed.parts.map(p => `${p.count}d${p.sides}${p.mods}`);
  const combinedRoll = new Roll(rollParts.join(" + "));
  await combinedRoll.evaluate();

  if (game.dice3d) {
    try { await game.dice3d.showForRoll(combinedRoll, game.user, true); } catch (_e) {}
  }

  // Collect dice modifiers for active/inactive marking (single-group case)
  const rollMods = parsed.parts.length === 1 ? (parsed.parts[0].mods || "") : "";

  const rolledDice = [];
  let dieIdx = 0;
  for (const term of combinedRoll.dice) {
    for (const r of (term.results ?? [])) {
      rolledDice.push({
        id: `dmg-${dieIdx++}`,
        sides: term.faces,
        value: Number(r.result) || 0,
      });
    }
  }

  const modTotal = parsed.mod;
  const extraDice = [];

  _markActiveDice(rolledDice, extraDice, rollMods);
  const diceSum = rolledDice.reduce((s, d) => s + (d.active !== false ? d.value : 0), 0);
  const damageTotal = diceSum + modTotal;

  const type = String(damageType || "physical").trim().toLowerCase();

  const hitTargets = [];
  const missTargets = [];

  for (const t of (targets ?? [])) {
    const token = _resolveToken(t.tokenId, t.sceneId);
    const res = token ? _getTokenResilience(token, type) : { multiplier: 1, kind: "" };

    const entry = {
      tokenId: t.tokenId,
      sceneId: t.sceneId,
      name: t.name,
      ok: t.ok,
      override: null,
      excluded: false,
      flatMod: 0,
      resMultiplier: res.multiplier,
      resKind: res.kind,
      dmg: 0,
      dmgColor: "",
    };

    if (t.ok) {
      _computeTargetView(entry, damageTotal, type, false);
      hitTargets.push(entry);
    } else {
      entry.dmg = 0;
      entry.dmgColor = "";
      missTargets.push(entry);
    }
  }

  const bg = "linear-gradient(135deg, rgb(156 2 2 / 92%) 0%, rgb(42 109 120 / 60%) 100%)";
  const dice = _buildDamageDiceRow(rolledDice, extraDice);

  const verticalMod = (rolledDice.length + extraDice.length) > 5;

  const data = {
    bg,
    damageTotal,
    damageType: type,
    damageTypeLabel: _damageTypeShort(type),
    dice,
    d8Svg: _dieSvgSrcGrey(8),
    modTotal,
    hasTargets: hitTargets.length > 0 || missTargets.length > 0,
    hitTargets,
    missTargets,
    halfToMissed: false,
    verticalMod,
  };

  const html = await renderTemplate(
    "systems/adm-daggerheart/templates/partials/result-damage.hbs",
    data
  );

  const flagsState = {
    damageFormula,
    damageType: type,
    isCrit: !!isCrit,
    modTotal,
    rollMods,
    rolledDice,
    extraDice,
    hitTargets,
    missTargets,
    halfToMissed: false,
  };

  const msg = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker(),
    content: html,
    flags: { "adm-daggerheart": { kind: "damageRoll", state: flagsState, bg } },
  });

  try { globalThis.__admLastDmgMsgIdV1 = msg?.id || null; } catch (_e) {}
  return msg;
}

// -------------------------
// Flags accessors
// -------------------------
function _getDmgFlagsState(message) {
  const f = message?.flags?.["adm-daggerheart"];
  if (f?.kind !== "damageRoll") return null;
  return f?.state || null;
}

function _findMessageFromEvent(ev) {
  const li = ev.target?.closest?.(".chat-message[data-message-id]");
  if (!li) return null;
  const id = li.dataset.messageId;
  return id ? game.messages?.get(id) : null;
}

// -------------------------
// Rerender damage message
// -------------------------
async function _rerenderDmgMessage(message, flagsState) {
  const s = flagsState ?? {};
  s.rolledDice ??= [];
  s.extraDice ??= [];
  s.hitTargets ??= [];
  s.missTargets ??= [];

  const type = String(s.damageType || "physical").trim().toLowerCase();

  _markActiveDice(s.rolledDice, s.extraDice, s.rollMods || "");
  const diceSum = s.rolledDice.reduce((sum, d) => sum + (d.active !== false ? (Number(d.value) || 0) : 0), 0);
  const modTotal = Math.trunc(Number(s.modTotal) || 0);
  const extraSum = _sumExtraDice(s.extraDice);
  const damageTotal = diceSum + modTotal + extraSum;

  for (const t of s.hitTargets) _computeTargetView(t, damageTotal, type, false, false);
  for (const t of s.missTargets) _computeTargetView(t, damageTotal, type, !!s.halfToMissed, true);

  const bg = "linear-gradient(135deg, rgb(156 2 2 / 92%) 0%, rgb(42 109 120 / 60%) 100%)";
  const dice = _buildDamageDiceRow(s.rolledDice, s.extraDice);

  const verticalMod = (s.rolledDice.length + s.extraDice.length) > 5;

  const data = {
    bg,
    damageTotal,
    damageType: type,
    damageTypeLabel: _damageTypeShort(type),
    dice,
    d8Svg: _dieSvgSrcGrey(8),
    modTotal,
    hasTargets: s.hitTargets.length > 0 || s.missTargets.length > 0,
    hitTargets: s.hitTargets,
    missTargets: s.missTargets,
    halfToMissed: !!s.halfToMissed,
    verticalMod,
  };

  const html = await renderTemplate(
    "systems/adm-daggerheart/templates/partials/result-damage.hbs",
    data
  );

  const nextState = { ...s, modTotal, damageType: type };

  await message.update({
    content: html,
    flags: {
      ...(message.flags || {}),
      "adm-daggerheart": {
        ...(message.flags?.["adm-daggerheart"] || {}),
        kind: "damageRoll",
        state: nextState,
        bg,
      },
    },
  });
}

// -------------------------
// Context menu (styled like roll mod menu)
// -------------------------
const __ADM_DMG_MENU_ID = "__admDmgCtxMenuV1";

function _closeDmgMenu() {
  const el = document.getElementById(__ADM_DMG_MENU_ID);
  if (el) el.remove();
  globalThis.__admDmgMenuOpenV1 = null;
}

function _openDmgMenu(anchorEl, items) {
  _closeDmgMenu();

  const rect = anchorEl.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.id = __ADM_DMG_MENU_ID;
  menu.className = "adm-rollmsg-modmenu";

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "adm-rollmsg-modmenu-item";
    btn.textContent = item.label;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      _closeDmgMenu();
      item.callback();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  const mrect = menu.getBoundingClientRect();
  const left = Math.round(rect.left + rect.width / 2 - mrect.width / 2);
  const top = Math.round(rect.top - mrect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  globalThis.__admDmgMenuOpenV1 = { anchor: anchorEl };

  const onDown = (ev) => {
    if (ev.target === menu || menu.contains(ev.target)) return;
    _closeDmgMenu();
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") {
      _closeDmgMenu();
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    }
  };
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey, true);
}

// -------------------------
// Mod menu (± dice, same style as roll messages)
// -------------------------
function _openModMenu(anchor, isNeg, callback) {
  _closeDmgMenu();

  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.id = __ADM_DMG_MENU_ID;
  menu.className = "adm-rollmsg-modmenu";

  const prefix = isNeg ? "-" : "+";
  const sidesArr = [4, 6, 8, 10, 12, 20];

  for (const sides of sidesArr) {
    const wrap = document.createElement("div");
    wrap.className = "adm-rollmsg-modmenu-itemwrap";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "adm-rollmsg-modmenu-item";
    btn.textContent = `${prefix}1d${sides}`;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      _closeDmgMenu();
      callback(sides, isNeg, 1);
    });
    wrap.appendChild(btn);

    const sub = document.createElement("div");
    sub.className = "adm-rollmsg-modmenu-sub";
    for (const count of [3, 2]) {
      const subBtn = document.createElement("button");
      subBtn.type = "button";
      subBtn.className = "adm-rollmsg-modmenu-item";
      subBtn.textContent = `${prefix}${count}d${sides}`;
      subBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        _closeDmgMenu();
        callback(sides, isNeg, count);
      });
      sub.appendChild(subBtn);
    }
    wrap.appendChild(sub);
    menu.appendChild(wrap);
  }

  document.body.appendChild(menu);

  const mrect = menu.getBoundingClientRect();
  const left = Math.round(rect.left + rect.width / 2 - mrect.width / 2);
  const top = Math.round(rect.top - mrect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  globalThis.__admDmgMenuOpenV1 = { anchor };

  const onDown = (ev) => {
    if (ev.target === menu || menu.contains(ev.target)) return;
    _closeDmgMenu();
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") {
      _closeDmgMenu();
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    }
  };
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey, true);
}

// -------------------------
// Target damage menu (×2, ÷2, 0, ±0 scroll, Сброс) — supports multi-select
// -------------------------
function _openTargetDmgMenu(anchorEl, message, state, targetTokenIds) {
  _closeDmgMenu();

  const rect = anchorEl.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.id = __ADM_DMG_MENU_ID;
  menu.className = "adm-rollmsg-modmenu";

  const allTargets = [...(state.hitTargets ?? []), ...(state.missTargets ?? [])];
  const selectedTargets = allTargets.filter(x => targetTokenIds.includes(x.tokenId));
  const refFlatMod = selectedTargets[0]?.flatMod || 0;

  const baseFlatMods = {};
  for (const t of selectedTargets) baseFlatMods[t.tokenId] = t.flatMod || 0;

  const overrideItems = [
    { label: "×2", action: "x2" },
    { label: "÷2", action: "half" },
    { label: "0", action: "zero" },
  ];

  for (const item of overrideItems) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "adm-rollmsg-modmenu-item";
    btn.textContent = item.label;
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      _closeDmgMenu();
      const st = foundry.utils.duplicate(_getDmgFlagsState(message) ?? state);
      for (const t of [...(st.hitTargets ?? []), ...(st.missTargets ?? [])]) {
        if (targetTokenIds.includes(t.tokenId)) t.override = item.action;
      }
      await _rerenderDmgMessage(message, st);
    });
    menu.appendChild(btn);
  }

  // ±0 scroll item
  const fmtFlat = (v) => v === 0 ? "±0" : (v > 0 ? `+${v}` : String(v));
  const btnFlat = document.createElement("button");
  btnFlat.type = "button";
  btnFlat.className = "adm-rollmsg-modmenu-item adm-dmgmenu-flat";
  btnFlat.textContent = fmtFlat(refFlatMod);

  let localFlatMod = refFlatMod;
  let debounceTimer = null;

  btnFlat.addEventListener("wheel", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const delta = ev.deltaY < 0 ? 1 : -1;
    localFlatMod += delta;
    btnFlat.textContent = fmtFlat(localFlatMod);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const freshState = _getDmgFlagsState(message);
      if (!freshState) return;
      const st = foundry.utils.duplicate(freshState);
      const globalDelta = localFlatMod - refFlatMod;
      for (const t of [...(st.hitTargets ?? []), ...(st.missTargets ?? [])]) {
        if (targetTokenIds.includes(t.tokenId)) {
          t.flatMod = (baseFlatMods[t.tokenId] ?? 0) + globalDelta;
        }
      }
      await _rerenderDmgMessage(message, st);
    }, 80);
  }, { passive: false });

  menu.appendChild(btnFlat);

  // Сброс
  const btnReset = document.createElement("button");
  btnReset.type = "button";
  btnReset.className = "adm-rollmsg-modmenu-item";
  btnReset.textContent = "Сброс";
  btnReset.addEventListener("click", async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    _closeDmgMenu();
    const st = foundry.utils.duplicate(_getDmgFlagsState(message) ?? state);
    for (const t of [...(st.hitTargets ?? []), ...(st.missTargets ?? [])]) {
      if (targetTokenIds.includes(t.tokenId)) {
        t.override = null;
        t.flatMod = 0;
      }
    }
    await _rerenderDmgMessage(message, st);
  });
  menu.appendChild(btnReset);

  document.body.appendChild(menu);

  const mrect = menu.getBoundingClientRect();
  const left = Math.round(rect.left + rect.width / 2 - mrect.width / 2);
  const top = Math.round(rect.top - mrect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  globalThis.__admDmgMenuOpenV1 = { anchor: anchorEl };

  const onDown = (ev) => {
    if (ev.target === menu || menu.contains(ev.target)) return;
    _closeDmgMenu();
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") {
      _closeDmgMenu();
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    }
  };
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey, true);
}

// -------------------------
// Pan to token helper
// -------------------------
async function _panToToken(tokenId, sceneId) {
  if (!canvas?.scene) return;
  if (sceneId && canvas.scene.id !== sceneId) {
    ui.notifications?.warn?.("Токен на другой сцене.");
    return;
  }
  const tok = canvas.tokens?.get(tokenId);
  if (!tok) return;
  const c = tok.center;
  await canvas.animatePan({ x: c.x, y: c.y, scale: 1.5 });
  tok.control({ releaseOthers: true });
}

// -------------------------
// Init: register all event handlers
// -------------------------
export function admDamageInit() {

  // --- Ctrl+click on target => toggle selection (must be first for stopImmediatePropagation) ---
  document.addEventListener("click", (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;

    const targetEl = ev.target?.closest?.(".adm-rollmsg--dmg .adm-dmg-target[data-token-id]");
    if (!targetEl) return;

    // Don't interfere with exclude cross
    if (ev.target?.closest?.("[data-adm-target-x]")) return;

    ev.preventDefault();
    ev.stopImmediatePropagation();

    targetEl.classList.toggle("is-selected");
  }, true);

  // --- Click outside targets => clear selection ---
  document.addEventListener("mousedown", (ev) => {
    if (ev.ctrlKey || ev.metaKey) return;

    const inTargets = ev.target?.closest?.(".adm-rollmsg--dmg .adm-dmg-targets");
    if (inTargets) return;

    document.querySelectorAll(".adm-dmg-target.is-selected").forEach(el => el.classList.remove("is-selected"));
  }, false);

  // --- LMB on die => reroll ---
  document.addEventListener("click", async (ev) => {
    const dieEl = ev.target?.closest?.(".adm-rollmsg--dmg .adm-rollmsg-die[data-die-id]");
    if (!dieEl) return;

    const message = _findMessageFromEvent(ev);
    if (!message) return;

    const state = _getDmgFlagsState(message);
    if (!state) return;

    const dieId = String(dieEl.dataset.dieId || "");
    if (!dieId) return;

    const ok = await _confirm("Перебросить", "<p>Перебросить кубик?</p>");
    if (!ok) return;

    const st = foundry.utils.duplicate(state);

    const rIdx = st.rolledDice.findIndex(d => String(d.id) === dieId);
    if (rIdx >= 0) {
      const d = st.rolledDice[rIdx];
      d.value = await _rollDieWithDsn(d.sides);
      st.rolledDice[rIdx] = d;
      await _rerenderDmgMessage(message, st);
      return;
    }

    const eIdx = (st.extraDice ?? []).findIndex(d => String(d.id) === dieId);
    if (eIdx >= 0) {
      const d = st.extraDice[eIdx];
      d.value = await _rollDieWithDsn(d.sides);
      st.extraDice[eIdx] = d;
      await _rerenderDmgMessage(message, st);
      return;
    }
  }, true);

  // --- RMB on die => delete ---
  document.addEventListener("contextmenu", async (ev) => {
    const dieEl = ev.target?.closest?.(".adm-rollmsg--dmg .adm-rollmsg-die[data-die-id]");
    if (!dieEl) return;

    const message = _findMessageFromEvent(ev);
    if (!message) return;

    const state = _getDmgFlagsState(message);
    if (!state) return;

    const dieId = String(dieEl.dataset.dieId || "");
    if (!dieId) return;

    ev.preventDefault();
    ev.stopPropagation();

    const ok = await _confirm("Удалить", "<p>Удалить кубик?</p>");
    if (!ok) return;

    const st = foundry.utils.duplicate(state);

    const rIdx = st.rolledDice.findIndex(d => String(d.id) === dieId);
    if (rIdx >= 0) {
      st.rolledDice.splice(rIdx, 1);
      await _rerenderDmgMessage(message, st);
      return;
    }

    const eIdx = (st.extraDice ?? []).findIndex(d => String(d.id) === dieId);
    if (eIdx >= 0) {
      st.extraDice.splice(eIdx, 1);
      await _rerenderDmgMessage(message, st);
      return;
    }
  }, true);

  // --- Mod input: Enter => eval ---
  document.addEventListener("keydown", async (ev) => {
    if (ev.key !== "Enter") return;
    const inp = ev.target?.closest?.(".adm-rollmsg--dmg input.adm-rollmsg-modinput[data-adm-modinput]");
    if (!inp) return;

    ev.preventDefault();

    const message = _findMessageFromEvent(ev);
    if (!message) return;

    const state = _getDmgFlagsState(message);
    if (!state) return;

    const current = Math.trunc(Number(state.modTotal) || 0);
    const next = _evalMathExpr(inp.value, current);

    const st = foundry.utils.duplicate(state);
    st.modTotal = next;
    inp.value = String(next);

    await _rerenderDmgMessage(message, st);
  }, true);

  // --- Mod input: blur => eval ---
  document.addEventListener("blur", async (ev) => {
    const inp = ev.target?.closest?.(".adm-rollmsg--dmg input.adm-rollmsg-modinput[data-adm-modinput]");
    if (!inp) return;

    const message = _findMessageFromEvent(ev);
    if (!message) return;

    const state = _getDmgFlagsState(message);
    if (!state) return;

    const current = Math.trunc(Number(state.modTotal) || 0);
    const next = _evalMathExpr(inp.value, current);

    const st = foundry.utils.duplicate(state);
    st.modTotal = next;
    inp.value = String(next);

    await _rerenderDmgMessage(message, st);
  }, true);

  // --- LMB on ± button => +dice menu ---
  document.addEventListener("click", async (ev) => {
    const btn = ev.target?.closest?.(".adm-rollmsg--dmg .adm-rollmsg-modbtn[data-adm-modbtn]");
    if (!btn) return;

    const message = _findMessageFromEvent(ev);
    if (!message) return;

    const state = _getDmgFlagsState(message);
    if (!state) return;

    ev.preventDefault();
    ev.stopPropagation();

    _openModMenu(btn, false, async (sides, isNeg, count) => {
      const st = foundry.utils.duplicate(state);
      st.extraDice ??= [];

      for (let i = 0; i < (count || 1); i++) {
        const id = `mod-${Date.now()}-${Math.floor(Math.random() * 1e9)}-${i}`;
        const value = await _rollDieWithDsn(sides);
        st.extraDice.push({ id, sides, value, isNeg: !!isNeg });
      }
      await _rerenderDmgMessage(message, st);
    });
  }, true);

  // --- RMB on ± button => -dice menu ---
  document.addEventListener("contextmenu", async (ev) => {
    const btn = ev.target?.closest?.(".adm-rollmsg--dmg .adm-rollmsg-modbtn[data-adm-modbtn]");
    if (!btn) return;

    const message = _findMessageFromEvent(ev);
    if (!message) return;

    const state = _getDmgFlagsState(message);
    if (!state) return;

    ev.preventDefault();
    ev.stopPropagation();

    _openModMenu(btn, true, async (sides, isNeg, count) => {
      const st = foundry.utils.duplicate(state);
      st.extraDice ??= [];

      for (let i = 0; i < (count || 1); i++) {
        const id = `mod-${Date.now()}-${Math.floor(Math.random() * 1e9)}-${i}`;
        const value = await _rollDieWithDsn(sides);
        st.extraDice.push({ id, sides, value, isNeg: !!isNeg });
      }
      await _rerenderDmgMessage(message, st);
    });
  }, true);

  // --- RMB on damage header => change type menu ---
  document.addEventListener("contextmenu", async (ev) => {
    const el = ev.target?.closest?.(".adm-rollmsg--dmg .adm-dmg-header[data-adm-dmg-header]");
    if (!el) return;

    const message = _findMessageFromEvent(ev);
    if (!message) return;

    const state = _getDmgFlagsState(message);
    if (!state) return;

    ev.preventDefault();
    ev.stopPropagation();

    _openDmgMenu(el, [
      { label: "Физический", callback: async () => {
        const st = foundry.utils.duplicate(state);
        st.damageType = "physical";
        for (const t of (st.hitTargets ?? [])) { t.override = null; }
        for (const t of (st.missTargets ?? [])) { t.override = null; }
        await _rerenderDmgMessage(message, st);
      }},
      { label: "Магический", callback: async () => {
        const st = foundry.utils.duplicate(state);
        st.damageType = "magical";
        for (const t of (st.hitTargets ?? [])) { t.override = null; }
        for (const t of (st.missTargets ?? [])) { t.override = null; }
        await _rerenderDmgMessage(message, st);
      }},
      { label: "Прямой", callback: async () => {
        const st = foundry.utils.duplicate(state);
        st.damageType = "direct";
        for (const t of (st.hitTargets ?? [])) { t.override = null; }
        for (const t of (st.missTargets ?? [])) { t.override = null; }
        await _rerenderDmgMessage(message, st);
      }},
    ]);
  }, true);

  // --- RMB on target damage => override menu (supports multi-select) ---
  document.addEventListener("contextmenu", async (ev) => {
    const el = ev.target?.closest?.(".adm-rollmsg--dmg .adm-dmg-target-dmg[data-adm-target-dmg]");
    if (!el) return;

    const message = _findMessageFromEvent(ev);
    if (!message) return;

    const state = _getDmgFlagsState(message);
    if (!state) return;

    ev.preventDefault();
    ev.stopPropagation();

    const targetEl = el.closest(".adm-dmg-target[data-token-id]");
    if (!targetEl) return;

    const tokenId = targetEl.dataset.tokenId;

    // Multi-select: if this target is selected, apply to all selected
    let targetTokenIds;
    if (targetEl.classList.contains("is-selected")) {
      const msgEl = el.closest(".chat-message[data-message-id]");
      const selectedEls = msgEl?.querySelectorAll(".adm-dmg-target.is-selected[data-token-id]") ?? [];
      targetTokenIds = [...selectedEls].map(e => e.dataset.tokenId);
    } else {
      targetTokenIds = [tokenId];
    }

    _openTargetDmgMenu(el, message, state, targetTokenIds);
  }, true);

  // --- LMB on target name => pan to token ---
  document.addEventListener("click", async (ev) => {
    const el = ev.target?.closest?.(".adm-rollmsg--dmg .adm-dmg-target-name[data-adm-dmg-target-name]");
    if (!el) return;

    const targetEl = el.closest(".adm-dmg-target[data-token-id]");
    if (!targetEl) return;

    ev.preventDefault();
    ev.stopPropagation();

    await _panToToken(targetEl.dataset.tokenId, targetEl.dataset.sceneId);
  }, true);

  // --- LMB on exclude cross => toggle ---
  document.addEventListener("click", async (ev) => {
    const el = ev.target?.closest?.(".adm-rollmsg--dmg .adm-dmg-target-x[data-adm-target-x]");
    if (!el) return;

    const message = _findMessageFromEvent(ev);
    if (!message) return;

    const state = _getDmgFlagsState(message);
    if (!state) return;

    const targetEl = el.closest(".adm-dmg-target[data-token-id]");
    if (!targetEl) return;

    ev.preventDefault();
    ev.stopPropagation();

    const tokenId = targetEl.dataset.tokenId;
    const st = foundry.utils.duplicate(state);
    const t = [...(st.hitTargets ?? []), ...(st.missTargets ?? [])].find(x => x.tokenId === tokenId);
    if (t) t.excluded = !t.excluded;
    await _rerenderDmgMessage(message, st);
  }, true);

  // --- ½ урона чекбокс ---
  document.addEventListener("click", async (ev) => {
    const wrap = ev.target?.closest?.(".adm-rollmsg--dmg .adm-dmg-half-toggle[data-adm-dmg-half-toggle]");
    if (!wrap) return;

    const message = _findMessageFromEvent(ev);
    if (!message) return;

    const state = _getDmgFlagsState(message);
    if (!state) return;

    ev.preventDefault();
    ev.stopPropagation();

    const st = foundry.utils.duplicate(state);
    st.halfToMissed = !st.halfToMissed;
    await _rerenderDmgMessage(message, st);
  }, true);

  // --- Добавление новых таргетов (hook) ---
  Hooks.on?.("targetToken", (_user, _token, _targeted) => {
    try {
      if (!_user || _user.id !== game.user.id) return;
      _refreshLastDmgTargets();
    } catch (_e) {}
  });
}

// -------------------------
// Refresh targets in latest damage message
// -------------------------
async function _refreshLastDmgTargets() {
  const msgId = globalThis.__admLastDmgMsgIdV1;
  if (!msgId) return;

  const msg = game.messages?.get(msgId);
  if (!msg) return;

  const state = _getDmgFlagsState(msg);
  if (!state) return;

  const set = game?.user?.targets;
  if (!set) return;

  const st = foundry.utils.duplicate(state);
  const type = String(st.damageType || "physical").trim().toLowerCase();

  const existingIds = new Set([
    ...(st.hitTargets ?? []).map(t => t.tokenId),
    ...(st.missTargets ?? []).map(t => t.tokenId),
  ]);

  const diceSum = (st.rolledDice ?? []).reduce((s, d) => s + (Number(d.value) || 0), 0);
  const modTotal = Math.trunc(Number(st.modTotal) || 0);
  const extraSum = _sumExtraDice(st.extraDice ?? []);
  const damageTotal = diceSum + modTotal + extraSum;

  let added = false;
  for (const t of set) {
    const token = t?.object ?? t;
    const id = token?.id;
    if (!id || existingIds.has(String(id))) continue;

    const sceneId = token?.scene?.id ?? canvas?.scene?.id ?? "";
    const name = token?.name ?? token?.document?.name ?? "—";
    const res = _getTokenResilience(token, type);

    const entry = {
      tokenId: String(id),
      sceneId: String(sceneId),
      name: String(name),
      ok: true,
      override: null,
      excluded: false,
      flatMod: 0,
      resMultiplier: res.multiplier,
      resKind: res.kind,
      dmg: Math.max(0, Math.ceil(damageTotal * res.multiplier)),
      dmgColor: _dmgColorClass(res.kind),
    };

    st.hitTargets.push(entry);
    added = true;
  }

  if (added) await _rerenderDmgMessage(msg, st);
}

// -------------------------
// Safe math evaluator
// -------------------------
function _evalMathExpr(expr, fallback = 0) {
  const raw = String(expr ?? "").trim();
  if (!raw) return fallback;

  const s = raw.replace(/\s+/g, "");
  if (!/^[0-9+\-*/().]+$/.test(s)) return fallback;

  try {
    const n = Function(`"use strict"; return (${s});`)();
    if (!Number.isFinite(n)) return fallback;
    return Math.trunc(n);
  } catch (_e) {
    return fallback;
  }
}
