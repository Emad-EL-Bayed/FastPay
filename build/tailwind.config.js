// إعداد Tailwind لبناء tailwind.css (بدل سكربت CDN اللي كان يبني التنسيقات بالمتصفح كل مرة).
// بعد أي تعديل على الكلاسات في index.html أو js/ شغّل: sh build/build-css.sh
//
// ===== الوضع الداكن =====
// الألوان اللي إلها نسخة داكنة بتمر عبر متغيرات CSS واللون الأصلي احتياط: var(--b-slate-50, 248 250 252).
// فالوضع الفاتح نفسه بالضبط، و <html data-theme="dark"> بيعطي المتغيرات قيم داكنة محسوبة هون. ما في داعي لـ dark: على كل كلاس.
// (خاصية مش كلاس، لأن Tailwind بيحذف أي قاعدة كلاسها مش مكتوب بالملفات)
// ثلاث مجموعات لأن نفس اللون بيتصرف غير حسب استعماله: خلفية (b)، نص (t)، وإطار وباقي الاستعمالات (c).
// مثال: bg-slate-900 (زر أساسي) بيصير فاتح، و text-slate-900 (نص غامق) بيصير فاتح، و border-slate-200 بيصير خط غامق.
// العناصر في KEEP بتضل بألوان الوضع الفاتح (الفاتورة والكشف ورق أبيض، والبطاقات الداكنة أصلاً).
// styles.css بيستعمل نفس المتغيرات (rgb(var(--b-white, 255 255 255)))، فأي لون جديد هناك اكتبه بنفس الطريقة.
const colors = require('tailwindcss/colors');
const plugin = require('tailwindcss/plugin');

const NAMED = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
// الدرجات الرمادية الثانية ما بنستعملها، فبتضل بلونها
const DARK_HUES = NAMED.filter(h => !['gray', 'zinc', 'neutral', 'stone'].includes(h));
const KEEP = ['.theme-keep', '.calc-result', '.mobile-result-bar', '.cp-head', '.usdt-hero', '.egp-hero', '.receipt-paper', '.statement-paper'];

const hexRgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const rgbStr = (rgb) => rgb.map(Math.round).join(' ');

// سطح البطاقة الداكن (bg-white)، والألوان الفاتحة (50–300) بتصير مزيج خفيف من اللون فوقه
const SURFACE = [17, 26, 46];
const tint = (rgb, amount) => SURFACE.map((s, i) => s + (rgb[i] - s) * amount);

// slate: الخلفيات بتنقلب (bg-slate-900 للأزرار الأساسية بيصير فاتح)، والنص بينقلب، والخطوط بتصير غامقة
const DARK_SLATE = {
    b: { 50: [22, 32, 54], 100: [28, 40, 65], 200: [37, 51, 79], 300: [51, 66, 95], 400: [74, 90, 120], 600: [148, 163, 184], 700: [203, 213, 225], 800: [226, 232, 240], 900: [241, 245, 249], 950: [248, 250, 252] },
    t: { 50: [15, 23, 42], 100: [30, 41, 59], 200: [51, 65, 85], 300: [76, 90, 115], 400: [112, 126, 150], 500: [142, 154, 175], 600: [168, 179, 197], 700: [200, 209, 222], 800: [224, 230, 238], 900: [241, 245, 249], 950: [248, 250, 252] },
    c: { 50: [24, 34, 56], 100: [30, 42, 66], 200: [39, 52, 79], 300: [52, 67, 97], 400: [75, 90, 120], 600: [148, 163, 184], 700: [203, 213, 225], 800: [226, 232, 240], 900: [241, 245, 249], 950: [248, 250, 252] }
};

// القيمة الداكنة لكل لون حسب استعماله، أو null إذا بيضل نفسه (مثل bg-emerald-600 للأزرار)
function darkValue(kind, hue, shade) {
    if (hue === 'white') return kind === 't' ? null : SURFACE;
    if (hue === 'slate') return DARK_SLATE[kind][shade] || null;
    const c = (s) => hexRgb(colors[hue][s]);
    const n = Number(shade);
    if (kind === 'b') return n <= 300 ? tint(n === 300 ? c('400') : c('500'), { 50: 0.13, 100: 0.2, 200: 0.3, 300: 0.45 }[n]) : null;
    if (kind === 't') return n >= 500 ? c({ 500: '400', 600: '400', 700: '400', 800: '300', 900: '200', 950: '100' }[n]) : null;
    return n <= 300 ? tint(c('500'), { 50: 0.14, 100: 0.2, 200: 0.3, 300: 0.45 }[n]) : null;
}

// كل المتغيرات الداكنة { '--b-slate-50': '22 32 54', ... }
const DARK_VARS = {
    // خلفية الصفحة (bg-page)، والنص فوق الزر الأساسي لما يقلب فاتح
    '--b-page': '8 13 25',
    '--t-inv': '15 23 42'
};

function color(kind, hue, shade, hex) {
    const dark = darkValue(kind, hue, shade);
    if (!dark) return hex;
    const name = `--${kind}-${hue}${shade ? '-' + shade : ''}`;
    DARK_VARS[name] = rgbStr(dark);
    return `rgb(var(${name}, ${rgbStr(hexRgb(hex))}) / <alpha-value>)`;
}

function palette(kind) {
    const p = { inherit: 'inherit', current: 'currentColor', transparent: 'transparent', black: colors.black, white: color(kind, 'white', '', '#ffffff') };
    NAMED.forEach(hue => {
        p[hue] = {};
        Object.entries(colors[hue]).forEach(([shade, hex]) => {
            p[hue][shade] = DARK_HUES.includes(hue) ? color(kind, hue, shade, hex) : hex;
        });
    });
    return p;
}

const bg = palette('b');
bg.page = 'rgb(var(--b-page, 248 250 252) / <alpha-value>)';

module.exports = {
    content: ['./index.html', './js/**/*.js'],
    theme: {
        colors: palette('c'),
        backgroundColor: bg,
        textColor: palette('t'),
        extend: {}
    },
    plugins: [
        plugin(({ addBase }) => {
            const keep = {};
            Object.keys(DARK_VARS).forEach(k => { keep[k] = 'initial'; });
            addBase({
                'html[data-theme="dark"]': { colorScheme: 'dark', ...DARK_VARS },
                [KEEP.join(', ')]: keep
            });
        })
    ]
};
