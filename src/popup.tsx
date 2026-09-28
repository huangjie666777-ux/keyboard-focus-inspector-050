import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getActiveTab, sendToTab, type ActiveTabInfo } from './bridge';
import type { FocusRecord, FocusSource, InspectionStatus } from './types';

const SOURCE_LABEL: Record<FocusSource, string> = {
  tab: 'Tab',
  shiftTab: 'Shift+Tab',
  mouse: '鼠标',
  other: '其他',
};

const STATUS_LABEL: Record<InspectionStatus, string> = {
  idle: '未开始',
  running: '巡检中',
  paused: '已暂停',
};

function formatTime(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

function App(): React.JSX.Element {
  const [tab, setTab] = useState<ActiveTabInfo | null>(null);
  const [status, setStatus] = useState<InspectionStatus>('idle');
  const [records, setRecords] = useState<FocusRecord[]>([]);
  const [issueOnly, setIssueOnly] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);

  const refresh = useCallback(async (inject = false) => {
    const active = await getActiveTab();
    setTab(active);
    if (!active) return;
    if (!active.injectable) {
      setStatus('idle');
      setRecords([]);
      return;
    }
    try {
      const response = await sendToTab(active.id, { type: 'GET_STATE' }, inject);
      if (response.state) {
        setStatus(response.state.status);
        setRecords(response.state.records);
      }
      setError('');
    } catch {
      setStatus('idle');
      setRecords([]);
    }
  }, []);

  useEffect(() => {
    void refresh().then(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (status !== 'running') return;
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [status, refresh]);

  const command = useCallback(
    async (type: 'START' | 'PAUSE' | 'CLEAR') => {
      if (!tab?.injectable) return;
      setError('');
      try {
        const response = await sendToTab(tab.id, { type }, type === 'START');
        if (response.state) {
          setStatus(response.state.status);
          setRecords(response.state.records);
        }
        if (type === 'CLEAR') setSelected(null);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [tab],
  );

  const locate = useCallback(
    async (record: FocusRecord) => {
      if (!tab?.injectable) return;
      setSelected(record.index);
      try {
        const response = await sendToTab(tab.id, { type: 'HIGHLIGHT', index: record.index });
        if (!response.found) {
          setRecords((prev) => prev.map((r) => (r.index === record.index ? { ...r, removed: true } : r)));
        }
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [tab],
  );

  const exportJson = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      pageUrl: tab?.url ?? '',
      records,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `focus-inspection-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [records, tab]);

  const visibleRecords = useMemo(() => (issueOnly ? records.filter((r) => r.issues.length > 0) : records), [records, issueOnly]);
  const issueCount = useMemo(() => records.filter((r) => r.issues.length > 0).length, [records]);

  if (loading) return <main className="panel"><p>正在读取当前标签页…</p></main>;

  return (
    <main className="panel">
      <header>
        <h1>键盘焦点巡检</h1>
        <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
      </header>

      {!tab?.injectable ? (
        <section className="notice">
          <strong>无法在此页面巡检</strong>
          <p>{tab?.reason ?? '找不到活动标签页'}</p>
          <p className="hint">请切换到 http:// 或 https:// 页面后重新打开弹窗。</p>
        </section>
      ) : (
        <>
          <section className="controls">
            <button type="button" onClick={() => void command('START')} disabled={status === 'running'}>
              开始
            </button>
            <button type="button" onClick={() => void command('PAUSE')} disabled={status !== 'running'}>
              暂停
            </button>
            <button type="button" onClick={() => void command('CLEAR')}>
              清空
            </button>
            <button type="button" onClick={exportJson} disabled={records.length === 0}>
              导出 JSON
            </button>
          </section>

          <section className="meta">
            <label className="filter">
              <input type="checkbox" checked={issueOnly} onChange={(e) => setIssueOnly(e.target.checked)} />
              只看问题（{issueCount}/{records.length}）
            </label>
          </section>

          {error && <p className="error">{error}</p>}

          <p className="hint">仅检查顶层普通 DOM；iframe 与 Shadow DOM 内的焦点不会被记录。关闭弹窗后巡检继续，重开弹窗自动恢复；整页导航会清空并停止。</p>

          {visibleRecords.length === 0 ? (
            <p className="empty">暂无焦点记录。点击“开始”后，在页面中用 Tab 或鼠标移动焦点。</p>
          ) : (
            <ol className="record-list">
              {visibleRecords.map((record) => (
                <li key={record.index}>
                  <button
                    type="button"
                    className={`record ${selected === record.index ? 'selected' : ''}`}
                    onClick={() => void locate(record)}
                  >
                    <span className="record-head">
                      <span className="index">#{record.index}</span>
                      <span className="tag">{record.tag}</span>
                      <span className={`source source-${record.source}`}>{SOURCE_LABEL[record.source]}</span>
                      {record.removed && <span className="removed">已移除</span>}
                    </span>
                    <span className="name">{record.name || <em>（无名称）</em>}</span>
                    <span className="time">{formatTime(record.timestamp)} · 名称来源：{record.nameSource}</span>
                    {record.issues.length > 0 && (
                      <span className="issues">
                        {record.issues.map((issue) => (
                          <span className="issue" key={issue.code} title={issue.reason}>
                            {issue.label}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </main>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
