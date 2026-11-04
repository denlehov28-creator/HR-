// Сервер-посредник HR-ассистента для Yandex Cloud Functions (Node.js 18+).
// Хранит ключи в переменных окружения и пересылает запросы приложения в:
//   GigaChat (Сбер), YandexGPT и Vision OCR (Яндекс), Kandinsky (FusionBrain).
// Внешних зависимостей нет — файл можно вставить в редактор консоли как есть.
//
// Переменные окружения функции:
//   APP_PASSWORD        — пароль, который вводится в «Настройках» приложения (обязательно)
//   ALLOWED_ORIGIN      — адрес приложения, например https://denlehov28-creator.github.io
//   GIGACHAT_AUTH_KEY   — «Ключ авторизации» из личного кабинета GigaChat API
//   GIGACHAT_SCOPE      — GIGACHAT_API_PERS (физлицо), по умолчанию так
//   YANDEX_API_KEY      — API-ключ сервисного аккаунта Яндекс Облака
//   YANDEX_FOLDER_ID    — идентификатор каталога Яндекс Облака
//   FB_KEY, FB_SECRET   — ключи FusionBrain (Kandinsky), по желанию
// Рядом с index.js положите файл russian_trusted_root_ca.pem — корневой
// сертификат Минцифры (нужен для подключения к GigaChat).

"use strict";

const https = require("https");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const env = process.env;
const TIMEOUT = 280000;

// ---------- Сертификат Минцифры для GigaChat ----------

