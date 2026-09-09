'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as XLSX from 'xlsx';

interface User {
  id: string;
  name: string;
  role: string;
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

export default function DashboardPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  
  // 管理者モーダル用の状態
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    event_date: '',
    start_time: '19:00',
    end_time: '21:00',
    location: '',
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
    fetchEventsAndAttendances(userObj.id);
  }, [router]);

  const fetchEventsAndAttendances = async (currentUserId: string) => {
    setIsLoading(true);
    try {
      const { data: usersData } = await supabase
        .from('users')
        .select('id, name')
        .eq('ronridelflg', '0');

      const { data: eventData } = await supabase
        .from('events')
        .select('*')
        .eq('ronridelflg', '0')
        .order('event_date', { ascending: true });

      const { data: attendanceData } = await supabase
        .from('attendances')
        .select('*');

      const mergedEvents: EventItem[] = (eventData || []).map((evt) => {
        const evtAttendances = (attendanceData || []).filter(
          (att) => att.event_id === evt.id
        );

        let myStatus = '3';
        let attendingCount = 0;
        let absentCount = 0;
        let pendingCount = 0;

        const details: AttendanceDetail[] = (usersData || []).map((u) => {
          const att = evtAttendances.find((a) => a.user_id === u.id);
          const status = att ? att.status : '3';

          if (u.id === currentUserId) myStatus = status;

          if (status === '1') attendingCount++;
          else if (status === '2') absentCount++;
          else pendingCount++;

          return { user_id: u.id, user_name: u.name, status };
        });

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

      setEvents(mergedEvents);
    } catch (err: any) {
      console.error('データ取得エラー:', err.message || err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAttendanceChange = async (eventId: string, newStatus: string) => {
    if (!currentUser) return;

    setEvents((prevEvents) =>
      prevEvents.map((evt) => {
        if (evt.id !== eventId) return evt;

        const updatedAttendances = evt.attendances.map((att) =>
          att.user_id === currentUser.id ? { ...att, status: newStatus } : att
        );

        return {
          ...evt,
          my_status: newStatus,
          attendances: updatedAttendances,
        };
      })
    );

    try {
      const { data: existing } = await supabase
        .from('attendances')
        .select('id')
        .eq('event_id', eventId)
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('attendances')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('attendances')
          .insert({
            id: crypto.randomUUID(),
            event_id: eventId,
            user_id: currentUser.id,
            status: newStatus,
          });
      }

      await fetchEventsAndAttendances(currentUser.id);
    } catch (err: any) {
      console.error('例外エラー:', err.message || err);
      fetchEventsAndAttendances(currentUser.id);
    }
  };

  // 時間フォーマット正規化関数 (ExcelのUTC読み込みによるズレを補正)
  const formatTimeValue = (val: any, defaultTime: string) => {
    if (!val) return defaultTime;

    if (val instanceof Date) {
      const hours = String(val.getUTCHours()).padStart(2, '0');
      const minutes = String(val.getUTCMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    }

    const str = String(val).trim();

    if (str.includes('GMT') || str.includes('1899') || str.includes('T')) {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        const hours = String(d.getUTCHours()).padStart(2, '0');
        const minutes = String(d.getUTCMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
      }
    }

    if (str.includes(':')) {
      const parts = str.split(':');
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }

    return defaultTime;
  };

  // --- CSV/Excel ファイル一括取り込み処理（管理者のみ許可） ---
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
          fetchEventsAndAttendances(currentUser.id);
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

  // 管理者機能: イベント作成・編集・削除
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
      fetchEventsAndAttendances(currentUser.id);
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
        fetchEventsAndAttendances(currentUser.id);
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

  // --- Google カレンダー追加用処理 (Web Intent) ---
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
      {/* 修正後のヘッダー */}
      <header className="bg-white shadow">
        <div className="mx-auto max-w-5xl px-4 py-3">
          {/* 上段：タイトルとユーザー情報 */}
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-2">
            <h1 className="text-base sm:text-xl font-bold text-gray-800 whitespace-nowrap">
              フットサル出欠管理
            </h1>
            <span className="text-xs sm:text-sm text-gray-600 truncate max-w-[160px] sm:max-w-none text-right">
              {currentUser?.name} <span className="text-gray-400">({getRoleLabel(currentUser?.role)})</span>
            </span>
          </div>

          {/* 下段：操作ボタン群 */}
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
              </>
            )}

            <button
              onClick={() => currentUser && fetchEventsAndAttendances(currentUser.id)}
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
                  {/* 上段：日付数字と未入力アイコンを横並び（重なり防止） */}
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs">{date.getDate()}</span>
                    {hasUnanswered && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white shadow shrink-0">
                        !
                      </span>
                    )}
                  </div>

                  {/* 下段：ステータスドット */}
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

        {/* イベント一覧 */}
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-bold">イベント・出欠入力一覧</h2>

          {events.length === 0 ? (
            <div className="rounded border border-dashed border-gray-300 p-8 text-center text-gray-400">
              予定されているイベントはありません。
            </div>
          ) : (
            <div className="space-y-4">
              {events.map((evt) => (
                <div
                  key={evt.id}
                  id={`event-${evt.event_date}`}
                  className="rounded-lg border border-gray-200 p-4 transition hover:border-blue-300"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                    <div>
                      {/* 日時表示領域：日付（曜日）と時間を2行で表示 */}
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

                      {/* Googleカレンダー追加ボタン */}
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
                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 bg-gray-50 p-3 rounded">
                        {evt.attendances.map((att) => (
                          <div key={att.user_id} className="flex items-center justify-between text-xs sm:text-sm bg-white p-2 rounded shadow-sm min-w-0">
                            <span className="font-medium truncate mr-1" title={att.user_name}>
                              {att.user_name}
                            </span>
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] sm:text-xs font-bold whitespace-nowrap ${
                              att.status === '1' ? 'bg-green-100 text-green-700' :
                              att.status === '2' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {att.status === '1' ? '参加' : att.status === '2' ? '不参加' : '保留'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* モーダル */}
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
    </div>
  );
}
