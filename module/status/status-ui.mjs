// systems/adm-daggerheart/module/status/status-ui.mjs
// Полная замена файла целиком.

import { admInitTinyMCE, admDestroyTinyMCE } from "../../scripts/tinymce.mjs";
import { admSyncActorStatusMods } from "./status-modifiers.mjs";
import { admLabelForPath, admPathForLabel, admInvalidateTermCaches, admBuildLabelToPathMap } from "./adm-terms.mjs";
import { getModifier, listModifiers } from "./modifiers/registry.mjs";

const FLAG_SCOPE = "adm-daggerheart";
// Статусы на предметах
const FLAG_KEY_ITEM = "statusDefs";
// Статусы на актёре (без источника)
const FLAG_KEY_ACTOR = "actorStatusDefs";

export function admStatusInit() {
  _patchItemSheetPrepareContext();
  _installGlobalDelegatedHandlers();

Hooks.once("ready", () => {
  _invalidateNumericCaches();      // важно: пересобрать список путей после инициализации системы
  admInvalidateTermCaches();
  admBuildLabelToPathMap();
});

}

/* -------------------------------------------- */
/* Context patch                                */
/* -------------------------------------------- */

function _patchItemSheetPrepareContext() {
  const proto = foundry?.applications?.sheets?.ItemSheetV2?.prototype;
  if (!proto || proto.__admStatusPreparePatched) return;

  const original = proto._prepareContext;

  proto._prepareContext = async function (options) {
    const ctx = await original.call(this, options);

    try {
      const defs = _readStatusDefs(this.document);
      ctx.admStatuses = defs.map((d) => _toStatusVM(d));
    } catch (_e) {
      ctx.admStatuses = [];
    }

    return ctx;
  };

  Object.defineProperty(proto, "__admStatusPreparePatched", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

function _toStatusVM(def) {
  const d = def ?? {};
  const when = String(d.when ?? "equip");
  const img = String(d.img ?? "icons/svg/aura.svg");
  const rawMods = Array.isArray(d.mods) ? d.mods : [];
  const mods = rawMods.map(_normalizeMod);

  return {
    ...d,
    img,
    when,
mods: mods
  .filter((m) => m && (m.path || m.value || m.type))
  .map((m) => {
    const type = String(m.type ?? "attribute").trim() || "attribute";
    const path = String(m.path ?? "").trim();
    const modDef = getModifier(type);

    const label =
      (type === "attribute" || type === "instantAttribute")
        ? (admLabelForPath(path) || path || "Нет")
        : String(modDef?.label ?? type);

    const rawValue = String(m.value ?? "").trim();
    const value = (modDef?.formatValue)
      ? String(modDef.formatValue(rawValue))
      : rawValue;

    return {
      type,
      path,
      value,
      label,
    };
  }),

  };
}

/* -------------------------------------------- */
/* Global delegated handlers                    */
/* -------------------------------------------- */

function _installGlobalDelegatedHandlers() {
  if (globalThis.__admStatusDelegatedHandlers) return;
  globalThis.__admStatusDelegatedHandlers = true;

  document.addEventListener(
    "click",
    async (ev) => {
      const btn = ev.target?.closest?.("[data-action]");
      if (!btn) return;

      const action = btn.dataset.action;
      if (
        action !== "adm-status-add" &&
        action !== "adm-status-edit" &&
        action !== "adm-status-del" &&
        action !== "adm-actor-status-add" &&
        action !== "adm-actor-status-edit" &&
        action !== "adm-actor-status-del"
      ) return;

      ev.preventDefault();
      ev.stopPropagation();

      const { app, doc } = _resolveItemAppFromButton(btn);
      if (!app || !doc) return;

      const isActorAction = action.startsWith("adm-actor-status-");
      const flagKey = isActorAction ? FLAG_KEY_ACTOR : FLAG_KEY_ITEM;

      if (isActorAction) {
        if (!(doc instanceof Actor)) return;
      } else {
        if (!(doc instanceof Item)) return;
      }

      if (!doc.isOwner) {
        ui?.notifications?.warn?.("Недостаточно прав для изменения.");
        return;
      }

      // add
      if (action === "adm-status-add" || action === "adm-actor-status-add") {
        await _openStatusDialog({
          doc,
          app,
          mode: "create",
          flagKey,
          defaultWhen: isActorAction ? "backpack" : "equip",
        });
        return;
      }

      // edit / delete
      const id = btn.dataset.statusId;
      if (!id) return;

      const defs = _readStatusDefs(doc, flagKey);

      if (action === "adm-status-edit" || action === "adm-actor-status-edit") {
        const def = defs.find((d) => d.id === id);
        if (!def) return;
        await _openStatusDialog({ doc, app, mode: "edit", def, flagKey });
        return;
      }

      if (action === "adm-status-del" || action === "adm-actor-status-del") {
        const idx = defs.findIndex((d) => d.id === id);
        if (idx === -1) return;

        const ok = await Dialog.confirm({
          title: "Удалить статус",
          content: `<p>Удалить статус «${foundry.utils.escapeHTML(defs[idx].name || "")}»?</p>`,
          defaultYes: false,
        });
        if (!ok) return;

        defs.splice(idx, 1);
        await _writeStatusDefs(doc, defs, flagKey);

        // если это статус актёра — применяем/переснимаем эффект сразу
        if (flagKey === FLAG_KEY_ACTOR && doc instanceof Actor) {
          await admSyncActorStatusMods(doc);
        }

        app.render?.({ force: true });
      }
    },
    true
  );
}

function _resolveItemAppFromButton(btn) {
  const win =
    btn.closest?.(".window-app[data-appid]") ||
    btn.closest?.(".app.window-app[data-appid]") ||
    btn.closest?.("[data-appid]") ||
    null;

  const appIdRaw = win?.dataset?.appid ?? null;
  const appIdNum = appIdRaw != null ? Number(appIdRaw) : NaN;

  let app =
    (Number.isFinite(appIdNum) && ui?.windows?.[appIdNum]) ||
    (appIdRaw != null && ui?.windows?.[appIdRaw]) ||
    null;

  if (!app) {
    const inst = foundry?.applications?.instances;
    if (inst?.get) {
      app = Number.isFinite(appIdNum) ? inst.get(appIdNum) : null;
      if (!app && appIdRaw != null) app = inst.get(appIdRaw) ?? null;
    }
  }

  if (!app) {
    const all = [];
    for (const w of Object.values(ui?.windows ?? {})) all.push(w);

    const inst = foundry?.applications?.instances;
    if (inst?.values) for (const w of inst.values()) all.push(w);

    for (const w of all) {
      const el = _unwrapHTML(w?.element);
      if (el && el.contains(btn)) {
        app = w;
        break;
      }
    }
  }

  const doc = app?.document || app?.item || null;
  return { app, doc };
}

/* -------------------------------------------- */
/* Dialog                                       */
/* -------------------------------------------- */

class ADMStatusDialog extends Dialog {
  constructor(dialogData, dialogOptions, extras) {
    super(dialogData, dialogOptions);
    this._admEditorId = extras?.editorId ?? null;
    this._admRenderRowHTML = extras?.renderRowHTML ?? (() => "");
  }

  activateListeners(html) {
    super.activateListeners(html);

    const root = html?.[0] instanceof HTMLElement ? html[0] : null;
    if (!root) return;

    const modsWrap = root.querySelector(".adm-status-mods");
    const addSelect = root.querySelector('[data-action="adm-status-mod-add"]');

    modsWrap?.addEventListener("click", (ev) => {
      const x = ev.target?.closest?.('[data-action="adm-status-mod-del"]');
      if (!x) return;

      ev.preventDefault();
      ev.stopPropagation();

      x.closest(".adm-status-mod-row")?.remove();
    });

    addSelect?.addEventListener("change", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      if (!modsWrap) return;

      const type = String(addSelect.value ?? "").trim();
      addSelect.value = "";
      if (!type) return;

      const tmp = document.createElement("div");
      tmp.innerHTML = this._admRenderRowHTML({ type, path: "", value: "0" }).trim();
      const row = tmp.firstElementChild;
      if (!row) return;

      modsWrap.appendChild(row);
    });

    const editorId = this._admEditorId;
    if (editorId) {
      requestAnimationFrame(async () => {
        try {
          await admInitTinyMCE(editorId);
        } catch (e) {
          console.error("admInitTinyMCE failed:", e);
        }
      });
    }

    // --------------------------------------------------
    // Image picker (клик по картинке)
    // --------------------------------------------------
    const imgEl = root.querySelector('.adm-status-img[data-action="adm-status-pick-img"]');
    const imgInput = root.querySelector('input[name="img"]');

    imgEl?.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const current =
        String(imgInput?.value ?? imgEl.getAttribute("src") ?? "icons/svg/").trim() || "icons/svg/";

      const fp = new FilePicker({
        type: "image",
        current: current.startsWith("icons/") ? current : "icons/svg/",
        callback: (path) => {
          if (!path) return;
          imgEl.src = path;
          if (imgInput) imgInput.value = path;
        },
      });

      fp.render(true);
    });
  }

  async close(options) {
    if (this._admEditorId) {
      try {
        await admDestroyTinyMCE(this._admEditorId);
      } catch (_e) {}
    }
    return super.close(options);
  }
}

