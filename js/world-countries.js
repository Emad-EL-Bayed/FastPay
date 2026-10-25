'use strict';

// فاست باي — دول العالم: الـ 195 (193 بالأمم المتحدة + فلسطين والفاتيكان) وكم منطقة بتلزم بالحوالات (رمز ISO، الاسم بالعربي، بالإنجليزي، وأسماء ثانية للبحث). لصفحة الأسعار للزبائن (prices.html:
// "من وين بدك تبعت؟") وإعداد "الطرق" بصفحة الزبائن (أي طريقة بتشتغل من أي دول). العلم من الرمز (worldFlag).
const WORLD_COUNTRIES = [
    ['SA', 'السعودية', 'Saudi Arabia', 'المملكة KSA'], ['AE', 'الإمارات', 'United Arab Emirates', 'امارات دبي UAE Dubai'], ['QA', 'قطر', 'Qatar'],
    ['KW', 'الكويت', 'Kuwait'], ['BH', 'البحرين', 'Bahrain'], ['OM', 'عُمان', 'Oman', 'سلطنة عمان مسقط'], ['JO', 'الأردن', 'Jordan', 'اردن'],
    ['PS', 'فلسطين', 'Palestine', 'غزة الضفة'], ['IL', 'الداخل المحتل', 'Israel', '48 اسرائيل'], ['EG', 'مصر', 'Egypt'], ['LB', 'لبنان', 'Lebanon'],
    ['SY', 'سوريا', 'Syria'], ['IQ', 'العراق', 'Iraq'], ['YE', 'اليمن', 'Yemen'], ['LY', 'ليبيا', 'Libya'], ['TN', 'تونس', 'Tunisia'],
    ['DZ', 'الجزائر', 'Algeria'], ['MA', 'المغرب', 'Morocco'], ['SD', 'السودان', 'Sudan'], ['MR', 'موريتانيا', 'Mauritania'],
    ['SO', 'الصومال', 'Somalia'], ['DJ', 'جيبوتي', 'Djibouti'], ['KM', 'جزر القمر', 'Comoros'],
    ['TR', 'تركيا', 'Turkey', 'Türkiye اسطنبول'], ['IR', 'إيران', 'Iran'], ['US', 'أمريكا', 'United States', 'امريكا الولايات المتحدة USA'],
    ['CA', 'كندا', 'Canada'], ['MX', 'المكسيك', 'Mexico'], ['GB', 'بريطانيا', 'United Kingdom', 'انجلترا لندن المملكة المتحدة UK England'],
    ['IE', 'إيرلندا', 'Ireland', 'ايرلندا'], ['DE', 'ألمانيا', 'Germany', 'المانيا'], ['FR', 'فرنسا', 'France'], ['IT', 'إيطاليا', 'Italy', 'ايطاليا'],
    ['ES', 'إسبانيا', 'Spain', 'اسبانيا'], ['PT', 'البرتغال', 'Portugal'], ['NL', 'هولندا', 'Netherlands', 'Holland'], ['BE', 'بلجيكا', 'Belgium'],
    ['LU', 'لوكسمبورغ', 'Luxembourg'], ['CH', 'سويسرا', 'Switzerland'], ['AT', 'النمسا', 'Austria'], ['SE', 'السويد', 'Sweden'],
    ['NO', 'النرويج', 'Norway'], ['DK', 'الدنمارك', 'Denmark'], ['FI', 'فنلندا', 'Finland'], ['IS', 'آيسلندا', 'Iceland', 'ايسلندا'],
    ['PL', 'بولندا', 'Poland'], ['CZ', 'التشيك', 'Czech Republic', 'Czechia'], ['SK', 'سلوفاكيا', 'Slovakia'], ['HU', 'المجر', 'Hungary', 'هنغاريا'],
    ['RO', 'رومانيا', 'Romania'], ['BG', 'بلغاريا', 'Bulgaria'], ['GR', 'اليونان', 'Greece'], ['CY', 'قبرص', 'Cyprus'], ['MT', 'مالطا', 'Malta'],
    ['HR', 'كرواتيا', 'Croatia'], ['SI', 'سلوفينيا', 'Slovenia'], ['RS', 'صربيا', 'Serbia'], ['BA', 'البوسنة والهرسك', 'Bosnia and Herzegovina', 'بوسنة'],
    ['ME', 'الجبل الأسود', 'Montenegro'], ['MK', 'مقدونيا الشمالية', 'North Macedonia', 'مقدونيا'], ['AL', 'ألبانيا', 'Albania', 'البانيا'],
    ['XK', 'كوسوفو', 'Kosovo'], ['EE', 'إستونيا', 'Estonia', 'استونيا'], ['LV', 'لاتفيا', 'Latvia'], ['LT', 'ليتوانيا', 'Lithuania'],
    ['UA', 'أوكرانيا', 'Ukraine', 'اوكرانيا'], ['BY', 'بيلاروسيا', 'Belarus'], ['MD', 'مولدوفا', 'Moldova'], ['RU', 'روسيا', 'Russia'],
    ['GE', 'جورجيا', 'Georgia'], ['AM', 'أرمينيا', 'Armenia', 'ارمينيا'], ['AZ', 'أذربيجان', 'Azerbaijan', 'اذربيجان'],
    ['KZ', 'كازاخستان', 'Kazakhstan'], ['UZ', 'أوزبكستان', 'Uzbekistan', 'اوزبكستان'], ['TM', 'تركمانستان', 'Turkmenistan'],
    ['KG', 'قيرغيزستان', 'Kyrgyzstan'], ['TJ', 'طاجيكستان', 'Tajikistan'], ['AF', 'أفغانستان', 'Afghanistan', 'افغانستان'],
    ['PK', 'باكستان', 'Pakistan'], ['IN', 'الهند', 'India'], ['BD', 'بنغلاديش', 'Bangladesh'], ['LK', 'سريلانكا', 'Sri Lanka'],
    ['NP', 'نيبال', 'Nepal'], ['MV', 'المالديف', 'Maldives'], ['CN', 'الصين', 'China'], ['HK', 'هونغ كونغ', 'Hong Kong'],
    ['TW', 'تايوان', 'Taiwan'], ['JP', 'اليابان', 'Japan'], ['KR', 'كوريا الجنوبية', 'South Korea', 'كوريا'], ['MN', 'منغوليا', 'Mongolia'],
    ['SG', 'سنغافورة', 'Singapore'], ['MY', 'ماليزيا', 'Malaysia'], ['ID', 'إندونيسيا', 'Indonesia', 'اندونيسيا'], ['TH', 'تايلاند', 'Thailand'],
    ['VN', 'فيتنام', 'Vietnam'], ['PH', 'الفلبين', 'Philippines'], ['KH', 'كمبوديا', 'Cambodia'], ['MM', 'ميانمار', 'Myanmar', 'بورما'],
    ['LA', 'لاوس', 'Laos'], ['BN', 'بروناي', 'Brunei'], ['AU', 'أستراليا', 'Australia', 'استراليا'], ['NZ', 'نيوزيلندا', 'New Zealand'],
    ['BR', 'البرازيل', 'Brazil'], ['AR', 'الأرجنتين', 'Argentina', 'الارجنتين'], ['CL', 'تشيلي', 'Chile'], ['CO', 'كولومبيا', 'Colombia'],
    ['PE', 'بيرو', 'Peru'], ['VE', 'فنزويلا', 'Venezuela'], ['EC', 'الإكوادور', 'Ecuador', 'الاكوادور'], ['BO', 'بوليفيا', 'Bolivia'],
    ['PY', 'باراغواي', 'Paraguay'], ['UY', 'الأوروغواي', 'Uruguay', 'الاوروغواي'], ['PA', 'بنما', 'Panama'], ['CR', 'كوستاريكا', 'Costa Rica'],
    ['GT', 'غواتيمالا', 'Guatemala'], ['HN', 'هندوراس', 'Honduras'], ['SV', 'السلفادور', 'El Salvador'], ['NI', 'نيكاراغوا', 'Nicaragua'],
    ['DO', 'الدومينيكان', 'Dominican Republic'], ['CU', 'كوبا', 'Cuba'], ['JM', 'جامايكا', 'Jamaica'], ['TT', 'ترينيداد وتوباغو', 'Trinidad and Tobago'],
    ['PR', 'بورتوريكو', 'Puerto Rico'], ['BS', 'الباهاماس', 'Bahamas'], ['NG', 'نيجيريا', 'Nigeria'], ['GH', 'غانا', 'Ghana'],
    ['KE', 'كينيا', 'Kenya'], ['ET', 'إثيوبيا', 'Ethiopia', 'اثيوبيا الحبشة'], ['ER', 'إريتريا', 'Eritrea', 'اريتريا'], ['TZ', 'تنزانيا', 'Tanzania'],
    ['UG', 'أوغندا', 'Uganda', 'اوغندا'], ['RW', 'رواندا', 'Rwanda'], ['ZA', 'جنوب أفريقيا', 'South Africa', 'جنوب افريقيا'],
    ['SN', 'السنغال', 'Senegal'], ['ML', 'مالي', 'Mali'], ['NE', 'النيجر', 'Niger'], ['TD', 'تشاد', 'Chad'], ['CM', 'الكاميرون', 'Cameroon'],
    ['CI', 'ساحل العاج', 'Ivory Coast', "Côte d'Ivoire كوت ديفوار"], ['BF', 'بوركينا فاسو', 'Burkina Faso'], ['GN', 'غينيا', 'Guinea'],
    ['BJ', 'بنين', 'Benin'], ['TG', 'توغو', 'Togo'], ['SL', 'سيراليون', 'Sierra Leone'], ['LR', 'ليبيريا', 'Liberia'], ['GM', 'غامبيا', 'Gambia'],
    ['CD', 'الكونغو الديمقراطية', 'DR Congo', 'كونغو'], ['CG', 'الكونغو', 'Congo'], ['GA', 'الغابون', 'Gabon'], ['AO', 'أنغولا', 'Angola', 'انغولا'],
    ['ZM', 'زامبيا', 'Zambia'], ['ZW', 'زيمبابوي', 'Zimbabwe'], ['MZ', 'موزمبيق', 'Mozambique'], ['MW', 'مالاوي', 'Malawi'],
    ['MG', 'مدغشقر', 'Madagascar'], ['MU', 'موريشيوس', 'Mauritius'], ['NA', 'ناميبيا', 'Namibia'], ['BW', 'بوتسوانا', 'Botswana'],
    ['SS', 'جنوب السودان', 'South Sudan'], ['CV', 'الرأس الأخضر', 'Cape Verde'], ['SC', 'سيشل', 'Seychelles'],
    ['AD', 'أندورا', 'Andorra'], ['MC', 'موناكو', 'Monaco'], ['LI', 'ليختنشتاين', 'Liechtenstein'], ['SM', 'سان مارينو', 'San Marino'],
    ['FJ', 'فيجي', 'Fiji'], ['PG', 'بابوا غينيا الجديدة', 'Papua New Guinea'],
    ['VA', 'الفاتيكان', 'Vatican City', 'Holy See'], ['KP', 'كوريا الشمالية', 'North Korea'], ['BT', 'بوتان', 'Bhutan'],
    ['TL', 'تيمور الشرقية', 'Timor-Leste', 'East Timor'], ['BI', 'بوروندي', 'Burundi'], ['CF', 'جمهورية أفريقيا الوسطى', 'Central African Republic', 'افريقيا الوسطى'],
    ['GQ', 'غينيا الاستوائية', 'Equatorial Guinea'], ['GW', 'غينيا بيساو', 'Guinea-Bissau'], ['SZ', 'إسواتيني', 'Eswatini', 'سوازيلاند Swaziland'],
    ['LS', 'ليسوتو', 'Lesotho'], ['ST', 'ساو تومي وبرينسيب', 'Sao Tome and Principe'], ['AG', 'أنتيغوا وباربودا', 'Antigua and Barbuda'],
    ['BB', 'باربادوس', 'Barbados'], ['BZ', 'بليز', 'Belize'], ['DM', 'دومينيكا', 'Dominica'], ['GD', 'غرينادا', 'Grenada'],
    ['GY', 'غيانا', 'Guyana'], ['HT', 'هايتي', 'Haiti'], ['KN', 'سانت كيتس ونيفيس', 'Saint Kitts and Nevis'], ['LC', 'سانت لوسيا', 'Saint Lucia'],
    ['VC', 'سانت فنسنت والغرينادين', 'Saint Vincent and the Grenadines'], ['SR', 'سورينام', 'Suriname'], ['KI', 'كيريباتي', 'Kiribati'],
    ['MH', 'جزر مارشال', 'Marshall Islands'], ['FM', 'ميكرونيزيا', 'Micronesia'], ['NR', 'ناورو', 'Nauru'], ['PW', 'بالاو', 'Palau'],
    ['WS', 'ساموا', 'Samoa'], ['SB', 'جزر سليمان', 'Solomon Islands'], ['TO', 'تونغا', 'Tonga'], ['TV', 'توفالو', 'Tuvalu'], ['VU', 'فانواتو', 'Vanuatu'],
    // مش دول أعضاء بالأمم المتحدة بس بيلزموا بالحوالات (موجودين فوق): هونغ كونغ، تايوان، بورتوريكو، كوسوفو
    ['MO', 'ماكاو', 'Macau', 'Macao'], ['GI', 'جبل طارق', 'Gibraltar'], ['GL', 'غرينلاند', 'Greenland'], ['RE', 'لا ريونيون', 'Réunion', 'Reunion'],
    ['GP', 'غوادلوب', 'Guadeloupe'], ['MQ', 'مارتينيك', 'Martinique'], ['GF', 'غويانا الفرنسية', 'French Guiana'], ['NC', 'كاليدونيا الجديدة', 'New Caledonia'],
    ['PF', 'بولينيزيا الفرنسية', 'French Polynesia', 'تاهيتي Tahiti'], ['AW', 'أروبا', 'Aruba'], ['CW', 'كوراساو', 'Curacao'], ['BM', 'برمودا', 'Bermuda'],
    ['KY', 'جزر كايمان', 'Cayman Islands'], ['GU', 'غوام', 'Guam'], ['IM', 'جزيرة مان', 'Isle of Man'], ['JE', 'جيرسي', 'Jersey'], ['GG', 'غيرنزي', 'Guernsey'],
    ['FO', 'جزر فارو', 'Faroe Islands'], ['EH', 'الصحراء الغربية', 'Western Sahara']
];

