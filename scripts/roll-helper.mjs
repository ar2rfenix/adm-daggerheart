// systems/adm-daggerheart/scripts/roll-helper.mjs
// Логика броска + подготовка данных для чат-шаблонов result-*.hbs
// Интерактив: переброс/удаление кубов, модификатор с математикой, меню ± костей, блок целей (targets)

import { admDamageRollToChat } from "./damage-helper.mjs";

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

  // fallback: локализованное значение из конфига, если есть
  try {
    const map = CONFIG.ADM_DAGGERHEART?.weapon?.damageTypes ?? {};
    return String(map[k] || k);
  } catch (_e) {
    return String(k || "");
  }
}
function _formatDamageFormulaForUi(formula, actor) {
  const raw = String(formula || "").trim();
  if (!raw) return "";

  const mastery = Math.max(0, Math.trunc(Number(actor?.system?.mastery ?? 0) || 0));
  if (mastery <= 0) return raw;

  // d6+3  -> 4d6+3
  // 1d6+3 -> 4d6+3
  // 2d6+3 -> не трогаем
  // 10d6+3 -> не трогаем
  let s = raw;

  // сначала "dX..." (без ведущего числа)
  s = s.replace(/^\s*d(\d+)\b/i, `${mastery}d$1`);

  // затем "1dX..."
  s = s.replace(/^\s*1d(\d+)\b/i, `${mastery}d$1`);

  return s.trim();
}


// -------------------------
// Utils
// -------------------------
function _loc(keyOrText) {
  if (!keyOrText) return "";
  const s = String(keyOrText);
  try {
    const loc = game?.i18n?.localize?.(s);
    if (loc && loc !== s) return loc;
  } catch (_e) {}
  return s;
}

function _signed(n) {
  const x = Number(n) || 0;
  return x >= 0 ? `+${x}` : `${x}`;
}

function _sumActiveExp(exps) {
  let sum = 0;
  for (const e of exps || []) {
    if (e?.active) sum += Number(e.value || 0);
  }
  return sum;
}

function _listActiveExp(exps) {
  const out = [];
  for (const e of exps || []) {
    if (!e?.active) continue;
    const name = String(e.name || e.label || e.title || "").trim();
    const v = Number(e.value || 0) || 0;
    out.push({ name: name || "Опыт", value: v, signed: _signed(v) });
  }
  return out;
}

function _formatUsedExpsText(exps) {
  const used = _listActiveExp(exps);
  if (!used.length) return "";
  return `Опыт: ${used.map(e => `${e.name} (${e.signed})`).join(", ")}`;
}

function _getTraitLabel(traitKey) {
  const k = String(traitKey || "").trim().toLowerCase();
  const map = CONFIG.ADM_DAGGERHEART?.traits ?? {};
  return _loc(map[k] || k) || k;
}