async function _openStatusDialog({ doc, app, mode, def, flagKey = FLAG_KEY_ITEM, defaultWhen = "equip" }) {
  const item = doc;

  const isEdit = mode === "edit";
  const isActor = flagKey === FLAG_KEY_ACTOR;

  const curName = isEdit ? String(def?.name ?? "") : "";
  const curText = isEdit ? String(def?.text ?? "") : "";
  const curImg = isEdit ? String(def?.img ?? "icons/svg/aura.svg") : "icons/svg/aura.svg";

  // На актёре разрешаем только "backpack"
  let curWhen = isEdit ? String(def?.when ?? defaultWhen) : defaultWhen;
  if (isActor) curWhen = "backpack";

  const curModsRaw = isEdit ? (Array.isArray(def?.mods) ? def.mods : []) : [];
  const curMods = curModsRaw.length ? curModsRaw.map(_normalizeMod) : [];

  const editorId = `adm-status-text-${foundry.utils.randomID()}`;

  const options = await _getNumericFieldOptions();

  const buildAttrOptionsHTML = (selected) => {
    const sel = String(selected ?? "").trim();
    const head = `<option value="" ${sel ? "" : "selected"}>Нет</option>`;
    const body = options
      .map((o) => {
        const v = String(o.value);
        const l = String(o.label);
        return `<option value="${foundry.utils.escapeHTML(v)}" ${v === sel ? "selected" : ""}>${foundry.utils.escapeHTML(l)}</option>`;
      })
      .join("");
    return head + body;
  };

  const uiHelpers = {
    escapeHTML: (s) => foundry.utils.escapeHTML(String(s ?? "")),
    buildAttrOptionsHTML,
    // на будущее: если модификатору нужно знать типизированный список полей
    numericFieldOptions: options,
  };

  const renderModRowHTML = (m) => {
    const nm = _normalizeMod(m);
    const type = String(nm.type ?? "attribute").trim() || "attribute";
    const modDef = getModifier(type);

    if (modDef?.renderEditorRowHTML) {
      try {
        return String(modDef.renderEditorRowHTML({ mod: nm, helpers: uiHelpers }) ?? "");
      } catch (e) {
        console.error(e);
      }
    }

    // fallback: старая верстка (чтобы не ломать неизвестные типы)
    const p = String(nm.path ?? "").trim();
    const v = String(nm.value ?? "0");
    const typeLabel = String(modDef?.label ?? type);

    return `
<div class="adm-status-mod-row" data-mod-type="${uiHelpers.escapeHTML(type)}">
  <div class="adm-status-mod-col">
    <div class="adm-status-mod-title">${uiHelpers.escapeHTML(typeLabel)}</div>
    <select name="modPath">
      ${buildAttrOptionsHTML(p)}
    </select>
  </div>

  <div class="adm-status-mod-col">
    <div class="adm-status-mod-title">Значение</div>
    <input type="text" name="modValue" value="${uiHelpers.escapeHTML(v)}" />
  </div>

  <button type="button" class="adm-status-mod-del" data-action="adm-status-mod-del" title="Удалить">×</button>
</div>`;
  };

  const modsHTML = curMods.map((m) => renderModRowHTML(m)).join("");

  // ВАЖНО:
  // - на актёре только "При получении"
  // - на предмете: equip/backpack/button
  const whenOptions = isActor
    ? `<option value="backpack" selected>При получении</option>`
    : `
      <option value="equip" ${curWhen === "equip" ? "selected" : ""}>При экипировке</option>
      <option value="backpack" ${curWhen === "backpack" ? "selected" : ""}>При получении</option>
      <option value="button" ${curWhen === "button" ? "selected" : ""}>Кнопка</option>
    `;

  const content = `
<form class="adm-status-form adm-status-form--stacked">

   <div class="adm-status-head" style="display:flex; gap:12px; align-items:flex-start;">
    <img class="adm-status-img"
         data-action="adm-status-pick-img"
         src="${foundry.utils.escapeHTML(curImg)}"
         style="width:64px; height:64px; object-fit:contain; cursor:pointer; border-radius:8px; border:1px solid rgba(0,0,0,.2); background:rgba(0,0,0,.08);"/>

    <div class="adm-status-head-fields" style="flex:1; display:flex; flex-direction:column; gap:10px;">
      <input type="hidden" name="img" value="${foundry.utils.escapeHTML(curImg)}"/>

      <div class="adm-status-line" style="display:flex; align-items:center; gap:10px;">
        <label style=" margin:0;">Название</label>
        <input type="text" name="name" value="${foundry.utils.escapeHTML(curName)}" />
      </div>

      <div class="adm-status-line" style="display:flex; align-items:center; gap:10px;">
        <label style=" margin:0;">Активация</label>
        <select name="when" style="flex:1;">${whenOptions}</select>
      </div>
    </div>
  </div>


  <div class="form-group">
    <label>Модификаторы</label>

    <div class="adm-status-mods-toolbar">
      <select data-action="adm-status-mod-add">
        <option value="" selected>Добавить...</option>
        ${listModifiers()
          .map((m) => {
            const t = String(m.type);
            const l = String(m.label ?? t);
            return `<option value="${foundry.utils.escapeHTML(t)}">${foundry.utils.escapeHTML(l)}</option>`;
          })
          .join("")}
      </select>
    </div>

    <div class="adm-status-mods">
      ${modsHTML}
    </div>
  </div>

  <div class="form-group">
    <label>Описание</label>
    <textarea id="${editorId}" name="text" rows="4">${foundry.utils.escapeHTML(curText)}</textarea>
  </div>

</form>
`;

  return new Promise((resolve) => {
    const saveFromDialog = async () => {
      const root = dlg?.element?.[0] instanceof HTMLElement ? dlg.element[0] : null;
      const form = root?.querySelector?.("form.adm-status-form");
      if (!form) return false;

      const name = String(form.querySelector('[name="name"]')?.value ?? "").trim();
      if (!name) return false;

      const img = String(form.querySelector('[name="img"]')?.value ?? "icons/svg/aura.svg").trim() || "icons/svg/aura.svg";

      // На актёре фиксируем "backpack" независимо от формы
      const when = isActor
        ? "backpack"
        : (String(form.querySelector('[name="when"]')?.value ?? defaultWhen).trim() || defaultWhen);

      let text = "";
      const ed = globalThis.tinymce?.get?.(editorId);
      if (ed) text = String(ed.getContent() ?? "").trim();
      else text = String(form.querySelector('[name="text"]')?.value ?? "").trim();

      const rows = Array.from(form.querySelectorAll(".adm-status-mod-row"));
      const mods = rows
        .map((row) => {
          let type = String(row?.dataset?.modType ?? "attribute").trim() || "attribute";
          if (type === "attr") type = "attribute";

          const modDef = getModifier(type);

          let raw = null;
          if (modDef?.readEditorRow) {
            try {
              raw = modDef.readEditorRow({ row, helpers: uiHelpers });
            } catch (e) {
              console.error(e);
            }
          }

          // fallback для неизвестных типов
          if (!raw) {
            raw = {
              type,
              path: String(row.querySelector('[name="modPath"]')?.value ?? "").trim(),
              value: String(row.querySelector('[name="modValue"]')?.value ?? "").trim(),
            };
          }

          return _normalizeMod(raw);
        })
        .filter((m) => {
          const modDef = getModifier(m?.type);
          // базовый фильтр: не сохраняем полностью пустые строки
          if (!m) return false;
          if ((m.value ?? "") === "" && (m.path ?? "") === "") return false;
          // сохранение по умолчанию как раньше: для атрибутов нужен path
          const kind = String(modDef?.kind ?? "persistent");
          if (kind === "instant") return !!m.path && (m.value ?? "") !== "";
          // persistent
          if (m.type === "attribute") return !!m.path && (m.value ?? "") !== "";
          return (m.value ?? "") !== "";
        });

      const defs = _readStatusDefs(item, flagKey);

      if (isEdit) {
        const idx = defs.findIndex((d) => d.id === def.id);
        if (idx !== -1) defs[idx] = { ...defs[idx], img, name, when, text, mods };
      } else {
        defs.push({ id: foundry.utils.randomID(), img, name, when, text, mods });
      }

      await _writeStatusDefs(item, defs, flagKey);

      if (flagKey === FLAG_KEY_ACTOR && item instanceof Actor) {
        await admSyncActorStatusMods(item);
      }

      app.render?.({ force: true });
      return true;
    };

    const dlg = new ADMStatusDialog(
      {
        title: isEdit ? "Редактировать статус" : "Новый статус",
        content,
        buttons: {}, // нет кнопок
      },
      { id: `adm-status-dialog-${foundry.utils.randomID()}`, width: 620, height: "auto" },
      { editorId, renderRowHTML: renderModRowHTML }
    );

    // Сохранение при закрытии (X / ESC / close())
    const _origClose = dlg.close.bind(dlg);
    dlg.close = async (options) => {
      if (!dlg.__admSaved) {
        dlg.__admSaved = true;
        try { await saveFromDialog(); } catch (e) { console.error(e); }
        resolve(true);
      }
      return _origClose(options);
    };

    dlg.render(true);

    requestAnimationFrame(() => {
      try {
        const w = dlg.position?.width ?? 620;
        const left = Math.max(20, Math.round((window.innerWidth - w) / 2));
        const top = Math.max(20, 20);
        dlg.setPosition({ left, top });
      } catch (_e) {}
    });
  });
}

