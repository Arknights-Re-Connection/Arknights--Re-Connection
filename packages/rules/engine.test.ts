import { describe, expect, it } from 'vitest';
import { catalog, defaultDeck, validateDeck } from '../content';
import { actionCost, applyAction, applyElement, assertState, attackRange, canEnter, capacity, createGame, deploymentArea, getView, legalMoves, loadGame, newUnit, rotatedOffset } from './engine';
import type { Action, GameState, Side, Unit } from './types';

function step(s: GameState, a: Action): GameState {
  const result = applyAction(s, a);
  if (!result.ok) throw new Error(result.error);
  assertState(result.state);
  return result.state;
}
function fresh() { return createGame('local', 42); }
function take(s: GameState, side: Side, def: string) {
  const card = Object.values(s.cards).find(c => c.owner === side && c.definition === def && c.zone !== 'board')!;
  for (const zone of ['deck', 'hand', 'discard', 'removed'] as const) s.players[side][zone] = s.players[side][zone].filter(id => id !== card.id);
  return card;
}
function place(s: GameState, side: Side, def: string, r: number, c: number, hp?: number): Unit {
  const card = take(s, side, def); card.zone = 'board';
  const unit = newUnit(s, card.id, { r, c }, side === 'blue' ? 0 : 2);
  unit.deployed = 0; if (hp !== undefined) unit.hp = hp;
  s.units[card.id] = unit; return unit;
}
function hand(s: GameState, side: Side, def: string) {
  const card = take(s, side, def); card.zone = 'hand'; s.players[side].hand.push(card.id); return card;
}
describe('开局、牌区与资源', () => {
  it('默认 30 张构筑覆盖八职业且合法', () => {
    expect(defaultDeck).toHaveLength(30); expect(validateDeck(defaultDeck)).toBeUndefined();
    expect(new Set(defaultDeck.map(id => catalog[id].profession).filter(Boolean)).size).toBe(8);
  });
  it('开局先手 13 点/5 手牌，后手 5 点/4 手牌，空地图', () => {
    const s = fresh(); assertState(s);
    expect(s.players.blue.cp).toBe(13); expect(s.players.blue.hand).toHaveLength(5);
    expect(s.players.red.cp).toBe(5); expect(s.players.red.hand).toHaveLength(4);
    expect(Object.keys(s.units)).toHaveLength(0);
  });
  it('相同种子形成相同状态与洗牌顺序', () => expect(fresh()).toEqual(fresh()));
  it('指令 +15 是实例费用而非余额收入', () => {
    const s = fresh(); const card = hand(s, 'blue', 'mist'); const unit = place(s, 'blue', 'v1', 8, 5);
    const next = step(s, { type: 'command', card: card.id, target: unit.id });
    expect(next.players.blue.cp).toBe(11); expect(next.cards[card.id].cost).toBe(17);
    expect(next.cards[card.id].zone).toBe('discard');
    const unused = Object.values(next.cards).find(c => c.owner === 'blue' && c.definition === 'mist' && c.id !== card.id)!;
    expect(unused.cost).toBe(2);
  });
  it('撤退不限部署额度，卡费 +5，不回手、不回复余额', () => {
    let s = fresh(); s.players.blue.deployed = 2;
    const a = place(s, 'blue', 'g1', 8, 4), b = place(s, 'blue', 'v1', 8, 5);
    s = step(s, { type: 'retreat', unit: a.id }); s = step(s, { type: 'retreat', unit: b.id });
    expect(s.players.blue.cp).toBe(13); expect(s.players.blue.deployed).toBe(2);
    expect(s.cards[a.id].cost).toBe(10); expect(s.cards[b.id].cost).toBe(8);
    expect(s.players.blue.discard).toContain(a.id); expect(s.players.blue.hand).not.toContain(a.id);
  });
  it('封顶时不累积以后补涨的卡费', () => {
    const s = fresh(); const u = place(s, 'blue', 'v1', 8, 5); s.cards[u.id].cost = 98;
    const next = step(s, { type: 'retreat', unit: u.id }); expect(next.cards[u.id].cost).toBe(100);
    const cap = hand(next, 'blue', 'cap'); const expanded = step(next, { type: 'command', card: cap.id });
    expect(expanded.players.blue.cap).toBe(120); expect(expanded.cards[u.id].cost).toBe(100);
    expect(expanded.players.blue.cp).toBe(9);
  });
  it('达到 40 回合只按得分与上限结算', () => {
    const s = fresh(); s.turn = 40; s.players.blue.cap = 120;
    const next = step(s, { type: 'end' }); expect(next.winner).toBe('blue'); expect(next.phase).toBe('over');
  });
  it('从正式开局连续运行到第 40 回合，超限弃牌和回收保持 60 张守恒', () => {
    let s = fresh();
    for (let actions = 0; s.phase !== 'over' && actions < 100; actions++) {
      s = s.phase === 'discard' ? step(s, { type: 'discard', cards: s.players[s.active].hand.slice(0, s.players[s.active].hand.length - 8) }) : step(s, { type: 'end' });
    }
    expect(s.phase).toBe('over'); expect(s.winner).toBe('draw'); expect(s.turn).toBe(40);
    expect(s.players.blue.ownTurn).toBe(20); expect(s.players.red.ownTurn).toBe(20);
    expect(Object.keys(s.cards)).toHaveLength(60); expect(s.logs.some(e => e.text.includes('洗回抽牌堆'))).toBe(true);
    expect(Object.values(s.cards).every(c => c.cost === catalog[c.definition].cost)).toBe(true);
  });
  it('40 回合始终卡牌守恒，超限弃牌不涨价', () => {
    let s = fresh();
    while (s.phase !== 'over') {
      if (s.phase === 'discard') {
        const ids = s.players[s.active].hand.slice(8); const before = ids.map(id => s.cards[id].cost);
        s = step(s, { type: 'discard', cards: ids }); expect(ids.map(id => s.cards[id].cost)).toEqual(before);
      } else s = step(s, { type: 'end' });
    }
    expect(s.turn).toBe(40); expect(s.winner).toBe('draw');
  });
  it('导出导入保持种子、卡牌费用与完整状态', () => {
    const s = createGame('demo', 42); expect(loadGame(JSON.stringify(s))).toEqual(s);
  });
  it('拒绝损坏、重复卡区域与未知版本存档', () => {
    const s = fresh(); s.players.blue.deck.push(s.players.blue.hand[0]);
    expect(() => loadGame(JSON.stringify(s))).toThrow();
    const version = fresh(); version.rulesVersion = 'unknown'; expect(() => loadGame(JSON.stringify(version))).toThrow();
  });
  it('玩家视图不会包含敌方手牌实例、抽牌顺序或随机状态', () => {
    const s = fresh(), view = getView(s, 'blue');
    expect(view.players.red.hand).toBeUndefined(); expect(view.players.red).not.toHaveProperty('deck');
    expect(view.state).not.toHaveProperty('rng');
    for (const id of s.players.red.hand) expect(view.visibleCards[id]).toBeUndefined();
    expect(view.players.blue.hand).toHaveLength(5);
  });
  it('拒绝缺失状态、异常元素、坏日志与无结果的结束存档', () => {
    for (const corrupt of [
      (s: GameState) => { delete (Object.values(s.units)[0] as Partial<Unit>).smoke; },
      (s: GameState) => { Object.values(s.units)[0].elements.burn = -1; },
      (s: GameState) => { s.logs.push(null as never); },
      (s: GameState) => { s.phase = 'over'; },
      (s: GameState) => { s.players.blue.ownTurn = 21; },
    ]) {
      const s = createGame('demo', 42); corrupt(s); expect(() => loadGame(JSON.stringify(s))).toThrow();
    }
  });
});
describe('部署、移动、准入与抵达', () => {
  it('每方八个部署格，包含自己的目标点', () => {
    expect(deploymentArea('blue')).toHaveLength(8); expect(deploymentArea('red')).toHaveLength(8);
    expect(deploymentArea('blue')).toContainEqual({ r: 9, c: 5 }); expect(deploymentArea('red')).toContainEqual({ r: 1, c: 5 });
  });
  it('第三次部署不能因撤退而获得资格', () => {
    let s = fresh(); s.players.blue.cp = 100;
    const ids = ['v1', 'v2', 'v3'].map(def => hand(s, 'blue', def).id);
    s = step(s, { type: 'deploy', card: ids[0], position: { r: 8, c: 4 }, direction: 0 });
    s = step(s, { type: 'deploy', card: ids[1], position: { r: 8, c: 5 }, direction: 0 });
    s = step(s, { type: 'retreat', unit: ids[0] });
    expect(applyAction(s, { type: 'deploy', card: ids[2], position: { r: 8, c: 6 }, direction: 0 }).ok).toBe(false);
  });
  it('部署休整不能被技能绕过，非法动作不改变源状态', () => {
    let s = fresh(); const card = hand(s, 'blue', 'v1');
    s = step(s, { type: 'deploy', card: card.id, position: { r: 8, c: 5 }, direction: 0 });
    s.units[card.id].charge = 3; s = step(s, { type: 'skill', unit: card.id });
    const before = structuredClone(s); expect(applyAction(s, { type: 'move', unit: card.id, position: { r: 7, c: 5 }, direction: 0 }).ok).toBe(false);
    expect(s).toEqual(before);
  });
  it('先锋相邻免费，两格 3 点，不跨过中间阻挡', () => {
    const s = fresh(), u = place(s, 'blue', 'v1', 8, 5);
    const adjacent = step(s, { type: 'move', unit: u.id, position: { r: 7, c: 5 }, direction: 0 }); expect(adjacent.players.blue.cp).toBe(13);
    const farther = step(s, { type: 'move', unit: u.id, position: { r: 6, c: 5 }, direction: 0 }); expect(farther.players.blue.cp).toBe(10);
    place(s, 'red', 'v1', 7, 5); expect(legalMoves(s, u.id)).not.toContainEqual({ r: 6, c: 5 });
  });
  it('0 阻挡不限制敌人进入，也不能主动移动', () => {
    const s = fresh(); const drone = place(s, 'blue', 'a3', 5, 5);
    expect(capacity(s, drone, 'red')).toBe(3); expect(canEnter(s, drone, 'red')).toBe(true);
    expect(legalMoves(s, drone.id)).toHaveLength(0);
  });
  it('软容量降低不会驱逐原有队列，但不能新增', () => {
    const s = fresh(); ['v1', 'v2', 'v3'].forEach(def => place(s, 'blue', def, 5, 5));
    place(s, 'red', 'v1', 5, 5); expect(capacity(s, { r: 5, c: 5 }, 'blue')).toBe(1);
    expect(canEnter(s, { r: 5, c: 5 }, 'blue')).toBe(false); assertState(s);
  });
  it('朝向旋转会改变远程范围', () => {
    expect(rotatedOffset(-2, 0, 1)).toEqual([0, 2]);
    const s = fresh(); const u = place(s, 'blue', 'n1', 5, 5); u.direction = 1;
    expect(attackRange(s, u)).toContainEqual({ r: 5, c: 8 });
  });
  it('神经使有效移动付费但不落位与得分', () => {
    const s = fresh(); const u = place(s, 'blue', 'g1', 2, 5); u.nerve = true; u.smoke = true;
    const next = step(s, { type: 'move', unit: u.id, position: { r: 1, c: 5 }, direction: 0 });
    expect(next.players.blue.cp).toBe(10); expect(next.units[u.id].r).toBe(2);
    expect(next.units[u.id].moved).toBe(true); expect(next.units[u.id].smoke).toBe(false); expect(next.players.blue.score).toBe(0);
  });
  it('抵达永久移除、不返費，第三分立即结束', () => {
    let s = fresh(); const units = ['v1', 'v2', 'v3'].map(def => place(s, 'blue', def, 2, 5));
    for (const u of units) s = step(s, { type: 'move', unit: u.id, position: { r: 1, c: 5 }, direction: 0 });
    expect(s.players.blue.score).toBe(3); expect(s.players.blue.cp).toBe(13); expect(s.players.blue.discard).toHaveLength(0);
    expect(s.players.blue.removed).toHaveLength(3); expect(s.winner).toBe('blue');
  });
  it('目标点仍有防守者存活不能得分', () => {
    const s = fresh(), a = place(s, 'blue', 'v1', 2, 5); place(s, 'red', 'd1', 1, 5);
    const next = step(s, { type: 'move', unit: a.id, position: { r: 1, c: 5 }, direction: 0 });
    expect(next.players.blue.score).toBe(0); expect(next.units[a.id]).toBeDefined();
    expect(next.units[a.id].hp).toBe(14);
  });
});
describe('主动战斗、治疗、技能与元素', () => {
  it('致命攻击与一次反击同时生效，被击败各 +15', () => {
    const s = fresh(), a = place(s, 'blue', 'v1', 5, 5, 4), b = place(s, 'red', 'v1', 5, 5, 4);
    const next = step(s, { type: 'attack', unit: a.id, target: b.id });
    expect(next.units[a.id]).toBeUndefined(); expect(next.units[b.id]).toBeUndefined();
    expect(next.cards[a.id].cost).toBe(18); expect(next.cards[b.id].cost).toBe(18); expect(next.players.blue.cp).toBe(12);
  });
  it('反击不引发下一次反击，同格双方仅受一次普通伤害', () => {
    const s = fresh(), a = place(s, 'blue', 'v1', 5, 5), b = place(s, 'red', 'v1', 5, 5);
    const next = step(s, { type: 'attack', unit: a.id, target: b.id });
    expect(next.units[a.id].hp).toBe(14); expect(next.units[b.id].hp).toBe(14); expect(next.units[b.id].attacked).toBe(false);
  });
  it('近战不能越位，远程越位最终伤害减一', () => {
    const s = fresh(), a = place(s, 'blue', 'n1', 5, 5); place(s, 'red', 'd1', 3, 5); const rear = place(s, 'red', 'v1', 3, 5);
    const next = step(s, { type: 'attack', unit: a.id, target: rear.id }); expect(next.units[rear.id].hp).toBe(11);
    const melee = place(s, 'blue', 'g1', 4, 5); expect(applyAction(s, { type: 'attack', unit: melee.id, target: rear.id }).ok).toBe(false);
  });
  it('双方 0 伤害不会自动弹开或在一个动作无限循环', () => {
    let s = fresh(); place(s, 'blue', 'd2', 5, 5); place(s, 'red', 'd2', 5, 5);
    s = step(s, { type: 'end' }); expect(Object.values(s.units).every(u => u.hp === 36 && u.r === 5)).toBe(true);
  });
  it('医疗治疗自己与后排，不能攻击', () => {
    const s = fresh(), medic = place(s, 'blue', 'm1', 6, 5), target = place(s, 'blue', 'g1', 5, 5, 10);
    const next = step(s, { type: 'heal', unit: medic.id, target: target.id }); expect(next.units[target.id].hp).toBe(17); expect(next.players.blue.cp).toBe(11);
    const enemy = place(s, 'red', 'v1', 5, 5); expect(applyAction(s, { type: 'attack', unit: medic.id, target: enemy.id }).ok).toBe(false);
  });
  it('普通技能攻击费用 1、2、4，寒冷加在倍率之后', () => {
    let s = fresh(); s.players.blue.cp = 50; const a = place(s, 'blue', 'g1', 5, 5), b = place(s, 'red', 'd1', 4, 5); a.charge = 4;
    s = step(s, { type: 'skill', unit: a.id }); const paid: number[] = [];
    for (let k = 0; k < 3; k++) { const cp = s.players.blue.cp; s = step(s, { type: 'attack', unit: a.id, target: b.id }); paid.push(cp - s.players.blue.cp); }
    expect(paid).toEqual([1, 2, 4]); s.units[a.id].cold = 2; expect(actionCost(s, s.units[a.id])).toBe(11);
  });
  it('弹药攻击按 2、3、4 付费，耗尽后不能补普通攻击', () => {
    let s = fresh(); s.players.blue.cp = 50; const a = place(s, 'blue', 'n1', 5, 5), b = place(s, 'red', 'd1', 3, 5); a.charge = 4;
    s = step(s, { type: 'skill', unit: a.id }); const paid: number[] = [];
    for (let k = 0; k < 3; k++) { const cp = s.players.blue.cp; s = step(s, { type: 'attack', unit: a.id, target: b.id }); paid.push(cp - s.players.blue.cp); }
    expect(paid).toEqual([2, 3, 4]); expect(s.units[a.id].skillActive).toBe(false);
    expect(applyAction(s, { type: 'attack', unit: a.id, target: b.id }).ok).toBe(false);
  });
  it('烟雾禁止指向攻击；主动无效攻击仍解除烟雾且不反击', () => {
    const s = fresh(), a = place(s, 'blue', 'v1', 5, 5), b = place(s, 'red', 'v1', 5, 5); b.smoke = true;
    expect(applyAction(s, { type: 'attack', unit: a.id, target: b.id }).ok).toBe(false);
    b.smoke = false; a.smoke = true; a.nerve = true;
    const next = step(s, { type: 'attack', unit: a.id, target: b.id });
    expect(next.units[a.id].smoke).toBe(false); expect(next.units[a.id].hp).toBe(18); expect(next.units[b.id].hp).toBe(18);
  });
  it('并列最多元素只在并列者中按最近事件裁定', () => {
    const s = fresh(), b = place(s, 'red', 'd2', 3, 5);
    b.elements = { burn: 4, nerve: 4, decay: 0 }; b.lastElement = { burn: 8, nerve: 9, decay: 0 };
    applyElement(s, b.id, 'decay'); expect(b.nerve).toBe(true); expect(b.extraCharge).toBe(0); expect(b.hp).toBe(35);
  });
  it('第九次扣生命后被击败，不再追加爆发与第二次涨价', () => {
    const s = fresh(), b = place(s, 'red', 'v1', 3, 5, 1); b.elements.burn = 8;
    applyElement(s, b.id, 'burn'); expect(s.cards[b.id].cost).toBe(18); expect(s.players.red.discard).toHaveLength(1);
  });
  it('灼燃九次爆发 4，无防御减算；免疫期每次仍为 1', () => {
    const s = fresh(), b = place(s, 'red', 'd2', 3, 5); applyElement(s, b.id, 'burn', 9);
    expect(b.hp).toBe(23); expect(b.immuneUntil).toBe(3); expect(b.elements.burn).toBe(0);
    applyElement(s, b.id, 'burn', 2); expect(b.hp).toBe(21); expect(b.elements.burn).toBe(0);
  });
  it('冻结持续后两个完整全局回合且继续提供阻挡', () => {
    let s = fresh(); const b = place(s, 'red', 'd1', 5, 5); b.frozenUntil = 3;
    expect(capacity(s, b, 'blue')).toBe(3);
    s = step(s, { type: 'end' }); expect(s.units[b.id].frozenUntil).toBe(3);
    s = step(s, { type: 'end' }); expect(s.turn).toBe(3);
    s = step(s, { type: 'end' }); expect(s.units[b.id].frozenUntil).toBe(0);
  });
});