function _getTraitValue(actor, traitKey) {
  const k = String(traitKey || "").trim().toLowerCase();
  const v = Number(actor?.system?.traits?.[k]?.value ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function _clampInt(n, min, max) {
  const x = Math.trunc(Number(n ?? 0) || 0);
  return Math.max(min, Math.min(max, x));
}

async function _rollDie(sides) {
  const n = Math.max(2, Math.trunc(Number(sides) || 12));
  const r = await new Roll(`1d${n}`).evaluate();
  return Number(r.total) || 0;
}

// -------------------------
// Crit damage: add max dice value to the modifier
// "3d6+3" => "3d6+21" (max 3d6=18, 18+3=21)
// "2d8"   => "2d8+16" (max 2d8=16)
// -------------------------
function _critDamageFormula(formula) {
  const raw = String(formula || "").trim();
  if (!raw) return raw;

  // Собираем максимум всех NdS частей
  let maxDice = 0;
  const diceRe = /(\d*)d(\d+)/gi;
  let m;
  while ((m = diceRe.exec(raw)) !== null) {
    const count = Math.max(1, parseInt(m[1], 10) || 1);
    const sides = parseInt(m[2], 10) || 0;
    maxDice += count * sides;
  }

  if (maxDice <= 0) return raw;

  // Ищем завершающий числовой модификатор: "+3", "-2" и т.д.
  const trailingMod = raw.match(/([+-]\s*\d+)\s*$/);
  if (trailingMod) {
    const modVal = parseInt(trailingMod[1].replace(/\s+/g, ""), 10) || 0;
    const newMod = modVal + maxDice;
    const prefix = raw.slice(0, trailingMod.index);
    return `${prefix}+${newMod}`;
  }

  // Нет модификатора — просто добавляем
  return `${raw}+${maxDice}`;
}

// -------------------------
// Dice So Nice integration
// -------------------------
const _DSN_HOPE_APPEARANCE = {
  colorset: "custom",
  foreground: "#ffffff",
  background: "#ffa200",
  outline: "#000000",
  edge: "#ff8000",
  texture: "ice",
  material: "glass",
  font: "Arial",
  system: "standard",
};

const _DSN_FEAR_APPEARANCE = {
  colorset: "custom",
  foreground: "#b5d5ff",
  background: "#021280",
  outline: "#000000",
  edge: "#210e6b",
  texture: "ice",
  material: "metal",
  font: "Arial",
  system: "standard",
};

async function _rollDieWithDsn(sides, appearance) {
  const n = Math.max(2, Math.trunc(Number(sides) || 12));
  const roll = new Roll(`1d${n}`);
  await roll.evaluate();
  const value = Number(roll.total) || 0;

  if (game.dice3d) {
    try {
      if (appearance) roll.dice[0].options.appearance = appearance;
      await game.dice3d.showForRoll(roll, game.user, true);
    } catch (_e) {}
  }

  return value;
}

function _bgForDuality(hopeVal, fearVal, isReaction = false) {
  if (isReaction) {
    return "linear-gradient(135deg, rgb(40 37 32 / 80%) 0%, rgb(207 207 207) 100%)";
  }
  if (Number(hopeVal) === Number(fearVal)) {
    return "linear-gradient(135deg, rgb(61, 131, 125) 0%, rgb(58 120 52) 100%)";
  }
  if (Number(fearVal) > Number(hopeVal)) {
    return "linear-gradient(135deg, rgba(30, 24, 77, 0.8) 0%, rgba(63, 81, 181, 0.6) 100%)";
  }
  return "linear-gradient(135deg, rgba(96, 69, 20, 0.8) 0%, rgb(206, 134, 41) 100%)";
}

function _bgForNpcRoll(isCrit = false, isReaction = false) {
  // реакция — серый (как у PC)
  if (isReaction) {
    return "linear-gradient(135deg, rgb(40 37 32 / 80%) 0%, rgb(207 207 207) 100%)";
  }

  // крит — зелёный (как у PC)
  if (isCrit) {
    return "linear-gradient(135deg, rgb(61, 131, 125) 0%, rgb(58 120 52) 100%)";
  }

  // иначе — всегда как при страхе (синий)
  return "linear-gradient(135deg, rgba(30, 24, 77, 0.8) 0%, rgba(63, 81, 181, 0.6) 100%)";
}

function _resultLabelForDuality(hopeVal, fearVal, isReaction = false) {
  if (isReaction) return "Реакция";
  if (Number(hopeVal) === Number(fearVal)) return "Крит";
  if (Number(fearVal) > Number(hopeVal)) return "Страх";
  return "Надежда";
}

function _speakerForActor(actor) {
  try {
    return ChatMessage.getSpeaker({ actor });
  } catch (_e) {
    return { alias: actor?.name || "—" };
  }
}

// -------------------------
// Дуальность -> ресурсы (Надежда/Стресс/Страх)
// Правила:
// - Надежда > Страх: Персонаж Надежда +1
// - Страх > Надежда: Глобальный Страх +1
// - Крит (равны): Персонаж Надежда +1, Стресс -1
// - Реакция: не применяем
// - При рероле: откатываем старый исход (реальными дельтами), применяем новый
// -------------------------

let __socket = null;

Hooks.once?.("socketlib.ready", () => {
  try {
 __socket =
  globalThis.socketlib?.registerSystem?.("adm-daggerheart") ??
  globalThis.socketlib?.registerModule?.("adm-daggerheart") ??
  null;

  } catch (_e) {
    __socket = null;
  }

  try {
    if (__socket?.register) {
      __socket.register("gmApplyActorDelta", _gmApplyActorDelta);
      __socket.register("gmApplyGlobalFearDelta", _gmApplyGlobalFearDelta);
    }
  } catch (_e) {}
});

function _getOutcome(hopeVal, fearVal, isReaction) {
  if (isReaction) return null;
  if (Number(hopeVal) === Number(fearVal)) return "crit";
  return Number(hopeVal) > Number(fearVal) ? "hope" : "fear";
}

function _buildEffectsVM(applied) {
  // applied: { outcome, hopeDelta, stressDelta, fearDelta }
  const a = applied || { hopeDelta: 0, stressDelta: 0, fearDelta: 0 };

  const hope = Math.trunc(Number(a.hopeDelta) || 0);
  const stress = Math.trunc(Number(a.stressDelta) || 0); // ожидается -1 или 0
  const fear = Math.trunc(Number(a.fearDelta) || 0);

  const lines = [];

  // Желтый (#d7ac5e)
  // варианты:
  // - "Получает 1 Надежду!"
  // - "Снимает 1 Стресс!"
  // - "Получает 1 Надежду и снимает 1 Стресс!"
  if (hope === 1 && stress === -1) {
    lines.push({ text: "Получает 1 Надежду и снимает 1 Стресс!", color: "#d7ac5e" });
  } else if (hope === 1) {
    lines.push({ text: "Получает 1 Надежду!", color: "#d7ac5e" });
  } else if (stress === -1) {
    lines.push({ text: "Снимает 1 Стресс!", color: "#d7ac5e" });
  }

  // Красный (#ca4e4e)
  if (fear === 1) {
    lines.push({ text: "Создаёт 1 Страх!", color: "#ca4e4e" });
  }

  return {
    hasEffects: lines.length > 0,
    effects: lines,
  };
}

// --- GM-side: apply delta to actor resource ---
async function _gmApplyActorDelta(actorUuid, pathValue, pathMax, delta) {
  const uuid = String(actorUuid || "").trim();
  if (!uuid) return 0;

  const d = Math.trunc(Number(delta) || 0);
  if (!d) return 0;

  const actor = await fromUuid(uuid);
  if (!actor) return 0;

  const cur = Number(foundry.utils.getProperty(actor, pathValue) ?? 0) || 0;
  const max = Number(foundry.utils.getProperty(actor, pathMax) ?? 0) || 0;

  const min = 0;
  let next = cur + d;
  if (max > 0) next = _clampInt(next, min, max);
  else next = Math.max(min, next);

  const applied = next - cur;
  if (!applied) return 0;

  const upd = {};
  foundry.utils.setProperty(upd, pathValue, next);
  await actor.update(upd);

  return applied;
}

// --- GM-side: apply delta to global fear (world setting) ---
async function _gmApplyGlobalFearDelta(delta) {
  const d = Math.trunc(Number(delta) || 0);
  if (!d) return 0;

  const cur = Number(game.settings.get("daggerheart", "fear") ?? 0) || 0;
  const homebrew = game.settings.get("daggerheart", "homebrew") ?? {};
  const max = Number(homebrew?.maxFear ?? 12) || 12;

  const next = _clampInt(cur + d, 0, max);
  const applied = next - cur;
  if (!applied) return 0;

  await game.settings.set("daggerheart", "fear", next);
  return applied;
}

async function _applyActorDeltaGM(actorUuid, pathValue, pathMax, delta) {
  const isGM = !!game.user?.isGM;
  if (isGM) return _gmApplyActorDelta(actorUuid, pathValue, pathMax, delta);

  if (__socket?.executeAsGM) {
    return __socket.executeAsGM("gmApplyActorDelta", actorUuid, pathValue, pathMax, delta);
  }

  ui?.notifications?.error?.("SocketLib не готов. Нужен GM для изменения ресурсов.");
  return 0;
}

async function _applyGlobalFearDeltaGM(delta) {
  const isGM = !!game.user?.isGM;
  if (isGM) return _gmApplyGlobalFearDelta(delta);

  if (__socket?.executeAsGM) {
    return __socket.executeAsGM("gmApplyGlobalFearDelta", delta);
  }

  ui?.notifications?.error?.("SocketLib не готов. Нужен GM для изменения Страха.");
  return 0;
}

async function _reconcileDualityEffects(actorUuid, prevApplied, nextOutcome) {
  const prev = prevApplied || { outcome: null, hopeDelta: 0, stressDelta: 0, fearDelta: 0 };

  // одинаковый исход -> не трогаем ресурсы, но эффекты UI должны соответствовать текущему applied (т.е. нулевые)
  if (prev.outcome === nextOutcome) {
    // важно: если кликнули рерол, но исход не сменился, ресурсы не меняются,
    // и мы НЕ хотим повторно писать "Получает..." => возвращаем prev как есть.
    return prev;
  }

  const uuid = String(actorUuid || "").trim();

  // 1) откат предыдущего (реальными дельтами)
  if (prev.hopeDelta) {
    await _applyActorDeltaGM(uuid, "system.resources.hope.value", "system.resources.hope.max", -prev.hopeDelta);
  }
  if (prev.stressDelta) {
    await _applyActorDeltaGM(uuid, "system.resources.stress.value", "system.resources.stress.max", -prev.stressDelta);
  }
  if (prev.fearDelta) {
    await _applyGlobalFearDeltaGM(-prev.fearDelta);
  }

  // 2) применить новый
  const applied = { outcome: nextOutcome, hopeDelta: 0, stressDelta: 0, fearDelta: 0 };

  if (!nextOutcome) return applied; // реакция / null

  if (nextOutcome === "hope") {
    applied.hopeDelta = await _applyActorDeltaGM(uuid, "system.resources.hope.value", "system.resources.hope.max", +1);
    return applied;
  }

  if (nextOutcome === "fear") {
    applied.fearDelta = await _applyGlobalFearDeltaGM(+1);
    return applied;
  }

  if (nextOutcome === "crit") {
    applied.hopeDelta = await _applyActorDeltaGM(uuid, "system.resources.hope.value", "system.resources.hope.max", +1);
    applied.stressDelta = await _applyActorDeltaGM(uuid, "system.resources.stress.value", "system.resources.stress.max", -1);
    return applied;
  }

  return applied;
}

// -------------------------
// Edge pool (adv/dis)
// -------------------------
async function _rollEdgePool(netCount) {
  const n = Math.max(0, Math.trunc(Number(netCount) || 0));
  const rolls = [];
  let best = 0;
  for (let i = 0; i < n; i++) {
    const v = await _rollDie(6);
    rolls.push(v);
    if (v > best) best = v;
  }
  return { rolls, best };
}

async function _rollEdgePoolWithDsn(netCount) {
  const n = Math.max(0, Math.trunc(Number(netCount) || 0));
  if (n <= 0) return { rolls: [], best: 0 };
  const roll = new Roll(`${n}d6`);
  await roll.evaluate();
  const rolls = roll.dice[0].results.map(r => r.result);
  const best = Math.max(...rolls);
  if (game.dice3d) {
    try { await game.dice3d.showForRoll(roll, game.user, true); } catch (_e) {}
  }
  return { rolls, best };
}

async function _rollEdge(advCount, disCount) {
  const adv = Math.max(0, Math.trunc(Number(advCount) || 0));
  const dis = Math.max(0, Math.trunc(Number(disCount) || 0));
  const net = Math.abs(adv - dis);

  if (net <= 0) {
    return { used: false, isAdv: false, net: 0, rolls: [], best: 0, value: 0 };
  }

  const isAdv = adv > dis;
  const pool = await _rollEdgePool(net);
  const value = isAdv ? pool.best : -pool.best;

  return { used: true, isAdv, net, rolls: pool.rolls, best: pool.best, value };
}

// -------------------------
// Safe math for mod input: digits + - * / ( ) and spaces
// -------------------------
function _evalMathExpr(expr, fallback = 0) {
  const raw = String(expr ?? "").trim();
  if (!raw) return fallback;

  const s = raw.replace(/\s+/g, "");
  if (!/^[0-9+\-*/()]+$/.test(s)) return fallback;

  let bal = 0;
  for (const ch of s) {
    if (ch === "(") bal++;
    else if (ch === ")") { bal--; if (bal < 0) return fallback; }
  }
  if (bal !== 0) return fallback;

  const tokens = [];
  for (let i = 0; i < s.length; ) {
    const c = s[i];

    if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < s.length && s[j] >= "0" && s[j] <= "9") j++;
      tokens.push({ t: "num", v: Number(s.slice(i, j)) });
      i = j;
      continue;
    }

    if ("+-*/()".includes(c)) {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }

    return fallback;
  }

  const out = [];
  const ops = [];
  const prec = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const isOp = (x) => x && x.t === "op" && "+-*/".includes(x.v);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.t === "num") { out.push(tok); continue; }

    const v = tok.v;

    if (v === "(") { ops.push(tok); continue; }
    if (v === ")") {
      while (ops.length && ops[ops.length - 1].v !== "(") out.push(ops.pop());
      if (!ops.length) return fallback;
      ops.pop();
      continue;
    }

    if (v === "+" || v === "-") {
      const prev = tokens[i - 1];
      const unary = !prev || (prev.t === "op" && (prev.v === "(" || "+-*/".includes(prev.v)));
      if (unary) out.push({ t: "num", v: 0 });
    }

    while (ops.length && isOp(ops[ops.length - 1]) && prec[ops[ops.length - 1].v] >= prec[v]) {
      out.push(ops.pop());
    }
    ops.push(tok);
  }

  while (ops.length) {
    const top = ops.pop();
    if (top.v === "(" || top.v === ")") return fallback;
    out.push(top);
  }

  const st = [];
  for (const tok of out) {
    if (tok.t === "num") { st.push(tok.v); continue; }

    const op = tok.v;
    const b = st.pop();
    const a = st.pop();
    if (a === undefined || b === undefined) return fallback;

    let r = 0;
    if (op === "+") r = a + b;
    else if (op === "-") r = a - b;
    else if (op === "*") r = a * b;
    else if (op === "/") {
      if (b === 0) return fallback;
      r = a / b;
    } else return fallback;

    if (!Number.isFinite(r)) return fallback;
    st.push(r);
  }

  if (st.length !== 1) return fallback;
  const res = Math.trunc(st[0]);
  return Number.isFinite(res) ? res : fallback;
}
function _dieScaleForSides(sides) {
  const n = Math.max(2, Math.trunc(Number(sides) || 12));

  // Подогнано под Foundry icons/svg/dX-grey.svg
  // Цель: одинаковый визуальный “калибр” в 28x28
  const MAP = {
    4:  1.01,
    6:  1.08,
    8:  1.0,
    10: 1.00,
    12: 0.98,
    20: 1.08,
  };

  return MAP[n] ?? 1.0;
}

// -------------------------
// Dice row builder (for template)
// -------------------------
function _buildPcDiceRow({ hopeSides, hopeVal, fearSides, fearVal, edge, extraDice }) {
const dice = [
  { id: "hope", kind: "hope", sides: hopeSides, scale: _dieScaleForSides(hopeSides), value: hopeVal, text: String(hopeVal), svg: _dieSvgSrcGrey(hopeSides), isNeg: false },
  { id: "fear", kind: "fear", sides: fearSides, scale: _dieScaleForSides(fearSides), value: fearVal, text: String(fearVal), svg: _dieSvgSrcGrey(fearSides), isNeg: false },
];


  if (edge?.used) {
    const best = Math.max(0, Math.trunc(Number(edge.best) || 0));
dice.push({
  id: "edge",
  kind: "edge",
  sides: 6,
  scale: _dieScaleForSides(6),
  value: best,
  text: String(best),
  isAdv: !!edge.isAdv,
  svg: _dieSvgSrcGrey(6),
  isNeg: !edge.isAdv,
});
  }

  for (const d of (extraDice || [])) {
    const sides = Math.max(2, Math.trunc(Number(d.sides) || 6));
    const value = Math.max(0, Math.trunc(Number(d.value) || 0));
    const isNeg = !!d.isNeg;

dice.push({
  id: String(d.id),
  kind: "mod",
  sides,
  scale: _dieScaleForSides(sides),
  value,
  text: String(value),
  svg: _dieSvgSrcGrey(sides),
  isNeg,
});


  }

  return dice;
}
function _buildNpcDiceRow({ mainVal, modeVal, mode, extraDice }) {
  const dice = [];

  // основной d20 (серый) — НЕ удаляем
dice.push({
  id: "d20-main",
  kind: "npc-main",
  sides: 20,
  scale: _dieScaleForSides(20),
  value: (mainVal === null ? null : Math.max(0, Math.trunc(Number(mainVal) || 0))),
  text:  (mainVal === null ? "—"  : String(Math.max(0, Math.trunc(Number(mainVal) || 0)))),

  svg: _dieSvgSrcGrey(20),
  isNeg: false,
  isAdv: false,
});



  // второй d20: при преимуществе — зелёный (kind=mod), при помехе — красный (kind=mod + isNeg)
  if (mode === "advantage" || mode === "disadvantage") {
dice.push({
  id: "d20-mode",
  kind: "npc-mode",
  sides: 20,
  scale: _dieScaleForSides(20),
  value: (modeVal === null ? null : Math.max(0, Math.trunc(Number(modeVal) || 0))),
  text:  (modeVal === null ? "—"  : String(Math.max(0, Math.trunc(Number(modeVal) || 0)))),

  svg: _dieSvgSrcGrey(20),
  isNeg: mode === "disadvantage",
  isAdv: mode === "advantage",
});


  }

  // дополнительные кубы ± (оставляем как есть)
  for (const d of (extraDice || [])) {
    const sides = Math.max(2, Math.trunc(Number(d.sides) || 6));
    const value = Math.max(0, Math.trunc(Number(d.value) || 0));
    const isNeg = !!d.isNeg;

    dice.push({
      id: String(d.id),
      kind: "mod",
      sides,
      scale: _dieScaleForSides(sides),
      value,
      text: String(value),
      svg: _dieSvgSrcGrey(sides),
      isNeg,
    });
  }

  return dice;
}

function _sumExtraDice(extraDice) {
  let s = 0;
  for (const d of extraDice || []) {
    const v = Math.max(0, Math.trunc(Number(d.value) || 0));
    s += d.isNeg ? -v : v;
  }
  return s;
}

// -------------------------
// Targets block
// -------------------------
function _getTokenDodge(token) {
  try {
    const a = token?.actor;
    const v = foundry.utils.getProperty(a, "system.resources.dodge.value");
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  } catch (_e) {
    return 0;
  }
}

function _collectTargetsForUi(total, isCrit) {
  const set = game?.user?.targets;
  if (!set || !set.size) return [];

  const out = [];
  for (const t of set) {
    const token = t?.object ?? t;
    const id = token?.id;
    const sceneId = token?.scene?.id ?? canvas?.scene?.id ?? "";
    const name = token?.name ?? token?.document?.name ?? "—";
    if (!id) continue;

    const dodge = _getTokenDodge(token);
    const ok = !!isCrit || (Number(total) >= Number(dodge));

    out.push({
      tokenId: String(id),
      sceneId: String(sceneId),
      name: String(name),
      dodge: dodge,
      ok: ok,
      cls: ok ? "is-hit" : "is-miss",
    });
  }

  out.sort((a, b) => a.name.localeCompare(String(b.name || ""), "ru"));
  return out;
}

// -------------------------
// Message helpers
// -------------------------
function _findMessageFromEvent(ev) {
  const msgEl = ev.target?.closest?.(".chat-message");
  const mid = msgEl?.dataset?.messageId;
  if (!mid) return null;
  return game.messages?.get(mid) || null;
}

function _getPcFlagsState(message) {
  const f = message?.flags?.["adm-daggerheart"];
  if (!f || f.kind !== "pcRoll") return null;
  return f.state || null;
}

function _getNpcFlagsState(message) {
  const f = message?.flags?.["adm-daggerheart"];
  if (!f || f.kind !== "npcRoll") return null;
  return f.state || null;
}

async function _rerenderNpcMessage(message, flagsState) {
  const s = flagsState ?? {};
  s.resolved ??= {};
  s.extraDice ??= [];

  const isReaction = !!s.isReaction;
  const mode = String(s.rollMode || "normal").trim().toLowerCase();

  const _intOrNull = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
  };

  const mainVal = _intOrNull(s.resolved.mainVal);
  const modeVal = _intOrNull(s.resolved.modeVal);

  const modTotal = Math.trunc(Number(s.modTotal) || 0);
  const extraSum = _sumExtraDice(s.extraDice);

  // выбранный d20 с учётом режима, но с поддержкой "удалённых" костей
  let chosen = null;

  if (mode === "advantage") {
    if (mainVal !== null && modeVal !== null) chosen = Math.max(mainVal, modeVal);
    else chosen = (mainVal !== null ? mainVal : modeVal);
  } else if (mode === "disadvantage") {
    if (mainVal !== null && modeVal !== null) chosen = Math.min(mainVal, modeVal);
    else chosen = (mainVal !== null ? mainVal : modeVal);
  } else {
    chosen = mainVal;
  }

  const chosenNum = (chosen === null ? 0 : chosen);
  const total = chosenNum + modTotal + extraSum;
  const isCrit = !isReaction && chosen === 20;

  const bg = _bgForNpcRoll(isCrit, isReaction);
  const resultLabel = isCrit ? "Крит!" : "Итог";

  const dice = _buildNpcDiceRow({
    mainVal,
    modeVal,
    mode,
    extraDice: s.extraDice,
  });

  const targets = _collectTargetsForUi(total, isCrit);

  // Crit damage: подменяем формулу на кнопке при крите
  const origDamage = String(s.weaponDamageText || "");
  const shownDamageText = isCrit && origDamage
    ? origDamage.replace(/^(Урон:\s*)(.+?)(\s*(?:физ\.|маг\.|прям\.)?)$/i, (_m, pre, formula, suf) => `${pre}${_critDamageFormula(formula)}${suf}`)
    : origDamage;

  const data = {
    bg,
    usedExpsText: String(s.usedExpsText || ""),
    dice,
    d8Svg: _dieSvgSrcGrey(8),
    modTotal,
    total,
    resultLabel,
    targets,
    weaponDamageText: shownDamageText,
    weaponAnimText: (isReaction ? "" : String(s.weaponAnimText || "")),
    isCrit,
  };

  const html = await renderTemplate(
    "systems/adm-daggerheart/templates/partials/result-npc.hbs",
    data
  );

  const nextFlagsState = {
    ...s,
    rollMode: mode,
    modTotal,
    total,
    resolved: { ...s.resolved, mainVal, modeVal },
  };

  await message.update({
    content: html,
    flags: {
      ...(message.flags || {}),
      "adm-daggerheart": {
        ...(message.flags?.["adm-daggerheart"] || {}),
        kind: "npcRoll",
        state: nextFlagsState,
        bg,
      },
    },
  });
}


async function _confirm(title, content) {
  return Dialog.confirm({ title, content });
}

async function _rerenderPcMessage(message, flagsState) {
  const s = flagsState ?? {};
  s.resolved ??= {};
  s.extraDice ??= [];

  const hopeSides = Math.trunc(Number(s.resolved.hopeSides ?? s.hopeDie ?? 12) || 12);
  const fearSides = Math.trunc(Number(s.resolved.fearSides ?? s.fearDie ?? 12) || 12);

  const hopeVal = Math.trunc(Number(s.resolved.hopeVal ?? 0) || 0);
  const fearVal = Math.trunc(Number(s.resolved.fearVal ?? 0) || 0);

  const isReaction = !!s.isReaction;

  const edge = s.resolved.edge || { used: false, isAdv: false, net: 0, rolls: [], best: 0, value: 0 };

  const modTotal = Math.trunc(Number(s.modTotal) || 0);

  const extraSum = _sumExtraDice(s.extraDice);
  const baseSum = hopeVal + fearVal;

  const total = baseSum + (Number(edge.value) || 0) + modTotal + extraSum;

  const bg = _bgForDuality(hopeVal, fearVal, isReaction);
  const resultLabel = _resultLabelForDuality(hopeVal, fearVal, isReaction);
  const isCrit = !isReaction && (Number(hopeVal) === Number(fearVal));

  const targets = _collectTargetsForUi(total, isCrit);

  // --- дуальность: откат/применение по смене исхода (ДО рендера, чтобы показать корректные строки) ---
  const actorUuid = String(s.actorUuid || "").trim();
  const prevApplied = s.applied || { outcome: null, hopeDelta: 0, stressDelta: 0, fearDelta: 0 };
  const nextOutcome = _getOutcome(hopeVal, fearVal, isReaction);

  let nextApplied = prevApplied;

  // Если исход изменился — делаем откат/применение и получаем реальные дельты
  if (actorUuid) {
    nextApplied = await _reconcileDualityEffects(actorUuid, prevApplied, nextOutcome);
  }

  const effectsVM = _buildEffectsVM(nextApplied);

  const dice = _buildPcDiceRow({
    hopeSides,
    hopeVal,
    fearSides,
    fearVal,
    edge,
    extraDice: s.extraDice,
  });

  // Crit damage: подменяем формулу на кнопке при крите
  const origDamage = isReaction ? "" : String(s.weaponDamageText || "");
  const shownDamageText = isCrit && origDamage
    ? origDamage.replace(/^(Урон:\s*)(.+?)(\s*(?:физ\.|маг\.|прям\.)?)$/i, (_m, pre, formula, suf) => `${pre}${_critDamageFormula(formula)}${suf}`)
    : origDamage;

  const data = {
    bg,
    weaponName: isReaction ? "" : String(s.weaponName || "").trim(),
    weaponUuid: isReaction ? "" : String(s.weaponUuid || "").trim(),
    weaponDamageText: shownDamageText,
    weaponAnimText: isReaction ? "" : String(s.weaponAnimText || ""),

    traitLabel: String(s.traitLabel || ""),
    traitSigned: String(s.traitSigned || ""),
    usedExpsText: String(s.usedExpsText || ""),
    dice,
    d8Svg: _dieSvgSrcGrey(8),
    modTotal,
    total,
    resultLabel,
    targets,
    isCrit,

    // NEW: блок сообщений о ресурсов
    hasEffects: effectsVM.hasEffects,
    effects: effectsVM.effects,
  };

  const html = await renderTemplate(
    "systems/adm-daggerheart/templates/partials/result-pc.hbs",
    data
  );

  const nextFlagsState = {
    ...s,
    modTotal,
    total,
    weaponDamageText: isReaction ? "" : String(s.weaponDamageText || ""),
    weaponAnimText: isReaction ? "" : String(s.weaponAnimText || ""),
    resolved: {
      ...s.resolved,
      hopeSides,
      fearSides,
      hopeVal,
      fearVal,
      edge,
    },
    actorUuid,
    applied: nextApplied,

    // NEW: храним для отладки/совместимости (не обязательно, но удобно)
    hasEffects: effectsVM.hasEffects,
    effects: effectsVM.effects,
  };

  await message.update({
    content: html,
    flags: {
      ...(message.flags || {}),
      "adm-daggerheart": {
        ...(message.flags?.["adm-daggerheart"] || {}),
        kind: "pcRoll",
        state: nextFlagsState,
        bg,
      },
    },
  });
}


