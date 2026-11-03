// HR-отчёты по выгрузке из 1С (Excel / CSV). Методика — people-report и
// comp-analysis (Human Resources, Anthropic), адаптированная под 1С и ТК РФ.
// Все расчёты — в браузере. В ИИ уходят только итоговые цифры без ФИО.

import { readSheet } from "../vendor/excel.js";
import * as ai from "./ai.js";
import * as store from "./store.js";
import { loadBrand } from "./brand.js";
import { h, field, select, toast, download, resultPanel } from "./ui.js";
import { exportDocx } from "./export.js";
import { mentorSystem } from "./prompts.js";
import { orgContext } from "./org.js";

const COLS = [
  ["name", "ФИО сотрудника", /сотрудник|фио|фамилия|работник/i, false],
  ["dept", "Подразделение", /подразделение|отдел|служба|департамент|цех/i, false],
  ["position", "Должность", /должность|позиция/i, false],
  ["hire", "Дата приёма", /при[её]м|принят|начал/i, true],
  ["fire", "Дата увольнения", /увольн|уволен/i, false],
  ["reason", "Основание увольнения", /основание|причина|стать/i, false],
  ["salary", "Оклад / зарплата", /оклад|тариф|ставк|зарплат|заработ|начислен/i, false],
];

const DAY = 86400000;

// ---------- Разбор файла ----------

function parseDate(v) {
  if (v instanceof Date && !Number.isNaN(+v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * DAY));
  const m = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(String(v ?? ""));
  if (m) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(y, Number(m[2]) - 1, Number(m[1]));
  }
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return null;
}

