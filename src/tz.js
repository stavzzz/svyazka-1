// Таймзоны: словарь 33 регионов (ТЗ §5), подписи зон, эмодзи-часы.
// ЕДИНСТВЕННЫЙ источник правды по зонам (дефект №2 оригинала — не дублировать).
import { DateTime } from 'luxon';

// Граница слова: перед совпадением не должно быть буквы («Ижевск» не ловится внутри слов).
const B = '(?<![а-яёa-z])';

// [стем-регэксп, каноничное имя для показа, IANA-зона]
const CITIES = [
  ['калининград', 'Калининград', 'Europe/Kaliningrad'],
  ['москв|мск', 'Москва', 'Europe/Moscow'],
  ['питер|спб|санкт-петербург', 'Питер', 'Europe/Moscow'],
  ['сочи', 'Сочи', 'Europe/Moscow'],
  ['краснодар', 'Краснодар', 'Europe/Moscow'],
  ['ростов', 'Ростов', 'Europe/Moscow'],
  ['воронеж', 'Воронеж', 'Europe/Moscow'],
  ['казан', 'Казань', 'Europe/Moscow'],
  ['новгород', 'Новгород', 'Europe/Moscow'],
  ['волгоград', 'Волгоград', 'Europe/Moscow'],
  ['мурманск', 'Мурманск', 'Europe/Moscow'],
  ['самар', 'Самара', 'Europe/Samara'],
  ['саратов', 'Саратов', 'Europe/Samara'],
  ['ижевск', 'Ижевск', 'Europe/Samara'],
  ['ульяновск', 'Ульяновск', 'Europe/Samara'],
  ['екатеринбург|екб', 'Екатеринбург', 'Asia/Yekaterinburg'],
  ['челябинск', 'Челябинск', 'Asia/Yekaterinburg'],
  ['перм', 'Пермь', 'Asia/Yekaterinburg'],
  ['уф[аеы]', 'Уфа', 'Asia/Yekaterinburg'],
  ['тюмен', 'Тюмень', 'Asia/Yekaterinburg'],
  ['омск', 'Омск', 'Asia/Omsk'],
  ['новосибирск', 'Новосибирск', 'Asia/Novosibirsk'],
  ['красноярск', 'Красноярск', 'Asia/Krasnoyarsk'],
  ['кемеров', 'Кемерово', 'Asia/Krasnoyarsk'],
  ['барнаул', 'Барнаул', 'Asia/Krasnoyarsk'],
  ['томск', 'Томск', 'Asia/Krasnoyarsk'],
  ['иркутск', 'Иркутск', 'Asia/Irkutsk'],
  ['улан-удэ', 'Улан-Удэ', 'Asia/Irkutsk'],
  ['якутск', 'Якутск', 'Asia/Yakutsk'],
  ['владивосток', 'Владивосток', 'Asia/Vladivostok'],
  ['хабаровск', 'Хабаровск', 'Asia/Vladivostok'],
  ['магадан', 'Магадан', 'Asia/Magadan'],
  ['сахалин', 'Сахалин', 'Asia/Magadan'],
  ['камчатк', 'Камчатка', 'Asia/Kamchatka'],
  ['тбилиси|грузи', 'Тбилиси', 'Asia/Tbilisi'],
  ['минск|беларус', 'Минск', 'Europe/Minsk'],
  ['киев|украин', 'Киев', 'Europe/Kyiv'],
  ['ереван', 'Ереван', 'Asia/Yerevan'],
  ['баку', 'Баку', 'Asia/Baku'],
  ['алмат|казахстан', 'Алматы', 'Asia/Almaty'],
  ['ташкент', 'Ташкент', 'Asia/Tashkent'],
  ['бишкек|киргизи', 'Бишкек', 'Asia/Bishkek'],
  ['стамбул', 'Стамбул', 'Europe/Istanbul'],
  ['дуба[йея]|оаэ', 'Дубай', 'Asia/Dubai'],
  ['коломбо|шри-ланк', 'Коломбо', 'Asia/Colombo'],
  ['бангкок|таиланд', 'Бангкок', 'Asia/Bangkok'],
  ['токио', 'Токио', 'Asia/Tokyo'],
  ['пекин|шанха[йе]|кита[йе]', 'Пекин', 'Asia/Shanghai'],
  ['лондон|gmt(?![+-])', 'Лондон', 'Europe/London'],
  ['берлин', 'Берлин', 'Europe/Berlin'],
  ['париж', 'Париж', 'Europe/Paris'],
  ['нью-йорк|nyc|est|edt', 'Нью-Йорк', 'America/New_York'],
  ['лос-анджелес|pst|pdt', 'Лос-Анджелес', 'America/Los_Angeles'],
  ['сидне[йе]', 'Сидней', 'Australia/Sydney'],
  // ── Расширение 23.07: крупные города мира (правка Стаса) ──
  // Европа
  ['лиссабон|португали', 'Лиссабон', 'Europe/Lisbon'],
  ['мадрид|барселон|испани', 'Мадрид', 'Europe/Madrid'],
  ['рим[ае]?(?![а-яё])|милан|итали', 'Рим', 'Europe/Rome'],
  ['амстердам|нидерланд|голланди', 'Амстердам', 'Europe/Amsterdam'],
  ['брюссел|бельги', 'Брюссель', 'Europe/Brussels'],
  ['вен[аеу](?![а-яё])|австри', 'Вена', 'Europe/Vienna'],
  ['цюрих|женев|швейцари', 'Цюрих', 'Europe/Zurich'],
  ['прага|праге|чехи', 'Прага', 'Europe/Prague'],
  ['варшав|польш|краков', 'Варшава', 'Europe/Warsaw'],
  ['будапешт|венгри', 'Будапешт', 'Europe/Budapest'],
  ['бухарест|румыни', 'Бухарест', 'Europe/Bucharest'],
  ['софи[яи](?![а-яё])|болгари', 'София', 'Europe/Sofia'],
  ['белград|серби', 'Белград', 'Europe/Belgrade'],
  ['афин|греци', 'Афины', 'Europe/Athens'],
  ['хельсинки|финлянди', 'Хельсинки', 'Europe/Helsinki'],
  ['стокгольм|швеци', 'Стокгольм', 'Europe/Stockholm'],
  ['осло|норвеги', 'Осло', 'Europe/Oslo'],
  ['копенгаген|дани[ия](?![а-яё])', 'Копенгаген', 'Europe/Copenhagen'],
  ['дублин|ирланди', 'Дублин', 'Europe/Dublin'],
  ['эдинбург|глазго', 'Эдинбург', 'Europe/London'],
  ['рейкьявик|исланди', 'Рейкьявик', 'Atlantic/Reykjavik'],
  ['риг[аеу](?![а-яё])|латви', 'Рига', 'Europe/Riga'],
  ['вильнюс|литв', 'Вильнюс', 'Europe/Vilnius'],
  ['таллин|эстони', 'Таллин', 'Europe/Tallinn'],
  ['кишин[её]в|молдов', 'Кишинёв', 'Europe/Chisinau'],
  // Ближний Восток и Африка
  ['тель-авив|иерусалим|израил', 'Тель-Авив', 'Asia/Jerusalem'],
  ['каир|египет|египт|хургад|шарм', 'Каир', 'Africa/Cairo'],
  ['доха|катар', 'Доха', 'Asia/Qatar'],
  ['эр-рияд|рияд|джидд|саудовск', 'Эр-Рияд', 'Asia/Riyadh'],
  ['кувейт', 'Кувейт', 'Asia/Kuwait'],
  ['манам|бахрейн', 'Манама', 'Asia/Bahrain'],
  ['маскат|оман', 'Маскат', 'Asia/Muscat'],
  ['абу-даби', 'Абу-Даби', 'Asia/Dubai'],
  ['тегеран|иран', 'Тегеран', 'Asia/Tehran'],
  ['багдад|ирак', 'Багдад', 'Asia/Baghdad'],
  ['амман|иордани', 'Амман', 'Asia/Amman'],
  ['бейрут|ливан', 'Бейрут', 'Asia/Beirut'],
  ['анкар|анталь|алань|турци', 'Анкара', 'Europe/Istanbul'],
  ['касабланк|марокко', 'Касабланка', 'Africa/Casablanca'],
  ['тунис', 'Тунис', 'Africa/Tunis'],
  ['алжир', 'Алжир', 'Africa/Algiers'],
  ['найроби|кени[ия]', 'Найроби', 'Africa/Nairobi'],
  ['лагос|нигери', 'Лагос', 'Africa/Lagos'],
  ['аддис-абеб|эфиопи', 'Аддис-Абеба', 'Africa/Addis_Ababa'],
  ['кейптаун|йоханнесбург|претори', 'Йоханнесбург', 'Africa/Johannesburg'],
  ['занзибар|дар-эс-салам|танзани', 'Занзибар', 'Africa/Dar_es_Salaam'],
  ['маврики', 'Маврикий', 'Indian/Mauritius'],
  ['сейшел', 'Сейшелы', 'Indian/Mahe'],
  // Азия
  ['хошимин|хо ши мин|сайгон|ханой|вьетнам|нячанг|дананг|фукуок', 'Хошимин', 'Asia/Ho_Chi_Minh'],
  ['пномпен|камбодж', 'Пномпень', 'Asia/Phnom_Penh'],
  ['вьентьян|лаос', 'Вьентьян', 'Asia/Vientiane'],
  ['янгон|мьянм', 'Янгон', 'Asia/Yangon'],
  ['сингапур', 'Сингапур', 'Asia/Singapore'],
  ['куала-лумпур|малайзи', 'Куала-Лумпур', 'Asia/Kuala_Lumpur'],
  ['джакарт|индонези', 'Джакарта', 'Asia/Jakarta'],
  ['бали(?![а-яё])|денпасар|убуд', 'Бали', 'Asia/Makassar'],
  ['манил|филиппин', 'Манила', 'Asia/Manila'],
  ['гонконг', 'Гонконг', 'Asia/Hong_Kong'],
  ['тайб[эе]й|тайван', 'Тайбэй', 'Asia/Taipei'],
  ['сеул|коре[яию]', 'Сеул', 'Asia/Seoul'],
  ['осак|киото', 'Осака', 'Asia/Tokyo'],
  ['дели|мумба|бангалор|гоа(?![а-яё])|инди[ия](?![а-яё])', 'Дели', 'Asia/Kolkata'],
  ['карачи|исламабад|лахор|пакистан', 'Карачи', 'Asia/Karachi'],
  ['дакк[аеу]|бангладеш', 'Дакка', 'Asia/Dhaka'],
  ['катманду|непал|покхар', 'Катманду', 'Asia/Kathmandu'],
  ['мале(?![а-яё])|мальдив', 'Мале', 'Indian/Maldives'],
  ['кабул|афганистан', 'Кабул', 'Asia/Kabul'],
  ['ашхабад|туркмени', 'Ашхабад', 'Asia/Ashgabat'],
  ['душанбе|таджикистан', 'Душанбе', 'Asia/Dushanbe'],
  ['астан[аеу]|нур-султан', 'Астана', 'Asia/Almaty'],
  ['пхукет|самуи|паттай', 'Пхукет', 'Asia/Bangkok'],
  ['улан-батор|монголи', 'Улан-Батор', 'Asia/Ulaanbaatar'],
  // Америки
  ['торонто|монреал|оттав', 'Торонто', 'America/Toronto'],
  ['ванкувер', 'Ванкувер', 'America/Vancouver'],
  ['чикаго|хьюстон|даллас|техас', 'Чикаго', 'America/Chicago'],
  ['майами|атлант[аеу]|бостон|вашингтон|филадельфи', 'Нью-Йорк', 'America/New_York'],
  ['денвер', 'Денвер', 'America/Denver'],
  ['сан-франциско|сиэтл|лас-вегас', 'Лос-Анджелес', 'America/Los_Angeles'],
  ['мехико|мексик', 'Мехико', 'America/Mexico_City'],
  ['панам[аеу]', 'Панама', 'America/Panama'],
  ['богот|колумби', 'Богота', 'America/Bogota'],
  ['лим[аеу](?![а-яё])|перу(?![а-яё])', 'Лима', 'America/Lima'],
  ['каракас|венесуэл', 'Каракас', 'America/Caracas'],
  ['сантьяго|чили', 'Сантьяго', 'America/Santiago'],
  ['буэнос-айрес|аргентин', 'Буэнос-Айрес', 'America/Argentina/Buenos_Aires'],
  ['сан-паулу|сан паулу|рио-де-жанейро|бразили', 'Сан-Паулу', 'America/Sao_Paulo'],
  ['гаван[аеу]', 'Гавана', 'America/Havana'],
  ['монтевидео|уругва', 'Монтевидео', 'America/Montevideo'],
  // Океания
  ['мельбурн', 'Мельбурн', 'Australia/Melbourne'],
  ['брисбен', 'Брисбен', 'Australia/Brisbane'],
  ['перт[ае]?(?![а-яё])', 'Перт', 'Australia/Perth'],
  ['окленд|веллингтон|зеланди', 'Окленд', 'Pacific/Auckland'],
  ['гонолулу|гавай', 'Гонолулу', 'Pacific/Honolulu'],
];

