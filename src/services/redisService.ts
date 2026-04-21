import redis = require('redis');

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const BANK_STOCKS_KEY = 'bank:stocks';
const AUDIT_LOG_KEY = 'audit:log';
const LOCK_TTL_MS = 5000;
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_MAX_RETRIES = 20;

const { createClient } = redis;
const redisClient = createClient({ url: REDIS_URL });

type StockPosition = {
    name: string;
    quantity: number;
};

type TransactionType = 'buy' | 'sell';

type AuditEntry = {
    type: TransactionType;
    wallet_id: string;
    stock_name: string;
    quantity: number;
    timestamp: string;
};

function mapHashToStocks(hash: Record<string, string>): StockPosition[] {
    return Object.entries(hash).map(([name, quantity]) => ({
        name,
        quantity: Number(quantity),
    }));
}

function walletStocksKey(walletId: string): string {
    return `wallet:${walletId}:stocks`;
}

function getBankLockKey(stockName: string): string {
    return `lock:bank:stock:${stockName}`;
}

function getWalletLockKey(walletId: string, stockName: string): string {
    return `lock:wallet:${walletId}:stock:${stockName}`;
}

async function connectRedis(): Promise<void> {
    try {
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }
    } catch (error) {
        throw new Error(`Redis connection failed: ${String(error)}`);
    }
}

async function getBankStocks(): Promise<StockPosition[]> {
    try {
        const stocksHash = await redisClient.hGetAll(BANK_STOCKS_KEY);
        return mapHashToStocks(stocksHash);
    } catch (error) {
        throw new Error(`Failed to fetch bank stocks: ${String(error)}`);
    }
}

async function overwriteBankStocks(stocks: StockPosition[]): Promise<void> {
    try {
        const stocksHash: Record<string, string> = {};
        for (const stock of stocks) {
            stocksHash[stock.name] = String(stock.quantity);
        }

        const transaction = redisClient.multi().del(BANK_STOCKS_KEY);
        if (Object.keys(stocksHash).length > 0) {
            transaction.hSet(BANK_STOCKS_KEY, stocksHash);
        }
        await transaction.exec();
    } catch (error) {
        throw new Error(`Failed to overwrite bank stocks: ${String(error)}`);
    }
}

async function getWalletStocks(walletId: string): Promise<StockPosition[]> {
    try {
        const stocksHash = await redisClient.hGetAll(walletStocksKey(walletId));
        return mapHashToStocks(stocksHash);
    } catch (error) {
        throw new Error(`Failed to fetch wallet stocks: ${String(error)}`);
    }
}

async function getWalletStockQuantity(walletId: string, stockName: string): Promise<number> {
    try {
        const quantityRaw = await redisClient.hGet(walletStocksKey(walletId), stockName);
        return quantityRaw === null ? 0 : Number(quantityRaw);
    } catch (error) {
        throw new Error(`Failed to fetch wallet stock quantity: ${String(error)}`);
    }
}

async function getBankStockQuantity(stockName: string): Promise<number> {
    try {
        const quantityRaw = await redisClient.hGet(BANK_STOCKS_KEY, stockName);
        return quantityRaw === null ? 0 : Number(quantityRaw);
    } catch (error) {
        throw new Error(`Failed to fetch bank stock quantity: ${String(error)}`);
    }
}

async function executeBuy(walletId: string, stockName: string, auditEntry: AuditEntry): Promise<void> {
    try {
        await redisClient
            .multi()
            .hIncrBy(BANK_STOCKS_KEY, stockName, -1)
            .hIncrBy(walletStocksKey(walletId), stockName, 1)
            .rPush(AUDIT_LOG_KEY, JSON.stringify(auditEntry))
            .exec();
    } catch (error) {
        throw new Error(`Failed to execute buy transaction: ${String(error)}`);
    }
}

async function executeSell(walletId: string, stockName: string, auditEntry: AuditEntry): Promise<void> {
    try {
        await redisClient
            .multi()
            .hIncrBy(walletStocksKey(walletId), stockName, -1)
            .hIncrBy(BANK_STOCKS_KEY, stockName, 1)
            .rPush(AUDIT_LOG_KEY, JSON.stringify(auditEntry))
            .exec();
    } catch (error) {
        throw new Error(`Failed to execute sell transaction: ${String(error)}`);
    }
}

async function getAuditLog(): Promise<unknown[]> {
    try {
        const logEntries = await redisClient.lRange(AUDIT_LOG_KEY, 0, -1);
        return logEntries.map((entry) => {
            try {
                return JSON.parse(entry);
            } catch {
                return { event: entry };
            }
        });
    } catch (error) {
        throw new Error(`Failed to fetch audit log: ${String(error)}`);
    }
}

async function acquireLock(lockKey: string): Promise<string | null> {
    try {
        const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt += 1) {
            const lockResult = await redisClient.set(lockKey, lockToken, { NX: true, PX: LOCK_TTL_MS });
            if (lockResult === 'OK') {
                return lockToken;
            }

            await new Promise((resolve) => {
                setTimeout(resolve, LOCK_RETRY_DELAY_MS);
            });
        }

        return null;
    } catch (error) {
        throw new Error(`Failed to acquire lock: ${String(error)}`);
    }
}

async function releaseLock(lockKey: string, lockToken: string): Promise<void> {
    try {
        await redisClient.eval(
            `
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
end
return 0
`,
            {
                keys: [lockKey],
                arguments: [lockToken],
            }
        );
    } catch (error) {
        throw new Error(`Failed to release lock: ${String(error)}`);
    }
}

redisClient.on('error', (error: unknown) => {
    console.error('Redis error:', error);
});

export = {
    connectRedis,
    getBankStocks,
    overwriteBankStocks,
    getWalletStocks,
    getWalletStockQuantity,
    getBankStockQuantity,
    executeBuy,
    executeSell,
    getAuditLog,
    acquireLock,
    releaseLock,
    getBankLockKey,
    getWalletLockKey,
};
