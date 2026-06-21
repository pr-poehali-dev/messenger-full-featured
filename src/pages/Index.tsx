import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from '@/components/ui/icon';

const AUTH_URL = 'https://functions.poehali.dev/21440e7c-bd1c-4dfe-b0c3-9bee7a214d0d';
const MSG_URL = 'https://functions.poehali.dev/7f95782e-77c4-4704-91d4-423c7230785d';
const CALL_URL = 'https://functions.poehali.dev/8850dff1-8658-4398-82f8-6be573a78c9d';

const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

type Screen = 'auth' | 'code' | 'app';
type Tab = 'chats' | 'search' | 'channels' | 'profile';

interface User { id: number; username: string; name: string; color: string; online?: boolean; }
interface Channel { id: number; name: string; username: string; color: string; description?: string; members?: number; }
interface RemoteUser { id?: number; name: string; color: string; }
interface Message { id: number; sender_id: number; username: string; name: string; color: string; text: string; time: string; }
interface Conv { id: number; partner_id?: number; username: string; name: string; color: string; online?: boolean; last_text?: string; last_time?: string; unread?: number; is_channel?: boolean; }
interface IncomingCall { id: number; caller_id: number; caller_username: string; caller_name: string; caller_color: string; call_type: string; offer: string; }

function api(url: string, action: string, params: Record<string, string> = {}, userId?: number) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  return fetch(`${url}?${qs}`, { headers: userId ? { 'X-User-Id': String(userId) } : {} }).then(r => r.json());
}
function apiPost(url: string, body: object, userId?: number) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(userId ? { 'X-User-Id': String(userId) } : {}) },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

