# Arena FPS Online

Jogo de tiro em primeira pessoa multiplayer (até 10 jogadores) que roda direto no navegador.
Feito com **Vite + TypeScript + Three.js**, multiplayer **P2P via WebRTC (PeerJS)** e sem nenhum asset externo:
geometria feita em código, texturas geradas em canvas e sons sintetizados com a Web Audio API.

Funciona como site estático (Vercel, Netlify, GitHub Pages…): não existe servidor de jogo.
Quem cria a sala vira o **host** e roda a simulação oficial no próprio navegador.

---

## Como jogar

1. Abra o site, digite seu **nickname** e clique em **Criar Sala**.
2. Clique em **Copiar link** no lobby e mande para seus amigos (ou passe o código de 6 letras).
3. Os amigos escolhem a sala em **Salas abertas** no menu, abrem o link (`?sala=CODIGO`) ou digitam o código e clicam em **Entrar na Sala**.
4. O host escolhe o modo, limite de kills, tempo e fogo amigo e clica em **Iniciar partida**.
5. Clique na tela para capturar o mouse. `Esc` abre o menu de pausa (o jogo continua rodando).

**Treino Offline** abre o mapa sozinho com alvos (parado, móvel, agachado e na plataforma) para testar armas e configurações.

### Controles padrão (todos podem ser alterados em Configurações → Controles)

| Ação | Tecla |
| --- | --- |
| Mover | W A S D |
| Pular | Espaço |
| Correr | Shift (um toque basta: continua correndo até soltar o W) |
| Agachar | C ou Ctrl (segurar ou alternar) |
| Atirar | Botão esquerdo |
| Mirar / luneta | Botão direito (segurar ou alternar) |
| Recarregar | R |
| Inspecionar arma | Y (atirar, mirar, recarregar, trocar de arma ou correr cancela) |
| Trocar arma | 1 e 2 primárias, 3 pistola, 4 faca, ou roda do mouse |
| Inventário | B (nas partidas com todas as armas) |
| Placar | Tab (segurar) |
| Chat (todos) / chat do time | Enter / U |
| Pausa | Esc |

> No Chrome e no Edge o jogo abre em tela cheia para que **Ctrl+W não feche a aba** (dá para agachar com Ctrl e andar normalmente). Nos outros navegadores isso não é possível: aparece um aviso antes de sair, e o `C` é mais seguro para agachar.

### Armas

No começo da partida, na tela de spawn, você tem **10 segundos** para escolher **2 armas primárias e 1 pistola**. Se o tempo acabar, o que faltar vira o padrão (Rifle de Assalto + SMG + Pistola). A faca vai sempre junto. Durante a partida, `B` abre o inventário: clique no slot e depois na arma que vai nele. A troca vale na hora e a partida não pausa. Todos os atributos ficam em `src/game/weapons.ts`.

| Primária | Pente | Características |
| --- | --- | --- |
| SMG | 30 | cadência alta, dano baixo, recuo leve |
| Rifle de Assalto | 30 | equilibrado, recuo médio |
| LMG | 100 | dano alto, recuo muito difícil, recarga lenta, anda mais devagar |
| Escopeta | 8 | dano altíssimo de perto, fraca de longe |
| Sniper | 5 | mata com 1 tiro na cabeça, luneta, tiro lento |
| Besta | 1 | seta com queda, silenciosa, dano alto, recarga lenta |
| DMR | 15 | tiro a tiro, luneta, boa em média distância |
| Lança-granadas | 6 | dano em área, projétil em arco |

| Pistola | Pente | Características |
| --- | --- | --- |
| Pistola | 12 | rápida, dano baixo |
| Desert Eagle | 7 | dano muito alto, recuo forte, tiro lento |
| Revólver | 6 | dano alto, preciso, recarga lenta |
| Pistola Automática | 20 | dispara em rajada, recuo médio |

**Faca:** alcance curto, e com ela o boneco corre muito mais rápido (até 17,5 m/s) e para na hora.

**Pular enquanto corre** (toque no Shift, depois W + Espaço) dá um impulso de velocidade (+25%) e mais controle no ar, com qualquer arma. O boneco continua correndo durante o pulo, e segurar o Espaço emenda um pulo no outro.

**Dano na tela:** o dano que você causa aparece sobre o alvo: branco é normal, amarelo é headshot e vermelho é abate. Dá para desligar em Configurações → HUD.

**Abate:** a arma em mãos recarrega por completo e a vida volta a 100%.

**Itens no chão** (reaparecem em 20 s): o kit médico enche a vida, e a munição recarrega por completo a arma em mãos.

Headshot causa dano dobrado em todas as armas, exceto a explosão do lança-granadas. O lança-granadas não fere quem atirou.

