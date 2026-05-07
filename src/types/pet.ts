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