/* -------------------------------------------- */
/* Flags storage + миграция                     */
/* -------------------------------------------- */

function _normalizeMod(m) {
  const mm = m ?? {};

  let type = String(mm.type ?? "attribute").trim();
  if (!type) type = "attribute";
  if (type === "attr") type = "attribute";

  const def = getModifier(type);
  if (def?.normalize) {
    try {
      return def.normalize({ ...mm, type }) || { type, path: "", value: "0" };
    } catch (_e) {
      // fallback ниже
    }
  }

  const path = String(mm.path ?? mm.attrPath ?? "").trim();
  const value =
    mm.value != null ? String(mm.value).trim()
    : mm.attrDelta != null ? String(mm.attrDelta).trim()
    : "0";

  return { type, path, value };
}

function _readStatusDefs(item, flagKey = FLAG_KEY_ITEM) {
  const raw = item.getFlag(FLAG_SCOPE, flagKey);
  const arr = Array.isArray(raw) ? raw.filter(Boolean) : [];

  for (const d of arr) {
    if (!d) continue;
    if (!d.when) d.when = "equip";
    if (!d.img) d.img = "icons/svg/aura.svg";

    if (!Array.isArray(d.mods)) d.mods = [];

    if (d.attrPath && d.attrDelta != null && d.mods.length === 0) {
      d.mods.push({ type: "attribute", path: String(d.attrPath), value: String(d.attrDelta) });
    }

    d.mods = Array.isArray(d.mods) ? d.mods.map(_normalizeMod) : [];
    delete d.attrPath;
    delete d.attrDelta;
  }

  return arr;
}