// العلم من رمز الدولة (حرفين ← رموز المناطق)
const worldFlag = (iso) => (/^[A-Z]{2}$/.test(iso || '') ? String.fromCodePoint(...[...iso].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '🌍');

// للبحث: بدون "ال" بالأول، أ/إ/آ = ا، ة = ه، ى = ي، والإنجليزي حروف صغيرة
function worldNorm(text) {
    return String(text || '').toLowerCase().normalize('NFKD').replace(/[ً-ٰٟ̀-ͯ]/g, '')
        .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/(^|\s)ال/g, '$1').replace(/\s+/g, ' ').trim();
}

const worldCountry = (iso) => WORLD_COUNTRIES.find(c => c[0] === iso) || null;

// الدول اللي بتطابق البحث: اللي بيبدأ اسمها بالكلمة أول
function worldSearch(q, limit = 8) {
    const n = worldNorm(q);
    if (!n) return [];
    const scored = [];
    WORLD_COUNTRIES.forEach(c => {
        const names = [c[1], c[2], ...(c[3] || '').split(' ')].map(worldNorm).filter(Boolean);
        if (c[0].toLowerCase() === n) return scored.push([0, c]);
        if (names.some(x => x.startsWith(n))) return scored.push([1, c]);
        if (names.some(x => x.includes(n))) scored.push([2, c]);
    });
    return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(x => x[1]);
}

