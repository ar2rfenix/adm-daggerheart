// systems/adm-daggerheart/module/sheets/item-sheets.mjs
import { admApplyTextReplacements } from "../text/adm-text-hooks.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const TE = foundry.applications.ux.TextEditor.implementation;

import { admInitTinyMCE, admDestroyTinyMCE } from "../../scripts/tinymce.mjs";

export class ADMBaseItemSheet extends HandlebarsApplicationMixin(
  foundry.applications.sheets.ItemSheetV2
) {
  static DEFAULT_OPTIONS = {
    classes: ["adm-daggerheart", "sheet", "item"],
    width: 640,
    height: 620,
    resizable: true,
    form: {
      submitOnChange: false,
      closeOnSubmit: false,
    },
  };

  get title() {
    return this.document?.name ?? this.item?.name ?? "";
  }

  _admEditMode = false;
_admSpoilerOpen = {};

  /* -------------------------------------------- */
  /* Rich text (TinyMCE) helpers                   */
  /* -------------------------------------------- */

   _admGetRichEditorDefs() {
    const t = this.item?.type;

    // weapon -> system.notes
    if (t === "weapon") {
      return [
        {
          selector: "textarea.adm-tinymce[name='system.notes']",
          updatePath: "system.notes",
          height: 260,
          contextKey: "notesHTML",
        },
      ];
    }

    // armor -> system.description
    if (t === "armor") {
      return [
        {
          selector: "textarea.adm-tinymce[name='system.description']",
          updatePath: "system.description",
          height: 260,
          contextKey: "descriptionHTML",
        },
      ];
    }

    // gear -> system.description
    if (t === "gear") {
      return [
        {
          selector: "textarea.adm-tinymce[name='system.description']",
          updatePath: "system.description",
          height: 260,
          contextKey: "descriptionHTML",
        },
      ];
    }

    // relic -> system.description
    if (t === "relic") {
      return [
        {
          selector: "textarea.adm-tinymce[name='system.description']",
          updatePath: "system.description",
          height: 260,
          contextKey: "descriptionHTML",
        },
      ];
    }

    // card -> depends on template
    // card -> depends on template
if (t === "card") {
  const tpl = String(this.item?.system?.template ?? "").trim().toLowerCase();

  // subclass: 3 separate rich fields
  if (tpl === "subclass") {
    return [
      {
        selector: "textarea.adm-tinymce[name='system.baseText']",
        updatePath: "system.baseText",
        height: 260,
        contextKey: "baseTextHTML",
      },
      {
        selector: "textarea.adm-tinymce[name='system.specText']",
        updatePath: "system.specText",
        height: 260,
        contextKey: "specTextHTML",
      },
      {
        selector: "textarea.adm-tinymce[name='system.masteryText']",
        updatePath: "system.masteryText",
        height: 260,
        contextKey: "masteryTextHTML",
      },
    ];
  }
  // class: 2 separate rich fields (Свойство класса + Свойство Надежды)
  if (tpl === "class") {
    return [
      {
        selector: "textarea.adm-tinymce[name='system.description']",
        updatePath: "system.description",
        height: 260,
        contextKey: "classPropertyHTML",
      },
      {
        selector: "textarea.adm-tinymce[name='system.hopeProperty']",
        updatePath: "system.hopeProperty",
        height: 260,
        contextKey: "hopePropertyHTML",
      },
    ];
  }

  // default card: system.description
  return [
    {
      selector: "textarea.adm-tinymce[name='system.description']",
      updatePath: "system.description",
      height: 260,
      contextKey: "descriptionHTML",
    },
  ];
}


    // enemy ability -> system.notes
    if (t === "enemy-ability" || t === "enemyAbility" || t === "enemy_ability") {
      return [
        {
          selector: "textarea.adm-tinymce[name='system.notes']",
          updatePath: "system.notes",
          height: 260,
          contextKey: "notesHTML",
        },
      ];
    }

    return [];
  }


  render(force, options = {}) {
    // если лист сейчас закрыт (нет DOM) — при любом открытии стартуем с view
    if (!this.element) this._admEditMode = false;
    return super.render(force, options);
  }

  async _render(force, options) {
    // НЕ сбрасываем _admEditMode тут — иначе toggle никогда не работает

    // на всякий — снять TinyMCE, если он остался (например при переключениях/ошибках)
    try {
      const defs = this._admGetRichEditorDefs();
      for (const def of defs) {
        await admDestroyTinyMCE({
          sheet: this,
          selector: def.selector,
          updatePath: def.updatePath,
        });
      }
    } catch (e) {}


    return super._render(force, options);
  }

  async _toggleEditMode() {
    // перед ререндером: сохранить richtext и снять TinyMCE
    try {
      const defs = this._admGetRichEditorDefs();
      for (const def of defs) {
        await admDestroyTinyMCE({
          sheet: this,
          selector: def.selector,
          updatePath: def.updatePath,
        });
      }
    } catch (e) {}


    this._admEditMode = !this._admEditMode;
    this.render({ force: true });
  }

  _ensureHeaderEditControl() {
    const root = this.element;
    if (!root) return;

    const header = root.querySelector?.(".window-header");
    if (!header) return;

    const controls =
      header.querySelector(".window-controls") ||
      header.querySelector(".header-controls") ||
      header;

    controls.querySelectorAll(".adm-header-edit").forEach((e) => e.remove());

    const btn = document.createElement("a");
    btn.classList.add("header-control", "adm-header-edit");
    btn.setAttribute("role", "button");
    btn.setAttribute(
      "aria-label",
      game.i18n.localize("DAGGERHEART.UI.EDIT_TOGGLE")
    );
    btn.innerHTML = `<i class="fas fa-cog"></i>`;

    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      this._toggleEditMode();
    });

    const close =
      controls.querySelector(".header-control.close") ||
      controls.querySelector('[data-action="close"]') ||
      null;

    controls.insertBefore(btn, close);
  }

  async _openImagePicker(current) {
    return new Promise((resolve) => {
      const fp = new FilePicker({
        type: "image",
        current: current || "",
        callback: (path) => resolve(path),
      });
      fp.render(true);
    });
  }

  // =========================
  // Image picker binding (FIX)
  // =========================