async function _writeStatusDefs(item, defs, flagKey = FLAG_KEY_ITEM) {
  const clean = Array.isArray(defs) ? defs.filter(Boolean) : [];
  await item.setFlag(FLAG_SCOPE, flagKey, clean);
}

/* -------------------------------------------- */
/* Numeric fields options (auto from template)  */
/* -------------------------------------------- */

let __admNumericPathsCache = null;
let __admLabelToPathRUCache = null;
let __admLabelToPathRUCacheLang = null;

function _invalidateNumericCaches() {
  __admNumericPathsCache = null;
  __admLabelToPathRUCache = null;
  __admLabelToPathRUCacheLang = null;
}

async function _primeLabelToPathCache() {
  const lang = String(game?.i18n?.lang ?? "");
  if (__admLabelToPathRUCache && __admLabelToPathRUCacheLang === lang) return __admLabelToPathRUCache;

  __admLabelToPathRUCacheLang = lang;
  __admLabelToPathRUCache = new Map();

  // строим карту label->path из актуальных термов (они уже учитывают lang)
  // В admLabelForPath/admPathForLabel у вас уже есть кеш; тут нужна полная выдача путей
  // Поэтому берём numeric paths и конвертим в label.
  const opts = await _getNumericFieldOptions();
  for (const o of opts) {
    __admLabelToPathRUCache.set(String(o.label), String(o.value));
  }

  return __admLabelToPathRUCache;
}