// ───── Компонент аватара ─────
function Avatar({ color, name, size = 'md' }: { color: string; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'sm' ? 'w-9 h-9 text-base' : size === 'lg' ? 'w-16 h-16 text-2xl' : 'w-12 h-12 text-lg';
  const letter = (name || '?')[0].toUpperCase();
  return (
    <div className={`${s} rounded-full bg-gradient-to-br ${color} flex items-center justify-center font-bold text-white shrink-0`}>
      {letter}
    </div>
  );
}

// ───── Экран звонка ─────
function CallScreen({
  userId, callId, callType, isIncoming, remoteUser, offer,
  onEnd,
}: {
  userId: number; callId: number; callType: string; isIncoming: boolean;
  remoteUser: { name: string; color: string }; offer?: string; onEnd: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const lastIceRef = useRef(0);
  const [status, setStatus] = useState<'connecting' | 'active'>(isIncoming ? 'connecting' : 'connecting');
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);

  const endCall = useCallback(async () => {
    pcRef.current?.close();
    apiPost(CALL_URL, { action: 'end', call_id: callId }, userId);
    onEnd();
  }, [callId, userId, onEnd]);

  useEffect(() => {
    let stopped = false;
    const isVideo = callType === 'video';

    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo }).catch(() =>
        navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      );
      if (stopped) return;
      if (localRef.current) { localRef.current.srcObject = stream; }

      const pc = new RTCPeerConnection(STUN);
      pcRef.current = pc;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      pc.ontrack = (e) => {
        if (remoteRef.current) remoteRef.current.srcObject = e.streams[0];
        setStatus('active');
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          apiPost(CALL_URL, { action: 'ice', call_id: callId, candidate: JSON.stringify(e.candidate) }, userId);
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setStatus('active');
      };

      if (!isIncoming) {
        const offerSdp = await pc.createOffer();
        await pc.setLocalDescription(offerSdp);
        await apiPost(CALL_URL, { action: 'initiate', callee_id: remoteUser, call_type: callType, offer: JSON.stringify(offerSdp) }, userId);

        // Ждём answer
        const pollAnswer = setInterval(async () => {
          if (stopped) { clearInterval(pollAnswer); return; }
          const d = await api(CALL_URL, 'get_answer', { call_id: String(callId) }, userId);
          if (d.status === 'ended' || d.status === 'rejected') { clearInterval(pollAnswer); endCall(); return; }
          if (d.answer) {
            clearInterval(pollAnswer);
            await pc.setRemoteDescription(JSON.parse(d.answer));
          }
        }, 1500);
      } else {
        // Входящий — ставим offer, создаём answer
        await pc.setRemoteDescription(JSON.parse(offer!));
        const answerSdp = await pc.createAnswer();
        await pc.setLocalDescription(answerSdp);
        await apiPost(CALL_URL, { action: 'answer', call_id: callId, answer: JSON.stringify(answerSdp) }, userId);
      }

      // Опрос ICE
      const pollIce = setInterval(async () => {
        if (stopped) { clearInterval(pollIce); return; }
        const d = await api(CALL_URL, 'get_ice', { call_id: String(callId), since_id: String(lastIceRef.current), exclude_sender: String(userId) });
        for (const c of d.candidates || []) {
          lastIceRef.current = c.id;
          try { await pc.addIceCandidate(JSON.parse(c.candidate)); } catch (_e) { /* ignore */ }
        }
      }, 1000);
    })();

    return () => { stopped = true; pcRef.current?.close(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMute = () => {
    const stream = (localRef.current?.srcObject as MediaStream);
    stream?.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setMuted(m => !m);
  };
  const toggleVideo = () => {
    const stream = (localRef.current?.srcObject as MediaStream);
    stream?.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    setVideoOff(v => !v);
  };

  return (
    <div className="fixed inset-0 z-50 bg-mesh flex flex-col items-center justify-between py-12 px-6">
      {callType === 'video' && (
        <>
          <video ref={remoteRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover opacity-80" />
          <video ref={localRef} autoPlay playsInline muted className="absolute bottom-32 right-4 w-28 h-40 rounded-2xl object-cover border-2 border-white/20 z-10" />
        </>
      )}
      {callType === 'audio' && <audio ref={remoteRef as React.RefObject<HTMLAudioElement>} autoPlay />}

      <div className="relative z-10 text-center">
        <Avatar color={remoteUser.color} name={remoteUser.name} size="lg" />
        <h2 className="font-display text-2xl font-bold mt-4">{remoteUser.name}</h2>
        <p className="text-muted-foreground mt-1">
          {status === 'connecting' ? (isIncoming ? 'Входящий звонок...' : 'Соединение...') : 'Звонок активен'}
        </p>
      </div>

      <div className="relative z-10 flex gap-5">
        <button onClick={toggleMute} className={`w-14 h-14 rounded-full flex items-center justify-center ${muted ? 'bg-destructive' : 'bg-secondary'}`}>
          <Icon name={muted ? 'MicOff' : 'Mic'} size={22} />
        </button>
        {callType === 'video' && (
          <button onClick={toggleVideo} className={`w-14 h-14 rounded-full flex items-center justify-center ${videoOff ? 'bg-destructive' : 'bg-secondary'}`}>
            <Icon name={videoOff ? 'VideoOff' : 'Video'} size={22} />
          </button>
        )}
        <button onClick={endCall} className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center glow">
          <Icon name="PhoneOff" size={26} className="text-white" />
        </button>
      </div>
    </div>
  );
}

// ───── Входящий звонок баннер ─────
function IncomingBanner({ call, onAccept, onReject }: { call: IncomingCall; onAccept: () => void; onReject: () => void }) {
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 w-80 glass rounded-3xl p-4 animate-slide-up shadow-2xl">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Avatar color={call.caller_color} name={call.caller_name} size="md" />
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-background animate-pulse" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{call.caller_name}</p>
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <Icon name={call.call_type === 'video' ? 'Video' : 'Phone'} size={13} />
            {call.call_type === 'video' ? 'Видеозвонок' : 'Аудиозвонок'}
          </p>
        </div>
        <button onClick={onReject} className="w-11 h-11 rounded-full bg-destructive flex items-center justify-center">
          <Icon name="PhoneOff" size={18} className="text-white" />
        </button>
        <button onClick={onAccept} className="w-11 h-11 rounded-full bg-green-500 flex items-center justify-center">
          <Icon name="Phone" size={18} className="text-white" />
        </button>
      </div>
    </div>
  );
}

// ───── Экран чата ─────
function ChatView({ conv, userId, onBack, onCall }: { conv: Conv; userId: number; onBack: () => void; onCall: (type: string) => void; }) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const params = conv.is_channel ? { channel_id: String(conv.id) } : { conversation_id: String(conv.id) };
    const d = await api(MSG_URL, 'messages', params, userId);
    setMsgs(d.messages || []);
  }, [conv.id, conv.is_channel, userId]);

  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    const body = conv.is_channel
      ? { action: 'send', channel_id: conv.id, text }
      : { action: 'send', conversation_id: conv.id, text };
    await apiPost(MSG_URL, body, userId);
    await load();
    setSending(false);
  };

  return (
    <div className="min-h-screen bg-mesh flex flex-col max-w-2xl mx-auto">
      <header className="glass sticky top-0 z-10 flex items-center gap-3 px-4 py-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <Icon name="ChevronLeft" size={24} />
        </button>
        <Avatar color={conv.color} name={conv.name} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold leading-tight truncate">{conv.name}</p>
          <p className="text-xs text-accent flex items-center gap-1">
            <Icon name="ShieldCheck" size={11} />
            {conv.online ? 'в сети' : conv.is_channel ? 'канал' : 'не в сети'}
          </p>
        </div>
        {!conv.is_channel && (
          <>
            <button onClick={() => onCall('audio')} className="w-10 h-10 rounded-full bg-secondary hover:bg-primary/20 flex items-center justify-center transition-colors">
              <Icon name="Phone" size={18} />
            </button>
            <button onClick={() => onCall('video')} className="w-10 h-10 rounded-full bg-secondary hover:bg-primary/20 flex items-center justify-center transition-colors">
              <Icon name="Video" size={18} />
            </button>
          </>
        )}
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-hide px-4 py-4 space-y-2">
        {msgs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
            <Icon name="MessageCircle" size={32} className="opacity-30" />
            Пока нет сообщений
          </div>
        )}
        {msgs.map((m, i) => {
          const isMe = m.sender_id === userId;
          const showAvatar = !isMe && (i === 0 || msgs[i - 1].sender_id !== m.sender_id);
          return (
            <div key={m.id} className={`flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
              {!isMe && (showAvatar ? <Avatar color={m.color} name={m.name} size="sm" /> : <div className="w-9" />)}
              <div className={`max-w-[75%] px-3.5 py-2 rounded-3xl ${isMe ? 'bg-gradient-brand text-white rounded-br-md' : 'glass rounded-bl-md'}`}>
                {!isMe && showAvatar && <p className="text-xs font-semibold text-accent mb-0.5">@{m.username}</p>}
                <p className="leading-snug text-sm">{m.text}</p>
                <p className={`text-[10px] mt-0.5 ${isMe ? 'text-white/60' : 'text-muted-foreground'}`}>{m.time}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="glass p-3 flex items-center gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Сообщение..."
          className="flex-1 bg-secondary rounded-full px-4 py-3 outline-none focus:ring-1 focus:ring-primary text-sm"
        />
        <button
          onClick={send}
          disabled={!draft.trim() || sending}
          className="w-11 h-11 rounded-full bg-gradient-brand animate-gradient-move flex items-center justify-center shrink-0 glow active:scale-90 transition-transform disabled:opacity-40"
        >
          <Icon name="Send" size={18} className="text-white" />
        </button>
      </div>
    </div>
  );
}

// ───── Главный компонент ─────
export default function Index() {
  const [screen, setScreen] = useState<Screen>('auth');
  const [tab, setTab] = useState<Tab>('chats');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState(['', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState<{ id: number; username: string; name?: string } | null>(null);

  // Чаты
  const [convs, setConvs] = useState<Conv[]>([]);
  const [openConv, setOpenConv] = useState<Conv | null>(null);

  // Поиск
  const [searchQ, setSearchQ] = useState('');
  const [searchRes, setSearchRes] = useState<{ users: User[]; channels: Channel[] }>({ users: [], channels: [] });
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  // Звонки
  const [activeCall, setActiveCall] = useState<{ callId: number; callType: string; isIncoming: boolean; remoteUser: RemoteUser; offer?: string } | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const callPartnerRef = useRef<{ id: number } | null>(null);

  // Восстановить сессию
  useEffect(() => {
    const saved = localStorage.getItem('orbit_user');
    if (saved) { setUser(JSON.parse(saved)); setScreen('app'); }
  }, []);

  // Загрузка чатов
  const loadConvs = useCallback(async () => {
    if (!user) return;
    const d = await api(MSG_URL, 'conversations', {}, user.id);
    const all: Conv[] = [
      ...(d.conversations || []),
      ...(d.channels || []),
    ].sort((a, b) => (b.last_time || '').localeCompare(a.last_time || ''));
    setConvs(all);
  }, [user]);

  useEffect(() => {
    if (screen === 'app' && !openConv) {
      loadConvs();
      const t = setInterval(loadConvs, 3000);
      return () => clearInterval(t);
    }
  }, [screen, loadConvs, openConv]);

  // Опрос входящих звонков
  useEffect(() => {
    if (!user || screen !== 'app' || activeCall) return;
    const poll = setInterval(async () => {
      const d = await api(CALL_URL, 'incoming', {}, user.id);
      if (d.call) setIncomingCall(d.call);
    }, 2000);
    return () => clearInterval(poll);
  }, [user, screen, activeCall]);

  // Поиск с дебаунсом
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (searchQ.trim().length < 2) { setSearchRes({ users: [], channels: [] }); return; }
    searchTimer.current = setTimeout(async () => {
      if (!user) return;
      const d = await api(MSG_URL, 'search', { q: searchQ.trim() }, user.id);
      setSearchRes(d);
    }, 400);
  }, [searchQ, user]);

  // AUTH
  const sendCode = async () => {
    const uname = username.trim().replace(/^@/, '');
    if (!uname) { setError('Укажите ваш Telegram @username'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch(AUTH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', username: uname }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCode(['', '', '', '']); setScreen('code');
      if (data.debug_code) setError('Тест-код: ' + data.debug_code);
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); } finally { setLoading(false); }
  };

  const verifyCode = async () => {
    const full = code.join('');
    const uname = username.trim().replace(/^@/, '');
    if (full.length < 4) { setError('Введите код полностью'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch(AUTH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify', username: uname, code: full }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      localStorage.setItem('orbit_user', JSON.stringify(data.user));
      setUser(data.user); setScreen('app');
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); } finally { setLoading(false); }
  };

  const openChat = async (partner: User) => {
    if (!user) return;
    const d = await apiPost(MSG_URL, { action: 'open_conversation', partner_id: partner.id }, user.id);
    const conv: Conv = { id: d.conversation_id, partner_id: partner.id, username: partner.username, name: partner.name, color: partner.color, online: partner.online };
    callPartnerRef.current = { id: partner.id };
    setOpenConv(conv);
    setTab('chats');
    setSearchQ('');
  };

  const openChannel = (ch: Channel) => {
    const conv: Conv = { id: ch.id, username: ch.username || '', name: ch.name, color: ch.color, is_channel: true };
    setOpenConv(conv);
  };

  const startCall = async (type: string) => {
    if (!user || !openConv?.partner_id) return;
    const d = await apiPost(CALL_URL, { action: 'initiate', callee_id: openConv.partner_id, call_type: type, offer: '' }, user.id);
    setActiveCall({ callId: d.call_id, callType: type, isIncoming: false, remoteUser: { name: openConv.name, color: openConv.color, id: openConv.partner_id } });
  };

  const acceptCall = () => {
    if (!incomingCall) return;
    setActiveCall({ callId: incomingCall.id, callType: incomingCall.call_type, isIncoming: true, remoteUser: { name: incomingCall.caller_name, color: incomingCall.caller_color }, offer: incomingCall.offer });
    setIncomingCall(null);
  };

  const rejectCall = () => {
    if (!incomingCall) return;
    apiPost(CALL_URL, { action: 'reject', call_id: incomingCall.id }, user?.id);
    setIncomingCall(null);
  };

  // ── AUTH screens ──
  if (screen === 'auth' || screen === 'code') {
    return (
      <div className="min-h-screen bg-mesh flex items-center justify-center p-4 overflow-hidden relative">
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/20 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-10 right-10 w-80 h-80 bg-accent/20 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
        <div className="w-full max-w-sm relative z-10 animate-scale-in">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-brand animate-gradient-move glow mb-6">
              <Icon name="Send" size={36} className="text-white" />
            </div>
            <h1 className="font-display text-4xl font-bold tracking-tight">Orbit</h1>
            <p className="text-muted-foreground mt-2 flex items-center justify-center gap-1.5 text-sm">
              <Icon name="ShieldCheck" size={15} className="text-accent" /> Сквозное шифрование
            </p>
          </div>
          <div className="glass rounded-3xl p-6">
            {screen === 'auth' ? (
              <div className="animate-fade-in">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-xl bg-[#29a9eb]/20 flex items-center justify-center">
                    <Icon name="Send" size={15} className="text-[#29a9eb]" />
                  </div>
                  <span className="font-medium">Войти через Telegram</span>
                </div>
                <p className="text-sm text-muted-foreground mb-4">Бот пришлёт код прямо в Telegram</p>
                <div className="flex items-center gap-2 bg-secondary rounded-2xl px-4 py-3.5 border border-border focus-within:border-primary transition-colors">
                  <span className="text-muted-foreground font-bold text-lg">@</span>
                  <input value={username} onChange={e => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                    placeholder="your_username" autoCapitalize="none"
                    className="flex-1 bg-transparent outline-none text-lg placeholder:text-muted-foreground/50" />
                </div>
                <p className="text-xs text-muted-foreground/60 mt-2 flex items-center gap-1">
                  <Icon name="Info" size={12} /> Сначала напишите боту /start
                </p>
                {error && <p className="text-sm text-destructive mt-3 text-center">{error}</p>}
                <button onClick={sendCode} disabled={loading}
                  className="mt-5 w-full bg-gradient-brand text-white font-semibold py-3.5 rounded-2xl glow hover:scale-[1.02] transition-transform disabled:opacity-60 flex items-center justify-center gap-2">
                  {loading && <Icon name="LoaderCircle" size={18} className="animate-spin" />}
                  {loading ? 'Отправляем...' : 'Получить код'}
                </button>
              </div>
            ) : (
              <div className="animate-fade-in">
                <button onClick={() => { setScreen('auth'); setError(''); }} className="text-muted-foreground flex items-center gap-1 text-sm mb-4">
                  <Icon name="ChevronLeft" size={16} /> Назад
                </button>
                <h2 className="font-display text-xl font-semibold">Введите код</h2>
                <p className="text-sm text-muted-foreground mt-1">Бот отправил код для <span className="text-foreground font-medium">@{username}</span></p>
                <div className="flex gap-3 mt-6 justify-center">
                  {code.map((d, i) => (
                    <input key={i} id={`c${i}`} value={d}
                      onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(-1); const n = [...code]; n[i] = v; setCode(n); if (v && i < 3) document.getElementById(`c${i + 1}`)?.focus(); }}
                      onKeyDown={e => { if (e.key === 'Backspace' && !code[i] && i > 0) document.getElementById(`c${i - 1}`)?.focus(); }}
                      inputMode="numeric"
                      className="w-14 h-16 text-center text-2xl font-bold bg-secondary border border-border rounded-2xl outline-none focus:border-primary transition-all" />
                  ))}
                </div>
                {error && <p className="text-sm text-destructive mt-4 text-center">{error}</p>}
                <button onClick={verifyCode} disabled={loading}
                  className="mt-6 w-full bg-gradient-brand text-white font-semibold py-3.5 rounded-2xl glow hover:scale-[1.02] transition-transform disabled:opacity-60 flex items-center justify-center gap-2">
                  {loading && <Icon name="LoaderCircle" size={18} className="animate-spin" />}
                  {loading ? 'Проверяем...' : 'Подтвердить'}
                </button>
                <button onClick={sendCode} disabled={loading} className="w-full text-xs text-muted-foreground/60 mt-4 text-center hover:text-foreground transition-colors">
                  Отправить повторно
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Активный звонок ──
  if (activeCall && user) {
    return (
      <CallScreen
        userId={user.id}
        callId={activeCall.callId}
        callType={activeCall.callType}
        isIncoming={activeCall.isIncoming}
        remoteUser={activeCall.remoteUser}
        offer={activeCall.offer}
        onEnd={() => setActiveCall(null)}
      />
    );
  }

  // ── Открытый чат ──
  if (openConv && user) {
    return (
      <>
        {incomingCall && <IncomingBanner call={incomingCall} onAccept={acceptCall} onReject={rejectCall} />}
        <ChatView conv={openConv} userId={user.id} onBack={() => { setOpenConv(null); loadConvs(); }} onCall={startCall} />
      </>
    );
  }

  // ── Главный экран ──
  return (
    <div className="min-h-screen bg-mesh max-w-2xl mx-auto flex flex-col">
      {incomingCall && <IncomingBanner call={incomingCall} onAccept={acceptCall} onReject={rejectCall} />}

      <header className="px-5 pt-8 pb-4 flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-gradient">
          {tab === 'chats' && 'Чаты'}
          {tab === 'search' && 'Поиск'}
          {tab === 'channels' && 'Каналы'}
          {tab === 'profile' && 'Профиль'}
        </h1>
        {tab === 'chats' && (
          <button onClick={() => setTab('search')} className="w-11 h-11 rounded-full bg-gradient-brand flex items-center justify-center glow">
            <Icon name="Search" size={20} className="text-white" />
          </button>
        )}
      </header>

      <main className="flex-1 overflow-y-auto scrollbar-hide px-3 pb-28">

        {/* ── ЧАТЫ ── */}
        {tab === 'chats' && (
          <div className="space-y-1">
            {convs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <Icon name="MessageCircle" size={48} className="opacity-20" />
                <p className="text-sm">Нет чатов. Найдите людей через поиск!</p>
                <button onClick={() => setTab('search')} className="px-5 py-2 bg-primary/20 text-primary rounded-full text-sm hover:bg-primary/30 transition-colors">
                  Найти людей
                </button>
              </div>
            )}
            {convs.map((c, i) => (
              <button key={`${c.is_channel ? 'ch' : 'cv'}-${c.id}`} onClick={() => setOpenConv(c)}
                className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-secondary/60 transition-colors text-left animate-fade-in"
                style={{ animationDelay: `${i * 40}ms`, opacity: 0 }}>
                <div className="relative shrink-0">
                  <Avatar color={c.color} name={c.name} size="md" />
                  {c.online && !c.is_channel && <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-400 rounded-full border-2 border-background" />}
                  {c.is_channel && <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-accent rounded-full border-2 border-background flex items-center justify-center"><Icon name="Radio" size={10} className="text-accent-foreground" /></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <p className="font-semibold truncate">{c.name}</p>
                    <span className="text-[11px] text-muted-foreground shrink-0 ml-2">{c.last_time}</span>
                  </div>
                  <div className="flex justify-between items-center mt-0.5">
                    <p className="text-sm text-muted-foreground truncate">{c.last_text || 'Нет сообщений'}</p>
                    {(c.unread ?? 0) > 0 && (
                      <span className="shrink-0 ml-2 min-w-5 h-5 px-1.5 bg-gradient-brand text-white text-xs font-bold rounded-full flex items-center justify-center">{c.unread}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── ПОИСК ── */}
        {tab === 'search' && (
          <div>
            <div className="flex items-center gap-2 bg-secondary rounded-2xl px-4 py-3 mb-4 border border-border focus-within:border-primary transition-colors">
              <Icon name="Search" size={18} className="text-muted-foreground shrink-0" />
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
                placeholder="@username или название канала..."
                autoFocus
                className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground/50" />
              {searchQ && <button onClick={() => setSearchQ('')}><Icon name="X" size={16} className="text-muted-foreground" /></button>}
            </div>

            {searchQ.length < 2 && (
              <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
                <Icon name="Search" size={36} className="opacity-20" />
                <p className="text-sm">Введите минимум 2 символа</p>
              </div>
            )}

            {searchRes.users.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground font-medium px-2 mb-2">ЛЮДИ</p>
                <div className="space-y-1 mb-4">
                  {searchRes.users.map(u => (
                    <button key={u.id} onClick={() => openChat(u)}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-secondary/60 transition-colors text-left">
                      <div className="relative shrink-0">
                        <Avatar color={u.color} name={u.name} size="md" />
                        {u.online && <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-400 rounded-full border-2 border-background" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{u.name}</p>
                        <p className="text-sm text-muted-foreground">@{u.username}</p>
                      </div>
                      <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
                        <Icon name="MessageCircle" size={16} className="text-accent" />
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {searchRes.channels.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground font-medium px-2 mb-2">КАНАЛЫ</p>
                <div className="space-y-1">
                  {searchRes.channels.map((ch: Channel) => (
                    <button key={ch.id} onClick={() => openChannel(ch)}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-secondary/60 transition-colors text-left">
                      <div className="relative shrink-0">
                        <Avatar color={ch.color} name={ch.name} size="md" />
                        <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-accent rounded-full border-2 border-background flex items-center justify-center">
                          <Icon name="Radio" size={10} className="text-accent-foreground" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{ch.name}</p>
                        <p className="text-sm text-muted-foreground">{ch.members} участников</p>
                      </div>
                      <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
                        <Icon name="ArrowRight" size={16} className="text-accent" />
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {searchQ.length >= 2 && searchRes.users.length === 0 && searchRes.channels.length === 0 && (
              <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
                <Icon name="SearchX" size={36} className="opacity-20" />
                <p className="text-sm">Ничего не найдено</p>
              </div>
            )}
          </div>
        )}

        {/* ── КАНАЛЫ ── */}
        {tab === 'channels' && (
          <CreateChannelPanel userId={user!.id} onCreated={loadConvs} onOpen={openChannel} />
        )}

        {/* ── ПРОФИЛЬ ── */}
        {tab === 'profile' && (
          <ProfilePanel user={user!} onLogout={() => { localStorage.removeItem('orbit_user'); setUser(null); setScreen('auth'); }} />
        )}
      </main>

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-2xl glass px-2 py-2 flex justify-around">
        {([
          { id: 'chats', icon: 'MessageCircle', label: 'Чаты' },
          { id: 'search', icon: 'Search', label: 'Поиск' },
          { id: 'channels', icon: 'Radio', label: 'Каналы' },
          { id: 'profile', icon: 'User', label: 'Профиль' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex flex-col items-center gap-1 px-5 py-1.5 rounded-2xl transition-all ${tab === t.id ? 'text-primary' : 'text-muted-foreground'}`}>
            <div className={`flex items-center justify-center w-11 h-8 rounded-full transition-all ${tab === t.id ? 'bg-primary/20' : ''}`}>
              <Icon name={t.icon} size={20} />
            </div>
            <span className="text-[10px] font-medium">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ── Панель создания каналов ──
function CreateChannelPanel({ userId, onCreated, onOpen }: { userId: number; onCreated: () => void; onOpen: (ch: Channel) => void }) {
  const [name, setName] = useState('');
  const [uname, setUname] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const d = await apiPost(MSG_URL, { action: 'create_channel', name, username: uname, description: desc }, userId);
    setLoading(false);
    if (d.id) { setDone(true); onCreated(); setName(''); setUname(''); setDesc(''); setTimeout(() => setDone(false), 2000); }
  };

  return (
    <div className="space-y-4">
      <div className="glass rounded-3xl p-5">
        <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
          <Icon name="Plus" size={18} className="text-accent" /> Создать канал
        </h2>
        <div className="space-y-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Название канала"
            className="w-full bg-secondary rounded-2xl px-4 py-3 outline-none focus:ring-1 focus:ring-primary" />
          <div className="flex items-center gap-2 bg-secondary rounded-2xl px-4 py-3">
            <span className="text-muted-foreground">@</span>
            <input value={uname} onChange={e => setUname(e.target.value.replace(/[^a-z0-9_]/g, ''))} placeholder="username (необязательно)"
              className="flex-1 bg-transparent outline-none" />
          </div>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Описание (необязательно)"
            rows={2} className="w-full bg-secondary rounded-2xl px-4 py-3 outline-none focus:ring-1 focus:ring-primary resize-none" />
          <button onClick={create} disabled={loading || !name.trim()}
            className="w-full bg-gradient-brand text-white font-semibold py-3 rounded-2xl glow hover:scale-[1.02] transition-transform disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Icon name="LoaderCircle" size={16} className="animate-spin" />}
            {done ? '✓ Создан!' : 'Создать канал'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Профиль ──
function ProfilePanel({ user, onLogout }: { user: { id: number; username: string; name?: string }; onLogout: () => void }) {
  const [name, setName] = useState(user.name || '');
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await apiPost(MSG_URL, { action: 'update_profile', display_name: name }, user.id);
    localStorage.setItem('orbit_user', JSON.stringify({ ...user, name }));
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="glass rounded-3xl p-6 flex flex-col items-center text-center">
        <Avatar color="from-violet-500 to-fuchsia-500" name={user.name || user.username} size="lg" />
        <p className="text-muted-foreground mt-3">@{user.username}</p>
      </div>
      <div className="glass rounded-3xl p-5 space-y-3">
        <label className="text-sm text-muted-foreground">Отображаемое имя</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Ваше имя"
          className="w-full bg-secondary rounded-2xl px-4 py-3 outline-none focus:ring-1 focus:ring-primary" />
        <button onClick={save}
          className="w-full bg-gradient-brand text-white font-semibold py-3 rounded-2xl glow hover:scale-[1.02] transition-transform">
          {saved ? '✓ Сохранено!' : 'Сохранить'}
        </button>
      </div>
      <button onClick={onLogout} className="w-full py-3.5 rounded-2xl bg-secondary/60 text-destructive hover:bg-destructive/10 transition-colors flex items-center justify-center gap-2">
        <Icon name="LogOut" size={18} /> Выйти из аккаунта
      </button>
    </div>
  );
}