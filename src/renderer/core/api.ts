// Связь с главным процессом. В обычном браузере (для отладки интерфейса) — заглушка.
import type { PushikApi } from '../../shared/types';
import { mockApi } from './mock-api';

declare global {
  interface Window { pushik?: PushikApi }
}

export const api: PushikApi = window.pushik ?? mockApi();
