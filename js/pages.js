// Главная, «Мои материалы» и «Настройки».

import * as store from "./store.js";
import * as ai from "./ai.js";
import { loadBrand } from "./brand.js";
import { h, md, field, select, toast, copyText, plain, download } from "./ui.js";
import { exportDocx } from "./export.js";
import { icon } from "./icons.js";

const KIND_LABEL = {
  document: "Документ",
  edit: "Редактура",
  speech: "Выступление",
  proposal: "Предложение",
  mentor: "Совет наставника",
  "image-prompt": "Промпт для фона",
  slides: "Презентация",
  strategy: "Стратегия",
  process: "Процесс",
  "hr-process": "HR-документ",
  assistant: "Помощник",
  report: "HR-отчёт",
  "voice-check": "Проверка тона",
};

// ---------- Главная ----------

export async function home(root) {
  const brand = await loadBrand();
  const hasKey = await ai.hasKey();
  const tile = (href, ic, title, text) => h("a", { class: "tile", href }, h("span", { class: "tile-icon" }, icon(ic)), h("b", {}, title), h("span", {}, text));

  const steps = [
    [hasKey, "Подключить ИИ (ключ API)", "#/settings"],
    [brand.logos.length > 0, "Загрузить оригиналы логотипов", "#/brand"],
    [Boolean(brand.orgName && brand.tone), "Заполнить организацию и тон коммуникаций", "#/brand"],
    [Object.values(await store.get("roadmap", {})).some(Boolean), "Пройти диагностику «Карта развития HR»", "#/roadmap"],
  ];
  const done = steps.filter((s) => s[0]).length;

  root.append(
    h("div", { class: "page-head" },
      h("h1", {}, brand.orgName ? `HR-ассистент: ${brand.orgName}` : "HR-ассистент"),
      h("p", { class: "lead" }, "Визуалы по брендбуку, деловые документы, выступления и опытный HR-наставник — в одном месте."),
    ),
    done === steps.length ? "" : h("section", { class: "card" },
      h("h2", {}, `Первые шаги: ${done} из ${steps.length}`),
      h("ol", { class: "steps" }, steps.map(([ok, text, href]) => h("li", { class: ok ? "done" : "" }, h("a", { href }, text)))),
    ),
    h("div", { class: "tiles" },
      tile("#/design", "design", "Дизайн-студия", "Поздравления, вакансии, анонсы — по брендбуку, логотип без изменений"),
      tile("#/docs", "docs", "Документы", "Приказы, письма, положения, уведомления в деловом стиле + Word"),
      tile("#/speech", "speech", "Выступления", "Текст под время, карточки, вопросы из зала, суфлёр"),
      tile("#/slides", "slides", "Презентации", "Слайды в фирменном стиле из выступления или предложения, показ и PDF"),
      tile("#/mentor", "mentor", "HR-наставник", "Стратегия на год, процессы и советы под условия и правила вашей организации"),
      tile("#/assistant", "assistant", "Помощник", "Письма коллегам, проверка грамотности текста и картинок"),
      tile("#/proposal", "proposal", "Предложение руководителю", "Записка на одну страницу с цифрами и ответами на возражения"),
      tile("#/metrics", "metrics", "HR-метрики и отчёты", "Отчёты по выгрузке из 1С, текучесть, стоимость замены, зарплаты, eNPS"),
      tile("#/roadmap", "roadmap", "Карта развития HR", "Самодиагностика и приоритеты на полгода"),
      tile("#/library", "library", "Мои материалы", "Всё сохранённое: документы, выступления, советы"),
    ),
    h("section", { class: "card rules" },
      h("h2", {}, "Важно знать"),
      h("ul", {},
        h("li", {}, h("b", {}, "Логотип не перерисовывается. "), "Он хранится как оригинальный файл и накладывается на макет без изменений — нейросеть его никогда не видит."),
        h("li", {}, h("b", {}, "Персональные данные. "), "Не вставляйте в запросы паспортные данные, СНИЛС, сведения о здоровье и зарплаты конкретных людей — используйте [ФИО], [должность]. Тексты отправляются для обработки в выбранный ИИ-сервис: Anthropic (за рубежом) или GigaChat / YandexGPT (в России) — 152-ФЗ."),
        h("li", {}, h("b", {}, "Юридическая проверка. "), "ИИ помогает с формулировками, но статьи ТК РФ и сроки в юридически значимых документах сверяйте с КонсультантПлюс / Гарант или юристом."),
        h("li", {}, h("b", {}, "Данные хранятся только в этом браузере. "), "Делайте резервную копию в «Настройках», чтобы не потерять бренд-кит и материалы."),
      ),
    ),
  );
}

