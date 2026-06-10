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

export interface KeywordRule {
  id: string;
  keyword: string;
  aliases: string[];
  matchType: 'exact' | 'contains' | 'word_boundary';
  priority: number;
  enabled: boolean;
  cooldownMinutes: number;
  askEmail?: boolean;
  askName?: boolean;
  response: KeywordResponse;
  followUp?: KeywordResponse;
}
