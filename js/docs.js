// Документы: генерация деловых текстов по типам, редактор «сделать
// грамотно и по-деловому», использование образцов документов организации.

import * as ai from "./ai.js";
import { loadBrand } from "./brand.js";
import { h, field, select, toast, resultPanel, formData, emptyKeyNotice } from "./ui.js";
import { documentSystem, editSystem } from "./prompts.js";
import { voiceAction, checkVoice, renderVoiceResult } from "./voice.js";

export const DOC_TYPES = {
  order: {
    label: "Приказ по основной деятельности",
    what: "О чём приказ: например, «о проведении ежегодной оценки персонала», «об утверждении Положения об адаптации», «о назначении наставников»",
    details: "Основание, сроки, ответственные, порядок, кто знакомится",
    note: "Кадровые приказы по личному составу (приём, перевод, отпуск, увольнение) обычно оформляются по формам из кадровой программы (1С и т. п.) — для них здесь лучше готовить сопроводительные тексты.",
  },
  memo: {
    label: "Служебная записка",
    what: "Суть: что сообщаете или о чём просите",
    details: "Факты, цифры, причины, что нужно от адресата и к какому сроку",
  },
  letter: {
    label: "Деловое письмо (внешнее)",
    what: "Кому и зачем: партнёру, вузу, кадровому агентству, в ведомство",
    details: "Факты, просьба или предложение, сроки, контакты",
  },
  info: {
    label: "Информационное письмо / рассылка сотрудникам",
    what: "О чём сообщить коллективу",
    details: "Что, когда, где, что нужно сделать сотрудникам, к кому обращаться",
  },
  regulation: {
    label: "Положение (локальный нормативный акт)",
    what: "Какое положение: об адаптации, о наставничестве, об обучении, о премировании, о кадровом резерве, о корпоративной культуре…",
    details: "Ключевые правила, сроки, участники, ответственность, связанные документы",
    note: "Положения, затрагивающие оплату и условия труда, принимаются с учётом мнения профсоюза (если он есть) и требуют ознакомления сотрудников под подпись.",
  },
  jobdesc: {
    label: "Должностная инструкция",
    what: "Должность и подразделение",
    details: "Основные обязанности, кому подчиняется, требования к образованию и опыту, профстандарт (если применяется), права, ответственность",
  },
  notice: {
    label: "Уведомление сотрудника",
    what: "О чём уведомляем: изменение условий трудового договора, перевод, окончание срочного договора, необходимость предоставить документы…",
    details: "Что меняется, с какой даты, причины, что сотрудник может сделать",
    note: "Для многих уведомлений закон устанавливает сроки и порядок вручения — проверьте их до отправки.",
  },
  protocol: {
    label: "Протокол совещания",
    what: "Тема совещания",
    details: "Дата, участники, обсуждали (тезисами), решили (кто, что, срок)",
  },
  vacancy: {
    label: "Текст вакансии",
    what: "Должность, город, формат работы",
    details: "Задачи, требования, условия (зарплата, график, бонусы), почему у нас хорошо",
  },
  sop: {
    label: "Регламент / пошаговая инструкция",
    what: "Какой процесс описываем: например, «как оформить командировку», «выход нового сотрудника»",
    details: "Шаги, участники, сроки, документы, системы",
  },
  thanks: {
    label: "Благодарственное письмо / характеристика",
    what: "Кому и за что",
    details: "Достижения, качества, период работы, для кого характеристика",
  },
  reply: {
    label: "Ответ на обращение или жалобу сотрудника",
    what: "Суть обращения",
    details: "Что выяснили, какое решение, что предпринимаем, сроки",
  },
  other: {
    label: "Другой документ",
    what: "Какой документ нужен и зачем",
    details: "Все известные факты",
  },
};

const LENGTHS = [
  ["short", "Кратко"],
  ["standard", "Стандартно"],
  ["full", "Подробно"],
];

const LENGTH_TEXT = {
  short: "Сделай документ максимально кратким, только суть.",
  standard: "Обычный объём для такого документа.",
  full: "Сделай подробный, полный документ со всеми уместными разделами.",
};

