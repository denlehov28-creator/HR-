// Презентации: слайды в фирменном стиле из выступления, предложения
// руководителю или с нуля. Рисуются на холсте из параметров бренд-кита;
// логотип — оригинальный файл, только пропорциональное масштабирование.

import * as ai from "./ai.js";
import * as store from "./store.js";
import { loadBrand, applyFonts, loadImage, contrast, pickLogo } from "./brand.js";
import { wrap, fit, roundRect } from "./design.js";
import { h, field, select, toast, download, emptyKeyNotice } from "./ui.js";
import { brandContext } from "./prompts.js";

const W = 1920;
const H = 1080;

export const STRATEGIES = {
  initiative: {
    label: "Защита инициативы перед руководством",
    plan: "Проблема в цифрах → цена бездействия → предложение → ожидаемый эффект и окупаемость → ресурсы и план → риски → чёткая просьба (решение, которое нужно). Формулы: PAS и «цена бездействия».",
  },
  report: {
    label: "Отчёт HR руководству (квартал, год)",
    plan: "Итоги одним слайдом → ключевые метрики (графики) → что получилось → что не получилось и почему → план на следующий период → нужные решения.",
  },
  allhands: {
    label: "Общее собрание коллектива",
    plan: "Зачем собрались → главные новости → что это значит для каждого → что меняется и когда → куда обращаться с вопросами → благодарность.",
  },
  onboarding: {
    label: "Приветствие новых сотрудников",
    plan: "Добро пожаловать → кто мы и наши ценности → структура и к кому обращаться → первая неделя и испытательный срок → полезные правила → контакты HR.",
  },
  training: {
    label: "Обучение / тренинг",
    plan: "Зачем это нужно → что узнаем → 3–5 блоков с примерами → упражнение или вопрос залу → итоги → что сделать завтра.",
  },
  yearend: {
    label: "Итоги года / праздничное выступление",
    plan: "Год в одной фразе → большие цифры года → люди и достижения → благодарности → планы → поздравление.",
  },
  free: { label: "Свободная структура", plan: "Подбери структуру под задачу сам." },
};

const LAYOUTS = ["title", "bullets", "bignumber", "quote", "twocol", "chart", "closing"];

const SLIDE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Название презентации" },
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          layout: { type: "string", enum: LAYOUTS },
          title: { type: "string" },
          subtitle: { type: "string" },
          items: { type: "array", items: { type: "string" } },
          number: { type: "string" },
          numberLabel: { type: "string" },
          quote: { type: "string" },
          author: { type: "string" },
          leftTitle: { type: "string" },
          left: { type: "array", items: { type: "string" } },
          rightTitle: { type: "string" },
          right: { type: "array", items: { type: "string" } },
          chartLabels: { type: "array", items: { type: "string" } },
          chartValues: { type: "array", items: { type: "number" } },
          chartUnit: { type: "string" },
          notes: { type: "string", description: "Что сказать на этом слайде (2–4 предложения)" },
        },
        required: ["layout", "title", "subtitle", "items", "number", "numberLabel", "quote", "author", "leftTitle", "left", "rightTitle", "right", "chartLabels", "chartValues", "chartUnit", "notes"],
      },
    },
  },
  required: ["title", "slides"],
};

const SYSTEM = (brand) => `Ты — автор деловых презентаций для HR-руководителя. Делаешь короткие, ясные слайды по-русски.

Правила:
- Один слайд — одна мысль. Заголовок слайда — вывод, а не тема («Каждая замена стоит 180 000 ₽», а не «Стоимость замены»). До 8 слов.
- Пункты списка — до 6 штук, каждый до 10 слов. Без точек в конце.
- Макеты: title (первый слайд), bullets (список), bignumber (одна большая цифра с подписью), quote (цитата или ценность), twocol (сравнение «было / стало», «сейчас / предлагаем»), chart (столбчатая диаграмма: chartLabels и chartValues одинаковой длины, до 8 значений), closing (последний слайд: просьба, призыв или благодарность).
- Цифры и факты бери ТОЛЬКО из исходных данных. Если данных нет — не делай chart и bignumber с выдуманными числами; используй bullets и пометку [цифра].
- В notes — что выступающему сказать на этом слайде, 2–4 предложения живым языком.
- Неиспользуемые поля оставляй пустыми ("" или []).${brandContext(brand)}`;