// -------------------------
// ± menu (above the message, not clipped)
// -------------------------
const __ADM_MOD_MENU_ID = "__admRollModMenuV2";
function _closeModMenu() {
  const el = document.getElementById(__ADM_MOD_MENU_ID);
  if (el) el.remove();
  globalThis.__admRollModMenuOpenV2 = null;
}

function _openModMenu(anchorEl, isNegative, onPick) {
  // повторный клик по тому же режиму — закрывает
  const prev = globalThis.__admRollModMenuOpenV2;
  if (prev && prev.anchor === anchorEl && !!prev.neg === !!isNegative) {
    _closeModMenu();
    return;
  }

  _closeModMenu();

  const rect = anchorEl.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.id = __ADM_MOD_MENU_ID;
  menu.className = "adm-rollmsg-modmenu";
  menu.dataset.neg = isNegative ? "1" : "0";

  const prefix = isNegative ? "-" : "+";
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
      _closeModMenu();
      onPick?.(sides, isNegative, 1);
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
        _closeModMenu();
        onPick?.(sides, isNegative, count);
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

  globalThis.__admRollModMenuOpenV2 = { anchor: anchorEl, neg: !!isNegative };

  const onDown = (ev) => {
    if (ev.target === menu || menu.contains(ev.target)) return;
    _closeModMenu();
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") {
      _closeModMenu();
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    }
  };

  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey, true);
}

// -------------------------
// Target changes -> update last roll message (pcRoll)
// -------------------------
async function _refreshLastPcRollTargets() {
  const mid = globalThis.__admLastPcRollMsgIdV1;
  if (!mid) return;

  const msg = game.messages?.get(mid);
  if (!msg) return;

  const s = _getPcFlagsState(msg);
  if (!s) return;

  await _rerenderPcMessage(msg, foundry.utils.duplicate(s));
}
async function _refreshLastNpcRollTargets() {
  const mid = globalThis.__admLastNpcRollMsgIdV1;
  if (!mid) return;

  const msg = game.messages?.get(mid);
  if (!msg) return;

  const s = _getNpcFlagsState(msg);
  if (!s) return;

  await _rerenderNpcMessage(msg, foundry.utils.duplicate(s));
}

