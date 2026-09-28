export type FocusSource = 'tab' | 'shiftTab' | 'mouse' | 'other';

export type IssueCode = 'POSITIVE_TABINDEX' | 'ARIA_HIDDEN_ANCESTOR' | 'UNNAMED_ACTIONABLE';

export interface Issue {
  code: IssueCode;
  label: string;
  reason: string;
}

export interface FocusRecord {
  index: number;
  timestamp: number;
  tag: string;
  name: string;
  nameSource: string;
  source: FocusSource;
  issues: Issue[];
  removed: boolean;
}

export type InspectionStatus = 'idle' | 'running' | 'paused';

export type RuntimeMessage =
  | { type: 'PING' }
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'CLEAR' }
  | { type: 'GET_STATE' }
  | { type: 'HIGHLIGHT'; index: number }
  | { type: 'CLEAR_HIGHLIGHT' };

export interface InspectionState {
  status: InspectionStatus;
  records: FocusRecord[];
}
