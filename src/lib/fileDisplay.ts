export function formatFileSize(value?: number) {
  if (!value || value <= 0) return "";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

export function fileExtensionFromName(name?: string) {
  const extension = name?.split(".").pop()?.trim();
  if (!extension || extension === name) return "FILE";
  return extension.slice(0, 4).toUpperCase();
}

export function fileKindLabel(mimeType?: string, name?: string) {
  const lowerMime = mimeType?.toLowerCase() ?? "";
  const lowerName = name?.toLowerCase() ?? "";
  if (lowerMime.includes("spreadsheet") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".csv")) return "表格";
  if (lowerMime.includes("pdf") || lowerName.endsWith(".pdf")) return "PDF";
  if (lowerMime.includes("word") || lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) return "文档";
  if (lowerMime.includes("presentation") || lowerName.endsWith(".pptx") || lowerName.endsWith(".ppt")) return "演示";
  if (lowerMime.startsWith("image/")) return "图片";
  if (lowerMime.startsWith("text/") || lowerName.endsWith(".md") || lowerName.endsWith(".txt")) return "文本";
  return fileExtensionFromName(name);
}