// -------------------------
// Chat handlers
// -------------------------
function _installRollMsgHandlersOnce() {
  if (globalThis.__admRollMsgHandlersV4) return;
  globalThis.__admRollMsgHandlersV4 = true;

  // open item
  document.addEventListener("click", async (ev) => {
    const a = ev.target?.closest?.('[data-action="adm-open-item"][data-uuid]');
    if (!a) return;

    ev.preventDefault();
    ev.stopPropagation();

    const uuid = String(a.dataset.uuid || "").trim();
    if (!uuid) return;

    const doc = await fromUuid(uuid);
    if (!doc) return;

    doc.sheet?.render?.(true);
  }, true);

  // click target name -> pan to token
  document.addEventListener("click", async (ev) => {
    const row = ev.target?.closest?.(".adm-rollmsg-target[data-token-id]");
    if (!row) return;

    const tokenId = String(row.dataset.tokenId || "");
    const sceneId = String(row.dataset.sceneId || "");

    ev.preventDefault();
    ev.stopPropagation();

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
  }, true);

  // LMB on die => reroll
 // LMB on die => reroll
document.addEventListener("click", async (ev) => {
  const dieEl = ev.target?.closest?.(".adm-rollmsg-die[data-die-id]");
  if (!dieEl) return;

  const message = _findMessageFromEvent(ev);
  if (!message) return;

  const pcState = _getPcFlagsState(message);
  const npcState = _getNpcFlagsState(message);
  const flagsState = pcState || npcState;
  if (!flagsState) return;

  const isNpc = !!npcState;

  const dieId = String(dieEl.dataset.dieId || "");
  if (!dieId) return;

  const ok = await _confirm("Перебросить", "<p>Перебросить кубик?</p>");
  if (!ok) return;

  const st = foundry.utils.duplicate(flagsState);
  st.resolved ??= {};
  st.extraDice ??= [];

  if (isNpc) {
    if (dieId === "d20-main") {
      st.resolved.mainVal = await _rollDieWithDsn(20, null);
      await _rerenderNpcMessage(message, st);
      return;
    }

    if (dieId === "d20-mode") {
      st.resolved.modeVal = await _rollDieWithDsn(20, null);
      await _rerenderNpcMessage(message, st);
      return;
    }

    const idx = st.extraDice.findIndex(d => String(d.id) === dieId);
    if (idx >= 0) {
      const d = st.extraDice[idx];
      const sides = Math.max(2, Math.trunc(Number(d.sides) || 6));
      d.value = await _rollDieWithDsn(sides, null);
      st.extraDice[idx] = d;
      await _rerenderNpcMessage(message, st);
      return;
    }

    return;
  }

  // PC
  if (dieId === "hope") {
    const sides = Math.trunc(Number(st.resolved.hopeSides ?? st.hopeDie ?? 12) || 12);
    st.resolved.hopeVal = await _rollDieWithDsn(sides, _DSN_HOPE_APPEARANCE);
    await _rerenderPcMessage(message, st);
    return;
  }

  if (dieId === "fear") {
    const sides = Math.trunc(Number(st.resolved.fearSides ?? st.fearDie ?? 12) || 12);
    st.resolved.fearVal = await _rollDieWithDsn(sides, _DSN_FEAR_APPEARANCE);
    await _rerenderPcMessage(message, st);
    return;
  }

  if (dieId === "edge") {
    const edge = st.resolved.edge || { used: false, isAdv: false, net: 0, rolls: [], best: 0, value: 0 };
    if (edge?.used && (edge.net || 0) > 0) {
      const pool = await _rollEdgePoolWithDsn(edge.net);
      edge.rolls = pool.rolls;
      edge.best = pool.best;
      edge.value = edge.isAdv ? pool.best : -pool.best;
      st.resolved.edge = edge;
    }
    await _rerenderPcMessage(message, st);
    return;
  }

  const idx = st.extraDice.findIndex(d => String(d.id) === dieId);
  if (idx >= 0) {
    const d = st.extraDice[idx];
    const sides = Math.max(2, Math.trunc(Number(d.sides) || 6));
    d.value = await _rollDieWithDsn(sides, null);
    st.extraDice[idx] = d;
    await _rerenderPcMessage(message, st);
    return;
  }
}, true);


  // RMB on die (except hope/fear) => delete
 // RMB on die (except hope/fear) => delete
document.addEventListener("contextmenu", async (ev) => {
  const dieEl = ev.target?.closest?.(".adm-rollmsg-die[data-die-id]");
  if (!dieEl) return;

  const dieId = String(dieEl.dataset.dieId || "");
  if (!dieId || dieId === "hope" || dieId === "fear") return;

  const message = _findMessageFromEvent(ev);
  if (!message) return;

  const pcState = _getPcFlagsState(message);
  const npcState = _getNpcFlagsState(message);
  const flagsState = pcState || npcState;
  if (!flagsState) return;

  ev.preventDefault();
  ev.stopPropagation();

  const ok = await _confirm("Удалить", "<p>Удалить кубик?</p>");
  if (!ok) return;

  const st = foundry.utils.duplicate(flagsState);
  st.resolved ??= {};
  st.extraDice ??= [];

  // NPC: можно удалить d20-main и d20-mode, и также extraDice
  if (npcState) {
    st.resolved ??= {};
    st.extraDice ??= [];

    // удалить основной d20
    if (dieId === "d20-main") {
      st.resolved.mainVal = null;

      // если был adv/dis — без пары режим сбрасываем
      if (st.rollMode === "advantage" || st.rollMode === "disadvantage") {
        st.rollMode = "normal";
        st.resolved.modeVal = null;
      }

      await _rerenderNpcMessage(message, st);
      return;
    }

    // удалить d20 преимущества/помехи
    if (dieId === "d20-mode") {
      st.resolved.modeVal = null;
      st.rollMode = "normal";
      await _rerenderNpcMessage(message, st);
      return;
    }

    // удалить доп.кость
    const idx = st.extraDice.findIndex(d => String(d.id) === dieId);
    if (idx >= 0) {
      st.extraDice.splice(idx, 1);
      await _rerenderNpcMessage(message, st);
    }
    return;
  }


  // PC
  if (dieId === "edge") {
    st.resolved.edge = { used: false, isAdv: false, net: 0, rolls: [], best: 0, value: 0 };
    await _rerenderPcMessage(message, st);
    return;
  }

  const idx = st.extraDice.findIndex(d => String(d.id) === dieId);
  if (idx >= 0) {
    st.extraDice.splice(idx, 1);
    await _rerenderPcMessage(message, st);
    return;
  }
}, true);


  // mod input: Enter => evaluate and rerender
 // mod input: Enter => evaluate and rerender
document.addEventListener("keydown", async (ev) => {
  const inp = ev.target?.closest?.("input.adm-rollmsg-modinput[data-adm-modinput]");
  if (!inp) return;
  if (ev.key !== "Enter") return;

  ev.preventDefault();
  ev.stopPropagation();

  const message = _findMessageFromEvent(ev);
  if (!message) return;

  const pcState = _getPcFlagsState(message);
  const npcState = _getNpcFlagsState(message);
  const flagsState = pcState || npcState;
  if (!flagsState) return;

  const current = Math.trunc(Number(flagsState.modTotal) || 0);
  const next = _evalMathExpr(inp.value, current);

  const st = foundry.utils.duplicate(flagsState);
  st.modTotal = next;
  inp.value = String(next);

  if (npcState) await _rerenderNpcMessage(message, st);
  else await _rerenderPcMessage(message, st);
}, true);


  // mod input: blur => evaluate and rerender
 // mod input: blur => evaluate and rerender
document.addEventListener("blur", async (ev) => {
  const inp = ev.target?.closest?.("input.adm-rollmsg-modinput[data-adm-modinput]");
  if (!inp) return;

  const message = _findMessageFromEvent(ev);
  if (!message) return;

  const pcState = _getPcFlagsState(message);
  const npcState = _getNpcFlagsState(message);
  const flagsState = pcState || npcState;
  if (!flagsState) return;

  const current = Math.trunc(Number(flagsState.modTotal) || 0);
  const next = _evalMathExpr(inp.value, current);

  const st = foundry.utils.duplicate(flagsState);
  st.modTotal = next;
  inp.value = String(next);

  if (npcState) await _rerenderNpcMessage(message, st);
  else await _rerenderPcMessage(message, st);
}, true);


// LMB on ± button => +dice menu
document.addEventListener("click", async (ev) => {
  const btn = ev.target?.closest?.(".adm-rollmsg-modbtn[data-adm-modbtn]");
  if (!btn) return;

  const message = _findMessageFromEvent(ev);
  if (!message) return;

  const pcState = _getPcFlagsState(message);
  const npcState = _getNpcFlagsState(message);
  const flagsState = pcState || npcState;
  if (!flagsState) return;

  ev.preventDefault();
  ev.stopPropagation();

  _openModMenu(btn, false, async (sides, isNeg, count) => {
    const st = foundry.utils.duplicate(flagsState);
    st.extraDice ??= [];

    for (let i = 0; i < (count || 1); i++) {
      const id = `mod-${Date.now()}-${Math.floor(Math.random() * 1e9)}-${i}`;
      const value = await _rollDieWithDsn(sides, null);
      st.extraDice.push({ id, sides, value, isNeg: !!isNeg });
    }

    if (npcState) await _rerenderNpcMessage(message, st);
    else await _rerenderPcMessage(message, st);
  });
}, true);


 // RMB on ± button => -dice menu
document.addEventListener("contextmenu", async (ev) => {
  const btn = ev.target?.closest?.(".adm-rollmsg-modbtn[data-adm-modbtn]");
  if (!btn) return;

  const message = _findMessageFromEvent(ev);
  if (!message) return;

  const pcState = _getPcFlagsState(message);
  const npcState = _getNpcFlagsState(message);
  const flagsState = pcState || npcState;
  if (!flagsState) return;

  ev.preventDefault();
  ev.stopPropagation();

  _openModMenu(btn, true, async (sides, isNeg, count) => {
    const st = foundry.utils.duplicate(flagsState);
    st.extraDice ??= [];

    for (let i = 0; i < (count || 1); i++) {
      const id = `mod-${Date.now()}-${Math.floor(Math.random() * 1e9)}-${i}`;
      const value = await _rollDieWithDsn(sides, null);
      st.extraDice.push({ id, sides, value, isNeg: !!isNeg });
    }

    if (npcState) await _rerenderNpcMessage(message, st);
    else await _rerenderPcMessage(message, st);
  });
}, true);


// --- LMB on damage button => roll damage ---
document.addEventListener("click", async (ev) => {
  const btn = ev.target?.closest?.(".adm-rollmsg-dmgbtn[data-adm-dmgbtn]");
  if (!btn) return;

  const message = _findMessageFromEvent(ev);
  if (!message) return;

  const pcState = _getPcFlagsState(message);
  const npcState = _getNpcFlagsState(message);
  const flagsState = pcState || npcState;
  if (!flagsState) return;

  ev.preventDefault();
  ev.stopPropagation();

  // Извлекаем формулу урона из текста кнопки (содержит crit-модификацию если крит)
  const rawText = String(btn.textContent || "").trim();
  if (!rawText) return;

  // Парсим: "Урон: FORMULA TYPE"
  const match = rawText.match(/^Урон:\s*(.+?)(?:\s+(физ\.|маг\.|прям\.))?$/i);
  if (!match) return;

  const formula = String(match[1] || "").trim();
  if (!formula) return;

  const typeShort = String(match[2] || "").trim().toLowerCase();
  let damageType = "physical";
  if (typeShort === "маг.") damageType = "magical";
  else if (typeShort === "прям.") damageType = "direct";

  // isCrit
  const isReaction = !!flagsState.isReaction;
  let isCrit = false;
  if (pcState) {
    const hopeVal = Number(pcState.resolved?.hopeVal ?? 0) || 0;
    const fearVal = Number(pcState.resolved?.fearVal ?? 0) || 0;
    isCrit = !isReaction && hopeVal === fearVal;
  } else if (npcState) {
    const mainVal = Number(npcState.resolved?.mainVal ?? 0) || 0;
    const modeVal = Number(npcState.resolved?.modeVal ?? 0) || 0;
    const mode = String(npcState.rollMode || "normal").trim().toLowerCase();
    let chosen = mainVal;
    if (mode === "advantage") chosen = Math.max(mainVal, modeVal);
    else if (mode === "disadvantage") chosen = Math.min(mainVal, modeVal);
    isCrit = !isReaction && chosen === 20;
  }

  // Targets из сообщения атаки
  const targets = [];
  const msgEl = btn.closest(".adm-rollmsg[data-adm-rollmsg]");
  if (msgEl) {
    msgEl.querySelectorAll(".adm-rollmsg-target[data-token-id]").forEach(el => {
      targets.push({
        tokenId: String(el.dataset.tokenId || ""),
        sceneId: String(el.dataset.sceneId || ""),
        name: String(el.querySelector(".adm-rollmsg-target-name")?.textContent || "").trim(),
        ok: el.classList.contains("is-hit") || el.classList.contains("is-crit") || el.classList.contains("is-pass"),
      });
    });
  }

  await admDamageRollToChat(formula, damageType, targets, isCrit);
}, true);

}

