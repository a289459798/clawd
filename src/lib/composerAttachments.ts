import type { ComposerAttachment } from "../types/app";

export const readImageComposerAttachments = async (fileList: FileList | null): Promise<ComposerAttachment[]> => {
  if (!fileList || fileList.length === 0) return [];
  const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
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
      mimeType: file.type || "image/png",
      dataUrl,
      previewUrl: dataUrl,
    } satisfies ComposerAttachment;
  }));
};
