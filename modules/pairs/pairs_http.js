'use strict';

let Order = require('./../../dict/order')

module.exports = class PairsHttp {
    constructor(instances, exchangeManager, orderExecutor) {
        this.instances = instances
        this.exchangeManager = exchangeManager
        this.orderExecutor = orderExecutor
    }

    async getTradePairs() {
        return new Promise(async (resolve) => {
            let pairs = []

            for (const symbol of this.instances.symbols) {
                let position = await this.exchangeManager.getPosition(symbol.exchange, symbol.symbol)

                pairs.push({
                    'exchange': symbol.exchange,
                    'symbol': symbol.symbol,
                    'watchdogs': symbol.watchdogs,
                    'state': symbol.state,
                    'has_position': position !== undefined,
                    'in_order_process': false,
                })
            }

            resolve(pairs)
        })
    }

    async executeOrder(exchangeName, symbol, side) {
        // Order.createMarketOrder(symbol, side,500000)
        return new Promise(async resolve => {
            let order = await this.orderExecutor.executeOrder(
                exchangeName,
                Order.createLimitPostOnlyOrderAutoAdjustedPriceOrder(symbol, side, 50)
            )

            resolve(order)
        })
    }
}
