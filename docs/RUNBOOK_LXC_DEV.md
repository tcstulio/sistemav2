# Runbook — LXC de DEV do sistemav2 (coolgroove) no Proxmox do N97

> **Para quem executa:** agente local com acesso SSH ao Proxmox (N97, `192.168.191.207`).
> **Autor:** sessão Claude Code remota (sem acesso à LAN) — tudo aqui foi derivado do código do
> repo `sistemav2`, não de suposição. Onde eu **não** pude verificar, está marcado `[NÃO VERIFICADO]`.
> **Ambiente-alvo:** DEV. Não expor no túnel, não apontar para dado de produção.

---

## 0. O que você está subindo (leia antes)

O `sistemav2` (nome interno **coolgroove**) não é um app único. São 4 peças:

| Peça | O que é | Porta |
|---|---|---|
| **Frontend** | Vite + React/TS | 3000 (dev) |
| **Backend** | Express/TS, compila para `dist/server.js` | **3004** |
| **Dolibarr (fork)** | MariaDB + Dolibarr v21 buildado do **fork de vocês** | 8088 |
| **WAHA** | ponte WhatsApp (`devlikeapro/waha`) | 3001 |

**Dois bancos diferentes, não confunda:**
- **MariaDB** → do Dolibarr (vem no `docker-compose.e2e.yml`)
- **PostgreSQL** → do backend do sistemav2 (`pg` + `DATABASE_URL`), tabelas de runtime do agente

**Pesos escondidos** (é o que estoura LXC subdimensionado):
- O backend usa **Playwright/Chromium em runtime**, não só em teste — `guideService.ts`,
  `shotgunScraper.ts`, `screenVerifyService.ts` importam `chromium`.
- O **WAHA com engine WEBJS sobe outro Chromium** por dentro.
- **ffmpeg** (`@ffmpeg-installer/ffmpeg` + `ffmpeg-static`).

Ou seja: potencialmente **dois Chromium** + PHP + MariaDB + Postgres + Node no mesmo container.

---

## 1. Pré-flight — MEÇA antes de criar (go/no-go)

