// Карта развития HR: самодиагностика зрелости HR-процессов по направлениям,
// приоритеты, первые шаги и переход к наставнику / предложению руководителю.

import * as store from "./store.js";
import * as ai from "./ai.js";
import { h, resultPanel, toast } from "./ui.js";
import { loadBrand } from "./brand.js";
import { mentorSystem, strategySystem } from "./prompts.js";
import { orgContext } from "./org.js";

export const AREAS = [
  {
    id: "recruit",
    title: "Подбор персонала",
    items: [
      "Есть профиль (требования) для ключевых должностей",
      "Знаем среднее время закрытия вакансии и стоимость найма",
      "Есть шаблоны вакансий и сценарии интервью",
      "Есть реферальная программа или работа с вузами/колледжами",
    ],
    quick: ["Сделать шаблон вакансии в фирменном тоне", "Посчитать время и стоимость найма за полгода", "Запустить «Приведи друга» с понятной премией"],
    idea: "Реферальная программа «Приведи друга»",
  },
  {
    id: "onboard",
    title: "Адаптация новичков",
    items: [
      "Есть план первого дня, недели и испытательного срока",
      "У новичка есть наставник или «бадди»",
      "Есть приветственный набор: памятка, контакты, структура",
      "Проводим встречи по итогам 1 и 3 месяцев",
    ],
    quick: ["Чек-лист первого дня для руководителя", "Welcome-письмо и визуал «Добро пожаловать»", "Встреча HR с новичком через 30 дней"],
    idea: "Программа адаптации и наставничества для новичков",
  },
  {
    id: "assess",
    title: "Оценка и цели",
    items: [
      "У сотрудников есть понятные цели или KPI",
      "Раз в год (или чаще) проходит оценка с обратной связью",
      "Руководители умеют давать обратную связь",
      "Результаты оценки влияют на развитие и вознаграждение",
    ],
    quick: ["Пилот оценки в одном отделе", "Памятка руководителю «Как давать обратную связь»", "Шаблон встречи 1-на-1"],
    idea: "Ежегодная оценка и планы развития сотрудников",
  },
  {
    id: "learn",
    title: "Обучение и развитие",
    items: [
      "Есть план обучения на год",
      "Используем внутренних экспертов как преподавателей",
      "Есть база знаний / инструкции для новичков",
      "Измеряем эффект обучения (не только посещаемость)",
    ],
    quick: ["Опрос потребностей в обучении", "Серия коротких внутренних мастер-классов", "Каталог полезных бесплатных курсов"],
    idea: "Внутреннее обучение силами экспертов компании",
  },
  {
    id: "reserve",
    title: "Кадровый резерв и карьера",
    items: [
      "Определены ключевые должности и риски их потери",
      "Есть преемники хотя бы на ключевые позиции",
      "Сотрудники понимают возможные карьерные шаги",
      "Внутренние кандидаты рассматриваются в первую очередь",
    ],
    quick: ["Список ключевых должностей и «карта рисков»", "Публиковать вакансии сначала внутри", "Описать 2–3 карьерных трека"],
    idea: "Кадровый резерв на ключевые должности",
  },
  {
    id: "engage",
    title: "Вовлечённость и удержание",
    items: [
      "Регулярно измеряем вовлечённость (eNPS, пульс-опросы)",
      "Проводим exit-интервью и анализируем причины увольнений",
      "По итогам опросов есть план действий и он сообщается коллективу",
      "Есть система признания и благодарностей",
    ],
    quick: ["Короткий eNPS-опрос из 3 вопросов", "Exit-интервью по шаблону", "Ежемесячная «Благодарность месяца»"],
    idea: "Регулярный опрос вовлечённости (eNPS) и план действий",
  },
  {
    id: "brand",
    title: "Бренд работодателя и коммуникации",
    items: [
      "Сформулировано, почему у нас стоит работать (ценностное предложение)",
      "Есть единый фирменный стиль HR-материалов",
      "Регулярно рассказываем о людях и событиях компании",
      "Есть каналы внутренней коммуникации, которые читают",
    ],
    quick: ["Серия постов «Люди компании»", "Единые шаблоны поздравлений и анонсов", "Ежемесячный дайджест новостей"],
    idea: "Карьерная страница и бренд работодателя",
  },
  {
    id: "comp",
    title: "Вознаграждение и льготы",
    items: [
      "Знаем, как наши зарплаты соотносятся с рынком",
      "Правила премирования понятны сотрудникам",
      "Есть нематериальные льготы, которые ценят",
      "Пересмотр зарплат проходит по понятным правилам",
    ],
    quick: ["Сравнение зарплат по 5 ключевым позициям с рынком", "Опрос «Какие льготы важны»", "Понятная памятка о премировании"],
    idea: "Обзор зарплат относительно рынка и понятная система премирования",
  },
  {
    id: "analytics",
    title: "HR-аналитика",
    items: [
      "Считаем текучесть, в т. ч. раннюю",
      "Есть ежемесячный или квартальный HR-отчёт руководителю",
      "Знаем стоимость текучести в рублях",
      "Решения по персоналу принимаются на основе данных",
    ],
    quick: ["Одностраничный HR-дашборд раз в квартал", "Посчитать стоимость текучести", "Сравнение показателей по подразделениям"],
    idea: "Ежеквартальный HR-отчёт с ключевыми метриками для руководства",
  },
  {
    id: "ops",
    title: "Кадровое администрирование и автоматизация",
    items: [
      "Локальные нормативные акты актуальны и все ознакомлены",
      "Шаблоны документов единые и современные",
      "Рутинные операции автоматизированы",
      "Рассматривали или используем КЭДО",
    ],
    quick: ["Ревизия локальных актов: список и даты", "Библиотека шаблонов документов", "Оценить переход на КЭДО"],
    idea: "Переход на кадровый электронный документооборот (КЭДО)",
  },
];

