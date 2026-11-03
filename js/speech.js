// Выступления: текст под заданное время, карточки-подсказки, вопросы из зала,
// плюс режим суфлёра с таймером для репетиции.

import * as ai from "./ai.js";
import * as store from "./store.js";
import { loadBrand } from "./brand.js";
import { voiceAction } from "./voice.js";
import { h, field, select, toast, resultPanel, formData, splitNotes, md, emptyKeyNotice } from "./ui.js";
import { speechSystem } from "./prompts.js";

const OCCASIONS = [
  "Выступление перед руководством (защита инициативы, отчёт)",
  "Общее собрание коллектива",
  "Планёрка / совещание отдела",
  "Приветствие новых сотрудников (онбординг)",
  "Корпоративный праздник / награждение",
  "Поздравление (юбилей, профессиональный праздник)",
  "Конференция / внешнее мероприятие",
  "Тренинг / обучение",
  "Объявление сложных новостей (изменения, реорганизация)",
];

const GOALS = ["Проинформировать", "Убедить и получить решение", "Вдохновить и вовлечь", "Поблагодарить и поздравить", "Обучить", "Снять напряжение и ответить на опасения"];

function wordsCount(text) {
  return (text.match(/[\p{L}\d]+/gu) || []).length;
}

function teleprompter(text) {
  const clean = text.replace(/^##\s.*$/gm, "").trim();
  const content = h("div", { class: "tp-text md", html: md(clean) });
  const scroller = h("div", { class: "tp-scroll" }, content);
  const timer = h("span", { class: "tp-timer" }, "00:00");
  let speed = 1;
  let running = false;
  let last = 0;
  let elapsed = 0;
  let fontSize = 44;

  const tick = (ts) => {
    if (!running) return;
    const dt = last ? ts - last : 0;
    last = ts;
    elapsed += dt;
    scroller.scrollTop += (dt / 1000) * 28 * speed;
    const s = Math.floor(elapsed / 1000);
    timer.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    requestAnimationFrame(tick);
  };
  const playBtn = h("button", { class: "btn btn-primary", type: "button" }, "Старт");
  playBtn.onclick = () => {
    running = !running;
    playBtn.textContent = running ? "Пауза" : "Старт";
    last = 0;
    if (running) requestAnimationFrame(tick);
  };
  const speedLabel = h("span", {}, "×1.0");
  const setSpeed = (d) => {
    speed = Math.max(0.2, Math.min(4, +(speed + d).toFixed(1)));
    speedLabel.textContent = `×${speed.toFixed(1)}`;
  };
  const setFont = (d) => {
    fontSize = Math.max(24, Math.min(90, fontSize + d));
    content.style.fontSize = `${fontSize}px`;
  };
  content.style.fontSize = `${fontSize}px`;

  const overlay = h("div", { class: "tp-overlay" },
    h("div", { class: "tp-bar" },
      playBtn,
      h("button", { class: "btn", type: "button", onclick: () => setSpeed(-0.2) }, "Медленнее"),
      speedLabel,
      h("button", { class: "btn", type: "button", onclick: () => setSpeed(0.2) }, "Быстрее"),
      h("button", { class: "btn", type: "button", onclick: () => setFont(-4) }, "A−"),
      h("button", { class: "btn", type: "button", onclick: () => setFont(4) }, "A+"),
      h("button", { class: "btn", type: "button", onclick: () => { scroller.scrollTop = 0; elapsed = 0; timer.textContent = "00:00"; } }, "В начало"),
      timer,
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => { running = false; overlay.remove(); document.removeEventListener("keydown", onKey); } }, "Закрыть"),
    ),
    h("div", { class: "tp-guide" }),
    scroller,
  );
  const onKey = (e) => {
    if (e.key === " ") {
      e.preventDefault();
      playBtn.click();
    } else if (e.key === "Escape") overlay.querySelector(".btn-ghost").click();
    else if (e.key === "ArrowUp") setSpeed(0.2);
    else if (e.key === "ArrowDown") setSpeed(-0.2);
  };
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
}

