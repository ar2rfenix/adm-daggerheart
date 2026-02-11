import { ADMCharacterSheet, ADMNpcSheet } from "./module/sheets/actor-sheets.mjs";
import {
  ADMWeaponSheet,
  ADMArmorSheet,
  ADMAbilitySheet,
  ADMEnemyAbilitySheet,
  ADMGearSheet,
  ADMRelicSheet,
  ADMStatusSheet,
  ADMCardSheet
} from "./module/sheets/item-sheets.mjs";
import { admOpenPcRollDialog, admOpenNpcRollDialog } from "./module/roll/roll.mjs";

import { admInitDistance } from "./scripts/distance.mjs";
import { admFlyInit } from "./scripts/fly.mjs";
import { admRingsInit } from "./scripts/rings.mjs";

import { admRegisterTinyMCEConfig } from "./scripts/tinymce.mjs";
import { admInstallGlobalScrollRestorePatch, admInstallActorSheetLiveRefreshPatch } from "./scripts/scroll-restore.mjs";
import { admPatchSheetTitles } from "./scripts/sheet-title.mjs";
import { admTextHooksInit } from "./module/text/adm-text-hooks.mjs";
import { admNpcInitEnemyAbilitiesRerender, admNpcInitEnemyAbilityClicks} from "./module/sheets/npc-sheet.mjs";

import { admStatusInit } from "./module/status/status-ui.mjs";
import { admStatusModsInit } from "./module/status/status-modifiers.mjs";
import { admDamageInit } from "./scripts/damage-helper.mjs";

function clampNonNegativeNumber(n, fallback = 0) {
  const x = Number.isFinite(Number(n)) ? Number(n) : fallback;
  return Math.max(0, x);
}