function conversationRunner(panel, brand, systemFn) {
  let messages = [];
  const run = (msgs) =>
    panel.run(async (onText, signal) => {
      const res = await ai.generate({ system: systemFn(brand), messages: msgs, onText, signal });
      messages = [...msgs, { role: "assistant", content: res.text }];
      return res;
    });
  return {
    start(content) {
      return run([{ role: "user", content }]);
    },
    refine(text) {
      if (!messages.length) return;
      return run([...messages, { role: "user", content: `Доработай документ: ${text}\nВерни документ целиком в том же формате (документ, затем разделитель и подсказки).` }]);
    },
  };
}

export async function render(root, params = {}) {
  const brand = await loadBrand();

  // ---------- Вкладка 1: создать документ ----------
  const panel = resultPanel({ kind: "document", onRefine: (t) => conv.refine(t), extraActions: [voiceAction("официальный документ")] });
  const conv = conversationRunner(panel, brand, documentSystem);

  const typeSel = select("type", Object.entries(DOC_TYPES).map(([k, v]) => [k, v.label]), params.type || "order");
  const whatEl = h("textarea", { name: "what", rows: 3, required: true });
  const detailsEl = h("textarea", { name: "details", rows: 5 });
  const noteEl = h("div", { class: "notice", hidden: true });
  const sampleInput = h("input", { type: "file", accept: "application/pdf,text/plain,.txt,.md,image/png,image/jpeg,image/webp" });

  const syncType = () => {
    const t = DOC_TYPES[typeSel.value];
    whatEl.placeholder = t.what;
    detailsEl.placeholder = t.details;
    noteEl.hidden = !t.note;
    noteEl.textContent = t.note || "";
  };
  typeSel.addEventListener("change", syncType);
  syncType();

  const form = h("form", {
    class: "card stack",
    onsubmit: async (e) => {
      e.preventDefault();
      const d = formData(form);
      if (!d.what) return toast("Опишите, какой документ нужен", "error");
      const t = DOC_TYPES[d.type];
      const content = [];
      const sample = sampleInput.files?.[0];
      if (sample) {
        try {
          content.push(await ai.fileToContentBlock(sample));
        } catch {
          toast("Не удалось прочитать образец — продолжаю без него", "error");
        }
      }
      content.push({
        type: "text",
        text: [
          `Вид документа: ${t.label}.`,
          `Суть: ${d.what}`,
          d.details && `Факты и детали: ${d.details}`,
          d.to && `Адресат: ${d.to}`,
          d.from && `От кого / подписант: ${d.from}`,
          d.date && `Дата / сроки: ${d.date}`,
          LENGTH_TEXT[d.length],
          sample && "Приложен образец документа нашей организации — повтори его структуру, реквизиты и манеру изложения, но не копируй устаревшие данные.",
        ].filter(Boolean).join("\n"),
      });
      conv.start(content);
    },
  },
    h("h2", {}, "Создать документ"),
    field("Вид документа", typeSel),
    noteEl,
    field("Что нужно", whatEl),
    field("Факты и детали", detailsEl, "Чем больше конкретики — тем меньше правок. Вместо персональных данных можно писать [ФИО]."),
    h("div", { class: "grid-3" },
      field("Кому", h("input", { name: "to", placeholder: "Генеральному директору / всем сотрудникам" })),
      field("От кого / подписант", h("input", { name: "from", value: brand.signer || "", placeholder: "Начальник отдела персонала [ФИО]" })),
      field("Дата, сроки", h("input", { name: "date", placeholder: "с 01.12, до конца квартала" })),
    ),
    h("div", { class: "grid-2" },
      field("Объём", select("length", LENGTHS, "standard")),
      field("Образец документа организации (по желанию)", sampleInput, "PDF, текст или скриншот: ИИ повторит вашу структуру и реквизиты"),
    ),
    h("button", { class: "btn btn-primary btn-lg", type: "submit" }, "Составить документ"),
  );

  // ---------- Вкладка 2: улучшить текст ----------
  const editPanel = resultPanel({ kind: "edit", title: "Отредактированный текст", onRefine: (t) => editConv.refine(t), extraActions: [voiceAction("")] });
  const editConv = conversationRunner(editPanel, brand, editSystem);
  const editForm = h("form", {
    class: "card stack",
    onsubmit: (e) => {
      e.preventDefault();
      const d = formData(editForm);
      if (!d.source) return toast("Вставьте текст", "error");
      editConv.start(`Задача: ${d.goal}.\n\nТекст:\n${d.source}`);
    },
  },
    h("h2", {}, "Сделать текст грамотным и деловым"),
    field("Ваш текст", h("textarea", { name: "source", rows: 10, placeholder: "Вставьте черновик письма, объявления, ответа сотруднику…" })),
    field("Что сделать", select("goal", [
      "Исправить ошибки и привести к деловому стилю",
      "Сделать короче и понятнее",
      "Сделать мягче и вежливее",
      "Сделать твёрже и официальнее",
      "Адаптировать для рассылки всем сотрудникам",
      "Превратить в официальное письмо",
    ])),
    h("button", { class: "btn btn-primary btn-lg", type: "submit" }, "Отредактировать"),
  );

  // ---------- Вкладка 3: проверка тона бренда ----------
  const voiceBox = h("div");
  const voiceBtn = h("button", { class: "btn btn-primary btn-lg", type: "submit" }, "Проверить");
  const voiceForm = h("form", {
    class: "card stack",
    onsubmit: async (e) => {
      e.preventDefault();
      const d = formData(voiceForm);
      if (!d.vtext) return toast("Вставьте текст", "error");
      voiceBtn.disabled = true;
      voiceBtn.textContent = "Проверяю…";
      try {
        voiceBox.replaceChildren(renderVoiceResult(await checkVoice(d.vtext, d.channel)));
      } catch (err) {
        toast(err.message, "error");
      } finally {
        voiceBtn.disabled = false;
        voiceBtn.textContent = "Проверить";
      }
    },
  },
    h("h2", {}, "Звучит ли текст как наша организация"),
    h("p", { class: "hint" }, "Сверяет текст с голосом бренда из «Бренд-кита»: шкалы тона, черты характера, примеры «так пишем / так не пишем»."),
    field("Текст", h("textarea", { name: "vtext", rows: 8, placeholder: "Пост, рассылка, письмо кандидату, текст вакансии…" })),
    field("Где будет опубликован", select("channel", ["Рассылка сотрудникам", "Официальный документ", "Соцсети / бренд работодателя", "Письмо кандидату", "Текст вакансии", "Выступление"])),
    voiceBtn,
  );

  // ---------- Переключатель ----------
  const tabs = [
    ["create", "Создать документ", h("div", {}, form, panel.el)],
    ["edit", "Улучшить мой текст", h("div", {}, editForm, editPanel.el)],
    ["voice", "Проверить тон бренда", h("div", {}, voiceForm, voiceBox)],
  ];
  const tabBar = h("div", { class: "tabs", role: "tablist" });
  const tabBody = h("div");
  const show = (key) => {
    for (const btn of tabBar.children) btn.classList.toggle("active", btn.dataset.key === key);
    tabBody.replaceChildren(tabs.find((t) => t[0] === key)[2]);
  };
  for (const [key, label] of tabs) tabBar.append(h("button", { type: "button", "data-key": key, onclick: () => show(key) }, label));

  root.append(
    h("div", { class: "page-head" },
      h("h1", {}, "Документы"),
      h("p", { class: "lead" }, "Грамотные деловые тексты по правилам делопроизводства — с учётом тона вашей организации. Результат можно сразу скачать в Word."),
    ),
    (await ai.hasKey()) ? "" : emptyKeyNotice(),
    tabBar,
    tabBody,
  );
  show(params.tab || "create");
  if (params.what) whatEl.value = params.what;
}
