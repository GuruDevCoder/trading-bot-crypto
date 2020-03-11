module.exports = class OrderCalculator {
  /**
   * @param tickers {Tickers}
   * @param logger {Logger}
   * @param exchangeManager {ExchangeManager}
   * @param pairConfig {PairConfig}
   */
  constructor(tickers, logger, exchangeManager, pairConfig) {
    this.tickers = tickers;
    this.logger = logger;
    this.exchangeManager = exchangeManager;
    this.pairConfig = pairConfig;
  }

  async calculateOrderSize(exchangeName, symbol) {
    const capital = this.pairConfig.getSymbolCapital(exchangeName, symbol);
    if (!capital) {
      this.logger.error(`No capital: ${JSON.stringify([exchangeName, symbol, capital])}`);
      return undefined;
    }

    const exchange = this.exchangeManager.get(exchangeName);

    // spot exchanges wants to buy assets
    if (!exchange.isInverseSymbol(symbol)) {
      if (capital.asset) {
        return exchange.calculateAmount(capital.asset, symbol);
      }

      const amount = await this.convertCurrencyToAsset(exchangeName, symbol, capital.currency);
      return amount ? exchange.calculateAmount(amount, symbol) : undefined;
    }

    // contracts exchange / pairs need inverse
    if (capital.currency) {
      return exchange.calculateAmount(capital.currency, symbol);
    }

    const amount = await this.convertAssetToCurrency(exchangeName, symbol, capital.asset);
    return amount ? exchange.calculateAmount(amount, symbol) : undefined;
  }

  /**
   * If you want to trade with 0.25 BTC this calculated the asset amount which are available to buy
   *
   * @param exchangeName
   * @param symbol
   * @param currencyAmount
   * @returns {Promise<number>}
   */
  async convertCurrencyToAsset(exchangeName, symbol, currencyAmount) {
    const ticker = this.tickers.get(exchangeName, symbol);
    if (!ticker || !ticker.bid) {
      this.logger.error(
        `Invalid ticker for calculate currency capital:${JSON.stringify([exchangeName, symbol, currencyAmount])}`
      );
      return undefined;
    }

    return currencyAmount / ticker.bid;
  }

  /**
   * If you want to trade with 0.25 BTC this calculated the asset amount which are available to buy
   *
   * @param exchangeName
   * @param symbol
   * @param currencyAmount
   * @returns {Promise<number>}
   */
  async convertAssetToCurrency(exchangeName, symbol, currencyAmount) {
    const ticker = this.tickers.get(exchangeName, symbol);
    if (!ticker || !ticker.bid) {
      this.logger.error(
        `Invalid ticker for calculate currency capital:${JSON.stringify([exchangeName, symbol, currencyAmount])}`
      );
      return undefined;
    }

    return ticker.bid * currencyAmount;
  }
};
