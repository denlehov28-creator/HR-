// Проверка текста на соответствие голосу бренда (методика скила brand:
// шкалы тона, черты характера, примеры «так пишем / так не пишем»).

import * as ai from "./ai.js";
import * as store from "./store.js";
import { loadBrand, voiceText } from "./brand.js";
import { h, md, toast, copyText, plain } from "./ui.js";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number", description: "Насколько текст звучит как бренд, 0–100" },
    verdict: { type: "string", description: "Вывод в одном-двух предложениях" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          quote: { type: "string", description: "Дословный фрагмент текста" },
          problem: { type: "string", description: "Что не так с точки зрения голоса бренда" },
          fix: { type: "string", description: "Как переписать этот фрагмент" },
        },
        required: ["quote", "problem", "fix"],
      },
    },
    rewrite: { type: "string", description: "Весь текст, переписанный в голосе бренда (Markdown), с сохранением всех фактов" },
  },
  required: ["score", "verdict", "issues", "rewrite"],
};

export async function checkVoice(text, channel = "") {
  const brand = await loadBrand();
  return ai.generateJSON({
    system: `Ты — редактор бренда. Проверяешь, звучит ли текст голосом организации, и предлагаешь правки. Задавай вопросы: звучит ли это как наш бренд? Сказал бы так конкурент? Подходит ли тон каналу? Соответствует ли ценностям? Не меняй факты, цифры, даты и юридические формулировки. Для официальных документов (приказы, положения) строгий стиль — норма, не считай его нарушением.

Параметры бренда:
${brand.orgName ? `Организация: ${brand.orgName}.\n` : ""}${brand.tone ? `Тон по брендбуку: ${brand.tone}.\n` : ""}${brand.values ? `Ценности: ${brand.values}.\n` : ""}${brand.forbidden ? `Нежелательно: ${brand.forbidden}.\n` : ""}${voiceText(brand)}`,
    messages: [{ role: "user", content: `${channel ? `Канал: ${channel}.\n` : ""}Проверь текст:\n\n${text}` }],
    schema: SCHEMA,
    effort: "low",
  });
}

export function renderVoiceResult(res) {
  const tone = res.score >= 80 ? "good" : res.score >= 55 ? "mid" : "bad";
  return h("section", { class: "card" },
    h("div", { class: "result-head" },
      h("h3", {}, "Проверка тона бренда"),
      h("div", { class: `metric-row ${tone}`, style: { border: 0 } }, h("span", {}, "Соответствие:"), h("b", {}, ` ${Math.round(res.score)} из 100`)),
    ),
    h("p", {}, res.verdict),
    res.issues?.length
      ? h("div", { class: "stack" },
        ...res.issues.map((i) =>
          h("div", { class: "prio" },
            h("p", { class: "muted", style: { margin: 0 } }, `«${i.quote}»`),
            h("p", { style: { margin: "4px 0" } }, i.problem),
            h("p", { style: { margin: 0 } }, h("b", {}, "Лучше: "), i.fix),
          ),
        ),
      )
      : h("div", { class: "ok" }, "Замечаний нет: текст звучит голосом бренда."),
    res.rewrite && h("details", { style: { marginTop: "12px" } },
      h("summary", {}, "Текст, переписанный в голосе бренда"),
      h("div", { class: "result-body md", html: md(res.rewrite) }),
      h("div", { class: "row", style: { marginTop: "8px" } },
        h("button", { class: "btn", type: "button", onclick: () => copyText(plain(res.rewrite)) }, "Копировать"),
        h("button", {
          class: "btn",
          type: "button",
          onclick: async () => {
            await store.saveToLibrary({ kind: "voice-check", title: plain(res.rewrite).split("\n")[0].slice(0, 90) || "Текст в голосе бренда", text: res.rewrite });
            toast("Сохранено в «Мои материалы»");
          },
        }, "Сохранить"),
      ),
    ),
  );
}

/** Кнопка для панели результата: проверяет текущий текст и выводит отчёт в box. */
export function voiceAction(channel) {
  return (getText, box) =>
    h("button", {
      class: "btn",
      type: "button",
      onclick: async (e) => {
        const text = getText();
        if (!text) return;
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = "Проверяю тон…";
        try {
          box.replaceChildren(renderVoiceResult(await checkVoice(text, channel)));
          box.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (err) {
          toast(err.message, "error");
        } finally {
          b.disabled = false;
          b.textContent = "Проверить тон бренда";
        }
      },
    }, "Проверить тон бренда");
}
