# Rapidex WhatsApp Server
Servidor Node.js integrado ao SaaS Rapidex, utilizando WhatsApp-Web.js para automações.

## Endpoints
- `/qr?eid=1` → Retorna QR Code para conectar WhatsApp
- `/status?eid=1` → Mostra status da conexão
- `/send` → Envia mensagem (POST com `eid`, `phone`, `msg`)

## Deploy
Suba no Render, Railway ou Cyclic.  
Exemplo: