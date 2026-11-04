// Дизайн-студия: сборка корпоративных визуалов по брендбуку.
// Принцип: фон, текст и графика рисуются из параметров бренд-кита,
// а логотип накладывается ОРИГИНАЛЬНЫМ файлом — только пропорциональное
// масштабирование и размещение, без перерисовки и изменения цветов.

import * as ai from "./ai.js";
import { loadBrand, applyFonts, loadImage, luminance, contrast, pickLogo } from "./brand.js";
import { h, field, select, toast, download, resultPanel, emptyKeyNotice } from "./ui.js";
import { designCopySystem, imagePromptSystem, brandContext } from "./prompts.js";
import { ENGINES, writePrompts, svgIllustration, kandinsky, gptImage, proofreadImage } from "./imagegen.js";

export const FORMATS = {
  post: { label: "Пост 1:1 (1080×1080)", w: 1080, h: 1080 },
  post45: { label: "Пост 4:5 (1080×1350)", w: 1080, h: 1350 },
  story: { label: "Сторис / вертикаль (1080×1920)", w: 1080, h: 1920 },
  wide: { label: "Экран / слайд 16:9 (1920×1080)", w: 1920, h: 1080 },
  mail: { label: "Шапка письма / рассылки (1200×400)", w: 1200, h: 400 },
  a4: { label: "Объявление A4 для печати (2480×3508)", w: 2480, h: 3508 },
  a4land: { label: "Грамота / благодарность A4 альбомная (3508×2480)", w: 3508, h: 2480 },
  vkcover: { label: "Обложка сообщества ВКонтакте (1920×768)", w: 1920, h: 768 },
  tg: { label: "Пост Telegram / ВКонтакте 16:9 (1280×720)", w: 1280, h: 720 },
  badge: { label: "Бейдж сотрудника 90×55 мм (1063×650)", w: 1063, h: 650 },
};

// Безопасные зоны: доли от размера, которые на площадке закрывает интерфейс
// или обрезает телефон. Текст и логотип держатся внутри.
export const SAFE = {
  story: { t: 0.13, b: 0.17, s: 0.05, note: "сверху и снизу в сторис интерфейс закрывает часть кадра" },
  vkcover: { t: 0.12, b: 0.12, s: 0.2, note: "на телефоне обложка обрезается по краям" },
  badge: { t: 0.06, b: 0.06, s: 0.06, note: "отступ под обрезку при печати" },
  a4: { t: 0.03, b: 0.03, s: 0.03, note: "поля принтера" },
  a4land: { t: 0.03, b: 0.03, s: 0.03, note: "поля принтера" },
};

export const TEMPLATES = {
  congrats: {
    label: "Поздравление",
    texts: { kicker: "Поздравляем!", title: "С днём рождения, [Имя]!", subtitle: "Желаем вдохновения, здоровья и ярких проектов", body: "", cta: "", footer: "С уважением, коллеги" },
  },
  welcome: {
    label: "Приветствуем в команде",
    texts: { kicker: "Добро пожаловать в команду", title: "[Имя Фамилия]", subtitle: "[Должность], [подразделение]", body: "Расскажите новому коллеге, где у нас лучший кофе", cta: "", footer: "" },
  },
  vacancy: {
    label: "Вакансия",
    texts: { kicker: "Мы ищем", title: "[Название должности]", subtitle: "[Город] · [график]", body: "[Главное, чем привлекательна вакансия]", cta: "Откликнуться", footer: "[e-mail или телефон HR]" },
  },
  event: {
    label: "Анонс мероприятия",
    texts: { kicker: "Анонс", title: "[Название мероприятия]", subtitle: "[О чём и для кого]", body: "", cta: "Зарегистрироваться", footer: "[Дата] · [время] · [место]" },
  },
  announce: {
    label: "Объявление",
    texts: { kicker: "Важно", title: "[Суть объявления]", subtitle: "", body: "[Подробности: что, когда, что нужно сделать]", cta: "", footer: "Отдел персонала" },
  },
  value: {
    label: "Ценность / цитата",
    texts: { kicker: "Наши ценности", title: "«[Цитата или ценность]»", subtitle: "[Автор / пояснение]", body: "", cta: "", footer: "" },
  },
  number: {
    label: "Цифра / итоги",
    texts: { kicker: "Итоги года", title: "[250]", subtitle: "[новых коллег присоединились к нам]", body: "", cta: "", footer: "" },
  },
  thanks: {
    label: "Благодарность",
    texts: { kicker: "Спасибо!", title: "[Имя / команда]", subtitle: "[За что благодарим]", body: "", cta: "", footer: "" },
  },
  certificate: {
    label: "Грамота / благодарственное письмо",
    texts: { kicker: "Благодарность", title: "[Имя Фамилия]", subtitle: "за [добросовестный труд, вклад в проект…]", body: "[Пара тёплых слов о заслугах сотрудника]", cta: "", footer: "[Должность руководителя]  ________  [И. О. Фамилия]     [дата]" },
    format: "a4land",
    style: "certificate",
  },
  badge: {
    label: "Бейдж сотрудника",
    texts: { kicker: "", title: "[Имя Фамилия]", subtitle: "[Должность]", body: "", cta: "", footer: "[Подразделение]" },
    format: "badge",
    style: "minimal",
  },
};

