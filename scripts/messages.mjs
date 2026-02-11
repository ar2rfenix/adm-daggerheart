// systems/adm-daggerheart/scripts/messages.mjs
// Полная замена файла целиком.

export async function admPostCurrencyClicksSummary(actor, deltas, currencyMeta = {}) {
  try {
    if (!actor) return;

    const obj = {};
    if (deltas instanceof Map) {
      for (const [k, v] of deltas.entries()) obj[String(k)] = Number(v) || 0;
    } else if (deltas && typeof deltas === "object") {
      for (const [k, v] of Object.entries(deltas)) obj[String(k)] = Number(v) || 0;
    }

    const ORDER = ["coin", "handful", "bag", "chest"];
    const DEFAULT_ICON = {
      coin: "fa-solid fa-coin",
      handful: "fa-solid fa-coins",
      bag: "fa-solid fa-sack",
      chest: "fa-sharp fa-solid fa-treasure-chest",
    };

    const chips = [];

    for (const k of ORDER) {
      const n = Number(obj[k]) || 0;
      if (!n) continue;

      const meta = currencyMeta?.[k] ?? {};
      const label = String(meta.label ?? k).trim();
      const iconClass = String(meta.iconClass ?? DEFAULT_ICON[k] ?? "fa-solid fa-circle-question").trim();

      const numberColor = n > 0 ? "#35d46a" : "#ff4d4d";
      const signedText = n > 0 ? `+${n}` : `${n}`;

      chips.push(
        `
        <div style="
          min-width:0;
          display:flex;
          align-items:center;
          justify-content:center;
          gap:8px;
          padding:10px 8px;
          border-radius:14px;
          background:rgba(0,0,0,.28);
          border:1px solid rgba(255,255,255,.10);
          line-height:1;
          box-sizing:border-box;
          overflow:hidden;
        ">
          <span style="
            color:${numberColor};
            font-size:24px;
            font-weight:900;
            font-variant-numeric:tabular-nums;
            white-space:nowrap;
          ">${foundry.utils.escapeHTML(signedText)}</span>

          <i class="${foundry.utils.escapeHTML(iconClass)}"
             title="${foundry.utils.escapeHTML(label)}"
             style="
               color:#f3c267;
               font-size:22px;
               line-height:1;
               display:inline-block;
               transform: translateY(1px);
               flex:0 0 auto;
             "></i>
        </div>
      `.trim()
      );
    }

    if (!chips.length) return;

    const content = `
      <div style="
        display:grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap:10px;
        align-items:stretch;
        width:100%;
        overflow:hidden;
      ">
        ${chips.join("")}
      </div>
    `.trim();

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
    });
  } catch (e) {
    console.error("ADM messages | admPostCurrencyClicksSummary failed:", e);
  }
}

