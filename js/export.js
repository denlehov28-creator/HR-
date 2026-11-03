// Экспорт Markdown-текста в настоящий .docx (Word).
// Оформление по типовым требованиям делопроизводства: Times New Roman 14 пт,
// поля: левое 30 мм, правое 15 мм, верхнее и нижнее 20 мм, абзацный отступ 1,25 см.

import { marked } from "../vendor/marked.js";

const D = () => window.docx;
const MM = 56.7; // twips в 1 мм

function inlineRuns(tokens, style = {}) {
  const { TextRun } = D();
  const runs = [];
  for (const t of tokens || []) {
    switch (t.type) {
      case "strong":
        runs.push(...inlineRuns(t.tokens, { ...style, bold: true }));
        break;
      case "em":
        runs.push(...inlineRuns(t.tokens, { ...style, italics: true }));
        break;
      case "codespan":
        runs.push(new TextRun({ text: unescape(t.text), ...style }));
        break;
      case "br":
        runs.push(new TextRun({ text: "", break: 1 }));
        break;
      case "link":
        runs.push(...inlineRuns(t.tokens, { ...style, underline: {} }));
        break;
      case "text":
        if (t.tokens) runs.push(...inlineRuns(t.tokens, style));
        else pushText(runs, t.text, style);
        break;
      default:
        pushText(runs, t.raw || t.text || "", style);
    }
  }
  return runs;
}

function pushText(runs, text, style) {
  const { TextRun } = D();
  const lines = unescape(text).split("\n");
  lines.forEach((line, i) => runs.push(new TextRun({ text: line, ...style, break: i > 0 ? 1 : undefined })));
}

function unescape(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function blocks(tokens, out, level = 0) {
  const { Paragraph, AlignmentType, HeadingLevel, Table, TableRow, TableCell, WidthType } = D();
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const isTitle = t.depth === 1;
        out.push(
          new Paragraph({
            children: inlineRuns(t.tokens, { bold: true, size: isTitle ? 28 : 28 }),
            alignment: isTitle ? AlignmentType.CENTER : AlignmentType.LEFT,
            heading: isTitle ? HeadingLevel.TITLE : undefined,
            spacing: { before: isTitle ? 0 : 240, after: 120 },
            keepNext: true,
          }),
        );
        break;
      }
      case "paragraph":
        out.push(
          new Paragraph({
            children: inlineRuns(t.tokens),
            alignment: AlignmentType.JUSTIFIED,
            indent: { firstLine: Math.round(12.5 * MM) },
            spacing: { after: 120 },
          }),
        );
        break;
      case "list":
        t.items.forEach((item, i) => {
          const marker = t.ordered ? `${(Number(t.start) || 1) + i}. ` : "– ";
          const [first, ...rest] = item.tokens;
          const firstRuns = first && (first.type === "text" || first.type === "paragraph") ? inlineRuns(first.tokens || [first]) : [];
          out.push(
            new Paragraph({
              children: [new (D().TextRun)(marker), ...firstRuns],
              alignment: AlignmentType.JUSTIFIED,
              indent: { left: Math.round((12.5 + level * 10) * MM), hanging: Math.round(6 * MM) },
              spacing: { after: 60 },
            }),
          );
          const restTokens = first && (first.type === "text" || first.type === "paragraph") ? rest : item.tokens;
          blocks(restTokens, out, level + 1);
        });
        break;
      case "blockquote":
        blocks(t.tokens, out, level + 1);
        break;
      case "hr":
        out.push(new Paragraph({ children: [], spacing: { after: 120 } }));
        break;
      case "table": {
        const row = (cells, bold) =>
          new TableRow({
            children: cells.map(
              (c) => new TableCell({ children: [new Paragraph({ children: inlineRuns(c.tokens, bold ? { bold: true } : {}) })] }),
            ),
          });
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [row(t.header, true), ...t.rows.map((r) => row(r, false))],
          }),
        );
        out.push(new Paragraph({ children: [] }));
        break;
      }
      case "space":
        break;
      default:
        if (t.text) out.push(new Paragraph({ children: inlineRuns([{ type: "text", text: t.text }]) }));
    }
  }
  return out;
}

export async function exportDocx(markdownText) {
  const { Document, Packer } = D();
  const tokens = marked.lexer(markdownText || "");
  const children = blocks(tokens, []);
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Times New Roman", size: 28 }, paragraph: { spacing: { line: 276 } } },
        title: { run: { font: "Times New Roman", size: 28, bold: true, color: "000000" } },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 20 * MM, bottom: 20 * MM, left: 30 * MM, right: 15 * MM } },
        },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}
