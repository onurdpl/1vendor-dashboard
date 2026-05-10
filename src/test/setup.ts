import '@testing-library/jest-dom/vitest';

const storageState = new Map<string, string>();

const localStorageMock = {
  getItem(key: string) {
    return storageState.has(key) ? storageState.get(key)! : null;
  },
  setItem(key: string, value: string) {
    storageState.set(key, value);
  },
  removeItem(key: string) {
    storageState.delete(key);
  },
  clear() {
    storageState.clear();
  },
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  configurable: true,
});