async function _getNumericFieldOptions() {
  if (__admNumericPathsCache) return __admNumericPathsCache;

  const paths = new Set();

  // 1) Берём шаблоны system данных актёров из системы (Foundry v12/v13 — разные поля)
  const actorModels =
    game?.system?.model?.Actor ||
    game?.system?.dataModels?.Actor ||
    game?.system?.data?.model?.Actor ||
    {};

  // actorModels обычно вида: { character: {...system template...}, npc: {...} }
for (const [_type, model] of Object.entries(actorModels)) {
  if (!model || typeof model !== "object") continue;

  // В разных версиях Foundry модель может быть:
  // - сразу system-шаблон
  // - объект с полем system: {...}
  const sys = (model.system && typeof model.system === "object") ? model.system : model;

  _collectNumericPaths(sys, "system", paths);
}

// fallback: берём toObject() (важно для DataModel, где поля могут быть не enumerable)
if (paths.size === 0) {
  const anyActor = game?.actors?.contents?.[0];
  const sysObj =
    anyActor?.system?.toObject ? anyActor.system.toObject()
    : anyActor?.system ? foundry.utils.deepClone(anyActor.system)
    : null;

  if (sysObj) _collectNumericPaths(sysObj, "system", paths);
}
// Жёсткий fallback: добавляем ключевые поля даже если модель/датамодель их не отдала
[
  "system.resources.hp.value",
  "system.resources.hp.max",
  "system.resources.stress.value",
  "system.resources.stress.max",
  "system.resources.armor.value",
  "system.resources.armor.max",
  "system.resources.hope.value",
  "system.resources.hope.max",
  "system.resources.fear.value",
  "system.resources.fear.max",
  "system.resources.dodge.value",
  "system.damageThresholds.noticeable",
  "system.damageThresholds.heavy",
  "system.level",
  "system.mastery",
  "system.traits.agility.value",
  "system.traits.strength.value",
  "system.traits.finesse.value",
  "system.traits.instinct.value",
  "system.traits.presence.value",
  "system.traits.knowledge.value",
].forEach((p) => paths.add(p));


  // 2) Собираем options с локальными подписями
  const list = Array.from(paths)
    .filter((p) => p && typeof p === "string")
    .map((p) => {
      const label = admLabelForPath(p) || p;
      return { value: p, label };
    })
    // сортируем по label, потом по value
    .sort((a, b) => {
      const la = String(a.label).toLowerCase();
      const lb = String(b.label).toLowerCase();
      if (la < lb) return -1;
      if (la > lb) return 1;
      const va = String(a.value);
      const vb = String(b.value);
      return va < vb ? -1 : va > vb ? 1 : 0;
    });

  __admNumericPathsCache = list;
  return __admNumericPathsCache;
}

// Рекурсивный сбор numeric leaf-полей в object (игнорируем массивы)
// FIX: добавляем support для object-ресурсов вида { value, max }, даже если value/max = null в model template
function _collectNumericPaths(obj, prefix, outSet) {
  if (!obj || typeof obj !== "object") return;

  for (const [k, v] of Object.entries(obj)) {
    if (!k) continue;
    const p = prefix ? `${prefix}.${k}` : k;

    // leaf number
    if (typeof v === "number" && Number.isFinite(v)) {
      outSet.add(p);
      continue;
    }

    // objects like { value, max } — добавляем пути даже если там null/undefined
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (Object.prototype.hasOwnProperty.call(v, "value")) outSet.add(`${p}.value`);
      if (Object.prototype.hasOwnProperty.call(v, "max")) outSet.add(`${p}.max`);

      _collectNumericPaths(v, p, outSet);
      continue;
    }

    // primitives / arrays — игнорируем
    continue;
  }
}




/* -------------------------------------------- */
/* Utils                                        */
/* -------------------------------------------- */

function _unwrapHTML(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  if (Array.isArray(html) && html[0] instanceof HTMLElement) return html[0];
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}
