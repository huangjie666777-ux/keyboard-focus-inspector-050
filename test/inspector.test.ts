// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusInspector, detectIssues, resolveName } from '../src/inspector';

function focus(el: Element): void {
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
}

describe('resolveName', () => {
  it('按 aria-labelledby → aria-label → label → 文本顺序取名，且不读取输入值', () => {
    document.body.innerHTML = `
      <span id="lbl">来自引用</span>
      <input id="a" aria-labelledby="lbl" value="secret" />
      <input id="b" aria-label="直接标签" value="secret" />
      <label for="c">关联文字<input id="c" value="secret" /></label>
      <button id="d">按钮文字</button>
      <input id="e" value="secret" />
    `;
    expect(resolveName(document.getElementById('a')!, document).name).toBe('来自引用');
    expect(resolveName(document.getElementById('a')!, document).nameSource).toBe('aria-labelledby');
    expect(resolveName(document.getElementById('b')!, document).name).toBe('直接标签');
    expect(resolveName(document.getElementById('c')!, document).name).toBe('关联文字');
    expect(resolveName(document.getElementById('d')!, document).name).toBe('按钮文字');
    const empty = resolveName(document.getElementById('e')!, document);
    expect(empty.name).toBe('');
  });
});

describe('detectIssues', () => {
  it('标记正 tabindex、aria-hidden 祖先、无名称按钮/链接', () => {
    document.body.innerHTML = `
      <button id="p" tabindex="3">x</button>
      <div aria-hidden="true"><button id="h">y</button></div>
      <button id="u"></button>
      <a id="l" href="#"></a>
      <button id="ok" tabindex="0">正常</button>
    `;
    expect(detectIssues(document.getElementById('p')!).map((i) => i.code)).toContain('POSITIVE_TABINDEX');
    const hiddenIssues = detectIssues(document.getElementById('h')!).map((i) => i.code);
    expect(hiddenIssues).toContain('ARIA_HIDDEN_ANCESTOR');
    expect(detectIssues(document.getElementById('u')!).map((i) => i.code)).toContain('UNNAMED_ACTIONABLE');
    expect(detectIssues(document.getElementById('l')!).map((i) => i.code)).toContain('UNNAMED_ACTIONABLE');
    expect(detectIssues(document.getElementById('ok')!)).toHaveLength(0);
  });
});

describe('FocusInspector', () => {
  let inspector: FocusInspector;

  beforeEach(() => {
    document.body.innerHTML = '';
    inspector = new FocusInspector(document);
  });

  afterEach(() => {
    inspector.clear();
  });

  it('开始后记录 focusin，暂停不记录，重复开始不重复监听', () => {
    const button = document.createElement('button');
    button.textContent = '测试';
    document.body.appendChild(button);

    inspector.start();
    inspector.start();
    focus(button);
    let state = inspector.getState();
    expect(state.records).toHaveLength(1);
    expect(state.status).toBe('running');

    inspector.pause();
    focus(button);
    state = inspector.getState();
    expect(state.records).toHaveLength(1);
    expect(state.status).toBe('paused');
  });

  it('区分 Tab、Shift+Tab、鼠标和其他来源', () => {
    vi.useFakeTimers();
    const button = document.createElement('button');
    button.textContent = 'b';
    document.body.appendChild(button);
    inspector.start();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    focus(button);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    focus(button);
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    focus(button);
    vi.advanceTimersByTime(1500);
    focus(button);

    const sources = inspector.getState().records.map((r) => r.source);
    expect(sources).toEqual(['tab', 'shiftTab', 'mouse', 'other']);
    vi.useRealTimers();
  });

  it('删除节点标记已移除，插回同一节点仍可定位；新建同选择器节点不会误定位', () => {
    const button = document.createElement('button');
    button.id = 'same';
    button.textContent = '原始节点';
    document.body.appendChild(button);
    inspector.start();
    focus(button);

    expect(inspector.highlight(1)).toBe(true);
    button.remove();
    expect(inspector.highlight(1)).toBe(false);
    expect(inspector.getState().records[0].removed).toBe(true);

    const replacement = document.createElement('button');
    replacement.id = 'same';
    replacement.textContent = '原始节点';
    document.body.appendChild(replacement);
    expect(inspector.highlight(1)).toBe(false);

    document.body.appendChild(button);
    expect(inspector.highlight(1)).toBe(true);
    expect(inspector.getState().records[0].removed).toBe(false);
  });

  it('清空会移除记录与描边效果', () => {
    const button = document.createElement('button');
    button.textContent = 'b';
    document.body.appendChild(button);
    inspector.start();
    focus(button);
    inspector.highlight(1);
    expect(document.getElementById('__kfi-highlight-box')).not.toBeNull();

    inspector.clear();
    expect(inspector.getState().records).toHaveLength(0);
    expect(document.getElementById('__kfi-highlight-box')).toBeNull();
    expect(button.hasAttribute('data-kfi-highlight')).toBe(false);
  });

  it('忽略扩展自身 UI 上的 focusin', () => {
    const own = document.createElement('button');
    own.setAttribute('data-kfi-extension-ui', '');
    document.body.appendChild(own);
    inspector.start();
    focus(own);
    expect(inspector.getState().records).toHaveLength(0);
  });

  it('快照保留历史名称与问题，不受后续属性变化影响', () => {
    const button = document.createElement('button');
    button.textContent = '旧名称';
    button.setAttribute('tabindex', '2');
    document.body.appendChild(button);
    inspector.start();
    focus(button);

    button.textContent = '新名称';
    button.removeAttribute('tabindex');
    const record = inspector.getState().records[0];
    expect(record.name).toBe('旧名称');
    expect(record.issues.map((i) => i.code)).toContain('POSITIVE_TABINDEX');
  });

  it('时间来源超过窗口后归类为其他', () => {
    vi.useFakeTimers();
    const timed = new FocusInspector(document, { now: () => Date.now() });
    const button = document.createElement('button');
    button.textContent = 'b';
    document.body.appendChild(button);
    timed.start();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    vi.advanceTimersByTime(1500);
    focus(button);
    expect(timed.getState().records[0].source).toBe('other');
    timed.clear();
    vi.useRealTimers();
  });
});
