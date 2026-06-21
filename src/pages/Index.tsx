import { useState } from 'react';
import Icon from '@/components/ui/icon';

const AUTH_URL = 'https://functions.poehali.dev/21440e7c-bd1c-4dfe-b0c3-9bee7a214d0d';

type Screen = 'auth' | 'code' | 'app';
type Tab = 'chats' | 'calls' | 'contacts' | 'profile';

interface Chat {
  id: number;
  name: string;
  last: string;
  time: string;
  unread: number;
  online: boolean;
  color: string;
  emoji: string;
}

const chats: Chat[] = [
  { id: 1, name: 'Космо-команда', last: 'Стыковка через 5 минут 🚀', time: '14:32', unread: 3, online: true, color: 'from-violet-500 to-fuchsia-500', emoji: '🛰️' },
  { id: 2, name: 'Анна Орбитова', last: 'Голосовое сообщение', time: '13:58', unread: 0, online: true, color: 'from-cyan-400 to-blue-500', emoji: '👩‍🚀' },
  { id: 3, name: 'Марс. экспедиция', last: 'Фото · Закат над кратером', time: '12:10', unread: 12, online: false, color: 'from-orange-400 to-red-500', emoji: '🪐' },
  { id: 4, name: 'Лёша', last: 'Ты уже в эфире?', time: '11:45', unread: 0, online: false, color: 'from-emerald-400 to-teal-500', emoji: '🧑‍💻' },
  { id: 5, name: 'Семья ❤️', last: 'Мама: Звони как сможешь', time: 'Вчера', unread: 1, online: false, color: 'from-pink-400 to-rose-500', emoji: '🏡' },
  { id: 6, name: 'Станция МКС', last: 'Связь восстановлена', time: 'Вчера', unread: 0, online: true, color: 'from-indigo-400 to-purple-500', emoji: '🌌' },
];

const calls = [
  { id: 1, name: 'Анна Орбитова', type: 'video', dir: 'in', time: 'Сегодня, 13:40', color: 'from-cyan-400 to-blue-500', emoji: '👩‍🚀', missed: false },
  { id: 2, name: 'Лёша', type: 'audio', dir: 'out', time: 'Сегодня, 11:20', color: 'from-emerald-400 to-teal-500', emoji: '🧑‍💻', missed: false },
  { id: 3, name: 'Марс. экспедиция', type: 'video', dir: 'in', time: 'Вчера, 19:02', color: 'from-orange-400 to-red-500', emoji: '🪐', missed: true },
  { id: 4, name: 'Станция МКС', type: 'audio', dir: 'in', time: 'Вчера, 08:15', color: 'from-indigo-400 to-purple-500', emoji: '🌌', missed: false },
];

const contacts = [
  { id: 1, name: 'Анна Орбитова', phone: '+7 900 120-45-67', color: 'from-cyan-400 to-blue-500', emoji: '👩‍🚀' },
  { id: 2, name: 'Лёша', phone: '+7 901 333-22-11', color: 'from-emerald-400 to-teal-500', emoji: '🧑‍💻' },
  { id: 3, name: 'Мама', phone: '+7 905 555-00-99', color: 'from-pink-400 to-rose-500', emoji: '🏡' },
  { id: 4, name: 'Командир Стрелов', phone: '+7 902 777-88-44', color: 'from-violet-500 to-fuchsia-500', emoji: '🚀' },
];

const messages = [
  { id: 1, me: false, text: 'Привет! Готов к выходу на связь? 🛰️', time: '14:28' },
  { id: 2, me: true, text: 'Привет! Да, всё системы в норме', time: '14:29' },
  { id: 3, me: false, text: 'Отлично. Стыковка через 5 минут 🚀', time: '14:32' },
  { id: 4, me: true, text: 'Принял. Уже на позиции ✨', time: '14:32' },
];

