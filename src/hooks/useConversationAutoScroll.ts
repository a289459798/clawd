import { useEffect, useRef, useState } from "react";
import type { ConversationAutoScrollMode } from "../types/settings";

export function useConversationAutoScroll(
  activeConversation?: { id?: string; previewMessages?: unknown[]; lastMessage?: string; updatedAt?: number } | null,
  mode: ConversationAutoScrollMode = "nearBottom",
) {
  const aiResponseScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const modeRef = useRef(mode);

  useEffect(() => {
    modeRef.current = mode;
    if (mode === "always") {
      shouldStickToBottomRef.current = true;
      setShowJumpToBottom(false);
    }
  }, [mode]);

  useEffect(() => {
    const container = aiResponseScrollRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      const shouldStick = distanceToBottom < 80;
      if (modeRef.current === "always") {
        shouldStickToBottomRef.current = true;
        setShowJumpToBottom(false);
        return;
      }
      shouldStickToBottomRef.current = modeRef.current === "nearBottom" ? shouldStick : false;
      setShowJumpToBottom(!shouldStick);
    };

    shouldStickToBottomRef.current = modeRef.current !== "manual";
    setShowJumpToBottom(false);
    handleScroll();
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [activeConversation?.id]);

  useEffect(() => {
    if (!activeConversation) {
      return;
    }
    const container = aiResponseScrollRef.current;
    if (!container) {
      return;
    }
    const raf = window.requestAnimationFrame(() => {
      const shouldFollow = modeRef.current === "always" || (modeRef.current === "nearBottom" && shouldStickToBottomRef.current);
      if (!shouldFollow) {
        const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        setShowJumpToBottom(distanceToBottom > 80);
        return;
      }
      container.scrollTop = container.scrollHeight;
      setShowJumpToBottom(false);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [
    mode,
    activeConversation?.id,
    activeConversation?.previewMessages?.length,
    activeConversation?.lastMessage,
    activeConversation?.updatedAt,
  ]);

  return {
    aiResponseScrollRef,
    shouldStickToBottomRef,
    showJumpToBottom,
    setShowJumpToBottom,
  };
}