const STYLES = {
  classic: "Классика — фирменный цвет и акцентная плашка",
  geometry: "Геометрия — фирменные фигуры",
  photo: "Фото на весь макет с фирменным затемнением",
  split: "Фото + цветной блок",
  minimal: "Минимализм — светлый фон и линия",
  bold: "Крупная типографика — заголовок на весь макет",
  duotone: "Дуотон — фото в двух фирменных цветах",
  editorial: "Журнальный — светлый фон, тонкие линейки",
  certificate: "Грамота — рамка в фирменных цветах",
};

const LOGO_POS = {
  tl: "Слева сверху",
  tr: "Справа сверху",
  tc: "По центру сверху",
  bl: "Слева снизу",
  br: "Справа снизу",
  bc: "По центру снизу",
};

const LOGO_SIZE = { s: ["Маленький", 0.16], m: ["Средний", 0.22], l: ["Крупный", 0.3] };

const TEXT_FIELDS = [
  ["kicker", "Надзаголовок"],
  ["title", "Заголовок"],
  ["subtitle", "Подзаголовок"],
  ["body", "Основной текст"],
  ["cta", "Кнопка / призыв"],
  ["footer", "Подпись внизу (дата, место, контакты)"],
];

// ---------- Отрисовка ----------

function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function wrap(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= maxWidth || !line) line = test;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export function fit(ctx, text, fontFn, maxWidth, maxLines, size, minSize) {
  let s = size;
  for (; s >= minSize; s = Math.floor(s * 0.92)) {
    ctx.font = fontFn(s);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) return { lines, size: s };
  }
  ctx.font = fontFn(minSize);
  return { lines: wrap(ctx, text, maxWidth).slice(0, maxLines), size: minSize, overflow: true };
}

export function drawCover(ctx, img, x, y, w, hgt, focusY = 0.5) {
  const r = Math.max(w / img.width, hgt / img.height);
  const iw = img.width * r;
  const ih = img.height * r;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, hgt);
  ctx.clip();
  ctx.drawImage(img, x + (w - iw) / 2, y + (hgt - ih) * focusY, iw, ih);
  ctx.restore();
}

function regionLuminance(ctx, x, y, w, hgt) {
  try {
    const d = ctx.getImageData(Math.max(0, x | 0), Math.max(0, y | 0), Math.max(1, w | 0), Math.max(1, hgt | 0)).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]].map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n++;
    }
    return sum / n;
  } catch {
    return 1;
  }
}

export function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Перекрашивает изображение в два фирменных цвета: тени — в цвет фона, света — в акцент. */
function duotone(ctx, W, H, darkHex, lightHex) {
  const toRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [d, l] = [toRgb(darkHex), toRgb(lightHex)];
  try {
    const img = ctx.getImageData(0, 0, W, H);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const t = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      px[i] = d[0] + (l[0] - d[0]) * t;
      px[i + 1] = d[1] + (l[1] - d[1]) * t;
      px[i + 2] = d[2] + (l[2] - d[2]) * t;
    }
    ctx.putImageData(img, 0, 0);
  } catch {
    /* изображение недоступно для обработки — оставляем как есть */
  }
}

