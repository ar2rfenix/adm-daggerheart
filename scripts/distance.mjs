// systems/adm-daggerheart/scripts/distance.mjs
// Hover distance labels (edge-to-edge + elevation), Daggerheart narrative ranges

let __admDistanceInitialized = false;

const NS = "adm-daggerheart";
const SET_ENABLED = "distanceEnabled";
const SET_SCENE_DISABLE = "distanceSceneDisabled";
const SET_TOOLTIP_POS = "distanceTooltipPosition";
const SET_COMPLEXITY_THRESHOLD = "distanceComplexityThreshold"; // reserved
const SET_ROUNDING = "distanceRounding"; // 0 = no rounding, else rounding step (e.g. 5)

/* -------------------------------------------- */
/* Helpers                                      */
/* -------------------------------------------- */

function _getFirstControlledToken() {
  const controlled = canvas?.tokens?.controlled || [];
  return controlled.length > 0 ? controlled[0] : null;
}

function _isSceneDisabled() {
  return canvas?.scene?.getFlag(NS, SET_SCENE_DISABLE) === true;
}

function _isEnabled() {
  const key = `${NS}.${SET_ENABLED}`;
  const has = game?.settings?.settings?.has?.(key);
  const globalEnabled = has ? game.settings.get(NS, SET_ENABLED) : true;
  return !!globalEnabled && !_isSceneDisabled();
}

function _isFeetLikeUnits() {
  const u = String(canvas?.grid?.units ?? "").toLowerCase().trim();
  if (!u) return true;
  if (u === "ft" || u === "feet" || u === "foot") return true;
  if (u === "фут" || u === "футы") return true;
  return false;
}

function _applyRounding(distanceFeet) {
  const key = `${NS}.${SET_ROUNDING}`;
  const has = game?.settings?.settings?.has?.(key);
  const step = Number(has ? game.settings.get(NS, SET_ROUNDING) : 0);

  // 0 => НЕ округляем (важно, чтобы границы не сдвигались)
  if (!Number.isFinite(step) || step <= 0) return Number(distanceFeet) || 0;

  const rounded = Math.round((Number(distanceFeet) || 0) / step) * step;
  return Math.round(rounded * 1000000) / 1000000;
}

function _getCellFt() {
  return (
    Number(canvas?.scene?.grid?.distance) ||
    Number(canvas?.grid?.distance) ||
    5
  );
}

function _getGridSizePx() {
  return Number(canvas?.grid?.size) || 100;
}

function _getElevationFt(token) {
  const e = token?.document?.elevation;
  return Number.isFinite(e) ? e : 0;
}

// высота объёма токена в футах: max(width,height) клеток * distance
function _tokenHeightFt(token) {
  const w = Number(token?.document?.width ?? 1) || 1;
  const h = Number(token?.document?.height ?? 1) || 1;
  const cells = Math.max(w, h);
  return cells * _getCellFt();
}

/* -------------------------------------------- */
/* Labels (gap-cells logic)                      */
/* -------------------------------------------- */

/**
 * Лейбл дистанции по правилам:
 * - берём 3D дистанцию (edge-to-edge по XY + distance по Z)
 * - переводим в "gap cells" через floor (чтобы 3 пустых клетки не стали 4 из-за дробей)
 *
 * Пороги (ВАЖНО: 3 клетки = "Средняя"):
 * 0          => Вплотную
 * 1..2       => Близко
 * 3..5       => Средняя
 * 6..8       => Далеко
 * 9..12      => Оч. далеко
 * 13+ (>=65) => Вне досягаемости
 */
