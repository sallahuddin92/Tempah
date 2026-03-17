import React, { useState, useEffect } from 'react';
import WebApp from '@twa-dev/sdk';
import { format, addDays, subDays, isSameDay, isWeekend, startOfMonth, endOfMonth, isSameMonth, isToday, isBefore, startOfDay } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, MessageSquare, Plus, X, Users, MapPin, ArrowLeft, Trash2 } from 'lucide-react';
import { Room, SlotAvailability } from './types';

export default function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [rooms, setRooms] = useState<Room[]>([]);
  const [availability, setAvailability] = useState<Record<string, SlotAvailability[]>>({});
  const [loading, setLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState<'calendar' | 'ai'>('calendar');
  const [step, setStep] = useState<'date' | 'location' | 'time' | 'confirm'>('date');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<number | null>(null);
  
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'ai', text: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const tg = WebApp;
  const userName = tg.initDataUnsafe?.user?.first_name || "Guest";
  const userId = tg.initDataUnsafe?.user?.id?.toString() || "guest_id";

  useEffect(() => {
    tg.ready();
    tg.expand();
    fetchRooms();

    // Polling as a fallback for real-time updates
    const interval = setInterval(() => {
      window.dispatchEvent(new CustomEvent('bookings_changed'));
    }, 15000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if ((step === 'location' || step === 'time' || step === 'confirm') && rooms.length > 0) {
      fetchAllAvailability();
    }

    const handleBookingsChanged = () => {
      if ((step === 'location' || step === 'time' || step === 'confirm') && rooms.length > 0) {
        fetchAllAvailability(false); // Don't show loading spinner for background sync
      }
    };

    window.addEventListener('bookings_changed', handleBookingsChanged);
    return () => {
      window.removeEventListener('bookings_changed', handleBookingsChanged);
    };
  }, [currentDate, step, rooms]);

  const fetchRooms = async () => {
    try {
      const res = await fetch(`/api/rooms?_t=${Date.now()}`);
      
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error(`Expected JSON, got ${contentType}`);
      }
      
      const data = await res.json();
      setRooms(data);
    } catch (error) {
      console.error('Failed to fetch rooms:', error);
    }
  };

  const fetchAllAvailability = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const formattedDate = format(currentDate, 'yyyy-MM-dd');
    const newAvailability: Record<string, SlotAvailability[]> = {};
    
    try {
      for (const room of rooms) {
        const res = await fetch(`/api/availability?date=${formattedDate}&room_name=${encodeURIComponent(room.name)}&_t=${Date.now()}`);
        
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Server returned ${res.status}: ${text.substring(0, 100)}`);
        }
        
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await res.text();
          throw new Error(`Expected JSON, got ${contentType}: ${text.substring(0, 100)}`);
        }
        
        const data = await res.json();
        newAvailability[room.name] = data;
      }
      setAvailability(newAvailability);
    } catch (error) {
      console.error('Failed to fetch availability:', error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const handlePrevMonth = () => setCurrentDate(prev => subDays(startOfMonth(prev), 1));
  const handleNextMonth = () => setCurrentDate(prev => addDays(endOfMonth(prev), 1));

  const handleDaySelect = (day: Date) => {
    setCurrentDate(day);
    setStep('location');
  };

  const handleBookRoom = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    if (selectedHour === null || !selectedRoom) return;

    // Validation: Prevent booking past dates or weekends
    const minDate = new Date('2026-02-25T00:00:00');
    const selectedDate = startOfDay(currentDate);
    
    if (isBefore(selectedDate, minDate) || isWeekend(selectedDate)) {
      showToast('Maaf, anda tidak boleh membuat tempahan untuk tarikh yang telah berlalu.', 'error');
      return;
    }

    const bookingData = {
      room_name: selectedRoom.name,
      user_name: userName,
      date: format(currentDate, 'yyyy-MM-dd'),
      hour: selectedHour,
      reason: formData.get('reason'),
      teacher_name: formData.get('teacher_name'),
      kelas: formData.get('kelas'),
      telegram_id: userId
    };

    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingData)
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setStep('date');
        fetchAllAvailability();
        
        const timeSlot = `${formatHour(selectedHour)} - ${formatHour(selectedHour + 30)}`;
        const formattedDate = format(currentDate, 'dd/MM/yyyy');
        const payload = `Hi ${userName}~ Tempahan anda telah berjaya! Bilik: ${selectedRoom.name}. Sesi: ${timeSlot}. Sebab: ${bookingData.reason}. Guru: ${bookingData.teacher_name}.`;
        
        if (tg.isVersionAtLeast && tg.isVersionAtLeast('6.2') && tg.showPopup) {
          tg.showPopup({
            title: 'Tempahan Berjaya!',
            message: `Tempahan anda untuk ${selectedRoom.name} pada ${formattedDate} telah direkodkan ke dalam sistem.`,
            buttons: [{ type: 'default', text: 'OK' }]
          }, () => {
            try {
              if (tg.sendData) {
                tg.sendData(payload);
              } else if (tg.close) {
                tg.close();
              }
            } catch (e) {
              console.error("Failed to send data to Telegram", e);
              if (tg.close) tg.close();
            }
          });
        } else {
          showToast('Tempahan Berjaya!', 'success');
          setTimeout(() => {
            try {
              if (tg.sendData) {
                tg.sendData(payload);
              } else if (tg.close) {
                tg.close();
              }
            } catch (e) {
              console.error("Failed to send data to Telegram", e);
              if (tg.close) tg.close();
            }
          }, 1500); // Wait for toast to be visible before closing
        }
      } else {
        if (res.status === 409) {
          showToast('Maaf, slot ini baru sahaja ditempah oleh orang lain. Sila pilih slot lain.', 'error');
        } else {
          showToast(data.error || 'Gagal membuat tempahan', 'error');
        }
      }
    } catch (error) {
      showToast('Ralat berlaku semasa membuat tempahan', 'error');
    }
  };

  const handleDeleteBooking = async (bookingId: number) => {
    try {
      const res = await fetch(`/api/book/${bookingId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_name: userName })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        // Optimistic state update
        setAvailability(prev => {
          const newAvailability = { ...prev };
          for (const roomName in newAvailability) {
            newAvailability[roomName] = newAvailability[roomName].map(slot => {
              if (slot.booking?.id === bookingId) {
                return { ...slot, isBooked: false, booking: null };
              }
              return slot;
            });
          }
          return newAvailability;
        });
        showToast('Tempahan Dipadam', 'success');
      } else {
        showToast(data.error || 'Gagal memadam tempahan', 'error');
      }
    } catch (error) {
      showToast('Ralat berlaku semasa memadam tempahan', 'error');
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMsg = chatInput;
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    // 🔥 FORCE REFRESH DATA
    window.dispatchEvent(new Event('bookings_changed'));
    setChatInput('');
    setIsAiTyping(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userMsg,
          date: format(currentDate, 'yyyy-MM-dd')
        })
      });
      
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'ai', text: data.reply }]);
    } catch (error) {
      setChatMessages(prev => [...prev, { role: 'ai', text: 'Maaf, saya menghadapi ralat. Sila cuba lagi.' }]);
    } finally {
      setIsAiTyping(false);
    }
  };

  const renderCalendar = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = subDays(monthStart, monthStart.getDay());
    const endDate = addDays(monthEnd, 6 - monthEnd.getDay());
    const dateFormat = "d";
    const rows = [];
    let days = [];
    let day = startDate;
    let formattedDate = "";

    const weekDays = ['Ah', 'Is', 'Se', 'Ra', 'Kh', 'Ju', 'Sa'];

    while (day <= endDate) {
      for (let i = 0; i < 7; i++) {
        formattedDate = format(day, dateFormat);
        const cloneDay = day;
        const isCurrentMonth = isSameMonth(day, monthStart);
        const isWeekendDay = isWeekend(day);
        const isSelected = isSameDay(day, currentDate);
        const isTodayDate = isToday(day);
        
        // Check if the day is in the past (before Feb 25, 2026)
        const minDate = new Date('2026-02-25T00:00:00');
        const isPastDate = isBefore(startOfDay(day), minDate);
        
        const isDisabled = isWeekendDay || isPastDate;

        days.push(
          <button
            key={day.toString()}
            onClick={() => !isDisabled && handleDaySelect(cloneDay)}
            disabled={isDisabled || !isCurrentMonth}
            className={`
              p-3 sm:p-4 w-full flex flex-col items-center justify-center rounded-2xl transition-all
              ${!isCurrentMonth ? 'opacity-30 text-tg-hint' : 'text-tg-text'}
              ${isDisabled ? 'text-tg-hint bg-tg-secondary-bg cursor-not-allowed opacity-60' : 'hover:bg-tg-button/10 hover:text-tg-button'}
              ${isSelected && isCurrentMonth && !isDisabled ? 'bg-tg-button text-tg-button-text shadow-md hover:bg-tg-button hover:text-tg-button-text' : ''}
              ${isTodayDate && !isSelected ? 'border-2 border-tg-button text-tg-button font-bold bg-tg-button/5' : ''}
            `}
          >
            <span className={`text-lg sm:text-xl ${isSelected && !isDisabled ? 'font-semibold' : ''}`}>{formattedDate}</span>
          </button>
        );
        day = addDays(day, 1);
      }
      rows.push(
        <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2" key={day.toString()}>
          {days}
        </div>
      );
      days = [];
    }

    return (
      <div className="bg-tg-bg p-4 sm:p-6 rounded-3xl shadow-sm border border-tg-hint/20">
        <div className="flex items-center justify-between mb-6">
          <button onClick={handlePrevMonth} className="p-2 hover:bg-tg-secondary-bg rounded-full text-tg-text transition-colors">
            <ChevronLeft size={24} />
          </button>
          <div className="text-xl font-semibold text-tg-text tracking-tight">
            {format(currentDate, 'MMMM yyyy')}
          </div>
          <button onClick={handleNextMonth} className="p-2 hover:bg-tg-secondary-bg rounded-full text-tg-text transition-colors">
            <ChevronRight size={24} />
          </button>
        </div>
        
        <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-4">
          {weekDays.map(day => (
            <div key={day} className="text-center text-xs font-semibold text-tg-hint uppercase tracking-wider py-2">
              {day}
            </div>
          ))}
        </div>
        {rows}
      </div>
    );
  };

  const formatHour = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : h;
    const displayM = m.toString().padStart(2, '0');
    return `${displayH}:${displayM} ${ampm}`;
  };

  return (
    <div className="min-h-screen bg-tg-secondary-bg text-tg-text font-sans pb-20">
      {/* Header */}
      <header className="bg-tg-bg px-4 py-4 shadow-sm sticky top-0 z-10">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-tg-text">Selamat Datang {userName}~</h1>
            <button 
              onClick={async () => {
                try {
                  showToast('Testing DB...', 'success');
                  const res = await fetch('/api/test-db');
                  const data = await res.json();
                  if (res.ok) {
                    showToast('DB Connected!', 'success');
                    console.log('DB Test:', data);
                  } else {
                    showToast(`DB Error: ${data.message}`, 'error');
                  }
                } catch (err: any) {
                  showToast(`Request failed: ${err.message}`, 'error');
                }
              }}
              className="text-[10px] bg-tg-button text-tg-button-text px-2 py-1 rounded-md opacity-50 hover:opacity-100"
            >
              Test DB
            </button>
          </div>
          <div className="flex space-x-2 bg-tg-hint/10 p-1 rounded-lg">
            <button 
              onClick={() => setActiveTab('calendar')}
              className={`p-2 rounded-md transition-colors ${activeTab === 'calendar' ? 'bg-tg-bg shadow-sm text-tg-button' : 'text-tg-hint'}`}
            >
              <CalendarIcon size={20} />
            </button>
            <button 
              onClick={() => setActiveTab('ai')}
              className={`p-2 rounded-md transition-colors ${activeTab === 'ai' ? 'bg-tg-bg shadow-sm text-tg-button' : 'text-tg-hint'}`}
            >
              <MessageSquare size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="p-4 max-w-3xl mx-auto">
        {activeTab === 'calendar' ? (
          <div className="space-y-6">
            {step === 'date' ? (
              <>
                <div className="text-center mb-8 mt-4">
                  <h2 className="text-3xl font-light text-tg-text tracking-tight">Langkah 1: Pilih Tarikh</h2>
                  <p className="text-tg-hint mt-2">Pilih hari bekerja untuk melihat ruang yang tersedia.</p>
                </div>
                {renderCalendar()}
              </>
            ) : step === 'location' ? (
              <>
                {/* Date Header */}
                <div className="flex items-center justify-between bg-tg-bg p-4 rounded-2xl shadow-sm border border-tg-hint/20">
                  <button 
                    onClick={() => setStep('date')} 
                    className="flex items-center text-tg-hint hover:text-tg-button transition-colors font-medium"
                    title="Kembali ke langkah sebelumnya."
                  >
                    <ArrowLeft size={20} className="mr-2" />
                    Kembali
                  </button>
                  <div className="text-right">
                    <div className="text-xs text-tg-hint font-semibold uppercase tracking-wider">
                      {format(currentDate, 'EEEE')}
                    </div>
                    <div className="text-lg font-semibold text-tg-text">
                      {format(currentDate, 'MMM d, yyyy')}
                    </div>
                  </div>
                </div>

                {/* Rooms List */}
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold text-tg-text px-1">Langkah 2: Pilih Lokasi</h2>
                  
                  {isWeekend(currentDate) ? (
                    <div className="text-center py-12 bg-tg-bg rounded-2xl border border-tg-hint/20 shadow-sm">
                      <div className="text-tg-hint mb-2">
                        <CalendarIcon size={48} className="mx-auto opacity-50" />
                      </div>
                      <h3 className="text-lg font-medium text-tg-text">Ditutup</h3>
                      <p className="text-sm text-tg-hint mt-1">Tempahan hanya dibuka pada hari Isnin hingga Jumaat.</p>
                    </div>
                  ) : loading ? (
                    <div className="text-center py-8 text-tg-hint">Memuatkan ruang...</div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {rooms.map(room => (
                        <button 
                          key={room.id} 
                          onClick={() => {
                            setSelectedRoom(room);
                            setStep('time');
                          }}
                          className="bg-tg-bg rounded-2xl p-5 shadow-sm border border-tg-hint/20 hover:border-tg-button hover:shadow-md transition-all text-left flex justify-between items-center group"
                        >
                          <div>
                            <h3 className="font-semibold text-tg-text text-xl group-hover:text-tg-button">{room.name}</h3>
                            <div className="flex items-center text-sm text-tg-hint mt-1.5 space-x-4">
                              <span className="flex items-center"><Users size={16} className="mr-1.5 opacity-70"/> {room.capacity} pax</span>
                              <span className="flex items-center capitalize"><MapPin size={16} className="mr-1.5 opacity-70"/> {room.type}</span>
                            </div>
                          </div>
                          <ChevronRight size={24} className="text-tg-hint group-hover:text-tg-button" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : step === 'time' ? (
              <>
                {/* Date & Location Header */}
                <div className="flex items-center justify-between bg-tg-bg p-4 rounded-2xl shadow-sm border border-tg-hint/20">
                  <button 
                    onClick={() => setStep('location')} 
                    className="flex items-center text-tg-hint hover:text-tg-button transition-colors font-medium"
                    title="Kembali ke langkah sebelumnya."
                  >
                    <ArrowLeft size={20} className="mr-2" />
                    Kembali
                  </button>
                  <div className="text-right">
                    <div className="text-xs text-tg-hint font-semibold uppercase tracking-wider">
                      {format(currentDate, 'MMM d, yyyy')}
                    </div>
                    <div className="text-lg font-semibold text-tg-text">
                      {selectedRoom?.name}
                    </div>
                  </div>
                </div>

                {/* Time Slots */}
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold text-tg-text px-1">Langkah 3: Pilih Masa</h2>
                  
                  {loading ? (
                    <div className="text-center py-8 text-tg-hint">Memuatkan masa...</div>
                  ) : selectedRoom ? (
                    <div className="bg-tg-bg rounded-2xl p-5 shadow-sm border border-tg-hint/20">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {Array.isArray(availability[selectedRoom.name]) ? availability[selectedRoom.name].map(slot => {
                          const startStr = formatHour(slot.hour);
                          const endStr = formatHour(slot.hour + 30);
                          
                          if (slot.isBooked && slot.booking) {
                            const isOwnBooking = slot.booking.user_name === userName;
                            return (
                              <div key={slot.hour} className="flex flex-col p-3.5 bg-red-50 rounded-xl border border-red-100 opacity-80 relative group">
                                <div className="flex justify-between items-center mb-1.5">
                                  <span className="font-mono text-sm font-medium text-red-800">{startStr} - {endStr}</span>
                                  <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded uppercase tracking-wider">Ditempah</span>
                                </div>
                                <div className="text-sm text-red-900 font-medium truncate pr-6">{slot.booking.user_name}</div>
                                <div className="text-xs text-red-700 mt-0.5 truncate pr-6">{slot.booking.reason}</div>
                                {isOwnBooking && slot.booking.id && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeleteConfirmation(slot.booking!.id!);
                                    }}
                                    className="absolute bottom-3 right-3 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                                    title="Batal Tempahan"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                            );
                          } else {
                            return (
                              <button 
                                key={slot.hour}
                                onClick={() => { setSelectedHour(slot.hour); setStep('confirm'); }}
                                className="flex justify-between items-center p-3.5 bg-tg-bg hover:bg-emerald-50 rounded-xl border border-tg-hint/20 hover:border-emerald-200 transition-all text-left group hover:shadow-sm"
                              >
                                <span className="font-mono text-sm font-medium text-tg-text group-hover:text-emerald-700">{startStr} - {endStr}</span>
                                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded uppercase tracking-wider group-hover:bg-emerald-100">Tersedia</span>
                              </button>
                            );
                          }
                        }) : (
                          <div className="col-span-1 sm:col-span-2 text-sm text-red-500 p-4 bg-red-50 rounded-xl border border-red-100">
                            Gagal mendapatkan ketersediaan bilik ini. Sila cuba sebentar lagi.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                {/* Confirm Step */}
                <div className="flex items-center justify-between bg-tg-bg p-4 rounded-2xl shadow-sm border border-tg-hint/20">
                  <button 
                    onClick={() => setStep('time')} 
                    className="flex items-center text-tg-hint hover:text-tg-button transition-colors font-medium"
                    title="Kembali ke langkah sebelumnya."
                  >
                    <ArrowLeft size={20} className="mr-2" />
                    Kembali
                  </button>
                  <div className="text-right">
                    <div className="text-xs text-tg-hint font-semibold uppercase tracking-wider">
                      Langkah 4: Sahkan Tempahan
                    </div>
                    <div className="text-lg font-semibold text-tg-text">
                      {selectedRoom?.name}
                    </div>
                  </div>
                </div>

                <div className="bg-tg-bg rounded-2xl p-5 shadow-sm border border-tg-hint/20">
                  <form onSubmit={handleBookRoom} className="space-y-4">
                    <div className="bg-tg-secondary-bg p-3 rounded-xl border border-tg-hint/10 mb-4">
                      <div className="text-xs text-tg-hint uppercase tracking-wider mb-1">Masa Dipilih</div>
                      <div className="font-mono font-medium text-tg-text">
                        {selectedHour !== null ? `${formatHour(selectedHour)} - ${formatHour(selectedHour + 30)}` : ''}
                      </div>
                      <div className="text-xs text-tg-hint uppercase tracking-wider mt-3 mb-1">Tarikh</div>
                      <div className="font-medium text-tg-text">
                        {format(currentDate, 'MMM d, yyyy')}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-tg-hint mb-1 uppercase tracking-wider">Tujuan Tempahan</label>
                      <input 
                        type="text" 
                        name="reason"
                        required
                        placeholder="Cth., Mesyuarat Panitia"
                        className="w-full bg-tg-secondary-bg border border-tg-hint/20 rounded-xl px-4 py-2.5 text-tg-text focus:outline-none focus:ring-2 focus:ring-tg-button"
                      />
                    </div>

                    <div className="mt-4">
                      <label className="block text-xs font-medium text-tg-hint mb-1 uppercase tracking-wider">
                        Nama Guru
                      </label>
                    
                      <input 
                        type="text" 
                        name="teacher_name"
                        required
                        placeholder="Cth., Cikgu Ahmad"
                        className="w-full bg-tg-secondary-bg border border-tg-hint/20 rounded-xl px-4 py-2.5 text-tg-text focus:outline-none focus:ring-2 focus:ring-tg-button"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-tg-hint mb-1 uppercase tracking-wider">
                        Kelas
                      </label>
                    
                      <input 
                        type="text" 
                        name="kelas"
                        required
                        placeholder="Cth., 5 Amanah"
                        className="w-full bg-tg-secondary-bg border border-tg-hint/20 rounded-xl px-4 py-2.5 text-tg-text focus:outline-none focus:ring-2 focus:ring-tg-button"
                      />
                    </div>

                    <button 
                      type="submit"
                      className="w-full bg-tg-button text-tg-button-text font-medium py-3 rounded-xl hover:opacity-90 transition-opacity mt-6 shadow-sm"
                    >
                      Sahkan Tempahan
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col h-[calc(100vh-140px)]">
            <div className="bg-tg-button/10 rounded-xl p-4 mb-4 border border-tg-button/20">
              <div className="flex items-center space-x-3">
                <div className="bg-tg-button/20 p-2 rounded-full text-tg-button">
                  <MessageSquare size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-tg-text">Pembantu AI</h3>
                  <p className="text-xs text-tg-hint">Tanya saya tentang bilik yang tersedia untuk {format(currentDate, 'MMM d')}</p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 mb-4 px-1">
              {chatMessages.length === 0 && (
                <div className="text-center text-tg-hint text-sm mt-10">
                  Cuba tanya: "Bilik apa yang kosong pada pukul 2 petang ini?" atau "Saya perlukan bilik untuk 10 orang."
                </div>
              )}
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl p-3 text-sm ${
                    msg.role === 'user' 
                      ? 'bg-tg-button text-tg-button-text rounded-tr-sm' 
                      : 'bg-tg-bg border border-tg-hint/20 text-tg-text rounded-tl-sm shadow-sm'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isAiTyping && (
                <div className="flex justify-start">
                  <div className="bg-tg-bg border border-tg-hint/20 rounded-2xl rounded-tl-sm p-3 shadow-sm flex space-x-1">
                    <div className="w-2 h-2 bg-tg-hint/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-tg-hint/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-tg-hint/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={handleSendMessage} className="flex space-x-2 mt-auto">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Tanya tentang ketersediaan bilik..."
                className="flex-1 bg-tg-bg border border-tg-hint/20 rounded-xl px-4 py-3 text-sm text-tg-text focus:outline-none focus:ring-2 focus:ring-tg-button focus:border-transparent shadow-sm"
              />
              <button 
                type="submit"
                disabled={!chatInput.trim() || isAiTyping}
                className="bg-tg-button text-tg-button-text p-3 rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-opacity"
              >
                <MessageSquare size={20} />
              </button>
            </form>
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      {deleteConfirmation && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-tg-bg rounded-2xl w-full max-w-sm overflow-hidden shadow-xl">
            <div className="p-5">
              <h3 className="text-lg font-bold text-tg-text mb-2">Batal Tempahan</h3>
              <p className="text-tg-hint text-sm mb-6">Adakah anda pasti mahu memadam tempahan ini?</p>
              <div className="flex space-x-3">
                <button
                  onClick={() => setDeleteConfirmation(null)}
                  className="flex-1 py-2.5 px-4 bg-tg-secondary-bg text-tg-text font-medium rounded-xl hover:opacity-80 transition-opacity"
                >
                  Kembali
                </button>
                <button
                  onClick={() => {
                    handleDeleteBooking(deleteConfirmation);
                    setDeleteConfirmation(null);
                  }}
                  className="flex-1 py-2.5 px-4 bg-red-600 text-white font-medium rounded-xl hover:bg-red-700 transition-colors"
                >
                  Padam
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className={`px-4 py-3 rounded-xl shadow-lg font-medium text-sm flex items-center space-x-2 ${
            toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          }`}>
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