/** Рисует макет. Возвращает список предупреждений о соответствии брендбуку. */
export async function draw(canvas, state, brand, fonts, photoImg, logoImgCache) {
  const F = FORMATS[state.format];
  const W = F.w;
  const H = F.h;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const warnings = [];
  const base = Math.min(W, H);
  const landscape = W / H > 1.4;
  const pad = Math.round(base * 0.075);
  const colors = brand.colors.length ? brand.colors : [{ hex: "#1F3A93" }, { hex: "#FFFFFF" }];
  const bg = colors[state.bg]?.hex || colors[0].hex;
  const accent = colors[state.accent]?.hex || colors[1]?.hex || "#F5A623";
  const style = state.style;
  const photoStyle = style === "photo" || style === "split" || style === "duotone";
  const hasPhoto = Boolean(photoImg) && photoStyle;
  if (photoStyle && !photoImg) warnings.push("Для этого стиля загрузите фотографию или фон.");
  const lightBg = colors.find((c) => c.role === "фон")?.hex || "#FFFFFF";

  // Безопасная зона площадки
  const sz = SAFE[state.format] || { t: 0, b: 0, s: 0 };
  const ins = { t: sz.t * H, b: sz.b * H, s: sz.s * W };

  // Область для текста
  let area = { x: pad + ins.s, y: pad + ins.t, w: W - (pad + ins.s) * 2, h: H - pad * 2 - ins.t - ins.b };
  let titleMul = 1;
  let titleLines = 4;
  let forceCenter = false;
  let frameInset = 0;
  let textBg = bg;
  let anchor = "center";

  // --- Фон ---
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  if (style === "minimal" || style === "editorial" || style === "certificate") {
    const light = lightBg;
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, W, H);
    textBg = light;
    if (style === "minimal") {
      ctx.fillStyle = accent;
      ctx.fillRect(pad, H - pad * 0.6 - ins.b, W - pad * 2, Math.max(4, base * 0.008));
    } else if (style === "editorial") {
      titleMul = 1.1; // линейки рисуются ниже, когда известна зона логотипа
    } else {
      // Грамота: двойная рамка в фирменных цветах, всё по центру
      const o = pad * 0.45;
      ctx.strokeStyle = bg;
      ctx.lineWidth = Math.max(6, base * 0.012);
      ctx.strokeRect(o, o, W - o * 2, H - o * 2);
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(2, base * 0.004);
      const o2 = o + base * 0.025;
      ctx.strokeRect(o2, o2, W - o2 * 2, H - o2 * 2);
      area = { x: o2 + pad * 0.6, y: o2 + pad * 0.5, w: W - (o2 + pad * 0.6) * 2, h: H - (o2 + pad * 0.5) * 2 };
      forceCenter = true;
      frameInset = o2;
      titleMul = 1.5;
      titleLines = 2;
    }
  } else if (style === "bold") {
    ctx.fillStyle = accent;
    ctx.fillRect(area.x, area.y + area.h - Math.max(10, base * 0.02), area.w * 0.25, Math.max(10, base * 0.02));
    titleMul = 1.45;
    titleLines = 5;
  } else if (style === "classic") {
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, Math.max(10, base * 0.025), H);
  } else if (style === "geometry") {
    const rand = rng(state.seed || 1);
    const pool = colors.filter((c) => c.hex.toUpperCase() !== bg.toUpperCase());
    // Фигуры ставим в сторону, противоположную логотипу, чтобы охранное поле было чистым
    const logoAtTop = !state.logoOn || state.logoPos[0] === "t";
    const anchors = logoAtTop ? [[W, H], [W, H * 0.6]] : [[W, 0], [W, H * 0.4]];
    for (let i = 0; i < 5; i++) {
      const c = pool[Math.floor(rand() * pool.length)]?.hex || accent;
      const corner = anchors[i % 2];
      const cx = corner[0] - rand() * W * 0.3;
      const cy = corner[1] + (logoAtTop ? -1 : 1) * rand() * H * 0.2;
      const r = base * (0.18 + rand() * 0.35);
      ctx.fillStyle = hexA(c, 0.18 + rand() * 0.35);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = accent;
    ctx.fillRect(pad, pad * 0.6, base * 0.12, Math.max(6, base * 0.012));
  } else if ((style === "photo" || style === "duotone") && photoImg) {
    drawCover(ctx, photoImg, 0, 0, W, H, state.focusY);
    if (style === "duotone") duotone(ctx, W, H, bg, accent);
    const g = ctx.createLinearGradient(0, landscape ? 0 : H * 0.25, 0, H);
    const o = state.overlay / 100;
    g.addColorStop(0, hexA(bg, o * 0.15));
    g.addColorStop(0.55, hexA(bg, o * 0.75));
    g.addColorStop(1, hexA(bg, Math.min(1, o * 1.05)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    anchor = "bottom";
    area = { x: pad + ins.s, y: H * (landscape ? 0.3 : 0.42), w: W - (pad + ins.s) * 2, h: H * (landscape ? 0.7 : 0.58) - pad - ins.b };
  } else if (style === "split" && photoImg) {
    if (landscape || W / H >= 1) {
      const pw = Math.round(W * 0.45);
      drawCover(ctx, photoImg, W - pw, 0, pw, H, state.focusY);
      area = { x: pad, y: pad, w: W - pw - pad * 2, h: H - pad * 2 };
    } else {
      const ph = Math.round(H * 0.48);
      drawCover(ctx, photoImg, 0, 0, W, ph, state.focusY);
      area = { x: pad, y: ph + pad * 0.8, w: W - pad * 2, h: H - ph - pad * 1.8 };
      anchor = "top";
    }
  }

  // --- Логотип: размер и место (рисуем в конце, поверх всего) ---
  let logoRect = null;
  const logoMeta = pickLogo(brand, bg, state.logoId);
  if (state.logoOn && logoMeta) {
    let lw = W * LOGO_SIZE[state.logoSize][1] * (landscape ? 0.6 : 1);
    const ratio = logoMeta.height / logoMeta.width || 0.4;
    let lh = lw * ratio;
    const maxH = base * 0.16;
    if (lh > maxH) {
      lh = maxH;
      lw = lh / ratio;
    }
    if (lw < (brand.minLogoPx || 0)) warnings.push(`Логотип меньше минимального размера по брендбуку (${brand.minLogoPx} px). Выберите размер крупнее.`);
    const clear = (brand.clearZone || 0) / 100 * lh;
    const m = Math.max(pad * 0.7, clear) + frameInset; // на грамоте логотип внутри рамки
    const pos = state.logoPos;
    const x = pos[1] === "l" ? m + ins.s : pos[1] === "r" ? W - m - lw - ins.s : (W - lw) / 2;
    const y = pos[0] === "t" ? m + ins.t : H - m - lh - ins.b;
    logoRect = { x, y, w: lw, h: lh, clear };
    // Резервируем зону логотипа + охранное поле, чтобы текст туда не заходил
    if (pos[0] === "t") {
      const top = y + lh + clear;
      if (area.y < top) {
        area.h -= top - area.y;
        area.y = top;
      }
    } else {
      const bottom = y - clear;
      if (area.y + area.h > bottom) area.h = bottom - area.y;
    }
  } else if (state.logoOn && !logoMeta) {
    warnings.push("Логотип не загружен — добавьте оригинал в «Бренд-ките».");
  }

  // Журнальный стиль: тонкие линейки над и под текстом, уже за зоной логотипа
  if (style === "editorial") {
    const lw = Math.max(2, base * 0.003);
    const gapY = pad * 0.35;
    ctx.fillStyle = bg;
    ctx.fillRect(area.x, area.y, area.w, lw);
    ctx.fillRect(area.x, area.y + area.h, area.w, lw);
    ctx.fillStyle = accent;
    ctx.fillRect(area.x, area.y - lw * 2, area.w * 0.12, lw * 3);
    area = { x: area.x, y: area.y + gapY, w: area.w, h: area.h - gapY * 2 };
  }

  // --- Цвет текста: максимальный контраст из палитры ---
  let textColor;
  if (state.textColor === "auto") {
    const bgForText = hasPhoto && style !== "split" ? bg : textBg;
    const candidates = [...colors.map((c) => c.hex), "#FFFFFF", "#111111"];
    textColor = candidates.sort((a, b) => contrast(b, bgForText) - contrast(a, bgForText))[0];
  } else {
    textColor = colors[state.textColor]?.hex || "#111111";
  }
  const contrastBg = textBg;
  const cr = contrast(textColor, contrastBg);
  if (cr < 4.5 && !(style === "photo" || style === "duotone")) warnings.push(`Низкая контрастность текста и фона (${cr.toFixed(1)}:1, нужно от 4,5:1). Текст будет плохо читаться.`);
  const kickerColor = contrast(accent, contrastBg) >= 3 ? accent : textColor;

  // --- Текст ---
  const t = state.texts;
  const HF = (w) => (s) => `${w} ${s}px "${fonts.heading}", "Segoe UI", Arial, sans-serif`;
  const BF = (w) => (s) => `${w} ${s}px "${fonts.body}", "Segoe UI", Arial, sans-serif`;
  const k = landscape ? H / 1080 : base / 1080;
  const blocks = [];
  const mw = area.w;
  if (t.kicker) blocks.push({ ...fit(ctx, t.kicker.toUpperCase(), BF(700), mw, 2, 34 * k, 18 * k), font: BF(700), color: kickerColor, gap: 22 * k, lh: 1.25, spacing: 2 * k });
  if (t.title) blocks.push({ ...fit(ctx, t.title, HF(800), mw, titleLines, (landscape ? 104 : 96) * k * titleMul, 40 * k), font: HF(800), color: textColor, gap: 26 * k, lh: 1.08 });
  if (t.subtitle) blocks.push({ ...fit(ctx, t.subtitle, BF(500), mw, 3, 42 * k, 24 * k), font: BF(500), color: textColor, gap: 22 * k, lh: 1.3 });
  if (t.body) blocks.push({ ...fit(ctx, t.body, BF(400), mw, 6, 32 * k, 20 * k), font: BF(400), color: textColor, gap: 22 * k, lh: 1.4, alpha: 0.92 });
  let ctaH = 0;
  if (t.cta) ctaH = 84 * k + 30 * k;
  let footer = null;
  if (t.footer) footer = { ...fit(ctx, t.footer, BF(600), mw, 2, 30 * k, 18 * k), font: BF(600), color: textColor, lh: 1.3 };

  const blockH = (b) => b.lines.length * b.size * b.lh;
  let total = blocks.reduce((s, b) => s + blockH(b) + b.gap, 0) + ctaH;
  if (footer) total += blockH(footer) + 30 * k;
  if (total > area.h) warnings.push("Текста слишком много для этого формата — сократите или выберите формат крупнее.");
  if (blocks.some((b) => b.overflow) || footer?.overflow) warnings.push("Часть текста не поместилась — сократите формулировки.");

  let y = anchor === "top" ? area.y : anchor === "bottom" ? area.y + area.h - total : area.y + (area.h - total) / 2;
  y = Math.max(area.y, y);
  ctx.textBaseline = "top";
  const align = forceCenter ? "center" : state.align;
  const tx = align === "center" ? area.x + area.w / 2 : area.x;
  ctx.textAlign = align === "center" ? "center" : "left";

  for (const b of blocks) {
    ctx.font = b.font(b.size);
    ctx.fillStyle = b.color;
    ctx.globalAlpha = b.alpha || 1;
    if ("letterSpacing" in ctx) ctx.letterSpacing = b.spacing ? `${b.spacing}px` : "0px";
    for (const line of b.lines) {
      ctx.fillText(line, tx, y);
      y += b.size * b.lh;
    }
    ctx.globalAlpha = 1;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    y += b.gap;
  }
  if (t.cta) {
    ctx.font = BF(700)(34 * k);
    const tw = ctx.measureText(t.cta).width;
    const bw = tw + 80 * k;
    const bh = 84 * k;
    const bx = align === "center" ? area.x + (area.w - bw) / 2 : area.x;
    ctx.fillStyle = accent;
    roundRect(ctx, bx, y + 6 * k, bw, bh, bh / 2);
    ctx.fill();
    const ctaText = [...colors.map((c) => c.hex), "#FFFFFF", "#111111"].sort((a, b) => contrast(b, accent) - contrast(a, accent))[0];
    ctx.fillStyle = ctaText;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t.cta, bx + bw / 2, y + 6 * k + bh / 2);
    ctx.textAlign = align === "center" ? "center" : "left";
    ctx.textBaseline = "top";
    y += ctaH;
  }
  if (footer) {
    y += 30 * k - 22 * k;
    ctx.font = footer.font(footer.size);
    ctx.fillStyle = footer.color;
    ctx.globalAlpha = 0.85;
    for (const line of footer.lines) {
      ctx.fillText(line, tx, y);
      y += footer.size * footer.lh;
    }
    ctx.globalAlpha = 1;
  }

  // --- Логотип: накладываем оригинал ---
  if (logoRect && logoMeta) {
    let meta = logoMeta;
    // На фото выбираем версию логотипа по реальной яркости под ним
    if (state.logoId === "auto" && hasPhoto) {
      const lum = regionLuminance(ctx, logoRect.x, logoRect.y, logoRect.w, logoRect.h);
      const fake = lum < 0.35 ? "#000000" : "#FFFFFF";
      meta = pickLogo(brand, fake, "auto") || logoMeta;
    }
    let img = logoImgCache.get(meta.id);
    if (!img) {
      img = await loadImage(meta.dataUrl);
      logoImgCache.set(meta.id, img);
    }
    if (state.logoPlate) {
      const p = logoRect.clear || logoRect.h * 0.3;
      ctx.fillStyle = "#FFFFFF";
      roundRect(ctx, logoRect.x - p, logoRect.y - p, logoRect.w + p * 2, logoRect.h + p * 2, p * 0.6);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, logoRect.x, logoRect.y, logoRect.w, logoRect.h);
    if (meta.bg === "light" && !state.logoPlate && regionLuminance(ctx, logoRect.x - 4, logoRect.y - 4, 4, logoRect.h) < 0.35)
      warnings.push("Версия логотипа для светлого фона стоит на тёмном. Загрузите версию для тёмного фона или включите подложку (если разрешено брендбуком).");
    if (meta.bg === "dark" && !state.logoPlate && luminance(bg) > 0.6 && !hasPhoto)
      warnings.push("Версия логотипа для тёмного фона стоит на светлом.");
  }

  // Подсказка: безопасная зона (только в предпросмотре, в файл не попадает)
  if (state.showSafe && SAFE[state.format]) {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 64, 64, .9)";
    ctx.lineWidth = Math.max(2, base * 0.003);
    ctx.setLineDash([base * 0.02, base * 0.012]);
    ctx.strokeRect(ins.s, ins.t, W - ins.s * 2, H - ins.t - ins.b);
    ctx.restore();
  }
  return warnings;
}