**Precisão:** parado e no chão, o primeiro tiro sai exatamente no centro da mira. Depois de 350 ms sem atirar, o tiro volta a contar como primeiro. Movimento, pulo e tiro contínuo abrem o spread. Sniper e DMR só têm esse primeiro tiro exato com a luneta aberta; sem mirar, dispersam sempre. Na escopeta, um pellet sai no centro e os outros abrem o cone em volta. Besta e lança-granadas saem no centro, mas o projétil cai com a distância. Agachado, o recuo cai 30%.

### Mapas

O host escolhe o mapa no lobby:

- **Arena:** equilibrado, com corredores e combate em média distância.
- **Mirante:** grande (160 m). Dois fortes frente a frente, uma mesa elevada no centro e torres de sniper nos flancos. Feito para troca de tiro a distância.
- **Galpão:** pequeno (48 m). Corredores apertados entre contêineres, passarela em volta e uma ponte no meio. Combate frenético o tempo todo.

### Modos

- **Mata-mata (FFA):** todos contra todos. Vence quem atingir o limite de kills ou tiver mais kills no fim do tempo.
- **Mata-mata em equipe (TDM):** Vermelho × Azul, escolha de time no lobby, auto-balanceamento e fogo amigo configurável. Dá para trocar de time durante a partida pelo menu de pausa (`Esc`), uma vez a cada 10 s.

O host também escolhe as **Armas** da partida:

- **Todas as armas:** cada jogador escolhe as armas na tela de spawn. Em Configurações → Armas dá para mudar a ordem da roda: a primeira é a arma inicial, e a roda do mouse e o HUD seguem essa ordem.
- **Só sniper / Só doze:** só essa arma e a faca, em FFA ou TDM.
- **Gun Game:** sempre FFA. Cada kill com a arma do seu nível troca para a próxima, passando por todas. Todo mundo também tem a faca para se mover: matar com ela não sobe de nível, mas faz a vítima voltar uma arma. No último nível só resta a faca, e quem mata com ela vence.

Em **Todas as armas** e **Gun Game**, o host também pode escolher **Sem granadas (só armas)**: o Lança-granadas sai da escolha de armas, do inventário e dos níveis do Gun Game.

Quem abrir o link no meio da partida entra direto no jogo. Durante a tela de resultados, espera no lobby.

No fim da partida aparece o placar com MVP; o host pode pedir **Revanche** ou **Voltar ao lobby**.

---

## Rodando localmente

Requer Node.js 20.19+ (ou 22.12+).

```bash
npm install
npm run dev        # http://localhost:5173 (também acessível na rede local)
```

Para testar o multiplayer na mesma máquina, abra duas abas (ou uma aba anônima): crie a sala numa e entre pelo código na outra.

```bash
npm run build      # checagem de tipos + build de produção em dist/
npm run preview    # serve o build de dist/
```

---

## Deploy na Vercel

O projeto já vem com `vercel.json` (build `npm run build`, saída `dist/`, rewrite de SPA para `index.html`).