// ================= الطرق: بأي دول بتشتغل (بطلب عماد 2026-10-25: "انت تعرف لحالك أي دولة فيها طرق") =================
// معلومات جاهزة لكل شركة (only = بس هالدول، except = كل الدول إلا هدول). بتتغير مع الوقت، فبالإعدادات في تعديل بإيد
// (زيادة extra / إلا blocked) فوقها. المصادر (تشرين الأول 2026): Revolut من صفحة المساعدة الرسمية (الدول المدعومة)،
// Wise من صفحة "الدول اللي ما بنشتغل فيها" الرسمية، PayPal من عدة مصادر لأنه صفحتهم ما فتحت (الأقل دقة)،
// Payoneer و Western Union و MoneyGram: كل الدول إلا دول العقوبات تقريباً.
const EEA_COUNTRIES = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
const PROVIDER_COVERAGE = {
    revolut: { mode: 'only', countries: [...EEA_COUNTRIES, 'CH', 'GB', 'US', 'AU', 'NZ', 'SG', 'JP', 'BR', 'MX', 'AE', 'CO', 'CL'] },
    wise: { mode: 'except', countries: ['AF', 'BY', 'BI', 'CF', 'TD', 'CG', 'CD', 'CU', 'ER', 'IR', 'IQ', 'KP', 'LY', 'MM', 'SO', 'SS', 'RU', 'SD', 'SY', 'YE', 'VE'] },
    paypal: { mode: 'except', countries: ['PS', 'IR', 'SY', 'IQ', 'AF', 'LY', 'SD', 'SS', 'PK', 'LB', 'BD', 'CU', 'KP', 'MM', 'RU'] },
    payoneer: { mode: 'except', countries: ['IR', 'SY', 'CU', 'KP', 'RU', 'BY', 'SD', 'SS', 'MM'] },
    westernunion: { mode: 'except', countries: ['IR', 'SY', 'CU', 'KP', 'RU', 'BY'] },
    moneygram: { mode: 'except', countries: ['IR', 'SY', 'CU', 'KP', 'RU', 'BY'] }
};
const PROVIDER_COVERAGE_AS_OF = 'تشرين الأول 2026';

