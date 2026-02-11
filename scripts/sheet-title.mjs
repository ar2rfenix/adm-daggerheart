// systems/adm-daggerheart/scripts/sheet-title.mjs

export function admPatchSheetTitles() {
  _patchV2();
  _patchV1();
}

/* -------------------------------------------- */
/* Foundry V2 sheets (DocumentSheetV2, ItemSheetV2, ActorSheetV2) */
/* -------------------------------------------- */

function _patchV2() {
  const sheetNS = foundry?.applications?.sheets;
  if (!sheetNS) return;

  // DocumentSheetV2 может называться по-разному в разных сборках,
  // поэтому патчим те прототипы, которые точно есть.
  const protos = [
    sheetNS.DocumentSheetV2?.prototype,
    sheetNS.ActorSheetV2?.prototype,
    sheetNS.ItemSheetV2?.prototype,
  ].filter(Boolean);

  for (const proto of protos) {
    if (proto.__admTitlePatched) continue;

    const desc = Object.getOwnPropertyDescriptor(proto, "title");
    const originalGet = desc?.get;

    Object.defineProperty(proto, "title", {
      configurable: true,
      enumerable: true,
      get: function () {
        // V2: document обычно лежит в this.document
        const name = this?.document?.name ?? this?.item?.name ?? this?.actor?.name;
        if (name) return name;

        // fallback на оригинальный заголовок, если вдруг нет document/name
        return originalGet ? originalGet.call(this) : "";
      }
    });

    Object.defineProperty(proto, "__admTitlePatched", {
      value: true,
      configurable: false
    });
  }
}

/* -------------------------------------------- */
/* Foundry V1 sheets (DocumentSheet / ActorSheet / ItemSheet) */
/* -------------------------------------------- */

function _patchV1() {
  const v1 = foundry?.appv1?.sheets;
  if (!v1) return;

  const protos = [
    v1.DocumentSheet?.prototype,
    v1.ActorSheet?.prototype,
    v1.ItemSheet?.prototype,
  ].filter(Boolean);

  for (const proto of protos) {
    if (proto.__admTitlePatched) continue;

    const desc = Object.getOwnPropertyDescriptor(proto, "title");
    const originalGet = desc?.get;

    Object.defineProperty(proto, "title", {
      configurable: true,
      enumerable: true,
      get: function () {
        // V1: объект часто лежит в this.object
        const name = this?.object?.name ?? this?.document?.name;
        if (name) return name;

        return originalGet ? originalGet.call(this) : "";
      }
    });

    Object.defineProperty(proto, "__admTitlePatched", {
      value: true,
      configurable: false
    });
  }
}
