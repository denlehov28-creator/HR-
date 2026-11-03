// HR-метрики: калькуляторы, которые превращают HR-задачи в цифры и деньги.
// Работают без ИИ и без интернета.

import * as store from "./store.js";
import { h, field, toast } from "./ui.js";

const fmt = (n, d = 0) =>
  Number.isFinite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: 0 }) : "—";
const rub = (n) => (Number.isFinite(n) ? `${fmt(Math.round(n))} ₽` : "—");

function calc({ id, title, desc, inputs, compute, explain }) {
  const values = {};
  const out = h("div", { class: "metric-out" });
  let lastSummary = "";
  const update = () => {
    for (const i of inputs) values[i.key] = Number(String(form.elements[i.key].value).replace(",", ".")) || 0;
    const res = compute(values);
    out.replaceChildren(
      ...res.rows.map(([label, value, tone]) => h("div", { class: `metric-row ${tone || ""}` }, h("span", {}, label), h("b", {}, value))),
      res.comment && h("p", { class: "hint" }, res.comment),
    );
    lastSummary = `${title}: ${res.rows.map(([l, v]) => `${l} — ${v}`).join("; ")}. Исходные данные: ${inputs.map((i) => `${i.label} — ${values[i.key]}`).join("; ")}.`;
  };
  const form = h("form", { class: "grid-2", oninput: update, onsubmit: (e) => e.preventDefault() },
    ...inputs.map((i) => field(i.label, h("input", { name: i.key, type: "number", step: "any", min: 0, value: i.value }), i.hint)),
  );
  const card = h("section", { class: "card metric", id },
    h("h2", {}, title),
    h("p", { class: "muted" }, desc),
    form,
    out,
    explain && h("details", {}, h("summary", {}, "Как считается и с чем сравнивать"), h("div", { class: "hint" }, explain)),
    h("div", { class: "row" },
      h("button", {
        class: "btn",
        type: "button",
        onclick: async () => {
          const facts = await store.get("proposal-facts", []);
          facts.push(lastSummary);
          await store.set("proposal-facts", facts.slice(-10));
          toast("Цифры добавлены в «Предложение руководителю»");
        },
      }, "Перенести в предложение руководителю"),
    ),
  );
  update();
  return card;
}