function parseNum(v) {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/\s| /g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseCsv(text) {
  const sep = (text.split("\n")[0].match(/;/g) || []).length >= (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

async function readFile(file) {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) text = new TextDecoder("windows-1251").decode(buf); // 1С часто сохраняет CSV в Windows-1251
    return parseCsv(text.replace(/^﻿/, ""));
  }
  return readSheet(file);
}

/** Ищет строку заголовков: 1С часто ставит над таблицей название отчёта и дату. */
function findHeader(rows) {
  let best = 0;
  let bestScore = -1;
  rows.slice(0, 25).forEach((r, i) => {
    const score = COLS.filter(([, , re]) => r.some((c) => typeof c === "string" && re.test(c))).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

function guess(headers) {
  const map = {};
  const used = new Set();
  const hd = headers.map((x) => String(x ?? ""));
  const pick = (test) => {
    const i = hd.findIndex((x, k) => !used.has(k) && test(x));
    if (i >= 0) used.add(i);
    return i;
  };
  // Сначала даты (в заголовке есть слово «дата»), затем остальное
  map.hire = pick((x) => /дата/i.test(x) && /при[её]м|принят|начал/i.test(x));
  if (map.hire < 0) map.hire = pick((x) => /при[её]м|принят/i.test(x));
  map.fire = pick((x) => /дата/i.test(x) && /увольн|уволен/i.test(x));
  if (map.fire < 0) map.fire = pick((x) => /^уволен|увольнени/i.test(x) && !/основани|причин|стать/i.test(x));
  map.reason = pick((x) => /основани|причин|стать/i.test(x));
  for (const [key, , re] of COLS) if (map[key] === undefined) map[key] = pick((x) => re.test(x));
  return map;
}

// ---------- Расчёты ----------

const isVoluntary = (reason) => /собствен|ст\.?\s*80\b|пункт\s*3\s*част|п\.?\s*3\s*ч\.?\s*1\s*ст\.?\s*77/i.test(reason || "");
const isAgreement = (reason) => /соглашени|п\.?\s*1\s*ч\.?\s*1\s*ст\.?\s*77/i.test(reason || "");
const isTermEnd = (reason) => /истечени|срочн|п\.?\s*2\s*ч\.?\s*1\s*ст\.?\s*77/i.test(reason || "");

function active(p, d) {
  return p.hire && p.hire <= d && (!p.fire || p.fire >= d);
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function compute(people, from, to) {
  const months = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(new Date(d));
  const monthEnd = (m) => new Date(m.getFullYear(), m.getMonth() + 1, 0);
  const avgHead = months.length ? months.reduce((s, m) => s + people.filter((p) => active(p, monthEnd(m) > to ? to : monthEnd(m))).length, 0) / months.length : 0;
  const startHead = people.filter((p) => active(p, from)).length;
  const endHead = people.filter((p) => p.hire && p.hire <= to && (!p.fire || p.fire > to)).length;
  const hires = people.filter((p) => p.hire && p.hire >= from && p.hire <= to);
  const leavers = people.filter((p) => p.fire && p.fire >= from && p.fire <= to);
  const hasReason = people.some((p) => p.reason);
  const vol = leavers.filter((p) => isVoluntary(p.reason));
  const early = leavers.filter((p) => (p.fire - p.hire) / DAY <= 90);
  const tenureY = (p, at) => ((p.fire && p.fire <= at ? p.fire : at) - p.hire) / DAY / 365.25;
  const staff = people.filter((p) => p.hire && p.hire <= to && (!p.fire || p.fire > to));
  const pct = (a, b) => (b ? (a / b) * 100 : 0);
  const yearFactor = 12 / Math.max(1, months.length);

  const buckets = [["до 3 мес.", 0, 0.25], ["3–12 мес.", 0.25, 1], ["1–3 года", 1, 3], ["3–5 лет", 3, 5], ["более 5 лет", 5, 1e9]];
  const tenureDist = buckets.map(([l, a, b]) => [l, staff.filter((p) => { const t = tenureY(p, to); return t >= a && t < b; }).length]);
  const leaveTenure = buckets.map(([l, a, b]) => [l, leavers.filter((p) => { const t = tenureY(p, p.fire); return t >= a && t < b; }).length]);

  const depts = [...new Set(people.map((p) => p.dept || "Без подразделения"))];
  const byDept = depts.map((d) => {
    const ppl = people.filter((p) => (p.dept || "Без подразделения") === d);
    const lv = ppl.filter((p) => p.fire && p.fire >= from && p.fire <= to);
    const avg = months.length ? months.reduce((s, m) => s + ppl.filter((p) => active(p, monthEnd(m) > to ? to : monthEnd(m))).length, 0) / months.length : 0;
    return {
      dept: d,
      head: ppl.filter((p) => p.hire && p.hire <= to && (!p.fire || p.fire > to)).length,
      avg,
      hires: ppl.filter((p) => p.hire && p.hire >= from && p.hire <= to).length,
      leavers: lv.length,
      early: lv.filter((p) => (p.fire - p.hire) / DAY <= 90).length,
      turnover: pct(lv.length, avg),
    };
  }).sort((a, b) => b.turnover - a.turnover);

  const byMonth = months.map((m) => {
    const e = monthEnd(m);
    return {
      label: m.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" }).replace(".", ""),
      hires: people.filter((p) => p.hire && p.hire >= m && p.hire <= e).length,
      leavers: people.filter((p) => p.fire && p.fire >= m && p.fire <= e).length,
    };
  });

  const reasons = {};
  if (hasReason) for (const p of leavers) {
    const k = isVoluntary(p.reason) ? "По собственному желанию" : isAgreement(p.reason) ? "По соглашению сторон" : isTermEnd(p.reason) ? "Истечение срочного договора" : "Другие основания";
    reasons[k] = (reasons[k] || 0) + 1;
  }

  // Зарплаты по должностям (comp-analysis)
  const withSal = staff.filter((p) => p.salary && p.position);
  const positions = [...new Set(withSal.map((p) => p.position))];
  const comp = positions.map((pos) => {
    const s = withSal.filter((p) => p.position === pos).map((p) => p.salary);
    const med = median(s);
    return { position: pos, n: s.length, min: Math.min(...s), med, max: Math.max(...s), spread: med ? ((Math.max(...s) - Math.min(...s)) / med) * 100 : 0 };
  }).filter((c) => c.n >= 2).sort((a, b) => b.spread - a.spread);
  const outliers = withSal.map((p) => {
    const c = comp.find((x) => x.position === p.position);
    if (!c) return null;
    const dev = ((p.salary - c.med) / c.med) * 100;
    return Math.abs(dev) >= 20 ? { ...p, dev, med: c.med } : null;
  }).filter(Boolean).sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev));

  return {
    from, to, months: months.length,
    startHead, endHead, avgHead,
    hires: hires.length, leavers: leavers.length,
    turnover: pct(leavers.length, avgHead), turnoverYear: pct(leavers.length, avgHead) * yearFactor,
    hasReason, voluntary: vol.length, volTurnover: pct(vol.length, avgHead),
    early: early.length, earlyRate: pct(early.length, hires.length),
    avgTenure: staff.length ? staff.reduce((s, p) => s + tenureY(p, to), 0) / staff.length : 0,
    tenureDist, leaveTenure, byDept, byMonth, reasons, comp, outliers,
  };
}

// ---------- Представление ----------

const f1 = (n) => (Number.isFinite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) : "—");
const rub = (n) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
const dstr = (d) => d.toLocaleDateString("ru-RU");

/** Текст отчёта без ФИО — им же кормим ИИ и наставника. */
export function summaryText(r, title) {
  const lines = [
    `${title}. Период: ${dstr(r.from)} — ${dstr(r.to)} (${r.months} мес.).`,
    `Численность: на начало ${r.startHead}, на конец ${r.endHead}, средняя ${f1(r.avgHead)}.`,
    `Принято ${r.hires}, уволено ${r.leavers}. Текучесть за период ${f1(r.turnover)} %, в пересчёте на год ${f1(r.turnoverYear)} %.`,
    r.hasReason ? `По собственному желанию: ${r.voluntary} (${f1(r.volTurnover)} % от средней численности).` : "Основания увольнения в выгрузке не указаны.",
    `Ранняя текучесть (ушли в первые 90 дней): ${r.early} чел., ${f1(r.earlyRate)} % от принятых.`,
    `Средний стаж работающих: ${f1(r.avgTenure)} года.`,
    `Стаж уволившихся: ${r.leaveTenure.map(([l, n]) => `${l} — ${n}`).join(", ")}.`,
    `Подразделения с наибольшей текучестью: ${r.byDept.slice(0, 5).map((d) => `${d.dept} — ${f1(d.turnover)} % (${d.leavers} из ~${f1(d.avg)})`).join("; ")}.`,
  ];
  if (Object.keys(r.reasons).length) lines.push(`Основания: ${Object.entries(r.reasons).map(([k, n]) => `${k} — ${n}`).join(", ")}.`);
  if (r.comp.length) lines.push(`Разброс окладов по должностям (макс. − мин. к медиане): ${r.comp.slice(0, 5).map((c) => `${c.position} — ${f1(c.spread)} %, медиана ${rub(c.med)}`).join("; ")}. Окладов с отклонением от медианы должности 20 % и более: ${r.outliers.length}.`);
  return lines.join("\n");
}

function markdownReport(r, title, aiText) {
  const t = (head, rows) => `| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|\n${rows.map((x) => `| ${x.join(" | ")} |`).join("\n")}\n`;
  let md = `# ${title}\n\n**Период:** ${dstr(r.from)} — ${dstr(r.to)}\n\n`;
  if (aiText) md += `${aiText}\n\n`;
  md += `## Ключевые показатели\n\n${t(["Показатель", "Значение"], [
    ["Численность на начало / конец", `${r.startHead} / ${r.endHead}`],
    ["Средняя численность", f1(r.avgHead)],
    ["Принято / уволено", `${r.hires} / ${r.leavers}`],
    ["Текучесть за период", `${f1(r.turnover)} %`],
    ["Текучесть в пересчёте на год", `${f1(r.turnoverYear)} %`],
    ...(r.hasReason ? [["По собственному желанию", `${r.voluntary} (${f1(r.volTurnover)} %)`]] : []),
    ["Ранняя текучесть (до 90 дней)", `${r.early} (${f1(r.earlyRate)} % от принятых)`],
    ["Средний стаж работающих", `${f1(r.avgTenure)} года`],
  ])}\n`;
  md += `## По подразделениям\n\n${t(["Подразделение", "Численность", "Принято", "Уволено", "Из них до 90 дней", "Текучесть"], r.byDept.map((d) => [d.dept, d.head, d.hires, d.leavers, d.early, `${f1(d.turnover)} %`]))}\n`;
  md += `## По месяцам\n\n${t(["Месяц", "Принято", "Уволено"], r.byMonth.map((m) => [m.label, m.hires, m.leavers]))}\n`;
  md += `## Стаж\n\n${t(["Стаж", "Работают", "Уволились"], r.tenureDist.map(([l, n], i) => [l, n, r.leaveTenure[i][1]]))}\n`;
  if (Object.keys(r.reasons).length) md += `## Основания увольнения\n\n${t(["Основание", "Человек"], Object.entries(r.reasons))}\n`;
  if (r.comp.length) md += `## Оклады по должностям\n\n${t(["Должность", "Человек", "Мин.", "Медиана", "Макс.", "Разброс"], r.comp.map((c) => [c.position, c.n, rub(c.min), rub(c.med), rub(c.max), `${f1(c.spread)} %`]))}\n`;
  md += `## Методика\n\nТекучесть = уволенные за период ÷ средняя численность × 100 %. Средняя численность — среднее из численности на конец каждого месяца (упрощённо, не равна среднесписочной по Росстату). Ранняя текучесть — доля принятых за период, уволившихся в первые 90 дней работы. Добровольные увольнения определены по основанию «по собственному желанию» (ст. 80 ТК РФ). Расчёт выполнен по выгрузке из 1С.\n`;
  return md;
}

function barChart(series, { height = 260, colors, labels }) {
  const W = 900;
  const H = height;
  const c = h("canvas", { width: W * 2, height: H * 2, style: { width: "100%", maxWidth: `${W}px`, height: "auto" }, role: "img", "aria-label": labels?.join(", ") || "Диаграмма" });
  const ctx = c.getContext("2d");
  ctx.scale(2, 2);
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue("--text").trim() || "#1b1f2a";
  const muted = css.getPropertyValue("--muted").trim() || "#5a6172";
  const n = series[0].values.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const padL = 36;
  const padB = 46;
  const groupW = (W - padL - 10) / n;
  const bw = Math.min(28, (groupW - 8) / series.length);
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = muted;
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((max / 4) * i);
    const y = H - padB - ((H - padB - 20) * i) / 4;
    ctx.fillText(String(v), padL - 6, y + 4);
    ctx.globalAlpha = 0.15;
    ctx.fillRect(padL, y, W - padL, 1);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "center";
  for (let i = 0; i < n; i++) {
    const gx = padL + i * groupW + groupW / 2;
    series.forEach((s, k) => {
      const v = s.values[i];
      const bh = ((H - padB - 20) * v) / max;
      const x = gx - (series.length * bw) / 2 + k * bw;
      ctx.fillStyle = colors[k];
      ctx.fillRect(x + 1, H - padB - bh, bw - 2, bh);
    });
    ctx.fillStyle = ink;
    const lab = String(series[0].labels[i]);
    ctx.fillText(lab.length > 14 ? `${lab.slice(0, 13)}…` : lab, gx, H - padB + 16);
  }
  // легенда
  let lx = padL;
  series.forEach((s, k) => {
    ctx.fillStyle = colors[k];
    ctx.fillRect(lx, H - 16, 12, 12);
    ctx.fillStyle = ink;
    ctx.textAlign = "left";
    ctx.fillText(s.name, lx + 18, H - 6);
    lx += ctx.measureText(s.name).width + 48;
  });
  return c;
}

const table = (head, rows) =>
  h("div", { style: { overflowX: "auto" } },
    h("table", { class: "md-table" },
      h("thead", {}, h("tr", {}, head.map((x) => h("th", {}, x)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, r.map((x) => h("td", {}, x))))),
    ),
  );

// ---------- Экран ----------

export async function renderReport(root) {
  const brand = await loadBrand();
  const pal = brand.colors?.length ? brand.colors : [{ hex: "#2a53d6" }, { hex: "#f5a623" }];
  const cMain = pal.find((c) => c.role === "основной")?.hex || pal[0].hex;
  const cAcc = pal.find((c) => c.role === "акцентный")?.hex || pal[1]?.hex || "#f5a623";

  let rows = null;
  let header = 0;
  let map = {};
  let people = [];
  let lastReport = null;
  let aiText = "";

  const fileInput = h("input", { type: "file", accept: ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" });
  const mapBox = h("div");
  const out = h("div");
  const aiPanel = resultPanel({ kind: "report", title: "Выводы по отчёту" });
  aiPanel.el.classList.add("no-print");

  const titleIn = h("input", { type: "text", value: "Отчёт по персоналу" });
  const fromIn = h("input", { type: "date" });
  const toIn = h("input", { type: "date" });

  const buildPeople = () => {
    people = rows.slice(header + 1).map((r) => ({
      name: map.name >= 0 ? String(r[map.name] ?? "").trim() : "",
      dept: map.dept >= 0 ? String(r[map.dept] ?? "").trim() : "",
      position: map.position >= 0 ? String(r[map.position] ?? "").trim() : "",
      hire: map.hire >= 0 ? parseDate(r[map.hire]) : null,
      fire: map.fire >= 0 ? parseDate(r[map.fire]) : null,
      reason: map.reason >= 0 ? String(r[map.reason] ?? "").trim() : "",
      salary: map.salary >= 0 ? parseNum(r[map.salary]) : null,
    })).filter((p) => p.hire);
    return people;
  };

  const drawMapping = () => {
    const headers = rows[header] || [];
    const opts = [["-1", "— нет такой колонки —"], ...headers.map((hd, i) => [String(i), String(hd || `Колонка ${i + 1}`).slice(0, 60)])];
    const headerSel = select("header", rows.slice(0, 25).map((r, i) => [String(i), `Строка ${i + 1}: ${r.filter(Boolean).slice(0, 4).join(" | ").slice(0, 70)}`]), String(header));
    headerSel.addEventListener("change", () => {
      header = Number(headerSel.value);
      map = guess(rows[header] || []);
      drawMapping();
    });
    const sels = COLS.map(([key, label, , req]) => {
      const s = select(key, opts, String(map[key] ?? -1));
      s.addEventListener("change", () => (map[key] = Number(s.value)));
      return field(`${label}${req ? " *" : ""}`, s);
    });
    // Период по умолчанию — последний полный год в данных
    buildPeople();
    const years = people.flatMap((p) => [p.hire, p.fire]).filter(Boolean).map((d) => d.getFullYear());
    const y = years.length ? Math.max(...years) : new Date().getFullYear();
    if (!fromIn.value) fromIn.value = `${y}-01-01`;
    if (!toIn.value) toIn.value = `${y}-12-31`;
    mapBox.replaceChildren(
      h("section", { class: "card stack" },
        h("h3", {}, "2. Проверьте колонки"),
        h("p", { class: "hint" }, `Найдено строк с датой приёма: ${people.length}. Приложение само угадало колонки — проверьте и поправьте, если нужно.`),
        field("Строка с заголовками таблицы", headerSel),
        h("div", { class: "grid-3" }, ...sels),
        h("h3", {}, "3. Период и название"),
        h("div", { class: "grid-3" }, field("С", fromIn), field("По", toIn), field("Название отчёта", titleIn)),
        h("button", { class: "btn btn-primary btn-lg", type: "button", onclick: run }, "Построить отчёт"),
      ),
    );
  };

  function run() {
    if (map.hire < 0) return toast("Укажите колонку «Дата приёма»", "error");
    buildPeople();
    if (!people.length) return toast("Не нашлось ни одной строки с датой приёма — проверьте колонку и строку заголовков", "error");
    const from = new Date(`${fromIn.value}T00:00:00`);
    const to = new Date(`${toIn.value}T23:59:59`);
    if (!(from < to)) return toast("Проверьте период", "error");
    const r = compute(people, from, to);
    lastReport = r;
    aiText = "";
    store.set("people-report-summary", summaryText(r, titleIn.value));
    drawReport(r);
  }

  const drawReport = (r) => {
    const tone = (v, a, b) => (v > b ? "bad" : v > a ? "mid" : "good");
    const kpi = (label, value, t = "") => h("div", { class: `metric-row ${t}` }, h("span", {}, label), h("b", {}, value));
    out.replaceChildren(
      h("section", { class: "card", id: "report-print" },
        h("div", { class: "result-head" }, h("h2", {}, titleIn.value), h("span", { class: "result-status" }, `${dstr(r.from)} — ${dstr(r.to)}`)),
        h("div", { class: "grid-2" },
          h("div", { class: "metric-out" },
            kpi("Численность на начало / конец", `${r.startHead} / ${r.endHead}`),
            kpi("Средняя численность", f1(r.avgHead)),
            kpi("Принято / уволено", `${r.hires} / ${r.leavers}`),
            kpi("Средний стаж работающих", `${f1(r.avgTenure)} года`),
          ),
          h("div", { class: "metric-out" },
            kpi("Текучесть за период", `${f1(r.turnover)} %`),
            kpi("В пересчёте на год", `${f1(r.turnoverYear)} %`, tone(r.turnoverYear, 12, 20)),
            r.hasReason ? kpi("По собственному желанию", `${r.voluntary} (${f1(r.volTurnover)} %)`) : kpi("Основания увольнения", "нет в выгрузке"),
            kpi("Ранняя текучесть (до 90 дней)", `${r.early} (${f1(r.earlyRate)} % от принятых)`, tone(r.earlyRate, 10, 20)),
          ),
        ),
        h("h3", {}, "Приём и увольнения по месяцам"),
        barChart([
          { name: "Принято", labels: r.byMonth.map((m) => m.label), values: r.byMonth.map((m) => m.hires) },
          { name: "Уволено", labels: r.byMonth.map((m) => m.label), values: r.byMonth.map((m) => m.leavers) },
        ], { colors: [cMain, cAcc] }),
        h("h3", {}, "Подразделения"),
        table(["Подразделение", "Численность", "Принято", "Уволено", "До 90 дней", "Текучесть"], r.byDept.map((d) => [d.dept, d.head, d.hires, d.leavers, d.early, `${f1(d.turnover)} %`])),
        h("h3", {}, "Стаж работающих и уволившихся"),
        barChart([
          { name: "Работают", labels: r.tenureDist.map((x) => x[0]), values: r.tenureDist.map((x) => x[1]) },
          { name: "Уволились за период", labels: r.leaveTenure.map((x) => x[0]), values: r.leaveTenure.map((x) => x[1]) },
        ], { colors: [cMain, cAcc], height: 220 }),
        Object.keys(r.reasons).length ? h("div", {}, h("h3", {}, "Основания увольнения"), table(["Основание", "Человек"], Object.entries(r.reasons))) : "",
        r.comp.length ? h("div", {},
          h("h3", {}, "Оклады по должностям"),
          h("p", { class: "hint" }, "Должности с наибольшим разбросом окладов сверху. Большой разброс без понятных причин — частая причина недовольства и увольнений."),
          table(["Должность", "Человек", "Мин.", "Медиана", "Макс.", "Разброс"], r.comp.slice(0, 15).map((c) => [c.position, c.n, rub(c.min), rub(c.med), rub(c.max), `${f1(c.spread)} %`])),
          r.outliers.length ? h("details", { style: { marginTop: "8px" } },
            h("summary", {}, `Оклады, отличающиеся от медианы должности на 20 % и более: ${r.outliers.length}`),
            h("p", { class: "hint" }, "Список виден только вам на этом компьютере и не отправляется в ИИ."),
            table(["Сотрудник", "Должность", "Оклад", "Медиана", "Отклонение"], r.outliers.slice(0, 50).map((o) => [o.name || "—", o.position, rub(o.salary), rub(o.med), `${o.dev > 0 ? "+" : ""}${f1(o.dev)} %`])),
          ) : "",
        ) : "",
        h("p", { class: "hint", style: { marginTop: "12px" } }, "Средняя численность считается по концу каждого месяца и может немного отличаться от среднесписочной по методике Росстата."),
      ),
      h("div", { class: "row no-print" },
        h("button", {
          class: "btn btn-primary btn-lg",
          type: "button",
          onclick: () => aiPanel.run(async (onText, signal) => {
            const res = await ai.generate({
              system: `${mentorSystem(brand, await orgContext())}\n\nСейчас твоя задача — проанализировать HR-отчёт и написать для руководителя: «## Главное» (3 вывода с цифрами), «## Что настораживает» (риски и где «болит»: подразделения, стаж, сезонность), «## Рекомендации» (5–7 конкретных действий с приоритетом и ожидаемым эффектом, реалистичных для этой организации), «## Что ещё проверить» (какие данные собрать). Не выдумывай цифры — используй только отчёт.`,
              messages: [{ role: "user", content: summaryText(r, titleIn.value) }],
              onText,
              signal,
              effort: "high",
            });
            aiText = res.text;
            return res;
          }),
        }, "Выводы и рекомендации ИИ"),
        h("button", { class: "btn", type: "button", onclick: async () => download(`${titleIn.value}.docx`, await exportDocx(markdownReport(r, titleIn.value, aiText))) }, "Скачать Word"),
        h("button", {
          class: "btn",
          type: "button",
          onclick: async () => {
            await store.set("slides-source", markdownReport(r, titleIn.value, aiText));
            location.hash = "#/slides?strategy=report";
          },
        }, "Сделать презентацию"),
        h("button", {
          class: "btn",
          type: "button",
          onclick: async () => {
            const facts = await store.get("proposal-facts", []);
            facts.push(summaryText(r, titleIn.value).split("\n").slice(0, 5).join(" "));
            await store.set("proposal-facts", facts.slice(-10));
            toast("Цифры добавлены в «Предложение руководителю»");
          },
        }, "Цифры в предложение руководителю"),
      ),
      aiPanel.el,
    );
    out.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      rows = (await readFile(f)).map((r) => r.map((c) => (c === null || c === undefined ? "" : c)));
      if (!rows.length) throw new Error("Файл пустой");
      header = findHeader(rows);
      map = guess(rows[header]);
      fromIn.value = "";
      toIn.value = "";
      drawMapping();
    } catch (e) {
      toast(`Не удалось прочитать файл: ${e.message}`, "error");
    }
  });

  root.append(
    h("section", { class: "card stack" },
      h("h2", {}, "Отчёт по выгрузке из 1С"),
      h("p", {}, "Загрузите список сотрудников из 1С в формате Excel (.xlsx) или CSV. Приложение посчитает текучесть (общую, добровольную, раннюю), численность, стаж, разбивку по подразделениям и месяцам, а если есть оклады — разброс зарплат по должностям."),
      h("div", { class: "notice" }, h("b", {}, "Персональные данные не покидают компьютер. "), "Файл обрабатывается прямо в браузере и никуда не сохраняется. В ИИ для выводов отправляются только итоговые цифры без ФИО."),
      h("details", {},
        h("summary", {}, "Как выгрузить данные из 1С:ЗУП"),
        h("ol", { class: "hint-list" },
          h("li", {}, "Откройте раздел «Кадры» → «Кадровые отчёты» → «Списки сотрудников» (или универсальный отчёт по сотрудникам)."),
          h("li", {}, "В настройках отчёта включите уволенных сотрудников и задайте период."),
          h("li", {}, "Добавьте колонки: Сотрудник, Подразделение, Должность, Дата приёма, Дата увольнения, Основание увольнения (статья ТК РФ), при желании — Оклад."),
          h("li", {}, "Сформируйте отчёт и сохраните: «Сохранить как» → «Лист Excel 2007» (.xlsx)."),
          h("li", {}, "Названия меню могут немного отличаться в вашей версии 1С — если не найдёте, попросите выгрузку у бухгалтерии или администратора 1С."),
        ),
      ),
      field("1. Файл выгрузки", fileInput),
    ),
    mapBox,
    out,
  );
}
