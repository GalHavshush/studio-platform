import { en, type Key } from "./en";

// One dictionary per language. A language may leave keys out; English fills the gaps.
export type Dictionary = Partial<Record<Key, string>>;

export const DICTIONARIES = { en } satisfies Record<string, Dictionary>;
export type Language = keyof typeof DICTIONARIES;

// What `Intl` is told for dates and plural rules ("en-GB" keeps the 24-hour clock and "Thu 30 Oct").
const LOCALES: Record<Language, string> = { en: "en-GB" };

// A language is always named in itself, so it stays readable to someone who picked the wrong one.
export const LANGUAGES: { value: Language; name: string }[] = [{ value: "en", name: "English" }];

type Params = Record<string, string | number>;
type PluralBase<K> = K extends `${infer B}.other` ? B : never;

export type Translator = {
  (key: Key, params?: Params): string;
  /** The wording for a number: `count("plan.seatsLeft", 3)` reads "plan.seatsLeft.other" in English. */
  count: (base: PluralBase<Key>, n: number, params?: Params) => string;
  language: Language;
  locale: string;
};

const fill = (text: string, params: Params = {}) =>
  text.replace(/\{(\w+)\}/g, (hole, name: string) => (name in params ? String(params[name]) : hole));

export function makeTranslator(language: Language, dictionary: Dictionary = DICTIONARIES[language]): Translator {
  const locale = LOCALES[language];
  const lookup = (key: Key) => dictionary[key] ?? en[key];
  const t = (key: Key, params?: Params) => fill(lookup(key), params);
  t.count = (base: PluralBase<Key>, n: number, params?: Params) => {
    // ponytail: older engines may lack Intl.PluralRules; then only 1 is singular (right for English)
    const form = typeof Intl.PluralRules === "function" ? new Intl.PluralRules(locale).select(n) : n === 1 ? "one" : "other";
    const key = `${base}.${form}` as Key;
    return fill(lookup(key in en ? key : (`${base}.other` as Key)), { count: n, ...params });
  };
  t.language = language;
  t.locale = locale;
  return t;
}