Hooks.once("ready", () => _installRollMsgHandlersOnce());
Hooks.on("renderChatMessage", (message, html) => {
  try {
    const bg = message?.flags?.["adm-daggerheart"]?.bg;
    if (!bg) return;

    // html — это jQuery объект, берём корневой .chat-message
    const el = html?.[0];
    if (!el) return;

    el.style.setProperty("--adm-rollmsg-bg", String(bg));
  } catch (_e) {}
});

// target changes -> update last pc message for THIS client
Hooks.on?.("targetToken", (user, _token, _targeted) => {
  try {
    if (!user || user.id !== game.user.id) return;
    _refreshLastPcRollTargets();
    _refreshLastNpcRollTargets();
  } catch (_e) {}
});


// -------------------------
// Public API (ИМЕННОВАННЫЕ EXPORT) + globalThis для совместимости
// -------------------------
export async function admPcRollToChat(actor, state) {
  if (!actor || !state) return;

  // is weapon roll?
  const isWeaponRoll = !!state.weaponUuid || !!state.weaponName;

// key + label for trait (traitKey должен быть объявлен ДО использования)
const traitKey = String(state.trait || "").trim().toLowerCase();
const traitLabel = _getTraitLabel(traitKey);

// значение атрибута: либо передали готовое, либо берём из актёра
const baseTraitValue =
  (state.traitValue !== undefined && state.traitValue !== null)
    ? Math.trunc(Number(state.traitValue) || 0)
    : _getTraitValue(actor, traitKey);



  // trait signed shown in message (will include weapon mod below)
  const weaponName = String(state.weaponName || "").trim();
  const weaponUuid = String(state.weaponUuid || "").trim();

  // текст кнопки урона (с мастерством)
  let weaponDamageText = "";
  try {
    const stFormula = String(
      state?.weaponDamageFormula ??
      state?.weaponDamage ??
      state?.damage ??
      ""
    ).trim();

    const stType = String(
      state?.weaponDamageType ??
      state?.weaponDamageKind ??
      state?.damageType ??
      ""
    ).trim();

if (stFormula) {
  const uiFormula = _formatDamageFormulaForUi(stFormula, actor);
  weaponDamageText = `Урон: ${uiFormula} ${_damageTypeShort(stType)}`.trim();
} else if (weaponUuid) {
  const w = await fromUuid(weaponUuid);
  const formula = String(w?.system?.damage ?? w?.system?.damageFormula ?? "").trim();
  const type = String(w?.system?.damageType ?? w?.system?.damageKind ?? "").trim();
  if (formula) {
    const uiFormula = _formatDamageFormulaForUi(formula, actor);
    weaponDamageText = `Урон: ${uiFormula} ${_damageTypeShort(type)}`.trim();
  }
}

  } catch (_e) {}

  const weaponAttackMod = isWeaponRoll ? Math.trunc(Number(state.weaponAttackMod) || 0) : 0;
  const shownTraitValue = baseTraitValue + weaponAttackMod;

  const hopeSides = Math.trunc(Number(state.hopeDie) || 12);
  const fearSides = Math.trunc(Number(state.fearDie) || 12);

  const isReaction = !!state.isReaction;
  if (isReaction) weaponDamageText = "";

   // имя анимации атаки (приоритет) — имя атаки только если анимация пустая
  let weaponAnimText = "";
  try {
    weaponAnimText = String(
      state?.attackAnimation ??
      state?.weaponAttackAnimation ??
      state?.anim ??
      ""
    ).trim();
  } catch (_e) {}

// fallback: ТОЛЬКО если поле анимации пустое
  if (!weaponAnimText) {
    // 1. Пробуем имя оружия (Лук, Меч и т.д.)
    if (state?.weaponName) {
      weaponAnimText = String(state.weaponName).trim();
    }
    // 2. Если нет оружия, пробуем имя атаки (для спец. атак)
    else {
      weaponAnimText = String(
        state?.attackName ??
        state?.defaultAttackName ??
        actor?.system?.defaultAttackName ??
        ""
      ).trim();
    }
  }

  // если всё ещё пусто — последний fallback (имя существа)
  if (!weaponAnimText) weaponAnimText = String(actor?.name ?? "").trim();


  // реакция — не показываем
  if (isReaction) weaponAnimText = "";

  // --- Combined roll: hope + fear + edge (all dice shown at once via DSN) ---
  const _advCount = Math.max(0, Math.trunc(Number(state.adv) || 0));
  const _disCount = Math.max(0, Math.trunc(Number(state.dis) || 0));
  const _edgeNet = Math.abs(_advCount - _disCount);
  const _edgeIsAdv = _advCount > _disCount;

  const _rollParts = [`1d${hopeSides}`, `1d${fearSides}`];
  if (_edgeNet > 0) _rollParts.push(`${_edgeNet}d6`);

  const _combinedRoll = new Roll(_rollParts.join(" + "));
  await _combinedRoll.evaluate();

  const hopeVal = Number(_combinedRoll.dice[0]?.results?.[0]?.result) || 0;
  const fearVal = Number(_combinedRoll.dice[1]?.results?.[0]?.result) || 0;

  let edge = { used: false, isAdv: false, net: 0, rolls: [], best: 0, value: 0 };
  if (_edgeNet > 0 && _combinedRoll.dice[2]) {
    const _edgeRolls = _combinedRoll.dice[2].results.map(r => Number(r.result) || 0);
    const _edgeBest = Math.max(0, ..._edgeRolls);
    edge = { used: true, isAdv: _edgeIsAdv, net: _edgeNet, rolls: _edgeRolls, best: _edgeBest, value: _edgeIsAdv ? _edgeBest : -_edgeBest };
  }

  // Dice So Nice: apply Hope/Fear appearance, then show all dice together
  if (game.dice3d) {
    try {
      _combinedRoll.dice[0].options.appearance = _DSN_HOPE_APPEARANCE;
      _combinedRoll.dice[1].options.appearance = _DSN_FEAR_APPEARANCE;
      await game.dice3d.showForRoll(_combinedRoll, game.user, true);
    } catch (_e) {}
  }

  const dialogMod = Math.trunc(Number(state.mod) || 0);
  const expSum = _sumActiveExp(state.experiences);

  // input = атрибут(с оружием) + мод из окна + опыты
  const modTotal = shownTraitValue + dialogMod + expSum;

  const extraDice = [];
  const baseSum = hopeVal + fearVal;
  const total = baseSum + edge.value + modTotal;

  const bg = _bgForDuality(hopeVal, fearVal, isReaction);
  const resultLabel = _resultLabelForDuality(hopeVal, fearVal, isReaction);
  const isCrit = !isReaction && (Number(hopeVal) === Number(fearVal));

  const usedExpsText = _formatUsedExpsText(state.experiences);

  const actorUuid = String(actor?.uuid || "").trim();

  // применяем ресурсы СРАЗУ по исходу броска
  const initialApplied = { outcome: null, hopeDelta: 0, stressDelta: 0, fearDelta: 0 };
  const outcome = _getOutcome(hopeVal, fearVal, isReaction);
  const applied = actorUuid ? await _reconcileDualityEffects(actorUuid, initialApplied, outcome) : initialApplied;

  const effectsVM = _buildEffectsVM(applied);

  const dice = _buildPcDiceRow({
    hopeSides,
    hopeVal,
    fearSides,
    fearVal,
    edge,
    extraDice,
  });

  const targets = _collectTargetsForUi(total, isCrit);

  // Crit damage: подменяем формулу на кнопке, но в флагах храним оригинал
  const shownDamageText = isCrit && weaponDamageText
    ? weaponDamageText.replace(/^(Урон:\s*)(.+?)(\s*(?:физ\.|маг\.|прям\.)?)$/i, (_m, pre, formula, suf) => `${pre}${_critDamageFormula(formula)}${suf}`)
    : weaponDamageText;

  const data = {
    bg,
    weaponName: isReaction ? "" : weaponName,
    weaponUuid: isReaction ? "" : weaponUuid,

    traitLabel,
    traitSigned: _signed(shownTraitValue),
    usedExpsText,
    dice,
    d8Svg: _dieSvgSrcGrey(8),
    modTotal,
    total,
    resultLabel,
    targets,
    weaponDamageText: shownDamageText,
    weaponAnimText,
    isCrit,

    // NEW: блок сообщений о ресурсах
    hasEffects: effectsVM.hasEffects,
    effects: effectsVM.effects,
  };

  const html = await renderTemplate(
    "systems/adm-daggerheart/templates/partials/result-pc.hbs",
    data
  );

  const flagsState = {
    ...state,
    actorUuid,
    weaponName,
    weaponUuid,
    traitLabel,
    traitSigned: _signed(shownTraitValue),
    usedExpsText,
    isReaction,
    modTotal,
    total,
    extraDice,
    resolved: { hopeSides, fearSides, hopeVal, fearVal, edge },
    weaponDamageText,
    weaponAnimText,

    applied,
    hasEffects: effectsVM.hasEffects,
    effects: effectsVM.effects,
  };

  const msg = await ChatMessage.create({
    speaker: _speakerForActor(actor),
    content: html,
    flags: { "adm-daggerheart": { kind: "pcRoll", state: flagsState, bg } },
  });

  try { globalThis.__admLastPcRollMsgIdV1 = msg?.id || null; } catch (_e) {}
  return msg;
}