export async function admPostDocCard(actorOrSpeakerDoc, data) {
  try {
    if (!data) return;

    const name = String(data.name ?? "").trim();
    if (!name) return;

    const img = String(data.img ?? "").trim();
    const subtitle = String(data.subtitle ?? "").trim();

    const rowsIn = Array.isArray(data.rows) ? data.rows : [];
    const rows = rowsIn
      .map((r) => ({ k: String(r?.k ?? "").trim(), v: String(r?.v ?? "").trim() }))
      .filter((r) => r.k && r.v);

    const variant = String(data.variant ?? "").trim(); // "enemy-ability" | ""
    const isEnemyAbility = variant === "enemy-ability";

    const bodyHTML = String(data.bodyHTML ?? "").trim();
    const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
    const safeBody = _admPatchChatButtons(bodyHTML);

    const rowsHTML = rows.length
      ? rows
          .map(
            (r) => `
              <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;align-items:baseline;">
                <div style="opacity:.85;font-size:14px;line-height:1.2;">${esc(r.k)}</div>
                <div style="font-size:14px;line-height:1.2;word-break:break-word;">${esc(r.v)}</div>
              </div>
            `.trim()
          )
          .join("")
      : "";

    const rowCount = rows.length;
    const hasSubtitle = !!subtitle;

    const titleH = 26;
    const subtitleH = hasSubtitle ? 18 : 0;
    const rowsH = rowCount ? (rowCount * 18 + Math.max(0, rowCount - 1) * 6 + 10) : 0;
    const basePad = 10 + 16;
    const contentH = titleH + subtitleH + rowsH + basePad;

    const minH = isEnemyAbility ? 56 : 62;
    const maxH = isEnemyAbility ? 140 : 160;
    let overlayH = Math.max(minH, Math.min(maxH, contentH));

    if (isEnemyAbility) {
      const minEnemy = 44;
      const maxEnemy = 110;
      overlayH = Math.max(minEnemy, Math.min(maxEnemy, contentH));
    }

    const heavy = rowCount >= 3;
    const blurPx = heavy ? 14 : 11;
    const bgAlpha = heavy ? 0.52 : 0.40;
    const maskSolid = isEnemyAbility ? 72 : heavy ? 82 : 65;

    const padBottom = rowCount ? 14 : 10;
    const padTop = isEnemyAbility ? 20 : 10;

    const overlayHTML = `
      <div style="
        position:absolute;
        left:0;
        right:0;
        bottom:0;
        min-height:${overlayH}px;
        pointer-events:none;
      ">
        <div style="
          position:absolute;
          inset:0;
          background: rgba(0,0,0,${bgAlpha});
          backdrop-filter: blur(${blurPx}px);
          -webkit-backdrop-filter: blur(${blurPx}px);

          -webkit-mask-image: linear-gradient(
            to top,
            rgba(0,0,0,1) ${maskSolid}%,
            rgba(0,0,0,0) 100%
          );
          mask-image: linear-gradient(
            to top,
            rgba(0,0,0,1) ${maskSolid}%,
            rgba(0,0,0,0) 100%
          );

          box-shadow: 0 -14px 36px rgba(0,0,0,.35);
        "></div>

        <div style="
          position:relative;
          padding:${padTop}px 12px ${padBottom}px 12px;
          color:#fff;
          text-shadow: 0 2px 10px rgba(0,0,0,.55);
          pointer-events:none;
        ">
          <div style="font-weight:900;font-size:18px;text-shadow:-2px 1px 2px #000000;line-height:1.2;">
            ${esc(name)}
          </div>

          ${hasSubtitle ? `<div style="margin-top:4px;opacity:.92;font-size:14px;line-height:1.2;">${esc(subtitle)}</div>` : ""}

          ${rowsHTML ? `<div style="margin-top:10px;display:grid;gap:6px;">${rowsHTML}</div>` : ""}
        </div>
      </div>
    `.trim();

    const content = `
      <div style="
        overflow:hidden;
        border-radius:14px;
        background:rgba(0,0,0,.22);
        border:1px solid rgba(255,255,255,.10);
      ">

        ${
          img
            ? `
              <div style="position:relative;">
                <img src="${esc(img)}" alt="${esc(name)}" style="width:100%;height:auto;display:block;" />
                ${overlayHTML}
              </div>
            `
            : `
              <div style="padding:10px 12px;">
                <div style="font-weight:900;font-size:18px;line-height:1.2;">${esc(name)}</div>
                ${subtitle ? `<div style="margin-top:4px;opacity:.85;font-size:14px;line-height:1.2;">${esc(subtitle)}</div>` : ""}
                ${rowsHTML ? `<div style="margin-top:10px;display:grid;gap:6px;">${rowsHTML}</div>` : ""}
              </div>
            `
        }

        ${
          safeBody
            ? `
              <div style="
                margin-top:-1px;
                background:#ffffff;
                padding:1px 10px;
                color:#000;
                font-size:14px;
              ">
                ${safeBody}
              </div>
            `
            : ""
        }

      </div>
    `.trim();

    const speaker = ChatMessage.getSpeaker({
      actor: actorOrSpeakerDoc instanceof Actor ? actorOrSpeakerDoc : null,
      token: actorOrSpeakerDoc instanceof TokenDocument ? actorOrSpeakerDoc : null,
    });

    await ChatMessage.create({ speaker, content });
  } catch (e) {
    console.error("ADM messages | admPostDocCard failed:", e);
  }
}

