import express = require('express');
import routesModule = require('./routes');

const { router } = routesModule;
const app = express();

app.use(express.json());
app.use(router);

app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found.' });
});

export = app;
