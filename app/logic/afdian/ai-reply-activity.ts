import { useSyncExternalStore } from "react";

interface AfdianAiReplyActivitySnapshot {
  generatingUserIds: readonly string[];
  visibleConversationUserId: string | null;
}

type ActivityListener = () => void;

const listeners = new Set<ActivityListener>();
const generatingUserIds = new Set<string>();
let visibleConversationUserId: string | null = null;
let snapshot: AfdianAiReplyActivitySnapshot = {
  generatingUserIds: [],
  visibleConversationUserId: null,
};

function publishSnapshot() {
  snapshot = {
    generatingUserIds: [...generatingUserIds],
    visibleConversationUserId,
  };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: ActivityListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function beginAfdianAiReplyGeneration(userId: string) {
  let active = true;
  if (!generatingUserIds.has(userId)) {
    generatingUserIds.add(userId);
    publishSnapshot();
  }

  return () => {
    if (!active) return;
    active = false;
    if (generatingUserIds.delete(userId)) publishSnapshot();
  };
}

export function setAfdianVisibleConversation(userId: string | null) {
  if (visibleConversationUserId === userId) return;
  visibleConversationUserId = userId;
  publishSnapshot();
}

export function clearAfdianVisibleConversation(userId: string) {
  if (visibleConversationUserId !== userId) return;
  visibleConversationUserId = null;
  publishSnapshot();
}

export function useAfdianAiReplyActivity() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getAfdianAiReplyActivitySnapshot() {
  return getSnapshot();
}
