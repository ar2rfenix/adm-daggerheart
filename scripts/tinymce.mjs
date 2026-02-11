/**
 * systems/adm-daggerheart/scripts/editor/tinymce.mjs
 * Общий TinyMCE-хелпер для всех листов.
 */

export function admRegisterTinyMCEConfig() {
  CONFIG.TinyMCE = foundry.utils.mergeObject(CONFIG.TinyMCE || {}, {
    valid_elements: "*[*]",
    extended_valid_elements: "+*[*]",
    valid_children: "+body[style]",
    forced_root_block: "",
    convert_urls: false,
    cleanup: false,
    plugins:
      "lists link image code table advlist autolink autosave charmap searchreplace visualblocks fullscreen media emoticons",
    toolbar: [
      "quickinsert bold italic underline numlist bullist checklist visualblocks",
      "alignleft aligncenter alignright alignjustify",
      "pagebreak image link anchor codesample",
      "hr | code",
    ].join(" | "),
    menubar: "file edit view insert format tools table help",
    branding: false,
  });
}

export async function admEnsureTinyMCE() {
  if (globalThis.tinymce) return;

  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tinymce@5/tinymce.min.js";
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });

  admRegisterTinyMCEConfig();
}

function _unbindOutsideFlush(sheet) {
  try {
    if (sheet?._admTinyOutsideHandler) {
      document.removeEventListener("pointerdown", sheet._admTinyOutsideHandler, true);
      sheet._admTinyOutsideHandler = null;
    }
  } catch (e) {}
}

function _bindOutsideFlush(sheet, editorId) {
  _unbindOutsideFlush(sheet);

  const handler = async (ev) => {
    try {
      if (!sheet?._admEditMode) return;

      const root = sheet.element;
      if (!root || !root.isConnected) return;

      // интересуют клики внутри окна листа
      if (!root.contains(ev.target)) return;

      // клики внутри TinyMCE UI — игнор
      const insideTiny =
        ev.target?.closest?.(".tox") ||
        ev.target?.closest?.(".mce-container") ||
        ev.target?.closest?.(".mce-content-body");
      if (insideTiny) return;

      // клик по любому месту внутри листа, но вне тини — сохраняем
      if (typeof sheet._admTinyFlush === "function") {
        await sheet._admTinyFlush();
      }
    } catch (e) {}
  };

  sheet._admTinyOutsideHandler = handler;
  document.addEventListener("pointerdown", handler, true);
}

/**
 * Инициализация TinyMCE на конкретной textarea.
 * - sheet: текущий лист (this)
 * - htmlRoot: корень html из _attachPartListeners
 * - selector: textarea selector
 * - height: высота редактора
 * - updatePath: куда сохраняем в документ (например "system.notes")
 */
export async function admInitTinyMCE({
  sheet,
  htmlRoot,
  selector,
  height = 260,
  updatePath = "system.notes",
}) {
  if (!sheet?._admEditMode) return;

  const area = htmlRoot?.querySelector?.(selector);
  if (!area) return;

  if (!area.id) {
    area.id = `adm-tinymce-${sheet.document.uuid.replaceAll(".", "-")}-${updatePath.replaceAll(".", "-")}`;
  }

  await admEnsureTinyMCE();

  const existing = globalThis.tinymce?.get?.(area.id);
  if (existing) {
    const target = existing.targetElm;
    const broken = !target || !target.isConnected || target !== area;
    if (broken) {
      try {
        existing.save();
        globalThis.tinymce.remove(existing);
      } catch (e) {}
    } else {
      // уже норм — просто включим outside flush
      sheet._admTinyFlush = sheet._admTinyFlush || (async () => {});
      _bindOutsideFlush(sheet, area.id);
      return;
    }
  }

  try {
    globalThis.tinymce?.remove?.(`#${area.id}`);
  } catch (e) {}

  const flush = async () => {
    try {
      const ed = globalThis.tinymce?.get?.(area.id);
      if (!ed) return;

      ed.save();
      const v = String(area.value ?? "");
      const cur = String(foundry.utils.getProperty(sheet.document, updatePath) ?? "");

      if (v !== cur) {
        await sheet.document.update({ [updatePath]: v }, { render: false });
      }
    } catch (e) {}
  };

  await globalThis.tinymce.init({
    target: area,
    ...CONFIG.TinyMCE,

    height,
    min_height: Math.max(160, Math.floor(height * 0.7)),
    resize: true,

    setup: (ed) => {
      // сохраняем на blur
      ed.on("blur", flush);

      // change — только в textarea (без update)
      ed.on("change", () => {
        try { ed.save(); } catch (e) {}
      });

      // после init включаем “клик вне”
      ed.on("init", () => {
        _bindOutsideFlush(sheet, area.id);
      });
    },
  });

  sheet._admTinyFlush = flush;
}

/** Уничтожить TinyMCE и гарантированно сохранить */
export async function admDestroyTinyMCE({
  sheet,
  selector,
  updatePath = "system.notes",
}) {
  try {
    const el = sheet?.element;
    const area = el?.querySelector?.(selector);
    if (!area?.id) {
      _unbindOutsideFlush(sheet);
      return;
    }

    const ed = globalThis.tinymce?.get?.(area.id);
    if (!ed) {
      _unbindOutsideFlush(sheet);
      return;
    }

    ed.save();
    const v = String(area.value ?? "");
    const cur = String(foundry.utils.getProperty(sheet.document, updatePath) ?? "");
    if (v !== cur) {
      await sheet.document.update({ [updatePath]: v }, { render: false });
    }

    globalThis.tinymce.remove(ed);
  } catch (e) {}
  finally {
    _unbindOutsideFlush(sheet);
    sheet._admTinyFlush = null;
  }
}
