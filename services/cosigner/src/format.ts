const chf = new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF" });

/** Swiss formatting for plain-language messages: CHF 1’234.50 */
export const formatChf = (amount: number) => chf.format(amount);