function _getLabelForDistance(distanceFeet) {
  const cfg = CONFIG?.ADM_DAGGERHEART;
  if (!cfg?.ranges) return "";
  if (!_isFeetLikeUnits()) return "";

  const cellFt = _getCellFt();
  const d = Number(distanceFeet) || 0;

  const EPS = 1e-6;
  const gapCells = Math.max(0, Math.floor((d + EPS) / cellFt));

  if (gapCells <= 0)  return game.i18n.localize(cfg.ranges.melee);      // Вплотную
  if (gapCells <= 2)  return game.i18n.localize(cfg.ranges.veryClose);  // Близко
  if (gapCells <= 5)  return game.i18n.localize(cfg.ranges.close);      // Средняя
  if (gapCells <= 8)  return game.i18n.localize(cfg.ranges.far);        // Далеко
  if (gapCells <= 11) return game.i18n.localize(cfg.ranges.veryFar);    // Оч. далеко

  // 13+ клеток (>=65ft при 5ft сетке)
  const key = cfg.ranges.outOfRange ?? "DAGGERHEART.RANGE.OUT_OF_RANGE";
  return game.i18n.localize(key);
}


function _getLabelForRulerDistance(distanceFeet) {
  const cfg = CONFIG?.ADM_DAGGERHEART;
  if (!cfg?.ranges) return "";
  if (!_isFeetLikeUnits()) return "";

  const cellFt =
    Number(canvas?.scene?.grid?.distance) ||
    Number(canvas?.grid?.distance) ||
    5;

  const d = Number(distanceFeet) || 0;

  // линейка = center-to-center, переводим в количество "клеток пути"
  const spaces = Math.max(0, Math.round(d / cellFt));

  // расстояние "между токенами" = пустые клетки, поэтому -1
  const gapCells = Math.max(0, spaces - 1);

  // пороги в gapCells
  if (gapCells <= 0)  return game.i18n.localize(cfg.ranges.melee);      // Вплотную
  if (gapCells <= 2)  return game.i18n.localize(cfg.ranges.veryClose);  // Близко
  if (gapCells <= 5)  return game.i18n.localize(cfg.ranges.close);      // Средняя
  if (gapCells <= 8)  return game.i18n.localize(cfg.ranges.far);        // Далеко

  // ВАЖНО: для ruler (center-to-center -> gap = spaces-1) "65 ft" даст gapCells=12,
  // поэтому чтобы "Вне" началось с 65, тут нужно <=11
  if (gapCells <= 11) return game.i18n.localize(cfg.ranges.veryFar);    // Оч. далеко

  const key = cfg.ranges.outOfRange ?? "DAGGERHEART.RANGE.OUT_OF_RANGE";
  return game.i18n.localize(key);
}



/* -------------------------------------------- */
/* Distance measurement                          */
/* -------------------------------------------- */

/**
 * Edge-to-edge расстояние между токенами по XY (AABB->AABB) в футах.
 */
function _measureRectToRectFeet(tokenA, tokenB) {
  const gs = _getGridSizePx();     // px per cell
  const gd = _getCellFt();         // ft per cell

  const ax0 = Number(tokenA?.x ?? 0);
  const ay0 = Number(tokenA?.y ?? 0);
  const ax1 = ax0 + Number(tokenA?.w ?? 0);
  const ay1 = ay0 + Number(tokenA?.h ?? 0);

  const bx0 = Number(tokenB?.x ?? 0);
  const by0 = Number(tokenB?.y ?? 0);
  const bx1 = bx0 + Number(tokenB?.w ?? 0);
  const by1 = by0 + Number(tokenB?.h ?? 0);

  // AABB -> AABB min distance (в пикселях)
  const dx = Math.max(0, Math.max(ax0 - bx1, bx0 - ax1));
  const dy = Math.max(0, Math.max(ay0 - by1, by0 - ay1));

  const px = Math.hypot(dx, dy);
  return (px / gs) * gd;
}

/**
 * Вертикальная дистанция между объёмами токенов (ft).
 * Если объёмы по высоте пересекаются — 0.
 */
function _measureVerticalTokenDistanceFeet(tokenA, tokenB) {
  const a0 = _getElevationFt(tokenA);
  const a1 = a0 + _tokenHeightFt(tokenA);

  const b0 = _getElevationFt(tokenB);
  const b1 = b0 + _tokenHeightFt(tokenB);

  if (a1 < b0) return b0 - a1; // A ниже B
  if (b1 < a0) return a0 - b1; // B ниже A
  return 0;
}

/**
 * Итоговая дистанция для подсказок: 3D (XY edge-to-edge + Z volume-to-volume).
 */
