import type { InspectionState, RuntimeMessage } from './types';

interface ContentResponse {
  ok: boolean;
  found?: boolean;
  state?: InspectionState;
}

export interface ActiveTabInfo {
  id: number;
  url: string;
  injectable: boolean;
  reason?: string;
}

export async function getActiveTab(): Promise<ActiveTabInfo | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return null;
  const url = tab.url ?? '';
  if (/^https?:\/\//.test(url)) return { id: tab.id, url, injectable: true };
  let reason: string;
  if (/^chrome:\/\//.test(url) || /^edge:\/\//.test(url)) {
    reason = '浏览器内置页面（chrome://）禁止扩展注入脚本';
  } else if (/^chrome-extension:\/\//.test(url)) {
    reason = '扩展页面无法注入巡检脚本';
  } else if (/^file:\/\//.test(url)) {
    reason = 'file:// 本地页面不在支持范围，请通过 http://localhost 打开示例页';
  } else if (url === '') {
    reason = '当前标签页尚未加载完成';
  } else {
    reason = `当前协议不受支持（${url.split(':')[0] || '未知'}），仅支持 http/https 页面`;
  }
  return { id: tab.id, url, injectable: false, reason };
}

async function ensureInjected(tabId: number): Promise<void> {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const w = window as unknown as { __kfiInjected?: boolean };
      if (w.__kfiInjected) return true;
      w.__kfiInjected = true;
      return false;
    },
  });
  if (result) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

export async function sendToTab(tabId: number, message: RuntimeMessage, inject = false): Promise<ContentResponse> {
  if (inject) {
    try {
      await ensureInjected(tabId);
    } catch (error) {
      throw new Error(`注入巡检脚本失败：${(error as Error).message}`);
    }
  }
  return (await chrome.tabs.sendMessage(tabId, message)) as ContentResponse;
}
