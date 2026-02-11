// systems/adm-daggerheart/scripts/scroll-restore.mjs

/* ------------------------------------------------------------------------- */
/* Helpers: root / scroll / focus                                             */
/* ------------------------------------------------------------------------- */

function getRootElement(app) {
  const el = app?.element;
  if (!el) return null;

  // Foundry может отдавать jQuery
  if (el instanceof HTMLElement) return el;
  if (el[0] instanceof HTMLElement) return el[0];

  return null;
}

function listScrollableNodes(root) {
  if (!root) return [];

  const nodes = root.querySelectorAll("*");
  const out = [];

  nodes.forEach((n) => {
    if (!(n instanceof HTMLElement)) return;

    const hasScroll = n.scrollHeight > n.clientHeight + 1;
    if (!hasScroll) return;

    out.push(n);
  });

  return out;
}

function captureScroll(root) {
  const nodes = listScrollableNodes(root);
  if (!nodes.length) return null;

  const snap = [];
  nodes.forEach((n, i) => {
    const st = n.scrollTop;
    if (!st) return;

    const key = n.dataset.admScrollKey || `adm-scroll-${i}`;
    n.dataset.admScrollKey = key;

    snap.push({ key, st });
  });

  return snap.length ? snap : null;
}

function restoreScroll(root, snap) {
  if (!root || !snap) return;

  for (const s of snap) {
    const n = root.querySelector(`[data-adm-scroll-key="${CSS.escape(s.key)}"]`);
    if (n) n.scrollTop = s.st;
  }
}

function captureFocus(root) {
  const a = document.activeElement;
  if (!root || !a) return null;
  if (!(a instanceof HTMLElement)) return null;
  if (!root.contains(a)) return null;

  const name = a.getAttribute("name");
  if (name) return { type: "name", value: name };

  const id = a.id;
  if (id) return { type: "id", value: id };

  const action = a.dataset?.action;
  if (action) return { type: "action", value: action };

  return null;
}

function restoreFocus(root, snap) {
  if (!root || !snap) return;

  let el = null;

  if (snap.type === "name") el = root.querySelector(`[name="${CSS.escape(snap.value)}"]`);
  else if (snap.type === "id") el = root.querySelector(`#${CSS.escape(snap.value)}`);
  else if (snap.type === "action") el = root.querySelector(`[data-action="${CSS.escape(snap.value)}"]`);

  if (!el) return;

  try {
    el.focus({ preventScroll: true });
  } catch (e) {
    el.focus();
  }
}

