import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { Send, Search, Calendar as CalendarIcon, Hash, X } from 'lucide-react';
import { getMemos, addMemo, Memo, getMemosByDate, getMemosByTag, getMemosByQuery, getDatesWithMemos } from './lib/db';

const extractTags = (text: string): string[] => {
  const matches = text.match(/#[\w\u3040-\u30FF\u4E00-\u9FFF]+/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map(tag => tag.slice(1))));
};

function App() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set());
  
  // Filters
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Input
  const [inputText, setInputText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadMemos();
    loadActiveDates();
  }, [filterDate, filterTag, searchQuery]);

  useEffect(() => {
    scrollToBottom();
  }, [memos]);

  const loadMemos = async () => {
    try {
      if (filterDate) {
        setMemos(await getMemosByDate(filterDate));
      } else if (filterTag) {
        setMemos(await getMemosByTag(filterTag));
      } else if (searchQuery.trim()) {
        setMemos(await getMemosByQuery(searchQuery.trim()));
      } else {
        setMemos(await getMemos());
      }
    } catch (e: any) {
      console.error("Failed to load memos", e);
      alert(`Error loading memos: ${e?.message || e}`);
    }
  };

  const loadActiveDates = async () => {
    try {
      const dates = await getDatesWithMemos();
      setActiveDates(new Set(dates));
    } catch (e) {
      console.error("Failed to load dates", e);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const handleSubmit = async () => {
    if (!inputText.trim() || isSubmitting) return;

    setIsSubmitting(true);
    console.log("Submitting memo: ", inputText);
    try {
      const tags = extractTags(inputText);
      await addMemo(inputText.trim(), tags);
      console.log("Memo added");
      setInputText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      await loadMemos();
      await loadActiveDates();
    } catch (e: any) {
      console.error("Failed to add memo", e);
      alert(`Error saving memo: ${e?.message || e}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return; // Prevent submission during Japanese IME conversion
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const clearFilters = () => {
    setFilterDate(null);
    setFilterTag(null);
    setSearchQuery('');
  };

  const renderTextWithTags = (text: string) => {
    const parts = text.split(/(#[\w\u3040-\u30FF\u4E00-\u9FFF]+)/g);
    return parts.map((part, index) => {
      if (part.startsWith('#')) {
        return (
          <span 
            key={index} 
            className="tag-highlight"
            onClick={() => {
              clearFilters();
              setFilterTag(part.slice(1));
            }}
          >
            {part}
          </span>
        );
      }
      return part;
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr + "Z");
    return new Intl.DateTimeFormat('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  // Calendar rendering logic
  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="cal-day empty"></div>);
    }
    
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const hasMemos = activeDates.has(dateStr);
      const isSelected = filterDate === dateStr;
      
      days.push(
        <div 
          key={dateStr} 
          className={`cal-day ${hasMemos ? 'has-memos' : ''} ${isSelected ? 'selected' : ''}`}
          onClick={() => {
            clearFilters();
            setFilterDate(isSelected ? null : dateStr);
          }}
        >
          {i}
          {hasMemos && <span className="cal-dot"></span>}
        </div>
      );
    }

    return (
      <div className="calendar-widget">
        <div className="cal-header">
          <button onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}>&lt;</button>
          <span>{year}年 {month + 1}月</span>
          <button onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}>&gt;</button>
        </div>
        <div className="cal-grid">
          {['日', '月', '火', '水', '木', '金', '土'].map(d => (
            <div key={d} className="cal-day-name">{d}</div>
          ))}
          {days}
        </div>
      </div>
    );
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h1>ChatLikeMemo</h1>
        </div>
        
        <div className="sidebar-content">
          <div className="search-widget">
            <div className="search-input-wrapper">
              <Search size={16} />
              <input 
                type="text" 
                placeholder="Search memos..." 
                value={searchQuery}
                onChange={e => {
                  setFilterDate(null);
                  setFilterTag(null);
                  setSearchQuery(e.target.value);
                }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="clear-btn">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="widget-title">
            <CalendarIcon size={16} />
            <span>Calendar</span>
          </div>
          {renderCalendar()}
        </div>
      </div>

      <div className="main-content">
        <div className="chat-header">
          <div className="active-filter">
            {filterDate && <span><CalendarIcon size={16}/> {filterDate}</span>}
            {filterTag && <span><Hash size={16}/> {filterTag}</span>}
            {searchQuery && <span><Search size={16}/> "{searchQuery}"</span>}
            {!filterDate && !filterTag && !searchQuery && <span>All Memos</span>}
            
            {(filterDate || filterTag || searchQuery) && (
              <button className="clear-filter-btn" onClick={clearFilters}>
                Clear Filter <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="chat-messages">
          {memos.length === 0 ? (
            <div className="empty-state">
              No memos found. Let's write something!
            </div>
          ) : (
            memos.map((memo) => (
              <div key={memo.id} className="message-bubble">
                <div className="message-content">
                  {renderTextWithTags(memo.content)}
                </div>
                <span className="message-time">{formatTime(memo.created_at)}</span>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-container">
          <div className="input-box">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="What's on your mind? Use #tags (Shift + Enter to send)"
              rows={1}
              disabled={isSubmitting}
            />
            <button 
              className="send-button" 
              onClick={handleSubmit}
              disabled={!inputText.trim() || isSubmitting}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
