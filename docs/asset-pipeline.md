# 图像资源管线设计（Asset Pipeline）

> 状态：设计文档（v0.2.0 雏形阶段）。当前项目没有任何图像加载管线——棋盘与卡面全部由程序化绘制（Phaser `Graphics` + 内联 SVG），界面背景纹理由纯 CSS 渐变/网格实现，仅 `favicon.svg` 走网络加载。本文档为后续接入正式卡池美术/UI 资产时的落地方案。

## 1. 目录与命名约定

所有静态资产统一放在 `apps/client/public/assets/` 下，按用途分目录，命名全小写、连字符分隔：

```
apps/client/public/assets/
├── operators/           # 干员卡面（含头像与全身立绘）
│   ├── <cardId>.webp          # 卡面（320×230 比例参考当前 CardArt viewBox）
│   └── <cardId>@2x.webp       # 高清档（可选，devicePixelRatio=2）
├── commands/            # 指令卡面
│   └── <cardId>.webp
├── ui/                  # 界面通用件（按钮、边框、图标、占位图）
│   ├── card-frame.svg
│   └── icon-*.svg
├── textures/            # 程序化纹理（旧 wood/paper 已弃用，由纯 CSS 渐变替代）
└── atlas/               # 图集产物（构建期生成，见 §3）
    └── ui.atlas.json + ui.atlas.png
```

命名规则：
- `<cardId>` 与 `packages/content/test-cards.json` 中的 `id` 一一对应（如 `g1`、`mist`、`cold`）。**这是唯一权威键**，卡面文件缺失时回退到程序化 SVG（见 §4）。
- 图集命名 `<domain>.atlas.{json,png}`，domain 取 `ui` / `operators` / `commands`。

## 2. Phaser 预载场景设计（Boot / Preload）

棋盘（`Board.tsx`）目前无任何 `Loader` 调用。引入图集后按 Phaser 标准双场景拆分：

```ts
// BootScene：读取进度、注册资源清单
class BootScene extends Phaser.Scene {
  create() {
    this.scene.start('Preload', { manifest: RESOURCE_MANIFEST });
  }
}

// PreloadScene：按清单预载并驱动进度条
class PreloadScene extends Phaser.Scene {
  preload() {
    const { manifest } = this.scene.settings.data;
    // 关键路径资源（UI 边框、通用件图集）先载
    // 图集：一次请求拿到整批 UI 小件，避免逐图请求
    this.load.atlas('ui', '/assets/atlas/ui.atlas.png', '/assets/atlas/ui.atlas.json');
    this.load.on('progress', (v: number) => progressBar.setValue(v));
  }
  create() { this.scene.start('tactical'); }
}
```

要点：
- **图集优先**：UI 小件（图标、边框、角标）打进图集，减少请求数与 GPU 纹理切换。
- **卡面走 React `<img>` 而非 Phaser Loader**：卡面在 `CardArt` 组件内由浏览器原生 `<img>` 加载，天然获得 HTTP 缓存与懒加载，不与 Phaser 场景生命周期耦合。
- **不阻塞首屏**：棋盘当前为 Phaser `Graphics` 程序化绘制，无外部纹理依赖；卡面按需懒加载。

## 3. 图集与压缩

### 3.1 图集方案
- 首选 **free-tex-packer-core**（开源 CLI/库，MIT），或 TexturePacker CLI（商业）。
- 打包策略：按 domain 分图集；`ui` 图集必须（大量小件），`operators`/`commands` 卡面若数量少（当前 28 种）也可直接用单文件 WebP 而非图集，避免图集过大导致首载变重。

### 3.2 压缩
- **WebP** 为卡面默认格式，`<img srcset>` 提供 `@2x` 高清档；不支持 WebP 的环境回退 AVIF/PNG。
- 构建期用 `sharp`（或 imagemin）压图：`npm run assets:build` 把 `assets-src/` 原图转成 `public/assets/` 产物，从版本控制中只保留源图或产物（二选一，避免仓库膨胀）。
- 旧版 `wood.svg`/`paper.svg`（`feTurbulence` 噪点滤镜）已弃用，界面纹理改由纯 CSS 渐变/网格实现；若将来需要位图背景，可预渲染为 WebP 以降低低端机合成开销。

## 4. 卡面双轨加载机制（接口设计，暂不落地代码）

`CardArt`（`OperatorArt.tsx`）保持程序化 SVG 为**回退分支**，新增正式美术优先分支。目标签名：

```tsx
type CardArtProps = { data: CardDefinition; large?: boolean };
// 解析规则：
//   1. 若 /assets/operators/<data.id>.webp（或 commands/）存在 → <img>（含 @2x srcset、onError 回退）
//   2. 否则 → 现有程序化 <svg>（当前实现，零改动）
```

落地时的关键实现点（供后续实现参考，不引入真实美术文件）：
- 用 `<img loading="lazy" decoding="async">` 承载卡面；`onError` 回调切回 SVG，保证任何单张图缺失都不破坏整局。
- 首次加载完成后写入内存 LRU（见 §5），避免同一卡面重复请求。
- 卡面加载是**纯增强**：SVG 分支始终存在，二者视觉尺寸保持一致（`viewBox 0 0 320 230`），确保布局不抖动。

## 5. LRU 缓存与按页懒加载

- **LRU 缓存**：卡面按 `cardId` 缓存已解析的 `<img>` 结果，容量上限（建议 64）超出时逐出最久未用项。React 侧可用极简的 `Map` + 访问时间戳实现，无需引入库。
- **按页懒加载**：主菜单/牌组编辑/对战的卡面互不阻塞——`<img loading="lazy">` 只加载进入视口的卡面；对战中手牌与场上单位渲染时可预载相邻卡面。
- **棋盘纹理**：当前为 Phaser `Graphics` 程序化绘制（静态层已缓存），无外部纹理；如接入位图地形再纳入 Preload。

## 6. 落地优先级

| 优先级 | 事项 | 依赖 |
|---|---|---|
| P0 | 约定目录 + `<cardId>` 命名 + 双轨 `<img>` 回退 | 有正式卡面后 |
| P1 | 背景纹理 WebP（如需位图背景） | 压图脚本 |
| P1 | UI 图集（图集化小件） | free-tex-packer-core |
| P2 | Boot/Preload 场景 + 进度条 | 图集就绪 |
| P2 | LRU + 懒加载 | 双轨机制落地 |

## 7. 与现有实现的关系

- 本方案**不改变**当前 `engine.ts`（纯规则）与 `content/test-cards.json`（数据）的任何契约；`cardId` 是唯一关联键。
- 卡面双轨机制是纯前端增强，失败时自动回退程序化 SVG，不引入新的失败模式。
- 在真实美术到位前，本阶段只交付本文档，不修改 `OperatorArt.tsx` 等运行代码。
