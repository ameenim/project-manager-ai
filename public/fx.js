/* Indicative exchange rates for reporting. Value of one unit in US dollars.
   Edit this table to match your treasury rates. */
(function () {
  const PM = window.PM;
  const USD_PER = { USD: 1, AED: 1 / 3.6725, SAR: 1 / 3.75, KWD: 3.26, QAR: 1 / 3.64, JOD: 1.41, OMR: 2.6, BHD: 2.66, EUR: 1.09, GBP: 1.27, EGP: 1 / 48.5 };
  const fx = {
    rates: USD_PER,
    mode: 'native', // 'native' shows each amount in its own currency, otherwise a currency code to convert to
    choices: ['USD', 'AED', 'SAR'],
    known: (c) => c && USD_PER[c] != null,
    convert(n, from, to) {
      if (n == null || n === '') return n;
      if (!from || from === to) return Number(n);
      if (USD_PER[from] == null || USD_PER[to] == null) return Number(n);
      return (Number(n) * USD_PER[from]) / USD_PER[to];
    },
    // one unit of `to` expressed in `from`, for the footnote
    rateNote(to) { return `1 USD = ${(1 / USD_PER[to]).toFixed(to === 'USD' ? 0 : 4)} ${to}`; },
  };
  PM.fx = fx;
  // format an amount, converting when a display currency is active
  PM.fmt = (n, cur) => {
    if (n == null || n === '') return '';
    if (fx.mode === 'native' || !fx.known(cur)) return PM.money(n, cur);
    return PM.money(Math.round(fx.convert(n, cur, fx.mode)), fx.mode);
  };
})();
