import type { FocusRecord, FocusSource, Issue, InspectionStatus } from './types';

const HIGHLIGHT_ATTR = 'data-kfi-highlight';
const HIGHLIGHT_BOX_ID = '__kfi-highlight-box';

export interface InspectorOptions {
  now?: () => number;
}

export class FocusInspector {
  status: InspectionStatus = 'idle';
  private records: FocusRecord[] = [];
  private nodes = new Map<number, WeakRef<Element>>();
  private lastInput: { time: number; source: Exclude<FocusSource, 'other'> } | null = null;
  private highlightedIndex: number | null = null;
  private rafId = 0;
  private boxEl: HTMLDivElement | null = null;

  constructor(private doc: Document, private opts: InspectorOptions = {}) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  start(): void {
    if (this.status === 'running') return;
    this.status = 'running';
    this.doc.addEventListener('focusin', this.onFocusIn, true);
    this.doc.addEventListener('keydown', this.onKeyDown, true);
    this.doc.addEventListener('mousedown', this.onMouseDown, true);
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.doc.removeEventListener('focusin', this.onFocusIn, true);
    this.doc.removeEventListener('keydown', this.onKeyDown, true);
    this.doc.removeEventListener('mousedown', this.onMouseDown, true);
  }

  clear(): void {
    this.pause();
    this.status = 'idle';
    this.records = [];
    this.nodes.clear();
    this.lastInput = null;
    this.removeHighlight();
  }

  getState(): { status: InspectionStatus; records: FocusRecord[] } {
    for (const record of this.records) {
      const node = this.nodes.get(record.index)?.deref();
      record.removed = !node || !node.isConnected;
    }
    return { status: this.status, records: this.records.map((r) => ({ ...r, issues: [...r.issues] })) };
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    this.lastInput = { time: this.now(), source: event.shiftKey ? 'shiftTab' : 'tab' };
  };

  private onMouseDown = (): void => {
    this.lastInput = { time: this.now(), source: 'mouse' };
  };

  private onFocusIn = (event: FocusEvent): void => {
    if (this.status !== 'running') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-kfi-extension-ui]') || target.hasAttribute('data-kfi-extension-ui')) return;
    if (target.getRootNode() !== this.doc) return;

    const time = this.now();
    const source = this.classifySource(time);
    const index = this.records.length + 1;
    const { name, nameSource } = resolveName(target, this.doc);
    const record: FocusRecord = {
      index,
      timestamp: time,
      tag: describeTag(target),
      name,
      nameSource,
      source,
      issues: detectIssues(target),
      removed: false,
    };
    this.records.push(record);
    this.nodes.set(index, new WeakRef(target));
  };

  private classifySource(time: number): FocusSource {
    if (this.lastInput && time - this.lastInput.time <= 1000 && time >= this.lastInput.time) {
      return this.lastInput.source;
    }
    return 'other';
  }

  highlight(index: number): boolean {
    const node = this.nodes.get(index)?.deref();
    if (!node || !node.isConnected) {
      const record = this.records.find((r) => r.index === index);
      if (record) record.removed = true;
      return false;
    }
    this.removeHighlight();
    this.highlightedIndex = index;
    node.setAttribute(HIGHLIGHT_ATTR, '');
    node.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'center' });
    this.ensureBox();
    this.positionBox(node);
    this.rafLoop(node);
    return true;
  }

  clearHighlight(): void {
    this.removeHighlight();
  }

  private removeHighlight(): void {
    this.highlightedIndex = null;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    const marked = this.doc.querySelectorAll(`[${HIGHLIGHT_ATTR}]`);
    marked.forEach((el) => el.removeAttribute(HIGHLIGHT_ATTR));
    this.boxEl?.remove();
    this.boxEl = null;
  }

  private ensureBox(): void {
    if (this.boxEl) return;
    const box = this.doc.createElement('div');
    box.id = HIGHLIGHT_BOX_ID;
    box.setAttribute('data-kfi-extension-ui', '');
    Object.assign(box.style, {
      position: 'absolute',
      zIndex: '2147483647',
      pointerEvents: 'none',
      boxSizing: 'border-box',
      border: '2px solid #e11d48',
      borderRadius: '4px',
      boxShadow: '0 0 0 3px rgba(225,29,72,0.25)',
      transition: 'all 80ms linear',
    } satisfies Partial<CSSStyleDeclaration>);
    this.doc.documentElement.appendChild(box);
    this.boxEl = box;
  }

  private positionBox(node: Element): void {
    if (!this.boxEl) return;
    const rect = node.getBoundingClientRect();
    const view = this.doc.defaultView;
    const top = rect.top + (view?.scrollY ?? 0);
    const left = rect.left + (view?.scrollX ?? 0);
    this.boxEl.style.top = `${top}px`;
    this.boxEl.style.left = `${left}px`;
    this.boxEl.style.width = `${rect.width}px`;
    this.boxEl.style.height = `${rect.height}px`;
  }

  private rafLoop(node: Element): void {
    const tick = (): void => {
      if (this.highlightedIndex === null) return;
      if (!node.isConnected) {
        this.removeHighlight();
        return;
      }
      this.positionBox(node);
      this.rafId = this.doc.defaultView?.requestAnimationFrame(tick) ?? 0;
    };
    this.rafId = this.doc.defaultView?.requestAnimationFrame(tick) ?? 0;
  }
}