function _measureMinTokenDistance(origin, target) {
  if (!origin || !target) return 0;
  if (!canvas?.grid) return 0;

  const dx = _measureRectToRectFeet(origin, target);
  const dz = _measureVerticalTokenDistanceFeet(origin, target);

  const d3 = Math.hypot(dx, dz);
  return _applyRounding(d3);
}

/* -------------------------------------------- */
/* PIXI tooltip rendering                        */
/* -------------------------------------------- */

function _ensureContainer(token) {
  if (!token.hoverDistanceContainer) {
    token.hoverDistanceContainer = new PIXI.Container();
    token.sortableChildren = true;
    token.addChild(token.hoverDistanceContainer);
    if (token.parent) token.parent.sortableChildren = true;

    token.hoverDistanceContainer.zIndex = 9999999;
    token.hoverDistanceContainer.sortableChildren = true;
  }
  return token.hoverDistanceContainer;
}

function _clearContainer(token) {
  if (token?.hoverDistanceContainer) token.hoverDistanceContainer.removeChildren();
}

function _drawTooltip(token, text) {
  const container = _ensureContainer(token);
  container.removeChildren();

  const fontSize = Math.max(10, Math.floor((canvas?.dimensions?.size || 100) / 4));
  const darkBlue = 0x050a14;
  const offWhite = 0xf2f3f4;

  const TextClass = foundry?.canvas?.containers?.PreciseText ?? PIXI.Text;

  const style = new PIXI.TextStyle({
    fill: offWhite,
    fontSize,
    fontFamily: "Signika, sans-serif",
    stroke: 0x000000,
    strokeThickness: 2,
    align: "center",
  });

  const label = new TextClass(text, style);

  const baseRes = canvas?.app?.renderer?.resolution || window.devicePixelRatio || 1;
  const zoom = canvas?.stage?.scale?.x || 1;
  label.resolution = Math.max(1, Math.floor(baseRes * zoom));
  if (typeof label.updateText === "function") label.updateText();

  const padX = Math.floor(fontSize * 0.6);
  const padY = Math.floor(fontSize * 0.4);
  const bgW = Math.ceil(label.width + padX * 2);
  const bgH = Math.ceil(label.height + padY * 2);

  const bg = new PIXI.Graphics();
  bg.beginFill(darkBlue, 0.7);
  bg.drawRoundedRect(0, 0, bgW, bgH, Math.min(10, Math.floor(fontSize * 0.6)));
  bg.endFill();

  bg.zIndex = 9999999;
  label.zIndex = 9999999;

  label.x = Math.floor((bgW - label.width) / 2);
  label.y = Math.floor((bgH - label.height) / 2);

  container.addChild(bg);
  container.addChild(label);

  const offset = Math.max(10, Math.floor(fontSize * 0.35));
  container.x = Math.round((token.w - bgW) / 2);

  const key = `${NS}.${SET_TOOLTIP_POS}`;
  const has = game?.settings?.settings?.has?.(key);
  const pos = has ? game.settings.get(NS, SET_TOOLTIP_POS) : "above";

  container.y = (pos === "below")
    ? Math.round(token.h + offset)
    : Math.round(-bgH - offset);

  container.roundPixels = true;
}

function _resetAll() {
  const placeables = canvas?.tokens?.placeables || [];
  for (const t of placeables) {
    if (t?.hoverDistanceContainer) t.hoverDistanceContainer.removeChildren();
    if (t?.tooltip) t.tooltip.visible = true;
  }
}

function _handleHover(token, hovered) {
  if (!_isEnabled()) {
    _clearContainer(token);
    if (token?.tooltip) token.tooltip.visible = true;
    return;
  }

  if (!hovered) {
    _clearContainer(token);
    if (token?.tooltip) token.tooltip.visible = true;
    return;
  }

  const origin = _getFirstControlledToken();
  if (!origin || origin.id === token.id) {
    _clearContainer(token);
    if (token?.tooltip) token.tooltip.visible = true;
    return;
  }

  const dist = _measureMinTokenDistance(origin, token);
  const label = _getLabelForDistance(dist);

  if (!label) {
    _clearContainer(token);
    if (token?.tooltip) token.tooltip.visible = true;
    return;
  }

  if (token?.tooltip) token.tooltip.visible = false;
  _drawTooltip(token, label);
}