export async function admNpcRollToChat(actor, state, rollMode = "normal") {
  if (!actor || !state) return;

  const mode = String(rollMode || "normal").trim().toLowerCase();
  const isReaction = !!state.isReaction;

  // d20 rolls (via combined Roll for Dice So Nice)
  const _npcIsDouble = mode === "advantage" || mode === "disadvantage";
  const _npcRoll = new Roll(_npcIsDouble ? "1d20 + 1d20" : "1d20");
  await _npcRoll.evaluate();
  const mainVal = Number(_npcRoll.dice[0]?.results?.[0]?.result) || 0;
  const modeVal = _npcIsDouble ? (Number(_npcRoll.dice[1]?.results?.[0]?.result) || 0) : 0;

  if (game.dice3d) {
    try { await game.dice3d.showForRoll(_npcRoll, game.user, true); } catch (_e) {}
  }

  // мод = мод атаки монстра (из окна) + опыт
  const attackMod =
    Math.trunc(Number(state.attackMod) || 0) +
    Math.trunc(Number(state.mod) || 0);

  const expSum = _sumActiveExp(state.experiences);
  const modTotal = attackMod + expSum;

  const extraDice = [];
  const extraSum = _sumExtraDice(extraDice);

  // итоговый d20 с учетом режима
  let chosen = mainVal;
  if (mode === "advantage") chosen = Math.max(mainVal, modeVal);
  else if (mode === "disadvantage") chosen = Math.min(mainVal, modeVal);

  const total = chosen + modTotal + extraSum;
  const isCrit = !isReaction && Number(chosen) === 20;

  const bg = _bgForNpcRoll(isCrit, isReaction);
  const resultLabel = isCrit ? "Крит!" : "Итог";

  const usedExpsText = _formatUsedExpsText(state.experiences);

  // текст кнопки урона (без мастерства)
  let weaponDamageText = "";
  try {
    const stFormula = String(
      state?.weaponDamageFormula ??
      state?.weaponDamage ??
      state?.damage ??
      ""
    ).trim();

    const stType = String(
      state?.weaponDamageType ??
      state?.weaponDamageKind ??
      state?.damageType ??
      ""
    ).trim();

    if (stFormula) {
      weaponDamageText = `Урон: ${stFormula} ${_damageTypeShort(stType)}`.trim();
    }
  } catch (_e) {}
  if (isReaction) weaponDamageText = "";

  // NEW: имя анимации атаки (для триггера в сообщении)
  let weaponAnimText = "";
  try {
    weaponAnimText = String(state?.attackAnimation ?? "").trim();
  } catch (_e) {}

  // fallback: если пусто — берём имя атаки (или имя НПЦ)
  if (!weaponAnimText) {
    weaponAnimText = String(
      state?.attackName ??
      state?.defaultAttackName ??
      actor?.system?.defaultAttackName ??
      ""
    ).trim();
  }
  if (!weaponAnimText) weaponAnimText = String(actor?.name ?? "").trim();

  // реакция — не показываем
  if (isReaction) weaponAnimText = "";

  const dice = _buildNpcDiceRow({
    mainVal,
    modeVal,
    mode,
    extraDice,
  });

  const targets = _collectTargetsForUi(total, isCrit);

  // Crit damage: подменяем формулу на кнопке, но в флагах храним оригинал
  const shownDamageText = isCrit && weaponDamageText
    ? weaponDamageText.replace(/^(Урон:\s*)(.+?)(\s*(?:физ\.|маг\.|прям\.)?)$/i, (_m, pre, formula, suf) => `${pre}${_critDamageFormula(formula)}${suf}`)
    : weaponDamageText;

  const data = {
    bg,
    usedExpsText,
    dice,
    d8Svg: _dieSvgSrcGrey(8),
    modTotal,
    total,
    resultLabel,
    targets,
    weaponDamageText: shownDamageText,
    weaponAnimText,
    isCrit,
  };

  const html = await renderTemplate(
    "systems/adm-daggerheart/templates/partials/result-npc.hbs",
    data
  );

  const flagsState = {
    ...state,
    isReaction,
    rollMode: mode,
    modTotal,
    total,
    extraDice,
    resolved: { mainVal, modeVal },
    usedExpsText,
    weaponDamageText,
    weaponAnimText,
  };

  const msg = await ChatMessage.create({
    speaker: _speakerForActor(actor),
    content: html,
    flags: { "adm-daggerheart": { kind: "npcRoll", state: flagsState, bg } },
  });

  try { globalThis.__admLastNpcRollMsgIdV1 = msg?.id || null; } catch (_e) {}
  return msg;
}


// legacy globals (если где-то вызывается без import)
globalThis.admPcRollToChat = admPcRollToChat;
globalThis.admNpcRollToChat = admNpcRollToChat;
