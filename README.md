# Arena FPS Online

Jogo de tiro em primeira pessoa multiplayer (até 10 jogadores) que roda direto no navegador.
Feito com **Vite + TypeScript + Three.js** e multiplayer **P2P via WebRTC (PeerJS)**. As armas e o soldado são modelos
CC0 de Quaternius, e os cenários usam os kits CC0 de Kenney (créditos em `public/models/LICENCAS.txt`). Texturas e sons continuam gerados em código.

A jogabilidade segue a fórmula de FPS militar arcade: morte rápida, vida que regenera, corrida curta, slide e mantle.

Funciona como site estático (Vercel, Netlify, GitHub Pages…): não existe servidor de jogo.
Quem cria a sala vira o **host** e roda a simulação oficial no próprio navegador.

---

## Como jogar

1. Abra o site, digite seu **nickname** e clique em **Criar Sala**.
2. Clique em **Copiar link** no lobby e mande para seus amigos (ou passe o código de 6 letras).
3. Os amigos escolhem a sala em **Salas abertas** no menu, abrem o link (`?sala=CODIGO`) ou digitam o código e clicam em **Entrar na Sala**.
4. O host escolhe o modo, limite de kills, tempo e fogo amigo e clica em **Iniciar partida**.
5. Clique na tela para capturar o mouse. `Esc` abre o menu de pausa (o jogo continua rodando).

**Treino Offline** abre o mapa escolhido ao lado do botão, sozinho e com alvos, para testar armas, configurações e mapas.

### Controles padrão (todos podem ser alterados em Configurações → Controles)

| Ação | Tecla |
| --- | --- |
| Mover | W A S D |
| Pular / subir em borda | Espaço (com W, sobe em bordas de até 1,45 m) |
| Correr | Shift (um toque basta: continua correndo até soltar o W ou acabar o fôlego) |
| Agachar | C ou Ctrl (segurar ou alternar) |
| Slide | Agachar enquanto corre |
| Golpe rápido | V (saca a faca, golpeia e volta para a arma) |
| Equipamento letal / tático | G / Q (arremessa sem trocar de arma) |
| Fumaça (modo Bomba) | X |
| Plantar / desarmar (modo Bomba) | E (segurar) |
| Atirar | Botão esquerdo |
| Mirar / luneta | Botão direito (segurar ou alternar) |
| Recarregar | R |
| Trocar arma | 1 e 2 primárias, 3 pistola, 4 faca, ou roda do mouse |
| Inventário | B (nas partidas com todas as armas). No modo Bomba, B abre a compra |
| Placar | Tab (segurar) |
| Chat (todos) / chat do time | Enter / Y |
| Pausa | Esc |

> No Chrome e no Edge o jogo abre em tela cheia para que **Ctrl+W não feche a aba** (dá para agachar com Ctrl e andar normalmente). Nos outros navegadores isso não é possível: aparece um aviso antes de sair, e o `C` é mais seguro para agachar.

### Armas

No começo da partida, na tela de spawn, você tem **10 segundos** para escolher **2 armas primárias e 1 pistola**. Se o tempo acabar, o que faltar vira o padrão (Rifle de Assalto + SMG + Pistola). A faca vai sempre junto. Durante a partida, `B` abre o inventário: clique no slot e depois na arma que vai nele. A troca vale na hora e a partida não pausa. Todos os atributos ficam em `src/game/weapons.ts`.

| Primária | Pente | Características |
| --- | --- | --- |
| SMG | 30 | 4 tiros de perto (200 ms), 6 de longe, a mais rápida para mirar |
| Rifle de Assalto | 30 | 4 tiros em qualquer distância (260 ms) |
| LMG | 100 | 3 tiros de perto, 4 de longe, recarga e mira lentas, anda mais devagar |
| Escopeta | 7 | mata com 1 tiro de perto, fraca de longe |
| Sniper | 5 | mata com 1 tiro no corpo, luneta, tiro lento |
| Besta | 1 | seta com queda, silenciosa, dano alto, recarga lenta |
| DMR | 15 | tiro a tiro, luneta, 3 tiros em qualquer distância |
| Lança-granadas | 3 | dano em área, projétil em arco |

