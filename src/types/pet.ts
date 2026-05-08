export type PetAtlas = {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
};

export type PetAnimation = {
  row: number;
  frames: number;
  frameMs: number[];
};

export type PetSummary = {
  id: string;
  name: string;
  species: string;
  description: string;
  status: string;
  source: "builtin" | "codex" | string;
  path?: string | null;
  icon?: string | null;
  image?: string | null;
  spritesheet?: string | null;
  spritesheetDataUrl?: string | null;
  atlas?: PetAtlas | null;
  animations?: Record<string, PetAnimation> | null;
  compatibleWith: string[];
};

export type PetConversationContext = {
  conversationId?: string | null;
  title?: string | null;
  status: string;
  model?: string | null;
  lastUserMessage?: string | null;
  lastReply?: string | null;
  updatedAt?: number | null;
  tokens?: string | null;
  replies?: PetReplyItem[];
};

export type PetReplyItem = {
  conversationId: string;
  title: string;
  status: string;
  model?: string | null;
  reply: string;
  loading?: boolean;
  updatedAt?: number | null;
};