export async function render(root) {
  root.append(
    h("div", { class: "page-head" },
      h("h1", {}, "HR-метрики"),
      h("p", { class: "lead" }, "Руководитель принимает решения по цифрам. Посчитайте проблему в деньгах — и предложение станет в разы убедительнее. Расчёты работают без интернета."),
    ),
    h("div", { class: "metrics-grid" },
      calc({
        id: "turnover",
        title: "Текучесть персонала",
        desc: "Какая доля сотрудников уходит за период.",
        inputs: [
          { key: "left", label: "Уволилось за период, чел.", value: 30 },
          { key: "avg", label: "Среднесписочная численность, чел.", value: 200 },
          { key: "months", label: "Длительность периода, мес.", value: 12 },
          { key: "vol", label: "Из них по собственному желанию, чел.", value: 24 },
        ],
        compute: ({ left, avg, months, vol }) => {
          const t = avg ? (left / avg) * 100 : NaN;
          const year = months ? (t * 12) / months : NaN;
          return {
            rows: [
              ["Текучесть за период", `${fmt(t, 1)} %`],
              ["В пересчёте на год", `${fmt(year, 1)} %`, year > 20 ? "bad" : year > 12 ? "mid" : "good"],
              ["Добровольная текучесть", `${fmt(avg ? (vol / avg) * 100 : NaN, 1)} %`],
            ],
            comment: "Ориентиры сильно зависят от отрасли и региона: в офисных функциях обычно считают нормой до 10–15 % в год, в рознице и на линейных позициях — значительно выше. Сравнивайте прежде всего с собой в динамике.",
          };
        },
        explain: "Текучесть = уволившиеся за период ÷ среднесписочная численность × 100 %. В расчёт для «управляемой» текучести обычно берут увольнения по собственному желанию и за нарушения, без сокращений и выхода на пенсию.",
      }),
      calc({
        id: "early",
        title: "Ранняя текучесть (первые 90 дней)",
        desc: "Показывает качество подбора и адаптации.",
        inputs: [
          { key: "hired", label: "Принято за период, чел.", value: 40 },
          { key: "left90", label: "Из них ушли в первые 3 месяца, чел.", value: 9 },
        ],
        compute: ({ hired, left90 }) => {
          const r = hired ? (left90 / hired) * 100 : NaN;
          return {
            rows: [["Ранняя текучесть", `${fmt(r, 1)} %`, r > 20 ? "bad" : r > 10 ? "mid" : "good"]],
            comment: r > 15 ? "Высокий показатель — сигнал проверить, совпадают ли ожидания кандидатов с реальностью, и выстроить программу адаптации с наставником." : "Хороший уровень — зафиксируйте, что работает, и сделайте это стандартом.",
          };
        },
      }),
      calc({
        id: "cost",
        title: "Сколько стоит организации одна замена сотрудника",
        desc: "Самый сильный аргумент для руководителя: текучесть в рублях.",
        inputs: [
          { key: "salary", label: "Средняя зарплата позиции (до вычета НДФЛ), ₽/мес.", value: 70000 },
          { key: "taxes", label: "Страховые взносы работодателя, %", value: 30, hint: "Уточните ставку у бухгалтерии" },
          { key: "recruit", label: "Прямые затраты на подбор (сайты, агентство), ₽", value: 15000 },
          { key: "hrHours", label: "Часы HR и руководителя на подбор и оформление", value: 25 },
          { key: "vacancyDays", label: "Сколько дней позиция пустует", value: 30 },
          { key: "rampMonths", label: "Месяцев до полной продуктивности новичка", value: 3 },
          { key: "leavers", label: "Увольнений в год на таких позициях, чел.", value: 20 },
        ],
        compute: ({ salary, taxes, recruit, hrHours, vacancyDays, rampMonths, leavers }) => {
          const monthly = salary * (1 + taxes / 100);
          const hour = monthly / 165;
          const time = hrHours * hour * 1.5; // время HR и руководителя дороже среднего
          const vacancy = (vacancyDays / 30) * monthly * 0.5; // потери на вакансии: половина ценности работы
          const ramp = rampMonths * monthly * 0.5; // в среднем 50 % продуктивности в период адаптации
          const one = recruit + time + vacancy + ramp;
          return {
            rows: [
              ["Подбор и оформление", rub(recruit + time)],
              ["Потери, пока позиция пустует", rub(vacancy)],
              ["Потери в период адаптации", rub(ramp)],
              ["Одна замена — итого", rub(one), "bad"],
              ["Все замены за год", rub(one * leavers), "bad"],
              ["Экономия, если снизить текучесть на 20 %", rub(one * leavers * 0.2), "good"],
            ],
            comment: "Это консервативная оценка: в ней нет потерь от ошибок новичков, перегрузки коллег и ухода клиентов. Допущения (50 % продуктивности при адаптации и на вакансии) лучше согласовать с руководителем заранее.",
          };
        },
      }),
      calc({
        id: "enps",
        title: "eNPS — индекс лояльности сотрудников",
        desc: "Вопрос: «Насколько вероятно, что вы порекомендуете нашу организацию как место работы друзьям?» (0–10).",
        inputs: [
          { key: "prom", label: "Ответили 9–10 (промоутеры)", value: 45 },
          { key: "pass", label: "Ответили 7–8 (нейтралы)", value: 35 },
          { key: "det", label: "Ответили 0–6 (критики)", value: 20 },
          { key: "staff", label: "Всего сотрудников", value: 150, hint: "Для расчёта охвата опроса" },
        ],
        compute: ({ prom, pass, det, staff }) => {
          const n = prom + pass + det;
          const e = n ? ((prom - det) / n) * 100 : NaN;
          const cov = staff ? (n / staff) * 100 : NaN;
          return {
            rows: [
              ["eNPS", fmt(e, 0), e >= 20 ? "good" : e >= 0 ? "mid" : "bad"],
              ["Ответили", `${fmt(n)} чел. (${fmt(cov, 0)} %)`, cov < 50 ? "mid" : ""],
            ],
            comment: `${e >= 20 ? "Хороший уровень лояльности." : e >= 0 ? "Средний уровень: есть что улучшать." : "Критиков больше, чем сторонников — важно разобраться в причинах."} Обязательно добавляйте открытый вопрос «Что нам изменить в первую очередь?» и делитесь с коллективом итогами и планом действий. Охват ниже 50 % делает результат неустойчивым.`,
          };
        },
      }),
      calc({
        id: "tth",
        title: "Скорость и стоимость найма",
        desc: "Time to hire и cost per hire.",
        inputs: [
          { key: "days", label: "Сумма дней от открытия до выхода по всем вакансиям", value: 420 },
          { key: "closed", label: "Закрыто вакансий", value: 12 },
          { key: "budget", label: "Расходы на подбор за период, ₽", value: 180000 },
        ],
        compute: ({ days, closed, budget }) => ({
          rows: [
            ["Среднее время закрытия", `${fmt(closed ? days / closed : NaN, 0)} дн.`],
            ["Стоимость одного найма", rub(closed ? budget / closed : NaN)],
          ],
          comment: "Отслеживайте по группам должностей: массовые, специалисты, руководители — у них разные нормы.",
        }),
      }),
      calc({
        id: "absent",
        title: "Абсентеизм (отсутствия)",
        desc: "Доля рабочего времени, потерянная из-за больничных и неявок.",
        inputs: [
          { key: "lost", label: "Пропущено рабочих дней (больничные, прогулы)", value: 900 },
          { key: "staff", label: "Среднесписочная численность", value: 200 },
          { key: "workdays", label: "Рабочих дней в периоде", value: 247 },
        ],
        compute: ({ lost, staff, workdays }) => {
          const r = staff && workdays ? (lost / (staff * workdays)) * 100 : NaN;
          return {
            rows: [
              ["Уровень отсутствий", `${fmt(r, 1)} %`, r > 4 ? "bad" : r > 2.5 ? "mid" : "good"],
              ["Дней на сотрудника", fmt(staff ? lost / staff : NaN, 1)],
            ],
            comment: "Рост показателя часто связан с выгоранием и перегрузкой — повод подумать о программе благополучия (wellbeing).",
          };
        },
      }),
      calc({
        id: "roi",
        title: "Окупаемость HR-инициативы (ROI)",
        desc: "Сколько рублей возвращает каждый вложенный рубль.",
        inputs: [
          { key: "benefit", label: "Ожидаемая выгода за год, ₽", value: 900000, hint: "Например, экономия из расчёта стоимости замены" },
          { key: "cost", label: "Затраты на инициативу за год, ₽", value: 250000 },
        ],
        compute: ({ benefit, cost }) => {
          const roi = cost ? ((benefit - cost) / cost) * 100 : NaN;
          return {
            rows: [
              ["ROI", `${fmt(roi, 0)} %`, roi > 0 ? "good" : "bad"],
              ["Чистый эффект", rub(benefit - cost)],
              ["Срок окупаемости", `${fmt(benefit ? (cost / benefit) * 12 : NaN, 1)} мес.`],
            ],
          };
        },
      }),
    ),
  );
}
