// Общие элементы интерфейса: создание элементов, уведомления, Markdown,
// панель результата ИИ (поток, копирование, сохранение, экспорт в Word).

import { marked } from "../vendor/marked.js";
import DOMPurify from "../vendor/purify.js";
import * as store from "./store.js";
import { SPLIT } from "./prompts.js";
import { exportDocx } from "./export.js";

marked.setOptions({ gfm: true, breaks: true });

/** Короткая запись для создания DOM-элементов. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function md(text) {
  return DOMPurify.sanitize(marked.parse(text || ""));
}

export function toast(message, kind = "ok") {
  const el = h("div", { class: `toast toast-${kind}`, role: "status" }, message);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, kind === "error" ? 6000 : 2600);
}

export function download(filename, blobOrText, type = "text/plain;charset=utf-8") {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const a = h("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Скопировано");
  } catch {
    toast("Не удалось скопировать — выделите текст вручную", "error");
  }
}

/** Убирает Markdown-разметку для вставки в мессенджеры/почту как простой текст. */
export function plain(text) {
  return (text || "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1$2")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function splitNotes(text) {
  const i = text.indexOf(SPLIT);
  if (i === -1) return { main: text.trim(), notes: "" };
  return { main: text.slice(0, i).trim(), notes: text.slice(i + SPLIT.length).trim() };
}

export function field(label, control, hint) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint && h("small", { class: "hint" }, hint));
}

export function select(name, options, value) {
  return h(
    "select",
    { name },
    options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return h("option", { value: v, selected: v === value }, l);
    }),
  );
}

export function formData(form) {
  const out = {};
  for (const el of form.querySelectorAll("input[name], select[name], textarea[name]")) {
    if (el.type === "checkbox") out[el.name] = el.checked;
    else if (el.type === "file") continue;
    else out[el.name] = el.value.trim();
  }
  return out;
}

/**
 * Панель результата: показывает поток текста от ИИ, затем даёт кнопки
 * «Копировать», «Скачать Word», «Сохранить в библиотеку», «Доработать».
 */
export function resultPanel({ kind, title, onRefine, extraActions = [] }) {
  let full = "";
  let controller = null;
  const body = h("div", { class: "result-body md" });
  const notes = h("div", { class: "result-notes md", hidden: true });
  const status = h("div", { class: "result-status" });
  const stopBtn = h("button", { class: "btn btn-ghost", type: "button", hidden: true, onclick: () => controller?.abort() }, "Остановить");

  const refineInput = h("input", { type: "text", placeholder: "Что поправить? Например: «короче», «добавь пункт про испытательный срок», «мягче тон»" });
  const refineBtn = h("button", { class: "btn", type: "button" }, "Доработать");
  const refineRow = h("form", {
    class: "refine-row",
    onsubmit: (e) => {
      e.preventDefault();
      const v = refineInput.value.trim();
      if (!v) return;
      refineInput.value = "";
      onRefine?.(v, full);
    },
  }, refineInput, refineBtn);

  const actions = h(
    "div",
    { class: "result-actions" },
    h("button", { class: "btn", type: "button", onclick: () => copyText(plain(splitNotes(full).main)) }, "Копировать текст"),
    h("button", { class: "btn", type: "button", onclick: () => copyText(splitNotes(full).main) }, "Копировать с разметкой"),
    h("button", {
      class: "btn",
      type: "button",
      onclick: async () => {
        const { main } = splitNotes(full);
        const name = (main.match(/^#\s*(.+)$/m)?.[1] || title || "документ").replace(/[\\/:*?"<>|]+/g, "").slice(0, 80);
        download(`${name}.docx`, await exportDocx(main));
      },
    }, "Скачать Word"),
    h("button", {
      class: "btn btn-primary",
      type: "button",
      onclick: async () => {
        const { main, notes: n } = splitNotes(full);
        const t = main.match(/^#\s*(.+)$/m)?.[1] || title || "Без названия";
        await store.saveToLibrary({ kind, title: t, text: main, notes: n });
        toast("Сохранено в «Мои материалы»");
      },
    }, "Сохранить"),
  );
  const extraBox = h("div", { style: { marginTop: "12px" } });
  for (const make of extraActions) actions.append(make(() => splitNotes(full).main, extraBox));
  const tools = h("div", { class: "result-tools", hidden: true }, actions, onRefine && refineRow, extraBox);

  const root = h("section", { class: "card result", hidden: true }, h("div", { class: "result-head" }, h("h3", {}, "Результат"), status, stopBtn), body, notes, tools);

  function render() {
    const { main, notes: n } = splitNotes(full);
    body.innerHTML = md(main);
    notes.hidden = !n;
    if (n) notes.innerHTML = `<div class="notes-title">Подсказки</div>${md(n)}`;
  }

  return {
    el: root,
    get text() {
      return full;
    },
    set(text) {
      full = text;
      root.hidden = false;
      tools.hidden = false;
      render();
    },
    /** Запуск генерации: fn(onText, signal) должна вернуть Promise<{text}> */
    async run(fn) {
      controller = new AbortController();
      root.hidden = false;
      tools.hidden = true;
      stopBtn.hidden = false;
      status.textContent = "Claude думает и пишет…";
      status.className = "result-status busy";
      const prev = full;
      full = "";
      render();
      root.scrollIntoView({ behavior: "smooth", block: "start" });
      try {
        const res = await fn((_d, all) => {
          full = all;
          render();
        }, controller.signal);
        full = res.text;
        render();
        status.textContent = res.truncated ? "Ответ обрезан по длине — попросите «продолжи»" : "Готово";
        status.className = "result-status";
      } catch (e) {
        if (e.aborted) {
          status.textContent = "Остановлено";
        } else {
          if (!full) full = prev;
          render();
          status.textContent = "";
          toast(e.message, "error");
        }
        status.className = "result-status";
      } finally {
        stopBtn.hidden = true;
        tools.hidden = !full;
        controller = null;
      }
    },
  };
}

export function emptyKeyNotice() {
  return h(
    "div",
    { class: "notice" },
    "Чтобы ИИ-функции заработали, нужен ключ Anthropic API. ",
    h("a", { href: "#/settings" }, "Открыть настройки"),
  );
}
