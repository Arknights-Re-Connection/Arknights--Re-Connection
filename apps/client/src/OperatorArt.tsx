import { useId } from 'react';
import type { CardDefinition } from '../../../packages/rules/types';

// 职业主色：低饱和度、偏暗，配合琥珀金高光（明日方舟风格）
const palettes: Record<string, string[]> = {
  // [accent 职业主色, dark 暗部, highlight 琥珀/亮部]
  先锋: ['#7fa05f', '#16200f', '#d6e39a'],
  近卫: ['#c9885b', '#23150a', '#f0b429'],
  重装: ['#6b8798', '#0f1a22', '#a8ccde'],
  特种: ['#8a6f9e', '#170e20', '#c9a8d6'],
  狙击: ['#c4a85b', '#211a0c', '#f0d486'],
  术士: ['#9e6f9e', '#1c0f20', '#d6a8d6'],
  医疗: ['#6f9e7a', '#0e1d13', '#a8e0bc'],
  辅助: ['#6f9ea8', '#0e1b1e', '#a8dce0'],
};

/** Original vector illustrations. Every card instance has independent SVG gradient/pattern IDs. */
export function CardArt({ data, large = false }: { data: CardDefinition; large?: boolean }) {
  const id = useId().replace(/:/g, '');
  const [accent, dark, highlight] = palettes[data.profession ?? '辅助'];
  const heavy = data.profession === '重装', medic = data.profession === '医疗';
  const sniper = data.profession === '狙击', caster = data.profession === '术士' || data.profession === '辅助';
  const special = data.profession === '特种';
  const variant = Number(data.id.replace(/\D/g, '')) || 1;
  return <svg className={`card-art ${large ? 'large' : ''}`} viewBox="0 0 320 230" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-bg`} x2=".3" y2="1">
        <stop stopColor="#1c232d" /><stop offset="1" stopColor="#090b0f" />
      </linearGradient>
      <radialGradient id={`${id}-glow`} cx=".35" cy=".18" r=".95">
        <stop stopColor={accent} stopOpacity=".38" /><stop offset=".6" stopColor={accent} stopOpacity=".08" /><stop offset="1" stopColor={accent} stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${id}-coat`} x2="1" y2="1">
        <stop stopColor={accent} /><stop offset="1" stopColor={dark} />
      </linearGradient>
      <linearGradient id={`${id}-amber`} x1="1" y1="0" x2="0" y2="1">
        <stop stopColor="#ffd166" stopOpacity=".32" /><stop offset=".7" stopColor="#f0b429" stopOpacity=".04" />
      </linearGradient>
      <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse">
        <path d="M0 6 6 0" stroke="#05070a" strokeOpacity=".55" strokeWidth="1" />
      </pattern>
    </defs>

    <rect fill={`url(#${id}-bg)`} width="320" height="230" />
    <rect fill={`url(#${id}-glow)`} width="320" height="230" />

    {/* 旋转菱形框架（明日方舟式几何装饰） */}
    <rect x="34" y="14" width="252" height="202" transform="rotate(45 160 115)" fill="none" stroke={accent} strokeOpacity=".26" strokeWidth="1.5" />
    <rect x="54" y="34" width="212" height="162" transform="rotate(45 160 115)" fill="none" stroke={accent} strokeOpacity=".13" strokeWidth="1" />
    <path d="M160 26l11 19h-22z" fill={highlight} opacity=".55" />
    <path d="M160 204l-11-19h22z" fill={highlight} opacity=".35" />

    {data.kind === 'command' ? <>
      {/* 指令卡：暗色面板 + 按效果着色的几何符号 */}
      <path d="m57 189 54-103 71-44 83 101-74 56Z" fill="#26303c" stroke="#4a5a68" strokeWidth="2" />
      <path d="m82 170 49-76 46-29 59 72-55 32Z" stroke="#5c6c78" strokeWidth="1.5" />
      <path d="m106 149 105-22m-89-19 70 45M164 83l-20 76" stroke="#6b7f8f" strokeDasharray="5 5" />
      {data.effect === 'smoke' ? <>
        <path d="M80 160c-22-33 17-70 53-48-5-33 51-62 81-29 23-10 62 17 45 46 30 27-1 66-39 51-31 28-66 12-79 0-24 22-48 3-61-20Z" fill="#8aa0b0" opacity=".8" />
        <path d="M102 152c-9-25 23-39 43-23m15-17c17-17 36-12 47 6m-60 44c20 13 40 12 54-1" stroke="#b8ccd8" strokeWidth="2" />
      </> : data.effect === 'burn' ? <>
        <path d="M139 180c-50-37-9-60-5-98 12 18 19 26 21 41 25-32 37-36 35-67 44 47 63 87 34 117-23 25-64 16-85 7Z" fill="#d9644a" />
        <path d="M163 177c-17-26 3-30 9-54 3 13 14 15 18 7 22 39 8 53-27 47Z" fill="#f0b429" />
      </> : data.effect === 'cold' ? <>
        <path d="M163 74v105m-47-79 94 56m-94 0 94-56m-59-15 12 14 12-14m-24 85 12-14 12 14m-53-63 5 18-19 3m93-21-5 18 19 3m-90 10 18 4-5 17m69-21-18 4 5 17" stroke="#8fd6e8" strokeWidth="5" />
      </> : <>
        <circle cx="168" cy="132" r="36" stroke="#f0b429" strokeWidth="3" />
        <path d="m168 87 43 45-43 45-43-45z" fill="#f0b429" opacity=".7" />
        <path d="M150 132h36m-18-18v36" stroke="#16130a" strokeWidth="5" />
      </>}
      <path d="m244 176-32 10 9 26 48-17Z" fill="#1a222c" stroke="#8a6f3d" strokeWidth="2" />
      <circle cx="239" cy="190" r="7" stroke="#f0b429" />
    </> : <>
      {/* 干员剪影：职业主色外套 + 琥珀肩章/胸徽 */}
      <path d="m87 230 21-66 40-28 59 3 41 43 12 48Z" fill={`url(#${id}-coat)`} />
      <path d="m119 167-27 36-37 15 9 12h44l30-36m75-32 28 29 39 18-6 21h-29l-53-48" fill={accent} stroke="#0d1217" strokeWidth="3" />
      <path d="m156 131-13 24 18 37 44-40-20-22Z" fill="#303a44" />
      <path d="m143 151 22 42-13 37h-22l2-60Zm60-5-23 40 27 44h20l-5-58Z" fill={accent} stroke="#0d1217" strokeWidth="2" />
      <path d="m161 165 22 2-5 47-16 2Z" fill={highlight} opacity=".7" />
      <path d="m123 195 67 27M195 179l21 51" stroke="#5c6c78" strokeWidth="5" />
      <path d="M139 93c-2-40 19-56 43-42 24 0 30 40 17 67l-24 24-25-14Z" fill="#202a34" stroke="#0d1217" strokeWidth="2" />
      <path d="m144 101-7-12 5-39 19-20 28 8 21 22-7 43-10-23-8 7-12-20-20 26Z" fill={variant % 2 ? '#1a222b' : '#3a4550'} />
      <path d="m143 68 9-38 15 8m22 1 12-8 7 42" fill={accent} stroke="#0d1217" strokeWidth="2" />
      <path d="m158 102 9 1m17-2 8-2" stroke="#0d1217" strokeWidth="3" />
      <path d="m173 109-3 6 8 1m-12 9 13-1" stroke="#5c6c78" strokeWidth="1.5" />
      <path d="m135 118 42 19 28-18-7 34-31 10-28-17Z" fill="#f0b429" />
      <path d="m146 151 14 14-46 51-13-17Z" fill="#f0b429" opacity=".85" />
      <path d="m115 176 26 6-5 12-27-6m97 10 13 1v13h-14" stroke="#5c6c78" strokeWidth="2" />
      {heavy ? <>
        <path d="m238 115 43 18-1 84-40 13-14-80Z" fill="#4a5a68" stroke="#0d1217" strokeWidth="5" />
        <path d="m246 132 19 8-1 64-18 8Z" fill={accent} stroke="#0d1217" strokeWidth="2" />
        <path d="m256 143-2 54" stroke="#8aa0b0" strokeWidth="4" />
      </> : medic ? <>
        <path d="m248 156 29 4-7 58-40-4Z" fill={accent} stroke="#0d1217" strokeWidth="3" />
        <path d="m247 174 1 22m-11-11h23" stroke="#d6e39a" strokeWidth="6" />
        <path d="m254 161 7-12 14 4-2 15" stroke="#a8e0bc" strokeWidth="3" />
      </> : sniper ? <>
        <path d="m51 230 55-145 8 3-43 142Z" fill="#1a222b" />
        <path d="m88 139 12 5 7-9-11-7Zm-13 24 34 14-3 14-36-15Z" fill="#4a5a68" />
        <path d="m99 119 24-63 4 2-17 64" stroke="#f0b429" strokeWidth="5" />
      </> : caster ? <>
        <path d="m264 230-12-112" stroke="#0d1217" strokeWidth="7" />
        <path d="m250 57 27 31-23 37-27-31Z" fill={accent} stroke={highlight} strokeWidth="3" />
        <path d="m251 71 13 18-11 22-14-17Z" fill="#f0b429" />
        <path d="m230 103-26 8m66-40 21-12m-43-13-4-17" stroke="#f0d486" strokeWidth="2" opacity=".5" />
      </> : <>
        <path d={special ? 'm262 73-46 106 8 4 62-100Z' : 'm272 26-48 155 7 4 56-153Z'} fill="#8aa0b0" stroke="#0d1217" strokeWidth="3" />
        <path d="m207 175 35 11m-27-5-18 49" stroke="#f0b429" strokeWidth="7" />
      </>}
    </>}

    {/* 琥珀光扫 + 暗纹 + 边框与四角括号 */}
    <rect fill={`url(#${id}-amber)`} width="320" height="230" />
    <rect fill={`url(#${id}-hatch)`} width="320" height="230" />
    <path d="M8 8h18M8 8v18M312 8h-18M312 8v18M8 222h18M8 222v-18M312 222h-18M312 222v-18" stroke="#f0b429" strokeWidth="2" />
    <rect x="7" y="7" width="306" height="216" stroke={highlight} strokeOpacity=".4" strokeWidth="1" />
  </svg>;
}
