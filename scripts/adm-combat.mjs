// scripts/adm-combat.mjs
// Ctrl+LMB spotlight + custom Combat document

const ADM_CTRL_FLAG = "__admCtrlSpotlightBound";

/* ═══════════════════════════════════════════
   1.  Ctrl + ЛКМ — хоткей на токенах
   ═══════════════════════════════════════════ */

export function initAdmHotkeys() {
  Hooks.once("canvasReady", () => {
    bindCtrlSpotlightToAllTokens();
    console.log("[ADM] Hotkeys initialized (canvasReady)");
  });

  Hooks.on("refreshToken", (token) => {
    bindCtrlSpotlightToToken(token);
  });
}

function bindCtrlSpotlightToAllTokens() {
  const tokens = canvas?.tokens?.placeables ?? [];
  for (const t of tokens) bindCtrlSpotlightToToken(t);
  console.log("[ADM] Ctrl+Spotlight bound to tokens:", tokens.length);
}

function bindCtrlSpotlightToToken(token) {
  if (!token || token[ADM_CTRL_FLAG]) return;
  token[ADM_CTRL_FLAG] = true;

  token.on("pointerdown", (e) => {
    const oe = e?.data?.originalEvent;
    if (!oe) return;

    // Только Ctrl + ЛКМ
    if (!oe.ctrlKey || oe.button !== 0) return;

    void handleCtrlClickTokenSpotlight(token);
  });
}

async function handleCtrlClickTokenSpotlight(token) {
  try {
    if (!game.user.isGM) return;
    if (!canvas?.scene) return;

    console.log("[ADM] Ctrl+LMB token:", token?.name);

    // 1) получить/создать бой на этой сцене
    let combat = game.combat;
    const sameScene = combat && (combat.scene?.id === canvas.scene.id);

    if (!sameScene) {
      combat = await Combat.create({ scene: canvas.scene.id, active: true });
      await combat.activate();
      console.log("[ADM] Combat created+activated:", combat?.id);
    } else if (!combat.active) {
      await combat.activate();
      console.log("[ADM] Combat activated:", combat?.id);
    }

    // 2) если бой не начат — добавить все токены сцены и стартовать
    const started = (combat.started ?? ((combat.round ?? 0) > 0)) === true;
    if (!started) {
      await addAllSceneTokensToCombat(combat);
      await startCombatSafe(combat);
      console.log("[ADM] Combat started");
    }

    // 3) spotlight на токен
    await giveSpotlightToToken(combat, token);

    // 4) очистка истории перемещений
    await clearMovementHistoriesSafe(combat);
  } catch (err) {
    console.error("[ADM] Ctrl+Spotlight ERROR:", err);
  }
}

async function addAllSceneTokensToCombat(combat) {
  if (!combat) return;

  const existing = new Set(
    (combat.combatants ?? []).map(c => c.tokenId).filter(Boolean)
  );
  const docs = canvas?.scene?.tokens ?? [];
  const toAdd = [];

  for (const td of docs) {
    if (!td?.actorId) continue;
    if (existing.has(td.id)) continue;
    toAdd.push({
      tokenId:  td.id,
      sceneId:  canvas.scene.id,
      actorId:  td.actorId,
      hidden:   td.hidden ?? false
    });
  }

  if (!toAdd.length) return;
  await combat.createEmbeddedDocuments("Combatant", toAdd);
  console.log("[ADM] Added combatants:", toAdd.length);
}

async function startCombatSafe(combat) {
  if (!combat) return;

  if (typeof combat.startCombat === "function") {
    await combat.startCombat();
    return;
  }

  if ((combat.round ?? 0) === 0) {
    await combat.update({ round: 1, turn: 0 });
  }
}

async function giveSpotlightToToken(combat, token) {
  if (!combat || !token) return;

  const combatant =
    combat.combatants.find(c => c.tokenId === token.id) ||
    combat.combatants.find(c => c.tokenId === token.document?.id);

  if (!combatant) {
    console.warn("[ADM] Token not in combat:", token?.name);
    return;
  }

  const idx = combat.turns.indexOf(combatant);
  if (idx < 0) return;

  // Снимаем таргет со всех целей у всех пользователей
  clearAllTargets();

  await combat.update({ turn: idx });
  ui.combat?.render?.();
  console.log("[ADM] Spotlight ->", combatant.name);
}

function clearAllTargets() {
  // Снимаем собственные таргеты
  for (const t of game.user.targets) {
    t.setTarget(false, { releaseOthers: false, groupSelection: false });
  }

  // Снимаем таргеты у всех токенов на канвасе (visual clear)
  for (const t of canvas?.tokens?.placeables ?? []) {
    if (t.targeted?.size) {
      t.targeted.clear();
      t.renderFlags?.set?.({ refreshTarget: true });
    }
  }

  console.log("[ADM] All targets cleared");
}

async function clearMovementHistoriesSafe(combat) {
  try {
    if (combat && typeof combat.clearMovementHistories === "function") {
      await combat.clearMovementHistories();
      console.log("[ADM] Movement histories cleared via combat.clearMovementHistories()");
      return;
    }
  } catch (e) {
    console.warn("[ADM] clearMovementHistories failed:", e);
  }

  // fallback: чистим ruler
  try { canvas?.controls?.ruler?.clear?.(); } catch {}
  try {
    for (const t of canvas?.tokens?.placeables ?? []) {
      try { t?.ruler?.clear?.(); } catch {}
    }
  } catch {}
  console.log("[ADM] Movement histories cleared (fallback ruler)");
}

/* ═══════════════════════════════════════════
   2.  Custom Combat (без раундов/ходов)
   ═══════════════════════════════════════════ */

export class ADMCombat extends Combat {

  /** Блокируем переключение хода — остаёмся на текущем */
  async nextTurn()     { return this.update({ turn: this.turn }); }
  async previousTurn() { return this.update({ turn: this.turn }); }

  /** Не сортируем комбатантов — порядок как добавлены */
  _sortCombatants(_a, _b) { return 0; }
}
