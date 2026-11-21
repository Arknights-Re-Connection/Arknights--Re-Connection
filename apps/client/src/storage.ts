import { loadGame } from '../../../packages/rules/engine';
import type { GameState } from '../../../packages/rules/types';

let dbPromise: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('reconnection-prototype', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('saves');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { dbPromise = undefined; reject(new Error('本地存档不可用，可使用导出对局保存')); };
    });
  }
  return dbPromise;
}
export async function saveGame(state: GameState) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('saves', 'readwrite');
    transaction.objectStore('saves').put(JSON.stringify(state), 'latest');
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(new Error('存档写入失败'));
  });
}
export async function readSave(): Promise<GameState | undefined> {
  const db = await database();
  const raw = await new Promise<string | undefined>((resolve, reject) => {
    const request = db.transaction('saves').objectStore('saves').get('latest');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('存档读取失败'));
  });
  return raw ? loadGame(raw) : undefined;
}
