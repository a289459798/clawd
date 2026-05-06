import type { ComposerAttachment } from "../types/app";

export const readComposerAttachments = async (fileList: FileList | null): Promise<ComposerAttachment[]> => {
  if (!fileList || fileList.length === 0) return [];
  const files = Array.from(fileList);
  return Promise.all(files.map(async (file) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
    return {
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      dataUrl,
      previewUrl: file.type.startsWith("image/") ? dataUrl : undefined,
      size: file.size,
      path: typeof (file as unknown as { path?: unknown }).path === "string"
        ? (file as unknown as { path: string }).path
        : undefined,
    } satisfies ComposerAttachment;
  }));
};
