export {};
import { FocusInspector } from './inspector';
import type { InspectionState, RuntimeMessage } from './types';

const INSTALLED_FLAG = '__kfiInspectorInstalled';

declare global {
  interface Window {
    [INSTALLED_FLAG]?: FocusInspector;
  }
}

export function installInspector(doc: Document = document): FocusInspector {
  if (window[INSTALLED_FLAG]) return window[INSTALLED_FLAG];
  const inspector = new FocusInspector(doc);
  window[INSTALLED_FLAG] = inspector;

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    switch (message.type) {
      case 'PING':
        sendResponse({ ok: true, state: inspector.getState() } satisfies ContentResponse);
        return false;
      case 'START':
        inspector.start();
        sendResponse({ ok: true, state: inspector.getState() } satisfies ContentResponse);
        return false;
      case 'PAUSE':
        inspector.pause();
        sendResponse({ ok: true, state: inspector.getState() } satisfies ContentResponse);
        return false;
      case 'CLEAR':
        inspector.clear();
        sendResponse({ ok: true, state: inspector.getState() } satisfies ContentResponse);
        return false;
      case 'GET_STATE':
        sendResponse({ ok: true, state: inspector.getState() } satisfies ContentResponse);
        return false;
      case 'HIGHLIGHT': {
        const found = inspector.highlight(message.index);
        sendResponse({ ok: true, found, state: inspector.getState() } satisfies ContentResponse);
        return false;
      }
      case 'CLEAR_HIGHLIGHT':
        inspector.clearHighlight();
        sendResponse({ ok: true } satisfies ContentResponse);
        return false;
      default:
        return false;
    }
  });

  window.addEventListener('pagehide', () => {
    inspector.clear();
  });

  return inspector;
}

export interface ContentResponse {
  ok: boolean;
  found?: boolean;
  state?: InspectionState;
}

installInspector();