// ---------- Отрисовка слайда ----------

function pal(brand) {
  const c = brand.colors?.length ? brand.colors : [{ hex: "#1F3A93", role: "основной" }, { hex: "#F5A623", role: "акцентный" }];
  const find = (role, fb) => c.find((x) => x.role === role)?.hex || fb;
  const primary = find("основной", c[0].hex);
  const accent = find("акцентный", c[1]?.hex || primary);
  const light = c.find((x) => x.role === "фон")?.hex || "#FFFFFF";
  const best = (bg) => [...c.map((x) => x.hex), "#FFFFFF", "#111111"].sort((a, b) => contrast(b, bg) - contrast(a, bg))[0];
  return { primary, accent, light, best };
}

const logoCache = new Map();

async function drawLogo(ctx, brand, bg, box) {
  const meta = pickLogo(brand, bg, "auto");
  if (!meta) return;
  let img = logoCache.get(meta.id);
  if (!img) {
    img = await loadImage(meta.dataUrl);
    logoCache.set(meta.id, img);
  }
  const ratio = meta.height / meta.width || 0.4;
  let w = box.w;
  let hh = w * ratio;
  if (hh > box.h) {
    hh = box.h;
    w = hh / ratio;
  }
  const x = box.align === "right" ? box.x + box.w - w : box.x;
  ctx.drawImage(img, x, box.y, w, hh); // оригинал, без эффектов
}

function drawLines(ctx, lines, x, y, size, lh, color) {
  ctx.fillStyle = color;
  for (const l of lines) {
    ctx.fillText(l, x, y);
    y += size * lh;
  }
  return y;
}

