// Бренд-кит: оригиналы логотипов, палитра, шрифты, тон коммуникаций.
// Логотипы хранятся байт-в-байт как загруженные файлы и никогда не
// передаются в нейросеть и не перерисовываются.

import * as store from "./store.js";
import * as ai from "./ai.js";
import { h, field, toast, formData, select } from "./ui.js";
import { brandbookSchema } from "./prompts.js";

export const DEFAULT_BRAND = {
  orgName: "",
  orgFull: "",
  industry: "",
  headcount: "",
  values: "",
  tone: "",
  vocabulary: "",
  forbidden: "",
  signer: "",
  logoRules: "",
  colors: [
    { name: "Основной", hex: "#1F3A93", role: "основной" },
    { name: "Акцент", hex: "#F5A623", role: "акцентный" },
    { name: "Светлый фон", hex: "#F4F6FB", role: "фон" },
    { name: "Текст", hex: "#1A1A1A", role: "текст" },
    { name: "Белый", hex: "#FFFFFF", role: "фон" },
  ],
  headingFont: "Montserrat",
  bodyFont: "Open Sans",
  fontFiles: {}, // { heading: {name, data(ArrayBuffer)}, body: {...} }
  logos: [], // { id, name, dataUrl, mime, width, height, bg: 'light'|'dark'|'any', size }
  clearZone: 50, // охранное поле, % от высоты логотипа
  minLogoPx: 120, // минимальная ширина логотипа на макете, px
};

export async function loadBrand() {
  const b = await store.get("brand", null);
  return { ...DEFAULT_BRAND, ...(b || {}) };
}

export async function saveBrand(b) {
  await store.set("brand", b);
}

// ---------- Шрифты ----------

const loadedGoogle = new Set();