export async function render(root) {
  const brand = await loadBrand();
  let messages = [];
  const info = h("div", { class: "hint" });

  const panel = resultPanel({
    kind: "speech",
    title: "Выступление",
    extraActions: [voiceAction("выступление")],
    onRefine: (t) => {
      if (!messages.length) return;
      run([...messages, { role: "user", content: `Доработай выступление: ${t}\nВерни всё целиком в том же формате.` }]);
    },
  });

  const run = (msgs) =>
    panel.run(async (onText, signal) => {
      const res = await ai.generate({ system: speechSystem(brand), messages: msgs, onText, signal });
      messages = [...msgs, { role: "assistant", content: res.text }];
      const { main } = splitNotes(res.text);
      const words = wordsCount(main.replace(/\[[^\]]*\]/g, ""));
      info.textContent = `≈ ${words} слов · примерно ${(words / 120).toFixed(1).replace(".", ",")} мин при спокойном темпе`;
      return res;
    });

  const form = h("form", {
    class: "card stack",
    onsubmit: (e) => {
      e.preventDefault();
      const d = formData(form);
      if (!d.topic) return toast("Укажите тему выступления", "error");
      const minutes = Number(d.minutes) || 3;
      run([{
        role: "user",
        content: [
          `Тема: ${d.topic}`,
          `Повод и аудитория: ${d.occasion}${d.audience ? `; ${d.audience}` : ""}`,
          `Цель: ${d.goal}`,
          `Длительность: ${minutes} мин (≈ ${minutes * 120} слов в основном тексте).`,
          d.facts && `Ключевые мысли, факты, цифры: ${d.facts}`,
          d.speaker && `Кто выступает: ${d.speaker}`,
          d.slides && "Будут слайды — расставь пометки [слайд N] и в конце предложи короткий план слайдов.",
          d.style && `Пожелания к стилю: ${d.style}`,
        ].filter(Boolean).join("\n"),
      }]);
    },
  },
    h("h2", {}, "Подготовить выступление"),
    field("Тема", h("input", { name: "topic", placeholder: "Запуск программы наставничества / итоги года отдела персонала / приветствие новичков" })),
    h("div", { class: "grid-2" },
      field("Повод", select("occasion", OCCASIONS)),
      field("Цель", select("goal", GOALS)),
    ),
    h("div", { class: "grid-3" },
      field("Длительность, минут", h("input", { name: "minutes", type: "number", min: 1, max: 60, value: 3 })),
      field("Аудитория подробнее", h("input", { name: "audience", placeholder: "40 человек, производство, разный возраст" })),
      field("Кто выступает", h("input", { name: "speaker", placeholder: "HR-менеджер / от лица директора" })),
    ),
    field("Ключевые мысли, факты, цифры", h("textarea", { name: "facts", rows: 5, placeholder: "Что обязательно сказать. Цифры и примеры делают выступление убедительным." })),
    field("Пожелания к стилю", h("input", { name: "style", placeholder: "с лёгким юмором / строго / тепло и по-человечески" })),
    h("label", { class: "check" }, h("input", { type: "checkbox", name: "slides" }), " Будут слайды"),
    h("button", { class: "btn btn-primary btn-lg", type: "submit" }, "Написать выступление"),
  );

  root.append(
    h("div", { class: "page-head" },
      h("h1", {}, "Выступления"),
      h("p", { class: "lead" }, "Текст под нужное время, карточки-подсказки, вероятные вопросы из зала — и суфлёр для репетиции."),
    ),
    (await ai.hasKey()) ? "" : emptyKeyNotice(),
    form,
    panel.el,
    h("div", { class: "row" },
      info,
      h("button", {
        class: "btn",
        type: "button",
        onclick: () => {
          const { main } = splitNotes(panel.text || "");
          if (!main) return toast("Сначала подготовьте или вставьте текст выступления", "error");
          teleprompter(main);
        },
      }, "Открыть суфлёр (репетиция)"),
      h("button", {
        class: "btn",
        type: "button",
        onclick: async () => {
          const { main } = splitNotes(panel.text || "");
          if (!main) return toast("Сначала подготовьте текст выступления", "error");
          await store.set("slides-source", main);
          location.hash = "#/slides?strategy=free";
        },
      }, "Сделать презентацию"),
    ),
  );
}

export { teleprompter };
