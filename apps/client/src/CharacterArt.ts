import Phaser from 'phaser';
import type { CardDefinition, Direction, Side } from '../../../packages/rules/types';

// 角色以 2 倍分辨率缓存，Display 时缩小一半，兼顾 DPR=2 的清晰度与 Canvas 性能。
const SCALE = 2;
const TEXTURE_W = 84 * SCALE;
const TEXTURE_H = 104 * SCALE;

const professionColors: Record<string, { main: number; dark: number; accent: number }> = {
  先锋: { main: 0x78866d, dark: 0x26352f, accent: 0xd8c36e },
  近卫: { main: 0x9b7666, dark: 0x392a2d, accent: 0xe6a16f },
  重装: { main: 0x718b86, dark: 0x243a3c, accent: 0xb9c8a7 },
  特种: { main: 0x82778f, dark: 0x292b3a, accent: 0xc1a8c8 },
  狙击: { main: 0xa38d64, dark: 0x3d3e30, accent: 0xe0c28b },
  术士: { main: 0x8e849e, dark: 0x343044, accent: 0xd1aed0 },
  医疗: { main: 0x7f9f91, dark: 0x2b423e, accent: 0xd8e2c8 },
  辅助: { main: 0x6e8e98, dark: 0x283b46, accent: 0xb6d2d4 },
};

function polygon(g: Phaser.GameObjects.Graphics, points: Array<[number, number]>) {
  g.fillPoints(points.map(([x, y]) => ({ x: x * SCALE, y: y * SCALE })), true);
}
function rect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
  g.fillRect(x * SCALE, y * SCALE, w * SCALE, h * SCALE);
}
function circle(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number) {
  g.fillCircle(x * SCALE, y * SCALE, r * SCALE);
}
function line(g: Phaser.GameObjects.Graphics, width: number, color: number, points: Array<[number, number]>, alpha = 1) {
  g.lineStyle(width * SCALE, color, alpha);
  g.strokePoints(points.map(([x, y]) => ({ x: x * SCALE, y: y * SCALE })), false);
}

function drawWeapon(g: Phaser.GameObjects.Graphics, data: CardDefinition, accent: number, facing: Direction) {
  const mirror = facing === 3 ? -1 : 1;
  const x = mirror > 0 ? 59 : 25;
  const profession = data.profession;
  if (profession === '重装') {
    g.fillStyle(0x536b6d); polygon(g, [[x - 9, 43], [x + 8, 40], [x + 11, 70], [x - 7, 75]]);
    g.fillStyle(0x9baaa0); polygon(g, [[x - 5, 47], [x + 4, 45], [x + 6, 66], [x - 3, 69]]);
    line(g, 1.2, accent, [[x, 48], [x + 1, 65]], .65);
  } else if (profession === '医疗') {
    line(g, 3, 0x48645e, [[x, 34], [x + 2 * mirror, 76]]);
    g.fillStyle(accent); circle(g, x, 32, 6);
    g.fillStyle(0x29433f); rect(g, x - 1, 28, 2, 8); rect(g, x - 4, 31, 8, 2);
  } else if (profession === '狙击') {
    line(g, 4, 0x26353a, [[x - 8 * mirror, 66], [x + 8 * mirror, 25]]);
    line(g, 1.5, accent, [[x - 5 * mirror, 53], [x + 10 * mirror, 31]], .85);
    line(g, 2, 0x1a242b, [[x + 3 * mirror, 35], [x + 15 * mirror, 22]]);
  } else if (profession === '术士' || profession === '辅助') {
    line(g, 3, 0x31444e, [[x, 32], [x + 2 * mirror, 76]]);
    g.fillStyle(accent); polygon(g, [[x, 22], [x + 7, 31], [x, 40], [x - 7, 31]]);
    g.fillStyle(0xe5e4cf); polygon(g, [[x, 26], [x + 3, 31], [x, 36], [x - 3, 31]]);
    line(g, 1, accent, [[x - 11, 25], [x - 16, 20]], .5);
    line(g, 1, accent, [[x + 10, 24], [x + 15, 18]], .5);
  } else {
    line(g, 4, 0xb9c5bd, [[x - 4 * mirror, 69], [x + 11 * mirror, 27]]);
    line(g, 1.2, 0xf0e3bd, [[x - 3 * mirror, 65], [x + 10 * mirror, 29]], .85);
    line(g, 4, 0x33464b, [[x - 7 * mirror, 59], [x + 4 * mirror, 65]]);
  }
}

