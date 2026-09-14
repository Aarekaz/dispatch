import {
  File,
  FileText,
  FileCode,
  BracketsCurly,
  FileXls,
  Image,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

/**
 * File-type icon mapping. Uses Lucide icons with neutral styling —
 * no color-coding per type (keeps the file tree calm and consistent
 * with the Linear/Vercel aesthetic).
 *
 * Extensions grouped by semantic category rather than language tribe:
 *   • text/docs      → FileText
 *   • code           → FileCode
 *   • structured     → FileJson
 *   • tabular        → FileSpreadsheet
 *   • images         → Image
 *   • default        → File
 */
const CATEGORY: Record<string, PhosphorIcon> = {
  // Text / docs
  md: FileText,
  mdx: FileText,
  txt: FileText,
  rtf: FileText,
  // Code
  js: FileCode,
  jsx: FileCode,
  ts: FileCode,
  tsx: FileCode,
  py: FileCode,
  rb: FileCode,
  go: FileCode,
  rs: FileCode,
  java: FileCode,
  kt: FileCode,
  swift: FileCode,
  html: FileCode,
  css: FileCode,
  scss: FileCode,
  sh: FileCode,
  bash: FileCode,
  sql: FileCode,
  // Structured data
  json: BracketsCurly,
  yaml: BracketsCurly,
  yml: BracketsCurly,
  toml: BracketsCurly,
  xml: BracketsCurly,
  // Tabular
  csv: FileXls,
  tsv: FileXls,
  xlsx: FileXls,
  // Images
  png: Image,
  jpg: Image,
  jpeg: Image,
  gif: Image,
  svg: Image,
  webp: Image,
};

/**
 * Human-readable label per extension. Falls back to the uppercase
 * extension, or "File" if no extension.
 */
const LABEL: Record<string, string> = {
  md: "Markdown",
  mdx: "MDX",
  txt: "Text",
  js: "JavaScript",
  ts: "TypeScript",
  jsx: "React",
  tsx: "React TS",
  py: "Python",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  csv: "CSV",
  html: "HTML",
  css: "CSS",
  sh: "Shell",
  sql: "SQL",
};

export function getFileIcon(name: string): PhosphorIcon {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return CATEGORY[ext] ?? File;
}

export function getFileLabel(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return LABEL[ext] ?? (ext ? ext.toUpperCase() : "File");
}

/**
 * Known binary extensions — editing these as text would corrupt them.
 * Unknown extensions are assumed to be text (better to let users try
 * than to block them on a false positive).
 */
const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "pdf",
  "zip",
  "tar",
  "gz",
  "rar",
  "7z",
  "mp3",
  "mp4",
  "mov",
  "avi",
  "wav",
  "ogg",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "exe",
  "dll",
  "bin",
  "so",
  "dylib",
]);

export function isEditableAsText(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return !BINARY_EXTENSIONS.has(ext);
}
