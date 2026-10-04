import { useEffect, useMemo, useRef, useState } from 'react';
import { catalog, defaultDeck, definitions, validateDeck } from '../../../packages/content';
import { actionCost, applyAction, attackRange, blocked, canEnter, createGame, damageValue, definition,
  deploymentArea, elementName, frozen, getView, inRange, legalMoves, loadGame, moveCost, other, sideName, unitsAt } from '../../../packages/rules/engine';
import type { Action, CardInstance, Direction, GameState, Position, Side, Unit } from '../../../packages/rules/types';
import { Board, displayPosition } from './Board';
import type { BoardModel } from './Board';
import { readSave, saveGame } from './storage';
import { CardArt } from './OperatorArt';

type Intent = 'inspect' | 'deploy' | 'move' | 'attack' | 'heal' | 'command';
type Pending = { action: Action; title: string; description: string; direction?: boolean };
type Panel = 'rules' | 'settings' | 'save' | 'pile' | undefined;
const professions = ['先锋', '近卫', '重装', '特种', '狙击', '术士', '医疗', '辅助'];
const arrows = ['↑', '→', '↓', '←'];
const professionShort: Record<string, string> = { 先锋: 'V', 近卫: 'G', 重装: 'D', 特种: 'S', 狙击: 'N', 术士: 'C', 医疗: 'M', 辅助: 'A' };

function Mark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'brand-mark small' : 'brand-mark'} viewBox="0 0 60 60" fill="none" aria-hidden="true">
    <path d="M30 4 56 49H4L30 4Z" stroke="currentColor" strokeWidth="3" />
    <path d="m30 18 15 26H15l15-26Z" fill="currentColor" opacity=".28" />
    <path d="M30 31v19M20 42h20" stroke="currentColor" strokeWidth="2" />
  </svg>;
}
function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose?: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
    <section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading"><div><span className="eyebrow">RE:CONNECTION</span><h2>{title}</h2></div>
        {onClose && <button className="icon-button" aria-label="关闭窗口" onClick={onClose}>×</button>}</div>
      {children}
    </section>
  </div>;
}
function Resource({ player, enemy = false }: { player: { cp: number; cap: number }; enemy?: boolean }) {
  return <div className={`resource ${enemy ? 'enemy' : ''}`}><span className="eyebrow">{enemy ? '敌方' : '我方'}指挥点</span>
    <div className="resource-number"><span className="diamond">◇</span><strong>{player.cp.toString().padStart(2, '0')}</strong><span> / {player.cap}</span></div>
    <div className="resource-line"><i style={{ width: `${100 * player.cp / player.cap}%` }} /></div>
  </div>;
}