| Pistola | Pente | Características |
| --- | --- | --- |
| Pistola | 12 | rápida, 3 tiros de perto, perde dano depois de 12 m |
| Desert Eagle | 7 | 2 tiros de perto, recuo forte, tiro lento |
| Revólver | 6 | 2 tiros de perto, preciso, recarga lenta |
| Pistola Automática | 20 | dispara em rajada, recuo médio |

**Faca:** mata com 1 golpe, em até 2,8 m. O `V` dá o golpe com qualquer arma em mãos.

**Corrida:** dura 4 s e o fôlego volta no dobro da velocidade. Ao parar de correr, a arma leva um instante para atirar e mirar (de 120 ms na pistola a 350 ms na LMG). Armas pesadas deixam o boneco mais lento.

**Slide:** agachar enquanto corre desliza 0,7 s mais rápido que a corrida, com a altura de agachado. Dá para atirar durante o slide, e pular o cancela.

**Levar tiro** tira a mira do lugar (flinch).

**Dano na tela:** o dano que você causa aparece sobre o alvo: branco é normal, amarelo é headshot e vermelho é abate. Dá para desligar em Configurações → HUD.

**Vida:** 100 pontos, que regeneram sozinhos depois de 5 s sem levar dano.

**Itens no chão** (reaparecem em 20 s): a munição recarrega por completo a arma em mãos.

Headshot multiplica o dano por um valor de cada arma (de 1,25× na LMG a 1,5× na sniper), e a partir de certa distância o dano cai. Os números ficam em `src/game/weapons.ts`. O lança-granadas não fere quem atirou.

### Equipamentos

Nas partidas com todas as armas, cada um escolhe um letal e um tático na tela de spawn, e eles voltam a cada vida. A troca pelo inventário vale ao renascer.

| Equipamento | Tipo | Por vida | Efeito |
| --- | --- | --- | --- |
| Granada | Letal | 1 | Quica e explode em 2,2 s. Raio de 7 m, mata a até cerca de 2,9 m |
| Faca de arremesso | Letal | 1 | Mata com 1 acerto direto, sem dano em área |
| Molotov | Letal | 1 | Quebra ao bater e queima 3,5 m de raio por 6 s, a 40 de dano por segundo |
| Flashbang | Tática | 2 | Explode em 1,4 s. Cega e ensurdece em até 16 m, e dura bem menos de costas para ela |
| Concussão | Tática | 2 | Explode em 1,4 s. Em até 10 m, reduz a velocidade e a mira e impede a corrida |

Paredes bloqueiam as explosões. Seu próprio equipamento também pega você, e morrer assim conta só a morte. Companheiros de time só são atingidos com fogo amigo ligado.

### Mapas

O host escolhe o mapa no lobby:

- **Arena:** equilibrado, com corredores e combate em média distância.
- **Mirante:** grande (160 m). Dois fortes frente a frente, uma mesa elevada no centro e torres de sniper nos flancos. Feito para troca de tiro a distância.
- **Galpão:** pequeno (48 m). Corredores apertados entre contêineres, passarela em volta e uma ponte no meio. Combate frenético o tempo todo.
- **Vila:** pequeno (60 m). Rua, quintais e casas em quinas opostas, com casas de atravessar e um deck elevado para cada lado.
- **Centro:** médio (84 m). Avenida com veículos, dois becos em zigue-zague e uma loja de atravessar com acesso ao telhado.
- **Pátio:** médio (68 m). Corredores de contêineres, plataformas laterais e um pórtico central exposto, em três alturas.

