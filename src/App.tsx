import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { Send, Search, Calendar as CalendarIcon, Hash, X, ImagePlus, FileImage, Download, Upload } from 'lucide-react';
import { getMemos, addMemo, Memo, getMemosByDate, getMemosByTag, getMemosByQuery, getDatesWithMemos, saveMediaFile, getAllTags, Tag } from './lib/db';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';

export type PendingFile = {
    file?: File;
    path?: string;
    name: string;
    type: 'image' | 'video';
};

const extractTags = (text: string): string[] => {
  const matches = text.match(/(?<=^|\s)#([\w\u3040-\u30FF\u4E00-\u9FFF]+)/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map(tag => tag.slice(1))));
};

const preprocessMarkdown = (text: string) => {
  return text.replace(/(?<=^|\s)#([\w\u3040-\u30FF\u4E00-\u9FFF]+)/g, '[#$1](#search-$1)');
};

function App() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set());
  const [allTags, setAllTags] = useState<Tag[]>([]);
  
  // Filters
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Input
  const [inputText, setInputText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<PendingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadMemos();
    loadActiveDates();
    loadAllTags();
  }, [filterDate, filterTag, searchQuery]);

  useEffect(() => {
    scrollToBottom();
  }, [memos]);

  const loadAllTags = async () => {
    try {
      const tags = await getAllTags();
      setAllTags(tags);
    } catch (e) {
      console.error(e);
    }
  };

  // Native Tauri File Drop
  useEffect(() => {
    let unlistenFunctions: (() => void)[] = [];
    let isMounted = true;

    const setup = async () => {
        const uE = await listen('tauri://drag-enter', () => setIsDragging(true));
        if (isMounted) unlistenFunctions.push(uE); else uE();
        
        const uL = await listen('tauri://drag-leave', () => setIsDragging(false));
        if (isMounted) unlistenFunctions.push(uL); else uL();
        
        const uD = await listen<{paths: string[]}>('tauri://drag-drop', (e) => {
            setIsDragging(false);
            if (e.payload.paths && e.payload.paths.length > 0) {
                const newFiles = e.payload.paths
                    .filter(p => p.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|mov)$/i))
                    .map(p => ({
                        path: p,
                        name: p.split(/[/\\]/).pop() || 'file',
                        type: p.match(/\.(mp4|webm|mov)$/i) ? 'video' : 'image' as any
                    }));
                setPendingMedia(prev => {
                    // Duplication guard for safety
                    const existingPaths = new Set(prev.map(f => f.path).filter(Boolean));
                    const uniqueNewFiles = newFiles.filter(f => !existingPaths.has(f.path));
                    return [...prev, ...uniqueNewFiles];
                });
            }
        });
        if (isMounted) unlistenFunctions.push(uD); else uD();
    };
    setup();

    return () => {
        isMounted = false;
        unlistenFunctions.forEach(unlisten => unlisten());
    };
  }, []);

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

  const handlePaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      const newFiles = Array.from(e.clipboardData.files).map(f => ({
          file: f,
          name: f.name,
          type: f.type.startsWith('video/') ? 'video' : 'image' as any
      }));
      setPendingMedia([...pendingMedia, ...newFiles]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).map(f => ({
          file: f,
          name: f.name,
          type: f.type.startsWith('video/') ? 'video' : 'image' as any
      }));
      setPendingMedia([...pendingMedia, ...newFiles]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePendingMedia = (idx: number) => {
    setPendingMedia(pendingMedia.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if ((!inputText.trim() && pendingMedia.length === 0) || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const tags = extractTags(inputText);
      
      const mediaRecords: {path: string, type: 'image'|'video'}[] = [];
      for (const pending of pendingMedia) {
          const path = await saveMediaFile(pending.file || pending.path!);
          mediaRecords.push({ path, type: pending.type });
      }

      await addMemo(inputText.trim(), tags, mediaRecords);
      
      setInputText('');
      setPendingMedia([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      await loadMemos();
      await loadActiveDates();
      await loadAllTags();
      setErrorMessage(null);
    } catch (e: any) {
      console.error("Failed to add memo", e);
      setErrorMessage(`Error saving: ${e?.message || e}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
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

  const exportMemosToMarkdown = async () => {
    try {
      const filePath = await save({
        filters: [{
          name: 'Markdown',
          extensions: ['md']
        }]
      });
      if (!filePath) return;

      let mdContent = `# ChatLikeMemo Export\n\n`;
      if (filterDate) mdContent += `**Filter:** Date: ${filterDate}\n\n`;
      if (filterTag) mdContent += `**Filter:** Tag: #${filterTag}\n\n`;
      if (searchQuery) mdContent += `**Filter:** Search: "${searchQuery}"\n\n`;

      memos.forEach(m => {
        mdContent += `### ${formatTime(m.created_at)}\n\n`;
        mdContent += `${m.content}\n\n`;
        if (m.media && m.media.length > 0) {
           mdContent += `*Attached Media: ${m.media.length} items*\n\n`;
        }
        mdContent += `---\n\n`;
      });

      await writeTextFile(filePath, mdContent);
      alert('Export successful!');
    } catch (e: any) {
      alert(`Export failed: ${e?.message || e}`);
    }
  };

  const importMemosFromMarkdown = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });
      if (!selected) return;

      const path = Array.isArray(selected) ? selected[0] : (selected as string);
      const content = await readTextFile(path);

      if (content.startsWith('# ChatLikeMemo Export')) {
        const chunks = content.split('---');
        let importedCount = 0;
        for (const chunk of chunks) {
          if (!chunk.trim() || chunk.trim() === '# ChatLikeMemo Export') continue;
          
          let text = chunk.trim();
          const lines = text.split('\n');
          if (lines[0].startsWith('### ')) {
            lines.shift();
            text = lines.join('\n').trim();
          }
          if (lines[0]?.startsWith('**Filter:**')) {
             lines.shift(); // Ignore filter headers
             text = lines.join('\n').trim();
          }
          
          text = text.replace(/\*Attached Media: \d+ items\*/g, '').trim();

          if (text) {
             const tags = extractTags(text);
             await addMemo(text, tags, []);
             importedCount++;
          }
        }
        alert(`Successfully imported ${importedCount} memos!`);
      } else {
        const tags = extractTags(content);
        await addMemo(content.trim(), tags, []);
        alert('Successfully imported Markdown as a new memo!');
      }

      await loadMemos();
      await loadActiveDates();
      await loadAllTags();
    } catch (e: any) {
      alert(`Import failed: ${e?.message || e}`);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr + "Z");
    return new Intl.DateTimeFormat('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date);
  };

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

          <div className="widget-title" style={{marginTop: 24}}>
            <Hash size={16} />
            <span>Tags</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {allTags.map(t => (
              <span 
                key={t.id} 
                style={{
                   padding: '4px 10px', 
                   borderRadius: '16px', 
                   fontSize: '0.8rem', 
                   cursor: 'pointer',
                   backgroundColor: filterTag === t.name ? 'var(--accent-color)' : 'var(--bg-primary)',
                   color: filterTag === t.name ? '#fff' : 'var(--text-secondary)',
                   border: `1px solid ${filterTag === t.name ? 'var(--accent-color)' : 'var(--border-color)'}`,
                   transition: 'all 0.2s',
                   userSelect: 'none'
                }}
                onClick={() => {
                  if (filterTag === t.name) {
                    setFilterTag(null);
                  } else {
                    clearFilters();
                    setFilterTag(t.name);
                  }
                }}
              >
                #{t.name}
              </span>
            ))}
            {allTags.length === 0 && <span style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>No tags yet</span>}
          </div>

          <div 
            className="widget-title action-item" 
            style={{marginTop: 32, cursor: 'pointer', color: 'var(--accent-color)'}} 
            onClick={exportMemosToMarkdown}
          >
            <Download size={16} />
            <span>Export to MD</span>
          </div>

          <div 
            className="widget-title action-item" 
            style={{marginTop: 8, cursor: 'pointer', color: 'var(--accent-color)'}} 
            onClick={importMemosFromMarkdown}
          >
            <Upload size={16} />
            <span>Import from MD</span>
          </div>
        </div>
      </div>

      <div className={`main-content ${isDragging ? 'dragging' : ''}`}>
        {isDragging && (
          <div className="drag-overlay">
            <div className="drag-message">Drop media here to attach</div>
          </div>
        )}
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
          {errorMessage && (
            <div style={{ background: '#fee2e2', color: '#dc2626', padding: '12px', margin: '16px', borderRadius: '8px', border: '1px solid #f87171' }}>
              <strong>Error:</strong> {errorMessage}
            </div>
          )}
          {memos.length === 0 ? (
            <div className="empty-state">
              No memos found. Let's write something!
            </div>
          ) : (
            memos.map((memo) => (
              <div key={memo.id} className="message-bubble">
                {memo.content && (
                  <div className="message-content markdown-body">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({node, href, children, ...props}) => {
                          if (href?.startsWith('#search-')) {
                            const tag = href.replace('#search-', '');
                            return (
                              <span 
                                className="tag-highlight" 
                                style={{cursor: 'pointer'}}
                                onClick={(e) => {
                                  e.preventDefault();
                                  clearFilters();
                                  setFilterTag(tag);
                                }}
                              >
                                {children}
                              </span>
                            );
                          }
                          return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>;
                        }
                      }}
                    >
                      {preprocessMarkdown(memo.content)}
                    </ReactMarkdown>
                  </div>
                )}
                
                {memo.media && memo.media.length > 0 && (
                  <div className="media-grid">
                    {memo.media.map(m => (
                      <div key={m.id} className="media-item">
                        {m.media_type === 'image' ? (
                          <img src={convertFileSrc(m.file_path)} alt="Attached" className="attached-media" />
                        ) : (
                          <video src={convertFileSrc(m.file_path)} controls className="attached-media" />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <span className="message-time">{formatTime(memo.created_at)}</span>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-container">
          {pendingMedia.length > 0 && (
            <div className="pending-media-preview">
              {pendingMedia.map((f, i) => (
                <div key={i} className="pending-media-item">
                  {f.path && f.type === 'image' ? (
                    <img src={convertFileSrc(f.path)} style={{width: 24, height: 24, borderRadius: 4, objectFit: 'cover'}} />
                  ) : <FileImage size={18} />}
                  <span>{f.name}</span>
                  <button onClick={() => removePendingMedia(i)}><X size={14}/></button>
                </div>
              ))}
            </div>
          )}

          <div className="input-box">
            <input 
              type="file" 
              multiple 
              accept="image/*,video/*" 
              ref={fileInputRef} 
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <button 
              className="attach-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSubmitting}
            >
              <ImagePlus size={18} />
            </button>
            
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="What's on your mind? Use #tags (Shift + Enter to send)"
              rows={1}
              disabled={isSubmitting}
            />
            
            <button 
              className="send-button" 
              onClick={handleSubmit}
              disabled={(!inputText.trim() && pendingMedia.length === 0) || isSubmitting}
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
