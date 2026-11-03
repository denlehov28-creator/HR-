// Генерация иллюстраций для макетов тремя способами:
//  1) Claude рисует векторную иллюстрацию (SVG) строго в цветах бренда;
//  2) Kandinsky (Сбер, сервис FusionBrain);
//  3) GPT Image (OpenAI).
// В генераторы уходит только текстовое описание. Логотип не отправляется
// никуда: он накладывается на готовую картинку оригинальным файлом.

import DOMPurify from "../vendor/purify.js";
import * as ai from "./ai.js";
import { loadImage } from "./brand.js";
import { imagePromptSystem, brandContext } from "./prompts.js";

export const ENGINES = {
  svg: "Векторная иллюстрация от Claude (в цветах бренда)",
  kandinsky: "Kandinsky — фото, 3D, акварель (нужен ключ FusionBrain)",
  gpt: "GPT Image — фото и сложные сцены (нужен ключ OpenAI)",
};

const NO_TEXT = "No text, no letters, no numbers, no logos, no watermarks, no emblems.";

/** Claude пишет промпты для генератора по задаче и палитре бренда. */
export async function writePrompts(task, brand, layoutHint) {
  const palette = brand.colors.map((c) => `${c.name} ${c.hex}`).join(", ");
  const { text } = await ai.generate({
    system: imagePromptSystem,
    messages: [{ role: "user", content: `Задача: ${task}\n${layoutHint}\nПалитра бренда: ${palette}${brandContext(brand)}` }],
    maxTokens: 4000,
    effort: "low",
  });
  const pick = (label) => (text.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*|$)`)) || [])[1]?.trim() || "";
  return { ru: pick("RU") || task, en: pick("EN") || task, negative: pick("Negative") };
}

// ---------- 1. SVG от Claude ----------

export async function svgIllustration(task, brand, w, h) {
  const palette = brand.colors.map((c) => c.hex).join(", ");
  const { text } = await ai.generate({
    system: `Ты — иллюстратор, который рисует аккуратные плоские векторные иллюстрации в SVG для корпоративных макетов.
Правила:
- Верни ТОЛЬКО код одного элемента <svg> без пояснений и без Markdown.
- viewBox="0 0 ${w} ${h}", width="${w}" height="${h}".
- Используй ТОЛЬКО цвета палитры бренда: ${palette}. Можно менять их прозрачность (opacity). Других цветов нет.
- Стиль: современная плоская иллюстрация, крупные простые формы, мягкие тени формами, без мелкой детализации. Люди — стилизованные, без черт лица или с минимальными.
- Никакого текста, букв, цифр, логотипов (элементы <text> запрещены). Без <script>, <foreignObject>, внешних ссылок и изображений.
- Заполни весь холст: фон + композиция. Оставь более спокойную зону под текст и логотип, если она указана.`,
    messages: [{ role: "user", content: `Нарисуй иллюстрацию: ${task}${brandContext(brand)}` }],
    maxTokens: 32000,
    effort: "medium",
  });
  const raw = (text.match(/<svg[\s\S]*<\/svg>/i) || [])[0];
  if (!raw) throw new Error("Не получилось нарисовать иллюстрацию — попробуйте описать иначе.");
  const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["text", "foreignObject", "image", "use", "script"] });
  const blob = new Blob([clean], { type: "image/svg+xml" });
  return { img: await loadImage(URL.createObjectURL(blob)), blob, ext: "svg" };
}

// ---------- 2. Kandinsky (FusionBrain) ----------

const FB = "https://api-key.fusionbrain.ai/key/api/v1";

export async function kandinsky(prompt, negative, w, h, onStatus) {
  const s = await ai.settings();
  if (!s.fbKey || !s.fbSecret) throw new Error("Добавьте API-ключ и секретный ключ FusionBrain в «Настройках».");
  const headers = { "X-Key": `Key ${s.fbKey}`, "X-Secret": `Secret ${s.fbSecret}` };
  // Kandinsky принимает размеры до 1024 и кратные 64
  const k = Math.min(1, 1024 / Math.max(w, h));
  const W = Math.max(256, Math.round((w * k) / 64) * 64);
  const H = Math.max(256, Math.round((h * k) / 64) * 64);
  try {
    onStatus?.("Подключаюсь к Kandinsky…");
    const pipes = await (await fetch(`${FB}/pipelines`, { headers })).json();
    const pipeline = Array.isArray(pipes) ? pipes[0]?.id : null;
    if (!pipeline) throw new Error("Kandinsky не вернул модель — проверьте ключи.");
    const form = new FormData();
    form.append("pipeline_id", pipeline);
    form.append("params", new Blob([JSON.stringify({ type: "GENERATE", numImages: 1, width: W, height: H, negativePromptDecoder: negative || "текст, буквы, логотип, водяной знак", generateParams: { query: prompt } })], { type: "application/json" }));
    const run = await (await fetch(`${FB}/pipeline/run`, { method: "POST", headers, body: form })).json();
    if (!run.uuid) throw new Error(run.message || "Kandinsky не принял задание.");
    for (let i = 0; i < 40; i++) {
      onStatus?.(`Kandinsky рисует… (${(i + 1) * 3} с)`);
      await new Promise((r) => setTimeout(r, 3000));
      const st = await (await fetch(`${FB}/pipeline/status/${run.uuid}`, { headers })).json();
      if (st.status === "DONE") {
        if (st.result?.censored) throw new Error("Kandinsky отклонил запрос фильтром — переформулируйте.");
        const b64 = st.result?.files?.[0];
        if (!b64) throw new Error("Kandinsky не вернул изображение.");
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        return { img: await loadImage(URL.createObjectURL(blob)), blob, ext: "png" };
      }
      if (st.status === "FAIL") throw new Error(st.errorDescription || "Kandinsky не смог создать изображение.");
    }
    throw new Error("Kandinsky отвечает слишком долго — попробуйте позже.");
  } catch (e) {
    if (e instanceof TypeError) throw new Error("Не удалось связаться с Kandinsky. Возможно, сервис не принимает запросы напрямую из браузера или нет интернета. Можно сгенерировать картинку на сайте fusionbrain.ai и загрузить её в поле «Фото / фон».");
    throw e;
  }
}

// ---------- 3. GPT Image (OpenAI) ----------

export async function gptImage(prompt, w, h) {
  const s = await ai.settings();
  if (!s.openaiKey) throw new Error("Добавьте ключ OpenAI в «Настройках».");
  const ratio = w / h;
  const size = ratio > 1.2 ? "1536x1024" : ratio < 0.83 ? "1024x1536" : "1024x1024";
  let res;
  try {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.openaiKey}` },
      body: JSON.stringify({ model: s.openaiModel || "gpt-image-1", prompt: `${prompt}\n${NO_TEXT}`, size, n: 1 }),
    });
  } catch {
    throw new Error("Не удалось связаться с OpenAI. Проверьте интернет.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `ошибка ${res.status}`;
    if (res.status === 401) throw new Error("Ключ OpenAI не подходит — проверьте его в «Настройках».");
    if (res.status === 403) throw new Error(`OpenAI отказал в доступе: ${msg}. Возможно, сервис недоступен в вашем регионе или модель не подключена.`);
    throw new Error(`OpenAI: ${msg}`);
  }
  const item = data.data?.[0];
  const src = item?.b64_json ? `data:image/png;base64,${item.b64_json}` : item?.url;
  if (!src) throw new Error("OpenAI не вернул изображение.");
  const blob = await (await fetch(src)).blob();
  return { img: await loadImage(URL.createObjectURL(blob)), blob, ext: "png" };
}

// ---------- Проверка готового макета ----------

export async function proofreadImage(blob) {
  const b64 = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.readAsDataURL(blob);
  });
  return (onText, signal) =>
    ai.generate({
      system: "Ты — корректор. Проверяешь текст на готовом макете перед публикацией. Выпиши весь текст с картинки, найди опечатки, ошибки орфографии и пунктуации, неверные кавычки и тире, лишние пробелы, несогласованность, сомнительные даты. Формат: «## Текст на макете», «## Ошибки» (было → стало, почему) или «Ошибок нет», «## Советы» (1–3 по читаемости). Логотип не оценивай и не предлагай менять.",
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }, { type: "text", text: "Проверь макет на ошибки." }] }],
      onText,
      signal,
      effort: "low",
      maxTokens: 6000,
    });
}