Vila, Centro e Pátio são simétricos por rotação de 180°, e `npm run check` mede o equilíbrio deles: área e tempo iguais para os dois times, cobertura perto de qualquer ponto, spawns sem visão um do outro e limite para linhas de visão. Para ver a planta em texto: `node scripts/check-maps.mjs vila`.

### Modos

- **Mata-mata (FFA):** todos contra todos. Vence quem atingir o limite de kills ou tiver mais kills no fim do tempo.
- **Mata-mata em equipe (TDM):** Vermelho × Azul, escolha de time no lobby, auto-balanceamento e fogo amigo configurável. Dá para trocar de time durante a partida pelo menu de pausa (`Esc`), uma vez a cada 10 s.
- **Bomba:** ataque contra defesa em rodadas, com compra de armas. Tem regras próprias, descritas abaixo.

O host também escolhe as **Armas** da partida:

- **Todas as armas:** cada jogador escolhe as armas na tela de spawn. Em Configurações → Armas dá para mudar a ordem da roda: a primeira é a arma inicial, e a roda do mouse e o HUD seguem essa ordem.
- **Só sniper / Só doze:** só essa arma e a faca, em FFA ou TDM.
- **Gun Game:** sempre FFA. Cada kill com a arma do seu nível troca para a próxima, passando por todas. Todo mundo também tem a faca: matar com ela não sobe de nível, mas faz a vítima voltar uma arma. No último nível só resta a faca, e quem mata com ela vence.

Quem abrir o link no meio da partida entra direto no jogo. Durante a tela de resultados, espera no lobby.

No fim da partida aparece o placar com MVP; o host pode pedir **Revanche** ou **Voltar ao lobby**.

### Modo Bomba

Um time ataca, o outro defende, e cada um tem uma vida por rodada. O ataque vence plantando a bomba em um dos bombs (A ou B) e deixando explodir, ou eliminando a defesa. A defesa vence desarmando a bomba, eliminando o ataque antes do plant ou segurando até o tempo acabar. Na metade da partida os times trocam de lado e o dinheiro volta ao início. Vence quem chegar ao número de vitórias escolhido no lobby (7, 9 ou 13). Só existe nos mapas **Usina** e **Mercado**, feitos para ele. No **Treino Offline** com um desses mapas você joga no ataque, contra alvos parados.

| Rodada | |
| --- | --- |
| Congelamento e compra | 15 s parado, e a compra segue por mais 20 s na sua zona |
| Tempo de rodada | 1:55 |
| Plantar | 3,2 s parado dentro do bomb, segurando `E` |
| Bomba | Explode em 40 s, atravessa paredes e mata até cerca de 11 m |
| Desarmar | 10 s segurando `E` ao lado da bomba, ou 5 s com o kit |

Quem carrega a bomba e morre a deixa cair. Outro atacante pega passando por cima, e ela brilha através das paredes só para o ataque.

| Dinheiro | |
| --- | --- |
| Início | $800, máximo de $16.000 |
| Vitória | $3.250, ou $3.500 com bomba explodida ou desarmada |
| Derrota | $1.400, subindo $500 por derrota até $3.400. Uma vitória desce um degrau |
| Plantar ou desarmar | +$300 para quem fez |
| Bomba plantada na derrota | +$800 para cada atacante |
| Tempo esgotado | Atacante vivo não recebe nada |
| Abate | $300, SMG $600, escopeta $900, sniper $100, faca $1.500 |
| Abate de companheiro | -$300 |

| Comprar (`B`) | |
| --- | --- |
| Pistolas | Automática $500, revólver $600, Desert Eagle $700 |
| Primárias | Escopeta $1.100, SMG $1.250, besta $1.700, DMR $2.000, rifle $2.900, sniper $4.750, LMG $5.200 |
| Granadas (até 4) | Flashbang $200 (até 2), fumaça $300, granada $300, molotov $400, concussão $200 |
| Equipamento | Colete $650, capacete $350, kit de desarme $400 (só defesa) |

