'use strict';

let SignalResult = require('../dict/signal_result')

module.exports = class MacdExt {
    getName() {
        return 'macd_ext'
    }

    buildIndicator(indicatorBuilder, options) {
        if (!options['period']) {
            throw 'Invalid period'
        }

        indicatorBuilder.add('macd', 'macd_ext', options['period'], options)

        indicatorBuilder.add('sma200', 'sma', options['period'], {
            'length': 200,
        })
    }

    period(indicatorPeriod) {
        return this.macd(
            indicatorPeriod.getPrice(),
            indicatorPeriod.getIndicator('sma200'),
            indicatorPeriod.getIndicator('macd'),
            indicatorPeriod.getLastSignal(),
        )
    }

    macd(price, sma200Full, macdFull, lastSignal) {
        if (!macdFull || !sma200Full || macdFull.length < 2 || sma200Full.length < 2) {
            return
        }

        // remove incomplete candle
        let sma200 = sma200Full.slice(0, -1)
        let macd = macdFull.slice(0, -1)

        let debug = {
            'sma200': sma200.slice(-1)[0],
            'histogram': macd.slice(-1)[0].histogram,
            'last_signal': lastSignal,
        }

        let before = macd.slice(-2)[0].histogram
        let last = macd.slice(-1)[0].histogram

        // trend change
        if (
            (lastSignal === 'long' && before > 0 && last < 0)
            || (lastSignal === 'short' && before < 0 && last > 0)
        ) {
            return SignalResult.createSignal('close', debug)
        }

        // sma long
        let long = price >= sma200.slice(-1)[0]

        if (long) {
            // long
            if(before < 0 && last > 0) {
                return SignalResult.createSignal('long', debug)
            }
        } else {
            // short

            if (before > 0 && last < 0) {
                return SignalResult.createSignal('short', debug)
            }
        }

        return SignalResult.createEmptySignal(debug)
    }

    getOptions() {
        return {
            'period': '15m',
        }
    }
}