export async function drawSlide(canvas, slide, brand, fonts, index, total, scale = 1) {
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const p = pal(brand);
  const dark = ["title", "closing", "bignumber", "quote"].includes(slide.layout);
  const bg = dark ? p.primary : p.light;
  const ink = p.best(bg);
  const accent = contrast(p.accent, bg) >= 3 ? p.accent : ink;
  const HF = (s, w = 800) => `${w} ${s}px "${fonts.heading}", "Segoe UI", Arial, sans-serif`;
  const BF = (s, w = 400) => `${w} ${s}px "${fonts.body}", "Segoe UI", Arial, sans-serif`;
  const pad = 120;
  const mw = W - pad * 2;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // Фирменная акцентная линия
  ctx.fillStyle = p.accent;
  ctx.fillRect(pad, dark ? 300 : 96, 120, 10);

  // Логотип: на титуле и в финале крупнее
  const big = slide.layout === "title" || slide.layout === "closing";
  const clear = 40;
  if (brand.logos?.length) await drawLogo(ctx, brand, bg, { x: W - pad - (big ? 420 : 260), y: 72, w: big ? 420 : 260, h: big ? 150 : 84, align: "right" });

  // Номер слайда и организация
  if (slide.layout !== "title") {
    ctx.font = BF(26, 500);
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.6;
    ctx.fillText(`${index + 1} из ${total}`, pad, H - 80);
    if (brand.orgName) {
      ctx.textAlign = "right";
      ctx.fillText(brand.orgName, W - pad, H - 80);
      ctx.textAlign = "left";
    }
    ctx.globalAlpha = 1;
  }

  const top = dark ? 340 : 136 + clear;
  switch (slide.layout) {
    case "title":
    case "closing": {
      const t = fit(ctx, slide.title || "", (s) => HF(s), mw - 200, 3, 128, 64);
      ctx.font = HF(t.size);
      let y = drawLines(ctx, t.lines, pad, top, t.size, 1.08, ink);
      if (slide.subtitle) {
        const st = fit(ctx, slide.subtitle, (s) => BF(s, 500), mw - 300, 3, 48, 30);
        ctx.font = BF(st.size, 500);
        ctx.globalAlpha = 0.9;
        drawLines(ctx, st.lines, pad, y + 40, st.size, 1.35, ink);
        ctx.globalAlpha = 1;
      }
      if (slide.layout === "closing" && slide.items?.length) {
        ctx.font = BF(32, 600);
        ctx.fillStyle = accent;
        ctx.fillText(slide.items.join("   "), pad, H - 200);
      }
      break;
    }
    case "bignumber": {
      const t = fit(ctx, slide.number || "[цифра]", (s) => HF(s, 800), mw, 1, 300, 120);
      ctx.font = HF(t.size, 800);
      ctx.fillStyle = accent;
      ctx.fillText(t.lines[0], pad, top - 20);
      let y = top - 20 + t.size * 1.05;
      const l = fit(ctx, slide.numberLabel || slide.title || "", (s) => HF(s, 700), mw, 2, 64, 36);
      ctx.font = HF(l.size, 700);
      y = drawLines(ctx, l.lines, pad, y + 10, l.size, 1.15, ink);
      if (slide.subtitle) {
        const st = fit(ctx, slide.subtitle, (s) => BF(s), mw - 400, 3, 36, 26);
        ctx.font = BF(st.size);
        ctx.globalAlpha = 0.85;
        drawLines(ctx, st.lines, pad, y + 24, st.size, 1.4, ink);
        ctx.globalAlpha = 1;
      }
      break;
    }
    case "quote": {
      const q = fit(ctx, `«${(slide.quote || slide.title || "").replace(/^«|»$/g, "")}»`, (s) => HF(s, 700), mw - 100, 4, 84, 44);
      ctx.font = HF(q.size, 700);
      const y = drawLines(ctx, q.lines, pad, top, q.size, 1.2, ink);
      if (slide.author) {
        ctx.font = BF(36, 600);
        ctx.fillStyle = accent;
        ctx.fillText(slide.author, pad, y + 40);
      }
      break;
    }
    default: {
      // Заголовок контентного слайда
      const t = fit(ctx, slide.title || "", (s) => HF(s), mw - 320, 2, 76, 44);
      ctx.font = HF(t.size);
      let y = drawLines(ctx, t.lines, pad, top, t.size, 1.12, ink) + 48;
      if (slide.subtitle) {
        ctx.font = BF(34, 500);
        const st = wrap(ctx, slide.subtitle, mw).slice(0, 2);
        ctx.globalAlpha = 0.8;
        y = drawLines(ctx, st, pad, y - 16, 34, 1.35, ink) + 32;
        ctx.globalAlpha = 1;
      }
      const bottom = H - 140;
      if (slide.layout === "bullets") {
        const items = (slide.items || []).slice(0, 6);
        const size = items.length > 4 ? 38 : 44;
        for (const it of items) {
          ctx.font = BF(size, 500);
          const lines = wrap(ctx, it, mw - 70).slice(0, 2);
          if (y + lines.length * size * 1.3 > bottom) break;
          ctx.fillStyle = p.accent;
          ctx.fillRect(pad, y + size * 0.38, 22, 22);
          y = drawLines(ctx, lines, pad + 60, y, size, 1.3, ink) + size * 0.55;
        }
      } else if (slide.layout === "twocol") {
        const colW = (mw - 80) / 2;
        [[slide.leftTitle, slide.left], [slide.rightTitle, slide.right]].forEach(([ct, list], i) => {
          const x = pad + i * (colW + 80);
          let cy = y;
          ctx.fillStyle = i ? p.accent : ink;
          ctx.globalAlpha = i ? 1 : 0.15;
          roundRect(ctx, x, cy, colW, bottom - cy, 24);
          ctx.fill();
          ctx.globalAlpha = 1;
          const cardInk = i ? p.best(p.accent) : ink;
          ctx.font = HF(44, 700);
          cy = drawLines(ctx, wrap(ctx, ct || "", colW - 80).slice(0, 2), x + 40, cy + 40, 44, 1.15, cardInk) + 20;
          for (const it of (list || []).slice(0, 5)) {
            ctx.font = BF(34, 500);
            const lines = wrap(ctx, `– ${it}`, colW - 80).slice(0, 2);
            if (cy + lines.length * 46 > bottom - 30) break;
            cy = drawLines(ctx, lines, x + 40, cy, 34, 1.35, cardInk) + 14;
          }
        });
      } else if (slide.layout === "chart") {
        const labels = (slide.chartLabels || []).slice(0, 8);
        const values = (slide.chartValues || []).slice(0, labels.length).map(Number);
        if (!labels.length || values.some((v) => !Number.isFinite(v))) {
          ctx.font = BF(36);
          ctx.fillStyle = ink;
          ctx.fillText("Нет данных для диаграммы — заполните подписи и значения.", pad, y);
          break;
        }
        const max = Math.max(...values, 0) || 1;
        const chartH = bottom - y - 90;
        const gap = 40;
        const bw = Math.min(220, (mw - gap * (labels.length - 1)) / labels.length);
        const total = bw * labels.length + gap * (labels.length - 1);
        let x = pad + (mw - total) / 2;
        const baseY = y + chartH + 50;
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pad, baseY);
        ctx.lineTo(W - pad, baseY);
        ctx.stroke();
        ctx.globalAlpha = 1;
        values.forEach((v, i) => {
          const bh = Math.max(4, (v / max) * chartH);
          ctx.fillStyle = i === values.indexOf(max) ? p.accent : p.primary;
          roundRect(ctx, x, baseY - bh, bw, bh, 12);
          ctx.fill();
          ctx.fillStyle = ink;
          ctx.textAlign = "center";
          ctx.font = HF(36, 700);
          ctx.fillText(`${v.toLocaleString("ru-RU")}${slide.chartUnit ? ` ${slide.chartUnit}` : ""}`, x + bw / 2, baseY - bh - 50);
          ctx.font = BF(28, 500);
          wrap(ctx, labels[i], bw + gap - 10).slice(0, 2).forEach((l, k) => ctx.fillText(l, x + bw / 2, baseY + 18 + k * 34));
          ctx.textAlign = "left";
          x += bw + gap;
        });
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- Показ на весь экран ----------

function present(deck, brand, fonts, start = 0) {
  let i = start;
  let notesOn = false;
  const canvas = h("canvas", { "aria-label": "Слайд" });
  const notes = h("div", { class: "notice", style: { margin: "0 16px 16px", maxWidth: "1100px" }, hidden: true });
  const counter = h("span", { class: "tp-timer" });
  const show = async () => {
    await drawSlide(canvas, deck.slides[i], brand, fonts, i, deck.slides.length);
    counter.textContent = `${i + 1} / ${deck.slides.length}`;
    notes.textContent = deck.slides[i].notes || "Заметок к этому слайду нет.";
  };
  const go = (d) => {
    i = Math.max(0, Math.min(deck.slides.length - 1, i + d));
    show();
  };
  const close = () => {
    document.removeEventListener("keydown", onKey);
    stage.remove();
    if (document.fullscreenElement) document.exitFullscreen?.();
  };
  const onKey = (e) => {
    if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(1); }
    else if (["ArrowLeft", "PageUp"].includes(e.key)) go(-1);
    else if (e.key === "Escape") close();
    else if (e.key.toLowerCase() === "n" || e.key.toLowerCase() === "т") { notesOn = !notesOn; notes.hidden = !notesOn; }
  };
  const stage = h("div", { class: "stage", role: "dialog", "aria-label": "Показ презентации" },
    h("div", { class: "tp-bar" },
      h("button", { class: "btn", type: "button", onclick: () => go(-1) }, "Назад"),
      h("button", { class: "btn btn-primary", type: "button", onclick: () => go(1) }, "Дальше"),
      h("button", { class: "btn", type: "button", onclick: () => { notesOn = !notesOn; notes.hidden = !notesOn; } }, "Заметки"),
      h("button", { class: "btn", type: "button", onclick: () => stage.requestFullscreen?.() }, "Во весь экран"),
      counter,
      h("button", { class: "btn btn-ghost", type: "button", onclick: close }, "Закрыть"),
    ),
    h("div", { class: "stage-body", onclick: (e) => { if (e.target === canvas) go(1); } }, canvas, notes),
  );
  canvas.style.width = "min(100%, calc((100vh - 140px) * 16 / 9))";
  document.addEventListener("keydown", onKey);
  document.body.append(stage);
  show();
}

// ---------- Экспорт ----------

async function exportPdf(deck, brand, fonts) {
  toast("Готовлю страницы для печати…");
  const imgs = [];
  for (let i = 0; i < deck.slides.length; i++) {
    const c = document.createElement("canvas");
    await drawSlide(c, deck.slides[i], brand, fonts, i, deck.slides.length);
    imgs.push(c.toDataURL("image/png"));
  }
  const style = h("style", {}, "@media print { @page { size: 1920px 1080px; margin: 0; } body > *:not(.print-deck) { display: none !important; } .print-deck img { display: block; width: 1920px; height: 1080px; page-break-after: always; break-after: page; } } @media screen { .print-deck { display: none; } }");
  const wrapEl = h("div", { class: "print-deck" }, imgs.map((src) => h("img", { src, alt: "" })));
  document.head.append(style);
  document.body.append(wrapEl);
  await Promise.all([...wrapEl.querySelectorAll("img")].map((im) => im.decode().catch(() => {})));
  window.print();
  setTimeout(() => {
    style.remove();
    wrapEl.remove();
  }, 1000);
}

async function exportPng(deck, brand, fonts) {
  for (let i = 0; i < deck.slides.length; i++) {
    const c = document.createElement("canvas");
    await drawSlide(c, deck.slides[i], brand, fonts, i, deck.slides.length);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    download(`${deck.title || "Презентация"} — слайд ${i + 1}.png`, blob);
    await new Promise((r) => setTimeout(r, 300));
  }
}

// ---------- Редактор слайда ----------

const blank = (layout = "bullets") => ({
  layout, title: "", subtitle: "", items: [], number: "", numberLabel: "", quote: "", author: "",
  leftTitle: "", left: [], rightTitle: "", right: [], chartLabels: [], chartValues: [], chartUnit: "", notes: "",
});

const LAYOUT_LABEL = {
  title: "Титульный",
  bullets: "Список",
  bignumber: "Большая цифра",
  quote: "Цитата / ценность",
  twocol: "Две колонки (было / стало)",
  chart: "Диаграмма",
  closing: "Финальный (просьба, спасибо)",
};

function slideEditor(slide, onChange) {
  const lines = (a) => (a || []).join("\n");
  const toArr = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const inp = (key, label, ph) => {
    const el = h("input", { type: "text", value: slide[key] || "", placeholder: ph || "" });
    el.addEventListener("input", () => { slide[key] = el.value; onChange(); });
    return field(label, el);
  };
  const area = (key, label, hint) => {
    const el = h("textarea", { rows: 4 }, lines(slide[key]));
    el.addEventListener("input", () => { slide[key] = toArr(el.value); onChange(); });
    return field(label, el, hint);
  };
  const layoutSel = select("layout", Object.entries(LAYOUT_LABEL), slide.layout);
  layoutSel.addEventListener("change", () => { slide.layout = layoutSel.value; onChange(true); });
  const chartArea = h("textarea", { rows: 4, placeholder: "2023: 28\n2024: 22\n2025: 15" }, (slide.chartLabels || []).map((l, i) => `${l}: ${slide.chartValues?.[i] ?? ""}`).join("\n"));
  chartArea.addEventListener("input", () => {
    const rows = toArr(chartArea.value).map((r) => r.split(/:\s*/));
    slide.chartLabels = rows.map((r) => r[0]);
    slide.chartValues = rows.map((r) => Number(String(r[1] || "").replace(/\s/g, "").replace(",", ".")));
    onChange();
  });
  const notes = h("textarea", { rows: 3 }, slide.notes || "");
  notes.addEventListener("input", () => { slide.notes = notes.value; onChange(); });

  const L = slide.layout;
  return h("div", { class: "stack" },
    field("Макет", layoutSel),
    inp("title", "Заголовок"),
    ["title", "closing", "bignumber", "bullets", "twocol", "chart"].includes(L) && inp("subtitle", "Подзаголовок"),
    (L === "bullets" || L === "closing") && area("items", L === "closing" ? "Контакты (каждый с новой строки)" : "Пункты", "Каждый пункт с новой строки, до 6"),
    L === "bignumber" && inp("number", "Цифра", "180 000 ₽"),
    L === "bignumber" && inp("numberLabel", "Что означает цифра"),
    L === "quote" && inp("quote", "Цитата / ценность"),
    L === "quote" && inp("author", "Автор"),
    L === "twocol" && inp("leftTitle", "Левая колонка: заголовок", "Сейчас"),
    L === "twocol" && area("left", "Левая колонка: пункты"),
    L === "twocol" && inp("rightTitle", "Правая колонка: заголовок", "Предлагаем"),
    L === "twocol" && area("right", "Правая колонка: пункты"),
    L === "chart" && field("Данные диаграммы", chartArea, "Каждая строка — «подпись: число»"),
    L === "chart" && inp("chartUnit", "Единица измерения", "%"),
    field("Заметки для выступающего", notes),
  );
}

// ---------- Экран ----------

export async function render(root, params = {}) {
  const brand = await loadBrand();
  const fonts = await applyFonts(brand);
  let deck = null;
  let decks = await store.get("decks", []);
  const source = await store.get("slides-source", "");
  if (source) await store.del("slides-source");
  if (params.id) deck = decks.find((d) => d.id === params.id) || null;

  let refineCard = null;
  const listEl = h("div", { class: "deck-grid" });
  const deckHead = h("div");
  const editorBox = h("div");
  const saveDeck = async () => {
    if (!deck) return;
    deck.updatedAt = new Date().toISOString();
    decks = [deck, ...decks.filter((d) => d.id !== deck.id)].slice(0, 50);
    await store.set("decks", decks);
  };
  let saveTimer = 0;
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDeck, 600);
  };

  const drawDeck = async () => {
    if (refineCard) refineCard.hidden = !deck;
    if (!deck) {
      deckHead.replaceChildren();
      listEl.replaceChildren();
      return;
    }
    const titleIn = h("input", { type: "text", value: deck.title || "", "aria-label": "Название презентации" });
    titleIn.addEventListener("input", () => { deck.title = titleIn.value; saveSoon(); });
    deckHead.replaceChildren(
      h("section", { class: "card" },
        h("div", { class: "result-head" }, h("h2", {}, "Презентация"), h("span", { class: "result-status" }, `${deck.slides.length} слайдов`)),
        field("Название", titleIn),
        h("div", { class: "row", style: { marginTop: "12px" } },
          h("button", { class: "btn btn-primary btn-lg", type: "button", onclick: () => present(deck, brand, fonts) }, "Показать"),
          h("button", { class: "btn", type: "button", onclick: () => exportPdf(deck, brand, fonts) }, "Сохранить в PDF"),
          h("button", { class: "btn", type: "button", onclick: () => exportPng(deck, brand, fonts) }, "Скачать слайды PNG"),
          h("button", { class: "btn btn-ghost", type: "button", onclick: () => { deck.slides.push(blank()); saveSoon(); drawDeck(); } }, "Добавить слайд"),
        ),
        !brand.logos?.length && h("div", { class: "notice", style: { marginTop: "12px" } }, "Логотип не загружен — добавьте оригинал в ", h("a", { href: "#/brand" }, "Бренд-ките"), ", и он появится на каждом слайде без изменений."),
      ),
    );
    listEl.replaceChildren(
      ...deck.slides.map((s, i) => {
        const c = h("canvas", { "aria-label": `Слайд ${i + 1}: ${s.title}` });
        drawSlide(c, s, brand, fonts, i, deck.slides.length, 0.25);
        const move = (d) => {
          const j = i + d;
          if (j < 0 || j >= deck.slides.length) return;
          [deck.slides[i], deck.slides[j]] = [deck.slides[j], deck.slides[i]];
          saveSoon();
          drawDeck();
        };
        return h("div", { class: "deck-thumb card" },
          h("button", { class: "link-btn", type: "button", style: { padding: 0 }, onclick: () => present(deck, brand, fonts, i), "aria-label": `Показать с слайда ${i + 1}` }, c),
          h("div", { class: "row" },
            h("span", { class: "hint" }, `${i + 1}. ${LAYOUT_LABEL[s.layout] || s.layout}`),
            h("span", { class: "row" },
              h("button", { class: "btn btn-ghost", type: "button", "aria-label": "Выше", onclick: () => move(-1) }, "Выше"),
              h("button", { class: "btn btn-ghost", type: "button", "aria-label": "Ниже", onclick: () => move(1) }, "Ниже"),
              h("button", {
                class: "btn",
                type: "button",
                onclick: () => {
                  const redrawThumb = (full) => {
                    saveSoon();
                    if (full) drawDeck();
                    else drawSlide(c, s, brand, fonts, i, deck.slides.length, 0.25);
                  };
                  editorBox.replaceChildren(
                    h("section", { class: "card" },
                      h("div", { class: "result-head" }, h("h3", {}, `Слайд ${i + 1}`),
                        h("button", { class: "btn btn-ghost btn-danger", type: "button", onclick: () => { if (!confirm("Удалить слайд?")) return; deck.slides.splice(i, 1); editorBox.replaceChildren(); saveSoon(); drawDeck(); } }, "Удалить слайд"),
                        h("button", { class: "btn", type: "button", onclick: () => editorBox.replaceChildren() }, "Готово"),
                      ),
                      slideEditor(s, redrawThumb),
                    ),
                  );
                  editorBox.scrollIntoView({ behavior: "smooth", block: "start" });
                },
              }, "Изменить"),
            ),
          ),
        );
      }),
    );
  };

  // ---------- Форма создания ----------
  const lib = (await store.library()).filter((x) => ["speech", "proposal", "document"].includes(x.kind)).slice(0, 30);
  const textEl = h("textarea", { name: "text", rows: 7, placeholder: "О чём презентация? Можно вставить готовый текст выступления или предложения руководителю — слайды соберутся из него." }, source);
  const fromLib = select("fromLib", [["", "— выбрать —"], ...lib.map((x) => [x.id, x.title.slice(0, 80)])], "");
  fromLib.addEventListener("change", () => {
    const it = lib.find((x) => x.id === fromLib.value);
    if (it) textEl.value = it.text;
  });
  const stratSel = select("strategy", Object.entries(STRATEGIES).map(([k, v]) => [k, v.label]), params.strategy || "initiative");
  const countIn = h("input", { type: "number", name: "count", min: 3, max: 20, value: 8 });
  const factsChk = h("input", { type: "checkbox", name: "facts" });
  const btn = h("button", { class: "btn btn-primary btn-lg", type: "submit" }, "Собрать презентацию");
  const instr = h("input", { type: "text", placeholder: "Что поменять во всей презентации? Например: «короче», «добавь слайд с планом на квартал»" });

  const runAI = async (messages) => {
    btn.disabled = true;
    btn.textContent = "Собираю слайды…";
    try {
      const data = await ai.generateJSON({ system: SYSTEM(brand), messages, schema: SLIDE_SCHEMA, maxTokens: 24000 });
      if (!data.slides?.length) throw new Error("Не получилось собрать слайды — уточните задачу.");
      deck = { id: deck?.id || crypto.randomUUID(), title: data.title, slides: data.slides, createdAt: deck?.createdAt || new Date().toISOString() };
      await saveDeck();
      editorBox.replaceChildren();
      await drawDeck();
      drawSaved();
      deckHead.scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Презентация готова. Проверьте цифры и поправьте слайды при необходимости.");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Собрать презентацию";
    }
  };

  const form = h("form", {
    class: "card stack",
    onsubmit: async (e) => {
      e.preventDefault();
      const text = textEl.value.trim();
      if (!text) return toast("Опишите тему или вставьте текст", "error");
      const st = STRATEGIES[stratSel.value];
      const facts = factsChk.checked ? (await store.get("proposal-facts", [])).join("\n") : "";
      deck = null;
      runAI([{
        role: "user",
        content: [
          `Тип презентации: ${st.label}. Структура: ${st.plan}`,
          `Количество слайдов: около ${Number(countIn.value) || 8}.`,
          `Исходные материалы:\n${text}`,
          facts && `Цифры из калькулятора HR-метрик (используй для chart и bignumber):\n${facts}`,
        ].filter(Boolean).join("\n\n"),
      }]);
    },
  },
    h("h2", {}, "Собрать презентацию"),
    field("Тип презентации", stratSel),
    lib.length ? field("Взять текст из «Моих материалов»", fromLib) : "",
    field("Тема или текст", textEl),
    h("div", { class: "grid-2" },
      field("Слайдов примерно", countIn),
      h("label", { class: "check", style: { alignSelf: "end" } }, factsChk, " Добавить цифры из «HR-метрик»"),
    ),
    btn,
  );

  const refineForm = h("form", {
    class: "refine-row",
    onsubmit: (e) => {
      e.preventDefault();
      if (!deck || !instr.value.trim()) return;
      const t = instr.value.trim();
      instr.value = "";
      runAI([{ role: "user", content: `Вот текущая презентация в JSON:\n${JSON.stringify({ title: deck.title, slides: deck.slides })}\n\nДоработай её: ${t}\nВерни презентацию целиком.` }]);
    },
  }, instr, h("button", { class: "btn", type: "submit" }, "Доработать"));

  // ---------- Сохранённые ----------
  const savedBox = h("div");
  const drawSaved = () => {
    savedBox.replaceChildren(
      decks.length ? h("section", { class: "card" },
        h("h2", {}, "Мои презентации"),
        h("div", { class: "lib-list" },
          ...decks.map((d) => h("div", { class: "row", style: { justifyContent: "space-between" } },
            h("span", {}, h("b", {}, d.title || "Без названия"), " ", h("span", { class: "hint" }, `${d.slides.length} слайдов, ${new Date(d.updatedAt || d.createdAt).toLocaleDateString("ru-RU")}`)),
            h("span", { class: "row" },
              h("button", { class: "btn", type: "button", onclick: async () => { deck = d; editorBox.replaceChildren(); await drawDeck(); deckHead.scrollIntoView({ behavior: "smooth" }); } }, "Открыть"),
              h("button", { class: "btn btn-ghost btn-danger", type: "button", onclick: async () => { if (!confirm("Удалить презентацию?")) return; decks = decks.filter((x) => x.id !== d.id); await store.set("decks", decks); if (deck?.id === d.id) { deck = null; drawDeck(); } drawSaved(); } }, "Удалить"),
            ),
          )),
        ),
      ) : "",
    );
  };

  root.append(
    h("div", { class: "page-head" },
      h("h1", {}, "Презентации"),
      h("p", { class: "lead" }, "Слайды в фирменном стиле из выступления, предложения руководителю или с нуля. Оригинальный логотип, цвета и шрифты бренда, показ на весь экран и PDF."),
    ),
    (await ai.hasKey()) ? "" : emptyKeyNotice(),
    form,
    deckHead,
    listEl,
    editorBox,
    (refineCard = h("section", { class: "card", hidden: true }, h("h3", {}, "Доработать всю презентацию"), refineForm)),
    savedBox,
    h("button", {
      class: "btn btn-ghost",
      type: "button",
      onclick: () => {
        deck = { id: crypto.randomUUID(), title: "Новая презентация", slides: [{ ...blank("title"), title: "Название презентации", subtitle: brand.orgName || "" }, blank("bullets"), { ...blank("closing"), title: "Спасибо!" }], createdAt: new Date().toISOString() };
        saveDeck();
        drawDeck();
        drawSaved();
      },
    }, "Создать пустую презентацию вручную"),
  );
  drawSaved();
  if (deck) await drawDeck();
}
