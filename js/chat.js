// Общий чат: используется HR-наставником и «Помощником».
// История хранится локально; вложения живут только до конца сеанса.

import * as ai from "./ai.js";
import * as store from "./store.js";
import { h, md, toast, copyText, plain, download } from "./ui.js";
import { exportDocx } from "./export.js";

export function chatBox({ storeKey, system, starters = [], placeholder, thinking = "Думаю…", saveKind = "mentor", accept = "application/pdf,image/png,image/jpeg,image/webp,text/plain,.txt,.md,.csv", fileHint = "Приложить файл: " }) {
  let history = [];
  let busy = false;
  let controller = null;

  const list = h("div", { class: "chat-list", "aria-live": "polite" });
  const input = h("textarea", { rows: 3, placeholder: placeholder || "Напишите сообщение. Enter — отправить, Shift+Enter — новая строка" });
  const fileInput = h("input", { type: "file", accept });
  const sendBtn = h("button", { class: "btn btn-primary", type: "submit" }, "Отправить");
  const stopBtn = h("button", { class: "btn btn-ghost", type: "button", hidden: true, onclick: () => controller?.abort() }, "Остановить");

  const textOf = (m) => (typeof m.content === "string" ? m.content : m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"));

  const bubble = (m) => {
    const text = textOf(m);
    const attach = Array.isArray(m.content) && m.content.some((b) => b.type !== "text") ? h("div", { class: "attach" }, "Приложен файл") : null;
    return h("div", { class: `msg msg-${m.role}` },
      attach,
      h("div", { class: "md", html: md(text) }),
      m.role === "assistant" && text && h("div", { class: "msg-actions" },
        h("button", { class: "link-btn", type: "button", onclick: () => copyText(plain(text)) }, "Копировать"),
        h("button", { class: "link-btn", type: "button", onclick: async () => download(`${(plain(text).split("\n").find((l) => l.trim()) || "Ответ").slice(0, 60).replace(/[\\/:*?"<>|]+/g, "")}.docx`, await exportDocx(text)) }, "Word"),
        h("button", {
          class: "link-btn",
          type: "button",
          onclick: async () => {
            const firstLine = plain(text).split("\n").find((l) => l.trim()) || "Ответ";
            await store.saveToLibrary({ kind: saveKind, title: firstLine.slice(0, 90), text });
            toast("Сохранено в «Мои материалы»");
          },
        }, "Сохранить"),
      ),
    );
  };

  const startersEl = h("div", { class: "chips" }, starters.map(([label, text, needsInput]) =>
    h("button", {
      type: "button",
      class: "chip",
      onclick: () => {
        if (needsInput) {
          input.value = text;
          input.focus();
          input.setSelectionRange(text.length, text.length);
        } else send(text);
      },
    }, label)));

  const draw = () => {
    list.replaceChildren(...history.map(bubble));
    startersEl.hidden = history.length > 0 && starters.length > 6;
    list.scrollTop = list.scrollHeight;
  };

  async function send(text) {
    await ready;
    if (busy) return;
    text = (text ?? input.value).trim();
    const file = fileInput.files?.[0];
    if (!text && !file) return;
    if (!(await ai.hasKey())) return toast("Добавьте ключ API в настройках", "error");
    let content = text;
    if (file) {
      try {
        content = [await ai.fileToContentBlock(file), { type: "text", text: text || "Посмотри приложенный файл." }];
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
    liveEl.innerHTML = `<span class="typing">${thinking}</span>`;
    busy = true;
    sendBtn.disabled = true;
    stopBtn.hidden = false;
    controller = new AbortController();
    try {
      const msgs = history.slice(0, -1).slice(-40);
      while (msgs.length && msgs[0].role !== "user") msgs.shift();
      const res = await ai.generate({
        system: await system(),
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
      await store.set(storeKey, history.map((m) => (typeof m.content === "string" ? m : { role: m.role, content: `[был приложен файл] ${textOf(m)}` })));
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

  const el = h("section", { class: "card chat" },
    h("div", { class: "chat-head" },
      h("span", { class: "muted" }, "Разговор сохраняется на этом компьютере"),
      h("button", {
        class: "btn btn-ghost",
        type: "button",
        onclick: async () => {
          if (!history.length || !confirm("Начать новый разговор? Текущий будет удалён (важные ответы сначала сохраните).")) return;
          history = [];
          await store.set(storeKey, history);
          draw();
        },
      }, "Новый разговор"),
    ),
    startersEl,
    list,
    h("form", { class: "chat-form", onsubmit: (e) => { e.preventDefault(); send(); } },
      input,
      h("div", { class: "row" }, h("label", { class: "file-label" }, fileHint, fileInput), stopBtn, sendBtn),
    ),
  );

  const ready = store.get(storeKey, []).then((saved) => {
    history = saved;
    draw();
  });

  return { el, send };
}