const LEVELS = [
  [0, "Не начато", "bad"],
  [1, "Начальный уровень", "bad"],
  [50, "Развивается", "mid"],
  [75, "Сильная сторона", "good"],
];

function level(score) {
  return [...LEVELS].reverse().find(([min]) => score >= min);
}

export async function render(root) {
  const answers = await store.get("roadmap", {});
  const brand = await loadBrand();
  const result = h("div");
  let lastSummary = "";
  let messages = [];
  let lastSystem = null;
  const panel = resultPanel({
    kind: "strategy",
    title: "План развития HR",
    onRefine: (t) => messages.length && runDoc(lastSystem, [...messages, { role: "user", content: `Доработай: ${t}\nВерни текст целиком в том же формате.` }]),
  });
  const runDoc = (systemFn, msgs) => {
    lastSystem = systemFn;
    return panel.run(async (onText, signal) => {
      const res = await ai.generate({ system: await systemFn(), messages: msgs, onText, signal, effort: "high" });
      messages = [...msgs, { role: "assistant", content: res.text }];
      return res;
    });
  };
  const ask = (kind) => {
    if (!lastSummary) return toast("Сначала отметьте, что уже есть в организации", "error");
    if (kind === "short") {
      runDoc(async () => mentorSystem(brand, await orgContext()), [{ role: "user", content: `${lastSummary}\n\nНапиши коротко (до 1 страницы, простым текстом): 3 главных направления развития HR для нашей организации, почему именно они и первые шаги на месяц по каждому.` }]);
    } else if (kind === "full") {
      runDoc(async () => strategySystem(brand, await orgContext()), [{ role: "user", content: `${lastSummary}\n\nСоставь полный документ: стратегию развития HR на год на основе самодиагностики, со всеми разделами.` }]);
    } else {
      store.set("slides-source", `${lastSummary}\n\nЗадача презентации: предложить руководителю план развития HR на год — где мы сейчас, 3 приоритета, что даст организации, что нужно от руководителя.`).then(() => (location.hash = "#/slides?strategy=initiative"));
    }
  };

  const scoreOf = (a) => Math.round((a.items.filter((_, i) => answers[`${a.id}.${i}`]).length / a.items.length) * 100);

  const drawResult = () => {
    const scored = AREAS.map((a) => ({ a, s: scoreOf(a) }));
    const anyAnswered = Object.values(answers).some(Boolean);
    const weakest = [...scored].sort((x, y) => x.s - y.s).slice(0, 3);
    const total = Math.round(scored.reduce((s, x) => s + x.s, 0) / scored.length);
    const summary = scored.map(({ a, s }) => `${a.title}: ${s}%`).join("; ");
    if (anyAnswered) {
      const missing = weakest.map(({ a }) => `${a.title}: нет — ${a.items.filter((_, i) => !answers[`${a.id}.${i}`]).join("; ")}`).join("\n");
      lastSummary = `Самодиагностика HR-процессов. Общий уровень зрелости: ${total} %. По направлениям: ${summary}.\nСлабые места и чего не хватает:\n${missing}`;
      store.set("roadmap-summary", lastSummary);
    }
    const mentorPrompt = `Я прошла самодиагностику HR-процессов в нашей организации. Результаты по направлениям: ${summary}. Слабые места: ${weakest.map((w) => w.a.title).join(", ")}. Составь мне план развития HR на 6 месяцев: быстрые победы на первый месяц, затем 2–3 стратегических проекта. Учти, что сначала нужно получить поддержку руководителя.`;

    result.replaceChildren(
      h("section", { class: "card" },
        h("h2", {}, "Результат"),
        h("p", {}, `Общий уровень зрелости HR: `, h("b", {}, `${total} %`)),
        h("div", { class: "bars" },
          ...scored.map(({ a, s }) => {
            const [, label, tone] = level(s);
            return h("div", { class: "bar-row" },
              h("span", { class: "bar-label" }, a.title),
              h("div", { class: "bar" }, h("div", { class: `bar-fill ${tone}`, style: { width: `${Math.max(s, 2)}%` } })),
              h("span", { class: "bar-val" }, `${s}% · ${label}`),
            );
          }),
        ),
      ),
      anyAnswered ? h("section", { class: "card" },
        h("h2", {}, "С чего начать: 3 приоритета"),
        h("div", { class: "prio-grid" },
          ...weakest.map(({ a }) =>
            h("div", { class: "prio" },
              h("h3", {}, a.title),
              h("p", { class: "muted" }, "Быстрые шаги (до месяца):"),
              h("ul", {}, a.quick.map((q) => h("li", {}, q))),
              h("div", { class: "row" },
                h("a", { class: "btn", href: `#/proposal?idea=${encodeURIComponent(a.idea)}` }, "Предложение руководителю"),
              ),
            ),
          ),
        ),
        h("h3", {}, "Получить план развития"),
        h("p", { class: "hint" }, "С учётом профиля и правил организации из раздела «HR-наставник»."),
        h("div", { class: "row" },
          h("button", { class: "btn btn-primary btn-lg", type: "button", onclick: () => ask("short") }, "Коротко текстом"),
          h("button", { class: "btn btn-lg", type: "button", onclick: () => ask("full") }, "Полная стратегия (документ Word)"),
          h("button", { class: "btn btn-lg", type: "button", onclick: () => ask("slides") }, "Презентация для руководителя"),
          h("a", { class: "btn btn-ghost", href: `#/mentor?prompt=${encodeURIComponent(mentorPrompt)}` }, "Обсудить с наставником"),
        ),
      ) : "",
    );
  };

  const form = h("div", { class: "areas" },
    ...AREAS.map((a) =>
      h("section", { class: "card area" },
        h("h3", {}, a.title),
        ...a.items.map((text, i) => {
          const key = `${a.id}.${i}`;
          return h("label", { class: "check" },
            h("input", {
              type: "checkbox",
              checked: Boolean(answers[key]),
              onchange: async (e) => {
                answers[key] = e.target.checked;
                await store.set("roadmap", answers);
                drawResult();
              },
            }),
            " ",
            text,
          );
        }),
      ),
    ),
  );

  root.append(
    h("div", { class: "page-head" },
      h("h1", {}, "Карта развития HR"),
      h("p", { class: "lead" }, "Отметьте, что уже есть в вашей организации. Приложение покажет слабые места, предложит быстрые шаги и поможет составить план и предложение руководителю."),
    ),
    form,
    result,
  );
  root.append(panel.el);
  drawResult();
}
