// 应用图标生成器：「暗夜仪表罗盘」——近黑玻璃底 + 琥珀渐变指针（指东北）+ 辉光。
// 和深色模式同一种气质（近黑底、辉光），罗盘对应「课题罗盘」。
// 产出三件套：
//   app/apple-icon.png  180×180 整面出血（iOS 会自己套圆角遮罩，透明区会被填黑，不能带圆角）
//   app/icon.png        512×512 圆角透明底（浏览器标签页不遮罩，出血黑方块很生硬）
//   app/favicon.ico     16/32/48 三档 PNG-in-ICO，同样圆角透明底
// 运行：node scripts/gen-app-icon.mjs
// sharp 来自 Next 的依赖树（allowScripts 里登记的 sharp@0.34.5），没有单独声明；
// 若升级 Next 后 sharp 消失，本脚本才需要把它补进 devDependencies。
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = 1024;
const C = S / 2;

// rx > 0 时整体裁圆角（透明四角），0 为整面出血
function iconSvg(rx = 0) {
  const needleN = `${C},${C - 300} ${C - 78},${C} ${C + 78},${C}`;
  const needleS = `${C},${C + 300} ${C - 78},${C} ${C + 78},${C}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <radialGradient id="bg" cx="0.42" cy="0.34" r="1.05">
      <stop offset="0" stop-color="#2a2f45"/><stop offset="0.6" stop-color="#171a2b"/><stop offset="1" stop-color="#0c0e19"/>
    </radialGradient>
    <linearGradient id="needle" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd08a"/><stop offset="1" stop-color="#ff7847"/>
    </linearGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="34"/>
    </filter>
    ${rx ? `<clipPath id="clip"><rect width="${S}" height="${S}" rx="${rx}"/></clipPath>` : ""}
  </defs>
  <g ${rx ? 'clip-path="url(#clip)"' : ""}>
    <rect width="${S}" height="${S}" fill="url(#bg)"/>
    <circle cx="${C}" cy="${C}" r="340" fill="none" stroke="#ffffff" stroke-width="18" opacity="0.16"/>
    <g stroke="#ffffff" stroke-width="16" stroke-linecap="round" opacity="0.3">
      <line x1="${C}" y1="${C - 296}" x2="${C}" y2="${C - 252}"/>
      <line x1="${C}" y1="${C + 252}" x2="${C}" y2="${C + 296}"/>
      <line x1="${C - 296}" y1="${C}" x2="${C - 252}" y2="${C}"/>
      <line x1="${C + 252}" y1="${C}" x2="${C + 296}" y2="${C}"/>
    </g>
    <g transform="rotate(45 ${C} ${C})">
      <polygon points="${needleN}" fill="#ff8c50" opacity="0.6" filter="url(#glow)"/>
      <polygon points="${needleN}" fill="url(#needle)"/>
      <polygon points="${needleS}" fill="#ffffff" opacity="0.22"/>
    </g>
    <circle cx="${C}" cy="${C}" r="30" fill="#e9edf5"/>
    <circle cx="${C}" cy="${C}" r="13" fill="#171a2b"/>
  </g>
</svg>`;
}

const render = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();

const full = iconSvg();
const rounded = iconSvg(210);

writeFileSync(path.join(ROOT, "app/apple-icon.png"), await render(full, 180));
writeFileSync(path.join(ROOT, "app/icon.png"), await render(rounded, 512));

// ICO 容器手拼：6 字节头 + 每图 16 字节目录项 + PNG 原样嵌入（现代浏览器都认 PNG-in-ICO）
const icoSizes = [16, 32, 48];
const pngs = [];
for (const sz of icoSizes) pngs.push(await render(rounded, sz));
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // 类型：icon
header.writeUInt16LE(icoSizes.length, 4);
const entries = [];
let offset = 6 + 16 * icoSizes.length;
icoSizes.forEach((sz, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(sz, 0);
  e.writeUInt8(sz, 1);
  e.writeUInt16LE(1, 4); // color planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  entries.push(e);
});
writeFileSync(path.join(ROOT, "app/favicon.ico"), Buffer.concat([header, ...entries, ...pngs]));

console.log("app/apple-icon.png (180) · app/icon.png (512) · app/favicon.ico (16/32/48) 已生成");
