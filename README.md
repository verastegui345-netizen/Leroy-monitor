# 📡 Monitor Leroy Merlin — Instalações e Reformas

Monitor automático de reclamações sobre serviços de instalação e reformas da Leroy Merlin Brasil. 
Coleta dados do **Reclame Aqui** e **Google Reviews**, classifica por gravidade usando IA, e envia alertas por WhatsApp.

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────┐
│                SERVIDOR (Node.js)            │
│                                              │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐ │
│  │ Scraper  │  │ Classifier │  │ Notifier │ │
│  │ RA + GR  │→ │  (Claude)  │→ │ WhatsApp │ │
│  └──────────┘  └────────────┘  └──────────┘ │
│       ↑              ↓                       │
│  ┌──────────┐  ┌────────────┐               │
│  │ Scheduler│  │  SQLite DB │               │
│  │ (cron)   │  │ (sql.js)   │               │
│  └──────────┘  └────────────┘               │
│       ↓                                      │
│  ┌──────────────────────────────────────┐   │
│  │  Express → PWA Frontend (HTML/JS)    │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## 🚀 Deploy em 5 minutos (Railway)

### 1. Criar conta Railway
- Acesse [railway.app](https://railway.app) e faça login com GitHub

### 2. Deploy
```bash
# Opção A: Via GitHub
# Suba este repositório para seu GitHub, depois no Railway:
# New Project → Deploy from GitHub → selecione o repo

# Opção B: Via CLI
npm install -g @railway/cli
railway login
railway init
railway up
```

### 3. Configurar variáveis de ambiente no Railway
No dashboard do Railway, vá em **Variables** e adicione:

| Variável | Obrigatória | Onde obter |
|----------|-------------|------------|
| `CLAUDE_API_KEY` | ✅ Sim | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `GOOGLE_PLACES_API_KEY` | ✅ Sim | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
| `TWILIO_ACCOUNT_SID` | Para WhatsApp | [twilio.com/console](https://www.twilio.com/console) |
| `TWILIO_AUTH_TOKEN` | Para WhatsApp | Twilio Console |
| `TWILIO_WHATSAPP_FROM` | Para WhatsApp | `whatsapp:+14155238886` (sandbox) |
| `WHATSAPP_DESTINATION` | Para WhatsApp | `whatsapp:+55XXXXXXXXXXX` |

### 4. Acessar
Railway fornece uma URL pública tipo `https://seu-app.up.railway.app`.
Abra no celular e adicione à tela inicial (PWA).

---

## 💻 Executar localmente

```bash
# 1. Clonar e instalar
git clone <repo>
cd leroy-monitor
npm install

# 2. Configurar
cp .env.example .env
# Editar .env com suas API keys

# 3. Executar
npm start
# → Acessar http://localhost:3000
```

---

## 📱 Funcionalidades

- **Barrido automático** a cada 4h (08:00-00:00 BRT)
- **Classificação IA** (Claude Haiku 4.5): LEVE 🟡 / GRAVE 🟠 / CRÍTICO 🔴
- **Alertas WhatsApp** automáticos via Twilio
- **Relatório PDF** exportável sob demanda
- **Dashboard PWA** — instala como app no celular
- **SSE real-time** — atualizações sem refresh
- **Filtros** por gravidade, fonte e período
- **Classificação heurística** como fallback (sem API key)

---

## ⚠️ Limitações conhecidas

| Limitação | Motivo | Mitigação |
|-----------|--------|-----------|
| Reclame Aqui pode bloquear scraping | Cloudflare/anti-bot | Múltiplas estratégias de fallback, headers de browser |
| Google Reviews máx. 5 reviews/local | Limitação da API | Busca em 40+ lojas para maximizar cobertura |
| Twilio Sandbox limitado | Conta trial | Upgrade para production ($) |
| Keywords fixas | Podem não cobrir tudo | Editáveis em `modules/keywords.js` |

---

## 📁 Estrutura

```
leroy-monitor/
├── server.js              # Servidor Express + API REST
├── package.json
├── .env.example           # Template de variáveis
├── Dockerfile             # Deploy containerizado
├── railway.json           # Config Railway
├── modules/
│   ├── database.js        # SQLite (sql.js WASM)
│   ├── scraper-reclameaqui.js  # Scraper Reclame Aqui
│   ├── scraper-google.js  # Google Reviews API
│   ├── classifier.js      # Classificação IA (Claude)
│   ├── notifier.js        # WhatsApp via Twilio
│   ├── scanner.js         # Orquestrador de barrido
│   ├── scheduler.js       # Cron jobs
│   ├── pdf-report.js      # Gerador de relatórios
│   ├── keywords.js        # Palavras-chave de filtro
│   └── logger.js          # Logging (Winston)
├── public/
│   ├── index.html         # PWA Frontend (SPA)
│   └── manifest.json      # PWA Manifest
└── data/
    └── monitor.db         # SQLite database (auto-criado)
```

---

## 🔧 Custos estimados

| Serviço | Custo |
|---------|-------|
| Railway | Grátis (hobby) ou ~$5/mês |
| Claude API (Haiku) | ~$0.01-0.05/dia (~20-50 classificações) |
| Google Places API | Grátis até $200/mês de crédito |
| Twilio WhatsApp | ~$0.005/msg + $15/mês (número) |
| **Total estimado** | **$5-25/mês** |
