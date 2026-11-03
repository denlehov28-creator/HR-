// Предложение руководителю: служебная записка-«одностраничник» с проблемой,
// решением, эффектом в цифрах, ресурсами, рисками и ответами на возражения.

import * as ai from "./ai.js";
import * as store from "./store.js";
import { loadBrand } from "./brand.js";
import { voiceAction } from "./voice.js";
import { h, field, toast, resultPanel, formData, splitNotes, emptyKeyNotice } from "./ui.js";
import { proposalSystem } from "./prompts.js";

const IDEAS = [
  "Программа адаптации и наставничества для новичков",
  "Регулярный опрос вовлечённости (eNPS) и план действий",
  "Кадровый резерв на ключевые должности",
  "Ежегодная оценка и планы развития сотрудников",
  "Внутреннее обучение силами экспертов компании",
  "Переход на кадровый электронный документооборот (КЭДО)",
  "Реферальная программа «Приведи друга»",
  "Карьерная страница и бренд работодателя",
  "Exit-интервью и анализ причин увольнений",
  "Программа благополучия сотрудников (wellbeing)",
];

export async function render(root, params = {}) {
  const brand = await loadBrand();
  const facts = await store.get("proposal-facts", []);
  let messages = [];

  const panel = resultPanel({
    kind: "proposal",
    title: "Предложение руководителю",
    extraActions: [voiceAction("служебная записка руководителю")],
    onRefine: (t) => messages.length && run([...messages, { role: "user", content: `Доработай: ${t}\nВерни документ целиком в том же формате.` }]),
  });
  const run = (msgs) =>
    panel.run(async (onText, signal) => {
      const res = await ai.generate({ system: proposalSystem(brand), messages: msgs, onText, signal, effort: "high" });
      messages = [...msgs, { role: "assistant", content: res.text }];
      return res;
    });

  const ideaInput = h("input", { name: "idea", list: "ideas", value: params.idea || "", placeholder: "Например: программа наставничества для новичков" });
  const factsEl = h("textarea", { name: "facts", rows: 5, placeholder: "Текучесть 28 % в год, из них 40 % — в первые 3 месяца; одна замена стоит ~180 000 ₽…" }, facts.join("\n"));

  const form = h("form", {
    class: "card stack",
    onsubmit: (e) => {
      e.preventDefault();
      const d = formData(form);
      if (!d.idea) return toast("Укажите инициативу", "error");
      run([{
        role: "user",
        content: [
          `Инициатива: ${d.idea}`,
          d.problem && `Проблема / что происходит сейчас: ${d.problem}`,
          d.facts && `Цифры и факты: ${d.facts}`,
          d.resources && `Ресурсы, которые потребуются (если известно): ${d.resources}`,
          d.deadline && `Желаемые сроки: ${d.deadline}`,
          d.to && `Кому: ${d.to}`,
          d.from && `От кого: ${d.from}`,
          d.style && `Особенности руководителя / что для него важно: ${d.style}`,
        ].filter(Boolean).join("\n"),
      }]);
    },
  },
    h("h2", {}, "Подготовить предложение"),
    field("Инициатива", ideaInput),
    h("datalist", { id: "ideas" }, IDEAS.map((i) => h("option", { value: i }))),
    field("Какую проблему решаем", h("textarea", { name: "problem", rows: 3, placeholder: "Что происходит, как это мешает бизнесу, примеры" })),
    field("Цифры и факты", factsEl, h("span", {}, "Посчитайте проблему в деньгах в разделе ", h("a", { href: "#/metrics" }, "«HR-метрики»"), " — цифры подставятся сюда.")),
    field("Ресурсы", h("input", { name: "resources", placeholder: "бюджет, люди, время — если уже понятно" })),
    h("div", { class: "grid-3" },
      field("Кому", h("input", { name: "to", placeholder: "Генеральному директору [ФИО]" })),
      field("От кого", h("input", { name: "from", placeholder: "Специалист по персоналу [ФИО]" })),
      field("Сроки", h("input", { name: "deadline", placeholder: "запуск в I квартале" })),
    ),
    field("Что важно для руководителя", h("input", { name: "style", placeholder: "считает деньги, любит конкретику, против лишней бумаги…" })),
    h("div", { class: "row" },
      h("button", { class: "btn btn-primary btn-lg", type: "submit" }, "Составить предложение"),
      facts.length > 0 && h("button", {
        class: "btn btn-ghost",
        type: "button",
        onclick: async () => {
          await store.set("proposal-facts", []);
          factsEl.value = "";
        },
      }, "Очистить цифры из калькулятора"),
    ),
  );

  root.append(
    h("div", { class: "page-head" },
      h("h1", {}, "Предложение руководителю"),
      h("p", { class: "lead" }, "Служебная записка на одну страницу: проблема в цифрах → решение → эффект → ресурсы → риски → что нужно решить. Плюс ответы на вероятные возражения."),
    ),
    (await ai.hasKey()) ? "" : emptyKeyNotice(),
    form,
    panel.el,
    h("div", { class: "row" },
      h("button", {
        class: "btn",
        type: "button",
        onclick: async () => {
          const { main } = splitNotes(panel.text || "");
          if (!main) return toast("Сначала составьте предложение", "error");
          await store.set("slides-source", main);
          location.hash = "#/slides?strategy=initiative";
        },
      }, "Сделать презентацию для защиты"),
    ),
  );
}
