// Подключение к ИИ. Три варианта:
//  - Claude (Anthropic) — напрямую из браузера, ключ в этом браузере;
//  - GigaChat (Сбер) и YandexGPT (Яндекс) — через сервер-посредник в
//    Яндекс Облаке (server/yandex-function), ключи хранятся на сервере.
// Для российских моделей файлы переводятся в текст прямо в браузере:
// PDF — через pdf.js, Word — через mammoth, картинки — распознаванием
// текста (Yandex Vision OCR через тот же посредник).

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

export const PROVIDERS = {
  claude: "Claude (Anthropic) — ключ API в этом браузере",
  gigachat: "GigaChat (Сбер) — через сервер-посредник",
  yandex: "YandexGPT (Яндекс) — через сервер-посредник",
};

export const GIGA_MODELS = [
  ["GigaChat-2-Max", "GigaChat Max — лучшее качество"],
  ["GigaChat-2-Pro", "GigaChat Pro — баланс"],
  ["GigaChat-2", "GigaChat Lite — быстро и дёшево"],
];

export const YANDEX_MODELS = [
  ["yandexgpt/latest", "YandexGPT Pro — лучшее качество"],
  ["yandexgpt-lite/latest", "YandexGPT Lite — быстро и дёшево"],
];

export async function settings() {
  return {
    provider: "claude",
    apiKey: "",
    model: "claude-opus-5-5",
    effort: "medium",
    proxyUrl: "",
    proxyPassword: "",
    gigaModel: "GigaChat-2-Max",
    yandexModel: "yandexgpt/latest",
    ...(await store.get("settings", {})),
  };
}

export async function hasKey() {
  const s = await settings();
  return s.provider === "claude" ? Boolean(s.apiKey) : Boolean(s.proxyUrl && s.proxyPassword);
}

/** Модель умеет сама читать PDF и картинки (иначе переводим их в текст). */
export async function isClaude() {
  return (await settings()).provider === "claude";
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
async function claudeGenerate({ system, messages, onText, maxTokens, effort, signal }) {
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
async function claudeGenerateJSON({ system, messages, schema, maxTokens, effort }) {
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

// ---------- Российские модели через посредника ----------

export async function proxy(action, body, signal) {
  const s = await settings();
  if (!s.proxyUrl || !s.proxyPassword) {
    const err = new Error("Не настроен сервер-посредник. Откройте «Настройки» и укажите адрес функции и пароль.");
    err.code = "NO_KEY";
    throw err;
  }
  let res;
  try {
    const url = new URL(s.proxyUrl);
    url.searchParams.set("action", action);
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-App-Password": s.proxyPassword },
      body: JSON.stringify(body || {}),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw Object.assign(new Error("Остановлено."), { aborted: true });
    throw new Error("Нет связи с сервером-посредником. Проверьте адрес функции в «Настройках» и интернет.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && /пароль/i.test(data.error || "")) throw new Error("Неверный пароль сервера-посредника — проверьте его в «Настройках».");
    throw new Error(data.error || `Ошибка сервера-посредника (${res.status})`);
  }
  return data;
}

let pdfjs = null;
async function pdfToText(base64) {
  if (!pdfjs) {
    pdfjs = await import("../vendor/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.mjs", import.meta.url).href;
  }
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join(""));
  }
  let text = pages.join("\n\n").replace(/[ \t]+\n/g, "\n").trim();
  // Скан без текстового слоя — распознаём первые страницы как картинки
  if (text.length < 40 * doc.numPages) {
    const ocr = [];
    for (let i = 1; i <= Math.min(doc.numPages, 15); i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1.6 });
      const c = document.createElement("canvas");
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      ocr.push(await ocrCanvas(c));
    }
    text = ocr.join("\n\n");
  }
  return text;
}

async function ocrCanvas(canvas) {
  const k = Math.min(1, 1800 / Math.max(canvas.width, canvas.height));
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * k);
  c.height = Math.round(canvas.height * k);
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  const b64 = c.toDataURL("image/jpeg", 0.85).split(",")[1];
  const { text } = await proxy("ocr", { mimeType: "image/jpeg", content: b64 });
  return text;
}

