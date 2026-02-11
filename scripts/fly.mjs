// systems/adm-daggerheart/scripts/fly.mjs
// ===== РЕЛЯТИВНЫЕ МЕТКИ ВЫСОТЫ (локально, без сокетов) =====

export function admFlyInit() {
  const INIT_KEY = "__admRelElevLabelsInitV1";
  if (globalThis[INIT_KEY]) return;
  globalThis[INIT_KEY] = true;

  const PROP = "_relElevOverlay";

  const SETTINGS = {
    fontFamily: 'Calibri, "Arial Unicode MS", Arial, Helvetica, sans-serif',

    // Размеры (базовые — без масштабирования)
    fontSizeLabel: 14,
    selfScaleRef: 0.6,

    // Позиция
    abovePad: 0,

    // Обычный стиль
    fill: "#ffffff",
    stroke: "#000000",
    strokeThickness: 3,

    // Стиль «своего» токена
    selfFill: "#d0d0d0",
    selfStroke: "#000000",
    selfStrokeThickness: 2,

    zIndex: 9999
  };

  // Можно заменить на локализацию, если захотите
  const FLIGHT_STATUS_LABEL = (globalThis.FLIGHT_STATUS_LABEL || "Полёт");

  let currentRefId = null;

  function getElevationLabel(elevation) {
    const abs = Math.abs(elevation);
    if (abs < 15) return "";
    return elevation >= 0 ? "▲" : "▼";
  }

  function getElevationColor(elevation) {
    const abs = Math.abs(Number(elevation) || 0);

    if (abs >= 75) return 0x000000; // вне зоны — чёрный
    if (abs >= 60) return 0xff0000; // очень далеко — красный
    if (abs >= 45) return 0xffa500; // далеко — оранжевый
    if (abs >= 30) return 0xffff00; // средняя — жёлтый
    if (abs >= 15) return 0x00ff00; // близко — зелёный

    return 0xffffff; // (не используется, т.к. до 15 вы не рисуете)
  }


  function clearOverlay(t) {
    const ov = t?.[PROP];
    if (!ov) return;
    try { ov.parent?.removeChild(ov); } catch {}
    try { ov.destroy?.({ children: true }); } catch { try { ov.destroy?.(); } catch {} }
    try { delete t[PROP]; } catch {}
  }

  function clearAll() {
    if (!canvas?.tokens?.placeables) return;
    for (const t of canvas.tokens.placeables) clearOverlay(t);
  }

  function cleanupOrphanOverlays(forceTokenId = null) {
    if (!canvas?.tokens) return;

    const alive = new Set(canvas.tokens.placeables.map(t => t.id));
    const children = Array.from(canvas.tokens.children ?? []);

    for (const ch of children) {
      const tid = ch?.__relElevTokenId;
      if (!tid) continue;

      const mustRemove =
        (forceTokenId && tid === forceTokenId) ||
        !alive.has(tid);

      if (!mustRemove) continue;

      try { ch.parent?.removeChild(ch); } catch {}
      try { ch.destroy?.({ children: true }); } catch { try { ch.destroy?.(); } catch {} }
    }
  }

  function pickOwnedTokenForUser() {
    const ctrl = canvas.tokens.controlled.find(t => t?.actor);
    if (ctrl) return ctrl;

    const charId = game.user?.character?.id;
    if (charId) {
      const tok = canvas.tokens.placeables.find(t => t?.actor?.id === charId);
      if (tok) return tok;
    }

    const owned = canvas.tokens.placeables.find(t => t?.isOwner && t?.actor);
    if (owned) return owned;

    return null;
  }

  function ensureReference() {
    let ref = currentRefId ? canvas.tokens.get(currentRefId) : null;

    if (!ref) {
      if (!game.user.isGM) {
        ref = pickOwnedTokenForUser();
        if (ref) currentRefId = ref.id;
      } else {
        ref = null;
      }
    }
    return ref;
  }

  function hasFlight(token) {
    try {
      const actor = token?.actor ?? null;
      const CLT = game.clt || game.cub;

      try { if (CLT?.hasCondition && actor && CLT.hasCondition(actor, FLIGHT_STATUS_LABEL)) return true; } catch {}
      try { if (CLT?.hasCondition && token && CLT.hasCondition(token, FLIGHT_STATUS_LABEL)) return true; } catch {}
      try { if (CLT?.hasCondition && CLT.hasCondition(FLIGHT_STATUS_LABEL, actor ?? token)) return true; } catch {}

      if (actor?.effects?.some(e => (e.label ?? e.name) === FLIGHT_STATUS_LABEL)) return true;

      const flags = actor?.getFlag?.("combat-utility-belt", "conditions");
      if (Array.isArray(flags) && flags.includes(FLIGHT_STATUS_LABEL)) return true;
    } catch {}
    return false;
  }

  function areAdjacentByGrid(a, b) {
    const d = canvas.dimensions || {};
    const size = d.size || 100;

    const rectFromToken = (t) => {
      const x1 = Math.floor(t.x / size);
      const y1 = Math.floor(t.y / size);
      const wC = Math.max(1, Math.round((t.document?.width  ?? (t.w / size)) || 1));
      const hC = Math.max(1, Math.round((t.document?.height ?? (t.h / size)) || 1));
      const x2 = x1 + wC - 1;
      const y2 = y1 + hC - 1;
      return { x1, y1, x2, y2 };
    };

    const A = rectFromToken(a);
    const B = rectFromToken(b);

    const dx = A.x1 > B.x2 ? (A.x1 - B.x2) : (B.x1 > A.x2 ? (B.x1 - A.x2) : 0);
    const dy = A.y1 > B.y2 ? (A.y1 - B.y2) : (B.y1 > A.y2 ? (B.y1 - A.y2) : 0);

    return Math.max(dx, dy) <= 1;
  }

  function shouldSuppressOneStepNear(refToken, targetToken, diffValue) {
    const absDiff = Math.abs(diffValue);
    if (absDiff < 15 || absDiff >= 30) return false;
    if (hasFlight(refToken) || hasFlight(targetToken)) return false;
    return areAdjacentByGrid(refToken, targetToken);
  }

  function makeLabelGroup({ label, token, small = false, selfStyle = false, color = null }) {
    const scale = small ? SETTINGS.selfScaleRef : 1.0;

    const style = {
      fontFamily: SETTINGS.fontFamily,
      fontWeight: "bold",
      align: "center",
      fontSize: Math.max(8, Math.round(SETTINGS.fontSizeLabel)),
      fill: color ?? (selfStyle ? SETTINGS.selfFill : SETTINGS.fill),
      stroke: selfStyle ? SETTINGS.selfStroke : SETTINGS.stroke,
      strokeThickness: selfStyle ? SETTINGS.selfStrokeThickness : SETTINGS.strokeThickness
    };

    const text = new PIXI.Text(label, style);
    text.anchor.set(0.5, 1);

    const grp = new PIXI.Container();
    grp.addChild(text);

    if (scale !== 1) grp.scale.set(scale);

    const dims = canvas.dimensions;
    const gridSize = dims?.size ?? token.w;
    const docWidth = token.document?.width ?? (token.w / gridSize) ?? 1;
    const tokenWidthPx = docWidth * gridSize;

    grp.x = token.x + tokenWidthPx / 2;
    grp.y = token.y - SETTINGS.abovePad;

    grp.zIndex = SETTINGS.zIndex;
    canvas.tokens.sortableChildren = true;

    const w = text.width;
    const h = text.height;
    grp.hitArea = new PIXI.Rectangle(-w / 2, -h, w, h);

    grp.__relElevTokenId = token.id;

    return grp;
  }

  function drawSelfLabel(t, small = false, selfStyle = false) {
    clearOverlay(t);
    if (!t.visible || t.isVisible === false) return;

    const elev = t.document?.elevation ?? 0;
    const lbl = getElevationLabel(elev);
    if (!lbl) return;

    const color = getElevationColor(elev);
    const grp = makeLabelGroup({ label: lbl, token: t, small, selfStyle, color });

    canvas.tokens.addChild(grp);
    t[PROP] = grp;
  }

  function drawDiffLabel(t, refToken, refElev) {
    clearOverlay(t);
    if (!t.visible || t.isVisible === false) return;

    const theirElev = t.document?.elevation ?? 0;
    const diff = theirElev - refElev;

    if (shouldSuppressOneStepNear(refToken, t, diff)) return;

    const lbl = getElevationLabel(diff);
    if (!lbl) return;

    const color = getElevationColor(diff);
    const grp = makeLabelGroup({ label: lbl, token: t, small: false, selfStyle: false, color });

    canvas.tokens.addChild(grp);
    t[PROP] = grp;
  }

  function refreshAll() {
    if (!canvas?.tokens?.placeables) return;

    cleanupOrphanOverlays();

    const ref = ensureReference();

    if (!ref && game.user.isGM) {
      for (const t of canvas.tokens.placeables) {
        if (!t.visible || t.isVisible === false) {
          clearOverlay(t);
          continue;
        }
        drawSelfLabel(t, false, false);
      }
      return;
    }

    if (!ref) {
      clearAll();
      return;
    }

    const refElev = ref.document?.elevation ?? 0;

    for (const t of canvas.tokens.placeables) {
      if (!t.visible || t.isVisible === false) {
        clearOverlay(t);
        continue;
      }

      if (t.id === ref.id) drawSelfLabel(t, true, true);
      else drawDiffLabel(t, ref, refElev);
    }
  }

  // --- Hooks ---
  Hooks.on("controlToken", () => {
    setTimeout(() => {
      const first = canvas.tokens.controlled[0] ?? null;
      currentRefId = first?.id ?? null;
      refreshAll();
    }, 0);
  });

  Hooks.on("updateToken", () => refreshAll());
  Hooks.on("refreshToken", () => refreshAll());
  Hooks.on("createToken", () => refreshAll());

  Hooks.on("deleteToken", (doc) => {
    if (doc.id === currentRefId) currentRefId = null;
    cleanupOrphanOverlays(doc.id);
    refreshAll();
  });

  Hooks.on("canvasReady", () => {
    const first = canvas.tokens.controlled[0] ?? null;
    currentRefId = first?.id ?? null;
    refreshAll();
  });
}