function _handleControlToken() {
  _resetAll();
}

/**
 * highlightObjects — показываем лейблы всем токенам при активном origin.
 */
function _handleHighlight(highlighted) {
  if (!_isEnabled()) {
    _resetAll();
    return;
  }

  const origin = _getFirstControlledToken();
  if (!highlighted || !origin) {
    _resetAll();
    return;
  }

  const placeables = canvas?.tokens?.placeables || [];
  for (const t of placeables) {
    if (!t) continue;

    if (t.id === origin.id) {
      _clearContainer(t);
      if (t?.tooltip) t.tooltip.visible = true;
      continue;
    }

    const dist = _measureMinTokenDistance(origin, t);
    const label = _getLabelForDistance(dist);

    if (label) {
      if (t?.tooltip) t.tooltip.visible = false;
      _drawTooltip(t, label);
    } else {
      _clearContainer(t);
      if (t?.tooltip) t.tooltip.visible = true;
    }
  }
}

/* -------------------------------------------- */
/* Settings + init                               */
/* -------------------------------------------- */

function _registerSettingsOnce() {
  if (game.settings.settings.has(`${NS}.${SET_ENABLED}`)) return;

  game.settings.register(NS, SET_ENABLED, {
    name: "Distance labels (hover)",
    hint: "Show narrative range labels when hovering tokens with one token selected.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(NS, SET_TOOLTIP_POS, {
    name: "Distance tooltip position",
    hint: "Above or below token.",
    scope: "client",
    config: true,
    type: String,
    choices: { above: "Above", below: "Below" },
    default: "above",
  });

  game.settings.register(NS, SET_COMPLEXITY_THRESHOLD, {
    name: "Distance complexity threshold",
    hint: "Reserved (not used now).",
    scope: "client",
    config: true,
    type: Number,
    default: 16,
  });

  game.settings.register(NS, SET_ROUNDING, {
    name: "Distance rounding step",
    hint: "0 = no rounding, 5 = round to nearest 5 ft, etc.",
    scope: "client",
    config: true,
    type: Number,
    default: 0,
  });
}

function _patchRulersOnce() {
  if (globalThis.__admDistanceRulerPatched) return;
  globalThis.__admDistanceRulerPatched = true;

  const applyTo = (Proto) => {
    if (!Proto) return;

    const orig = Proto._getWaypointLabelContext;
    if (typeof orig !== "function") return;

    Proto._getWaypointLabelContext = function (waypoint, state) {
      const context = orig.call(this, waypoint, state);
      if (!context) return context;
      if (!_isEnabled()) return context;

      const d = Number(waypoint?.measurement?.distance ?? 0) || 0;
      const label = _getLabelForRulerDistance(d);
      if (!label) return context;

      // показываем только вашу дистанцию
      context.cost = { total: label, units: null };
      context.distance = { total: label, units: null };

      // полностью гасим любые вертикальные добавки Foundry ("↕ 15 ft" и т.п.)
      if ("elevation" in context) context.elevation = null;
      if ("vertical" in context) context.vertical = null;

      // подстраховка: иногда поле лежит глубже
      try {
        if (context?.cost) {
          context.cost.elevation = null;
          context.cost.vertical = null;
        }
        if (context?.distance) {
          context.distance.elevation = null;
          context.distance.vertical = null;
        }
      } catch {}

      return context;
    };
  };

  applyTo(foundry?.canvas?.interaction?.Ruler?.prototype);
  applyTo(foundry?.canvas?.placeables?.tokens?.TokenRuler?.prototype);
}




/**
 * Public init
 */
export function admInitDistance() {
  if (__admDistanceInitialized) return;
  __admDistanceInitialized = true;

  try { _registerSettingsOnce(); } catch (e) {}

  Hooks.once("ready", () => {
    _patchRulersOnce();

    Hooks.on("hoverToken", _handleHover);
    Hooks.on("controlToken", _handleControlToken);
    Hooks.on("highlightObjects", _handleHighlight);

    Hooks.on("canvasReady", () => _resetAll());
  });
}
