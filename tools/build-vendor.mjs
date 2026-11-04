// Собирает сторонние библиотеки в папку vendor/, чтобы приложение работало
// без сборки и без CDN (например, на GitHub Pages или просто из папки).
import { build } from "esbuild";
import { copyFileSync } from "node:fs";

// docx уже поставляется с браузерной сборкой (глобальная переменная window.docx).
copyFileSync("node_modules/docx/dist/index.iife.js", "vendor/docx.js");
console.log("vendor/docx.js");
// pdf.js — извлечение текста из PDF прямо в браузере (для российских моделей)
copyFileSync("node_modules/pdfjs-dist/build/pdf.min.mjs", "vendor/pdf.mjs");
copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "vendor/pdf.worker.mjs");
// mammoth — текст из .docx (положения и приказы обычно в Word)
copyFileSync("node_modules/mammoth/mammoth.browser.min.js", "vendor/mammoth.js");
console.log("vendor/pdf.mjs, vendor/pdf.worker.mjs, vendor/mammoth.js");

const entries = {
  anthropic: `export { default } from "@anthropic-ai/sdk";`,
  marked: `export { marked } from "marked";`,
  purify: `export { default } from "dompurify";`,
  excel: `export { readSheet } from "read-excel-file/browser";`,
};

for (const [name, contents] of Object.entries(entries)) {
  await build({
    stdin: { contents, resolveDir: process.cwd(), loader: "js" },
    bundle: true,
    format: "esm",
    platform: "browser",
    minify: true,
    target: "es2020",
    outfile: `vendor/${name}.js`,
    logLevel: "warning",
  });
  console.log(`vendor/${name}.js`);
}
