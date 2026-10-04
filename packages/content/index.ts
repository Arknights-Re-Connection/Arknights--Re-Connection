import raw from './test-cards.json';
import type { CardDefinition } from '../rules/types';

export const CONTENT_VERSION = 'test-cards-0.1';
function validateContent(value: unknown): CardDefinition[] {
  if (!Array.isArray(value)) throw new Error('卡池必须是数组');
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || typeof item.name !== 'string' ||
      !Number.isInteger(item.cost) || item.cost < 0 || item.cost > 100 ||
      !['operator', 'command'].includes(item.kind)) throw new Error('卡牌数据不合法');
    ids.add(item.id);
    if (item.kind === 'operator' && (!Number.isInteger(item.hp) || item.hp <= 0 ||
      !Number.isInteger(item.block) || item.block < 0 || item.block > 3 || !item.skill ||
      !Array.isArray(item.range) || item.range.some((p: unknown) => !Array.isArray(p) || p.length !== 2 ||
        p.some((n: unknown) => !Number.isInteger(n) || Math.abs(Number(n)) > 8)))) throw new Error(`干员数据不合法：${item.name}`);
    if (item.kind === 'command' && (!['A', 'B', 'C', 'D'].includes(item.grade) ||
      !['ally', 'enemy', 'global'].includes(item.target) || !Number.isInteger(item.amount) || item.amount <= 0)) throw new Error(`指令数据不合法：${item.name}`);
  }
  return value as CardDefinition[];
}
export const definitions = validateContent(raw);
export const catalog: Record<string, CardDefinition> = Object.fromEntries(definitions.map(d => [d.id, d]));
export const defaultDeck = [...definitions.filter(d => d.kind === 'operator').map(d => d.id),
  'repair', 'mist', 'mist', 'cold', 'cold', 'burn', 'nerve', 'decay', 'draw', 'cap'];
export function validateDeck(deck: string[]): string | undefined {
  if (deck.length !== 30) return '牌组必须恰好 30 张';
  if (deck.some(id => !catalog[id])) return '存在未知卡牌';
  if (deck.filter(id => catalog[id].kind === 'operator').length < 3) return '至少需要 3 张干员卡';
  const limits = { A: 1, B: 2, C: 3, D: 4 };
  for (const id of new Set(deck)) {
    const d = catalog[id];
    if (deck.filter(x => x === id).length > (d.kind === 'operator' ? 1 : limits[d.grade!])) return `${d.name}超过同名携带上限`;
  }
  return undefined;
}
