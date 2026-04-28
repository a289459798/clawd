import { useEffect, useRef, useState } from "react";

export function useConversationAutoScroll(activeConversation?: { id?: string; previewMessages?: unknown[]; lastMessage?: string; updatedAt?: number } | null) {
  const aiResponseScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  useEffect(() => {
    const container = aiResponseScrollRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      const shouldStick = distanceToBottom < 80;
      shouldStickToBottomRef.current = shouldStick;
      setShowJumpToBottom(!shouldStick);
    };

    shouldStickToBottomRef.current = true;
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
      if (!shouldStickToBottomRef.current) {
        return;
      }
      container.scrollTop = container.scrollHeight;
      setShowJumpToBottom(false);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [
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
