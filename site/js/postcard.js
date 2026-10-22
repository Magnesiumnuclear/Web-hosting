// 明信片、郵票、郵戳的 DOM。所有使用者內容一律用 textContent，不用 innerHTML。
import { STAMPS, isStamp } from './shared.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const pad = (n) => String(n).padStart(2, '0');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag, attrs, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// 今年的省略年份，地址欄才不會換行
export function formatDateTime(date) {
  const year = date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}/`;
  return `${year}${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 同一張明信片每次都歪同一個角度（-1.6° 到 1.6°）
function tiltFor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.codePointAt(0)) | 0;
  return (((h % 33) + 33) % 33 - 16) / 10;
}

function initialOf(name) {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : '郵';
}

// 郵票：Google 頭像印成單色版畫；沒有頭像就用名字的第一個字
export function renderStamp({ stamp, name = '', photo = '', specimen = false, size = 'full' }) {
  const kind = isStamp(stamp) ? stamp : 'vermilion';
  const root = el('span', size === 'mini' ? 'stamp stamp--mini' : 'stamp');
  root.dataset.stamp = kind;
  root.setAttribute('aria-hidden', 'true');

  const face = el('span', 'stamp__face');
  const fallback = () => el('span', 'stamp__initial', initialOf(name));
  if (photo) {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
    img.src = photo;
    face.append(img);
  } else {
    face.append(fallback());
  }
  if (size !== 'mini') face.append(el('span', 'stamp__value', STAMPS[kind].value));
  root.append(face);
  if (specimen) root.append(el('span', 'stamp__specimen', '樣張'));
  return root;
}

// 櫛型郵戳：上段局名、中段日期、下段時間，右邊拖著波浪消印
export function renderPostmark(date) {
  const yy = String(date.getFullYear()).slice(-2);
  const root = svg('svg', { viewBox: '0 0 150 72', class: 'postmark', 'aria-hidden': 'true', focusable: 'false' });
  for (let i = 0; i < 4; i++) {
    const y = 19 + i * 11.5;
    root.append(svg('path', { d: `M70 ${y} q 9 -5 18 0 t 18 0 t 18 0 t 18 0`, class: 'postmark__wave' }));
  }
  root.append(
    svg('circle', { cx: 36, cy: 36, r: 31, class: 'postmark__ring' }),
    svg('circle', { cx: 36, cy: 36, r: 27.5, class: 'postmark__ring postmark__ring--thin' }),
    svg('line', { x1: 6.2, y1: 28, x2: 65.8, y2: 28, class: 'postmark__bar' }),
    svg('line', { x1: 6.2, y1: 44, x2: 65.8, y2: 44, class: 'postmark__bar' }),
    svg('text', { x: 36, y: 22.5, class: 'postmark__place' }, '街角'),
    svg('text', { x: 36, y: 40, class: 'postmark__date' }, `${yy}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`),
    svg('text', { x: 36, y: 57, class: 'postmark__time' }, `${pad(date.getHours())}:${pad(date.getMinutes())}`),
  );
  return root;
}

function addressLine(label, value) {
  const row = el('div', 'postcard__line');
  row.append(el('dt', '', label));
  const dd = el('dd');
  if (value instanceof Node) dd.append(value);
  else dd.textContent = value;
  row.append(dd);
  return row;
}

export function renderPostcard(card, { mine = false, specimen = false, isNew = false, onWithdraw }) {
  const slot = el('li', isNew ? 'card-slot is-new' : 'card-slot');
  slot.style.setProperty('--tilt', `${tiltFor(card.id)}deg`);

  const article = el('article', 'postcard');
  article.dataset.stamp = card.stamp;
  if (card.pending) article.classList.add('is-pending');

  const message = el('div', 'postcard__message');
  message.append(el('p', 'postcard__text', card.text));

  const address = el('div', 'postcard__address');
  const corner = el('div', 'postcard__corner');
  corner.append(
    renderStamp({ stamp: card.stamp, name: card.authorName, photo: card.authorPhoto, specimen }),
    renderPostmark(card.createdAt),
  );

  const time = el('time', '', formatDateTime(card.createdAt));
  time.dateTime = card.createdAt.toISOString();
  const lines = el('dl', 'postcard__lines');
  lines.append(addressLine('寄件人', card.authorName || '無名寄件人'), addressLine('寄出', time));
  address.append(corner, lines);

  if (card.pending) address.append(el('p', 'postcard__pending', '郵遞中…'));
  if (mine && onWithdraw) {
    const button = el('button', 'btn btn--quiet postcard__withdraw', '撤回');
    button.type = 'button';
    button.addEventListener('click', () => onWithdraw(card, button));
    address.append(button);
  }

  article.append(message, address);
  slot.append(article);
  return slot;
}