Hooks.once("init", async () => {
	admInitDistance();
	admFlyInit();
  admPatchSheetTitles();
  admRegisterTinyMCEConfig();
  admInstallGlobalScrollRestorePatch();
  admInstallActorSheetLiveRefreshPatch();
  admStatusInit();
  admStatusModsInit();
  admTextHooksInit();
  admNpcInitEnemyAbilitiesRerender();
  admNpcInitEnemyAbilityClicks();
  admDamageInit();
  globalThis.admOpenPcRollDialog = admOpenPcRollDialog;
  globalThis.admOpenNpcRollDialog = admOpenNpcRollDialog;
 admRingsInit();
  await loadTemplates([
    "systems/adm-daggerheart/templates/actor/parts/inventory.hbs",
    "systems/adm-daggerheart/templates/actor/parts/enemy-inventory.hbs",
    "systems/adm-daggerheart/templates/actor/parts/status-list.hbs",
    "systems/adm-daggerheart/templates/partials/statuses.hbs",
	"systems/adm-daggerheart/templates/item/gear.hbs",
	"systems/adm-daggerheart/templates/item/relic.hbs",
	"systems/adm-daggerheart/templates/item/card.hbs",
	"systems/adm-daggerheart/templates/actor/parts/card-inventory.hbs",
	    "systems/adm-daggerheart/templates/partials/roll-pc.hbs",
    "systems/adm-daggerheart/templates/partials/roll-npc.hbs",
	"systems/adm-daggerheart/templates/partials/result-pc.hbs",
  "systems/adm-daggerheart/templates/partials/result-npc.hbs",
  "systems/adm-daggerheart/templates/partials/result-damage.hbs",


  ]);

  // COMPAT: Daggerheart Fear/Homebrew settings for Global Progress Clocks
  CONFIG.DH ??= {};
  CONFIG.DH.SETTINGS ??= {};
  CONFIG.DH.SETTINGS.gameSettings ??= {};
  CONFIG.DH.SETTINGS.gameSettings.Resources ??= {};
  CONFIG.DH.SETTINGS.gameSettings.Resources.Fear ??= "fear";
  CONFIG.DH.SETTINGS.gameSettings.Homebrew ??= "homebrew";

  // регистрируем только если ещё не зарегистрировано
  if (!game.settings.settings.has("daggerheart.fear")) {
    game.settings.register("daggerheart", "fear", {
      name: "Fear",
      hint: "Global Fear (compat for Global Progress Clocks)",
      scope: "world",
      config: false,
      type: Number,
      default: 0
    });
  }

  if (!game.settings.settings.has("daggerheart.homebrew")) {
    game.settings.register("daggerheart", "homebrew", {
      name: "Homebrew",
      hint: "Homebrew (compat): maxFear",
      scope: "world",
      config: false,
      type: Object,
      default: { maxFear: 12 }
    });
  }

 CONFIG.ADM_DAGGERHEART = {
  traits: {
    agility: "DAGGERHEART.TRAITS.AGILITY",
    strength: "DAGGERHEART.TRAITS.STRENGTH",
    finesse: "DAGGERHEART.TRAITS.FINESSE",
    instinct: "DAGGERHEART.TRAITS.INSTINCT",
    presence: "DAGGERHEART.TRAITS.PRESENCE",
    knowledge: "DAGGERHEART.TRAITS.KNOWLEDGE"
  },

  traitShort: {
    agility:  "Пров",
    strength: "Сила",
    finesse:  "Иск",
    instinct: "Чут",
    presence: "Вли",
    knowledge: "Зна"
  },

ranges: {
  none: "DAGGERHEART.RANGE.NONE",
  melee: "DAGGERHEART.RANGE.MELEE",
  veryClose: "DAGGERHEART.RANGE.VERY_CLOSE",
  close: "DAGGERHEART.RANGE.CLOSE",
  far: "DAGGERHEART.RANGE.FAR",
  veryFar: "DAGGERHEART.RANGE.VERY_FAR",
  outOfRange: "DAGGERHEART.RANGE.OUT_OF_RANGE"
},

rangeFeet: {
  melee: 5,
  veryClose: 15,
  close: 30,
  far: 45,
  veryFar: 60,
  outOfRange: Infinity
},


  npcTypes: {
    bruiser: "DAGGERHEART.NPC.TYPE.BRUISER",
    horde: "DAGGERHEART.NPC.TYPE.HORDE",
    leader: "DAGGERHEART.NPC.TYPE.LEADER",
    minion: "DAGGERHEART.NPC.TYPE.MINION",
    ranged: "DAGGERHEART.NPC.TYPE.RANGED",
    sneaky: "DAGGERHEART.NPC.TYPE.SNEAKY",
    social: "DAGGERHEART.NPC.TYPE.SOCIAL",
    solo: "DAGGERHEART.NPC.TYPE.SOLO",
    normal: "DAGGERHEART.NPC.TYPE.NORMAL",
    support: "DAGGERHEART.NPC.TYPE.SUPPORT",
    boss: "DAGGERHEART.NPC.TYPE.BOSS"
  },

  weapon: {
    grips: {
      oneHanded: "DAGGERHEART.WEAPON.GRIP.ONE_HANDED",
      twoHanded: "DAGGERHEART.WEAPON.GRIP.TWO_HANDED"
    },
    weaponTypes: {
      primary: "DAGGERHEART.WEAPON.TYPE.PRIMARY",
      secondary: "DAGGERHEART.WEAPON.TYPE.SECONDARY"
    },
    attributes: {
      agility: "DAGGERHEART.TRAITS.AGILITY",
      strength: "DAGGERHEART.TRAITS.STRENGTH",
      finesse: "DAGGERHEART.TRAITS.FINESSE",
      instinct: "DAGGERHEART.TRAITS.INSTINCT",
      presence: "DAGGERHEART.TRAITS.PRESENCE",
      knowledge: "DAGGERHEART.TRAITS.KNOWLEDGE"
    },
    damageTypes: {
      physical: "DAGGERHEART.DAMAGE.PHYSICAL",
      magical: "DAGGERHEART.DAMAGE.MAGICAL",
      direct: "DAGGERHEART.DAMAGE.DIRECT"
    }
  },
relic: {
  kinds: {
    item: "DAGGERHEART.GEAR.KIND.ITEM",
    consumable: "DAGGERHEART.GEAR.KIND.CONSUMABLE"
  },
  costTypes: {
    none: "DAGGERHEART.GEAR.COST.NONE",
    gold: "DAGGERHEART.GEAR.COST.GOLD"
  }
},

  gear: {
    kinds: {
      item: "DAGGERHEART.GEAR.KIND.ITEM",
      consumable: "DAGGERHEART.GEAR.KIND.CONSUMABLE"
    },
    costTypes: {
      none: "DAGGERHEART.GEAR.COST.NONE",
      gold: "DAGGERHEART.GEAR.COST.GOLD"
    }
  },
card: {
  templates: {
    domain: "DAGGERHEART.CARD.TEMPLATE.DOMAIN",
    society: "DAGGERHEART.CARD.TEMPLATE.SOCIETY",
    origin: "DAGGERHEART.CARD.TEMPLATE.ORIGIN",
    class: "DAGGERHEART.CARD.TEMPLATE.CLASS",
    subclass: "DAGGERHEART.CARD.TEMPLATE.SUBCLASS"
  },

    domains: {
      arcana: "DAGGERHEART.CARD.DOMAIN.ARCANA",
      majesty: "DAGGERHEART.CARD.DOMAIN.MAJESTY",
      valor: "DAGGERHEART.CARD.DOMAIN.VALOR",
      finesse: "DAGGERHEART.CARD.DOMAIN.FINESSE",
      blade: "DAGGERHEART.CARD.DOMAIN.BLADE",
      codex: "DAGGERHEART.CARD.DOMAIN.CODEX",
      bone: "DAGGERHEART.CARD.DOMAIN.BONE",
      blood: "DAGGERHEART.CARD.DOMAIN.BLOOD",
      wisdom: "DAGGERHEART.CARD.DOMAIN.WISDOM",
      midnight: "DAGGERHEART.CARD.DOMAIN.MIDNIGHT",
      dread: "DAGGERHEART.CARD.DOMAIN.DREAD"
    },
    cardTypes: {
      ability: "DAGGERHEART.CARD.TYPE.ABILITY",
      spell: "DAGGERHEART.CARD.TYPE.SPELL"
    }
  }
};


  const ActorsCollection = foundry.documents.collections.Actors;
  const ItemsCollection  = foundry.documents.collections.Items;

  ActorsCollection.registerSheet("adm-daggerheart", ADMCharacterSheet, { types: ["character"], makeDefault: true });
  ActorsCollection.registerSheet("adm-daggerheart", ADMNpcSheet,      { types: ["npc"],       makeDefault: true });

  ItemsCollection.registerSheet("adm-daggerheart", ADMWeaponSheet,  { types: ["weapon"],  makeDefault: true });
  ItemsCollection.registerSheet("adm-daggerheart", ADMArmorSheet,   { types: ["armor"],   makeDefault: true });
  ItemsCollection.registerSheet("adm-daggerheart", ADMAbilitySheet, { types: ["ability"], makeDefault: true });
  ItemsCollection.registerSheet("adm-daggerheart", ADMEnemyAbilitySheet, { types: ["enemyAbility"], makeDefault: true });
  ItemsCollection.registerSheet("adm-daggerheart", ADMGearSheet, { types: ["gear"], makeDefault: true });
  ItemsCollection.registerSheet("adm-daggerheart", ADMRelicSheet, { types: ["relic"], makeDefault: true });
ItemsCollection.registerSheet("adm-daggerheart", ADMCardSheet, { types: ["card"], makeDefault: true });
  ItemsCollection.registerSheet("adm-daggerheart", ADMStatusSheet, { types: ["status"], makeDefault: true });


});


