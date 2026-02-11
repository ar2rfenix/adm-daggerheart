// systems/adm-daggerheart/scripts/rings.mjs
// Локальные кольца вокруг токенов (видит только клиент, который включил).
// Радиус: (cells * размер_клетки) + расстояние от центра токена до его края.
// Кольцо тонкое, двигается вместе с токеном (дочерний PIXI объект),
// пересчитывается при изменении размеров токена, удаляется при deleteToken.
//
// Публичный API (для вызова из разных файлов):
// - admRingsInit()
// - admToggleTokenRing(tokenOrDoc, cells)
// - admSetTokenRing(tokenOrDoc, cells, enabled)
// - admHasTokenRing(tokenOrDoc, cells)
// - admClearTokenRings(tokenOrDoc)
// - admRedrawTokenRings(tokenOrDoc)

const __ADM_RINGS_KEY = "__ADM_DH_RINGS_V1";

function _state() {
  // enabled: Map<tokenUuid, Set<cells>>
  // drawn:   WeakMap<Token, Map<cells, PIXI.Graphics>>
  // hooksInstalled: boolean
  const s =
    (globalThis[__ADM_RINGS_KEY] =
      globalThis[__ADM_RINGS_KEY] || {
        enabled: new Map(),
        drawn: new WeakMap(),
        hooksInstalled: false,
      });
  return s;
}

function _asToken(tokenOrDoc) {
  if (!tokenOrDoc) return null;
  // Token object
  if (tokenOrDoc.object && tokenOrDoc.documentName === "Token") return tokenOrDoc.object;
  if (tokenOrDoc.documentName === "Token" && tokenOrDoc.parent) return tokenOrDoc.object ?? null;
  if (tokenOrDoc.document && tokenOrDoc.object === undefined) return tokenOrDoc; // already Token
  if (tokenOrDoc instanceof Token) return tokenOrDoc;
  return tokenOrDoc?.object ?? null;
}

function _tokenUuid(tokenOrDoc) {
  if (!tokenOrDoc) return null;
  // Token object
  if (tokenOrDoc.document?.uuid) return tokenOrDoc.document.uuid;
  // TokenDocument
  if (tokenOrDoc.uuid) return tokenOrDoc.uuid;
  return null;
}

function _gridDistanceFt() {
  return Number(canvas?.scene?.grid?.distance ?? 5) || 5;
}

function _gridSizePx() {
  return Number(canvas?.grid?.size ?? 100) || 100;
}

function _hexToInt(hex) {
  const h = String(hex || "#ffffff").trim();
  return Number("0x" + h.replace("#", ""));
}

function _getTokenOwnerColor(token) {
  const testPerm = (u) => {
    if (token?.actor) return token.actor.testUserPermission(u, "OWNER");
    return token?.document?.testUserPermission?.(u, "OWNER") ?? false;
  };

  const owners = game.users.filter(testPerm);
  const preferred = owners.find((u) => !u.isGM) ?? owners[0] ?? game.user;
  return preferred?.color || "#ffffff";
}

function _tokenRadiusFt(token) {
  const gridDistFt = _gridDistanceFt();
  const gridSizePx = _gridSizePx();

  // Берём максимальный радиус (на случай неквадратного токена).
  const tokenRadiusPx = Math.max(token.w ?? 0, token.h ?? 0) / 2;

  const tokenRadiusGrid = tokenRadiusPx / gridSizePx;
  return tokenRadiusGrid * gridDistFt;
}

function _ringRadiusPx(token, cells) {
  const gridDistFt = _gridDistanceFt();
  const gridSizePx = _gridSizePx();

  const addFt = Number(cells) * gridDistFt;
  const radiusFt = addFt + _tokenRadiusFt(token);

  return (radiusFt / gridDistFt) * gridSizePx;
}

function _getDrawnMap(token) {
  const st = _state();
  let m = st.drawn.get(token);
  if (!m) {
    m = new Map();
    st.drawn.set(token, m);
  }
  return m;
}

function _removeRingGfx(token, cells) {
  const m = _getDrawnMap(token);
  const g = m.get(cells);
  if (g) {
    try {
      g.destroy?.({ children: true });
    } catch (e) {}
    m.delete(cells);
  }
}

function _removeAllRingsGfx(token) {
  const m = _getDrawnMap(token);
  for (const [cells, g] of m.entries()) {
    try {
      g.destroy?.({ children: true });
    } catch (e) {}
    m.delete(cells);
  }
}

