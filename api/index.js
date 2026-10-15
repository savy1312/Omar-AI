'use strict';
// Entry-point per Vercel (funzione serverless).
// Esporta l'app Express senza server.listen: Vercel la serve da solo.
// ATTENZIONE: su Vercel il filesystem è effimero (SQLite in ./data si azzera
// a ogni deploy), i WebSocket e Ollama locale non funzionano. Per un uso reale
// in classe serve un server Node sempre acceso (vedi README e docs/).
const { createApp } = require('../src/app');

const { app } = createApp();
module.exports = app;