Hooks.on("preUpdateActor", (actor, changes) => {
  // Если у актёра нет system — нечего клампить
  if (!actor?.system) return;

  // Универсальный кламп для dot-path и nested-структуры
  const clampPathMin0 = (path) => {
    // 1) dot-path обновления: changes["system.resources.hp.value"]
    if (Object.prototype.hasOwnProperty.call(changes, path)) {
      const v = Number(changes[path]);
      if (Number.isFinite(v) && v < 0) changes[path] = 0;
      if (!Number.isFinite(v)) changes[path] = 0;
      return;
    }

    // 2) nested обновления: changes.system.resources.hp.value
    const v2 = foundry.utils.getProperty(changes, path);
    if (v2 !== undefined) {
      const n = Number(v2);
      foundry.utils.setProperty(changes, path, (Number.isFinite(n) ? Math.max(0, n) : 0));
    }
  };

  const clampPathMin1 = (path) => {
    if (Object.prototype.hasOwnProperty.call(changes, path)) {
      const v = Number(changes[path]);
      changes[path] = (Number.isFinite(v) ? Math.max(1, v) : 1);
      return;
    }
    const v2 = foundry.utils.getProperty(changes, path);
    if (v2 !== undefined) {
      const n = Number(v2);
      foundry.utils.setProperty(changes, path, (Number.isFinite(n) ? Math.max(1, n) : 1));
    }
  };

  // --- Ресурсы: value никогда < 0
  for (const key of ["hp", "stress", "armor", "hope", "dodge"]) {
    clampPathMin0(`system.resources.${key}.value`);
    clampPathMin0(`system.resources.${key}.max`); // max тоже не ниже 0
  }

  // --- Пороги урона: никогда < 0 (если хотите минимум 1 — замените на clampPathMin1)
  clampPathMin0("system.damageThresholds.noticeable");
  clampPathMin0("system.damageThresholds.heavy");

  // --- (Опционально) уровни/мастерство, если надо минимум 1
  clampPathMin1("system.level");
  clampPathMin1("system.mastery");

  // --- Experiences (если прилетают целым массивом) — оставил вашу логику, но с безопасным числом
  const exArr = foundry.utils.getProperty(changes, "system.experiences");
  if (Array.isArray(exArr)) {
    foundry.utils.setProperty(
      changes,
      "system.experiences",
      exArr.map(e => ({
        ...e,
        value: Math.max(0, Number.isFinite(Number(e?.value)) ? Number(e.value) : 0)
      }))
    );
  }

  // --- Клип value по max (если max есть у актёра или в апдейте)
  for (const key of ["hp", "stress", "armor", "hope"]) {
    const pathV = `system.resources.${key}.value`;
    const pathM = `system.resources.${key}.max`;

    // берём nextValue из changes (dot-path или nested), иначе не трогаем
    const nextValue =
      Object.prototype.hasOwnProperty.call(changes, pathV) ? Number(changes[pathV]) :
      foundry.utils.getProperty(changes, pathV) !== undefined ? Number(foundry.utils.getProperty(changes, pathV)) :
      null;

    if (nextValue == null || !Number.isFinite(nextValue)) continue;

    const nextMax =
      Object.prototype.hasOwnProperty.call(changes, pathM) ? Number(changes[pathM]) :
      foundry.utils.getProperty(changes, pathM) !== undefined ? Number(foundry.utils.getProperty(changes, pathM)) :
      Number(actor.system?.resources?.[key]?.max);

    if (Number.isFinite(nextMax)) {
      const clipped = Math.min(Math.max(0, nextValue), Math.max(0, nextMax));
      // записываем туда же, откуда пришло
      if (Object.prototype.hasOwnProperty.call(changes, pathV)) changes[pathV] = clipped;
      else foundry.utils.setProperty(changes, pathV, clipped);
    } else {
      // max нет — просто минимум 0
      const clipped = Math.max(0, nextValue);
      if (Object.prototype.hasOwnProperty.call(changes, pathV)) changes[pathV] = clipped;
      else foundry.utils.setProperty(changes, pathV, clipped);
    }
  }
});