_bindImagePickers(html) {
  html
    .querySelectorAll("[data-action='pick-img'], [data-action='pick-image']")
    .forEach((el) => {
      el.addEventListener("click", (ev) => this._onPickImageClick(ev));
    });
}

  async _onPickImageClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    if (!this.document?.isOwner) return;

    const current = this.item?.img || this.document?.img || "";
    const path = await this._openImagePicker(current);
    if (!path) return;

await this.item.update({ img: path }); // или { render: true }

    this.render({ force: true });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    context.config = CONFIG.ADM_DAGGERHEART;
    context.system = this.document.system ?? {};
    context.item = this.item;
    // Defaults for gear
    if (this.item?.type === "gear") {
      const sys = context.system ?? {};
      const kind = String(sys.kind ?? "").trim() || "item";

      context.gearKindSelected = kind;

      // при желании можно "прибить" дефолт в документ (чтобы не было пусто в базе)
      if (this.document.isOwner && (!sys.kind || String(sys.kind).trim() === "")) {
        try {
          await this.item.update({ "system.kind": kind }, { render: false });
          context.system.kind = kind;
        } catch (e) {}
      }
    }
	
    context.isEditMode = this._admEditMode;
    context.owner = this.document.isOwner;

    // ---- Rich text HTML for view mode ----
    const defs = this._admGetRichEditorDefs();
    for (const def of defs) {
      const raw = String(
        foundry.utils.getProperty(
          context.system ?? {},
          def.updatePath.replace(/^system\./, "")
        ) ?? ""
      );

      const enriched = await TE.enrichHTML(raw, {
        async: true,
        secrets: this.document.isOwner,
      });

      const finalHTML = admApplyTextReplacements(enriched, {
        actor: this.item?.parent ?? null,
        item: this.item ?? null,
      });

      context[def.contextKey] = finalHTML;
    }


    return context;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this._ensureHeaderEditControl();
  }

  _attachPartListeners(partId, html) {
    super._attachPartListeners(partId, html);
    if (partId !== "body") return;

    this._ensureHeaderEditControl();
    this._bindImagePickers(html);
// -------------------------
// Persist <details> open state between renders
// Any <details data-adm-spoiler="key"> will be restored.
// -------------------------
html.querySelectorAll("details[data-adm-spoiler]").forEach((d) => {
  const key = String(d.dataset.admSpoiler || "").trim();
  if (!key) return;

  // restore
  if (this._admSpoilerOpen?.[key]) d.setAttribute("open", "");
  else d.removeAttribute("open");

  // track
  d.addEventListener("toggle", () => {
    this._admSpoilerOpen[key] = !!d.open;
  });
});
// -------------------------
// Prevent <summary> click when toggling unlock checkboxes inside it
// -------------------------
html.querySelectorAll(".adm-card-unlock, .adm-card-unlock *").forEach((el) => {
  el.addEventListener("click", (ev) => ev.stopPropagation());
});

    // TinyMCE только в edit mode
    if (this._admEditMode) {
      const defs = this._admGetRichEditorDefs();
      for (const def of defs) {
        void admInitTinyMCE({
          sheet: this,
          htmlRoot: html,
          selector: def.selector,
          height: def.height,
          updatePath: def.updatePath,
        });
      }
    }

    // autosave по change для остальных полей (rich text не трогаем)
    if (this._admEditMode) {
      html
        .querySelectorAll("input[name], select[name], textarea[name]")
        .forEach((field) => {
          field.addEventListener("change", async (ev) => {
            const el = ev.currentTarget;
            const path = el?.name;
            if (!path) return;

                        const richDefs = this._admGetRichEditorDefs();
            if (richDefs.some((d) => d.updatePath === path)) return;


            let value;
            if (el.type === "checkbox") value = !!el.checked;
            else if (el.type === "number") value = Number(el.value || 0);
            else value = String(el.value ?? "");

            if (typeof value === "number" && Number.isNaN(value)) value = 0;

            try {
             await this.item.update({ [path]: value }); // или { render: true }

            } catch (e) {}
          });
        });
    }
  }

  async _onClose(options) {
    try {
      const defs = this._admGetRichEditorDefs();
      for (const def of defs) {
        await admDestroyTinyMCE({
          sheet: this,
          selector: def.selector,
          updatePath: def.updatePath,
        });
      }
    } catch (e) {}


    this._admEditMode = false;
    return super._onClose?.(options);
  }
}

