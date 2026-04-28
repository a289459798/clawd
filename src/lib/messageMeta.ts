export function parseSenderMeta(text: string): { label?: string; time?: string; cleanText: string } {
  let label: string | undefined;
  let time: string | undefined;
  let cleanText = text;

  const timeRegex = /\[([A-Za-z]+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*GMT[+-]\d+)\]\s*\n?/;
  const timeMatch = cleanText.match(timeRegex);
  if (timeMatch) {
    const raw = timeMatch[1];
    time = raw.replace(/\s*GMT[+-]\d+/, "").replace(/^([A-Za-z]+\s+)(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})$/, "$2");
    cleanText = cleanText.replace(timeRegex, "");
  }

  const metaRegex = /Sender\s+\(untrusted\s+metadata\):\s*\n\s*```json\n([\s\S]*?)\n\s*```\n?/;
  const match = cleanText.match(metaRegex);
  if (match) {
    try {
      const meta = JSON.parse(match[1]);
      label = meta.label ?? meta.id ?? undefined;
      cleanText = cleanText.replace(metaRegex, "").trim();
    } catch {
      cleanText = cleanText.trim();
    }
    return { label, time, cleanText };
  }

  const inlineRegex = /Sender\s+\(untrusted\s+metadata\):\s*\n\s*\{[\s\S]*?\n\s*\}\n?/;
  const inlineMatch = cleanText.match(inlineRegex);
  if (inlineMatch) {
    try {
      const meta = JSON.parse(inlineMatch[0].replace(/^Sender\s+\(untrusted\s+metadata\):\s*\n\s*/, ""));
      label = meta.label ?? meta.id ?? undefined;
      cleanText = cleanText.replace(inlineRegex, "").trim();
    } catch {
      cleanText = cleanText.trim();
    }
    return { label, time, cleanText };
  }

  cleanText = cleanText.trim();
  return { label, time, cleanText };
}
