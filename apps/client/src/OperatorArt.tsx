import { useId } from 'react';
import type { CardDefinition } from '../../../packages/rules/types';

const palettes: Record<string, string[]> = {
  先锋: ['#9c9d70', '#454c41', '#d5bd81'], 近卫: ['#ad927e', '#4d4142', '#cf9872'],
  重装: ['#8a9a91', '#384a48', '#b5bc9a'], 特种: ['#8f8a9e', '#363d48', '#b3a7b0'],
  狙击: ['#b4a17b', '#4e5140', '#d3c092'], 术士: ['#98969e', '#444152', '#cbb2a1'],
  医疗: ['#a3b3a0', '#4a605b', '#ded7b8'], 辅助: ['#879a9f', '#3a4d56', '#b8c6bc'],
};

/** Original vector illustrations. Every card instance has independent SVG filter IDs. */
export function CardArt({ data, large = false }: { data: CardDefinition; large?: boolean }) {
  const id = useId().replace(/:/g, '');
  const [sky, coat, accent] = palettes[data.profession ?? '辅助'];
  const heavy = data.profession === '重装', medic = data.profession === '医疗';
  const sniper = data.profession === '狙击', caster = data.profession === '术士' || data.profession === '辅助';
  const special = data.profession === '特种';
  const variant = Number(data.id.replace(/\D/g, '')) || 1;
  return <svg className={`card-art ${large ? 'large' : ''}`} viewBox="0 0 320 230" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-sky`} x2=".8" y2="1"><stop stopColor={sky} /><stop offset="1" stopColor="#d6caae" /></linearGradient>
      <linearGradient id={`${id}-coat`} x2="1" y2="1"><stop stopColor={coat} /><stop offset="1" stopColor="#202e32" /></linearGradient>
      <linearGradient id={`${id}-light`} x1="1" y1="0" x2="0" y2="1"><stop stopColor="#f4e7b8" stopOpacity=".45" /><stop offset=".8" stopColor="#202620" stopOpacity=".05" /></linearGradient>
      <pattern id={`${id}-hatch`} width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 5 5 0" stroke="#182b2d" strokeOpacity=".08" strokeWidth=".6" /></pattern>
    </defs>
    <path fill={`url(#${id}-sky)`} d="M0 0h320v230H0z" />
    <circle cx="72" cy="55" r="35" fill="#ede2bf" opacity=".45" />
    <path d="M0 48c32-8 48-1 80 4s55-10 94-5 85 3 146-12M0 72c37-7 78 12 128 8s79-17 192-6" stroke="#eee3c8" strokeWidth="8" opacity=".18" />
    <path d="M0 135h19V98h21v28h18V76h9v59h12v-27h29v39h24v-20h30V94h13v45h25v-25h24v32h16V82h9v53h26v-19h19v35h35v79H0z" fill={coat} opacity=".22" />
    <path d="M0 172h43v-25h33v35h32v-43h19v43h27v-25h48v42h28v-35h31v-24h35v52h24v38H0z" fill={coat} opacity=".35" />
    <path d="M0 211 111 150h28L49 230H0zM284 230l-46-51 12-5 70 49v7z" fill="#d7ceb1" opacity=".3" />
    <path d="m28 126 3-54m-15 16 31-5m-18 17 18 6M271 83l-2-52m-19 18 39-3" stroke={coat} strokeWidth="2" opacity=".35" />
    {data.kind === 'command' ? <>
      <path d="m57 189 54-103 71-44 83 101-74 56Z" fill="#d9d0b6" stroke="#6b7168" strokeWidth="2" />
      <path d="m82 170 49-76 46-29 59 72-55 32Z" stroke="#5c6c66" strokeWidth="1.5" />
      <path d="m106 149 105-22m-89-19 70 45M164 83l-20 76" stroke="#687970" strokeDasharray="5 5" />
      {data.effect === 'smoke' ? <>
        <path d="M80 160c-22-33 17-70 53-48-5-33 51-62 81-29 23-10 62 17 45 46 30 27-1 66-39 51-31 28-66 12-79 0-24 22-48 3-61-20Z" fill="#d1d0bc" opacity=".9" />
        <path d="M102 152c-9-25 23-39 43-23m15-17c17-17 36-12 47 6m-60 44c20 13 40 12 54-1" stroke="#8d9c92" strokeWidth="2" />
      </> : data.effect === 'burn' ? <>
        <path d="M139 180c-50-37-9-60-5-98 12 18 19 26 21 41 25-32 37-36 35-67 44 47 63 87 34 117-23 25-64 16-85 7Z" fill="#a46743" />
        <path d="M163 177c-17-26 3-30 9-54 3 13 14 15 18 7 22 39 8 53-27 47Z" fill="#e1bb79" />
      </> : data.effect === 'cold' ? <>
        <path d="M163 74v105m-47-79 94 56m-94 0 94-56m-59-15 12 14 12-14m-24 85 12-14 12 14m-53-63 5 18-19 3m93-21-5 18 19 3m-90 10 18 4-5 17m69-21-18 4 5 17" stroke="#d9e6db" strokeWidth="5" />
      </> : <>
        <circle cx="168" cy="132" r="36" stroke={coat} strokeWidth="3" />
        <path d="m168 87 43 45-43 45-43-45z" fill={coat} opacity=".65" />
        <path d="M150 132h36m-18-18v36" stroke="#e4d8b2" strokeWidth="5" />
      </>}
      <path d="m244 176-32 10 9 26 48-17Z" fill="#33463f" stroke="#b6b292" strokeWidth="2" />
      <circle cx="239" cy="190" r="7" stroke="#c7c6aa" />
    </> : <>
      <path d="m87 230 21-66 40-28 59 3 41 43 12 48Z" fill={`url(#${id}-coat)`} />
      <path d="m119 167-27 36-37 15 9 12h44l30-36m75-32 28 29 39 18-6 21h-29l-53-48" fill={coat} stroke="#293b3b" strokeWidth="3" />
      <path d="m156 131-13 24 18 37 44-40-20-22Z" fill="#b4ab95" />
      <path d="m143 151 22 42-13 37h-22l2-60Zm60-5-23 40 27 44h20l-5-58Z" fill={coat} stroke="#78827b" strokeWidth="2" />
      <path d="m161 165 22 2-5 47-16 2Z" fill={accent} opacity=".65" />
      <path d="m123 195 67 27M195 179l21 51" stroke="#a0a38e" strokeWidth="5" />
      <path d="M139 93c-2-40 19-56 43-42 24 0 30 40 17 67l-24 24-25-14Z" fill="#d0bba2" stroke="#4d5050" strokeWidth="2" />
      <path d="m144 101-7-12 5-39 19-20 28 8 21 22-7 43-10-23-8 7-12-20-20 26Z" fill={variant % 2 ? '#37444a' : '#a8a694'} />
      <path d="m143 68 9-38 15 8m22 1 12-8 7 42" fill={coat} stroke="#394447" strokeWidth="2" />
      <path d="m158 102 9 1m17-2 8-2" stroke="#36444a" strokeWidth="3" />
      <path d="m173 109-3 6 8 1m-12 9 13-1" stroke="#8b766a" strokeWidth="1.5" />
      <path d="m135 118 42 19 28-18-7 34-31 10-28-17Z" fill={accent} />
      <path d="m146 151 14 14-46 51-13-17Z" fill={accent} opacity=".85" />
      <path d="m115 176 26 6-5 12-27-6m97 10 13 1v13h-14" stroke="#9da28f" strokeWidth="2" />
      {heavy ? <>
        <path d="m238 115 43 18-1 84-40 13-14-80Z" fill="#647972" stroke="#283e40" strokeWidth="5" />
        <path d="m246 132 19 8-1 64-18 8Z" fill="#b7b8a0" stroke="#384e4d" strokeWidth="2" />
        <path d="m256 143-2 54" stroke="#71857b" strokeWidth="4" />
      </> : medic ? <>
        <path d="m248 156 29 4-7 58-40-4Z" fill="#c7c9b2" stroke="#47635b" strokeWidth="3" />
        <path d="m247 174 1 22m-11-11h23" stroke="#6d8e7f" strokeWidth="6" />
        <path d="m254 161 7-12 14 4-2 15" stroke="#637c70" strokeWidth="3" />
      </> : sniper ? <>
        <path d="m51 230 55-145 8 3-43 142Z" fill="#304248" />
        <path d="m88 139 12 5 7-9-11-7Zm-13 24 34 14-3 14-36-15Z" fill="#867f64" />
        <path d="m99 119 24-63 4 2-17 64" stroke="#2f3d3e" strokeWidth="5" />
      </> : caster ? <>
        <path d="m264 230-12-112" stroke="#374e55" strokeWidth="7" />
        <path d="m250 57 27 31-23 37-27-31Z" fill={accent} stroke="#b9c8b8" strokeWidth="3" />
        <path d="m251 71 13 18-11 22-14-17Z" fill="#e1d6b3" />
        <path d="m230 103-26 8m66-40 21-12m-43-13-4-17" stroke="#e4d5b4" strokeWidth="2" opacity=".5" />
      </> : <>
        <path d={special ? 'm262 73-46 106 8 4 62-100Z' : 'm272 26-48 155 7 4 56-153Z'} fill="#c2c6b1" stroke="#4e6869" strokeWidth="3" />
        <path d="m207 175 35 11m-27-5-18 49" stroke="#344b4e" strokeWidth="7" />
      </>}
    </>}
    <path fill={`url(#${id}-light)`} d="M0 0h320v230H0z" />
    <path fill={`url(#${id}-hatch)`} d="M0 0h320v230H0z" />
    <path d="M7 7h306v216H7z" stroke="#e3dabf" strokeOpacity=".3" strokeWidth="2" />
  </svg>;
}