O N97 tem histórico de pressão de memória (issue #2240 do tulipa-v4, ainda aberta) e o LXC 102
já consome parte. **Não crie nada antes de rodar isto e olhar o resultado:**

```bash
# no host Proxmox
free -h                       # RAM livre real
pvesm status                  # espaço por storage
pct list                      # o que já roda
df -h /                       # disco do host
nproc                         # vCPUs
```

**Critério de go:** precisa sobrar **≥ 4 GB de RAM livre** e **≥ 35 GB** no storage escolhido.

Se não sobrar, **pare e reporte** em vez de criar um container que vai fazer o host swappar —
o LXC 102 (Tulipa, produção) mora na mesma máquina.

---

## 2. Criar o LXC

```bash
# template Debian 12 (baixe se não tiver)
pveam update
pveam available | grep debian-12
pveam download local debian-12-standard_12.7-1_amd64.tar.zst

# ajuste VMID (110) e storage (local-lvm) conforme o seu 'pct list' / 'pvesm status'
pct create 110 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname sistemav2-dev \
  --cores 2 \
  --memory 4096 \
  --swap 2048 \
  --rootfs local-lvm:32 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --features nesting=1,keyctl=1 \
  --unprivileged 1 \
  --onboot 0 \
  --start 1
```

### ⚠️ O detalhe que mais derruba esse setup

**`--features nesting=1,keyctl=1` não é opcional.** Sem isso o Docker não roda dentro de LXC
unprivileged, e o Dolibarr + WAHA vêm por Docker. Se você já criou sem, conserte com:

```bash
pct set 110 --features nesting=1,keyctl=1
pct reboot 110
```

`--onboot 0` é de propósito: é dev, não deve competir com a Tulipa no boot do host.

Pegue o IP: `pct exec 110 -- ip -4 addr show eth0 | grep inet`

---

## 3. Pacotes de sistema

```bash
pct exec 110 -- bash -lc '
set -e
apt-get update
apt-get install -y curl ca-certificates gnupg git build-essential \
  postgresql postgresql-contrib ffmpeg

# Node 20+ (Debian 12 traz o 18 — o README exige 20+)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v && npm -v
'
```

### Docker dentro do LXC

```bash
pct exec 110 -- bash -lc '
set -e
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
docker run --rm hello-world
'
```

Se o `hello-world` falhar → quase certamente é o `nesting`/`keyctl` da seção 2.

### Libs do Chromium (Playwright)

```bash
pct exec 110 -- bash -lc '
npx --yes playwright install-deps chromium
'
```

Se `install-deps` falhar no Debian 12, o equivalente manual:

```bash
pct exec 110 -- apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 libasound2
```

---

## 4. Levar o código (sem GitHub)

Você precisa dos **dois** repos, **lado a lado** — o `Dockerfile.e2e` builda o Dolibarr usando
`context: ../dolibarr`, então a estrutura de diretórios importa:

```
/opt/coolgroove/
├── dolibarr/     (fork v21.0.1 — ~392 MB)
└── sistemav2/    (~22 MB)
```

**Se o agente local tiver os repos na máquina dele** (caminho mais provável):

```bash
# da máquina local, para o host Proxmox
rsync -az --exclude node_modules --exclude .git \
  /caminho/local/dolibarr/  root@192.168.191.207:/tmp/dolibarr/
rsync -az --exclude node_modules \
  /caminho/local/sistemav2/ root@192.168.191.207:/tmp/sistemav2/

# do host para dentro do LXC
pct exec 110 -- mkdir -p /opt/coolgroove
tar -C /tmp -cf - dolibarr  | pct exec 110 -- tar -C /opt/coolgroove -xf -
tar -C /tmp -cf - sistemav2 | pct exec 110 -- tar -C /opt/coolgroove -xf -
```

> **Nota sobre `.git` do dolibarr:** o `Dockerfile.e2e` avisa que o build envia o fork inteiro como
> contexto, incluindo `.git` → 1º build lento. Excluir `.git` no rsync (como acima) resolve. Se
> precisar do histórico depois, clone à parte.

**Se tiver GitHub no LXC**, é só `git clone` dos dois em `/opt/coolgroove/`.

---

## 5. PostgreSQL (banco do backend)

```bash
pct exec 110 -- bash -lc '
systemctl enable --now postgresql
su - postgres -c "psql -c \"CREATE USER coolgroove WITH PASSWORD '"'"'trocar-esta-senha'"'"';\""
su - postgres -c "psql -c \"CREATE DATABASE coolgroove OWNER coolgroove;\""
'
```

### ⚠️ Não existe runner de migrations — verificado

O diretório `backend/src/db/migrations/` tem os arquivos (`up`/`down` exportados), mas
**nenhum código de produção os executa** — só os testes referenciam. O `pool.ts` também não roda
migration no boot.

Então crie a tabela à mão (conteúdo derivado de `20250115_create_chat_messages.ts`):

```bash
pct exec 110 -- su - postgres -c "psql -d coolgroove -c \"
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  sessao_id VARCHAR(64) NOT NULL
);\""
```

> `[NÃO VERIFICADO]` — reproduzi só as primeiras colunas que consegui ler. **Antes de rodar, abra
> `backend/src/db/migrations/20250115_create_chat_messages.ts` no LXC e copie o `CREATE TABLE`
> completo de lá.** Não invente colunas.

**Nota:** o Postgres é opcional para subir. Sem `DATABASE_URL`/`PGHOST`, o `pool.ts` cai num fallback
`127.0.0.1:5432/postgres` e **loga warn** — não quebra o boot, mas o histórico de chat não persiste.

---

## 6. Dolibarr local (fork) + MariaDB

A receita **já existe no repo** — não improvise. Use `docker-compose.e2e.yml`:

```bash
pct exec 110 -- bash -lc '
cd /opt/coolgroove/sistemav2
docker compose -f docker-compose.e2e.yml up -d --build
docker compose -f docker-compose.e2e.yml logs -f e2e-dolibarr
'
```

Dolibarr sobe em `http://<ip-do-lxc>:8088` — login `admin` / senha `e2eadmin`.

### Shakeout de 1ª execução (o próprio repo avisa que nunca rodou)

O `Dockerfile.e2e` tem um bloco `⚠️ SHAKEOUT` com 3 itens em aberto. Espere iterar:

1. Confirmar o path do htdocs da imagem oficial (assumido `/var/www/html`) — ajustar o `COPY` se preciso
2. Os módulos **custom** (carnaval, vistoria, ocultarcampos…) podem não ativar sozinhos.
   `DOLI_ENABLE_MODULES` cobre só os padrão; os custom podem exigir ativação via admin no 1º boot
   ou seed em `llx_const` (`MAIN_MODULE_*`)
3. Build lento na 1ª vez

**Reporte o que acontecer** — esses 3 itens nunca foram validados por ninguém; o que você observar
vira correção no repo.

Depois de subir: no Dolibarr, **Usuários → admin → gerar API key**. Guarde, vai no `.env`.

---

## 7. WAHA (WhatsApp) — opcional em dev

```bash
pct exec 110 -- bash -lc 'cd /opt/coolgroove/sistemav2 && docker compose up -d waha'
```

Sobe em `:3001`. **Pule este passo se não for testar WhatsApp agora** — é o componente mais pesado
(sobe um Chromium próprio).

---

## 8. `.env` do backend

```bash
pct exec 110 -- bash -lc 'cd /opt/coolgroove/sistemav2/backend && cp .env.example .env'
```

Edite `/opt/coolgroove/sistemav2/backend/.env`. **Valores seguros para DEV:**

```ini
PORT=3004
NODE_ENV=development

# Dolibarr LOCAL — NUNCA aponte para sistema.coolgroove.com.br neste LXC
DOLIBARR_URL=http://localhost:8088/api/index.php
DOLIBARR_API_KEY=<a key gerada no passo 6>

WAHA_URL=http://localhost:3001

DATABASE_URL=postgresql://coolgroove:trocar-esta-senha@127.0.0.1:5432/coolgroove

# gere de verdade: openssl rand -hex 32
ADMIN_KEY=<32+ chars>
ENCRYPTION_KEY=<32+ chars>

# TRAVAS DE SEGURANÇA DE DEV — deixe assim
DRY_RUN_MODE=true
FINANCIAL_COMMANDS_ENABLED=false
AUTO_REPLY_ENABLED=false
CLOUDFLARE_TUNNEL_ENABLED=false

# LLM: deixe desligado até decidir. Cada key aqui gasta dinheiro real.
LLM_PROVIDER=local
```

E o frontend, em `/opt/coolgroove/sistemav2/.env`:

```ini
VITE_API_URL=http://<ip-do-lxc>:3004
VITE_DOLIBARR_URL=http://<ip-do-lxc>:8088
VITE_ENABLE_DEV_CONSOLE=true
```

> **Por que `DRY_RUN_MODE=true` importa:** o backend tem comandos financeiros e integração bancária
> (Inter). Em dev, com uma API key válida do Dolibarr, um comando disparado sem querer escreve
> de verdade. A trava é barata; o estrago não é.

---

## 9. Instalar, buildar, subir

```bash
pct exec 110 -- bash -lc '
set -e
cd /opt/coolgroove/sistemav2
npm install
cd backend && npm install && cd ..
'
```

> O `postinstall` do backend roda `scripts/apply-wwebjs-patch.js`. Se falhar, **reporte a saída** —
> é patch de dependência, não dá para ignorar em silêncio.

Smoke em foreground (antes de virar serviço):

```bash
pct exec 110 -- bash -lc 'cd /opt/coolgroove/sistemav2 && npm run dev:all'
```

Frontend em `:3000`, backend em `:3004`. **Se subiu, mate e siga para o systemd.**

### systemd (backend)

```bash
pct exec 110 -- bash -lc 'cat > /etc/systemd/system/coolgroove-backend.service <<EOF
[Unit]
Description=coolgroove backend (dev)
After=network.target postgresql.service docker.service

[Service]
Type=simple
WorkingDirectory=/opt/coolgroove/sistemav2/backend
EnvironmentFile=/opt/coolgroove/sistemav2/backend/.env
ExecStart=/usr/bin/npm run dev
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now coolgroove-backend
systemctl status coolgroove-backend --no-pager'
```

Em dev deixei `npm run dev` (nodemon, recarrega ao editar). Para modo compilado:
`cd backend && npm run build` e troque o `ExecStart` para `/usr/bin/node dist/server.js`.

---

## 10. Verificação final

```bash
IP=$(pct exec 110 -- hostname -I | awk '{print $1}')
curl -s -o /dev/null -w "backend  :3004 -> %{http_code}\n" http://$IP:3004/api/health
curl -s -o /dev/null -w "dolibarr :8088 -> %{http_code}\n" http://$IP:8088/
curl -s -o /dev/null -w "waha     :3001 -> %{http_code}\n" http://$IP:3001/
pct exec 110 -- free -h
pct exec 110 -- df -h /
```

> `[NÃO VERIFICADO]` — não confirmei que a rota é exatamente `/api/health`. Se der 404, procure
> com: `pct exec 110 -- grep -rn "health" /opt/coolgroove/sistemav2/backend/src/routes/ | head`

**Checklist de saída:**

- [ ] `free -h` mostra folga (não está em swap)
- [ ] Backend responde em `:3004`
- [ ] Dolibarr abre em `:8088` e loga com `admin`/`e2eadmin`
- [ ] `DRY_RUN_MODE=true` confirmado no `.env`
- [ ] `DOLIBARR_URL` aponta para **localhost:8088**, não para produção
- [ ] Nada exposto no túnel Cloudflare
- [ ] `--onboot 0` (não sobe junto com o host)

---

## 11. Rollback

```bash
pct stop 110 && pct destroy 110       # apaga o LXC inteiro
# só os containers, preservando o LXC:
pct exec 110 -- bash -lc 'cd /opt/coolgroove/sistemav2 && docker compose -f docker-compose.e2e.yml down -v'
```

---

## 12. O que reportar de volta

Para eu corrigir este runbook e o repo:

1. Saída do **pré-flight** (§1) — quero saber a folga real do N97
2. Se `docker run hello-world` funcionou de primeira
3. **Os 3 itens do shakeout** (§6) — nunca foram validados; o que você observar vira issue
4. O `CREATE TABLE` real de `chat_messages` (§5)
5. Se `/api/health` existe (§10)
6. Qualquer falha do `postinstall` (§9)

---

## Anexo — riscos que eu deixaria registrados

**Memória.** Dois Chromium (Playwright + WAHA) + PHP + MariaDB + Postgres + Node num host que já
tem pressão de memória documentada. Se ficar apertado: não suba o WAHA (§7) e desligue os serviços
de scraping. Medir em §1 é o que evita descobrir isso derrubando a Tulipa.

**Sem runner de migrations.** Gap real do repo, não do runbook. Vale abrir issue no `sistemav2`.

**O sandbox E2E nunca rodou.** O aviso de shakeout está no código desde que foi escrito. Este é
provavelmente o primeiro uso real — trate divergência como esperada, não como erro seu.

**Dolibarr de produção.** A única razão de eu insistir em `localhost:8088` é que o alvo natural
(`sistema.coolgroove.com.br`) é a produção de vocês, e o backend tem comandos que escrevem.