Quem sobrevive à rodada fica com tudo o que tinha; quem morre volta com a pistola e deixa no chão a primária, ou a pistola se não tinha primária, com a munição que restava. Sem primária, passar por cima de uma já pega. Para trocar, encoste na arma e aperte `E`: a sua fica no lugar dela. Armas no chão somem na rodada seguinte.

O **radar** fica no canto superior esquerdo, com o norte sempre para cima. Mostra seus companheiros, os inimigos que você ou um deles estiver vendo (paredes e fumaça escondem), e a bomba: para o ataque sempre, e para a defesa depois que alguém a vê plantada.

O dinheiro do seu time aparece no placar (`Tab`) e no menu de compra. O do time inimigo fica escondido.

A jogabilidade também muda nesse modo: sem regeneração de vida, sem corrida e sem slide, e só sniper e DMR miram. O tiro é preciso parado e ruim correndo. `Shift` anda devagar e sem barulho de passos. Headshot multiplica por 4 e passa por tudo sem capacete; colete e capacete cortam o dano conforme a arma. A faca leva 2 golpes. `X` joga a fumaça, que corta a visão por 17 s. Quem morre assiste um companheiro, e o clique troca de quem.

### Patentes, moedas e skins

Cada partida online dá **XP** e **moedas**. O XP sobe o nível, e o nível dá a patente. Treino offline não dá nada.

| Recompensa | XP | Moedas |
| --- | --- | --- |
| Partida jogada | 150 | 25 |
| Abate | 50 | 5 |
| Headshot | +25 | +2 |
| Dano | 1 a cada 10 | |
| Vitória (time ou 1º lugar no FFA) | 300 | 40 |
| MVP | 150 | 20 |
| Cada nível ganho | | 100 |

Abates contam até 60 e dano até 8.000 por partida. O nível vai até 55 e cada um pede 150 XP a mais que o anterior (800 do 1 para o 2). Uma partida boa dá uns 1.500 XP, então o nível 10 sai em umas 9 partidas.

| Patente | Recruta | Soldado | Cabo | Sargento | Subtenente | Tenente | Capitão | Major | Coronel | General |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nível | 1 | 3 | 6 | 10 | 15 | 20 | 26 | 33 | 40 | 50 |

No menu, **Arsenal e skins** mostra a patente, o XP e a loja. A skin vale para todas as suas armas e os outros jogadores a veem. Floresta, Deserto, Urbano e Ártico vêm de graça com a patente; as outras (Tigre, Oceano, Carmesim, Neon, Cerejeira, Lava, Galáxia, Ouro e Diamante) custam moedas e algumas pedem nível mínimo. O catálogo e os números ficam em `src/game/progression.ts`.

O progresso fica salvo **no navegador** (`localStorage`): trocar de navegador ou limpar os dados zera tudo, e quem mexer no console consegue se dar moedas. Para jogar entre amigos isso basta; um ranking público pediria contas e um servidor.

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
npm run check      # confere movimentação, balanceamento, mapas, equipamentos, o modo Bomba e a progressão
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
  core/              loop (60 Hz fixo + render interpolado), input, settings, progresso salvo, audio, utilidades
  render/            cena/renderer, mapa, texturas procedurais, modelos, arma em 1ª pessoa, skins (shader), efeitos
  game/              constantes, dados do mapa, física (AABB + rampas), armas, hitboxes, jogador remoto, partida (cliente), patentes e skins
  net/               protocol.ts (mensagens tipadas), peer (PeerJS + loopback), host (simulação autoritativa), client, iceConfig
  ui/                menu, lobby, HUD, placar, chat, configurações, pausa, resultados, toasts
```

Todo texto vindo de jogadores (nicks com até 16 caracteres e chat com até 120) é sanitizado e exibido via
`textContent`, nunca `innerHTML`.
