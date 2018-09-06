'use strict';

let sqlite3 = require('sqlite3').verbose();
let TransactionDatabase = require("sqlite3-transactions").TransactionDatabase;
let events = require('events')
let fs = require('fs');
let Bitfinex = require('../exchange/bitfinex.js');
let Bitmex = require('../exchange/bitmex.js');

let Tickers = require('../storage/tickers');
let Candlestick = require('./../dict/candlestick.js');
let ta = require('../utils/technical_analysis');
let Order = require('../dict/order');
let OrderEvent = require('../event/order_event');
let Slack = require('../notify/slack');
var moment = require('moment');
const crypto = require('crypto');
const os = require('os');
const Notify = require('../notify/notify');

const { createLogger, format, transports } = require('winston');

module.exports = class TradeCommand {
    constructor(instance, config) {
        this.instance = instance
        this.config = config
    }

    execute() {
        let eventEmitter = new events.EventEmitter();

        const logger = createLogger({
            level: 'debug',
            transports: [
                new transports.File({filename: './var/log/log.log', timestamp: true}),
                //new transports.Console()
            ]
        });

        let exchanges = {}

        let obj = JSON.parse(fs.readFileSync('./instance.json', 'utf8'));
        let config = JSON.parse(fs.readFileSync('./conf.json', 'utf8'));

        let db = new TransactionDatabase(new sqlite3.Database('bot.db'));
        db.configure("busyTimeout", 4000)

        let filter = obj.symbols.filter(function (symbol) {
            return symbol['exchange'] === 'bitmex' && symbol['state'] === 'watch';
        });

        if(filter.length > 0) {
            exchanges['bitmex'] = new Bitmex(eventEmitter, filter);
        }

        let filter2 = obj.symbols.filter(function (symbol) {
            return symbol['exchange'] === 'bitfinex' && symbol['state'] === 'watch';
        });

        if(filter2.length > 0) {
            exchanges['bitfinex'] = new Bitfinex(eventEmitter, config.exchanges.bitfinex, filter2, logger);
        }

        logger.debug('Started')

        let notifiers = []

        if (config.notify.slack) {
            notifiers.push(new Slack(config.notify.slack))
        }

        let notify = new Notify(notifiers)

        const instanceId = crypto.randomBytes(4).toString('hex');


        let notifyActivePairs = obj.symbols.filter((symbol) => {
            return symbol['state'] === 'watch';
        }).map((symbol) => {
            return symbol.exchange + '.' + symbol.symbol
        })

        notify.send('Start: ' + instanceId + ' - ' + os.hostname() + ' - ' + os.platform() + ' - ' + moment().format() + ' - ' + notifyActivePairs.join(', '))

        setInterval(() => {
            notify.send('Heartbeat: ' + instanceId + ' - ' + os.hostname() + ' - ' + os.platform() + ' - ' + moment().format() + ' - ' + notifyActivePairs.join(', '))
        }, 60 * 60 * 30);


        eventEmitter.on('candlestick', (candleStickEvent) => {
            db.beginTransaction(function(err, transaction) {
                candleStickEvent.candles.forEach(function (candle) {
                    // Try to update any existing row
                    let update = '' +
                        'UPDATE candlesticks SET exchange=$exchange, symbol=$symbol, period=$period, time=$time, open=$open, high=$high, low=$low, close=$close, volume=$volume\n' +
                        'WHERE exchange=$exchange AND symbol=$symbol AND period=$period AND time=$time'

                    let insert = '' +
                        'INSERT OR IGNORE INTO candlesticks(exchange, symbol, period, time, open, high, low, close, volume) VALUES ($exchange, $symbol, $period, $time, $open, $high, $low, $close, $volume)'

                    let parameters = {
                        '$exchange': candleStickEvent.exchange,
                        '$symbol': candleStickEvent.symbol,
                        '$period': candleStickEvent.period,
                        '$time': candle.time,
                        '$open': candle.open,
                        '$high': candle.high,
                        '$low': candle.low,
                        '$close': candle.close,
                        '$volume': candle.volume
                    };

                    transaction.run(update, parameters);
                    transaction.run(insert, parameters);
                })

                transaction.commit((err) => {
                    if (err) {
                        return console.log("Sad panda :-( commit() failed.", err);
                    }
                });
            });
        });

        let tickers = new Tickers();

        setInterval(() => {
            eventEmitter.emit('tick', {})
        }, 5000);

        eventEmitter.on('ticker', function(tickerEvent) {
            tickers.set(tickerEvent.ticker)
        });

        eventEmitter.on('orderbook', function(orderbookEvent) {
            //console.log(orderbookEvent.orderbook)
        });

        eventEmitter.on('exchange_order', function(exchangeOrderEvent) {
            console.log(exchangeOrderEvent)
        });

        eventEmitter.on('exchange_orders', function(exchangeOrderEvent) {
            console.log(exchangeOrderEvent)
        });

        eventEmitter.on('order', function(orderEvent) {
            logger.debug('Create Order:' + JSON.stringify(orderEvent))

            if (!exchanges[orderEvent.exchange]) {
                console.log('order: unknown exchange:' + orderEvent.exchange)
                return
            }

            let exchange = exchanges[orderEvent.exchange]

            let ordersForSymbol = exchange.getOrdersForSymbol(orderEvent.symbol);

            if (ordersForSymbol.length === 0) {
                exchanges[orderEvent.exchange].order(orderEvent.symbol, orderEvent.order).then((order) => {
                    console.log(order)
                }).catch(() => {
                    console.log('error')
                })

                return
            }

            logger.debug('Info Order update:' + JSON.stringify(orderEvent))

            let currentOrder = ordersForSymbol[0];

            if (currentOrder.side !== orderEvent.order.side) {
                console.log('order side change')
                return
            }

            exchanges[orderEvent.exchange].updateOrder(currentOrder.id, orderEvent.order).then((order) => {
                console.log(order)
            }).catch(() => {
                console.log('error')
            })
        });

        eventEmitter.on('tick', () => {
            obj.symbols.forEach((symbol) => {
                let ticker = tickers.get(symbol.exchange, symbol.symbol);

                if (!ticker) {
                    console.error('Ticker no found for + ' + symbol.exchange + symbol.symbol)
                    return;
                }

                let sql = 'SELECT * from candlesticks where exchange = ? AND symbol = ? and period = ? order by time DESC LIMIT 500';

                db.all(sql, [symbol.exchange, symbol.symbol, '15m'], (err, rows) => {
                    if (err) {
                        console.log(err);
                        return;
                    }

                    let candles = rows.map((row) => {
                        return new Candlestick(row.time, row.open, row.high, row.low, row.close, row.volume)
                    });

                    (async () => {
                        const result = await ta.getIndicatorsLookbacks(candles.reverse());

                        /*
                        console.log('----')
                        let reverse = result['ema_55'].reverse();
                        console.log('ema_55: ' + reverse[0])
                        console.log('ema_200: ' + result['ema_200'].reverse()[0])
                        console.log('rsi: ' + result['rsi'].reverse()[0])
                        console.log('cci: ' + result['cci'].reverse()[0])
                        console.log('ao: ' + result['ao'].reverse()[0])
                        console.log('bid: ' + ticker.bid)
                        console.log('ask: ' + ticker.ask)


                        let wantPrice = reverse[0]

                        let side = 'buy'
                        if(ticker.ask < wantPrice) {
                            side = 'sell'
                        }
                        */

                        /*
                        let e = new OrderEvent(
                            symbol.exchange,
                            symbol.symbol,
                            new Order(side, reverse[0], 10)
                        )

                        notify.send('Create order: ' + JSON.stringify(e))


                        eventEmitter.emit('order', new OrderEvent(
                            symbol.exchange,
                            symbol.symbol,
                            new Order(side, reverse[0], 10)
                        ))
                        */

                    })()
                });
            })
        });
    }
};