const COMPILED = CITIES.map(([stem, name, tz]) => ({
  rx: new RegExp(B + '(?:' + stem + ')', 'i'),
  name,
  tz,
}));

// Явный офсет: «по GMT+5», «UTC-3», «GMT+5:30» → фиксированная зона (правка 23.07).
const GMT_RX = /(?:gmt|utc|гмт)\s*([+-−])\s*(\d{1,2})(?::(\d{2}))?/i;

// Находит первый упомянутый город. → {name, tz} | null
export function detectCity(text) {
  if (!text) return null;
  const g = GMT_RX.exec(text);
  if (g) {
    const sign = g[1] === '-' || g[1] === '−' ? '-' : '+';
    const hh = parseInt(g[2], 10);
    if (hh <= 14) {
      const mm = g[3] ? `:${g[3]}` : '';
      const tz = `UTC${sign}${hh}${mm}`; // luxon понимает фиксированные зоны UTC±H[:MM]
      return { name: `GMT${sign}${String(hh).padStart(2, '0')}:${g[3] || '00'}`, tz };
    }
  }
  for (const c of COMPILED) {
    if (c.rx.test(text)) return { name: c.name, tz: c.tz };
  }
  return null;
}

// Короткие подписи зон (ТЗ §5); нет в списке → 'GMT+03:00'.
const ZONE_LABELS = {
  'Europe/Moscow': 'МСК',
  'Asia/Tbilisi': 'Тбилиси',
  'Asia/Colombo': 'Коломбо',
  'America/New_York': 'Нью-Йорк',
  'America/Los_Angeles': 'Лос-Анджелес',
  'Europe/London': 'Лондон',
  'Europe/Berlin': 'Берлин',
  'Europe/Istanbul': 'Стамбул',
  'Asia/Dubai': 'Дубай',
  'Asia/Baku': 'Баку',
  'Asia/Tokyo': 'Токио',
  'Asia/Bangkok': 'Бангкок',
  'Asia/Yerevan': 'Ереван',
  'Asia/Almaty': 'Алматы',
  'Australia/Sydney': 'Сидней',
  'Asia/Ho_Chi_Minh': 'Хошимин',
  'America/Sao_Paulo': 'Сан-Паулу',
  'Asia/Kolkata': 'Дели',
  'Asia/Singapore': 'Сингапур',
  'Asia/Seoul': 'Сеул',
  'Asia/Hong_Kong': 'Гонконг',
  'Asia/Kathmandu': 'Катманду',
  'Europe/Madrid': 'Мадрид',
  'Europe/Kyiv': 'Киев',
  'Europe/Minsk': 'Минск',
  'America/Chicago': 'Чикаго',
  'Asia/Jerusalem': 'Тель-Авив',
  'Indian/Maldives': 'Мале',
  'Asia/Makassar': 'Бали',
};

// Смещение зоны в формате 'GMT+03:00' на данный момент времени.
export function gmtLabel(tz, atMs = Date.now()) {
  const dt = DateTime.fromMillis(atMs, { zone: tz });
  const off = dt.offset; // минуты
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `GMT${sign}${hh}:${mm}`;
}

export function zoneLabel(tz, atMs = Date.now()) {
  return ZONE_LABELS[tz] || gmtLabel(tz, atMs);
}

// Эмодзи-часы по времени 'HH:MM' (ТЗ §5).
const CLOCKS = ['🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚'];
export function getClock(t) {
  return CLOCKS[(parseInt(String(t).split(':')[0], 10) || 0) % 12];
}