// ---------- Мои материалы ----------

export async function libraryPage(root) {
  let items = await store.library();
  let filter = "all";
  let q = "";
  const list = h("div", { class: "lib-list" });
  const viewer = h("div");

  const draw = () => {
    const shown = items.filter((i) => (filter === "all" || i.kind === filter) && (!q || `${i.title} ${i.text}`.toLowerCase().includes(q)));
    list.replaceChildren(
      ...(shown.length
        ? shown.map((i) =>
          h("article", { class: "lib-item" },
            h("div", { class: "lib-meta" }, h("span", { class: "badge" }, KIND_LABEL[i.kind] || i.kind), h("time", {}, new Date(i.createdAt).toLocaleString("ru-RU"))),
            h("h3", {}, i.title),
            h("p", { class: "muted" }, plain(i.text).slice(0, 180), "…"),
            h("div", { class: "row" },
              h("button", { class: "btn", type: "button", onclick: () => open(i) }, "Открыть"),
              h("button", { class: "btn", type: "button", onclick: () => copyText(plain(i.text)) }, "Копировать"),
              h("button", { class: "btn", type: "button", onclick: async () => download(`${i.title.slice(0, 80).replace(/[\\/:*?"<>|]+/g, "")}.docx`, await exportDocx(i.text)) }, "Word"),
              h("button", {
                class: "btn btn-ghost btn-danger",
                type: "button",
                onclick: async () => {
                  if (!confirm("Удалить материал?")) return;
                  await store.removeFromLibrary(i.id);
                  items = await store.library();
                  draw();
                },
              }, "Удалить"),
            ),
          ),
        )
        : [h("p", { class: "muted" }, items.length ? "Ничего не найдено." : "Здесь появятся сохранённые документы, выступления и советы.")]),
    );
  };
  const open = (i) => {
    viewer.replaceChildren(
      h("section", { class: "card" },
        h("div", { class: "result-head" }, h("h2", {}, i.title), h("button", { class: "btn btn-ghost", type: "button", onclick: () => viewer.replaceChildren() }, "Закрыть")),
        h("div", { class: "md", html: md(i.text) }),
        i.notes && h("div", { class: "result-notes md", html: `<div class="notes-title">Подсказки</div>${md(i.notes)}` }),
      ),
    );
    viewer.scrollIntoView({ behavior: "smooth" });
  };

  const kindSel = select("kind", [["all", "Все материалы"], ...Object.entries(KIND_LABEL)], "all");
  kindSel.addEventListener("change", () => {
    filter = kindSel.value;
    draw();
  });
  const search = h("input", { type: "search", placeholder: "Поиск…", oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } });

  root.append(
    h("div", { class: "page-head" }, h("h1", {}, "Мои материалы"), h("p", { class: "lead" }, "Всё, что вы сохранили. Хорошие документы можно использовать как образцы.")),
    h("div", { class: "row toolbar" }, kindSel, search),
    viewer,
    list,
  );
  draw();
}

// ---------- Настройки ----------

