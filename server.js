import express from "express";
import qrcode from "qrcode";
import cors from "cors";
import fs from "fs";
import pkg from "whatsapp-web.js";
import puppeteer from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

const { Client, LocalAuth } = pkg;
puppeteerExtra.use(StealthPlugin());

const app = express();

// ===============================
// CONFIGURAÇÃO BÁSICA
// ===============================
app.use(cors({
  origin: ["https://rapidex.app.br", "https://painel.rapidex.app.br"],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json());

const SESSION_DIR = "./sessions";
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

const clients = {};

// ===============================
// FUNÇÕES DE CLIENTE
// ===============================
function getClient(eid) {
  if (!clients[eid]) {
    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: `${SESSION_DIR}/${eid}` }),
      puppeteer: {
        headless: true,
        executablePath: puppeteer.executablePath(), // usa o Chromium do puppeteer
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-zygote",
          "--single-process",
          "--disable-software-rasterizer",
        ],
      },
    });

    clients[eid] = client;
    startClient(eid);
  }
  return clients[eid];
}

function startClient(eid) {
  const client = clients[eid];
  console.log(`🟡 Iniciando cliente ${eid}...`);

  client.on("qr", async (qr) => {
    console.log(`📸 Novo QR para ${eid}`);
    const qrImage = await qrcode.toDataURL(qr);
    fs.writeFileSync(`${SESSION_DIR}/${eid}_qr.txt`, qrImage);
    fs.writeFileSync(`${SESSION_DIR}/${eid}_status.txt`, "disconnected");
  });

  client.on("ready", () => {
    console.log(`✅ Loja ${eid} conectada ao WhatsApp!`);
    fs.writeFileSync(`${SESSION_DIR}/${eid}_status.txt`, "connected");
    const qrFile = `${SESSION_DIR}/${eid}_qr.txt`;
    if (fs.existsSync(qrFile)) fs.unlinkSync(qrFile);
  });

  client.on("disconnected", () => {
    console.log(`❌ Loja ${eid} desconectada!`);
    fs.writeFileSync(`${SESSION_DIR}/${eid}_status.txt`, "disconnected");
    client.destroy();
    delete clients[eid];
  });

  client.initialize();
}

// ===============================
// ROTAS API
// ===============================
app.get("/qr", (req, res) => {
  const { eid } = req.query;
  if (!eid) return res.status(400).json({ error: "eid obrigatório" });

  const file = `${SESSION_DIR}/${eid}_qr.txt`;
  if (fs.existsSync(file)) {
    res.json({ qr: fs.readFileSync(file, "utf8") });
  } else {
    getClient(eid);
    res.json({ qr: null });
  }
});

app.get("/status", (req, res) => {
  const { eid } = req.query;
  const file = `${SESSION_DIR}/${eid}_status.txt`;

  let status = "desconhecido";
  if (fs.existsSync(file)) status = fs.readFileSync(file, "utf8");

  res.json({
    eid,
    conectado: status === "connected",
    status,
  });
});

app.post("/send", async (req, res) => {
  const { eid, to, message } = req.body;
  if (!eid || !to || !message)
    return res.status(400).json({ error: "Parâmetros faltando." });

  try {
    const client = getClient(eid);
    await client.sendMessage(`${to}@c.us`, message);
    res.json({ success: true });
  } catch (err) {
    console.error(`Erro ao enviar mensagem:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send(`
    <h1>🚀 Rapidex WhatsApp Server</h1>
    <p>Servidor rodando com sucesso!</p>
    <p>Status: <a href="/status?eid=1">/status?eid=1</a></p>
    <p>QR Code: <a href="/qr?eid=1">/qr?eid=1</a></p>
  `);
});

// ===============================
// INICIALIZAÇÃO
// ===============================
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 Servidor WhatsApp rodando na porta ${PORT}`));
