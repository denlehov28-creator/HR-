// Профиль организации и её внутренние правила. Это «память» наставника:
// всё, что он должен знать о реальных условиях, в которых работает HR.

import * as ai from "./ai.js";
import * as store from "./store.js";
import { loadBrand } from "./brand.js";
import { h, field, toast, formData } from "./ui.js";

export const PROFILE_FIELDS = [
  ["structure", "Структура", "Филиалы, подразделения, сколько людей где, есть ли удалёнка", 2],
  ["schedule", "Режим работы", "Пятидневка, сменный график, вахта, суммированный учёт…", 1],
  ["hrTeam", "HR-команда", "Сколько человек в HR и кто чем занимается; есть ли кадровик, рекрутер", 2],
  ["budget", "Бюджет HR", "Примерный бюджет на год на обучение, подбор, мероприятия; или «почти нет»", 1],
  ["authority", "Мои полномочия", "Что решаю сама, что только через руководителя, кто согласует бюджет", 2],
  ["leader", "Руководитель", "Что для него важно, как принимает решения, что его убеждает", 2],
  ["systems", "Программы и системы", "1С ЗУП, КЭДО, hh.ru, корпоративный портал, мессенджеры", 1],
  ["existing", "Что уже есть", "Какие процессы и документы работают: адаптация, оценка, обучение, ЛНА", 3],
  ["tried", "Что пробовали и не сработало", "И почему, по вашему мнению", 2],
  ["constraints", "Ограничения", "Профсоюз, отраслевые требования, госзакупки, режим секретности, высокая нагрузка…", 2],
  ["pains", "Главные проблемы сейчас", "Что болит больше всего: текучесть, подбор, дисциплина, вовлечённость…", 2],
  ["goals", "Цели на год", "Чего ждёт руководитель и чего хотите вы", 2],
];

export async function loadProfile() {
  return store.get("org-profile", {});
}

export async function loadRules() {
  return store.get("org-rules", []);
}

/** Текст для системной инструкции: профиль, правила, последние данные. */
export async function orgContext() {
  const [p, rules, brand, report, roadmap] = await Promise.all([
    loadProfile(),
    loadRules(),
    loadBrand(),
    store.get("people-report-summary", ""),
    store.get("roadmap-summary", ""),
  ]);
  const parts = [];
  const prof = PROFILE_FIELDS.filter(([k]) => p[k]).map(([k, label]) => `- ${label}: ${p[k]}`);
  if (brand.industry || brand.headcount) prof.unshift(`- Сфера и численность: ${[brand.industry, brand.headcount].filter(Boolean).join(", ")}`);
  if (prof.length) parts.push(`Профиль организации (условия, в которых работает HR — учитывай их в каждом совете, предлагай только то, что реально выполнить в этих условиях):\n${prof.join("\n")}`);
  if (rules.length) {
    let txt = rules.map((d) => `«${d.title}» (${d.docType}):\n${d.rules.map((r) => `  - [${d.title}${r.ref ? `, ${r.ref}` : ""}] ${r.topic}: ${r.rule}`).join("\n")}`).join("\n");
    if (txt.length > 14000) txt = `${txt.slice(0, 14000)}\n…`;
    parts.push(`Внутренние правила организации (из её локальных актов). Если совет касается этих тем — опирайся на них и указывай источник в квадратных скобках. Если правило не найдено — так и скажи, не придумывай:\n${txt}`);
  }
  if (report) parts.push(`Последний HR-отчёт по данным 1С:\n${report}`);
  if (roadmap) parts.push(`Результаты самодиагностики HR (карта развития):\n${roadmap}`);
  if (!parts.length) return "\n\nПрофиль организации пока не заполнен. Если для совета важны условия организации (численность, бюджет, полномочия), коротко спроси о них или предложи заполнить «Профиль организации».";
  return `\n\n${parts.join("\n\n")}`;
}

// ---------- Экран: профиль ----------

export async function renderProfile(root) {
  const p = await loadProfile();
  const filled = PROFILE_FIELDS.filter(([k]) => p[k]).length;
  const form = h("form", { class: "grid-2", onsubmit: (e) => e.preventDefault() },
    ...PROFILE_FIELDS.map(([k, label, ph, rows]) =>
      field(label, rows > 1 ? h("textarea", { name: k, rows, placeholder: ph }, p[k] || "") : h("input", { name: k, value: p[k] || "", placeholder: ph })),
    ),
  );
  root.append(
    h("section", { class: "card" },
      h("h2", {}, "Профиль организации"),
      h("p", { class: "hint" }, `Заполнено ${filled} из ${PROFILE_FIELDS.length}. Чем подробнее, тем точнее советы: наставник предлагает только то, что реально сделать с вашим бюджетом, полномочиями и ограничениями. Не указывайте персональные данные сотрудников.`),
      form,
      h("div", { class: "row", style: { marginTop: "16px" } },
        h("button", {
          class: "btn btn-primary btn-lg",
          type: "button",
          onclick: async () => {
            await store.set("org-profile", formData(form));
            toast("Профиль сохранён — наставник будет его учитывать");
          },
        }, "Сохранить профиль"),
      ),
    ),
  );
}

// ---------- Экран: правила организации ----------

const RULES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Название документа" },
    docType: { type: "string", description: "Вид: положение, ПВТР, коллективный договор, приказ, инструкция…" },
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: { type: "string", description: "Тема: отпуска, премии, испытательный срок, адаптация, режим работы…" },
          rule: { type: "string", description: "Правило своими словами, кратко и точно, с цифрами и сроками из документа" },
          ref: { type: "string", description: "Пункт или раздел документа, например «п. 4.2»" },
        },
        required: ["topic", "rule", "ref"],
      },
    },
  },
  required: ["title", "docType", "rules"],
};

export async function renderRules(root) {
  let rules = await loadRules();
  const list = h("div", { class: "lib-list" });
  const draw = () => {
    list.replaceChildren(
      ...(rules.length
        ? rules.map((d, i) =>
          h("article", { class: "lib-item" },
            h("div", { class: "lib-meta" }, h("span", { class: "badge" }, d.docType || "документ"), h("span", {}, `${d.rules.length} правил`)),
            h("h3", {}, d.title),
            h("details", {},
              h("summary", {}, "Показать извлечённые правила"),
              h("ul", {}, d.rules.map((r) => h("li", {}, h("b", {}, `${r.topic}: `), r.rule, r.ref ? h("span", { class: "hint" }, ` (${r.ref})`) : ""))),
            ),
            h("div", { class: "row", style: { marginTop: "8px" } },
              h("button", {
                class: "btn btn-ghost btn-danger",
                type: "button",
                onclick: async () => {
                  if (!confirm(`Удалить «${d.title}» из правил наставника?`)) return;
                  rules.splice(i, 1);
                  await store.set("org-rules", rules);
                  draw();
                },
              }, "Удалить"),
            ),
          ),
        )
        : [h("p", { class: "muted" }, "Документы ещё не загружены.")]),
    );
  };
  const input = h("input", { type: "file", multiple: true, accept: "application/pdf,.docx,text/plain,.txt,.md,image/png,image/jpeg,image/webp" });
  const status = h("span", { class: "hint" });
  const btn = h("button", {
    class: "btn btn-primary",
    type: "button",
    onclick: async () => {
      const files = [...(input.files || [])];
      if (!files.length) return toast("Выберите файлы", "error");
      btn.disabled = true;
      for (const [n, f] of files.entries()) {
        status.textContent = `Читаю «${f.name}» (${n + 1} из ${files.length})…`;
        try {
          const block = await ai.fileToContentBlock(f);
          const data = await ai.generateJSON({
            system: "Ты — специалист по трудовому праву и кадровому делопроизводству. Извлеки из локального нормативного акта организации конкретные правила, важные для HR: сроки, порядки, размеры выплат, обязанности, кто согласует. Пиши кратко, точно, с цифрами из документа, по-русски. Ничего не добавляй от себя. Персональные данные (ФИО, паспорта) не переноси.",
            messages: [{ role: "user", content: [block, { type: "text", text: "Извлеки правила из этого документа." }] }],
            schema: RULES_SCHEMA,
            maxTokens: 16000,
          });
          rules.push({ ...data, file: f.name, addedAt: new Date().toISOString() });
          await store.set("org-rules", rules);
          draw();
        } catch (e) {
          toast(`«${f.name}»: ${e.message}`, "error");
        }
      }
      status.textContent = "";
      input.value = "";
      btn.disabled = false;
      toast("Готово: наставник учитывает загруженные правила");
    },
  }, "Загрузить и извлечь правила");

  root.append(
    h("section", { class: "card" },
      h("h2", {}, "Правила организации"),
      h("p", {}, "Загрузите ваши локальные акты (PDF, Word, текст или фото страниц): ПВТР, положения об оплате труда, премировании, адаптации, обучении, коллективный договор. ИИ один раз извлечёт из них ключевые правила, и наставник будет советовать в их рамках, ссылаясь на конкретный пункт."),
      h("p", { class: "hint" }, "Документ отправляется в выбранный ИИ-сервис для разбора; храниться в приложении будет только краткий список правил. Перед загрузкой уберите из документов персональные данные."),
      h("div", { class: "row" }, input, btn, status),
    ),
    list,
  );
  draw();
}
