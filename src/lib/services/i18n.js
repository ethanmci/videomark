import { initLocales } from '@sveltia/ui';
import { addMessages, init, locale } from 'svelte-i18n';
import { get } from 'svelte/store';

/**
 * 文字列を読み込んでロケールを初期化。
 * @see https://github.com/kaisermann/svelte-i18n/blob/main/docs/Getting%20Started.md
 * @see https://vitejs.dev/guide/features.html#glob-import
 */
export const initAppLocales = () => {
  const modules = import.meta.glob('../locales/*.js', { eager: true });

  Object.entries(modules).forEach(([path, { strings }]) => {
    const [, locale] = path.match(/([a-zA-Z-]+)\.js/);

    addMessages(locale, strings);
  });

  const config = {
    fallbackLocale: 'en',
    initialLocale: chrome.i18n.getUILanguage().split('-')[0] || 'en',
  };

  initLocales(config);
  init(config);
};

/**
 * 与えられた日付をアプリのロケールでフォーマット。
 * @param {(Date|number)} date 日付。
 * @param {object} [options] オプション。
 * @param {boolean} [options.full] 冗長な形式でフォーマットするか。しない場合、現在と同じ年であるかなどによって、
 * 時間あるいは年を省略するなど形式を変える。
 * @returns {string} フォーマットされた日時。
 */
export const formatDateTime = (date, { full = false } = {}) => {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }

  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameMonth = sameYear && date.getMonth() === now.getMonth();
  const sameDay = sameMonth && date.getDate() === now.getDate();

  return date
    .toLocaleString(get(locale), {
      year: full || !sameYear ? 'numeric' : undefined,
      month: full || !sameDay ? 'short' : undefined,
      day: full || !sameDay ? 'numeric' : undefined,
      hour: full || sameYear ? 'numeric' : undefined,
      minute: full || sameYear ? 'numeric' : undefined,
      hour12: true,
    })
    .replace(/\b(\w+)\b/g, ' $1 ') // 英数字の前後に空白を追加
    .replace(/\s{2,}/, ' ')
    .trim();
};
