import request from 'supertest';

import app from '../src/app';
import redisService from '../src/services/redisService';

jest.mock('../src/services/redisService');

type StockMap = Record<string, number>;
type WalletMap = Record<string, StockMap>;

const mockedRedisService = jest.mocked(redisService);

const lockState = new Map<string, string>();
let bankStocks: StockMap = {};
let wallets: WalletMap = {};
let auditLog: unknown[] = [];

const sleep = (ms: number) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

beforeEach(() => {
    lockState.clear();
    bankStocks = {};
    wallets = {};
    auditLog = [];

    mockedRedisService.connectRedis.mockResolvedValue(undefined);

    mockedRedisService.getBankStocks.mockImplementation(async () =>
        Object.entries(bankStocks).map(([name, quantity]) => ({ name, quantity }))
    );

    mockedRedisService.overwriteBankStocks.mockImplementation(async (stocks: { name: string; quantity: number }[]) => {
        bankStocks = {};
        for (const stock of stocks) {
            bankStocks[stock.name] = stock.quantity;
        }
    });

    mockedRedisService.getWalletStocks.mockImplementation(async (walletId: string) => {
        const wallet = wallets[walletId] ?? {};
        return Object.entries(wallet).map(([name, quantity]) => ({ name, quantity }));
    });

    mockedRedisService.getWalletStockQuantity.mockImplementation(async (walletId: string, stockName: string) => {
        const wallet = wallets[walletId] ?? {};
        return wallet[stockName] ?? 0;
    });

    mockedRedisService.getBankStockQuantity.mockImplementation(async (stockName: string) => bankStocks[stockName] ?? 0);

    mockedRedisService.executeBuy.mockImplementation(
        async (walletId: string, stockName: string, auditEntry: unknown) => {
            bankStocks[stockName] = (bankStocks[stockName] ?? 0) - 1;
            if (!wallets[walletId]) {
                wallets[walletId] = {};
            }
            wallets[walletId][stockName] = (wallets[walletId][stockName] ?? 0) + 1;
            auditLog.push(auditEntry);
        }
    );

    mockedRedisService.executeSell.mockImplementation(
        async (walletId: string, stockName: string, auditEntry: unknown) => {
            if (!wallets[walletId]) {
                wallets[walletId] = {};
            }
            wallets[walletId][stockName] = (wallets[walletId][stockName] ?? 0) - 1;
            bankStocks[stockName] = (bankStocks[stockName] ?? 0) + 1;
            auditLog.push(auditEntry);
        }
    );

    mockedRedisService.getAuditLog.mockImplementation(async () => [...auditLog]);

    mockedRedisService.getBankLockKey.mockImplementation((stockName: string) => `lock:bank:stock:${stockName}`);
    mockedRedisService.getWalletLockKey.mockImplementation(
        (walletId: string, stockName: string) => `lock:wallet:${walletId}:stock:${stockName}`
    );

    mockedRedisService.acquireLock.mockImplementation(async (lockKey: string) => {
        for (let attempt = 0; attempt < 200; attempt += 1) {
            if (!lockState.has(lockKey)) {
                const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                lockState.set(lockKey, token);
                return token;
            }
            await sleep(1);
        }

        return null;
    });

    mockedRedisService.releaseLock.mockImplementation(async (lockKey: string, token: string) => {
        if (lockState.get(lockKey) === token) {
            lockState.delete(lockKey);
        }
    });
});

describe('Market API integration tests', () => {
    test('returns 400 when buying stock unavailable in bank', async () => {
        const response = await request(app).post('/wallets/w1/stocks/ACME').send({ type: 'buy' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Bank does not have stock');
    });

    test('returns 400 when selling stock missing in wallet', async () => {
        const response = await request(app).post('/wallets/w1/stocks/ACME').send({ type: 'sell' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('does not have stock');
    });

    test('returns 400 for malformed JSON payload', async () => {
        const response = await request(app)
            .post('/stocks')
            .set('Content-Type', 'application/json')
            .send('{"stocks":');

        expect(response.status).toBe(400);
    });

    test('allows only 5 successful buys when 10 concurrent requests race for 5 stocks', async () => {
        const seedResponse = await request(app)
            .post('/stocks')
            .send({ stocks: [{ name: 'ACME', quantity: 5 }] });
        expect(seedResponse.status).toBe(200);

        const buyRequests = Array.from({ length: 10 }, () =>
            request(app).post('/wallets/w1/stocks/ACME').send({ type: 'buy' })
        );

        const responses = await Promise.all(buyRequests);
        const successResponses = responses.filter((response) => response.status === 200);
        const rejectedResponses = responses.filter((response) => response.status !== 200);

        expect(successResponses).toHaveLength(5);
        expect(rejectedResponses).toHaveLength(5);
        expect(rejectedResponses.every((response) => response.status === 400)).toBe(true);

        const walletStockResponse = await request(app).get('/wallets/w1/stocks/ACME');
        expect(walletStockResponse.status).toBe(200);
        expect(walletStockResponse.body.quantity).toBe(5);
    });
});
