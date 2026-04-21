import express = require('express');
import marketController = require('./controllers/marketController');

const router = express.Router();

router.get('/stocks', marketController.getStocks);
router.post('/stocks', marketController.setStocks);
router.get('/wallets/:wallet_id', marketController.getWallet);
router.get('/wallets/:wallet_id/stocks/:stock_name', marketController.getWalletStock);
router.get('/log', marketController.getLog);
router.post('/wallets/:wallet_id/stocks/:stock_name', marketController.transactStock);
router.post('/chaos', marketController.triggerChaos);

export = { router };
