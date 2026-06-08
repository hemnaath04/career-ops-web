// Parse a resume file (PDF / HTML / Markdown / plain text) to plain text
// suitable for feeding into career-ops's modes/*.md prompts.
//
// Design choices:
//   - PDF parsing via `pdf-parse`. It's old but reliable for typical
//     resume PDFs. If a resume PDF fails, the user can paste markdown
//     into the textarea as a fallback.
//   - HTML parsing is a regex strip — not bulletproof for arbitrary
//     HTML, but resumes-as-HTML are usually clean. No need for cheerio.
//   - MD/TXT: pass-through with whitespace collapse.

import pdfParse from "pdf-parse";

const ALLOWED_EXTS = new Set([
  ".pdf", ".html", ".htm", ".md", ".markdown", ".txt",
]);

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;   // 5 MB
export const ALLOWED_EXT_LIST = [...ALLOWED_EXTS];


export function extensionFromFilename(name) {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "";
  return name.slice(dot).toLowerCase();
}


export function isAllowedExt(ext) {
  return ALLOWED_EXTS.has(ext.toLowerCase());
}


/**
 * Defensive magic-byte sniff. The filename's extension is user-controlled,
 * so we double-check the content matches what the extension claims for
 * the formats that have an obvious signature (just PDF here).
 *
 * For text-based formats we ensure the buffer decodes cleanly as UTF-8
 * with no NUL bytes — catches "binary file renamed .md to bypass us".
 */
export function looksLegit(ext, buf) {
  if (ext === ".pdf") {
    return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 &&
           buf[2] === 0x44 && buf[3] === 0x46; // %PDF
  }
  // Text-ish formats: must decode as UTF-8 and contain no NUL bytes.
  if (buf.indexOf(0) !== -1) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}


function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


/**
 * Parse a resume buffer into plain text.
 * @param {string} ext       File extension including the leading dot (".pdf", ".md", ...)
 * @param {Buffer} buf       File contents
 * @returns {Promise<string>} Plain text
 */
export async function parseResume(ext, buf) {
  switch (ext.toLowerCase()) {
    case ".pdf": {
      const data = await pdfParse(buf);
      const text = (data.text || "").trim();
      if (!text) throw new Error("PDF parsed to empty text — try exporting your resume differently");
      return text;
    }
    case ".html":
    case ".htm":
      return htmlToText(buf.toString("utf8"));
    case ".md":
    case ".markdown":
    case ".txt":
      return buf.toString("utf8").trim();
    default:
      throw new Error(`Unsupported extension: ${ext}`);
  }
}