function findDocumentUpdatePrototype() {
  const candidates = [
    foundry?.abstract?.Document?.prototype,
    foundry?.documents?.BaseDocument?.prototype,
    foundry?.documents?.ClientDocumentMixin?.prototype,
  ].filter(Boolean);

  for (const p of candidates) {
    if (typeof p.update === "function") return p;
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Patch 1: Scroll + focus restore on Document.update                          */
/* ------------------------------------------------------------------------- */

export function admInstallGlobalScrollRestorePatch() {
  const proto = findDocumentUpdatePrototype();
  if (!proto || proto.__admScrollRestorePatched) return;

  const originalUpdate = proto.update;

  proto.update = async function (data, options = {}) {
    const willRender = options?.render !== false;

    let appSnaps = null;

    if (willRender && this?.apps?.size) {
      appSnaps = new Map();
      for (const [appId, app] of this.apps) {
        const root = getRootElement(app);
        if (!root) continue;

        const scroll = captureScroll(root);
        const focus = captureFocus(root);

        if (scroll || focus) appSnaps.set(appId, { scroll, focus });
      }
    }

    const res = await originalUpdate.call(this, data, options);

    if (willRender && appSnaps && this?.apps?.size) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          for (const [appId, app] of this.apps) {
            const snap = appSnaps.get(appId);
            if (!snap) continue;

            const root = getRootElement(app);
            if (!root) continue;

            restoreScroll(root, snap.scroll);
            restoreFocus(root, snap.focus);
          }
        });
      });
    }

    return res;
  };

  Object.defineProperty(proto, "__admScrollRestorePatched", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

/* ------------------------------------------------------------------------- */
/* Patch 2: Live refresh actor sheets on embedded Item changes                 */
/* ------------------------------------------------------------------------- */

/**
 * В Foundry 13 ActorSheetV2.render(...) не имеет опции focus, и при любом render
 * окно часто делает bringToFront() => активируется чарник.
 *
 * Решение:
 * 1) Глобально патчим ApplicationV2.prototype.bringToFront так, чтобы он
 *    ничего не делал, если на инстансе стоит флаг __admSilentRender.
 * 2) При live-refresh ставим флаг, делаем render, снимаем флаг.
 * 3) После render возвращаем фокус на исходный activeElement (обычно это инпут
 *    в листе предмета), а также восстанавливаем скролл чарника.
 */

const LIVE_KEY = "__admLiveActorSheetRefreshV2";

/* ----------------------------- */
/* Internal: state               */
/* ----------------------------- */

function _ensureLiveState() {
  let st = globalThis[LIVE_KEY];
  if (st) return st;

  st = globalThis[LIVE_KEY] = {
    installed: false,
    byActorId: new Map(), // actorId -> Set(sheet)
    queued: new Set(), // actorId
    bringToFrontPatched: false,
  };

  return st;
}

/* ----------------------------- */
/* Internal: safe bringToFront   */
/* ----------------------------- */

function _patchBringToFrontOnce() {
  const st = _ensureLiveState();
  if (st.bringToFrontPatched) return;

  const proto = foundry?.applications?.api?.ApplicationV2?.prototype;
  if (!proto || proto.__admBringToFrontPatched) {
    st.bringToFrontPatched = true;
    return;
  }

  const original = proto.bringToFront;

  // bringToFront(options?) : this
  proto.bringToFront = function (...args) {
    // Подавляем активацию окна только в режиме "тихого" рендера
    if (this && this.__admSilentRender) return this;
    return original?.apply(this, args);
  };

  Object.defineProperty(proto, "__admBringToFrontPatched", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  st.bringToFrontPatched = true;
}

/* ----------------------------- */
/* Internal: tracking sheets      */
/* ----------------------------- */

function _getActorSheetV2Proto() {
  return foundry?.applications?.sheets?.ActorSheetV2?.prototype ?? null;
}

function _isAliveSheet(sheet) {
  const root = getRootElement(sheet);
  if (!root) return false;
  return document.body.contains(root);
}

function _registerSheet(sheet) {
  const st = _ensureLiveState();
  const actorId = sheet?.actor?.id;
  if (!actorId) return;

  let set = st.byActorId.get(actorId);
  if (!set) {
    set = new Set();
    st.byActorId.set(actorId, set);
  }
  set.add(sheet);
}

function _unregisterSheet(sheet) {
  const st = _ensureLiveState();
  const actorId = sheet?.actor?.id;
  if (!actorId) return;

  const set = st.byActorId.get(actorId);
  if (!set) return;

  set.delete(sheet);
  if (!set.size) st.byActorId.delete(actorId);
}

/* ----------------------------- */
/* Internal: scroll capture/restore for ActorSheetV2 */
/* ----------------------------- */

function _getScrollableSelectorsForSheet(sheet) {
  // Стараемся использовать стабильные селекторы, заданные в PARTS (как у вас)
  const sel = sheet?.constructor?.PARTS?.body?.scrollable;
  if (Array.isArray(sel) && sel.length) return sel.map(String);

  // Фоллбек: если где-то будет options.scrollable
  const opt = sheet?.options?.scrollable;
  if (Array.isArray(opt) && opt.length) return opt.map(String);

  return [];
}

function _captureSheetScroll(sheet) {
  const root = getRootElement(sheet);
  if (!root) return null;

  const selectors = _getScrollableSelectorsForSheet(sheet);
  if (selectors.length) {
    const snap = [];
    for (const s of selectors) {
      try {
        const el = root.querySelector(s);
        if (!el) continue;
        const st = el.scrollTop;
        if (!st) continue;
        snap.push({ selector: s, st });
      } catch (e) {}
    }
    return snap.length ? { mode: "selectors", snap } : null;
  }

  // Фоллбек: общий механизм (может не восстановиться при полной пересборке DOM)
  const sc = captureScroll(root);
  return sc ? { mode: "dataset", snap: sc } : null;
}

function _restoreSheetScroll(sheet, scrollSnap) {
  if (!scrollSnap) return;

  const root = getRootElement(sheet);
  if (!root) return;

  if (scrollSnap.mode === "selectors") {
    for (const s of scrollSnap.snap ?? []) {
      try {
        const el = root.querySelector(s.selector);
        if (el) el.scrollTop = s.st;
      } catch (e) {}
    }
    return;
  }

  if (scrollSnap.mode === "dataset") {
    try {
      restoreScroll(root, scrollSnap.snap);
    } catch (e) {}
  }
}

/* ----------------------------- */
/* Internal: queued refresh       */
/* ----------------------------- */

async function _silentRenderSheet(sheet) {
  // 1) сохраняем скролл чарника
  const scrollSnap = _captureSheetScroll(sheet);

  // 2) подавляем bringToFront на время рендера
  sheet.__admSilentRender = true;
  try {
    // В v13 render принимает объект опций (ApplicationRenderOptions & DocumentSheetRenderOptions)
    // force=true — чтобы реально пересобралось
    await sheet.render?.({ force: true });
  } catch (e) {
    // не шумим
  } finally {
    sheet.__admSilentRender = false;
  }

  // 3) восстанавливаем скролл
  try {
    _restoreSheetScroll(sheet, scrollSnap);
  } catch (e) {}
}

function _queueRenderActor(actorId) {
  const st = _ensureLiveState();
  if (!actorId) return;
  if (st.queued.has(actorId)) return;

  st.queued.add(actorId);

  // Небольшая задержка, чтобы:
  // - updateItem успел завершить свои микро-обновления
  // - не дёргать чарник на каждую букву слишком агрессивно
  setTimeout(async () => {
    st.queued.delete(actorId);

    const set = st.byActorId.get(actorId);
    if (!set || !set.size) return;

    // сохраняем текущий активный элемент (обычно инпут в ItemSheet)
    const active = document.activeElement;

    for (const sheet of Array.from(set)) {
      if (!_isAliveSheet(sheet)) {
        _unregisterSheet(sheet);
        continue;
      }
      await _silentRenderSheet(sheet);
    }

    // возвращаем фокус обратно (если элемент ещё существует)
    if (active instanceof HTMLElement && document.body.contains(active)) {
      try {
        active.focus({ preventScroll: true });
      } catch (e) {
        try {
          active.focus();
        } catch (e2) {}
      }
    }
  }, 25);
}

/* ------------------------------------------------------------------------- */
/* Public installer                                                          */
/* ------------------------------------------------------------------------- */

export function admInstallActorSheetLiveRefreshPatch() {
  const st = _ensureLiveState();
  if (st.installed) return;

  // Патчим bringToFront (только для "тихих" рендеров)
  _patchBringToFrontOnce();

  // 1) Авто-трекинг всех ActorSheetV2 (без правок ваших листов)
  const proto = _getActorSheetV2Proto();
  if (proto && !proto.__admLiveRefreshPatched) {
    const originalOnRender = proto._onRender;
    const originalClose = proto.close;

    proto._onRender = function (...args) {
      try {
        _registerSheet(this);
      } catch (e) {}
      return originalOnRender?.apply(this, args);
    };

    proto.close = async function (...args) {
      try {
        _unregisterSheet(this);
      } catch (e) {}
      return originalClose?.apply(this, args);
    };

    Object.defineProperty(proto, "__admLiveRefreshPatched", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }

  // 2) Ререндерим чарник, когда меняются embedded Items
  // Важно: реагируем только на embedded (item.parent instanceof Actor)
  Hooks.on("updateItem", (item) => {
    const actor = item?.parent;
    const actorId = actor?.id;
    if (!actorId) return;
    _queueRenderActor(actorId);
  });

  Hooks.on("createItem", (item) => {
    const actor = item?.parent;
    const actorId = actor?.id;
    if (!actorId) return;
    _queueRenderActor(actorId);
  });

  Hooks.on("deleteItem", (item) => {
    const actor = item?.parent;
    const actorId = actor?.id;
    if (!actorId) return;
    _queueRenderActor(actorId);
  });

  st.installed = true;
}
