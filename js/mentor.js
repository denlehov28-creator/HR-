// HR-наставник: диалог с «опытным HR-директором». История хранится локально.

import * as ai from "./ai.js";
import * as store from "./store.js";
import { loadBrand } from "./brand.js";
import { h, md, toast, copyText, plain, emptyKeyNotice } from "./ui.js";
import { mentorSystem } from "./prompts.js";

const STARTERS = [
  ["С чего начать", "Я HR-специалист в нашей организации. Помоги понять, какие 3 направления HR развивать в первую очередь, чтобы руководитель увидел результат за 3 месяца. Задай мне нужные вопросы."],
  ["Высокая текучесть", "У нас высокая текучесть, особенно среди новичков в первые 3 месяца. Как разобраться в причинах и что сделать?"],
  ["Адаптация новичков", "Хочу выстроить систему адаптации новых сотрудников с нуля. Дай пошаговый план и список документов."],
  ["Вовлечённость", "Как измерить вовлечённость сотрудников (eNPS, пульс-опросы) и что делать с результатами?"],
  ["Обучение без бюджета", "Как организовать обучение и развитие сотрудников, если бюджета почти нет?"],
  ["Бренд работодателя", "Как усилить бренд работодателя, чтобы проще нанимать? Что можно сделать своими силами?"],
  ["Оценка персонала", "Хочу внедрить регулярную оценку сотрудников. Какой формат выбрать для нашей организации и как не вызвать сопротивление?"],
  ["Разговор с руководителем", "Как правильно предложить руководителю новую HR-инициативу, чтобы он согласился? Помоги подготовиться к разговору."],
  ["Сложный разговор", "Мне предстоит сложный разговор с сотрудником. Помоги подготовить сценарий."],
  ["Автоматизация и КЭДО", "Что из рутинной кадровой работы можно автоматизировать, в т. ч. перейти на кадровый электронный документооборот (КЭДО)? С чего начать?"],
  ["Мой рост", "Помоги составить мой план профессионального развития как HR-специалиста на год: какие компетенции, курсы, книги, сообщества."],
];

export async function render(root, params = {}) {
  const brand = await loadBrand();
  let history = await store.get("mentor-history", []);
  let busy = false;
  let controller = null;

  const list = h("div", { class: "chat-list" });
  const input = h("textarea", { rows: 3, placeholder: "Опишите ситуацию или задайте вопрос. Enter — отправить, Shift+Enter — новая строка" });
  const fileInput = h("input", { type: "file", accept: "application/pdf,image/png,image/jpeg,image/webp,text/plain,.txt,.md,.csv", title: "Приложить файл" });
  const sendBtn = h("button", { class: "btn btn-primary", type: "submit" }, "Отправить");
  const stopBtn = h("button", { class: "btn btn-ghost", type: "button", hidden: true, onclick: () => controller?.abort() }, "Остановить");

  const bubble = (m) => {
    const text = typeof m.content === "string" ? m.content : m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const attach = Array.isArray(m.content) && m.content.some((b) => b.type !== "text") ? h("div", { class: "attach" }, "📎 приложен файл") : null;
    const body = h("div", { class: "md", html: md(text) });
    return h("div", { class: `msg msg-${m.role}` },
      attach,
      body,
      m.role === "assistant" && h("div", { class: "msg-actions" },
        h("button", { class: "link-btn", type: "button", onclick: () => copyText(plain(text)) }, "Копировать"),
        h("button", {
          class: "link-btn",
          type: "button",
          onclick: async () => {
            const firstLine = plain(text).split("\n").find((l) => l.trim()) || "Совет наставника";
            await store.saveToLibrary({ kind: "mentor", title: firstLine.slice(0, 90), text });
            toast("Сохранено в «Мои материалы»");
          },
        }, "Сохранить"),
      ),
    );
  };

  const starters = h("div", { class: "chips" }, STARTERS.map(([label, text]) => h("button", { type: "button", class: "chip", onclick: () => send(text) }, label)));

  const draw = () => {
    list.replaceChildren(...history.map(bubble));
    starters.hidden = history.length > 0;
    list.scrollTop = list.scrollHeight;
  };

  async function send(text) {
    if (busy) return;
    text = (text ?? input.value).trim();
    const file = fileInput.files?.[0];
    if (!text && !file) return;
    if (!(await ai.hasKey())) return toast("Добавьте ключ API в настройках", "error");
    let content = text;
    if (file) {
      try {
        content = [await ai.fileToContentBlock(file), { type: "text", text: text || "Посмотри приложенный файл и дай рекомендации." }];
      } catch {
        toast("Не удалось прочитать файл", "error");
      }
    }
    input.value = "";
    fileInput.value = "";
    history.push({ role: "user", content });
    const live = { role: "assistant", content: "" };
    history.push(live);
    draw();
    const liveEl = list.lastElementChild.querySelector(".md");
    liveEl.innerHTML = '<span class="typing">Наставник думает…</span>';
    busy = true;
    sendBtn.disabled = true;
    stopBtn.hidden = false;
    controller = new AbortController();
    try {
      const msgs = history.slice(0, -1).slice(-40);
      while (msgs.length && msgs[0].role !== "user") msgs.shift();
      const res = await ai.generate({
        system: mentorSystem(brand),
        messages: msgs,
        signal: controller.signal,
        onText: (_d, all) => {
          liveEl.innerHTML = md(all);
          list.scrollTop = list.scrollHeight;
        },
      });
      live.content = res.text;
    } catch (e) {
      if (!e.aborted) toast(e.message, "error");
      if (!live.content) {
        history.pop();
        history.pop();
        input.value = text;
      }
    } finally {
      // Сохраняем без вложений, чтобы не раздувать хранилище
      // В памяти файл остаётся до конца сеанса, на диск сохраняем только текст
      await store.set("mentor-history", history.map((m) => (typeof m.content === "string" ? m : {
        role: m.role,
        content: `[был приложен файл] ${m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n")}`,
      })));
      busy = false;
      sendBtn.disabled = false;
      stopBtn.hidden = true;
      draw();
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  root.append(
    h("div", { class: "page-head" },
      h("h1", {}, "HR-наставник"),
      h("p", { class: "lead" }, "Опытный HR-директор, который поможет разобраться в ситуации, выбрать направление развития и подготовить аргументы для руководителя."),
    ),
    (await ai.hasKey()) ? "" : emptyKeyNotice(),
    h("section", { class: "card chat" },
      h("div", { class: "chat-head" },
        h("span", { class: "muted" }, "Разговор сохраняется на этом компьютере"),
        h("button", {
          class: "btn btn-ghost",
          type: "button",
          onclick: async () => {
            if (!history.length || !confirm("Начать новый разговор? Текущий будет удалён (важные ответы сначала сохраните).")) return;
            history = [];
            await store.set("mentor-history", history);
            draw();
          },
        }, "Новый разговор"),
      ),
      starters,
      list,
      h("form", { class: "chat-form", onsubmit: (e) => { e.preventDefault(); send(); } },
        input,
        h("div", { class: "row" }, h("label", { class: "file-label" }, "📎 Файл ", fileInput), stopBtn, sendBtn),
      ),
    ),
  );
  draw();
  if (params.prompt) send(params.prompt);
}
