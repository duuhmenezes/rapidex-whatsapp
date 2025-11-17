import express from "express";
import qrcode from "qrcode";
import cors from "cors";
import fs from "fs";
import pkg from "whatsapp-web.js";
import puppeteer from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import mysql from "mysql2/promise";

puppeteerExtra.use(StealthPlugin());
const { Client, LocalAuth, MessageMedia } = pkg;

process.env.CHROME_PATH = "/usr/bin/google-chrome-stable";

(async () => {

  // ===============================
  // 🔥 BANCO DE DADOS
  // ===============================
  const db = await mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "rapidexapp_sistema",
    password: process.env.DB_PASS || "w&[ouh]El%2T",
    database: process.env.DB_NAME || "rapidexapp_sistema",
    waitForConnections: true,
    connectionLimit: 10,
  });

  const app = express();
  app.use(express.json());
  app.use(cors());

  const SESSION_DIR = "./sessions";
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

  const clients = {};

  // ======================================
  // 🔥 CRIA/RECUPERA CLIENTE
  // ======================================
  function getClient(eid) {
    if (!clients[eid]) {
      const client = new Client({
        authStrategy: new LocalAuth({
          dataPath: `${SESSION_DIR}/${eid}`,
        }),
        puppeteer: {
          headless: true,
          executablePath: process.env.CHROME_PATH,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-zygote",
            "--single-process",
          ],
        },
        puppeteerLaunch: puppeteerExtra,
      });

      clients[eid] = client;
      startClient(eid);
    }
    return clients[eid];
  }

  // ======================================
  // 🔥 INICIA CLIENTE
  // ======================================
  function startClient(eid) {
    const client = clients[eid];

    client.on("qr", async (qr) => {
      const img = await qrcode.toDataURL(qr);
      fs.writeFileSync(`${SESSION_DIR}/${eid}_qr.txt`, img);
      fs.writeFileSync(`${SESSION_DIR}/${eid}_status.txt`, "disconnected");
    });

    client.on("ready", () => {
      fs.writeFileSync(`${SESSION_DIR}/${eid}_status.txt`, "connected");
      const f = `${SESSION_DIR}/${eid}_qr.txt`;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });

    // ======================================
    // 🔥 HANDLER DE MENSAGENS
    // ======================================
    client.on("message", async (msg) => {
      try {
        if (msg.fromMe) return;
        if (msg.from.includes("@g.us")) return;

        const numero = msg.from.replace(/@.+/, "");
        const lojaId = eid;
        const texto = msg.body?.trim().toLowerCase() || "";

        // Buscar domínio da loja
        const [dom] = await db.execute(
          "SELECT dominio, title FROM estabelecimentos WHERE id=? LIMIT 1",
          [lojaId]
        );
        const dominio = dom.length ? dom[0].dominio : lojaId;
        const nomeLoja = dom.length ? dom[0].title : "nossa loja";

        // 1.3 Anti flood 15s
        const cd = `cool_${lojaId}_${numero}`;
        const now = Date.now();
        global.cooldowns ??= {};
        if (global.cooldowns[cd] && now - global.cooldowns[cd] < 15000) return;
        global.cooldowns[cd] = now;

        // 1.4 Nome real do cliente
        let clienteNome = "cliente";
        const [cli] = await db.execute(
          "SELECT nome FROM clientes WHERE telefone=? LIMIT 1",
          [numero]
        );
        if (cli.length) clienteNome = cli[0].nome;

        // ============================================================
        // 🔥 ATENDENTE (prioridade absoluta)
        // ============================================================
        const gatilhosAtendente = [
          "atendente", "humano", "pessoa", "falar com",
          "atendimento", "ajuda", "suporte"
        ];

        if (gatilhosAtendente.some(p => texto.includes(p))) {
          await client.sendMessage(
            msg.from,
            `👩‍💼 *${clienteNome}*, encaminhei sua mensagem para um atendente!\n` +
            `Aguarde um instante que já vão te responder 😊`
          );
          return;
        }

        // ============================================================
        // 🔥 INTELIGÊNCIA – BUSCA PRODUTO + PREVIEW
        // ============================================================
        if (texto.includes("quanto") || texto.includes("preço") || texto.includes("tem ")) {
          const palavra = texto.replace(/quanto|preço|tem/gi, "").trim();

          if (palavra.length > 2) {
            const [prod] = await db.execute(
              "SELECT id, nome, preco, foto FROM produtos WHERE rel_estabelecimentos_id=? AND nome LIKE ? LIMIT 1",
              [lojaId, `%${palavra}%`]
            );

            if (prod.length) {
              const p = prod[0];
              const preco = Number(p.preco).toFixed(2).replace(".", ",");
              const link = `https://${dominio}.rapidex.app.br/produto/${p.id}`;

              let media = null;
              if (p.foto) {
                const base64 = p.foto.startsWith("http")
                  ? await (await fetch(p.foto)).buffer().toString("base64")
                  : null;

                if (base64) media = new MessageMedia("image/jpeg", base64);
              }

              if (media) {
                await client.sendMessage(msg.from, media, {
                  caption: `🛍️ *${p.nome}*\n💰 *R$ ${preco}*\n\n👉 ${link}`,
                });
              } else {
                await client.sendMessage(
                  msg.from,
                  `🛍️ *${p.nome}*\n💰 Preço: *R$ ${preco}*\n\n👉 ${link}`
                );
              }

              return;
            }
          }
        }

        // ============================================================
        // 🔥 CHATBOT SIMPLES
        // ============================================================
        const respostas = {
          "menu": `📋 Aqui está o cardápio:\n👉 https://${dominio}.rapidex.app.br`,
          "cardapio": `📋 Cardápio:\n👉 https://${dominio}.rapidex.app.br`,
          "horário": "⏰ Funcionamos das 18h às 23h.",
          "pagamento": "💳 Pix • Débito • Crédito • Dinheiro",
        };

        if (respostas[texto]) {
          await client.sendMessage(msg.from, respostas[texto]);
          return;
        }

        // ============================================================
        // 🔥 RECUPERAÇÃO DE PEDIDO ABANDONADO
        // ============================================================
        if (texto.includes(`${dominio}.rapidex.app.br`)) {
          const key = `rec_${lojaId}_${numero}`;
          global.recover ??= {};
          const last = global.recover[key] || 0;
          const time48h = 48 * 60 * 60 * 1000;

          if (now - last > time48h) {
            global.recover[key] = now;
            await client.sendMessage(
              msg.from,
              `⚠️ Percebi que você abriu o cardápio mas não concluiu.\n` +
              `Se precisar de ajuda, estou aqui 😊`
            );
          }
        }

        // ============================================================
        // 🔥 BOAS-VINDAS — 1 VEZ POR DIA
        // ============================================================
        const [cfg] = await db.execute(
          "SELECT mensagem, ativo FROM whatsapp_mensagens WHERE rel_estabelecimentos_id=? AND tipo='boas_vindas' LIMIT 1",
          [lojaId]
        );

        if (cfg.length && cfg[0].ativo == 1) {

          const hoje = new Date().toISOString().slice(0,10);

          const [log] = await db.execute(
            "SELECT id FROM whatsapp_logs WHERE rel_estabelecimentos_id=? AND numero=? AND status='boas_vindas' AND DATE(criado_em)=? LIMIT 1",
            [lojaId, numero, hoje]
          );

          if (!log.length) {

            let msgFinal = cfg[0].mensagem;

            msgFinal = msgFinal.replace(/\{([^}|]+(\|[^}]+)+)\}/g, (m, g) => {
              const op = g.split("|");
              return op[Math.floor(Math.random() * op.length)];
            });

            msgFinal = msgFinal
              .replace(/{cliente_nome}/g, clienteNome)
              .replace(/{nome_loja}/g, nomeLoja)
              .replace(/{link_catalogo}/g, `https://${dominio}.rapidex.app.br`);

            await client.sendMessage(msg.from, msgFinal);

            await db.execute(
              "INSERT INTO whatsapp_logs (rel_estabelecimentos_id, numero, mensagem, status, criado_em) VALUES (?, ?, ?, 'boas_vindas', NOW())",
              [lojaId, numero, msgFinal]
            );
          }
        }

      } catch (e) {
        console.log("Erro:", e.message);
      }
    });

    client.initialize();
  }

  // API:
  app.get("/qr", (req, res) => {
    const { eid } = req.query;
    const file = `${SESSION_DIR}/${eid}_qr.txt`;
    if (fs.existsSync(file))
      return res.json({ qr: fs.readFileSync(file, "utf8") });

    getClient(eid);
    res.json({ qr: null });
  });

  app.post("/send", async (req, res) => {
    const { eid, to, message } = req.body;
    const client = getClient(eid);
    try {
      await client.sendMessage(`${to}@c.us`, message);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(8000, () => console.log("🚀 WhatsApp server online"));

})();