**Pelo painel:**
1. Suba o projeto para um repositório no GitHub/GitLab/Bitbucket.
2. Em [vercel.com/new](https://vercel.com/new), importe o repositório.
3. A Vercel detecta Vite automaticamente; não precisa mudar nada. Clique em **Deploy**.

**Pela CLI:**
```bash
npm i -g vercel
vercel          # primeiro deploy (preview)
vercel --prod   # produção
```

Não há variáveis de ambiente nem backend: o site é 100% estático.

---

## Rede: como funciona

- **Sinalização:** o PeerJS usa o servidor público gratuito `0.peerjs.com` só para os navegadores se encontrarem.
  O ID do host no PeerJS é `arenafps-v1-` + código da sala (o prefixo evita colisão com outros apps no servidor público).
  Depois disso, os dados do jogo vão direto entre os navegadores (WebRTC DataChannel).
- **Host autoritativo:** o host decide vida, dano, kills, placar, respawn, pickups e timer. Ele fica com uma conexão
  em memória (loopback) para o próprio jogador, então joga com latência zero.
- **Taxas:** clientes enviam posição/inputs a 30 Hz; o host envia snapshots a 20 Hz.
- **Suavidade:** cada jogador prediz o próprio movimento localmente; os outros são interpolados com buffer de ~100 ms.
- **Tiros hitscan com lag compensation:** o cliente envia origem, direção(ões) e o instante (no relógio do host) que
  estava vendo; o host rebobina as posições (histórico de 1 s, limitado pelo RTT do atirador) e faz o raycast contra
  as hitboxes de cabeça e corpo.
- **Anti-trapaça básico:** orçamento de velocidade de movimento, posição dentro de paredes, cadência de tiro
  (token bucket), munição, recarga e distância da origem do tiro. Movimentos inválidos são corrigidos pelo host.
- **Desconexões:** quem sai é removido e todos recebem aviso. Se o host sair, os clientes voltam ao menu com
  "Host saiu da partida". O host continua simulando mesmo com a aba em segundo plano (timer em Web Worker).

### Alguém não consegue entrar na sala (ex.: notebook no Wi-Fi)? Configure um servidor TURN

Só com STUN (padrão) a conexão direta funciona na maioria das redes de casa, mas **falha em Wi-Fi de escola/empresa,
redes com isolamento de clientes, NAT simétrico e 4G**. É o caso típico de "no PC (cabo) entra, no notebook (Wi-Fi) não".
Nesses casos o jogador vê a mensagem *"esta rede bloqueia conexões P2P"*. A solução é um servidor **TURN**, que
retransmite o tráfego quando a conexão direta é impossível. O TURN gratuito sem cadastro que existia (Open Relay)
foi desativado, então é preciso uma conta (grátis).

**Opção A: Metered (grátis até 20 GB/mês, suficiente para partidas entre amigos)**

1. Crie uma conta em [metered.ca](https://www.metered.ca/stun-turn) e crie um app de TURN.
2. No painel, copie o **domínio** do app (ex.: `seuapp.metered.live`) e a **API key** das credenciais TURN.
3. Na Vercel: *Project → Settings → Environment Variables*, adicione:
   - `VITE_METERED_DOMAIN` = `seuapp.metered.live`
   - `VITE_METERED_API_KEY` = sua chave
4. Faça um novo deploy (*Deployments → ⋯ → Redeploy*). As variáveis `VITE_*` entram no build, então
   **sem redeploy nada muda**.

O jogo busca as credenciais TURN ao criar/entrar numa sala. A chave fica visível no navegador; é assim que o
Metered foi pensado para uso no front-end. Se quiser, restrinja o domínio permitido no painel deles.

**Opção B: qualquer TURN com usuário e senha fixos** (ex.: seu próprio `coturn`)

- `VITE_TURN_URLS` = `turn:seu-turn.com:3478,turns:seu-turn.com:443?transport=tcp`
- `VITE_TURN_USERNAME` e `VITE_TURN_CREDENTIAL`

Para rodar localmente com TURN, copie `.env.example` para `.env` e preencha. Também dá para colocar servidores
direto no código em `EXTRA_ICE_SERVERS` (`src/net/iceConfig.ts`), onde também é possível apontar `PEER_SERVER`
para um servidor PeerJS próprio.

**Importante:** host e convidados precisam estar usando o site já com o TURN (todos recarregam a página após o redeploy).

### Ping alto ou jogo travando para alguém

- **Ping alto com conexão via TURN é normal**: o tráfego passa por um servidor intermediário (o jogo avisa
  "Conectado via servidor TURN"). O jogo tolera atrasos e rajadas sem "puxar o jogador de volta",
  aumenta o buffer de interpolação automaticamente (até 350 ms) e descarta snapshots velhos em vez de acumular atraso.
  Para menos ping, prefira uma rede que permita conexão direta (cabo / roteador de casa) ou um TURN mais próximo.
- **Tudo travando (FPS baixo)**: ative *Mostrar FPS* em Configurações → HUD. Se aparecer o aviso de
  "sem aceleração de vídeo", ative *Usar aceleração gráfica quando disponível* nas configurações do navegador.
  Em PC fraco, use qualidade Baixa, desligue sombras e reduza a escala de resolução.

Para depurar a conexão, rode no console do navegador `localStorage.setItem('arenafps.peerdebug', '1')` e recarregue:
o PeerJS passa a registrar tudo no console.

---

## Configurações

Ficam salvas no `localStorage` e são aplicadas na hora:

- **Controles:** sensibilidade (0,1–10, slider + campo numérico), sensibilidade de mira (escalada pelo zoom),
  inverter Y, remapear todas as teclas (2 por ação, inclusive botões do mouse), segurar/alternar para mirar e agachar.
- **Vídeo:** FOV (70–110), qualidade baixa/média/alta (sombras, pixel ratio, antialias), sombras liga/desliga,
  limite de FPS e escala de resolução.
- **Áudio:** volume geral, efeitos e interface.
- **Mira:** cruz, ponto ou círculo; cor, tamanho, espessura, gap, contorno e ponto central, com pré-visualização.
- **HUD:** mostrar FPS, mostrar ping e tamanho do killfeed.
- Botão **Restaurar padrão**.

---

## Estrutura do código

```
src/
  main.ts            orquestra telas, conexão e o loop
  style.css
  core/              loop (60 Hz fixo + render interpolado), input, settings, audio, utilidades
  render/            cena/renderer, mapa, texturas procedurais, modelos, arma em 1ª pessoa, efeitos
  game/              constantes, dados do mapa, física (AABB + rampas), armas, hitboxes, jogador remoto, partida (cliente)
  net/               protocol.ts (mensagens tipadas), peer (PeerJS + loopback), host (simulação autoritativa), client, iceConfig
  ui/                menu, lobby, HUD, placar, chat, configurações, pausa, resultados, toasts
```

Todo texto vindo de jogadores (nicks com até 16 caracteres e chat com até 120) é sanitizado e exibido via
`textContent`, nunca `innerHTML`.