function _admPatchChatButtons(html) {
  let body = String(html ?? "");
  if (!body) return body;

  const ADD =
    "display:inline-block !important;" +
    "height:20px !important;" +
    "line-height:18px !important;" +
    "padding:0 5px !important;" +
    "font-size:12px !important;" +
    "border-radius:4px !important;" +
    "background:#d9d9d9 !important;" +
    "color:#000 !important;" +
    "border:1px solid #000 !important;" +
    "box-shadow:none !important;";

  const RX =
    /<button\b([^>]*\bclass="[^"]*\b(admth-res-btn|admth-fear-btn|admth-st-btn|admth-range-btn|adm-fear-btn)\b[^"]*"[^>]*)>/gi;

  body = body.replace(RX, (m, attrs) => {
    if (/\bstyle="/i.test(attrs)) {
      return `<button ${attrs.replace(/\bstyle="([^"]*)"/i, (mm, s) => `style="${s};${ADD}"`)}>`;
    }
    return `<button ${attrs} style="${ADD}">`;
  });

  return body;
}

export async function admPostItemToChat(actor, item, opts = {}) {
  try {
    if (!actor || !item) return;

    const sys = item.system ?? {};
    const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

    const _loc = (keyOrText) => {
      if (!keyOrText) return "";
      const s = String(keyOrText);
      try {
        const loc = game?.i18n?.localize?.(s);
        if (loc && loc !== s) return loc;
      } catch (_e) {}
      return s;
    };

    const _signed = (n) => {
      const x = Number(n) || 0;
      return x >= 0 ? `+${x}` : `${x}`;
    };

    const _num = (v, fallback = 0) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : fallback;
    };

    const _stressWord = (n) => {
      const x = Math.abs(Number(n) || 0);
      const mod100 = x % 100;
      const mod10 = x % 10;
      if (mod100 >= 11 && mod100 <= 14) return "Стрессов";
      if (mod10 === 1) return "Стресс";
      if (mod10 >= 2 && mod10 <= 4) return "Стресса";
      return "Стрессов";
    };

    const _damageTypeShort = (dmgType) => {
      const t = String(dmgType || "").toLowerCase();
      if (t === "physical") return "ФИЗ.";
      if (t === "magical") return "МАГ.";
      if (t === "direct") return "ПРЯМ.";
      return t ? t.toUpperCase() : "";
    };

    const _rangeLabel = (rangeKey) => {
      const k = String(rangeKey ?? "").trim();
      if (!k) return "";
      const cfg = CONFIG.ADM_DAGGERHEART?.ranges ?? {};
      return _loc(cfg[k] ?? k);
    };

    const _weaponTypeLabel = (weaponTypeKey) => {
      const k = String(weaponTypeKey ?? "").trim();
      if (!k) return "";
      const cfg = CONFIG.ADM_DAGGERHEART?.weapon?.weaponTypes ?? {};
      return _loc(cfg[k] ?? k);
    };

    const _gripLabel = (gripKey) => {
      const k = String(gripKey ?? "").trim();
      if (!k) return "";
      const cfg = CONFIG.ADM_DAGGERHEART?.weapon?.grips ?? {};
      return _loc(cfg[k] ?? k);
    };

    const _traitLabel = (traitKey) => {
      const k = String(traitKey ?? "").trim();
      if (!k) return "";
      const cfg = CONFIG.ADM_DAGGERHEART?.traits ?? CONFIG.ADM_DAGGERHEART?.weapon?.attributes ?? {};
      return _loc(cfg[k] ?? k);
    };

    const _gearKindLabel = (kindKey) => {
      const k = String(kindKey ?? "").trim();
      if (!k) return "";
      const cfg = CONFIG.ADM_DAGGERHEART?.gear?.kinds ?? CONFIG.ADM_DAGGERHEART?.relic?.kinds ?? {};
      return _loc(cfg[k] ?? k);
    };

    const _cardTemplateLabel = (tplKey) => {
      const k = String(tplKey ?? "").trim();
      if (!k) return "";
      const cfg = CONFIG.ADM_DAGGERHEART?.card?.templates ?? {};
      return _loc(cfg[k] ?? k);
    };

    const _cardDomainLabel = (domainKey) => {
      const k = String(domainKey ?? "").trim();
      if (!k) return "";
      const cfg = CONFIG.ADM_DAGGERHEART?.card?.domains ?? {};
      return _loc(cfg[k] ?? k);
    };

    const _enrich = async (text, rollData) => {
      const raw = String(text ?? "").trim();
      if (!raw) return "";
      let html = await foundry.applications.ux.TextEditor.enrichHTML(raw, {
        async: true,
        secrets: false,
        documents: true,
        links: true,
        rolls: true,
        rollData,
        relativeTo: actor ?? null,
      });
      const repl = globalThis.admApplyTextReplacements;
      if (typeof repl === "function") {
        html = repl(html, { actor, item, caster: null });
      }
      return String(html ?? "").trim();
    };

    // --------------------
    // subtitle
    // --------------------
    let subtitle = "";

    if (item.type === "weapon") {
      const weaponTypeKey = String(sys.weaponType ?? sys.type ?? sys.weaponClass ?? "").trim();
      const gripKey = String(sys.grip ?? sys.hold ?? sys.weaponGrip ?? "").trim();

      const wt = _weaponTypeLabel(weaponTypeKey);
      const gp = _gripLabel(gripKey);

      const parts = [];
      if (wt) parts.push(wt);
      if (gp) parts.push(gp);

      subtitle = `${parts.join(" ")}${parts.length ? " " : ""}оружие`.trim();
    } else if (item.type === "armor") {
      subtitle = "";
    } else if (item.type === "gear") {
      subtitle = _gearKindLabel(sys.kind);
    } else if (item.type === "relic") {
      subtitle = sys.kind ? _gearKindLabel(sys.kind) : "Реликвия";
} else if (item.type === "card") {
  const tplRaw = String(sys.template ?? "").trim();
  const tpl = tplRaw.toLowerCase();
  const tplLabel = _cardTemplateLabel(tplRaw);
  subtitle = tplLabel || "";

  // CLASS: Домены из domainA + domainB
  if (tpl === "class") {
    const aKey = String(sys.domainA ?? "").trim();
    const bKey = String(sys.domainB ?? "").trim();
    const a = aKey ? _cardDomainLabel(aKey) : "";
    const b = bKey ? _cardDomainLabel(bKey) : "";

    const list = [a, b].filter(Boolean).join(" + ");
    if (list) subtitle = `${subtitle} | Домены: ${list}`.trim();
  }


}


    // --------------------
    // rows
    // --------------------
    const rows = [];

    if (item.type === "weapon") {
      const attrKey = String(sys.attribute ?? sys.attr ?? sys.attackAttribute ?? sys.trait ?? "").trim();
      const attrLabel = attrKey ? _traitLabel(attrKey) : "";

      const atkModRaw = sys.attackMod ?? sys.attackModifier ?? sys.modAttack ?? sys.toHit ?? sys.attack ?? null;
      const atkMod = Number(atkModRaw);

      if (attrLabel) {
        const withMod = Number.isFinite(atkMod) && atkMod !== 0 ? `${attrLabel} ${_signed(atkMod)}` : attrLabel;
        rows.push({ k: "Атрибут", v: withMod });
      }

      const rangeKey = String(sys.range ?? sys.distance ?? sys.weaponRange ?? "").trim();
      if (rangeKey) rows.push({ k: "Дистанция", v: _rangeLabel(rangeKey) });

      const dmgFormula = String(sys.damageFormula ?? sys.damage ?? sys.formula ?? "").trim();
      const dmgTypeKey = String(sys.damageType ?? "").trim();
      if (dmgFormula) {
        const dmgShort = _damageTypeShort(dmgTypeKey);
        rows.push({ k: "Урон", v: dmgShort ? `${dmgFormula} ${dmgShort}` : dmgFormula });
      }
    }

    if (item.type === "armor") {
      const armorValue = _num(sys.baseDefense ?? sys.armor ?? sys.defense ?? sys.value ?? 0);

      const n = _num(
        sys.damageThresholds?.noticeable ??
          sys.thresholds?.noticeable ??
          sys.noticeableThreshold ??
          sys.noticeable ??
          0
      );

      const h = _num(
        sys.damageThresholds?.heavy ??
          sys.thresholds?.heavy ??
          sys.heavyThreshold ??
          sys.heavy ??
          0
      );

      if (armorValue) rows.push({ k: "Броня", v: String(armorValue) });
      if (n || h) rows.push({ k: "Пороги", v: `[${n || 0} | ${h || 0}]` });
    }

    if (item.type === "card") {
      const tpl = String(sys.template ?? "").toLowerCase();
      if (tpl === "subclass") {
        const magicAttr = String(sys.magicAttribute ?? "").trim();
        if (magicAttr) {
          const label = _traitLabel(magicAttr) || magicAttr;
          rows.push({ k: "Атрибут магии", v: label });
        }
      }
    }

    // --------------------
    // bodyHTML
    // --------------------
    let bodyHTML = "";
    const rollData = actor?.getRollData?.() ?? actor?.system ?? {};

    if (item.type === "card") {
      const tpl = String(sys.template ?? "").toLowerCase();

      if (tpl === "class") {
        const parts = [];

        const classHTML = await _enrich(sys.description ?? "", rollData);
        if (classHTML) {
          parts.push(`
            <div style="margin:10px 0 0;">
              <div style="font-weight:900;margin:0 0 6px;">Свойство класса</div>
              ${classHTML}
            </div>
          `.trim());
        }

        const hopeHTML = await _enrich(sys.hopeProperty ?? "", rollData);
        if (hopeHTML) {
          parts.push(`
            <div style="margin:12px 0 0;">
              <div style="font-weight:900;margin:0 0 6px;">Свойство Надежды</div>
              ${hopeHTML}
            </div>
          `.trim());
        }

        bodyHTML = parts.join("");
      } else if (tpl === "subclass") {
        const parts = [];

        const baseHTML = await _enrich(sys.baseText ?? "", rollData);
        parts.push(`
          <div style="margin:10px 0 0;">
            <div style="font-weight:900;margin:0 0 6px;">Основа (1 уровень)</div>
            ${baseHTML || ""}
          </div>
        `.trim());

        const specHTML = await _enrich(sys.specText ?? "", rollData);
        parts.push(`
          <div style="margin:12px 0 0;">
            <div style="font-weight:900;margin:0 0 6px;">Специализация (5 уровень)</div>
            ${specHTML || ""}
          </div>
        `.trim());

        const mastHTML = await _enrich(sys.masteryText ?? "", rollData);
        parts.push(`
          <div style="margin:12px 0 0;">
            <div style="font-weight:900;margin:0 0 6px;">Мастерство (8 уровень)</div>
            ${mastHTML || ""}
          </div>
        `.trim());

        bodyHTML = parts.join("");
      } else {
        bodyHTML = await _enrich(sys.description ?? "", rollData);
      }
    } else {
      bodyHTML = await _enrich(sys.description ?? sys.notes ?? sys.feature ?? "", rollData);
    }

    // --------------------
    // tier prefix
    // --------------------
    const tierRaw = sys?.tier ?? sys?.level ?? 1;
    const tierValue = String(tierRaw ?? "").trim();
    const tierPrefix = tierValue ? `[${tierValue}] ` : "";

    await admPostDocCard(actor, {
      name: `${tierPrefix}${_admAafaSafeName(item.name)}`,

      img: item.img,
      subtitle,
      rows,
      bodyHTML,
      variant: item.type === "enemyAbility" || item.type === "enemy-ability" ? "enemy-ability" : "",
    });
  } catch (e) {
    console.error("ADM messages | admPostItemToChat failed:", e);
  }
}
function _admAafaSafeName(name) {
  const s = String(name ?? "");
  const mod = game?.modules?.get?.("automated-animations-for-all");
  if (!mod?.active) return s;

  // Ломаем все потенциальные совпадения типа "лук", "меч" и т.д.
  // Визуально почти не меняется, но строка уже не содержит цельных подстрок.
  // Пример: "лук" => "л\u200Bу\u200Bк"
  return s.replace(/\S/g, (ch) => `${ch}\u200B`).replace(/\u200B$/g, "");
}
function _admAafaBreakAllText(input) {
  const mod = game?.modules?.get?.("automated-animations-for-all");
  if (!mod?.active) return input;

  // ломаем любые совпадения, даже если триггер в описании
  if (typeof input === "string") {
    return String(input).replace(/[^\s]/g, (ch) => `${ch}\u200B`).replace(/\u200B$/g, "");
  }

  // массивы строк/объектов (rows)
  if (Array.isArray(input)) {
    return input.map((v) => _admAafaBreakAllText(v));
  }

  // объекты: рекурсивно только по строковым полям
  if (input && typeof input === "object") {
    const out = Array.isArray(input) ? [] : {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = _admAafaBreakAllText(v);
    }
    return out;
  }

  return input;
}
