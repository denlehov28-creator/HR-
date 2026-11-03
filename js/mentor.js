// HR-наставник: опытный HR-директор, который знает условия организации
// (профиль, внутренние правила, отчёты) и советует под них.

import * as ai from "./ai.js";
import * as store from "./store.js";
import { loadBrand } from "./brand.js";
import { h, field, select, toast, formData, resultPanel, emptyKeyNotice } from "./ui.js";
import { mentorSystem, strategySystem, processSystem, hrProcessSystem, HR_PROCESSES } from "./prompts.js";
import { orgContext, renderProfile, renderRules, loadProfile, loadRules } from "./org.js";
import { chatBox } from "./chat.js";

const STARTERS = [
  ["С чего начать", "Я HR-специалист в нашей организации. Помоги понять, какие 3 направления HR развивать в первую очередь, чтобы руководитель увидел результат за 3 месяца. Учти наши условия и задай нужные вопросы."],
  ["Разобрать ситуацию", "Хочу разобрать ситуацию: ", true],
  ["Высокая текучесть", "У нас высокая текучесть, особенно среди новичков в первые 3 месяца. Как разобраться в причинах и что сделать в наших условиях?"],
  ["Адаптация новичков", "Хочу выстроить систему адаптации новых сотрудников. Что реально сделать с нашими ресурсами?"],
  ["Вовлечённость", "Как измерить вовлечённость сотрудников (eNPS, пульс-опросы) и что делать с результатами?"],
  ["Обучение без бюджета", "Как организовать обучение и развитие сотрудников, если бюджета почти нет?"],
  ["Бренд работодателя", "Как усилить бренд работодателя, чтобы проще нанимать? Что можно сделать своими силами?"],
  ["Разговор с руководителем", "Как предложить руководителю новую HR-инициативу, чтобы он согласился? Учти, что для него важно."],
  ["Сложный разговор", "Мне предстоит сложный разговор с сотрудником. Помоги подготовить сценарий: ", true],
  ["Что по нашим правилам?", "Что говорят наши внутренние правила о ", true],
  ["Мой рост", "Помоги составить мой план профессионального развития как HR-специалиста на год."],
];

const PROCESSES = [
  "Подбор персонала", "Адаптация новичков", "Оценка эффективности", "Обучение и развитие", "Кадровый резерв",
  "Наставничество", "Внутренние коммуникации", "Признание и благодарности", "Отпуска и график отпусков",
  "Увольнение и exit-интервью", "Кадровое делопроизводство / КЭДО", "Другой процесс",
];

function docRunner(panel, systemFn) {
  let messages = [];
  const run = (msgs, effort) =>
    panel.run(async (onText, signal) => {
      const res = await ai.generate({ system: await systemFn(), messages: msgs, onText, signal, effort });
      messages = [...msgs, { role: "assistant", content: res.text }];
      return res;
    });
  return {
    start: (content, effort = "high") => run([{ role: "user", content }], effort),
    refine: (t) => messages.length && run([...messages, { role: "user", content: `Доработай документ: ${t}\nВерни документ целиком в том же формате.` }]),
  };
}

async function contextStatus() {
  const [p, rules] = await Promise.all([loadProfile(), loadRules()]);
  const filled = Object.values(p).filter(Boolean).length;
  if (filled >= 5 && rules.length) return "";
  return h("div", { class: "notice" },
    filled < 5 ? "Чтобы советы были под вашу организацию, заполните «Профиль организации». " : "",
    !rules.length ? "Загрузите ваши положения во вкладке «Правила организации» — наставник будет советовать в их рамках." : "",
  );
}

