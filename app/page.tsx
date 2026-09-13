'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

declare const process: {
  env: {
    NEXT_PUBLIC_SUPABASE_URL?: string;
    NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  };
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

interface User {
  id: string;
  name: string;
  role: string;
  login_id?: string; // ログイン用ID
  password?: string;   // パスワード
  ronridelflg?: string;
}

interface AttendanceDetail {
  user_id: string;
  user_name: string;
  status: string;
}

interface EventItem {
  id: string;
  event_date: string;
  start_time: string;
  end_time: string;
  title: string;
  location: string;
  my_status?: string;
  attendances: AttendanceDetail[];
  counts: {
    attending: number;
    absent: number;
    pending: number;
  };
}

const sortEventsByDate = (eventsList: EventItem[]) => {
  const todayStr = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/\//g, '-');

  const upcomingEvents = eventsList
    .filter((e) => e.event_date.slice(0, 10) >= todayStr)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));

  const pastEvents = eventsList
    .filter((e) => e.event_date.slice(0, 10) < todayStr)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));

  return [...upcomingEvents, ...pastEvents];
};

export default function DashboardPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    event_date: '',
    start_time: '19:00',
    end_time: '21:00',
    location: '',
  });

  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userFormData, setUserFormData] = useState({
    login_id: '',
    password_hash: '',
    name: '',
    role: '1',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (!savedUser) {
      router.push('/login');
      return;
    }

    const userObj: User = JSON.parse(savedUser);
    setCurrentUser(userObj);
    fetchAppData(userObj.id);
  }, [router]);

  const fetchAppData = async (currentUserId: string) => {
    setIsLoading(true);
    try {
      const { data: usersData } = await supabase
        .from('users')
        .select('*')
        .eq('ronridelflg', '0');

      setUsersList(usersData || []);

      const { data: eventData } = await supabase
        .from('events')
        .select('*')
        .eq('ronridelflg', '0')
        .order('event_date', { ascending: true });

      const { data: attendanceData } = await supabase
        .from('attendances')
        .select('*');

      const mergedEvents: EventItem[] = (eventData || []).map((evt: any) => {
        const evtAttendances = (attendanceData || []).filter(
          (att: any) => att.event_id === evt.id
        );

        let myStatus = '3';
        let attendingCount = 0;
        let absentCount = 0;
        let pendingCount = 0;

        const details: AttendanceDetail[] = (usersData || []).map(
          (u: { id: string; name: string }) => {
            const att = evtAttendances.find((a: any) => a.user_id === u.id);
            const status = att ? att.status : '3';

            if (u.id === currentUserId) myStatus = status;

            if (status === '1') attendingCount++;
            else if (status === '2') absentCount++;
            else pendingCount++;

            return { user_id: u.id, user_name: u.name, status };
          }
        );

        return {
          id: evt.id,
          event_date: evt.event_date,
          start_time: evt.start_time,
          end_time: evt.end_time,
          title: evt.title,
          location: evt.location,
          my_status: myStatus,
          attendances: details,
          counts: { attending: attendingCount, absent: absentCount, pending: pendingCount },
        };
      });

      setEvents(sortEventsByDate(mergedEvents));
    } catch (err: any) {
      console.error('データ取得エラー:', err.message || err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAttendanceChange = async (eventId: string, status: string) => {
    if (!currentUser) return;

    const { error } = await supabase.from('attendances').upsert(
      {
        event_id: eventId,
        user_id: currentUser.id,
        status: status,
      },
      { onConflict: 'event_id, user_id' }
    );

    if (error) {
      alert('更新に失敗しました: ' + error.message);
      return;
    }

    setEvents((prevEvents) => {
      const updatedEvents = prevEvents.map((evt) => {
        if (evt.id === eventId) {
          const otherAttendances = (evt.attendances || []).filter(
            (a) => a.user_id !== currentUser.id
          );
          const updatedAttendances = [
            ...otherAttendances,
            {
              user_id: currentUser.id,
              user_name: currentUser.name,
              status: status,
            },
          ];

          let attending = 0;
          let absent = 0;
          let pending = 0;

          updatedAttendances.forEach((a) => {
            if (a.status === '1') attending++;
            else if (a.status === '2') absent++;
            else pending++;
          });

          return {
            ...evt,
            my_status: status,
            attendances: updatedAttendances,
            counts: { attending, absent, pending },
          };
        }
        return evt;
      });

      return sortEventsByDate(updatedEvents);
    });
  };

  const formatTimeValue = (val: any, defaultTime: string) => {
    if (val === undefined || val === null || val === '') return defaultTime;

    if (typeof val === 'number') {
      const totalMinutes = Math.round(val * 24 * 60);
      const hours = Math.floor(totalMinutes / 60) % 24;
      const minutes = totalMinutes % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    if (val instanceof Date) {
      const hours = String(val.getHours()).padStart(2, '0');
      const minutes = String(val.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    }

    const str = String(val).trim();
    if (str.includes('GMT') || str.includes('1899') || str.includes('T')) {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
      }
    }

    if (str.includes(':')) {
      const parts = str.split(':');
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }

    return defaultTime;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentUser || currentUser.role !== '0') {
      alert('一括取り込みは管理者のみ実行できます。');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data: any[] = XLSX.utils.sheet_to_json(ws);

        if (data.length === 0) {
          alert('ファイル内にデータが見つかりませんでした。');
          return;
        }

        const newEvents = data.map((row) => {
          let dateStr = row.event_date;
          if (row.event_date instanceof Date) {
            const y = row.event_date.getFullYear();
            const m = String(row.event_date.getMonth() + 1).padStart(2, '0');
            const d = String(row.event_date.getDate()).padStart(2, '0');
            dateStr = `${y}-${m}-${d}`;
          }

          const startTime = formatTimeValue(row.start_time, '19:00');
          const endTime = formatTimeValue(row.end_time, '21:00');

          return {
            id: crypto.randomUUID(),
            title: row.title || 'イベント',
            event_date: String(dateStr || ''),
            start_time: startTime,
            end_time: endTime,
            location: String(row.location || ''),
            ronridelflg: '0',
          };
        });

        const { error } = await supabase.from('events').insert(newEvents);

        if (error) {
          alert(`一括登録エラー: ${error.message}`);
        } else {
          alert(`${newEvents.length}件のイベントを一括登録しました！`);
          fetchAppData(currentUser.id);
        }
      } catch (err: any) {
        alert('ファイルの読み込みに失敗しました。形式を確認してください。');
        console.error(err);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.readAsBinaryString(file);
  };

  const handleOpenCreateModal = () => {
    setEditingEvent(null);
    setFormData({
      title: '',
      event_date: new Date().toISOString().slice(0, 10),
      start_time: '19:00',
      end_time: '21:00',
      location: '',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (evt: EventItem) => {
    setEditingEvent(evt);
    setFormData({
      title: evt.title,
      event_date: evt.event_date,
      start_time: evt.start_time ? evt.start_time.slice(0, 5) : '19:00',
      end_time: evt.end_time ? evt.end_time.slice(0, 5) : '21:00',
      location: evt.location || '',
    });
    setIsModalOpen(true);
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    try {
      if (editingEvent) {
        const { error } = await supabase
          .from('events')
          .update({
            title: formData.title,
            event_date: formData.event_date,
            start_time: formData.start_time,
            end_time: formData.end_time,
            location: formData.location,
          })
          .eq('id', editingEvent.id);

        if (error) alert(`更新失敗: ${error.message}`);
      } else {
        const { error } = await supabase
          .from('events')
          .insert({
            id: crypto.randomUUID(),
            title: formData.title,
            event_date: formData.event_date,
            start_time: formData.start_time,
            end_time: formData.end_time,
            location: formData.location,
            ronridelflg: '0',
          });

        if (error) alert(`作成失敗: ${error.message}`);
      }

      setIsModalOpen(false);
      fetchAppData(currentUser.id);
    } catch (err: any) {
      console.error('イベント保存エラー:', err);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('このイベントを削除してもよろしいですか？')) return;
    if (!currentUser) return;

    try {
      const { error } = await supabase
        .from('events')
        .update({ ronridelflg: '1' })
        .eq('id', eventId);

      if (error) {
        alert(`削除失敗: ${error.message}`);
      } else {
        fetchAppData(currentUser.id);
      }
    } catch (err: any) {
      console.error('削除エラー:', err);
    }
  };

  // メンバー管理関連のハンドラー
  const handleOpenCreateUserModal = () => {
    setEditingUser(null);
    setUserFormData({ login_id: '', password_hash: '', name: '', role: '1' });
    setIsUserModalOpen(true);
  };

  const handleOpenEditUserModal = (user: User) => {
    setEditingUser(user);
    setUserFormData({
      login_id: user.login_id || '',
      password_hash: '', // 編集時はパスワードは空からスタート（変更したい場合のみ入力）
      name: user.name,
      role: user.role,
    });
    setIsUserModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    try {
      if (editingUser) {
        const updatePayload: any = {
          name: userFormData.name,
          role: userFormData.role,
        };
        if (userFormData.password_hash) {
          updatePayload.password_hash = userFormData.password_hash;
        }

        const { error } = await supabase
          .from('users')
          .update(updatePayload)
          .eq('id', editingUser.id);

        if (error) {
          alert(`メンバー更新失敗: ${error.message}`);
        } else {
          if (editingUser.id === currentUser.id) {
            const updated = { ...currentUser, name: userFormData.name, role: userFormData.role };
            localStorage.setItem('user', JSON.stringify(updated));
            setCurrentUser(updated);
          }
        }
      } else {
        const { error } = await supabase
          .from('users')
          .insert({
            id: crypto.randomUUID(),
            login_id: userFormData.login_id,
            password_hash: userFormData.password_hash,
            name: userFormData.name,
            role: userFormData.role,
            ronridelflg: '0',
          });

        if (error) {
          alert(`メンバー登録失敗: ${error.message}`);
        }
      }

      setIsUserModalOpen(false);
      fetchAppData(currentUser.id);
    } catch (err: any) {
      console.error('メンバー保存エラー:', err);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('このメンバーを削除（論理削除）してもよろしいですか？')) return;
    if (!currentUser) return;

    try {
      const { error } = await supabase
        .from('users')
        .update({ ronridelflg: '1' })
        .eq('id', userId);

      if (error) {
        alert(`メンバー削除失敗: ${error.message}`);
      } else {
        fetchAppData(currentUser.id);
      }
    } catch (err: any) {
      console.error('削除エラー:', err);
    }
  };

  const scrollToEvent = (dateStr: string) => {
    const targetElement = document.getElementById(`event-${dateStr}`);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const getDaysInMonth = (year: number, month: number) => {
    const date = new Date(year, month, 1);
    const days = [];
    const firstDayIndex = date.getDay();

    for (let i = 0; i < firstDayIndex; i++) {
      days.push(null);
    }

    while (date.getMonth() === month) {
      days.push(new Date(date));
      date.setDate(date.getDate() + 1);
    }

    return days;
  };

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const calendarDays = getDaysInMonth(year, month);

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const formatTime = (timeStr?: string) => (timeStr ? timeStr.slice(0, 5) : '');

  const getRoleLabel = (role?: string) => {
    switch (role) {
      case '0':
        return '管理者';
      case '1':
        return 'メンバー';
      case '2':
        return '練習生';
      default:
        return '未設定';
    }
  };

  const currentMonthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const currentMonthEvents = events.filter((e) => e.event_date.startsWith(currentMonthStr));

  const handleAddToGoogleCalendar = (evt: EventItem) => {
    const startTimeStr = formatTime(evt.start_time) || '19:00';
    const endTimeStr = formatTime(evt.end_time) || '21:00';

    const startIsoString = `${evt.event_date}T${startTimeStr}:00+09:00`;
    const endIsoString = `${evt.event_date}T${endTimeStr}:00+09:00`;

    const startDate = new Date(startIsoString);
    const endDate = new Date(endIsoString);

    const formatToGCalUTC = (date: Date) => {
      return date.toISOString().replace(/-|:|\.\d\d\d/g, '');
    };

    const startFormatted = formatToGCalUTC(startDate);
    const endFormatted = formatToGCalUTC(endDate);

    const title = encodeURIComponent(evt.title);
    const details = encodeURIComponent('フットサル出欠管理システムより登録');
    const location = encodeURIComponent(evt.location || '');

    const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startFormatted}/${endFormatted}&details=${details}&location=${location}`;

    window.open(googleCalendarUrl, '_blank', 'noopener,noreferrer');
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-600">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-2">
            <h1 className="text-base sm:text-xl font-bold text-gray-800 whitespace-nowrap">
              フットサル出欠管理
            </h1>
            <span className="text-xs sm:text-sm text-gray-600 truncate max-w-[160px] sm:max-w-none text-right">
              {currentUser?.name} <span className="text-gray-400">({getRoleLabel(currentUser?.role)})</span>
            </span>
          </div>

          <div className="mt-2 flex items-center justify-end space-x-2 overflow-x-auto py-1 whitespace-nowrap text-xs sm:text-sm">
            {currentUser?.role === '0' && (
              <>
                <button
                  onClick={handleOpenCreateModal}
                  className="rounded bg-green-600 px-2.5 py-1.5 font-medium text-white hover:bg-green-700 transition shadow-sm whitespace-nowrap"
                >
                  ＋ 作成
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded bg-indigo-600 px-2.5 py-1.5 font-medium text-white hover:bg-indigo-700 transition shadow-sm whitespace-nowrap"
                >
                  一括取り込み
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".csv, .xlsx, .xls"
                  className="hidden"
                />
                <button
                  onClick={handleOpenCreateUserModal}
                  className="rounded bg-purple-600 px-2.5 py-1.5 font-medium text-white hover:bg-purple-700 transition shadow-sm whitespace-nowrap"
                >
                  メンバーの編集
                </button>
              </>
            )}

            <button
              onClick={() => currentUser && fetchAppData(currentUser.id)}
              className="rounded bg-blue-50 border border-blue-200 px-2.5 py-1.5 text-blue-600 hover:bg-blue-100 transition flex items-center space-x-1 whitespace-nowrap"
              title="最新のスケジュールに更新"
            >
              <span>🔄</span>
              <span>更新</span>
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('user');
                router.push('/login');
              }}
              className="rounded bg-gray-200 px-2.5 py-1.5 text-gray-700 hover:bg-gray-300 transition whitespace-nowrap"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        {/* カレンダー表示 */}
        <div className="rounded-lg bg-white p-6 shadow">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
            <h2 className="text-lg font-bold">
              {year}年 {month + 1}月
            </h2>
            <div className="flex items-center space-x-2">
              <button onClick={prevMonth} className="px-3 py-1 border rounded text-sm hover:bg-gray-100">
                前月
              </button>
              <button onClick={nextMonth} className="px-3 py-1 border rounded text-sm hover:bg-gray-100">
                次月
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center font-bold text-xs text-gray-500 mb-2">
            <div className="text-red-500">日</div>
            <div>月</div>
            <div>火</div>
            <div>水</div>
            <div>木</div>
            <div>金</div>
            <div className="text-blue-500">土</div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {calendarDays.map((date, idx) => {
              if (!date) {
                return <div key={`empty-${idx}`} className="h-14 bg-gray-50/50 rounded" />;
              }

              const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
              const dayEvents = events.filter((e) => e.event_date === dateStr);
              const hasUnanswered = dayEvents.some((e) => e.my_status === '3' || !e.my_status);

              return (
                <div
                  key={dateStr}
                  onClick={() => dayEvents.length > 0 && scrollToEvent(dateStr)}
                  className={`relative h-14 p-1 border rounded flex flex-col justify-between transition ${
                    dayEvents.length > 0
                      ? 'bg-blue-50/80 border-blue-300 font-bold cursor-pointer hover:bg-blue-100 shadow-sm'
                      : 'bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs">{date.getDate()}</span>
                    {hasUnanswered && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white shadow shrink-0">
                        !
                      </span>
                    )}
                  </div>

                  {dayEvents.length > 0 && (
                    <div className="flex justify-center space-x-1 mb-1 w-full">
                      {dayEvents.map((e) => (
                        <span
                          key={e.id}
                          className={`h-2 w-2 rounded-full ${
                            e.my_status === '1'
                              ? 'bg-green-500'
                              : e.my_status === '2'
                              ? 'bg-red-500'
                              : 'bg-yellow-500'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* イベント一覧（当月分のみ表示） */}
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-bold">{year}年 {month + 1}月のイベント・出欠入力一覧</h2>

          {currentMonthEvents.length === 0 ? (
            <div className="rounded border border-dashed border-gray-300 p-8 text-center text-gray-400">
              この月の予定されているイベントはありません。
            </div>
          ) : (
            <div className="space-y-4">
              {currentMonthEvents.map((evt) => {
                const todayStr = new Intl.DateTimeFormat('ja-JP', {
                  timeZone: 'Asia/Tokyo',
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                })
                  .format(new Date())
                  .replace(/\//g, '-');

                const isPast = evt.event_date.slice(0, 10) < todayStr;

                return (
                  <div
                    key={evt.id}
                    id={`event-${evt.event_date}`}
                    className={`rounded-lg border p-4 transition ${
                      isPast
                        ? 'bg-gray-200 border-gray-300 opacity-80'
                        : 'bg-white border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                      <div>
                        <div className="mb-1">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-semibold text-blue-600">
                              {evt.event_date}（{['日', '月', '火', '水', '木', '金', '土'][new Date(evt.event_date.replace(/-/g, '/')).getDay()]}）
                            </span>
                            {(evt.my_status === '3' || !evt.my_status) && (
                              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">
                                未入力 !
                              </span>
                            )}
                          </div>
                          <div className="text-sm font-semibold text-blue-600">
                            {formatTime(evt.start_time)} 〜 {formatTime(evt.end_time)}
                          </div>
                        </div>
                        <div className="text-lg font-bold flex items-center space-x-2">
                          <span>{evt.title}</span>

                          {currentUser?.role === '0' && (
                            <div className="flex items-center space-x-1 text-xs">
                              <button
                                onClick={() => handleOpenEditModal(evt)}
                                className="px-2 py-0.5 text-gray-600 bg-gray-100 rounded hover:bg-gray-200"
                              >
                                編集
                              </button>
                              <button
                                onClick={() => handleDeleteEvent(evt.id)}
                                className="px-2 py-0.5 text-red-600 bg-red-50 rounded hover:bg-red-100"
                              >
                                削除
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="text-sm text-gray-500">場所: {evt.location || '未定'}</div>

                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => handleAddToGoogleCalendar(evt)}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition shadow-sm"
                          >
                            <span>📅</span>
                            <span>Googleカレンダーに追加</span>
                          </button>
                        </div>

                        <div className="mt-2 flex items-center space-x-3 text-xs">
                          <span className="text-green-600 font-bold">参加: {evt.counts.attending}名</span>
                          <span className="text-red-600 font-bold">不参加: {evt.counts.absent}名</span>
                          <span className="text-yellow-600 font-bold">保留: {evt.counts.pending}名</span>
                        </div>
                      </div>

                      <div className="mt-4 sm:mt-0 flex space-x-2">
                        <button
                          onClick={() => handleAttendanceChange(evt.id, '1')}
                          className={`px-4 py-2 rounded text-sm font-medium transition ${
                            evt.my_status === '1' ? 'bg-green-600 text-white shadow' : 'bg-gray-100 hover:bg-green-100'
                          }`}
                        >
                          参加
                        </button>
                        <button
                          onClick={() => handleAttendanceChange(evt.id, '2')}
                          className={`px-4 py-2 rounded text-sm font-medium transition ${
                            evt.my_status === '2' ? 'bg-red-600 text-white shadow' : 'bg-gray-100 hover:bg-red-100'
                          }`}
                        >
                          不参加
                        </button>
                        <button
                          onClick={() => handleAttendanceChange(evt.id, '3')}
                          className={`px-4 py-2 rounded text-sm font-medium transition ${
                            evt.my_status === '3' ? 'bg-yellow-500 text-white shadow' : 'bg-gray-100 hover:bg-yellow-100'
                          }`}
                        >
                          保留
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 border-t border-gray-100 pt-3">
                      <button
                        onClick={() => setOpenDetailId(openDetailId === evt.id ? null : evt.id)}
                        className="text-xs text-blue-600 hover:underline focus:outline-none"
                      >
                        {openDetailId === evt.id ? '▲ メンバーの回答状況を閉じる' : '▼ メンバーの回答状況を見る'}
                      </button>

                      {openDetailId === evt.id && (
                        <div className="mt-3 space-y-3 rounded-lg bg-gray-50 p-4">
                          <div>
                            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-green-700">
                              <span>参加</span>
                              <span className="text-gray-500">
                                {evt.attendances.filter((a) => a.status === '1').length}名
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {evt.attendances
                                .filter((a) => a.status === '1')
                                .map((att) => (
                                  <span
                                    key={att.user_id}
                                    className="rounded-full bg-green-100 border border-green-200 px-3 py-1 text-xs font-medium text-green-800 shadow-sm"
                                  >
                                    {att.user_name}
                                  </span>
                                ))}
                              {evt.attendances.filter((a) => a.status === '1').length === 0 && (
                                <span className="text-xs text-gray-400">なし</span>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-red-700">
                              <span>不参加</span>
                              <span className="text-gray-500">
                                {evt.attendances.filter((a) => a.status === '2').length}名
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {evt.attendances
                                .filter((a) => a.status === '2')
                                .map((att) => (
                                  <span
                                    key={att.user_id}
                                    className="rounded-full bg-red-100 border border-red-200 px-3 py-1 text-xs font-medium text-red-800 shadow-sm"
                                  >
                                    {att.user_name}
                                  </span>
                                ))}
                              {evt.attendances.filter((a) => a.status === '2').length === 0 && (
                                <span className="text-xs text-gray-400">なし</span>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-yellow-700">
                              <span>未定・保留</span>
                              <span className="text-gray-500">
                                {evt.attendances.filter((a) => a.status === '3' || !a.status).length}名
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {evt.attendances
                                .filter((a) => a.status === '3' || !a.status)
                                .map((att) => (
                                  <span
                                    key={att.user_id}
                                    className="rounded-full bg-yellow-100 border border-yellow-200 px-3 py-1 text-xs font-medium text-yellow-800 shadow-sm"
                                  >
                                    {att.user_name}
                                  </span>
                                ))}
                              {evt.attendances.filter((a) => a.status === '3' || !a.status).length === 0 && (
                                <span className="text-xs text-gray-400">なし</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* イベント編集・作成用モーダル */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-bold text-gray-800">
              {editingEvent ? 'イベント編集' : 'イベント新規作成'}
            </h3>
            <form onSubmit={handleSaveEvent} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">イベント名</label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="例: 練習"
                  className="w-full rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">開催日</label>
                <input
                  type="date"
                  required
                  value={formData.event_date}
                  onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                  className="w-full rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="w-full">
                  <label className="block text-xs font-bold text-gray-700 mb-1">開始時間</label>
                  <input
                    type="time"
                    required
                    value={formData.start_time}
                    onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                    className="w-full rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div className="w-full">
                  <label className="block text-xs font-bold text-gray-700 mb-1">終了時間</label>
                  <input
                    type="time"
                    required
                    value={formData.end_time}
                    onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                    className="w-full rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">場所</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="例: 岩崎学園"
                  className="w-full rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="mt-6 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 shadow"
                >
                  保存する
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* メンバー編集・新規登録用モーダル */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">メンバー管理・編集</h3>
              <button
                onClick={handleOpenCreateUserModal}
                className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 shadow-sm"
              >
                ＋ 新規メンバー登録
              </button>
            </div>

            {/* 新規登録 / 編集フォーム */}
            <form onSubmit={handleSaveUser} className="mb-6 rounded-lg bg-gray-50 p-4 border border-gray-200 space-y-3">
              <h4 className="text-sm font-bold text-gray-700">
                {editingUser ? `「${editingUser.name}」の情報を編集` : '新規メンバーの追加'}
              </h4>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">名前</label>
                <input
                  type="text"
                  required
                  value={userFormData.name}
                  onChange={(e) => setUserFormData({ ...userFormData, name: e.target.value })}
                  placeholder="例: 山田 太郎"
                  className="w-full rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">ID（ログイン用ID）</label>
                <input
                  type="text"
                  required
                  disabled={!!editingUser}
                  value={userFormData.login_id}
                  onChange={(e) => setUserFormData({ ...userFormData, login_id: e.target.value })}
                  placeholder="例: user01"
                  className={`w-full rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none ${
                    editingUser ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-white'
                  }`}
                />
              </div>
              
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {editingUser ? '新しいパスワード（変更する場合のみ入力）' : 'パスワード'}
                </label>
                <input
                  type="text"
                  required={!editingUser}
                  value={userFormData.password_hash}
                  onChange={(e) => setUserFormData({ ...userFormData, password_hash: e.target.value })}
                  placeholder={editingUser ? '変更しない場合は空欄' : 'パスワードを入力'}
                  className="w-full rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none bg-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">権限 (role)</label>
                <select
                  value={userFormData.role}
                  onChange={(e) => setUserFormData({ ...userFormData, role: e.target.value })}
                  className="w-full rounded border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none bg-white"
                >
                  <option value="0">0: 管理者</option>
                  <option value="1">1: メンバー</option>
                  <option value="2">2: 練習生</option>
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                {editingUser && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingUser(null);
                      setUserFormData({ login_id: '', password_hash: '', name: '', role: '1' });
                    }}
                    className="rounded bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300"
                  >
                    新規登録モードに切り替え
                  </button>
                )}
                <button
                  type="submit"
                  className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 shadow"
                >
                  {editingUser ? '変更を保存' : '追加する'}
                </button>
              </div>
            </form>
            

            {/* 登録済みメンバー一覧 */}
            <div>
              <h4 className="text-sm font-bold text-gray-700 mb-2">登録メンバー一覧</h4>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {usersList.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between rounded border border-gray-200 p-3 bg-white shadow-sm"
                  >
                    <div>
                      <div className="text-sm font-bold text-gray-800 flex items-center space-x-2">
                        <span>{u.name}</span>
                        <span className={`px-2 py-0.5 text-[10px] rounded font-bold ${
                          u.role === '0' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {getRoleLabel(u.role)}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">ID: {u.login_id || '未設定'}</div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleOpenEditUserModal(u)}
                        className="rounded bg-gray-100 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-200"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u.id)}
                        className="rounded bg-red-50 px-2.5 py-1 text-xs text-red-600 hover:bg-red-100"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setIsUserModalOpen(false)}
                className="rounded bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
