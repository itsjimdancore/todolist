'use client';
import { useEffect, useRef, useState } from 'react';
import { emailOf, markChatDelivered, watchMessages, watchMyChats } from './data';
import { toDate } from './people';

const PAGE = 50; // messages loaded at a time; "Load earlier messages" adds another page

const ms = (ts) => (ts ? toDate(ts).getTime() : 0);

// The private chat, live: kept running for the whole app so the sidebar's unread count is always right and the
// Chat page opens instantly. chat: undefined while loading, null when there isn't one yet.
export function useChat(user) {
  const email = emailOf(user);
  const [chats, setChats] = useState(null);
  useEffect(() => watchMyChats(email, setChats, () => setChats([])), [email]);
  // one private chat: the most recently used, if there were ever more than one
  const chat = chats === null ? undefined
    : [...chats].sort((a, b) => ms(b.last?.at || b.createdAt) - ms(a.last?.at || a.createdAt))[0] || null;
  const chatId = chat?.id || null;

  const [n, setN] = useState(PAGE);
  const [messages, setMessages] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    setMessages(null);
    setN(PAGE);
  }, [chatId]);
  useEffect(() => {
    if (!chatId) return undefined;
    return watchMessages(chatId, n, (list, size) => { setMessages(list); setHasMore(size >= n); }, () => setMessages([]));
  }, [chatId, n]);

  const other = chat ? chat.members.find((e) => e !== email) || null : null;

  // Their newest message reached me (the app is open, on any page): tell them, so they see grey double ticks.
  // Once per newer message; reading the chat (blue ticks) also counts.
  const theirLast = chat?.last && chat.last.from !== email ? ms(chat.last.at) : 0;
  const deliveredMine = Math.max(ms(chat?.deliveredAt?.[email]), ms(chat?.readAt?.[email]));
  const marked = useRef(0);
  useEffect(() => {
    if (!chatId || !theirLast || theirLast <= deliveredMine || marked.current >= theirLast) return;
    marked.current = theirLast;
    markChatDelivered(chatId, user).catch(() => { marked.current = 0; });
  }, [chatId, theirLast, deliveredMine, user]);
  const readMine = ms(chat?.readAt?.[email]);
  const unread = chat && messages
    ? messages.filter((m) => m.from !== email && !m.deleted && ms(m.createdAt) > readMine).length
    // messages not loaded yet: at least the last one, if it's theirs and newer than when I last read
    : chat?.last && chat.last.from !== email && ms(chat.last.at) > readMine ? 1 : 0;

  return { chat, chatId, other, me: email, messages, hasMore, loadMore: () => setN((x) => x + PAGE), unread };
}
