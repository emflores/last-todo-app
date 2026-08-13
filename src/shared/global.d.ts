import type { TodoAPI } from './contracts';

declare global {
  interface Window {
    todoAPI: TodoAPI;
  }
}

export {};