let sberCa = null;
function loadSberCa() {
  if (sberCa) return sberCa;
  for (const name of ["russian_trusted_root_ca.pem", "russian_trusted_root_ca.crt", "russian_trusted_root_ca.cer"]) {
    const p = path.join(__dirname, name);
    if (!fs.existsSync(p)) continue;
    const buf = fs.readFileSync(p);
    const text = buf.toString("utf8");
    // Файл бывает текстовым (PEM) или двоичным (DER) — поддерживаем оба
    sberCa = text.includes("-----BEGIN CERTIFICATE-----")
      ? text
      : `-----BEGIN CERTIFICATE-----\n${buf.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
    return sberCa;
  }
  return null;
}

// ---------- HTTPS-запрос ----------

function request(url, { method = "GET", headers = {}, body = null, sber = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { method, hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, headers, timeout: TIMEOUT };
    if (sber) {
      const ca = loadSberCa();
      if (!ca) return reject(Object.assign(new Error("Не найден файл сертификата Минцифры russian_trusted_root_ca.pem рядом с index.js"), { status: 500 }));
      opts.ca = [...tls.rootCertificates, ca];
    }
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = raw;
        try { data = JSON.parse(raw); } catch { /* не JSON */ }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Сервис не ответил вовремя")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function upstreamError(name, r) {
  const msg = typeof r.data === "object" ? (r.data.message || r.data.error?.message || r.data.error || JSON.stringify(r.data)) : String(r.data).slice(0, 300);
  return fail(r.status === 401 || r.status === 403 ? 401 : 502, `${name}: ${msg} (код ${r.status})`);
}

// ---------- GigaChat ----------

let gigaToken = null;
let gigaExpires = 0;

async function gigaAuth() {
  if (gigaToken && Date.now() < gigaExpires - 60000) return gigaToken;
  if (!env.GIGACHAT_AUTH_KEY) throw fail(400, "GigaChat не настроен: нет переменной GIGACHAT_AUTH_KEY");
  const body = `scope=${encodeURIComponent(env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS")}`;
  const r = await request("https://ngw.devices.sberbank.ru:9443/api/v2/oauth", {
    method: "POST",
    sber: true,
    headers: {
      Authorization: `Basic ${env.GIGACHAT_AUTH_KEY}`,
      RqUID: crypto.randomUUID(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    body,
  });
  if (r.status !== 200 || !r.data.access_token) throw upstreamError("GigaChat (авторизация)", r);
  gigaToken = r.data.access_token;
  gigaExpires = Number(r.data.expires_at) || Date.now() + 25 * 60000;
  return gigaToken;
}

async function gigaChat({ model, system, messages, maxTokens }) {
  const token = await gigaAuth();
  const payload = JSON.stringify({
    model: model || "GigaChat-2-Max",
    messages: [...(system ? [{ role: "system", content: system }] : []), ...messages.map((m) => ({ role: m.role, content: m.content }))],
    max_tokens: Math.min(Number(maxTokens) || 8000, 32000),
    temperature: 0.3,
  });
  const r = await request("https://gigachat.devices.sberbank.ru/api/v1/chat/completions", {
    method: "POST",
    sber: true,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(payload) },
    body: payload,
  });
  if (r.status === 401) gigaToken = null;
  if (r.status !== 200) throw upstreamError("GigaChat", r);
  const choice = r.data.choices?.[0];
  return { text: choice?.message?.content || "", truncated: choice?.finish_reason === "length", usage: r.data.usage };
}

// ---------- YandexGPT ----------

function yandexHeaders(extra = {}) {
  if (!env.YANDEX_API_KEY || !env.YANDEX_FOLDER_ID) throw fail(400, "YandexGPT не настроен: нет YANDEX_API_KEY или YANDEX_FOLDER_ID");
  return { Authorization: `Api-Key ${env.YANDEX_API_KEY}`, "x-folder-id": env.YANDEX_FOLDER_ID, "Content-Type": "application/json", ...extra };
}

async function yandexChat({ model, system, messages, maxTokens }) {
  const payload = JSON.stringify({
    modelUri: `gpt://${env.YANDEX_FOLDER_ID}/${model || "yandexgpt/latest"}`,
    completionOptions: { stream: false, temperature: 0.3, maxTokens: String(Math.min(Number(maxTokens) || 8000, 8000)) },
    messages: [...(system ? [{ role: "system", text: system }] : []), ...messages.map((m) => ({ role: m.role, text: m.content }))],
  });
  const r = await request("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
    method: "POST",
    headers: yandexHeaders({ "Content-Length": Buffer.byteLength(payload) }),
    body: payload,
  });
  if (r.status !== 200) throw upstreamError("YandexGPT", r);
  const alt = r.data.result?.alternatives?.[0];
  return { text: alt?.message?.text || "", truncated: /LENGTH/i.test(alt?.status || ""), usage: r.data.result?.usage };
}

async function yandexOcr({ mimeType, content }) {
  const payload = JSON.stringify({ mimeType: /jpe?g/i.test(mimeType) ? "JPEG" : "PNG", languageCodes: ["ru", "en"], model: "page", content });
  const r = await request("https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText", {
    method: "POST",
    headers: yandexHeaders({ "Content-Length": Buffer.byteLength(payload) }),
    body: payload,
  });
  if (r.status !== 200) throw upstreamError("Распознавание текста (Vision OCR)", r);
  return { text: r.data.result?.textAnnotation?.fullText || "" };
}

// ---------- Kandinsky (FusionBrain) ----------

const FB = "https://api-key.fusionbrain.ai/key/api/v1";

function fbHeaders(extra = {}) {
  if (!env.FB_KEY || !env.FB_SECRET) throw fail(400, "Kandinsky не настроен: нет FB_KEY или FB_SECRET");
  return { "X-Key": `Key ${env.FB_KEY}`, "X-Secret": `Secret ${env.FB_SECRET}`, ...extra };
}

async function kandinskyRun({ prompt, negative, width, height }) {
  const pipes = await request(`${FB}/pipelines`, { headers: fbHeaders() });
  const pipeline = Array.isArray(pipes.data) ? pipes.data[0]?.id : null;
  if (!pipeline) throw upstreamError("Kandinsky", pipes);
  const params = JSON.stringify({ type: "GENERATE", numImages: 1, width, height, negativePromptDecoder: negative || "текст, буквы, логотип, водяной знак", generateParams: { query: prompt } });
  const boundary = `----hr${crypto.randomBytes(8).toString("hex")}`;
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="pipeline_id"\r\n\r\n${pipeline}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="params"; filename="params.json"\r\nContent-Type: application/json\r\n\r\n${params}\r\n` +
    `--${boundary}--\r\n`,
  );
  const r = await request(`${FB}/pipeline/run`, { method: "POST", headers: fbHeaders({ "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length }), body });
  if (!r.data?.uuid) throw upstreamError("Kandinsky", r);
  return { uuid: r.data.uuid };
}

async function kandinskyStatus({ uuid }) {
  const r = await request(`${FB}/pipeline/status/${encodeURIComponent(uuid)}`, { headers: fbHeaders() });
  if (r.status !== 200) throw upstreamError("Kandinsky", r);
  return r.data;
}

// ---------- Обработчик ----------

function cors(origin) {
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = !allowed.length || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin || "*" : allowed[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Password",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function samePassword(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports.handler = async function handler(event) {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const base = { ...cors(headers.origin), "Content-Type": "application/json; charset=utf-8" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: base, body: "" };
  const reply = (statusCode, obj) => ({ statusCode, headers: base, body: JSON.stringify(obj) });
  try {
    if (!env.APP_PASSWORD) throw fail(500, "На сервере не задан APP_PASSWORD");
    if (!samePassword(headers["x-app-password"], env.APP_PASSWORD)) throw fail(401, "Неверный пароль приложения");
    if (event.httpMethod !== "POST") throw fail(405, "Нужен POST-запрос");
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "{}";
    const body = JSON.parse(raw || "{}");
    const action = event.queryStringParameters?.action || body.action;
    switch (action) {
      case "ping":
        return reply(200, {
          ok: true,
          gigachat: Boolean(env.GIGACHAT_AUTH_KEY) && Boolean(loadSberCa()),
          yandex: Boolean(env.YANDEX_API_KEY && env.YANDEX_FOLDER_ID),
          kandinsky: Boolean(env.FB_KEY && env.FB_SECRET),
        });
      case "chat":
        if (!Array.isArray(body.messages)) throw fail(400, "Нет сообщений");
        return reply(200, body.provider === "gigachat" ? await gigaChat(body) : await yandexChat(body));
      case "ocr":
        return reply(200, await yandexOcr(body));
      case "kandinsky-run":
        return reply(200, await kandinskyRun(body));
      case "kandinsky-status":
        return reply(200, await kandinskyStatus(body));
      default:
        throw fail(400, "Неизвестное действие");
    }
  } catch (e) {
    return reply(e.status || 500, { error: e.message || String(e) });
  }
};