export default function Index() {
  const [screen, setScreen] = useState<Screen>('auth');
  const [tab, setTab] = useState<Tab>('chats');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState(['', '', '', '']);
  const [openChat, setOpenChat] = useState<Chat | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sendCode = async () => {
    if (phone.length < 10) {
      setError('Введите номер полностью');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', phone: '7' + phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось отправить код');
      setCode(['', '', '', '']);
      setScreen('code');
      if (data.debug_code) setError('Тестовый код: ' + data.debug_code);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    const full = code.join('');
    if (full.length < 4) {
      setError('Введите код полностью');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', phone: '7' + phone, code: full }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Неверный код');
      localStorage.setItem('orbit_user', JSON.stringify(data.user));
      setScreen('app');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети');
    } finally {
      setLoading(false);
    }
  };

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
              <Icon name="ShieldCheck" size={15} className="text-accent" />
              Сквозное шифрование сообщений и звонков
            </p>
          </div>

          <div className="glass rounded-3xl p-6">
            {screen === 'auth' ? (
              <div className="animate-fade-in">
                <label className="text-sm font-medium text-muted-foreground">Номер телефона</label>
                <div className="mt-2 flex items-center gap-2 bg-secondary rounded-2xl px-4 py-3.5 border border-border focus-within:border-primary transition-colors">
                  <span className="text-foreground/80 font-medium">🇷🇺 +7</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="900 000-00-00"
                    inputMode="numeric"
                    className="flex-1 bg-transparent outline-none text-lg placeholder:text-muted-foreground/50"
                  />
                </div>
                {error && <p className="text-sm text-destructive mt-3 text-center">{error}</p>}
                <button
                  onClick={sendCode}
                  disabled={loading}
                  className="mt-5 w-full bg-gradient-brand animate-gradient-move text-white font-semibold py-3.5 rounded-2xl glow hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-60 disabled:hover:scale-100 flex items-center justify-center gap-2"
                >
                  {loading ? <Icon name="LoaderCircle" size={18} className="animate-spin" /> : null}
                  {loading ? 'Отправляем...' : 'Получить код'}
                </button>
                <p className="text-xs text-muted-foreground/70 text-center mt-4">
                  Нажимая кнопку, вы соглашаетесь с условиями использования
                </p>
              </div>
            ) : (
              <div className="animate-fade-in">
                <button onClick={() => { setScreen('auth'); setError(''); }} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm mb-4">
                  <Icon name="ChevronLeft" size={16} /> Назад
                </button>
                <h2 className="font-display text-xl font-semibold">Введите код</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Мы отправили код на +7 {phone || '900 000-00-00'}
                </p>
                <div className="flex gap-3 mt-6 justify-center">
                  {code.map((d, i) => (
                    <input
                      key={i}
                      id={`code-${i}`}
                      value={d}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, '').slice(-1);
                        const next = [...code];
                        next[i] = v;
                        setCode(next);
                        if (v && i < 3) document.getElementById(`code-${i + 1}`)?.focus();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Backspace' && !code[i] && i > 0) {
                          document.getElementById(`code-${i - 1}`)?.focus();
                        }
                      }}
                      inputMode="numeric"
                      className="w-14 h-16 text-center text-2xl font-bold bg-secondary border border-border rounded-2xl outline-none focus:border-primary focus:glow transition-all"
                    />
                  ))}
                </div>
                {error && <p className="text-sm text-destructive mt-4 text-center">{error}</p>}
                <button
                  onClick={verifyCode}
                  disabled={loading}
                  className="mt-6 w-full bg-gradient-brand animate-gradient-move text-white font-semibold py-3.5 rounded-2xl glow hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-60 disabled:hover:scale-100 flex items-center justify-center gap-2"
                >
                  {loading ? <Icon name="LoaderCircle" size={18} className="animate-spin" /> : null}
                  {loading ? 'Проверяем...' : 'Подтвердить'}
                </button>
                <button onClick={sendCode} disabled={loading} className="w-full text-xs text-muted-foreground/70 text-center mt-4 hover:text-foreground transition-colors">
                  Отправить код повторно
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ===== Открытый чат =====
  if (openChat) {
    return (
      <div className="min-h-screen bg-mesh flex flex-col max-w-2xl mx-auto">
        <header className="glass sticky top-0 z-10 flex items-center gap-3 px-4 py-3">
          <button onClick={() => setOpenChat(null)} className="text-muted-foreground hover:text-foreground">
            <Icon name="ChevronLeft" size={24} />
          </button>
          <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${openChat.color} flex items-center justify-center text-xl`}>{openChat.emoji}</div>
          <div className="flex-1">
            <p className="font-semibold leading-tight">{openChat.name}</p>
            <p className="text-xs text-accent flex items-center gap-1">
              <Icon name="ShieldCheck" size={12} /> {openChat.online ? 'в сети' : 'был(а) недавно'}
            </p>
          </div>
          <button className="w-10 h-10 rounded-full bg-secondary hover:bg-primary/20 flex items-center justify-center transition-colors"><Icon name="Phone" size={18} /></button>
          <button className="w-10 h-10 rounded-full bg-secondary hover:bg-primary/20 flex items-center justify-center transition-colors"><Icon name="Video" size={18} /></button>
        </header>

        <div className="flex-1 overflow-y-auto scrollbar-hide px-4 py-6 space-y-3">
          <div className="text-center">
            <span className="text-xs text-muted-foreground bg-secondary/60 rounded-full px-3 py-1 inline-flex items-center gap-1.5">
              <Icon name="Lock" size={11} /> Сообщения защищены сквозным шифрованием
            </span>
          </div>
          {messages.map((m, i) => (
            <div key={m.id} className={`flex ${m.me ? 'justify-end' : 'justify-start'} animate-slide-up`} style={{ animationDelay: `${i * 80}ms`, opacity: 0 }}>
              <div className={`max-w-[75%] px-4 py-2.5 rounded-3xl ${m.me ? 'bg-gradient-brand text-white rounded-br-md' : 'glass rounded-bl-md'}`}>
                <p className="leading-snug">{m.text}</p>
                <p className={`text-[10px] mt-1 ${m.me ? 'text-white/70' : 'text-muted-foreground'}`}>{m.time}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="glass p-3 flex items-center gap-2">
          <button className="w-11 h-11 rounded-full bg-secondary flex items-center justify-center shrink-0"><Icon name="Plus" size={20} /></button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Сообщение..."
            className="flex-1 bg-secondary rounded-full px-4 py-3 outline-none focus:ring-1 focus:ring-primary"
          />
          <button className="w-11 h-11 rounded-full bg-gradient-brand animate-gradient-move flex items-center justify-center shrink-0 glow active:scale-90 transition-transform">
            <Icon name="Send" size={18} className="text-white" />
          </button>
        </div>
      </div>
    );
  }

  // ===== Главный экран приложения =====
  return (
    <div className="min-h-screen bg-mesh max-w-2xl mx-auto flex flex-col">
      <header className="px-5 pt-8 pb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-gradient">
            {tab === 'chats' && 'Чаты'}
            {tab === 'calls' && 'Звонки'}
            {tab === 'contacts' && 'Контакты'}
            {tab === 'profile' && 'Профиль'}
          </h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <Icon name="ShieldCheck" size={12} className="text-accent" /> Защищено сквозным шифрованием
          </p>
        </div>
        <button className="w-11 h-11 rounded-full bg-gradient-brand animate-gradient-move flex items-center justify-center glow active:scale-90 transition-transform">
          <Icon name="Search" size={20} className="text-white" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto scrollbar-hide px-3 pb-28">
        {tab === 'chats' && (
          <div className="space-y-1">
            {chats.map((c, i) => (
              <button
                key={c.id}
                onClick={() => setOpenChat(c)}
                className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-secondary/60 transition-colors animate-fade-in text-left"
                style={{ animationDelay: `${i * 50}ms`, opacity: 0 }}
              >
                <div className="relative shrink-0">
                  <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${c.color} flex items-center justify-center text-2xl`}>{c.emoji}</div>
                  {c.online && <div className="absolute bottom-0 right-0 w-4 h-4 bg-emerald-400 rounded-full border-2 border-background" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <p className="font-semibold truncate">{c.name}</p>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">{c.time}</span>
                  </div>
                  <div className="flex justify-between items-center mt-0.5">
                    <p className="text-sm text-muted-foreground truncate">{c.last}</p>
                    {c.unread > 0 && (
                      <span className="shrink-0 ml-2 min-w-5 h-5 px-1.5 bg-gradient-brand text-white text-xs font-bold rounded-full flex items-center justify-center">{c.unread}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {tab === 'calls' && (
          <div className="space-y-1">
            {calls.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-2xl hover:bg-secondary/60 transition-colors animate-fade-in" style={{ animationDelay: `${i * 50}ms`, opacity: 0 }}>
                <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${c.color} flex items-center justify-center text-2xl shrink-0`}>{c.emoji}</div>
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold truncate ${c.missed ? 'text-destructive' : ''}`}>{c.name}</p>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Icon name={c.dir === 'in' ? 'ArrowDownLeft' : 'ArrowUpRight'} size={14} className={c.missed ? 'text-destructive' : 'text-accent'} />
                    {c.time}
                  </p>
                </div>
                <button className="w-11 h-11 rounded-full bg-secondary hover:bg-primary/20 flex items-center justify-center transition-colors">
                  <Icon name={c.type === 'video' ? 'Video' : 'Phone'} size={18} className="text-accent" />
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === 'contacts' && (
          <div className="space-y-1">
            {contacts.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-2xl hover:bg-secondary/60 transition-colors animate-fade-in" style={{ animationDelay: `${i * 50}ms`, opacity: 0 }}>
                <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${c.color} flex items-center justify-center text-2xl shrink-0`}>{c.emoji}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{c.name}</p>
                  <p className="text-sm text-muted-foreground">{c.phone}</p>
                </div>
                <button className="w-10 h-10 rounded-full bg-secondary hover:bg-primary/20 flex items-center justify-center transition-colors"><Icon name="MessageCircle" size={18} /></button>
                <button className="w-10 h-10 rounded-full bg-secondary hover:bg-primary/20 flex items-center justify-center transition-colors"><Icon name="Phone" size={18} /></button>
              </div>
            ))}
          </div>
        )}

        {tab === 'profile' && (
          <div className="animate-fade-in">
            <div className="glass rounded-3xl p-6 flex flex-col items-center text-center mt-2">
              <div className="w-24 h-24 rounded-full bg-gradient-brand animate-gradient-move flex items-center justify-center text-5xl glow">🧑‍🚀</div>
              <h2 className="font-display text-2xl font-bold mt-4">Юрий Гагарин</h2>
              <p className="text-muted-foreground">+7 {phone || '900 000-00-00'}</p>
              <p className="text-sm text-accent mt-1 flex items-center gap-1"><Icon name="Rocket" size={14} /> Поехали!</p>
            </div>
            <div className="mt-4 space-y-1">
              {[
                { icon: 'Bell', label: 'Уведомления', desc: 'Звуки и баннеры' },
                { icon: 'ShieldCheck', label: 'Приватность', desc: 'Шифрование включено' },
                { icon: 'Palette', label: 'Оформление', desc: 'Тёмная тема' },
                { icon: 'Settings', label: 'Настройки', desc: 'Аккаунт и данные' },
                { icon: 'CircleHelp', label: 'Помощь', desc: 'Поддержка' },
              ].map((it, i) => (
                <button key={i} className="w-full flex items-center gap-3 p-3.5 rounded-2xl hover:bg-secondary/60 transition-colors text-left">
                  <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center"><Icon name={it.icon} size={18} className="text-accent" /></div>
                  <div className="flex-1">
                    <p className="font-medium">{it.label}</p>
                    <p className="text-xs text-muted-foreground">{it.desc}</p>
                  </div>
                  <Icon name="ChevronRight" size={18} className="text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-2xl glass px-2 py-2 flex justify-around">
        {([
          { id: 'chats', icon: 'MessageCircle', label: 'Чаты' },
          { id: 'calls', icon: 'Phone', label: 'Звонки' },
          { id: 'contacts', icon: 'Users', label: 'Контакты' },
          { id: 'profile', icon: 'User', label: 'Профиль' },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-col items-center gap-1 px-5 py-1.5 rounded-2xl transition-all ${tab === t.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
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