export async function applyFonts(brand) {
  const fams = { heading: brand.headingFont, body: brand.bodyFont };
  const result = { heading: "Arial", body: "Arial" };
  for (const role of ["heading", "body"]) {
    const file = brand.fontFiles?.[role];
    if (file?.data) {
      const family = `Brand${role === "heading" ? "Heading" : "Body"}`;
      try {
        const ff = new FontFace(family, file.data);
        await ff.load();
        document.fonts.add(ff);
        result[role] = family;
        continue;
      } catch {
        /* файл шрифта повреждён — используем название */
      }
    }
    const name = (fams[role] || "").trim();
    if (!name) continue;
    if (!loadedGoogle.has(name)) {
      loadedGoogle.add(name);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400;600;700;800&display=swap&subset=cyrillic`;
      document.head.append(link);
    }
    result[role] = name;
  }
  try {
    await Promise.all([
      document.fonts.load(`700 40px "${result.heading}"`, "Аа"),
      document.fonts.load(`400 20px "${result.body}"`, "Аа"),
    ]);
  } catch {
    /* шрифт недоступен — браузер возьмёт запасной */
  }
  return result;
}

// ---------- Логотипы ----------

function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

async function logoFromFile(file) {
  const dataUrl = await readAsDataURL(file);
  const img = await loadImage(dataUrl);
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  if (file.type === "image/svg+xml" && (!width || !height)) {
    width = 1000;
    height = 400;
  }
  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ""),
    dataUrl,
    mime: file.type,
    size: file.size,
    width,
    height,
    bg: "any",
  };
}

/** Средняя яркость фона (0–1) — для выбора подходящей версии логотипа. */
export function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(hex1, hex2) {
  const a = luminance(hex1);
  const b = luminance(hex2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function pickLogo(brand, bgHex, preferredId) {
  const logos = brand.logos || [];
  if (preferredId && preferredId !== "auto") return logos.find((l) => l.id === preferredId) || null;
  const dark = luminance(bgHex) < 0.35;
  return (
    logos.find((l) => l.bg === (dark ? "dark" : "light")) ||
    logos.find((l) => l.bg === "any") ||
    logos[0] ||
    null
  );
}

// ---------- Экран ----------

export async function render(root) {
  const brand = await loadBrand();
  root.append(
    h("div", { class: "page-head" },
      h("h1", {}, "Бренд-кит"),
      h("p", { class: "lead" }, "Всё, что приложение должно знать о фирменном стиле и организации. Эти данные автоматически учитываются во всех текстах и макетах."),
    ),
  );

  // --- Импорт брендбука ---
  const bbInput = h("input", { type: "file", accept: "application/pdf,image/png,image/jpeg,image/webp" });
  const bbStatus = h("span", { class: "hint" });
  root.append(
    h("section", { class: "card" },
      h("h2", {}, "1. Загрузить брендбук (по желанию)"),
      h("p", {}, "Загрузите PDF брендбука (до ~30 МБ, до 100 страниц) или скриншоты ключевых страниц — Claude вытащит цвета, шрифты, тон и правила использования логотипа. Проверьте результат и поправьте вручную."),
      h("div", { class: "row" }, bbInput,
        h("button", {
          class: "btn btn-primary",
          type: "button",
          onclick: async () => {
            const f = bbInput.files?.[0];
            if (!f) return toast("Выберите файл брендбука", "error");
            bbStatus.textContent = "Читаю брендбук… это может занять 1–2 минуты";
            try {
              const block = await ai.fileToContentBlock(f);
              const data = await ai.generateJSON({
                system: "Ты — бренд-дизайнер. Извлеки из брендбука параметры фирменного стиля. Цвета — только реально указанные в брендбуке, в HEX (переведи из RGB/CMYK, если нужно). Если параметра нет — пустая строка. Пиши по-русски.",
                messages: [{ role: "user", content: [block, { type: "text", text: "Извлеки параметры фирменного стиля." }] }],
                schema: brandbookSchema,
              });
              Object.assign(brand, {
                orgName: data.orgName || brand.orgName,
                tone: data.tone || brand.tone,
                values: data.values || brand.values,
                logoRules: data.logoRules || brand.logoRules,
                forbidden: data.forbidden || brand.forbidden,
                headingFont: data.headingFont || brand.headingFont,
                bodyFont: data.bodyFont || brand.bodyFont,
              });
              const cols = (data.colors || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c.hex));
              if (cols.length) brand.colors = cols.map((c) => ({ ...c, hex: c.hex.toUpperCase() }));
              await saveBrand(brand);
              toast("Брендбук прочитан. Проверьте поля ниже.");
              location.reload();
            } catch (e) {
              bbStatus.textContent = "";
              toast(e.message, "error");
            }
          },
        }, "Прочитать брендбук"),
        bbStatus,
      ),
    ),
  );

  // --- Логотипы ---
  const logoList = h("div", { class: "logo-grid" });
  const drawLogos = () => {
    logoList.replaceChildren(
      ...(brand.logos.length
        ? brand.logos.map((l) =>
          h("div", { class: `logo-card bg-${l.bg}` },
            h("div", { class: "logo-preview" }, h("img", { src: l.dataUrl, alt: l.name })),
            h("input", { type: "text", value: l.name, onchange: (e) => { l.name = e.target.value; saveBrand(brand); } }),
            field("Для какого фона", select("bg", [["any", "любой"], ["light", "светлый фон"], ["dark", "тёмный фон"]], l.bg)),
            h("small", { class: "hint" }, `${l.mime === "image/svg+xml" ? "SVG (вектор)" : `${l.width}×${l.height} px`} · ${(l.size / 1024).toFixed(0)} КБ`),
            l.mime !== "image/svg+xml" && l.width < 800 && h("small", { class: "warn" }, "Низкое разрешение: для печати и больших форматов лучше PNG от 1500 px или SVG."),
            l.mime === "image/jpeg" && h("small", { class: "warn" }, "JPG не поддерживает прозрачность — на цветном фоне будет виден прямоугольник. Попросите у дизайнера PNG или SVG."),
            h("button", {
              class: "btn btn-ghost btn-danger",
              type: "button",
              onclick: async () => {
                if (!confirm(`Удалить логотип «${l.name}»?`)) return;
                brand.logos = brand.logos.filter((x) => x.id !== l.id);
                await saveBrand(brand);
                drawLogos();
              },
            }, "Удалить"),
          ),
        )
        : [h("p", { class: "muted" }, "Логотипы ещё не загружены.")]),
    );
    logoList.querySelectorAll("select[name=bg]").forEach((sel, i) => {
      sel.addEventListener("change", () => {
        brand.logos[i].bg = sel.value;
        saveBrand(brand);
        drawLogos();
      });
    });
  };
  const logoInput = h("input", {
    type: "file",
    multiple: true,
    accept: "image/png,image/svg+xml,image/webp,image/jpeg",
    onchange: async (e) => {
      for (const f of e.target.files) brand.logos.push(await logoFromFile(f));
      await saveBrand(brand);
      e.target.value = "";
      drawLogos();
      toast("Логотип добавлен как есть, без изменений");
    },
  });
  root.append(
    h("section", { class: "card" },
      h("h2", {}, "2. Логотипы — только оригиналы"),
      h("div", { class: "notice notice-strong" },
        h("b", {}, "Почему логотип не генерируется нейросетью. "),
        "Любой генератор изображений перерисовывает логотип «по памяти» — искажает буквы, пропорции и цвета. Поэтому здесь логотип хранится как файл-оригинал и при сборке макета просто накладывается поверх: без перерисовки, без изменения цветов и пропорций, только пропорциональное масштабирование и размещение с охранным полем.",
      ),
      h("p", {}, "Загрузите официальные файлы логотипа от дизайнера: лучше SVG или PNG с прозрачным фоном. Если есть версии для светлого и тёмного фона — загрузите обе и отметьте, какая для какого фона."),
      logoInput,
      logoList,
    ),
  );
  drawLogos();

  // --- Палитра ---
  const palette = h("div", { class: "palette" });
  const drawPalette = () => {
    palette.replaceChildren(
      ...brand.colors.map((c, i) => {
        const hexIn = h("input", { type: "text", value: c.hex, class: "mono", onchange: (e) => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { c.hex = e.target.value.toUpperCase(); drawPalette(); } } });
        return h("div", { class: "swatch" },
          h("input", { type: "color", value: c.hex, oninput: (e) => { c.hex = e.target.value.toUpperCase(); hexIn.value = c.hex; } }),
          h("div", { class: "swatch-fields" },
            h("input", { type: "text", value: c.name, placeholder: "Название", onchange: (e) => (c.name = e.target.value) }),
            hexIn,
            select("role", ["основной", "дополнительный", "акцентный", "фон", "текст"], c.role),
          ),
          h("button", { class: "icon-btn", type: "button", title: "Удалить цвет", onclick: () => { brand.colors.splice(i, 1); drawPalette(); } }, "×"),
        );
      }),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => { brand.colors.push({ name: "Новый цвет", hex: "#888888", role: "дополнительный" }); drawPalette(); } }, "+ Добавить цвет"),
    );
    palette.querySelectorAll("select[name=role]").forEach((s, i) => s.addEventListener("change", () => (brand.colors[i].role = s.value)));
  };
  drawPalette();

  // --- Шрифты ---
  const fontFileInput = (role) =>
    h("input", {
      type: "file",
      accept: ".ttf,.otf,.woff,.woff2",
      onchange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        brand.fontFiles = { ...(brand.fontFiles || {}), [role]: { name: f.name, data: await f.arrayBuffer() } };
        await saveBrand(brand);
        toast(`Файл шрифта «${f.name}» сохранён`);
      },
    });

  const form = h("form", { class: "grid-2", onsubmit: (e) => e.preventDefault() },
    field("Краткое название организации", h("input", { name: "orgName", value: brand.orgName, placeholder: "ООО «Ромашка»" })),
    field("Полное наименование", h("input", { name: "orgFull", value: brand.orgFull, placeholder: "Общество с ограниченной ответственностью «Ромашка»" })),
    field("Сфера деятельности", h("input", { name: "industry", value: brand.industry, placeholder: "производство, ритейл, IT, медицина…" })),
    field("Численность персонала", h("input", { name: "headcount", value: brand.headcount, placeholder: "например, 350 человек, 4 филиала" })),
    field("Миссия и ценности", h("textarea", { name: "values", rows: 3 }, brand.values)),
    field("Тон коммуникаций", h("textarea", { name: "tone", rows: 3, placeholder: "Например: на «вы», уважительно и тепло, без жаргона; коротко и по делу" }, brand.tone)),
    field("Принятые обращения и формулировки", h("textarea", { name: "vocabulary", rows: 2, placeholder: "«Коллеги», «команда», название сотрудников…" }, brand.vocabulary)),
    field("Нежелательные слова и приёмы", h("textarea", { name: "forbidden", rows: 2, placeholder: "Например: без эмодзи в официальных письмах, не «персонал», а «сотрудники»" }, brand.forbidden)),
    field("Подписант документов по умолчанию", h("input", { name: "signer", value: brand.signer, placeholder: "Генеральный директор [ФИО]" })),
    field("Правила использования логотипа", h("textarea", { name: "logoRules", rows: 3 }, brand.logoRules)),
    field("Шрифт заголовков", h("input", { name: "headingFont", value: brand.headingFont }), "Название шрифта из Google Fonts или загрузите файл ниже"),
    field("Файл шрифта заголовков", fontFileInput("heading"), brand.fontFiles?.heading ? `Загружен: ${brand.fontFiles.heading.name}` : "TTF / OTF / WOFF"),
    field("Шрифт основного текста", h("input", { name: "bodyFont", value: brand.bodyFont })),
    field("Файл шрифта текста", fontFileInput("body"), brand.fontFiles?.body ? `Загружен: ${brand.fontFiles.body.name}` : "TTF / OTF / WOFF"),
    field("Охранное поле логотипа, % от его высоты", h("input", { name: "clearZone", type: "number", min: 0, max: 200, value: brand.clearZone })),
    field("Минимальная ширина логотипа, px", h("input", { name: "minLogoPx", type: "number", min: 20, max: 2000, value: brand.minLogoPx })),
  );

  root.append(
    h("section", { class: "card" }, h("h2", {}, "3. Цвета фирменного стиля"), h("p", { class: "hint" }, "В дизайн-студии можно будет выбирать только эти цвета — так макеты не выйдут за рамки брендбука."), palette),
    h("section", { class: "card" }, h("h2", {}, "4. Организация, тон и шрифты"), form),
    h("div", { class: "sticky-actions" },
      h("button", {
        class: "btn btn-primary btn-lg",
        type: "button",
        onclick: async () => {
          const d = formData(form);
          Object.assign(brand, d, { clearZone: Number(d.clearZone) || 0, minLogoPx: Number(d.minLogoPx) || 0 });
          await saveBrand(brand);
          toast("Бренд-кит сохранён");
        },
      }, "Сохранить бренд-кит"),
    ),
  );
}