export async function render(root, params = {}) {
  const brand = await loadBrand();
  const sys = async () => mentorSystem(brand, await orgContext());

  // --- Разговор ---
  const chat = chatBox({
    storeKey: "mentor-history",
    system: sys,
    starters: STARTERS,
    placeholder: "Опишите ситуацию или задайте вопрос. Enter — отправить, Shift+Enter — новая строка",
    thinking: "Наставник думает…",
    saveKind: "mentor",
  });

  // --- Стратегия на год ---
  const stratPanel = resultPanel({ kind: "strategy", title: "HR-стратегия", onRefine: (t) => strat.refine(t) });
  const strat = docRunner(stratPanel, async () => strategySystem(brand, await orgContext()));
  const stratForm = h("form", {
    class: "card stack",
    onsubmit: async (e) => {
      e.preventDefault();
      const d = formData(stratForm);
      const facts = (await store.get("proposal-facts", [])).join("\n");
      strat.start([
        `Период: ${d.period || "следующий год"}.`,
        d.focus && `Главный фокус: ${d.focus}.`,
        d.extra && `Дополнительно: ${d.extra}`,
        facts && `Расчёты из калькулятора HR-метрик:\n${facts}`,
        `Формат: ${d.format === "short" ? "коротко, на 1–2 страницы" : "полный документ"}.`,
      ].filter(Boolean).join("\n"));
    },
  },
    h("h2", {}, "HR-стратегия на год"),
    h("p", { class: "hint" }, "Учитывает профиль и правила организации, результаты «Карты развития», HR-отчёты и расчёты метрик."),
    h("div", { class: "grid-2" },
      field("Период", h("input", { name: "period", placeholder: `${new Date().getFullYear() + 1} год` })),
      field("Формат", select("format", [["full", "Полный документ"], ["short", "Коротко, на 1–2 страницы"]], "full")),
    ),
    field("Главный фокус", h("input", { name: "focus", placeholder: "снизить текучесть, наладить подбор, развить руководителей…" })),
    field("Что ещё учесть", h("textarea", { name: "extra", rows: 3, placeholder: "Планы компании: открытие филиала, рост на 50 человек, сокращение бюджета…" })),
    h("button", { class: "btn btn-primary btn-lg", type: "submit" }, "Составить стратегию"),
  );

  // --- Выстроить процесс ---
  const procPanel = resultPanel({ kind: "process", title: "HR-процесс", onRefine: (t) => proc.refine(t) });
  const proc = docRunner(procPanel, async () => processSystem(brand, await orgContext()));
  const procForm = h("form", {
    class: "card stack",
    onsubmit: (e) => {
      e.preventDefault();
      const d = formData(procForm);
      const name = d.process === "Другой процесс" ? d.custom : d.process;
      if (!name) return toast("Укажите процесс", "error");
      proc.start([`Процесс: ${name}.`, d.now && `Как сейчас: ${d.now}`, d.want && `Что хотим получить: ${d.want}`].filter(Boolean).join("\n"));
    },
  },
    h("h2", {}, "Выстроить процесс"),
    h("p", { class: "hint" }, "Шаги, ответственные (RACI), сроки, документы по ТК РФ, метрики и план внедрения — под ваши условия."),
    h("div", { class: "grid-2" },
      field("Процесс", select("process", PROCESSES)),
      field("Если другой — какой", h("input", { name: "custom", placeholder: "например, согласование командировок" })),
    ),
    field("Как сейчас", h("textarea", { name: "now", rows: 3, placeholder: "Что уже есть, кто участвует, что не работает" })),
    field("Что хотим получить", h("textarea", { name: "want", rows: 2 })),
    h("button", { class: "btn btn-primary btn-lg", type: "submit" }, "Описать процесс"),
  );

  // --- HR-процессы (шаблоны) ---
  const hrPanel = resultPanel({ kind: "hr-process", title: "HR-документ", onRefine: (t) => hrRun.refine(t) });
  const hrRun = docRunner(hrPanel, async () => hrProcessSystem(brand, await orgContext()));
  const hrFields = h("div", { class: "stack" });
  const hrSel = select("tpl", Object.entries(HR_PROCESSES).map(([k, v]) => [k, v.label]), params.tpl || "onboarding");
  const syncHr = () => {
    hrFields.replaceChildren(...HR_PROCESSES[hrSel.value].fields.map(([k, l]) => field(l, h("textarea", { name: k, rows: k === "notes" || k === "requirements" || k === "terms" ? 3 : 1 }))));
  };
  hrSel.addEventListener("change", syncHr);
  syncHr();
  const hrForm = h("form", {
    class: "card stack",
    onsubmit: (e) => {
      e.preventDefault();
      const d = formData(hrForm);
      const t = HR_PROCESSES[d.tpl];
      hrRun.start(`${t.prompt}\n\nИсходные данные:\n${t.fields.map(([k, l]) => (d[k] ? `${l}: ${d[k]}` : "")).filter(Boolean).join("\n") || "не указаны — используй [поля для заполнения]"}`, "medium");
    },
  },
    h("h2", {}, "Готовые HR-процессы"),
    h("p", { class: "hint" }, "Методики из профессионального набора Human Resources (Anthropic), переложенные на российскую практику."),
    field("Что подготовить", hrSel),
    hrFields,
    h("button", { class: "btn btn-primary btn-lg", type: "submit" }, "Подготовить"),
  );

  // --- Вкладки ---
  const profileBox = h("div");
  const rulesBox = h("div");
  const tabs = [
    ["chat", "Разговор", h("div", {}, chat.el)],
    ["strategy", "Стратегия на год", h("div", {}, stratForm, stratPanel.el)],
    ["process", "Выстроить процесс", h("div", {}, procForm, procPanel.el)],
    ["hr", "HR-процессы", h("div", {}, hrForm, hrPanel.el)],
    ["profile", "Профиль организации", profileBox],
    ["rules", "Правила организации", rulesBox],
  ];
  const tabBar = h("div", { class: "tabs", role: "tablist" });
  const tabBody = h("div");
  const show = async (key) => {
    for (const b of tabBar.children) b.classList.toggle("active", b.dataset.key === key);
    if (key === "profile") { profileBox.replaceChildren(); await renderProfile(profileBox); }
    if (key === "rules") { rulesBox.replaceChildren(); await renderRules(rulesBox); }
    tabBody.replaceChildren(tabs.find((t) => t[0] === key)[2]);
  };
  for (const [key, label] of tabs) tabBar.append(h("button", { type: "button", "data-key": key, onclick: () => show(key) }, label));

  root.append(
    h("div", { class: "page-head" },
      h("h1", {}, "HR-наставник"),
      h("p", { class: "lead" }, "Опытный HR-директор, который знает условия вашей организации: составит стратегию на год, выстроит процессы и подскажет, как лучше сделать именно у вас."),
    ),
    (await ai.hasKey()) ? "" : emptyKeyNotice(),
    await contextStatus(),
    tabBar,
    tabBody,
  );
  await show(params.tab || "chat");
  if (params.prompt) chat.send(params.prompt);
}