// الطريقة بتشتغل من هالدولة؟ تلقائي (المعلومات الجاهزة + تعديلات extra/blocked)، أو بإيد (mode/countries)
function methodWorksIn(m, iso) {
    const cov = m.auto !== 'no' ? PROVIDER_COVERAGE[m.brand] : null;
    if (cov) {
        if ((m.blocked || []).includes(iso)) return false;
        if ((m.extra || []).includes(iso)) return true;
        return cov.mode === 'except' ? !cov.countries.includes(iso) : cov.countries.includes(iso);
    }
    const list = m.countries || [];
    return m.mode === 'except' ? !list.includes(iso) : list.includes(iso);
}

const methodIsAuto = (m) => m.auto !== 'no' && !!PROVIDER_COVERAGE[m.brand];
const methodCountryCount = (m) => WORLD_COUNTRIES.filter(c => methodWorksIn(m, c[0])).length;

// "بتشتغل من 42 دولة" أو "من كل الدول إلا 15" (الطرق اللي بتشتغل بأغلب العالم)
function methodCoverageText(m) {
    const broad = methodIsAuto(m) ? PROVIDER_COVERAGE[m.brand].mode === 'except' : m.mode === 'except';
    if (!broad) return `من ${methodCountryCount(m)} دولة`;
    const out = WORLD_COUNTRIES.filter(c => !methodWorksIn(m, c[0])).length;
    return out ? `من كل الدول إلا ${out}` : 'من كل الدول';
}

