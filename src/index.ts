import app = require('./app');
import redisService = require('./services/redisService');

const PORT = Number(process.env.PORT ?? 3000);
const { connectRedis } = redisService;

async function startServer(): Promise<void> {
    await connectRedis();
    app.listen(PORT, () => {
        console.log(`Instancja aplikacji działa na porcie ${PORT}`);
    });
}

startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});