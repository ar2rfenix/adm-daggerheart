// scripts/adm-combat.mjs
// Ctrl+LMB spotlight, combat tracker UI, custom Combat document

const ADM_CTRL_FLAG = "__admCtrlSpotlightBound";
const SYSTEM_ID = "adm-daggerheart";
const SOCKET_NS = `system.${SYSTEM_ID}`;

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

  await combat.update({ turn: idx });
  ui.combat?.render?.();
  console.log("[ADM] Spotlight ->", combatant.name);
}

async function clearMovementHistoriesSafe(combat) {
  try {
    if (combat && typeof combat.clearMovementHistories === "function") {
      await combat.clearMovementHistories();
      console.log("[ADM] Movement histories cleared");
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
  console.log("[ADM] Movement histories cleared (fallback)");
}

/* ═══════════════════════════════════════════
   2.  Spotlight Initiative Tracker (UI хуки)
   ═══════════════════════════════════════════ */

export class ADMSpotlightTracker {

  static initialize() {
    Hooks.on("combatStart",          this._onCombatStart.bind(this));
    Hooks.on("createCombat",         this._onCreateCombat.bind(this));
    Hooks.on("renderCombatTracker",  this._onRenderCombatTracker.bind(this));

    game.socket.on(SOCKET_NS, this._handleSocketMessage.bind(this));
  }

  /* --- флаги при создании / старте боя --- */

  static _onCreateCombat(combat, _options, _userId) {
    if (game.user.isGM) {
      combat.setFlag(SYSTEM_ID, "spotlightRequests", {});
    }
  }

  static _onCombatStart(combat, _updateData) {
    if (game.user.isGM) {
      combat.setFlag(SYSTEM_ID, "spotlightRequests", {});
    }
  }

  /* --- рендер CombatTracker: скрываем лишнее, добавляем spotlight-кнопки --- */

  static async _onRenderCombatTracker(app, html, data) {
    if (!game.combat) return;

    const $html = $(html);
    const combatants = $html.find(".combatant");

    // Убираем заголовок раунда
    $html.find(".encounter-title").remove();

    // Убираем кнопки навигации раундов/ходов
    $html.find("nav.combat-controls")
      .find('[data-action="previousRound"], [data-action="nextRound"], [data-action="previousTurn"], [data-action="nextTurn"]')
      .remove();

    // Контекстное меню: убираем «Reset Initiative»
    $html.find(".encounter-context-menu")
      .off("click.spotlight")
      .on("click.spotlight", () => {
        setTimeout(() => {
          $(document.body).find(".menu, .context-menu, .application.menu").each((_i, menu) => {
            $(menu).find("button, .menu-item, li, a")
              .filter((_j, el) => (el.innerText || "").trim().toLowerCase().includes("reset initiative"))
              .remove();
          });
        }, 50);
      });

    combatants.each((_i, el) => {
      const combatantId = el.dataset.combatantId;
      const combatant = game.combat.combatants.get(combatantId);
      if (!combatant) return;

      const $init = $(el).find(".token-initiative");
      $init.find('[data-action="rollInitiative"]').remove();
      $init.find(".give-spotlight, .approve-spotlight, .deny-spotlight, .ask-spotlight, .cancel-spotlight").remove();

      if (game.user.isGM) {
        /* --- GM: кнопка «Give Spotlight» --- */
        const $give = $(
          `<button type="button" class="combatant-control give-spotlight" title="Give Spotlight"><i class="fa-solid fa-hand-point-right"></i></button>`
        );
        $give.on("click", () => this._giveSpotlight(combatant));
        $init.append($give);

        const requests = game.combat.getFlag(SYSTEM_ID, "spotlightRequests") || {};
        if (requests[combatantId]) {
          $(el).addClass("spotlight-requested");
          const $approve = $(
            `<button type="button" class="combatant-control approve-spotlight" title="Approve"><i class="fa-solid fa-check"></i></button>`
          );
          const $deny = $(
            `<button type="button" class="combatant-control deny-spotlight" title="Deny"><i class="fa-solid fa-xmark"></i></button>`
          );
          $approve.on("click", () => this._approveSpotlight(combatant));
          $deny.on("click",    () => this._denySpotlight(combatant));
          $give.hide();
          $init.append($approve, $deny);
        }
      } else if (combatant.isOwner) {
        /* --- Игрок: Ask / Cancel --- */
        const requests = game.combat.getFlag(SYSTEM_ID, "spotlightRequests") || {};

        if (requests[combatantId]) {
          $(el).addClass("spotlight-requested");
          const $cancel = $(
            `<button type="button" class="combatant-control cancel-spotlight" title="Cancel"><i class="fa-solid fa-hand"></i></button>`
          );
          $cancel.on("click", () => this._cancelSpotlight(combatant));
          $init.append($cancel);
        } else {
          const $ask = $(
            `<button type="button" class="combatant-control ask-spotlight" title="Ask for Spotlight"><i class="fa-regular fa-hand"></i></button>`
          );
          $ask.on("click", () => this._askForSpotlight(combatant));
          $init.append($ask);
        }
      }

      if (combatant.id === game.combat.current?.combatantId) {
        $(el).addClass("active");
      }
    });
  }

  /* --- GM: передать spotlight --- */

  static async _giveSpotlight(combatant) {
    if (!game.user.isGM) return;
    const combat = game.combat;
    if (!combat) return;

    const idx = combat.turns.indexOf(combatant);
    if (idx === -1) return;

    await combat.update({ turn: idx });

    ChatMessage.create({
      content: `<div class="spotlight-message"><i class="fa-solid fa-hand-point-right"></i> <strong>${combatant.name}</strong> has been given the spotlight!</div>`,
      speaker: { alias: " " }
    });
  }

  /* --- Игрок: попросить spotlight --- */

  static async _askForSpotlight(combatant) {
    const combat = game.combat;
    if (!combat) return;

    game.socket.emit(SOCKET_NS, {
      type: "spotlightRequest",
      combatantId:   combatant.id,
      combatantName: combatant.name,
      userId:        game.user.id,
      combatId:      combat.id
    });

    ChatMessage.create({
      content: `<div class="spotlight-message"><i class="fa-regular fa-hand"></i> <strong>${combatant.name}</strong> is asking for the spotlight!</div>`,
      speaker: { alias: " " },
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
  }

  static async _cancelSpotlight(combatant) {
    const combat = game.combat;
    if (!combat) return;

    game.socket.emit(SOCKET_NS, {
      type: "cancelSpotlightRequest",
      combatantId: combatant.id,
      combatId:    combat.id
    });
  }

  static async _approveSpotlight(combatant) {
    if (!game.user.isGM) return;
    await this._giveSpotlight(combatant);
    await this._clearSpotlightRequest(combatant);
  }

  static async _denySpotlight(combatant) {
    if (!game.user.isGM) return;
    await this._clearSpotlightRequest(combatant);

    ChatMessage.create({
      content: `<div class="spotlight-message"><i class="fa-solid fa-xmark"></i> <strong>${combatant.name}</strong>'s spotlight request was denied.</div>`,
      speaker: { alias: " " }
    });
  }

  static async _clearSpotlightRequest(combatant) {
    const combat = game.combat;
    if (!combat) return;

    const requests = combat.getFlag(SYSTEM_ID, "spotlightRequests") || {};
    delete requests[combatant.id];
    await combat.setFlag(SYSTEM_ID, "spotlightRequests", requests);
    ui.combatTracker.render();
  }

  /* --- Сокет-обработчик (GM) --- */

  static async _handleSocketMessage(data) {
    if (!game.user.isGM) return;

    const combat = game.combats.get(data.combatId);
    if (!combat) return;

    if (data.type === "spotlightRequest") {
      const requests = combat.getFlag(SYSTEM_ID, "spotlightRequests") || {};
      requests[data.combatantId] = { userId: data.userId, timestamp: Date.now() };
      await combat.setFlag(SYSTEM_ID, "spotlightRequests", requests);
      ui.combatTracker.render();
    } else if (data.type === "cancelSpotlightRequest") {
      const requests = combat.getFlag(SYSTEM_ID, "spotlightRequests") || {};
      delete requests[data.combatantId];
      await combat.setFlag(SYSTEM_ID, "spotlightRequests", requests);
      ui.combatTracker.render();
    }
  }
}

/* ═══════════════════════════════════════════
   3.  Custom Combat (без раундов/ходов)
   ═══════════════════════════════════════════ */

export class ADMCombat extends Combat {

  /** Блокируем переключение хода — остаёмся на текущем */
  async nextTurn()     { return this.update({ turn: this.turn }); }
  async previousTurn() { return this.update({ turn: this.turn }); }

  /** Не сортируем комбатантов — порядок как добавлены */
  _sortCombatants(_a, _b) { return 0; }
}