async function imageToText(mediaType, b64) {
  const img = new Image();
  img.src = `data:${mediaType};base64,${b64}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  return ocrCanvas(c);
}

/** Переводит блоки (PDF, картинки, документы) в обычный текст для российских моделей. */
async function toPlain(content) {
  if (typeof content === "string") return content;
  const parts = [];
  for (const b of content) {
    if (b.type === "text") parts.push(b.text);
    else if (b.type === "document" && b.source?.type === "text") parts.push(`[Документ «${b.title || "файл"}»]\n${b.source.data}`);
    else if (b.type === "document" && b.source?.media_type === "application/pdf") parts.push(`[Документ «${b.title || "PDF"}»]\n${await pdfToText(b.source.data)}`);
    else if (b.type === "image") parts.push(`[Текст, распознанный на изображении — проверяй его как текст с картинки]\n${(await imageToText(b.source.media_type, b.source.data)) || "(текст не найден)"}`);
  }
  return parts.join("\n\n");
}

const RU_RULES = "\n\nОформляй ответ в Markdown (заголовки #, списки, таблицы). Не используй HTML.";

async function ruGenerate({ system, messages, onText, maxTokens, signal }) {
  const s = await settings();
  const plain = [];
  for (const m of messages) plain.push({ role: m.role, content: await toPlain(m.content) });
  const res = await proxy("chat", {
    provider: s.provider,
    model: s.provider === "gigachat" ? s.gigaModel : s.yandexModel,
    system: `${system || ""}${RU_RULES}`,
    messages: plain,
    maxTokens: maxTokens ?? 8000,
  }, signal);
  const text = res.text || "";
  onText?.(text, text);
  return { text, truncated: Boolean(res.truncated), usage: res.usage };
}

function extractJSON(text) {
  const t = text.replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no json");
  return JSON.parse(t.slice(a, b + 1));
}

async function ruGenerateJSON({ system, messages, schema, maxTokens }) {
  const sys = `${system || ""}\n\nОтветь СТРОГО одним JSON-объектом без пояснений, без Markdown и без комментариев. Структура (JSON Schema):\n${JSON.stringify(schema)}\nВсе поля из required обязательны; если данных нет — пустая строка "" или пустой массив [].`;
  const first = await ruGenerate({ system: sys, messages, maxTokens: maxTokens ?? 8000 });
  try {
    return extractJSON(first.text);
  } catch {
    const second = await ruGenerate({
      system: sys,
      messages: [...messages, { role: "assistant", content: first.text }, { role: "user", content: "Ответ не является корректным JSON. Верни только исправленный JSON-объект." }],
      maxTokens: maxTokens ?? 8000,
    });
    try {
      return extractJSON(second.text);
    } catch {
      throw new Error("Модель вернула ответ в неверном формате. Попробуйте ещё раз или выберите другую модель в «Настройках».");
    }
  }
}

// ---------- Общие функции ----------

/**
 * Генерация текста. onText(delta, fullText) вызывается по мере поступления
 * текста (у Claude — потоком, у российских моделей — один раз в конце).
 */
export async function generate(args) {
  const s = await settings();
  if (s.provider === "claude") return claudeGenerate(args);
  try {
    return await ruGenerate(args);
  } catch (e) {
    if (e.aborted || e.code === "NO_KEY") throw e;
    throw humanError(e);
  }
}

/** Запрос со строго заданной JSON-структурой ответа. */
export async function generateJSON(args) {
  const s = await settings();
  if (s.provider === "claude") return claudeGenerateJSON(args);
  return ruGenerateJSON(args);
}

/** Короткая проверка подключения. */
export async function ping() {
  const s = await settings();
  if (s.provider !== "claude") {
    const p = await proxy("ping", {});
    if (s.provider === "gigachat" && !p.gigachat) throw new Error("На сервере не настроен GigaChat: проверьте GIGACHAT_AUTH_KEY и файл сертификата.");
    if (s.provider === "yandex" && !p.yandex) throw new Error("На сервере не настроен YandexGPT: проверьте YANDEX_API_KEY и YANDEX_FOLDER_ID.");
  }
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
  if (/\.docx$/i.test(file.name) || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    if (!window.mammoth) throw new Error("Модуль чтения Word ещё не загрузился — попробуйте через пару секунд.");
    const { value } = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { type: "document", source: { type: "text", media_type: "text/plain", data: value }, title: file.name };
  }
  const text = await file.text();
  return { type: "document", source: { type: "text", media_type: "text/plain", data: text }, title: file.name };
}
