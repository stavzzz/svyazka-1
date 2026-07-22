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
];

const COMPILED = CITIES.map(([stem, name, tz]) => ({
  rx: new RegExp(B + '(?:' + stem + ')', 'i'),
  name,
  tz,
}));

// Находит первый упомянутый город. → {name, tz} | null
export function detectCity(text) {
  if (!text) return null;
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
