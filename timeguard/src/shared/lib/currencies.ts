export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "RUB",
  "JPY",
  "CNY",
  "CHF",
  "CAD",
  "AUD",
  "TRY",
  "KZT",
  "AED",
  "UAH",
  "INR",
  "BRL",
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number];

export function isCurrency(v: string): v is CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(v);
}

export function currencyLabel(code: string, locale: string) {
  try {
    const name = new Intl.DisplayNames([locale], { type: "currency" }).of(code);
    return name ? `${code} · ${name}` : code;
  } catch {
    return code;
  }
}