/** 原创几何角色：脚底底座、双层衣装、头部与职业武器，不使用任何外部原作素材。 */
export function ensureOperatorTexture(scene: Phaser.Scene, data: CardDefinition, owner: Side, facing: Direction) {
  const variant = Number(data.id.replace(/\D/g, '')) || 1;
  const key = `operator-${data.id}-${owner}-${facing}`;
  if (scene.textures.exists(key)) return key;
  const palette = professionColors[data.profession ?? '辅助'];
  const friendly = owner === 'blue';
  const team = friendly ? 0x76c7d4 : 0xe07a5f;
  const teamDark = friendly ? 0x254c5a : 0x592f2c;
  const g = scene.add.graphics();

  // 底座：顶面 + 侧面构成厚度，脚底点用于深度排序。
  g.fillStyle(0x05080b, .6); g.fillEllipse(42 * SCALE, 87 * SCALE, 62 * SCALE, 19 * SCALE);
  g.fillStyle(teamDark); polygon(g, [[12, 77], [42, 68], [72, 77], [72, 84], [42, 94], [12, 84]]);
  g.fillStyle(friendly ? 0x1b3540 : 0x3b2526); polygon(g, [[12, 75], [42, 66], [72, 75], [42, 85]]);
  line(g, 1.5, team, [[12, 75], [42, 66], [72, 75], [42, 85], [12, 75]], .9);
  g.fillStyle(team, .75); polygon(g, [[37, 79], [42, 76], [47, 79], [42, 82]]);

  // 后侧披风/外套，形成角色与底座之间的第一层纵深。
  g.fillStyle(palette.dark); polygon(g, [[26, 40], [56, 39], [65, 74], [49, 79], [42, 70], [34, 80], [19, 73]]);
  g.fillStyle(palette.main); polygon(g, [[29, 39], [53, 39], [58, 67], [47, 72], [41, 63], [34, 73], [24, 67]]);
  g.fillStyle(0x111920, .7); polygon(g, [[29, 42], [35, 42], [32, 67], [25, 66]]);
  g.fillStyle(0xdde4dc, .12); polygon(g, [[47, 41], [52, 41], [56, 63], [51, 65]]);

  // 腿与靴子。
  g.fillStyle(0x1b242c); rect(g, 32, 63, 8, 15); rect(g, 45, 63, 8, 15);
  g.fillStyle(0x0c1117); polygon(g, [[30, 75], [40, 75], [39, 80], [28, 80]]);
  polygon(g, [[45, 75], [55, 75], [57, 80], [46, 80]]);
  line(g, 1, team, [[31, 78], [38, 78]], .45);

  // 手臂与肩部装甲。
  g.fillStyle(palette.dark); polygon(g, [[27, 41], [20, 45], [17, 61], [24, 64], [31, 48]]);
  polygon(g, [[55, 41], [62, 45], [66, 60], [59, 64], [51, 48]]);
  g.fillStyle(palette.accent, .85); polygon(g, [[23, 43], [30, 40], [32, 45], [25, 48]]);
  polygon(g, [[52, 40], [59, 43], [57, 48], [50, 45]]);

  // 头部、发型/面罩与朝向变化。
  g.fillStyle(0xc6b8a6); circle(g, 42, 28, 13);
  const hair = variant % 2 ? 0x26343c : 0x8f9187;
  g.fillStyle(hair); polygon(g, [[28, 28], [29, 16], [38, 9], [52, 12], [58, 25], [52, 23], [48, 17], [39, 22], [34, 18], [32, 31]]);
  g.fillStyle(palette.dark); polygon(g, [[31, 15], [26, 4], [37, 10]]); polygon(g, [[50, 12], [58, 3], [56, 18]]);
  if (facing === 2) {
    g.fillStyle(hair); polygon(g, [[30, 23], [54, 21], [53, 36], [43, 41], [32, 35]]);
    line(g, 1.2, palette.accent, [[33, 28], [51, 27]], .45);
  } else {
    const eyeOffset = facing === 1 ? 3 : facing === 3 ? -3 : 0;
    g.fillStyle(0x17262d); rect(g, 35 + eyeOffset, 26, 4, 2); rect(g, 45 + eyeOffset, 26, 4, 2);
    g.fillStyle(team); rect(g, 36 + eyeOffset, 26, 2, 1); rect(g, 46 + eyeOffset, 26, 2, 1);
    line(g, 1, 0x705f55, [[40 + eyeOffset, 34], [45 + eyeOffset, 34]], .8);
  }

  // 胸前标识与职业武器。
  g.fillStyle(palette.accent); polygon(g, [[38, 43], [46, 43], [44, 52], [42, 55], [39, 51]]);
  g.fillStyle(team, .85); rect(g, 40, 45, 4, 2);
  drawWeapon(g, data, palette.accent, facing);

  // 顶光与边缘光，让剪影像有厚度的角色棋子而不是平面卡牌。
  line(g, 1.2, 0xe8f2eb, [[31, 38], [37, 36], [47, 36]], .45);
  line(g, 1, team, [[58, 43], [62, 54]], .55);
  g.generateTexture(key, TEXTURE_W, TEXTURE_H);
  g.destroy();
  return key;
}

export function ensureBoardFxTextures(scene: Phaser.Scene) {
  if (!scene.textures.exists('unit-shadow')) {
    const g = scene.add.graphics();
    g.fillStyle(0x000000, .58); g.fillEllipse(72, 28, 132, 38);
    g.fillStyle(0x000000, .32); g.fillEllipse(72, 28, 102, 26);
    g.generateTexture('unit-shadow', 144, 56); g.destroy();
  }
  for (const owner of ['blue', 'red'] as Side[]) {
    const key = `unit-ring-${owner}`;
    if (scene.textures.exists(key)) continue;
    const color = owner === 'blue' ? 0x83d7e2 : 0xef8b70;
    const g = scene.add.graphics();
    g.lineStyle(4, color, .9); g.strokeEllipse(80, 40, 140, 56);
    g.lineStyle(2, color, .35); g.strokeEllipse(80, 40, 116, 42);
    g.fillStyle(color, .8);
    g.fillTriangle(80, 4, 87, 15, 73, 15);
    g.generateTexture(key, 160, 80); g.destroy();
  }
}