function bufToB64(buf) {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBuf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export async function settingsPage(root) {
  const s = await ai.settings();
  const keyInput = h("input", { type: "password", value: s.apiKey, placeholder: "sk-ant-…", autocomplete: "off" });
  const oaKey = h("input", { type: "password", value: s.openaiKey || "", placeholder: "sk-…", autocomplete: "off" });
  const oaModel = h("input", { type: "text", value: s.openaiModel || "gpt-image-1" });
  const fbKey = h("input", { type: "password", value: s.fbKey || "", autocomplete: "off" });
  const fbSecret = h("input", { type: "password", value: s.fbSecret || "", autocomplete: "off" });
  const modelSel = select("model", ai.MODELS.map((m) => [m.id, m.label]), s.model);
  const effortSel = select("effort", [["low", "Быстро — для простых текстов"], ["medium", "Сбалансированно (рекомендуется)"], ["high", "Тщательно — дольше и дороже"]], s.effort);
  const status = h("span", { class: "hint" });
  const providerSel = select("provider", Object.entries(ai.PROVIDERS), s.provider);
  const proxyUrl = h("input", { type: "text", value: s.proxyUrl || "", placeholder: "https://functions.yandexcloud.net/…", autocomplete: "off" });
  const proxyPass = h("input", { type: "password", value: s.proxyPassword || "", autocomplete: "off" });
  const gigaSel = select("gigaModel", ai.GIGA_MODELS, s.gigaModel);
  const yaSel = select("yandexModel", ai.YANDEX_MODELS, s.yandexModel);

  const save = async () => {
    await store.set("settings", {
      provider: providerSel.value,
      proxyUrl: proxyUrl.value.trim(), proxyPassword: proxyPass.value,
      gigaModel: gigaSel.value, yandexModel: yaSel.value,
      apiKey: keyInput.value.trim(), model: modelSel.value, effort: effortSel.value,
      openaiKey: oaKey.value.trim(), openaiModel: oaModel.value.trim() || "gpt-image-1",
      fbKey: fbKey.value.trim(), fbSecret: fbSecret.value.trim(),
    });
  };

  const importInput = h("input", {
    type: "file",
    accept: "application/json",
    onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (data.app !== "hr-assistant") throw new Error("Это не резервная копия HR-ассистента");
        if (!confirm("Восстановить данные из копии? Текущие данные будут заменены.")) return;
        const entries = data.entries || {};
        const ff = entries.brand?.fontFiles;
        if (ff) for (const k of Object.keys(ff)) if (ff[k]?.data) ff[k].data = b64ToBuf(ff[k].data);
        const keep = await store.get("settings", {});
        await store.clearAll();
        for (const [k, v] of Object.entries(entries)) await store.set(k, v);
        await store.set("settings", keep);
        toast("Данные восстановлены");
        setTimeout(() => location.reload(), 600);
      } catch (err) {
        toast(err.message, "error");
      }
    },
  });

  let ruBox;
  let ruStatus;
  let claudeBox;
  const check = async (el) => {
    await save();
    el.textContent = "Проверяю…";
    el.className = "hint";
    try {
      await ai.ping();
      el.textContent = "Подключение работает";
      el.className = "ok";
    } catch (e) {
      el.textContent = e.message;
      el.className = "warn";
    }
  };
  root.append(
    h("div", { class: "page-head" }, h("h1", {}, "Настройки")),
    h("section", { class: "card stack" },
      h("h2", {}, "Какой ИИ использовать"),
      field("Нейросеть", providerSel, "Можно переключать в любой момент: все разделы работают с любой из трёх."),
      (ruBox = h("div", { class: "stack" },
        h("h3", {}, "Сервер-посредник (для GigaChat и YandexGPT)"),
        h("p", { class: "hint" }, "Ключи GigaChat, YandexGPT и Kandinsky хранятся на вашем сервере в Яндекс Облаке, а не в браузере. Как его создать — в инструкции «Подключение российских нейросетей» (файл ", h("a", { href: "https://github.com/denlehov28-creator/HR-/blob/hr-assistant-app/server/yandex-function/ИНСТРУКЦИЯ.md", target: "_blank", rel: "noopener" }, "ИНСТРУКЦИЯ.md"), ")."),
        h("div", { class: "grid-2" }, field("Адрес функции", proxyUrl), field("Пароль приложения (APP_PASSWORD)", proxyPass)),
        h("div", { class: "grid-2" }, field("Модель GigaChat", gigaSel), field("Модель YandexGPT", yaSel)),
        h("p", { class: "hint" }, "Российские модели получают файлы текстом: PDF и Word читаются прямо в браузере, а текст с картинок распознаётся сервисом Яндекса (Vision OCR). Ответы приходят целиком, без постепенного вывода."),
        h("div", { class: "row" },
          h("button", { class: "btn btn-primary", type: "button", onclick: async () => { await save(); toast("Сохранено"); } }, "Сохранить"),
          h("button", { class: "btn", type: "button", onclick: () => check(ruStatus) }, "Проверить подключение"),
          (ruStatus = h("span", { class: "hint" })),
        ),
      )),
    ),
    (claudeBox = h("section", { class: "card stack" },
      h("h2", {}, "Подключение Claude (Anthropic)"),
      h("ol", { class: "hint-list" },
        h("li", {}, "Зарегистрируйтесь в консоли Anthropic: ", h("a", { href: "https://console.anthropic.com/", target: "_blank", rel: "noopener" }, "console.anthropic.com")),
        h("li", {}, "Пополните баланс (оплата за фактическое использование; документ или выступление обычно стоит несколько рублей)."),
        h("li", {}, "В разделе API Keys создайте ключ и вставьте его сюда."),
      ),
      h("div", { class: "notice" }, "Ключ хранится только в этом браузере и отправляется только в Anthropic. Не используйте приложение с этим ключом на чужих компьютерах. Перед использованием уточните в службе безопасности/ИТ, разрешено ли отправлять рабочие тексты во внешние ИИ-сервисы."),
      field("Ключ API", keyInput),
      h("div", { class: "grid-2" }, field("Модель", modelSel), field("Режим", effortSel)),
      h("div", { class: "row" },
        h("button", { class: "btn btn-primary", type: "button", onclick: async () => { await save(); toast("Сохранено"); } }, "Сохранить"),
        h("button", {
          class: "btn",
          type: "button",
          onclick: async () => {
            await save();
            status.textContent = "Проверяю…";
            try {
              await ai.ping();
              status.textContent = "Подключение работает";
              status.className = "ok";
            } catch (e) {
              status.textContent = e.message;
              status.className = "warn";
            }
          },
        }, "Проверить подключение"),
        status,
      ),
    )),
    h("section", { class: "card stack" },
      h("h2", {}, "Генераторы изображений (по желанию)"),
      h("p", { class: "hint" }, "Нужны для иллюстраций в дизайн-студии. Векторные иллюстрации от Claude работают без дополнительных ключей. В генераторы отправляется только текстовое описание картинки — логотип и данные бренд-кита не отправляются."),
      h("h3", {}, "Kandinsky (Сбер)"),
      h("ol", { class: "hint-list" },
        h("li", {}, "Зарегистрируйтесь на ", h("a", { href: "https://fusionbrain.ai/", target: "_blank", rel: "noopener" }, "fusionbrain.ai"), " и откройте раздел API."),
        h("li", {}, "Создайте ключ: сервис выдаст API-ключ и секретный ключ — вставьте оба."),
      ),
      h("div", { class: "grid-2" }, field("API-ключ FusionBrain", fbKey), field("Секретный ключ", fbSecret)),
      h("h3", {}, "GPT Image (OpenAI)"),
      h("p", { class: "hint" }, "Ключ создаётся на platform.openai.com → API keys. Сервис доступен не во всех странах — проверьте условия использования."),
      h("div", { class: "grid-2" }, field("Ключ OpenAI", oaKey), field("Модель", oaModel, "По умолчанию gpt-image-1")),
      h("button", { class: "btn btn-primary", type: "button", onclick: async () => { await save(); toast("Сохранено"); } }, "Сохранить ключи"),
    ),
    h("section", { class: "card stack" },
      h("h2", {}, "Резервная копия"),
      h("p", {}, "Все данные хранятся в этом браузере. Сохраните копию (бренд-кит с логотипами, материалы, история наставника), чтобы перенести на другой компьютер или не потерять при очистке браузера. Ключ API в копию не попадает."),
      h("div", { class: "row" },
        h("button", {
          class: "btn btn-primary",
          type: "button",
          onclick: async () => {
            const entries = await store.allEntries();
            delete entries.settings;
            const brand = entries.brand ? structuredClone(entries.brand) : null;
            if (brand?.fontFiles) for (const k of Object.keys(brand.fontFiles)) if (brand.fontFiles[k]?.data) brand.fontFiles[k].data = bufToB64(brand.fontFiles[k].data);
            if (brand) entries.brand = brand;
            download(`hr-assistant-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "hr-assistant", version: 1, entries }), "application/json");
          },
        }, "Скачать резервную копию"),
        h("label", { class: "file-label btn" }, "Восстановить из копии ", importInput),
      ),
    ),
    h("section", { class: "card stack" },
      h("h2", {}, "Удаление данных"),
      h("button", {
        class: "btn btn-danger",
        type: "button",
        onclick: async () => {
          if (!confirm("Удалить ВСЕ данные приложения в этом браузере, включая ключ и бренд-кит?")) return;
          await store.clearAll();
          location.reload();
        },
      }, "Удалить все данные"),
    ),
  );
  const syncProvider = () => {
    const ru = providerSel.value !== "claude";
    ruBox.hidden = !ru;
    claudeBox.hidden = ru;
  };
  providerSel.addEventListener("change", async () => {
    syncProvider();
    await save();
  });
  syncProvider();
}
