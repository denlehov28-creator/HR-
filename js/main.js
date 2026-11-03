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
import * as slides from "./slides.js";
import * as assistant from "./assistant.js";
import { home, libraryPage, settingsPage } from "./pages.js";
import { icon } from "./icons.js";

const ROUTES = {
  "": ["Главная", "home", home],
  design: ["Дизайн-студия", "design", design.render],
  docs: ["Документы", "docs", docs.render],
  speech: ["Выступления", "speech", speech.render],
  slides: ["Презентации", "slides", slides.render],
  mentor: ["HR-наставник", "mentor", mentor.render],
  assistant: ["Помощник", "assistant", assistant.render],
  proposal: ["Предложение руководителю", "proposal", proposal.render],
  metrics: ["HR-метрики", "metrics", metrics.render],
  roadmap: ["Карта развития HR", "roadmap", roadmap.render],
  library: ["Мои материалы", "library", libraryPage],
  brand: ["Бренд-кит", "brand", brand.render],
  settings: ["Настройки", "settings", settingsPage],
};

const nav = document.getElementById("nav");
const main = document.getElementById("main");

function buildNav() {
  nav.replaceChildren(
    ...Object.entries(ROUTES).map(([key, [label, ic]]) =>
      h("a", { href: `#/${key}`, "data-route": key }, icon(ic), h("span", {}, label)),
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
