// Подключение к Claude (Anthropic API) прямо из браузера.
// Ключ хранится только локально (IndexedDB этого браузера).

import Anthropic from "../vendor/anthropic.js";
import * as store from "./store.js";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 — максимальное качество (рекомендуется)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — быстрее и дешевле" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — самый быстрый, для черновиков" },
];

// Для этих моделей включаем серверный «запасной» маршрут: если запрос
// отклонён фильтром безопасности, API сам повторит его на подходящей модели.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export async function settings() {
  return {
    apiKey: "",
    model: "claude-opus-5-5",
    effort: "medium",
    ...(await store.get("settings", {})),
  };
}

export async function hasKey() {
  return Boolean((await settings()).apiKey);
}

async function client() {
  const s = await settings();
  if (!s.apiKey) {
    const err = new Error("Не указан ключ API. Откройте раздел «Настройки» и вставьте ключ.");
    err.code = "NO_KEY";
    throw err;
  }
  return { c: new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true }), s };
}

function baseParams(s, { system, messages, maxTokens, effort, format }) {
  const params = {
    model: s.model,
    max_tokens: maxTokens ?? 32000,
    system,
    messages,
    output_config: { effort: effort || s.effort || "medium" },
  };
  if (format) params.output_config.format = format;
  if (FALLBACK_MODELS.has(s.model)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return params;
}

function humanError(e) {
  if (e?.code === "NO_KEY") return e;
  const status = e?.status;
  let msg = e?.message || String(e);
  if (status === 401) msg = "Ключ API не подходит. Проверьте его в разделе «Настройки».";
  else if (status === 403) msg = "Нет доступа к этой модели для вашего ключа. Выберите другую модель в настройках.";
  else if (status === 429) msg = "Слишком много запросов или исчерпан лимит. Подождите минуту и повторите.";
  else if (status >= 500) msg = "Сервис временно недоступен. Повторите через пару минут.";
  else if (/fetch|network|Failed to fetch/i.test(msg)) msg = "Нет связи с сервисом. Проверьте интернет.";
  const err = new Error(msg);
  err.cause = e;
  return err;
}

/**
 * Генерация текста с потоковым выводом.
 * onText(delta, fullText) вызывается по мере поступления текста.
 */
export async function generate({ system, messages, onText, maxTokens, effort, signal }) {
  try {
    const { c, s } = await client();
    const stream = c.beta.messages.stream(
      baseParams(s, { system, messages, maxTokens, effort }),
      { signal },
    );
    let full = "";
    stream.on("text", (delta) => {
      full += delta;
      onText?.(delta, full);
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") {
      throw new Error("Модель отказалась выполнять этот запрос. Переформулируйте задачу.");
    }
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text, truncated: msg.stop_reason === "max_tokens", usage: msg.usage };
  } catch (e) {
    if (e?.name === "AbortError" || /abort/i.test(e?.message || "")) {
      const err = new Error("Остановлено.");
      err.aborted = true;
      throw err;
    }
    throw humanError(e);
  }
}

/** Запрос со строго заданной JSON-структурой ответа. */
export async function generateJSON({ system, messages, schema, maxTokens, effort }) {
  try {
    const { c, s } = await client();
    const stream = c.beta.messages.stream(
      baseParams(s, {
        system,
        messages,
        maxTokens: maxTokens ?? 16000,
        effort,
        format: { type: "json_schema", schema },
      }),
    );
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("Модель отказалась выполнять этот запрос.");
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return JSON.parse(text);
  } catch (e) {
    throw humanError(e);
  }
}

/** Короткая проверка ключа. */
export async function ping() {
  const { text } = await generate({
    system: "Ответь одним словом.",
    messages: [{ role: "user", content: "Скажи «работает»." }],
    maxTokens: 2000,
    effort: "low",
  });
  return text;
}

// ---------- Вложения ----------

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Превращает файл в блок для отправки модели (PDF, изображение или текст). */
export async function fileToContentBlock(file) {
  const type = file.type || "";
  if (type === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: await fileToBase64(file) },
      title: file.name,
    };
  }
  if (/^image\/(png|jpeg|gif|webp)$/.test(type)) {
    return { type: "image", source: { type: "base64", media_type: type, data: await fileToBase64(file) } };
  }
  const text = await file.text();
  return { type: "document", source: { type: "text", media_type: "text/plain", data: text }, title: file.name };
}