export function describeTag(el: Element): string {
  let tag = el.tagName.toLowerCase();
  const type = el.getAttribute('type');
  if (type) tag += `[type="${type}"]`;
  const id = el.getAttribute('id');
  if (id) tag += `#${id}`;
  return tag;
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function resolveName(el: Element, doc: Document): { name: string; nameSource: string } {
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const parts = labelledby
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => textOf(doc.getElementById(id)))
      .filter(Boolean);
    if (parts.length) return { name: parts.join(' '), nameSource: 'aria-labelledby' };
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel?.trim()) return { name: ariaLabel.trim(), nameSource: 'aria-label' };

  if (el instanceof HTMLLabelElement && el.control) {
    const text = labelText(el);
    if (text) return { name: text, nameSource: '关联label' };
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) {
    const text = Array.from(labels).map(labelText).filter(Boolean).join(' ');
    if (text) return { name: text, nameSource: '关联label' };
  }
  if (el instanceof HTMLLabelElement) {
    const text = labelText(el);
    if (text) return { name: text, nameSource: '关联label' };
  }

  const ownText = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (ownText) {
    const clipped = ownText.length > 80 ? `${ownText.slice(0, 80)}…` : ownText;
    return { name: clipped, nameSource: '元素文本' };
  }
  const title = el.getAttribute('title');
  if (title?.trim()) return { name: title.trim(), nameSource: 'title' };
  return { name: '', nameSource: '无' };
}

function labelText(label: HTMLLabelElement): string {
  const control = label.control;
  const clone = label.cloneNode(true) as HTMLElement;
  if (control && control.id) clone.querySelector(`#${cssEscape(control.id)}`)?.remove();
  return textOf(clone);
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

export function detectIssues(el: Element): Issue[] {
  const issues: Issue[] = [];
  const tabIndexAttr = el.getAttribute('tabindex');
  if (tabIndexAttr !== null) {
    const value = Number.parseInt(tabIndexAttr, 10);
    if (Number.isInteger(value) && value > 0) {
      issues.push({
        code: 'POSITIVE_TABINDEX',
        label: '正 tabindex',
        reason: `tabindex="${value}"，正值会打断自然 Tab 顺序`,
      });
    }
  }

  const hiddenAncestor = el.closest('[aria-hidden="true"]');
  if (hiddenAncestor && hiddenAncestor !== el) {
    issues.push({
      code: 'ARIA_HIDDEN_ANCESTOR',
      label: '焦点进入 aria-hidden 区域',
      reason: `祖先 <${describeTag(hiddenAncestor)}> 设置了 aria-hidden="true"，焦点元素对辅助技术不可见`,
    });
  } else if (el.getAttribute('aria-hidden') === 'true') {
    issues.push({
      code: 'ARIA_HIDDEN_ANCESTOR',
      label: '焦点进入 aria-hidden 区域',
      reason: '元素自身设置了 aria-hidden="true"，但仍可获得焦点',
    });
  }

  const tag = el.tagName.toLowerCase();
  if ((tag === 'button' || tag === 'a') && !hasAccessibleName(el)) {
    issues.push({
      code: 'UNNAMED_ACTIONABLE',
      label: tag === 'button' ? '无名称按钮' : '无名称链接',
      reason: `<${tag}> 缺少 aria-labelledby、aria-label、关联 label 与可见文本，屏幕阅读器无法播报用途`,
    });
  }
  return issues;
}

function hasAccessibleName(el: Element): boolean {
  if (el.getAttribute('aria-labelledby') || el.getAttribute('aria-label')?.trim()) return true;
  if ((el.textContent ?? '').replace(/\s+/g, '').length > 0) return true;
  if (el.getAttribute('title')?.trim()) return true;
  const image = el.querySelector('img[alt]');
  return Boolean(image && image.getAttribute('alt')?.trim());
}