// ================= دول التسعير بالصفحة (بطلب عماد 2026-10-25: "خلي كل الدول اللي عنا تلقائي") =================
// كل سطر بـ "تسعير الدول" اسمه دولة (بعلمها أو باسمها) بيطلع بالصفحة لحاله "حوالة من قطر" بسعره؛
// المصادر اللي مش دول (باي بال، ويسترن، تيك توك…) بتضل "طرق". USDT والجنيه إلهم صفحاتهم فبينتجاهلوا.
function pricingCountryIso(name) {
    const text = String(name || '');
    if (/usdt|جنيه/i.test(text)) return '';
    const flag = text.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
    if (flag) {
        const iso = [...flag[0]].map(ch => String.fromCharCode(ch.codePointAt(0) - 0x1F1E6 + 65)).join('');
        return worldCountry(iso) ? iso : '';
    }
    const n = worldNorm(text.replace(/[^\p{L}\s]/gu, ' '));
    const hit = n && WORLD_COUNTRIES.find(c => [c[1], c[2], ...(c[3] || '').split(' ')].some(x => worldNorm(x) === n));
    return hit ? hit[0] : '';
}

// اسم عملة الدولة (للمبلغ اللي الزبون بيبعته)؛ غيرها "بعملتها"
const COUNTRY_CURRENCY = {
    QA: 'ريال قطري', SA: 'ريال سعودي', AE: 'درهم', OM: 'ريال عماني', KW: 'دينار كويتي', BH: 'دينار بحريني', JO: 'دينار أردني',
    IQ: 'دينار عراقي', MA: 'درهم مغربي', TN: 'دينار تونسي', DZ: 'دينار جزائري', LY: 'دينار ليبي', TR: 'ليرة تركية', GB: 'جنيه إسترليني',
    US: 'دولار', CA: 'دولار كندي', AU: 'دولار أسترالي', CH: 'فرنك', SE: 'كرونة', NO: 'كرونة', DK: 'كرونة', JP: 'ين', CN: 'يوان',
    MY: 'رينغيت', SG: 'دولار سنغافوري', IN: 'روبية', PK: 'روبية', RU: 'روبل', IL: 'شيكل', PS: 'شيكل', EG: 'جنيه'
};
EEA_COUNTRIES.forEach(c => { if (!COUNTRY_CURRENCY[c] && !['BG', 'CZ', 'DK', 'HU', 'IS', 'LI', 'NO', 'PL', 'RO', 'SE'].includes(c)) COUNTRY_CURRENCY[c] = 'يورو'; });
const countryCurrency = (iso) => COUNTRY_CURRENCY[iso] || 'بعملتها';

