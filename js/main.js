// Навигация между разделами (через #/адрес) и запуск приложения.

import { h, toast } from "./ui.js";
import * as brand from "./brand.js";
import * as design from "./design.js";
import * as docs from "./docs.js";
import * as speech from "./speech.js";
import * as mentor from "./mentor.js";
import * as proposal from "./proposal.js";
import * as metrics from "./metrics.js";
import * as roadmap from "./roadmap.js";
import { home, libraryPage, settingsPage } from "./pages.js";

const ROUTES = {
  "": ["Главная", "🏠", home],
  design: ["Дизайн-студия", "🎨", design.render],
  docs: ["Документы", "📄", docs.render],
  speech: ["Выступления", "🎤", speech.render],
  mentor: ["HR-наставник", "🧭", mentor.render],
  proposal: ["Предложение руководителю", "📈", proposal.render],
  metrics: ["HR-метрики", "🧮", metrics.render],
  roadmap: ["Карта развития HR", "🗺️", roadmap.render],
  library: ["Мои материалы", "🗂️", libraryPage],
  brand: ["Бренд-кит", "🏷️", brand.render],
  settings: ["Настройки", "⚙️", settingsPage],
};

const nav = document.getElementById("nav");
const main = document.getElementById("main");

function buildNav() {
  nav.replaceChildren(
    ...Object.entries(ROUTES).map(([key, [label, icon]]) =>
      h("a", { href: `#/${key}`, "data-route": key }, h("span", { class: "nav-icon", "aria-hidden": "true" }, icon), h("span", {}, label)),
    ),
  );
}

async function route() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const key = ROUTES[path] ? path : "";
  const params = Object.fromEntries(new URLSearchParams(query));
  for (const a of nav.querySelectorAll("a")) a.classList.toggle("active", a.dataset.route === key);
  document.body.classList.remove("nav-open");
  const [label, , renderFn] = ROUTES[key];
  document.title = key ? `${label} · HR-ассистент` : "HR-ассистент";
  const page = h("div", { class: "page" });
  main.replaceChildren(page);
  window.scrollTo(0, 0);
  try {
    await renderFn(page, params);
  } catch (e) {
    console.error(e);
    page.append(h("div", { class: "notice notice-strong" }, `Ошибка при открытии раздела: ${e.message}`));
  }
}

document.getElementById("menu-btn").addEventListener("click", () => document.body.classList.toggle("nav-open"));
window.addEventListener("hashchange", route);
window.addEventListener("unhandledrejection", (e) => toast(e.reason?.message || String(e.reason), "error"));

// Тема: светлая / тёмная
const themeBtn = document.getElementById("theme-btn");
const applyTheme = (t) => {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
};
try {
  applyTheme(localStorage.getItem("theme"));
} catch {
  /* приватный режим */
}
themeBtn.addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const next = dark ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("theme", next);
  } catch {
    /* ignore */
  }
});

buildNav();
route();