export class ADMWeaponSheet extends ADMBaseItemSheet {
  static PARTS = {
    body: {
      template: "systems/adm-daggerheart/templates/item/weapon.hbs",
      scrollable: [".sheet-body"],
    },
  };
}

export class ADMArmorSheet extends ADMBaseItemSheet {
  static PARTS = {
    body: {
      template: "systems/adm-daggerheart/templates/item/armor.hbs",
      scrollable: [".sheet-body"],
    },
  };
}

export class ADMAbilitySheet extends ADMBaseItemSheet {
  static DEFAULT_OPTIONS = {
    ...ADMBaseItemSheet.DEFAULT_OPTIONS,
    height: 240,
  };

  static PARTS = {
    body: {
      template: "systems/adm-daggerheart/templates/item/ability.hbs",
      scrollable: [".sheet-body"],
    },
  };
}

export class ADMEnemyAbilitySheet extends ADMBaseItemSheet {
  static DEFAULT_OPTIONS = {
    ...ADMBaseItemSheet.DEFAULT_OPTIONS,
    height: 520,
  };

  static PARTS = {
    body: {
      template: "systems/adm-daggerheart/templates/item/enemy-ability.hbs",
      scrollable: [".sheet-body"],
    },
  };
}
export class ADMGearSheet extends ADMBaseItemSheet {
  static PARTS = {
    body: {
      template: "systems/adm-daggerheart/templates/item/gear.hbs",
      scrollable: [".sheet-body"],
    },
  };
}
export class ADMRelicSheet extends ADMBaseItemSheet {
  static PARTS = {
    body: {
      template: "systems/adm-daggerheart/templates/item/relic.hbs",
      scrollable: [".sheet-body"],
    },
  };
  
}
export class ADMCardSheet extends ADMBaseItemSheet {


  static PARTS = {
    body: {
      template: "systems/adm-daggerheart/templates/item/card.hbs",
      scrollable: [".sheet-body"],
    },
  };

  // -------------------------
  // Context for template "class"
  // -------------------------
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    // defaults
    context.classWeaponsList = [];
    context.classArmorsList = [];
    context.classItemsList = [];
    context.classConsumablesList = [];
context.classSubclassList = [];

    const sys = context.system ?? {};
    const tpl = String(sys.template ?? "").trim().toLowerCase();
    if (tpl !== "class") return context;

    // local helper: resolve UUID array -> [{uuid,name,img,type}]
    const buildList = async (uuids) => {
      const arr = Array.isArray(uuids) ? uuids.map(String).filter(Boolean) : [];
      if (!arr.length) return [];

      const docs = await Promise.all(
        arr.map(async (uuid) => {
          try {
            const doc = await fromUuid(uuid);
            if (!doc) return null;
            return {
              uuid,
              name: doc.name ?? "(без названия)",
              img: doc.img ?? "",
              type: doc.type ?? "",
            };
          } catch (e) {
            return null;
          }
        })
      );

      return docs.filter(Boolean);
    };

    context.classWeaponsList = await buildList(sys.classWeapons);
    context.classArmorsList = await buildList(sys.classArmors);
    context.classItemsList = await buildList(sys.classItems);
    context.classConsumablesList = await buildList(sys.classConsumables);
context.classSubclassList = await buildList(sys.subclass);

