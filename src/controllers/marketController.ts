import redisService = require('../services/redisService');

const {
    acquireLock,
    executeBuy,
    executeSell,
    getAuditLog,
    getBankLockKey,
    getBankStockQuantity,
    getBankStocks,
    getWalletLockKey,
    getWalletStockQuantity,
    getWalletStocks,
    overwriteBankStocks,
    releaseLock,
} = redisService;

type Request = {
    body: unknown;
    params: {
        wallet_id?: string;
        stock_name?: string;
    };
};

type Response = {
    status: (code: number) => Response;
    json: (payload: unknown) => void;
};

type StockPosition = {
    name: string;
    quantity: number;
};

type TransactionType = 'buy' | 'sell';

type StocksPayload = {
    stocks: StockPosition[];
};

type TransactionPayload = {
    type: TransactionType;
};

function parseStocksPayload(payload: unknown): StockPosition[] | null {
    if (typeof payload !== 'object' || payload === null || !('stocks' in payload)) {
        return null;
    }

    const { stocks } = payload as StocksPayload;
    if (!Array.isArray(stocks)) {
        return null;
    }

    const parsedStocks: StockPosition[] = [];
    for (const stock of stocks) {
        if (
            typeof stock !== 'object' ||
            stock === null ||
            !('name' in stock) ||
            !('quantity' in stock)
        ) {
            return null;
        }

        const name = String((stock as StockPosition).name).trim();
        const quantity = Number((stock as StockPosition).quantity);
        if (!name || !Number.isInteger(quantity) || quantity < 0) {
            return null;
        }

        parsedStocks.push({ name, quantity });
    }

    return parsedStocks;
}

function parseTransactionPayload(payload: unknown): TransactionType | null {
    if (typeof payload !== 'object' || payload === null || !('type' in payload)) {
        return null;
    }

    const type = (payload as TransactionPayload).type;
    if (type !== 'buy' && type !== 'sell') {
        return null;
    }

    return type;
}

async function getStocks(_req: Request, res: Response): Promise<void> {
    try {
        const stocks = await getBankStocks();
        res.status(200).json({ stocks });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch bank stocks.', details: String(error) });
    }
}

async function setStocks(req: Request, res: Response): Promise<void> {
    const stocks = parseStocksPayload(req.body);
    if (!stocks) {
        res.status(400).json({
            error: 'Invalid payload. Expected: { "stocks": [{ "name": "AAPL", "quantity": 10 }] }',
        });
        return;
    }

    try {
        await overwriteBankStocks(stocks);
        res.status(200).json({
            message: 'Bank stocks overwritten successfully.',
            stocks,
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to overwrite bank stocks.', details: String(error) });
    }
}

async function getWallet(req: Request, res: Response): Promise<void> {
    const walletId = req.params.wallet_id;
    if (!walletId) {
        res.status(400).json({ error: 'wallet_id path parameter is required.' });
        return;
    }

    try {
        const stocks = await getWalletStocks(walletId);
        res.status(200).json({
            wallet_id: walletId,
            stocks,
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch wallet.', details: String(error) });
    }
}

async function getWalletStock(req: Request, res: Response): Promise<void> {
    const walletId = req.params.wallet_id;
    const stockName = req.params.stock_name;
    if (!walletId || !stockName) {
        res.status(400).json({ error: 'wallet_id and stock_name path parameters are required.' });
        return;
    }

    try {
        const quantity = await getWalletStockQuantity(walletId, stockName);
        res.status(200).json({
            wallet_id: walletId,
            stock_name: stockName,
            quantity,
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stock quantity.', details: String(error) });
    }
}

async function getLog(_req: Request, res: Response): Promise<void> {
    try {
        const log = await getAuditLog();
        res.status(200).json({ log });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch audit log.', details: String(error) });
    }
}

async function transactStock(req: Request, res: Response): Promise<void> {
    const walletId = req.params.wallet_id;
    const stockName = req.params.stock_name;
    if (!walletId || !stockName) {
        res.status(400).json({ error: 'wallet_id and stock_name path parameters are required.' });
        return;
    }

    const transactionType = parseTransactionPayload(req.body);
    if (!transactionType) {
        res.status(400).json({
            error: 'Invalid payload. Expected: { "type": "buy" } or { "type": "sell" }',
        });
        return;
    }

    const lockKey =
        transactionType === 'buy' ? getBankLockKey(stockName) : getWalletLockKey(walletId, stockName);

    let lockToken: string | null = null;

    try {
        lockToken = await acquireLock(lockKey);
        if (!lockToken) {
            res.status(409).json({ error: 'Resource is busy. Could not acquire lock.' });
            return;
        }

        if (transactionType === 'buy') {
            const bankQuantity = await getBankStockQuantity(stockName);
            if (bankQuantity < 1) {
                res.status(400).json({
                    error: `Bank does not have stock "${stockName}" available.`,
                });
                return;
            }

            const auditEntry = {
                type: 'buy' as const,
                wallet_id: walletId,
                stock_name: stockName,
                quantity: 1,
                timestamp: new Date().toISOString(),
            };

            await executeBuy(walletId, stockName, auditEntry);
            res.status(200).json({
                message: 'Buy transaction completed successfully.',
                transaction: auditEntry,
            });
            return;
        }

        const walletQuantity = await getWalletStockQuantity(walletId, stockName);
        if (walletQuantity < 1) {
            res.status(400).json({
                error: `Wallet "${walletId}" does not have stock "${stockName}" to sell.`,
            });
            return;
        }

        const auditEntry = {
            type: 'sell' as const,
            wallet_id: walletId,
            stock_name: stockName,
            quantity: 1,
            timestamp: new Date().toISOString(),
        };

        await executeSell(walletId, stockName, auditEntry);
        res.status(200).json({
            message: 'Sell transaction completed successfully.',
            transaction: auditEntry,
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to execute transaction.',
            details: String(error),
        });
    } finally {
        if (lockToken) {
            try {
                await releaseLock(lockKey, lockToken);
            } catch (error) {
                console.error('Failed to release lock:', error);
            }
        }
    }
}

function triggerChaos(): void {
    process.exit(1);
}

export = {
    getStocks,
    setStocks,
    getWallet,
    getWalletStock,
    getLog,
    transactStock,
    triggerChaos,
};