// ---------- Экран ----------

export async function render(root) {
  const brand = await loadBrand();
  const fonts = await applyFonts(brand);
  const logoCache = new Map();
  let photoImg = null;
  const fondIdx = brand.colors.findIndex((c) => c.role === "основной");
  const accIdx = brand.colors.findIndex((c) => c.role === "акцентный");
  const state = {
    format: "post",
    template: "congrats",
    style: "classic",
    bg: fondIdx >= 0 ? fondIdx : 0,
    accent: accIdx >= 0 ? accIdx : Math.min(1, brand.colors.length - 1),
    textColor: "auto",
    overlay: 70,
    focusY: 0.5,
    logoOn: true,
    logoId: "auto",
    logoPos: "tl",
    logoSize: "m",
    logoPlate: false,
    showSafe: false,
    align: "left",
    seed: 7,
    texts: { ...TEMPLATES.congrats.texts },
  };

  const canvas = h("canvas", { class: "design-canvas" });
  const warnBox = h("div", { class: "warn-box" });
  const textInputs = {};
  let raf = 0;
  const redraw = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(async () => {
      const w = await draw(canvas, state, brand, fonts, photoImg, logoCache);
      warnBox.replaceChildren(
        ...(w.length
          ? w.map((x) => h("div", { class: "warn" }, x))
          : [h("div", { class: "ok" }, "Макет соответствует настройкам бренд-кита. Логотип — оригинальный файл без изменений.")]),
      );
    });
  };

  const colorOptions = brand.colors.map((c, i) => [String(i), `${c.name} (${c.hex})`]);
  const bind = (el, key, conv = (v) => v) => {
    el.addEventListener("input", () => {
      state[key] = conv(el.type === "checkbox" ? el.checked : el.value);
      redraw();
    });
    return el;
  };

  const fillTexts = (texts) => {
    for (const [k] of TEXT_FIELDS) {
      state.texts[k] = texts[k] || "";
      textInputs[k].value = state.texts[k];
    }
    redraw();
  };

  const templateSel = select("template", Object.entries(TEMPLATES).map(([k, v]) => [k, v.label]), state.template);
  templateSel.addEventListener("change", () => {
    state.template = templateSel.value;
    const tpl = TEMPLATES[state.template];
    if (tpl.format) {
      state.format = tpl.format;
      formatSel.value = tpl.format;
    }
    if (tpl.style) {
      state.style = tpl.style;
      styleSel.value = tpl.style;
    }
    fillTexts(tpl.texts);
    syncSafe();
  });

  const photoInput = h("input", {
    type: "file",
    accept: "image/*",
    onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      photoImg = await loadImage(URL.createObjectURL(f));
      if (!["photo", "split", "duotone"].includes(state.style)) {
        state.style = "photo";
        styleSel.value = "photo";
      }
      redraw();
    },
  });
  const styleSel = bind(select("style", Object.entries(STYLES), state.style), "style");
  const formatSel = bind(select("format", Object.entries(FORMATS).map(([k, v]) => [k, v.label]), state.format), "format");
  const safeNote = h("small", { class: "hint" });
  const safeRow = h("label", { class: "check" }, bind(h("input", { type: "checkbox" }), "showSafe"), " Показать безопасную зону (в файл не попадает)");
  const syncSafe = () => {
    const z = SAFE[state.format];
    safeRow.hidden = !z;
    safeNote.hidden = !z;
    safeNote.textContent = z ? `Текст и логотип держатся внутри зоны: ${z.note}.` : "";
  };
  formatSel.addEventListener("change", syncSafe);
  syncSafe();
  // Экспорт: рисуем чистую копию без служебной разметки
  const exportFile = async (mime, ext) => {
    const c = document.createElement("canvas");
    await draw(c, { ...state, showSafe: false }, brand, fonts, photoImg, logoCache);
    c.toBlob((b) => download(`${TEMPLATES[state.template].label} ${FORMATS[state.format].w}x${FORMATS[state.format].h}.${ext}`, b), mime, 0.92);
  };

  const textsForm = h("div", { class: "stack" },
    ...TEXT_FIELDS.map(([k, label]) => {
      const el = k === "body"
        ? h("textarea", { rows: 3 }, state.texts[k])
        : h("input", { type: "text", value: state.texts[k] });
      el.addEventListener("input", () => {
        state.texts[k] = el.value;
        redraw();
      });
      textInputs[k] = el;
      return field(label, el);
    }),
  );

  // --- ИИ: тексты для макета ---
  const brief = h("textarea", { rows: 3, placeholder: "О чём макет? Например: «поздравить бухгалтерию с профессиональным праздником, тепло и с юмором» или «вакансия кладовщика, склад в Подольске, з/п от 70 000, график 5/2»" });
  const aiBtn = h("button", {
    class: "btn btn-primary",
    type: "button",
    onclick: async () => {
      if (!brief.value.trim()) return toast("Опишите задачу для макета", "error");
      aiBtn.disabled = true;
      aiBtn.textContent = "Пишу тексты…";
      try {
        const data = await ai.generateJSON({
          system: designCopySystem(brand),
          messages: [{ role: "user", content: `Тип макета: ${TEMPLATES[state.template].label}. Формат: ${FORMATS[state.format].label}.\nЗадача: ${brief.value}\n\nЗаполни поля. Поле оставь пустой строкой, если оно не нужно для этого макета.` }],
          schema: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(TEXT_FIELDS.map(([k, l]) => [k, { type: "string", description: l }])),
            required: TEXT_FIELDS.map(([k]) => k),
          },
          effort: "low",
        });
        fillTexts(data);
        toast("Тексты готовы — поправьте, если нужно");
      } catch (e) {
        toast(e.message, "error");
      } finally {
        aiBtn.disabled = false;
        aiBtn.textContent = "Придумать тексты";
      }
    },
  }, "Придумать тексты");

  // --- ИИ: промпт для фона во внешней нейросети ---
  const promptPanel = resultPanel({ kind: "image-prompt", title: "Промпт для фона" });
  const promptBtn = h("button", {
    class: "btn",
    type: "button",
    onclick: () => {
      const palette = brand.colors.map((c) => `${c.name} ${c.hex}`).join(", ");
      promptPanel.run((onText, signal) =>
        ai.generate({
          system: imagePromptSystem,
          messages: [{
            role: "user",
            content: `Задача макета: ${brief.value || TEMPLATES[state.template].label}\nФормат: ${FORMATS[state.format].label}\nЛоготип будет размещён: ${LOGO_POS[state.logoPos]}\nПалитра бренда: ${palette}${brandContext(brand)}`,
          }],
          onText,
          signal,
          effort: "low",
          maxTokens: 4000,
        }));
    },
  }, "Промпт для фона в нейросети");

  // --- Иллюстрации ---
  const engineSel = select("engine", Object.entries(ENGINES), (await ai.isClaude()) ? "svg" : "kandinsky");
  const illoBrief = h("textarea", { rows: 3, placeholder: "Что изобразить? Например: «команда празднует, конфетти и воздушные шары», «новый сотрудник на первом рабочем дне, светлый офис»" });
  const illoStatus = h("span", { class: "hint" });
  const gallery = h("div", { class: "row", style: { flexWrap: "wrap" } });
  const generated = [];
  const useImage = (item) => {
    photoImg = item.img;
    if (!["photo", "split", "duotone"].includes(state.style)) {
      state.style = item.engine === "svg" ? "split" : "photo";
      styleSel.value = state.style;
    }
    redraw();
  };
  const illoBtn = h("button", {
    class: "btn btn-primary",
    type: "button",
    onclick: async () => {
      const task = illoBrief.value.trim() || brief.value.trim() || TEMPLATES[state.template].label;
      const F = FORMATS[state.format];
      const zone = `Формат ${F.w}×${F.h}. Логотип будет: ${LOGO_POS[state.logoPos]}; текст — ${["split"].includes(state.style) ? "в соседнем цветном блоке" : "в нижней части"}.`;
      illoBtn.disabled = true;
      try {
        let res;
        if (engineSel.value === "svg") {
          illoStatus.textContent = "Claude рисует иллюстрацию… это может занять до минуты";
          const isSplit = state.style === "split";
          const [w, hh] = isSplit ? (F.w / F.h >= 1 ? [Math.round(F.w * 0.45), F.h] : [F.w, Math.round(F.h * 0.48)]) : [F.w, F.h];
          res = await svgIllustration(`${task}. ${zone}`, brand, w, hh);
        } else {
          illoStatus.textContent = "Готовлю описание для генератора…";
          const p = await writePrompts(task, brand, zone);
          if (engineSel.value === "kandinsky") res = await kandinsky(p.ru, p.negative, F.w, F.h, (t) => (illoStatus.textContent = t));
          else {
            illoStatus.textContent = "GPT рисует изображение…";
            res = await gptImage(p.en, F.w, F.h);
          }
        }
        const item = { ...res, engine: engineSel.value };
        generated.unshift(item);
        gallery.prepend(h("button", { class: "btn btn-ghost", type: "button", style: { padding: "2px" }, title: "Использовать в макете", onclick: () => useImage(item) },
          h("img", { src: item.img.src, alt: "Вариант иллюстрации", style: { width: "96px", height: "72px", objectFit: "cover", borderRadius: "6px" } })));
        useImage(item);
        illoStatus.textContent = "Готово. Можно создать ещё вариант — все варианты сохраняются ниже до закрытия раздела.";
      } catch (e) {
        illoStatus.textContent = "";
        toast(e.message, "error");
      } finally {
        illoBtn.disabled = false;
      }
    },
  }, "Создать иллюстрацию");
  const illoDownload = h("button", {
    class: "btn btn-ghost",
    type: "button",
    onclick: () => {
      const it = generated.find((g) => g.img === photoImg);
      if (!it) return toast("Сначала создайте иллюстрацию", "error");
      download(`Иллюстрация.${it.ext}`, it.blob);
    },
  }, "Скачать иллюстрацию отдельно");

  // --- Проверка готового макета на ошибки ---
  const proofPanel = resultPanel({ kind: "assistant", title: "Проверка макета" });
  const proofBtn = h("button", {
    class: "btn btn-lg",
    type: "button",
    onclick: async () => {
      const c = document.createElement("canvas");
      await draw(c, { ...state, showSafe: false }, brand, fonts, photoImg, logoCache);
      // Для проверки текста хватает уменьшенной копии
      const k = Math.min(1, 1568 / Math.max(c.width, c.height));
      const small = document.createElement("canvas");
      small.width = Math.round(c.width * k);
      small.height = Math.round(c.height * k);
      small.getContext("2d").drawImage(c, 0, 0, small.width, small.height);
      const blob = await new Promise((r) => small.toBlob(r, "image/png"));
      proofPanel.run(await proofreadImage(blob));
    },
  }, "Проверить на ошибки");

  const logoSel = select("logoId", [["auto", "Авто — по цвету фона"], ...brand.logos.map((l) => [l.id, l.name])], "auto");
  bind(logoSel, "logoId");

  root.append(
    h("div", { class: "page-head" },
      h("h1", {}, "Дизайн-студия"),
      h("p", { class: "lead" }, "Макеты по брендбуку: только фирменные цвета и шрифты, логотип — оригинальный файл без изменений."),
    ),
    (await ai.hasKey()) ? "" : emptyKeyNotice(),
    brand.logos.length ? "" : h("div", { class: "notice" }, "Сначала загрузите оригинальные файлы логотипа в ", h("a", { href: "#/brand" }, "Бренд-ките"), "."),
    h("div", { class: "design-layout" },
      h("div", { class: "design-controls" },
        h("section", { class: "card" },
          h("h3", {}, "Макет"),
          field("Что делаем", templateSel),
          field("Формат", formatSel),
          safeRow,
          safeNote,
          field("Стиль", styleSel),
          field("Фото / фон (по желанию)", photoInput, "Своё фото или фон из нейросети — без текста и логотипов"),
          field("Затемнение фото, %", bind(h("input", { type: "range", min: 0, max: 100, value: state.overlay }), "overlay", Number)),
          field("Кадрирование фото по вертикали", bind(h("input", { type: "range", min: 0, max: 100, value: 50 }), "focusY", (v) => Number(v) / 100)),
          h("div", { class: "grid-2" },
            field("Фирменный цвет фона", bind(select("bg", colorOptions, String(state.bg)), "bg", Number)),
            field("Акцентный цвет", bind(select("accent", colorOptions, String(state.accent)), "accent", Number)),
            field("Цвет текста", bind(select("textColor", [["auto", "Авто — лучший контраст"], ...colorOptions], "auto"), "textColor", (v) => (v === "auto" ? v : Number(v)))),
            field("Выравнивание", bind(select("align", [["left", "По левому краю"], ["center", "По центру"]], "left"), "align")),
          ),
          h("button", { class: "btn btn-ghost", type: "button", onclick: () => { state.seed = Math.floor(Math.random() * 1e6) + 1; redraw(); } }, "Другой вариант фигур"),
        ),
        h("section", { class: "card stack" },
          h("h3", {}, "Иллюстрация"),
          field("Чем рисовать", engineSel),
          field("Что изобразить", illoBrief, "Если пусто — возьмём задачу макета. Логотип в генератор не отправляется: он накладывается оригинальным файлом."),
          h("div", { class: "row" }, illoBtn, illoDownload),
          illoStatus,
          gallery,
        ),
        h("section", { class: "card" },
          h("h3", {}, "Логотип"),
          h("label", { class: "check" }, bind(h("input", { type: "checkbox", checked: true }), "logoOn"), " Разместить логотип"),
          field("Версия логотипа", logoSel),
          h("div", { class: "grid-2" },
            field("Положение", bind(select("logoPos", Object.entries(LOGO_POS), state.logoPos), "logoPos")),
            field("Размер", bind(select("logoSize", Object.entries(LOGO_SIZE).map(([k, v]) => [k, v[0]]), state.logoSize), "logoSize")),
          ),
          h("label", { class: "check" }, bind(h("input", { type: "checkbox" }), "logoPlate"), " Белая подложка под логотип (только если разрешено брендбуком)"),
          h("small", { class: "hint" }, "Логотип только масштабируется пропорционально. Повороты, обрезка, перекраска, тени и эффекты намеренно недоступны."),
        ),
        h("section", { class: "card" },
          h("h3", {}, "Тексты"),
          field("Задача для ИИ", brief),
          h("div", { class: "row" }, aiBtn, promptBtn),
          textsForm,
        ),
      ),
      h("div", { class: "design-preview" },
        h("div", { class: "canvas-wrap" }, canvas),
        warnBox,
        h("div", { class: "row" },
          h("button", {
            class: "btn btn-primary btn-lg",
            type: "button",
            onclick: () => exportFile("image/png", "png"),
          }, "Скачать PNG"),
          h("button", {
            class: "btn btn-lg",
            type: "button",
            onclick: () => exportFile("image/jpeg", "jpg"),
          }, "Скачать JPG"),
          proofBtn,
        ),
        proofPanel.el,
        promptPanel.el,
        h("details", { class: "card help" },
          h("summary", {}, "Как получить фон с иллюстрацией из нейросети и не испортить логотип"),
          h("ol", {},
            h("li", {}, "Опишите задачу и нажмите «Промпт для фона в нейросети»."),
            h("li", {}, "Вставьте промпт в Kandinsky, Шедеврум, Midjourney или другой генератор. В промпте уже запрещены логотипы и надписи."),
            h("li", {}, "Скачайте понравившийся фон и загрузите его сюда в поле «Фото / фон»."),
            h("li", {}, "Приложение само наложит фирменные тексты и оригинальный логотип с охранным полем."),
          ),
        ),
      ),
    ),
  );
  redraw();
}