export function App() {
  const autoDemo = new URLSearchParams(window.location.search).has('demo');
  const [game, setGame] = useState<GameState | null>(() => autoDemo ? createGame('demo', 42) : null);
  const [page, setPage] = useState<'home' | 'battle' | 'deck'>(() => autoDemo ? 'battle' : 'home');
  const [viewer, setViewer] = useState<Side>('blue');
  const [handoff, setHandoff] = useState<Side>();
  const [selected, setSelected] = useState<string>();
  const [intent, setIntent] = useState<Intent>('inspect');
  const [focused, setFocused] = useState<Position>();
  const [hovered, setHovered] = useState<Position>();
  const [pending, setPending] = useState<Pending>();
  const [panel, setPanel] = useState<Panel>();
  const [pile, setPile] = useState<{ side: Side; zone: 'discard' | 'removed' }>();
  const [toast, setToast] = useState<string>();
  const [canResume, setCanResume] = useState(false);
  const [deck, setDeck] = useState<string[]>(defaultDeck);
  const [deckFilter, setDeckFilter] = useState('全部');
  const [discardSelection, setDiscardSelection] = useState<string[]>([]);
  const [gridCoords, setGridCoords] = useState(true);
  const importInput = useRef<HTMLInputElement>(null);
  const lastSaved = useRef<number | undefined>(undefined);
  useEffect(() => { readSave().then(s => setCanResume(!!s)).catch(() => {}); }, []);
  useEffect(() => {
    if (!game || lastSaved.current === game.turn || game.phase === 'discard') return;
    lastSaved.current = game.turn;
    saveGame(game).then(() => setCanResume(true)).catch(e => setToast(e.message));
  }, [game]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(undefined), 4500); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPending(undefined); setPanel(undefined); setIntent('inspect'); } };
    window.addEventListener('keydown', cancel); return () => window.removeEventListener('keydown', cancel);
  }, []);
  const view = useMemo(() => game ? getView(game, viewer) : undefined, [game, viewer]);
  const selectedCard = selected ? view?.visibleCards[selected] : undefined;
  const data = selectedCard ? catalog[selectedCard.definition] : undefined;
  const unit = selected ? game?.units[selected] : undefined;
  const friendly = unit && unit.owner === viewer;
  const active = game?.active === viewer;
  const onAction = (action: Action) => {
    if (!game) return;
    const result = applyAction(game, action);
    if (!result.ok) { setToast(result.error); return; }
    setGame(result.state); setPending(undefined); setDiscardSelection([]); setIntent('inspect');
    if (result.state.active !== game.active && result.state.phase !== 'over') {
      setHandoff(result.state.active); setSelected(undefined); setFocused(undefined);
    }
    if (selected && result.state.cards[selected]?.zone !== 'board') setSelected(undefined);
  };
  function start(mode: 'local' | 'demo') {
    const invalid = validateDeck(deck); if (invalid && mode === 'local') { setToast(invalid); return; }
    const next = createGame(mode, mode === 'demo' ? 42 : Date.now(), mode === 'demo' ? undefined : { blue: deck, red: deck });
    setGame(next); setViewer('blue'); setPage('battle'); setSelected(undefined); setIntent('inspect'); setPanel(undefined); setHandoff(undefined);
    lastSaved.current = undefined;
  }
  async function resume() {
    try { const saved = await readSave(); if (!saved) return setToast('没有可继续的本地对局');
      setGame(saved); setPage('battle'); setViewer(saved.active); setHandoff(saved.phase === 'over' ? undefined : saved.active);
      setSelected(undefined); setPanel(undefined); setPending(undefined); setIntent('inspect');
      lastSaved.current = undefined;
    } catch (e) { setToast(e instanceof Error ? e.message : '存档读取失败'); }
  }
  function chooseCard(card: CardInstance) {
    if (!active || !game || game.phase !== 'action') return;
    setSelected(card.id); setFocused(undefined);
    const d = catalog[card.definition]; setIntent(d.kind === 'operator' ? 'deploy' : 'command');
  }
  function requestCommand(card: CardInstance, target?: string) {
    const d = catalog[card.definition];
    setPending({ action: { type: 'command', card: card.id, target }, title: `使用「${d.name}」`,
      description: `支付 ${card.cost} 指挥点。${d.description} 使用完成后，这张卡的后续费用增加 15。` });
  }
  function chooseUnit(target: Unit) {
    if (!game) return;
    if (intent === 'command' && selectedCard && data?.kind === 'command') { requestCommand(selectedCard, target.id); return; }
    if ((intent === 'attack' || intent === 'heal') && unit) {
      const amount = intent === 'attack' ? damageValue(game, unit, target, unitsAt(game, target, target.owner)[0]?.id !== target.id) :
        Math.min(definition(game, target.id).hp! - target.hp, data!.power! + (unit.skillActive ? data!.skill!.bonus : 0));
      setPending({ action: { type: intent, unit: unit.id, target: target.id }, title: intent === 'attack' ? '确认攻击' : '确认治疗',
        description: `${data!.name} → ${definition(game, target.id).name}。预计${intent === 'attack' ? '普通伤害' : '恢复生命'} ${amount}，费用 ${actionCost(game, unit, intent === 'heal')}。` });
      return;
    }
    setSelected(target.id); setIntent('inspect'); setFocused({ r: target.r, c: target.c });
  }
  function cellClick(p: Position) {
    if (!game || handoff) return;
    if (intent === 'deploy' && selectedCard) {
      setPending({ action: { type: 'deploy', card: selectedCard.id, position: p, direction: game.active === 'blue' ? 0 : 2 },
        title: '确认部署', description: `部署 ${data!.name}，费用 ${selectedCard.cost}。本回合部署 ${game.players[game.active].deployed}/2；刚部署的干员本回合不能主动行动。`, direction: true }); return;
    }
    if (intent === 'move' && unit) {
      setPending({ action: { type: 'move', unit: unit.id, position: p, direction: unit.direction }, title: '确认移动与朝向',
        description: `移动费用 ${moveCost(game, unit, p)}。若有效抵达敌方目标点，得分后该干员本局永久移除，不返还费用。`, direction: true }); return;
    }
    const options = unitsAt(game, p).filter(u =>
      intent === 'attack' ? u.owner !== viewer : intent === 'heal' ? u.owner === viewer :
        intent === 'command' ? data?.target === 'ally' ? u.owner === viewer : u.owner !== viewer : true);
    setFocused(p);
    if (options.length === 1) chooseUnit(options[0]);
    else if (options.length > 1) setToast('此格有多名干员，请在右侧队列中选择');
    else if (intent !== 'inspect') setToast('此区块没有对应的目标');
    else setSelected(undefined);
  }
  function dropOnMap(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    if (!game || !active || game.phase !== 'action') return;
    const id = e.dataTransfer.getData('text/plain'), card = view?.visibleCards[id];
    if (!card || card.owner !== viewer || card.zone !== 'hand') return;
    const canvas = e.currentTarget.querySelector('canvas'); if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const p = displayPosition({ r: Math.floor(((e.clientY - rect.top) * 820 / rect.height - 50) / 80) + 1,
      c: Math.floor(((e.clientX - rect.left) * 820 / rect.width - 50) / 80) + 1 }, viewer);
    const d = catalog[card.definition];
    setSelected(id);
    if (d.kind === 'operator') {
      setIntent('deploy'); setPending({ action: { type: 'deploy', card: id, position: p, direction: viewer === 'blue' ? 0 : 2 },
        title: '确认部署', description: `部署 ${d.name}，费用 ${card.cost}。部署当回合不能主动移动或攻击。`, direction: true });
    } else if (d.target === 'global') requestCommand(card);
    else {
      setIntent('command'); setFocused(p);
      const targets = unitsAt(game, p).filter(u => d.target === 'ally' ? u.owner === viewer : u.owner !== viewer);
      if (targets.length === 1) requestCommand(card, targets[0].id);
      else setToast(targets.length ? '此格有多名目标，请从右侧队列选择' : '请将指令拖向合法的场上干员');
    }
  }
  const highlighted = useMemo(() => {
    if (!game || !active || game.phase !== 'action') return [];
    if (intent === 'deploy' && selectedCard) return game.players[viewer].deployed < 2 && game.players[viewer].cp >= selectedCard.cost
      ? deploymentArea(viewer).filter(p => canEnter(game, p, viewer)) : [];
    if (intent === 'move' && unit) return legalMoves(game, unit.id);
    if ((intent === 'attack' || intent === 'heal') && unit) return attackRange(game, unit).filter(p => unitsAt(game, p).some(t =>
      intent === 'heal' ? t.owner === viewer && t.hp < definition(game, t.id).hp! : t.owner !== viewer && !t.smoke));
    if (intent === 'command' && data?.target !== 'global') return Object.values(game.units).filter(u =>
      data?.target === 'ally' ? u.owner === viewer : u.owner !== viewer && !u.smoke).map(u => ({ r: u.r, c: u.c }));
    return [];
  }, [game, active, intent, selectedCard, unit, viewer, data]);
  const boardModel = useMemo<BoardModel | undefined>(() => game ? ({ viewer, active: game.active, turn: game.turn,
    units: Object.values(game.units).map(u => ({ ...u, data: definition(game, u.id) })), selected,
    highlights: highlighted, focused: hovered ?? focused, kind: intent === 'command' ? `command-${data?.target}` : intent,
    costs: intent === 'move' && unit ? Object.fromEntries(highlighted.map(p => [`${p.r}:${p.c}`, moveCost(game, unit, p)])) : {} }) : undefined,
    [game, viewer, selected, highlighted, hovered, focused, intent, unit, data]);
  const pendingResult = useMemo(() => game && pending ? applyAction(game, pending.action) : undefined, [game, pending]);
  function exportGame() {
    if (!game) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(game, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `再连接-回合${game.turn}-私有对局.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setToast('已导出私有对局，包含双方手牌，仅供本机保存或复现');
  }
  function changeDeck(id: string, amount: number) {
    if (amount < 0) { const copy = [...deck]; const index = copy.indexOf(id); if (index >= 0) copy.splice(index, 1); setDeck(copy); return; }
    const d = catalog[id], count = deck.filter(x => x === id).length;
    const max = d.kind === 'operator' ? 1 : { A: 1, B: 2, C: 3, D: 4 }[d.grade!];
    if (count >= max) return setToast('已达同名携带上限');
    if (deck.length >= 30) return setToast('牌组已满，请先移除一张');
    setDeck([...deck, id]);
  }
  const rulesContent = <div className="rules-copy">
    <h3>让三名干员抵达敌方目标点</h3><p>有效抵达的干员永久移出本局，不进入弃牌堆，也不返还费用。目标点仍有能阻挡的敌人时，先交战，不能直接得分。</p>
    <div className="rule-grid"><div><b>30 张</b><span>每方牌组</span></div><div><b>8 张</b><span>手牌上限</span></div><div><b>+8</b><span>己方回合收入</span></div><div><b>2 次</b><span>每回合部署</span></div></div>
    <h3>指挥点与循环</h3><p>初始 5/100。首次回合同样 +8。被击败后卡费 +15，撤退后卡费 +5，使用指令后其费用 +15：这些增加卡牌下次使用的费用，不回复余额。超限弃牌不涨价。</p>
    <h3>移动与战斗</h3><p>每名干员每己方回合移动一次。刚部署不能主动行动。先锋相邻移动免费，十字两格 3 点；近卫与特种 3，重装 1，其余 2。主动近战 1、远程 2，反击免费且绝不连锁。</p>
    <h3>同格与技能</h3><p>每格每方最多三人；敌方能阻挡队首决定准入容量。双方同格时自动交战，存活即对峙，下回合继续。技能在双方每回合开始充能。普通技能攻击费用倍增；弹药技能每次 +1 并耗弹。</p>
    <h3>状态与元素</h3><p>寒冷一层 +1、二层 +3，三层冻结；每个全局回合结束寒冷 −1。冻结仍阻挡。元素基础每次 1 点，合计九次按最多类型爆发；之后两回合不累计。烟雾阻止敌方指向，主动移动或攻击后解除。</p>
    <h3>原型边界</h3><p>当前卡牌与原创矢量插画为测试内容。无正式卡池、AI、联机及反制卡；支持本机轮流对局和预设演练。灼燃保留“再次爆发变 3 点”，免疫期间基础元素仍为 1。双方各二十回合后依次比得分、指挥点上限。</p>
  </div>;

  return <div className={`app ${viewer} page-${page}`} onContextMenu={e => { e.preventDefault(); setPending(undefined); setIntent('inspect'); }}>
    <header className="topbar"><button className="brand" onClick={() => { setPage('home'); setPanel(undefined); }}><Mark small /><span>RE:CONNECTION<small>明日方舟 — 再连接</small></span></button>
      <span className="build-badge"><i /> 战术牌桌 <b>0.2</b></span>
      <nav><button onClick={() => setPanel('rules')}>规则手册</button><button onClick={() => setPanel('settings')}>设置</button>
        {game && <button onClick={() => setPanel('save')}>对局存档</button>}</nav></header>

    {page === 'home' && <main className="home">
      <div className="hero-copy"><span className="eyebrow">ARKNIGHTS / RE:CONNECTION</span>
        <h1>再连接<span>战术牌桌</span></h1>
        <p>将每一次部署，变成突破防线的可能。<br />在九乘九的战场上，用卡牌构筑你的战术。</p>
        <div className="hero-actions"><button className="primary" onClick={() => start('local')}>开始本机对局 <span>↗</span></button>
          <button className="secondary" onClick={() => start('demo')}>进入战术演练 <span>→</span></button></div>
        <div className="hero-links"><button onClick={() => setPage('deck')}>配置测试牌组 · {deck.length}/30 →</button>
          {canResume && <button onClick={resume}>继续已保存对局 →</button>}
          {game && <button onClick={() => setPage('battle')}>返回当前对局 →</button>}</div>
        <div className="prototype-note"><span>FIELD MANUAL · 02</span><p>本机双人 · 9×9 战场 · 30 张构筑<br />先进入战术演练，熟悉部署与突破防线。</p></div>
      </div>
      <div className="hero-visual"><div className="war-dossier"><span>RHODES ISLAND / OPERATIONS DIVISION</span><h2>行动部署图</h2>
        <div className="hero-grid">{Array.from({ length: 81 }, (_, i) => <i key={i} className={[13, 22, 31, 40, 49, 58, 67].includes(i) ? 'route' : ''} />)}</div><small>机密 · 作战规划 / 09 × 09</small></div>
        <div className="cover-cards">{['v1', 'g1', 'd1'].map(id => <div className="cover-card" key={id}><span>{catalog[id].profession}<b>{catalog[id].cost}</b></span><CardArt data={catalog[id]} large /><h3>{catalog[id].name}</h3><div><b>{catalog[id].power}</b><Mark small /><b>{catalog[id].hp}</b></div></div>)}</div>
        <div className="hero-label bottom"><b>3</b><span>突破防线<br />重新建立连接</span></div>
      </div>
      <div className="home-bottom"><span>01 / 先行部署</span><span>02 / 突破防线</span><span>03 / 抵达目标</span></div>
    </main>}

    {page === 'deck' && <main className="deck-builder"><div className="page-heading"><div><span className="eyebrow">DECK PREPARATION</span><h1>测试牌组配置</h1><p>双方使用同一套所选测试牌组，各自独立洗牌。卡牌均为规则验证内容。</p></div>
      <div className="deck-summary"><strong>{deck.length}<small>/30</small></strong><span>{deck.filter(id => catalog[id].kind === 'operator').length} 干员 · {deck.filter(id => catalog[id].kind === 'command').length} 指令</span>
        <button className="primary" disabled={!!validateDeck(deck)} onClick={() => setPage('home')}>使用此牌组</button></div></div>
      <div className="filters">{['全部', ...professions, '指令'].map(f => <button className={deckFilter === f ? 'active' : ''} key={f} onClick={() => setDeckFilter(f)}>{f}</button>)}
        <button className="reset" onClick={() => setDeck(defaultDeck)}>恢复推荐构筑</button></div>
      {validateDeck(deck) && <p className="notice">{validateDeck(deck)}</p>}
      <div className="catalog-grid">{definitions.filter(d => deckFilter === '全部' || d.profession === deckFilter || deckFilter === '指令' && d.kind === 'command').map(d =>
        <article className="catalog-card" key={d.id}><div className="catalog-title"><span>{d.profession ?? `${d.grade} 级指令`}</span><b>◇ {d.cost}</b></div><CardArt data={d} large />
          <h3>{d.name}<small>测试</small></h3><p>{d.description}</p><div className="deck-adjust"><button onClick={() => changeDeck(d.id, -1)} aria-label={`移除${d.name}`}>−</button>
            <span>{deck.filter(id => id === d.id).length}</span><button onClick={() => changeDeck(d.id, 1)} aria-label={`加入${d.name}`}>+</button></div></article>)}</div>
    </main>}

    {page === 'battle' && game && view && boardModel && <main className="battle" inert={!!handoff}>
      <div className="battle-heading"><div><span className="eyebrow">TACTICAL OPERATION / {game.mode === 'demo' ? '预设演练' : '本机双人'}</span>
        <h1>再连接作战 <span>测试地图 01</span></h1></div><div className="round-info"><span>全局回合</span><b>{String(game.turn).padStart(2, '0')}<small>/40</small></b><i /> <span>{sideName(viewer)}视角</span></div></div>
      <section className="opponent-rail" aria-label="敌方牌区">
        <Resource player={view.players[other(viewer)]} enemy />
        <button className="pile deck" title="敌方抽牌堆内容隐藏" onClick={() => setToast('敌方抽牌堆仅公开剩余张数')}><Mark small /><b>{view.players[other(viewer)].deckCount}</b><span>抽牌堆</span></button>
        <div className="enemy-hand"><span className="eyebrow">敌方手牌 / {view.players[other(viewer)].handCount}</span><div>{Array.from({ length: view.players[other(viewer)].handCount }, (_, i) => <div className="card-back" key={i}><Mark small /></div>)}</div></div>
        <button className="pile discard" onClick={() => { setPile({ side: other(viewer), zone: 'discard' }); setPanel('pile'); }}><span className="pile-glyph">▤</span><b>{view.players[other(viewer)].discard.length}</b><span>弃牌堆</span></button>
      </section>
      <div className="operation-layout">
        <aside className="operation-left">
          <div className="section-label">回合信标 <span>TURN</span></div>
          <div className="turn-lamps"><div className={!active ? 'lit enemy' : 'enemy'}><i className="triangle up" /><span>敌方回合</span></div><div className={active ? 'lit' : ''}><i className="triangle down" /><span>我方回合</span></div></div>
          <div className="score-panel"><span className="section-label">抵达进度 <span>GOAL</span></span>
            {[viewer, other(viewer)].map(side => <div className={`score-row ${side !== viewer ? 'enemy' : ''}`} key={side}><span>{side === viewer ? '我方' : '敌方'}</span><div>{[0, 1, 2].map(i => <i key={i} className={i < game.players[side].score ? 'scored' : ''} />)}</div><b>{game.players[side].score}/3</b></div>)}
            <button onClick={() => { setPile({ side: viewer, zone: 'removed' }); setPanel('pile'); }}>查看永久移除 →</button></div>
          <div className="mission-info"><span className="eyebrow">作战目标</span><p>让三名干员抵达<br /><b>敌方目标点</b></p><small>抵达即永久移出本局</small></div>
          <div className="action-quota"><span>本回合部署</span><b>{game.players[game.active].deployed}<small>/2</small></b></div>
          <div className="board-key"><span><i className="friendly-dot" /> 我方部署区</span><span><i className="enemy-dot" /> 敌方部署区</span></div>
        </aside>
        <section className="map-section" onDragOver={e => e.preventDefault()} onDrop={dropOnMap}><div className="map-topline"><span>战场网格 · 9 × 9</span><span>{hovered && gridCoords ? `R${displayPosition(hovered, viewer).r}C${displayPosition(hovered, viewer).c}` : '选择卡牌或干员'}</span></div>
          <Board model={boardModel} onCell={cellClick} onHover={setHovered} />
          <div className="map-bottomline"><span>{intent === 'deploy' ? '选择部署区与朝向' : intent === 'move' ? '选择落点与朝向' : intent === 'attack' ? '选择敌方干员' : intent === 'heal' ? '选择受伤的己方干员' : intent === 'command' ? '选择指令目标' : '左键选择 · 右键取消 · Esc 返回'}</span>
            {intent !== 'inspect' && <button onClick={() => setIntent('inspect')}>取消选择 ×</button>}</div></section>
        <aside className="operation-right">
          <div className="section-label">干员档案 <span>FIELD DOSSIER</span></div>
          <div className="detail-scroll">
            {data && selectedCard ? <>
              <div className="detail-title"><span>{data.profession ?? `${data.grade} 级指令`} <i>测试卡</i></span><h2>{data.name}</h2><p>{data.description}</p></div>
              {data.kind === 'operator' ? <>
                <div className="detail-art"><CardArt data={data} large /><span>{professionShort[data.profession!]}<small>OPERATOR</small></span></div>
                <div className="stats"><div><span>生命</span><b>{unit?.hp ?? data.hp}<small>/{data.hp}</small></b></div><div><span>{data.profession === '医疗' ? '治疗' : data.damage === 'arts' ? '法伤' : data.damage === 'true' ? '真伤' : '物伤'}</span><b>{data.power}</b></div>
                  <div><span>物抗 / 法抗</span><b>{data.armor}<small> / {data.resist}</small></b></div><div><span>阻挡</span><b>{data.block}</b></div></div>
                <div className="cost-detail"><span>基础 / 当前部署费</span><b>{data.cost} / {selectedCard.cost} ◇</b></div>
                {unit && <>
                  <div className="status-tags">{unit.deployed === game.turn && <span>部署休整</span>}{unit.moved && <span>本回合已移动</span>}{blocked(game, unit) && <span>被阻挡</span>}
                    {frozen(game, unit) && <span>冻结至全局 {unit.frozenUntil} 回合结束</span>}{unit.cold > 0 && <span>寒冷 {unit.cold} 层</span>}{unit.smoke && <span>烟雾</span>}{unit.nerve && <span>神经待发</span>}
                    {unit.immuneUntil >= game.turn && <span>元素累计免疫</span>}</div>
                  <div className="skill-box"><div><b>{data.skill!.name}</b><span>{unit.skillActive ? data.skill!.type === 'ammo' ? `弹药 ${unit.ammo}` : '技能生效中' : `${unit.charge}/${data.skill!.turns + unit.extraCharge}`}</span></div>
                    <div className="charge-line"><i style={{ width: `${unit.skillActive ? 100 : 100 * unit.charge / (data.skill!.turns + unit.extraCharge)}%` }} /></div>
                    <small>{data.skill!.type === 'ammo' ? '弹药型 · 后续费用每次 +1' : '普通型 · 后续费用每次 ×2'}{unit.skillActive && ` · 已行动 ${unit.skillK} 次`}</small></div>
                  <div className="element-detail"><span>元素累计 {Object.values(unit.elements).reduce((a, b) => a + b, 0)}/9</span><div>{(['burn', 'nerve', 'decay'] as const).map(e => <small key={e}>{elementName[e]} {unit.elements[e]}</small>)}</div></div>
                  {friendly && active && <div className="operator-actions">
                    <button className={intent === 'move' ? 'active' : ''} onClick={() => setIntent('move')}>移动 <span>{unit.moved ? '已使用' : '选择范围'}</span></button>
                    <button className={intent === (data.profession === '医疗' ? 'heal' : 'attack') ? 'active' : ''} onClick={() => setIntent(data.profession === '医疗' ? 'heal' : 'attack')}>{data.profession === '医疗' ? '治疗' : '攻击'}<span>{actionCost(game, unit, data.profession === '医疗')} ◇</span></button>
                    <button onClick={() => onAction({ type: unit.skillActive ? 'closeSkill' : 'skill', unit: unit.id })}>{unit.skillActive ? '关闭技能' : '开启技能'}<span>{unit.skillActive ? '进入回转' : '检查充能'}</span></button>
                    <button className="retreat" onClick={() => setPending({ action: { type: 'retreat', unit: unit.id }, title: '撤退干员', description: `「${data.name}」洗入弃牌堆，后续部署费 +5，不回复指挥点；撤退不限次数。` })}>撤退 <span>后续费 +5</span></button>
                  </div>}
                </>}
                {!unit && <p className="hint">从手牌选择干员后，点击地图中高亮的我方部署格。</p>}
              </> : <>
                <CardArt data={data} large /><div className="cost-detail"><span>基础 / 当前使用费</span><b>{data.cost} / {selectedCard.cost} ◇</b></div>
                {data.target === 'global' ? <button className="primary full" onClick={() => requestCommand(selectedCard)}>使用此指令</button> : <p className="hint">选择高亮的{data.target === 'ally' ? '己方' : '敌方'}干员；也可以将卡牌直接拖向地图。</p>}
              </>}
            </> : <div className="detail-empty"><Mark /><h3>等待战术指令</h3><p>选择手牌以部署干员，<br />选择地图单位查看作战信息。</p><span>SELECT AN OPERATOR</span></div>}
            {focused && unitsAt(game, focused).length > 0 && <div className="cell-queue"><span className="eyebrow">当前区块队列</span>{unitsAt(game, focused).map((u, i) => <button key={u.id} onClick={() => chooseUnit(u)}><i className={u.owner === viewer ? 'friendly-dot' : 'enemy-dot'} /><span>{definition(game, u.id).name}</span><small>{u.hp} HP</small><b>#{i + 1}</b></button>)}</div>}
          </div>
          <button className="end-turn" disabled={!active || game.phase !== 'action'} onClick={() => onAction({ type: 'end' })}>结束回合 <span>→</span></button>
        </aside>
      </div>
      <section className="friendly-rail" aria-label="我方牌区">
        <Resource player={view.players[viewer]} />
        <button className="pile discard" onClick={() => { setPile({ side: viewer, zone: 'discard' }); setPanel('pile'); }}><span className="pile-glyph">▤</span><b>{view.players[viewer].discard.length}</b><span>弃牌堆</span></button>
        <div className="hand-area"><div className="hand-label"><span>我方手牌 <b>{view.players[viewer].handCount}/8</b></span><span>{active ? '选择或拖动卡牌' : '等待回合交接'}</span></div>
          <div className="hand-cards">{handoff ? Array.from({ length: view.players[viewer].handCount }, (_, i) => <div className="card-back" key={i}><Mark small /></div>) : view.players[viewer].hand?.map((card, index, cards) => {
            const d = catalog[card.definition]; const playable = active && game.phase === 'action' && card.cost <= game.players[viewer].cp && (d.kind === 'command' || game.players[viewer].deployed < 2);
            return <button className={`hand-card ${selected === card.id ? 'selected' : ''} ${d.kind === 'command' ? 'command' : ''} ${playable ? 'playable' : 'unaffordable'}`} key={card.id}
              style={{ '--fan': `${(index - (cards.length - 1) / 2) * 2.4}deg`, '--fan-lift': `${Math.abs(index - (cards.length - 1) / 2) * 2}px` } as React.CSSProperties}
              data-testid={`card-${card.definition}`} aria-label={`${d.name}，${card.cost}费`} onClick={() => chooseCard(card)}
              draggable={active && game.phase === 'action'} onDragStart={e => { chooseCard(card); e.dataTransfer.setData('text/plain', card.id); }}>
              <div className="card-top"><span>{d.profession ?? `${d.grade} 指令`}</span><b className={card.cost > d.cost ? 'increased' : ''}>◇{card.cost}</b></div>
              <CardArt data={d} /><div className="card-bottom"><strong>{d.name}</strong><span>{d.kind === 'operator' ? `${d.mode === 'melee' ? '近战' : '远程'} · ${d.profession === '医疗' ? '医疗' : d.damage === 'arts' ? '法术' : d.damage === 'true' ? '真实' : '物理'}` : d.target === 'global' ? '全局指令' : d.target === 'ally' ? '己方目标' : '敌方目标'}</span></div>
              {d.kind === 'operator' && <div className="card-combat"><b title={d.profession === '医疗' ? '治疗量' : '攻击力'}>{d.power}</b><span>{professionShort[d.profession!]}</span><b title="生命">{d.hp}</b></div>}<i className="test-stamp">TEST</i>
            </button>;
          })}</div></div>
        <button className="pile deck" onClick={() => setToast('己方抽牌堆顺序隐藏；自己的回合开始自动抽 2 张')}><Mark small /><b>{view.players[viewer].deckCount}</b><span>抽牌堆</span></button>
      </section>
      <div className="log-strip"><span>作战记录</span><p>{game.logs.at(-1)?.text}</p><button onClick={() => setPanel('save')}>日志与存档 ↗</button></div>
    </main>}

    {pending && game && <Modal title={pending.title} onClose={() => setPending(undefined)}><p className="confirm-description">{pending.description}</p>
      {pending.direction && 'direction' in pending.action && <div className="direction-picker"><span>落地朝向</span>{arrows.map((arrow, index) => {
        const direction = ((index + (viewer === 'red' ? 2 : 0)) % 4) as Direction;
        return <button key={arrow} className={pending.action && 'direction' in pending.action && pending.action.direction === direction ? 'active' : ''}
          onClick={() => setPending({ ...pending, action: { ...pending.action, direction } as Action })}>{arrow}</button>;
      })}</div>}
      <div className="preview-events">{pendingResult && !pendingResult.ok ? <p className="error">{pendingResult.error}</p> : pendingResult?.ok && pendingResult.state.logs.filter(e => e.id > game.sequence).map(e => <p key={e.id}>{e.text}</p>)}</div>
      <div className="modal-actions"><button className="secondary" onClick={() => setPending(undefined)}>取消</button><button className="primary" disabled={!pendingResult?.ok} onClick={() => onAction(pending.action)}>确认执行</button></div>
    </Modal>}

    {handoff && <div className="handoff-screen"><Mark /><span className="eyebrow">PASS THE COMMAND</span><h1>请交给{sideName(handoff)}指挥官</h1><p>双方手牌已遮蔽。下一位玩家确认后，<br />地图旋转至其视角，显示自己的手牌。</p>
      <button className="primary" onClick={() => { setViewer(handoff); setHandoff(undefined); setIntent('inspect'); setSelected(undefined); setPending(undefined); setPanel(undefined); }}>我是{sideName(handoff)}，开始回合 →</button></div>}

    {game?.phase === 'discard' && !handoff && page === 'battle' && <Modal title={`手牌超限 · 请选择 ${game.players[game.active].hand.length - 8} 张弃牌`}>
      <p className="confirm-description">被弃置的牌洗入弃牌堆，不增加费用。选择完成前不能继续行动。</p>
      <div className="discard-options">{game.players[game.active].hand.map(id => <button className={discardSelection.includes(id) ? 'active' : ''} key={id} onClick={() => setDiscardSelection(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id])}>
        <span>{catalog[game.cards[id].definition].name}</span><b>◇{game.cards[id].cost}</b></button>)}</div>
      <button className="primary full" disabled={discardSelection.length !== game.players[game.active].hand.length - 8} onClick={() => onAction({ type: 'discard', cards: discardSelection })}>确认弃置 {discardSelection.length} 张</button>
    </Modal>}

    {game?.phase === 'over' && page === 'battle' && <Modal title={game.winner === 'draw' ? '作战结束 · 平局' : `作战结束 · ${sideName(game.winner as Side)}胜利`}>
      <div className="result-scores"><b>{game.players.blue.score}<span>蓝方抵达</span></b><Mark /><b>{game.players.red.score}<span>红方抵达</span></b></div><p>{game.result}</p><p className="hint">全局 {game.turn} 回合 · 蓝方上限 {game.players.blue.cap} / 红方上限 {game.players.red.cap}</p>
      <div className="modal-actions"><button className="secondary" onClick={() => setPage('home')}>返回主菜单</button><button className="primary" onClick={() => start('local')}>开始新对局</button></div>
    </Modal>}

    {panel === 'rules' && <Modal title="作战规则速查" wide onClose={() => setPanel(undefined)}>{rulesContent}</Modal>}
    {panel === 'settings' && <Modal title="界面设置" onClose={() => setPanel(undefined)}><label className="setting-row"><span>显示悬停区块坐标</span><input type="checkbox" checked={gridCoords} onChange={e => setGridCoords(e.target.checked)} /></label>
      <p className="hint">此雏形采用静音模式。卡面为原创矢量插画，卡牌仍是用于验证规则的测试构筑。</p><button className="secondary full" onClick={() => { setPage('deck'); setPanel(undefined); }}>配置测试牌组</button></Modal>}
    {panel === 'save' && <Modal title="对局存档与作战记录" wide onClose={() => setPanel(undefined)}>
      <div className="save-actions"><button className="primary" disabled={!game} onClick={() => game && saveGame(game).then(() => { setToast('已保存当前对局'); setCanResume(true); }).catch(e => setToast(e.message))}>保存当前对局</button>
        <button className="secondary" onClick={resume} disabled={!canResume}>载入本地存档</button><button className="secondary" onClick={exportGame} disabled={!game}>导出对局 JSON</button><button className="secondary" onClick={() => importInput.current?.click()}>导入对局</button></div>
      <p className="hint">自动保存于回合起点；可随时手动保存。导出的私有对局包含双方手牌，仅用于本机存档或开发复现。</p>
      <div className="full-log">{game?.logs.slice().reverse().map(entry => <div key={entry.id}><span>T{entry.turn.toString().padStart(2, '0')}</span><p>{entry.text}</p></div>)}</div>
    </Modal>}
    {panel === 'pile' && pile && game && <Modal title={`${pile.side === viewer ? '我方' : '敌方'}${pile.zone === 'discard' ? '弃牌堆' : '永久移除区'}`} onClose={() => setPanel(undefined)}>
      <p className="hint">{pile.zone === 'discard' ? '卡费保留；只有抽牌堆为空且需要抽牌时才洗回。展示顺序不代表未来抽牌顺序。' : '已抵达干员本局无法再使用，不参与牌库循环。'}</p>
      <div className="pile-list">{game.players[pile.side][pile.zone].map(id => <div key={id}><span>{catalog[game.cards[id].definition].name}</span><b>当前费用 ◇{game.cards[id].cost}</b></div>)}</div>
      {!game.players[pile.side][pile.zone].length && <div className="empty-state">此区域暂无卡牌</div>}
    </Modal>}
    <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      try { const next = loadGame(await file.text()); setGame(next); setPage('battle'); setHandoff(next.phase === 'over' ? undefined : next.active); setPanel(undefined); setSelected(undefined); setPending(undefined); setToast('对局导入成功'); }
      catch (error) { setToast(error instanceof Error ? error.message : '导入失败，原对局已保留'); }
      e.target.value = '';
    }} />
    {toast && <div className="toast" role="status"><span>◇</span>{toast}</div>}
  </div>;
}
