export interface MessageButton {
  type: 'web_url' | 'postback';
  title: string;
  url?: string;
  payload?: string;
}

export interface KeywordResponse {
  type: 'text' | 'button';
  text: string;
  buttons?: MessageButton[];
}

export type FlowType = 'instant' | 'email_only' | 'name_and_email';

export interface KeywordRule {
  id: string;
  keyword: string;
  aliases: string[];
  matchType: 'exact' | 'contains' | 'word_boundary';
  priority: number;
  enabled: boolean;
  cooldownMinutes: number;
  flowType: FlowType;
  response: KeywordResponse;
  followUp?: KeywordResponse;
  publicReply?: string[];
  emailEnabled: boolean;
  emailTemplate?: string | null;
}