function _drawRing(token, cells, opts = {}) {
  if (!token) return;

  const linePx = Number.isFinite(Number(opts.linePx)) ? Number(opts.linePx) : 3;
  const alpha = Number.isFinite(Number(opts.alpha)) ? Number(opts.alpha) : 1.0;
  const zIndex = Number.isFinite(Number(opts.zIndex)) ? Number(opts.zIndex) : 9999;

  _removeRingGfx(token, cells);

  const color = _hexToInt(opts.color || _getTokenOwnerColor(token));
  const rPx = _ringRadiusPx(token, cells);

  const g = new PIXI.Graphics();
  g.zIndex = zIndex;
  g.alpha = alpha;

  g.lineStyle({ width: linePx, color, alpha, alignment: 0.5 });
  g.drawCircle((token.w ?? 0) / 2, (token.h ?? 0) / 2, rPx);

  token.addChild(g);
  token.sortChildren?.();

  _getDrawnMap(token).set(cells, g);
}

function _redrawAllForToken(token) {
  const st = _state();
  const uuid = token?.document?.uuid;
  if (!uuid) return;

  const set = st.enabled.get(uuid);
  if (!set || !set.size) {
    _removeAllRingsGfx(token);
    return;
  }

  // Перерисовываем всё включённое
  _removeAllRingsGfx(token);
  for (const cells of set.values()) {
    _drawRing(token, cells);
  }
}

function _shouldRerenderOnUpdate(change) {
  if (!change) return false;

  // При движении не нужно (кольцо child токена).
  // Пересчитывать нужно при изменении размеров/скейла/текстуры.
  return (
    "width" in change ||
    "height" in change ||
    "scale" in change ||
    "texture" in change
  );
}

// =========================
// Public API
// =========================

export function admRingsInit() {
  const st = _state();
  if (st.hooksInstalled) return;
  st.hooksInstalled = true;

  Hooks.on("drawToken", (token) => {
    const uuid = token?.document?.uuid;
    if (!uuid) return;

    const set = st.enabled.get(uuid);
    if (!set || !set.size) return;

    for (const cells of set.values()) {
      _drawRing(token, cells);
    }
  });

  Hooks.on("updateToken", (doc, change) => {
    const token = doc?.object;
    if (!token) return;

    const uuid = doc?.uuid;
    const set = uuid ? st.enabled.get(uuid) : null;
    if (!set || !set.size) return;

    if (_shouldRerenderOnUpdate(change)) {
      _redrawAllForToken(token);
    }
  });

  Hooks.on("deleteToken", (doc) => {
    const uuid = doc?.uuid;
    if (uuid) st.enabled.delete(uuid);

    const token = doc?.object;
    if (token) _removeAllRingsGfx(token);
  });

  Hooks.on("canvasReady", () => {
    for (const t of canvas.tokens.placeables) {
      const uuid = t?.document?.uuid;
      if (!uuid) continue;
      const set = st.enabled.get(uuid);
      if (!set || !set.size) continue;
      _redrawAllForToken(t);
    }
  });
}

export function admHasTokenRing(tokenOrDoc, cells) {
  const st = _state();
  const uuid = _tokenUuid(tokenOrDoc);
  if (!uuid) return false;
  const set = st.enabled.get(uuid);
  return !!set?.has(Number(cells));
}

export function admSetTokenRing(tokenOrDoc, cells, enabled) {
  const st = _state();
  const uuid = _tokenUuid(tokenOrDoc);
  if (!uuid) return;

  const c = Number(cells);
  if (!Number.isFinite(c) || c <= 0) return;

  let set = st.enabled.get(uuid);
  if (!set) {
    set = new Set();
    st.enabled.set(uuid, set);
  }

  if (enabled) set.add(c);
  else set.delete(c);

  if (!set.size) st.enabled.delete(uuid);

  const token = _asToken(tokenOrDoc);
  if (token) _redrawAllForToken(token);
}

export function admToggleTokenRing(tokenOrDoc, cells) {
  const on = admHasTokenRing(tokenOrDoc, cells);
  admSetTokenRing(tokenOrDoc, cells, !on);
}

export function admClearTokenRings(tokenOrDoc) {
  const st = _state();
  const uuid = _tokenUuid(tokenOrDoc);
  if (!uuid) return;

  st.enabled.delete(uuid);

  const token = _asToken(tokenOrDoc);
  if (token) _removeAllRingsGfx(token);
}

export function admRedrawTokenRings(tokenOrDoc) {
  const token = _asToken(tokenOrDoc);
  if (token) _redrawAllForToken(token);
}