    return context;
  }

  // -------------------------
  // Drop rules
  // -------------------------
  _admParseDropTypes(spec = "") {
    // "weapon" | "armor" | "gear:item" | "gear:consumable"
    const s = String(spec || "").trim().toLowerCase();
    const [t, kind] = s.split(":").map((x) => String(x || "").trim());
    return { t, kind };
  }

  async _admGetDroppedItemUUID(ev) {
    let raw = "";
    try {
      raw = ev.dataTransfer?.getData("text/plain") || ev.dataTransfer?.getData("application/json") || "";
    } catch (e) {}

    if (!raw) return null;

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return null;
    }

    const uuid = data?.uuid || data?.document?.uuid || null;
    if (!uuid) return null;

    // only Items
    const type = String(data?.type || data?.documentName || "").toLowerCase();
    if (type && type !== "item") return null;

    return String(uuid);
  }

  async _admValidateDroppedItem(uuid, dropTypesSpec) {
    const { t, kind } = this._admParseDropTypes(dropTypesSpec);

    const doc = await fromUuid(uuid);
    if (!doc) return { ok: false };

    const itemType = String(doc.type ?? "").toLowerCase();
// card
if (t === "card") return { ok: itemType === "card" };

    // weapon
    if (t === "weapon") return { ok: itemType === "weapon" };

    // armor
    if (t === "armor") return { ok: itemType === "armor" };

    // gear filters
    if (t === "gear") {
      if (itemType !== "gear") return { ok: false };
      const gk = String(doc.system?.kind ?? "").trim().toLowerCase() || "item";
      if (kind) return { ok: gk === kind };
      return { ok: true };
    }

    return { ok: false };
  }

async _admAddUUIDToArray(path, uuid) {
  if (!this.document?.isOwner) return;


  const curr =
    foundry.utils.getProperty(this.item, path) ??
    foundry.utils.getProperty(this.item.system ?? {}, path.replace(/^system\./, "")) ??
    [];

  const arr = Array.isArray(curr) ? curr.map(String).filter(Boolean) : [];
  if (!arr.includes(uuid)) arr.push(uuid);

  await this.item.update({ [path]: arr });
  this.render({ force: true });
}


async _admRemoveUUIDFromArray(path, uuid) {
  if (!this.document?.isOwner) return;


  const curr =
    foundry.utils.getProperty(this.item, path) ??
    foundry.utils.getProperty(this.item.system ?? {}, path.replace(/^system\./, "")) ??
    [];

  const arr = Array.isArray(curr) ? curr.map(String).filter(Boolean) : [];
  const next = arr.filter((u) => u !== uuid);

  await this.item.update({ [path]: next });
  this.render({ force: true });
}


  _admSystemPathForDropTarget(target) {
    // targets from hbs: classWeapons/classArmors/classItems/classConsumables
    const t = String(target || "").trim();
    if (t === "classWeapons") return "system.classWeapons";
    if (t === "classArmors") return "system.classArmors";
    if (t === "classItems") return "system.classItems";
    if (t === "classConsumables") return "system.classConsumables";
	if (t === "classSubclass") return "system.subclass";

    return null;
  }

  // -------------------------
  // Listeners
  // -------------------------
  _attachPartListeners(partId, html) {
    super._attachPartListeners(partId, html);
    if (partId !== "body") return;

    // rerender on template change (edit mode)
    if (this._admEditMode) {
      const sel = html.querySelector("select[name='system.template']");
      if (sel) sel.addEventListener("change", () => this.render({ force: true }));
    }

    // Only needed for template "class"
    const tpl = String(this.item?.system?.template ?? "").trim().toLowerCase();
    if (tpl !== "class") return;
	


    // Drop zones
    html.querySelectorAll(".adm-card-dropzone").forEach((zone) => {
      zone.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
      });

      zone.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        if (!this.document?.isOwner) return;

        const uuid = await this._admGetDroppedItemUUID(ev);
        if (!uuid) return;

        const dropTarget = zone.dataset.dropTarget || "";
        const dropTypes = zone.dataset.dropTypes || "";

        const sysPath = this._admSystemPathForDropTarget(dropTarget);
        if (!sysPath) return;

        const check = await this._admValidateDroppedItem(uuid, dropTypes);
        if (!check.ok) return;

        await this._admAddUUIDToArray(sysPath, uuid);
      });
    });

    // Open linked item
    html.querySelectorAll("[data-action='adm-card-open-linked']").forEach((a) => {
      a.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const uuid = ev.currentTarget?.dataset?.uuid;
        if (!uuid) return;

        const doc = await fromUuid(String(uuid));
        if (!doc?.sheet) return;

        doc.sheet.render(true);
      });
    });

    // Remove linked item
    html.querySelectorAll("[data-action='adm-card-remove-linked']").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        if (!this.document?.isOwner) return;

        const uuid = ev.currentTarget?.dataset?.uuid;
        const dropTarget = ev.currentTarget?.dataset?.dropTarget;

        if (!uuid || !dropTarget) return;

        const sysPath = this._admSystemPathForDropTarget(dropTarget);
        if (!sysPath) return;

        await this._admRemoveUUIDFromArray(sysPath, String(uuid));
      });
    });
  }
}

