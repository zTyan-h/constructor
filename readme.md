# Constructor

## FurnitureData por hotel

Os arquivos `furnis/habblive.json` e `furnis/habblet.json` contêm cópias integrais
dos FurnitureData fornecidos pelo usuário em 21/10/2026, preservando os registros
originais, inclusive duplicações. A partir de 3.2.0, o módulo carrega somente o
arquivo do hotel atual pela rota `/load?p=modules/constructor/furnis/<hotel>.json`.
Não consulta mais os endereços externos de FurnitureData do Habblive.

FurnitureData e catálogo de compra são dados distintos. O catálogo capturado da
loja continua salvo em `hl_module_shop_db`, com ofertas, `pageId` e restrições
reconhecidas. Os FurnitureData não substituem essa captura: o executor atual
precisa de página e oferta para comprar. Os ProductData recebidos contêm apenas
código, nome e descrição; ainda não foram incorporados ao módulo.

## Etapa 1 — captura e montagem no Habblet (3.4.0, em validação)

`hotels.js` identifica `habblive.in` e `habblet.city`, incluindo subdomínios.
Os adaptadores `protocol-habblive.js` e `protocol-habblet.js` mantêm códigos,
encoders, leitores e permissões de cada hotel separados. O runtime, as tarefas e
o catálogo delegam ao adaptador da instância. O codec binário e os formatos de
leitura que conferiram com a captura são compartilhados no núcleo; não há fallback
para o protocolo do outro hotel. O shell carrega ambos os adaptadores antes de
selecionar o hotel e inicializar o núcleo.

No Habblet estão habilitados inventário, cópia de quartos, construção por formas,
montagem de projetos, captura manual/varredura do catálogo e compra dos faltantes.
Altura, estado e rotação são solicitados pelo adaptador na colocação. Cores não
são aplicadas nesta etapa, conforme decisão do usuário. Ajustes de estado após a
colocação e repetição de pendências continuam indisponíveis: a captura recebida
não identifica o comando de alternar um móvel já colocado.
`runtime.supports(feature)` informa as capacidades da instância. `configuration`
representa os ajustes após colocar; `colors` controla aplicação/conferência de
cores. O adaptador Habblive preserva essas capacidades e os comandos anteriores.

### Pacotes observados no Habblet

A captura enviada pelo usuário contém 63 registros com 64 frames binários (um
registro OUT agrupa dois frames). Foram confirmados os seguintes formatos:

| Operação | Direção | Header | Situação |
| --- | --- | --- | --- |
| Pedir inventário | OUT | 3150 | Sem campos |
| Inventário completo | IN | 994 | Leitor compartilhado; amostras com 39, 38 e 138 unidades |
| Remover unidade do inventário | IN | 159 | ID da unidade; invalida a conferência local após colocação manual |
| Colocar chão/parede | OUT | 1258 | Encoders próprios; chão exige confirmação, parede verifica inventário ao final |
| Confirmação de chão | IN | 1534 | Prefixo de colocação compatível com o leitor existente |
| Índice de catálogo | IN | 1032 | 1.040 páginas visíveis reconhecidas na amostra |
| Pedir página de catálogo | OUT | 412 | `pageId`, seletor `-1`, texto `NORMAL` |
| Página de catálogo | IN | 804 | Quatro páginas verificadas; uma com 20 ofertas |
| Comprar | OUT | 3492 | `pageId`, `offerId`, texto vazio, quantidade; amostras de 1 e 100 |

O Habblet envia `extra="0"` nos produtos comuns observados. Seu adaptador aceita
`""` e `"0"`; o Habblive continua aceitando apenas `""`. A página 43 resultou em
17 ofertas individuais de chão aproveitáveis; produtos de parede, pacotes,
alugueis, pets e LTD continuam fora desse catálogo de compra automática.

Na colocação de parede do Habblet, ID e posição pertencem a uma string única
(`itemId :w=wx,wy l=lx,ly direção `). O Habblive mantém inteiro de ID seguido de
string de posição. Os encoders de chão e parede foram comparados com a captura.

Verificação isolada com a captura: inventários, confirmação de chão, índice e
páginas; compra de 1 e 100 com comparação byte a byte e chegada simulada; bloqueio
das APIs então pendentes sem envio, cancelamento de espera por desconexão e
preservação do perfil Habblive. Nenhuma conexão ou compra real foi feita por essa
verificação.

### Quarto, altura e estado — segunda captura

| Operação | Direção | Header | Formato observado |
| --- | --- | --- | --- |
| Início do ciclo de entrada no quarto | IN | 758 | Invalida a sessão de construção antes da lista de móveis |
| Lista completa dos móveis de chão | IN | 1778 | Leitor compartilhado consumiu integralmente listas de 117 e 23 móveis |
| Atualização completa de um móvel | IN | 3776 | Usa o leitor de objeto completo; não o formato de atualização do Habblive |
| Comandos de altura, estado e rotação | OUT | 1314 | Texto seguido de inteiro `3` nas amostras |

No Habblet, `:up <altura>`, `:state <estado>` e `:spin <rotação>` configuram a
colocação. Para desativar e voltar ao normal, usar **`:up`, `:state` e `:spin`
sem argumentos**, conforme correção final do usuário e mensagens do servidor.
Zero numérico não é usado como comando de desativação. `:setz` permanece exclusivo
do adaptador Habblive. Os encoders de `:up 1`, `:state 1` e `:spin 1` conferiram
byte a byte com a captura.

A construção Habblet limpa os três modos no início e solicita estado/rotação de
cada móvel antes de colocá-lo. A altura segue o plano. Ao terminar, cancelar ou
encerrar, tenta desativar os modos na mesma sala/conexão; ao encerrar, a limpeza
ocorre antes de invalidar o transporte. Uma troca de sala/conexão impede envios
tardios de limpeza para a nova sessão. Estados não numéricos são rejeitados antes
do primeiro envio. Cores salvas são preservadas nos projetos, mas não são aplicadas
nem geram pendências no Habblet; o comportamento do Habblive é mantido.

Uma confirmação de colocação com estado diferente do solicitado gera pendência;
no modo normal, a montagem segue, e no modo estrito para sem recolocar o móvel.
Não há reenvio automático de colocação nem repetição de estado após colocar no
Habblet. Atualizações tardias podem resolver as pendências. Recusas ainda não têm
header identificado; falta de confirmação interrompe pelo timeout existente.

Replay isolado da segunda captura e transporte simulado: leitura/captura e
persistência dos dois quartos; nove atualizações completas; inventários com
441/435 unidades; encoders dos comandos; construção com estados confirmados ou
pendentes, resposta tardia, modo estrito, cancelamento, fechamento, troca de sala,
timeout sem reenvio e preservação dos comandos Habblive. Não substitui validação
de cópia e reconstrução executadas pelo módulo no jogo.

`furniture.js` fornece `ctx.loadFurniture()`, compartilhando a requisição em voo
e o resultado em memória durante a instância. Retorna índices separados de chão
e parede, por `id` e `classname`, preservando todos os candidatos e duplicações.
Falhas permitem nova tentativa; encerrar aborta a requisição. A UI carrega nomes
ao abrir e pode continuar mostrando IDs se o arquivo não estiver disponível.
Esses índices não fazem conversão entre hotéis nem selecionam ofertas de compra.

Projetos e catálogo do Habblive continuam no banco `habblive-oficina`, com as
chaves anteriores e a migração existente. O Habblet usa `habblet-oficina`; no
fallback localStorage, usa o prefixo `habblet:`. Não importa automaticamente as
chaves antigas sem identificação no Habblet. Preferências visuais e formas
pessoais mantêm o comportamento anterior. Não há separação adicional por conta
do jogo nesta entrega, nem sincronização Firebase.

Pendências para concluir a etapa: validar os fluxos completos pelo módulo nos
dois hotéis e identificar respostas explícitas de recusa e o comando de alternar
estado de um móvel já colocado, para permitir ajustes posteriores. Cores estão
fora do escopo atual. O replay não substitui execução real no jogo.
A entrega dos JSONs pela rota do Worker e a interface também
exigem validação no ambiente real; os arquivos têm aproximadamente 17,5 MB
(Habblet) e 26 MB (Habblive). O Worker externo não foi alterado.

## Interface por hotel (3.3.0)

A bancada mostra o divisor Habblive/Habblet como origem dos projetos. O cabeçalho
identifica separadamente o hotel conectado. Selecionar outra origem não troca o
socket ou o adaptador: os projetos locais atuais são ocultados e aparece uma
orientação para abrir o Constructor no hotel correspondente. Os bancos locais
das duas origens não são compartilhados; Firebase e conversão continuam pendentes.

Na origem diferente, cópia, atualização pelo inspector, montagem, compra,
importação, exportação e exclusão são bloqueadas nos controles e handlers, com
rechecagem após confirmações e leitura assíncrona de arquivo. Ao voltar à origem
conectada, a seleção anterior é restaurada. A área Construir permanece vinculada
ao hotel conectado e às capacidades reais do adaptador.

O mapa ocupa o centro, com controles de zoom na parte inferior. O inspector
agrupa resumo do inventário, posição inicial e montagem; a lista de faltantes e
as opções de montagem começam recolhidas. A seleção no mapa abre os detalhes do
móvel. Comprar continua separado de montar e exige confirmação. Importação,
exportação e exclusão ficam no menu de projetos. Na largura compacta, o divisor
continua visível e os projetos usam seletor; a montagem vira seção expansível.

Validação em navegador local com runtime simulado e envios proibidos: temas
claro/escuro, largura de 430 px, troca de origem e retorno, bloqueios no menu,
faltantes recolhidos e compra separada, minimizar/restaurar e projeto vazio.
Isso confirma a interface isolada; não comprova execução dos pacotes no jogo.

Módulo do Sang Hub baseado no userscript Habblive Oficina 1.5.1 fornecido pelo usuário.
O manifesto aponta para `shell.js`, com `admin: false`, `misc: false` (aba principal),
`secret: false` e `autoload: false`. A instância pública é `window._constructor`.
O ID no manifesto é `constructorlive`, evitando o nome herdado `constructor` nos
mapas de estado do Hub.

## Organização

| Arquivo | Responsabilidade |
| --- | --- |
| `shell.js` | Carga sequencial pelo bridge, prontidão e ciclo de vida |
| `hotels.js` | Identificação do hotel, armazenamento e perfil de protocolo |
| `protocol-habblive.js` / `protocol-habblet.js` | Adaptadores de leitura/envio e capacidades independentes |
| `furniture.js` | Leitura do FurnitureData local e índices separados por tipo |
| `core.js` | Codec do protocolo, leitura de pacotes e validação dos dados |
| `shapes.js` | Formas disponíveis e planejamento de formas/projetos |
| `runtime.js` | Conexão pelo `_hubSocket`, inventário, eventos e fila cancelável |
| `storage.js` | IndexedDB, migração do armazenamento antigo e persistência |
| `catalog.js` | Captura, leitura de páginas e varredura do catálogo |
| `projects.js` | Consulta, gravação, exclusão e captura dos projetos |
| `tasks.js` | Colocação, altura dos móveis e compras |
| `configurations.js` | Estado/cor, confirmações, pendências e repetição dos ajustes |
| `input.js` | Isolamento da digitação no painel |
| `libs.js` | Bundle local fixado: Konva, Floating UI, Lucide e Motion |
| `preview.js` | Mapa isométrico somente leitura e alocação visual do inventário |
| `typography.js` | Fontes locais opcionais e descarte por instância |
| `styles.js` | Tokens de tema, estilos e layout responsivo no Shadow DOM |
| `view.js` | Marcação e ícones do Shadow DOM |
| `ui.js` | Estado da interface, prévia, formulários e ações |

Os arquivos usam IIFEs e registram suas partes na instância atual, sem exports
globais da Oficina. Extensões do runtime usam `ctx.extendRuntime(prototype)` e são
carregadas antes de sua instanciação. Para ampliar, registre novas formas em
`shapes.js`; mudanças no protocolo ficam no núcleo e mudanças de apresentação na
view/UI. Novos arquivos devem entrar na lista ordenada de `shell.js`.

## Catálogo e limitados — 3.0.1

O bit LTD dos dados de quarto/inventário agora sobrevive à captura e à
normalização/exportação dos projetos (`limited: true`). Esses móveis continuam
necessários para montar o projeto, mas são excluídos da confirmação de compra e
do executor BUY. O inspector os identifica como “LTD: fora da compra”; quando
só faltam limitados, o botão de compra fica desabilitado.

Ofertas limitadas vistas na loja viram marcadores `{limited:true}` no catálogo,
sem offerId utilizável. Importar um catálogo antigo preserva as restrições já
conhecidas. O executor revalida o inventário e confere novamente antes do envio.
Projetos antigos que perderam a informação precisam de evidência nova: entrar no
quarto de origem com o módulo ativo, recapturar o projeto, atualizar um inventário
com esse tipo de móvel ou capturar sua oferta limitada na loja. Não se infere LTD
pelo nome do móvel ou simplesmente por faltar uma oferta no catálogo.

A aprendizagem do pedido de página aceita seletores de oferta a partir de -1,
exigindo formato completo, socket atual e página de resposta correspondente.
A varredura mantém uma requisição em voo, segue após salvar a resposta e reduz
o intervalo entre páginas de 800 para 100 ms. Páginas sem resposta têm até três
tentativas, com recuo; falhas restantes geram aviso de captura incompleta e IDs
no diagnóstico (`catalogScanReport.pendingPages`), nunca sucesso completo.
A cobertura depende das páginas enviadas no índice acessível da loja e das
respostas do servidor. Pacotes, alugueis e ofertas não individuais continuam
fora do catálogo de compra automática.

Verificações isoladas: `.local/constructor-redesign/catalog-checks.mjs` cobre
LTD em quarto/inventário, exportação, compra mista, detecção durante refresh,
importação antiga, seletores de página, retries, captura parcial e cancelamento.
A reprodução contra o código anterior falha pela perda do bit LTD; a variante
de pedido com seletor 0 também reproduziu o bloqueio de “Capturar tudo”.
Validação no navegador usa apenas a fixture `?sample=small&limited=1`, sem compra
real. A causa exata do pedido observado no jogo ainda exige confirmação ao usar
a atualização; o print sozinho não informa seus campos de saída.

## Estúdio claro/escuro — 3.0.0

Interface baseada na referência visual aprovada: superfícies claras, grafite e
laranja; navegação Construir / Projetos / Preferências no cabeçalho, projetos à
esquerda, prévia no centro e inventário/montagem no inspector à direita. Em
janelas compactas a lista vira seletor e o inspector fica em uma seção expansível
abaixo do mapa. A opção Estúdio usa até 1440 px e respeita o espaço da tela.
Geometria anterior, redimensionamento e preferências existentes são preservados.
A pill minimizada aceita arraste por mouse/toque, limitada à área da tela;
movimentos acima de 5 px não acionam a reabertura. Clique simples ou teclado
continuam restaurando o painel.

O botão sol/lua no cabeçalho alterna os temas. A escolha fica em
`hl_oficina_preferences.theme`, com claro como padrão. Os tokens estão no host
do Shadow DOM, incluindo menus, diálogos, avisos e campos. A prévia geométrica
e seu motor não foram alterados; imagens reais dos mobis continuam fora do escopo.

Manrope e Bricolage Grotesque são fontes variáveis locais, em
`assets/fonts/constructor`, com licenças OFL. São carregadas pelo Worker já
existente, sem consulta ao Google durante o uso. A carga é opcional, não bloqueia
a montagem e usa fallbacks caso falhe. As FontFaces da instância são retiradas
em `kill()`; requisições pendentes são abortadas pelo sinal do módulo.

Verificação desta versão: sintaxe e contratos de carga; checks existentes de
prévia (alocação, seleção, empilhamento, câmera/redimensionamento, pan, suspensão
e descarte); 16 cenários de runtime real com transporte/relógio em memória em
`.local/constructor-redesign/runtime-checks.mjs`. Os cenários cobrem ciclos,
recusas/timeouts de estado/cor, retry somente de ajustes, strict/inventário,
pausa/cancelamento, desconexão e troca de quarto com confirmação no mesmo lote.
Também reproduziram e preveniram um toggle redundante quando uma resposta tardia
atinge o estado esperado durante o intervalo anterior ao envio.

QA em navegador local: fontes carregadas, temas e persistência ao reabrir,
janela de 430 px sem sobreposição de cabeçalho, menus e diálogo escuro, Escape,
minimizar/reabrir, projeto vazio, projeto com 5.000 móveis e inventário stale,
confirmação/pausa/cancelamento de montagem simulada e retry visual de pendências.
São verificações isoladas, sem pacotes enviados ao jogo; não comprovam aceitação
dos comandos pelo servidor real.

## Bancada de projetos — 2.0.0

A entrada principal é a bancada: projetos à esquerda, mapa central e conferência
de inventário/seleção à direita. Formas, editor pessoal, catálogo e diagnóstico
continuam em **Ferramentas**. Som e ritmo permanecem em **Ajustes**. Copiar pede
reentrada no quarto; reconstruir confirma projeto, quantidade e
origem antes de usar o executor existente. Comprar e reconstruir são ações
separadas. A janela nasce em 1100 × 720, limitada ao viewport, e é redimensionável.

Ao clicar em copiar, a captura começa diretamente, com nome automático por data
e hora, sem abrir diálogo. O painel é minimizado para liberar
os cliques no jogo durante a reentrada. A captura continua em segundo plano;
o botão reduzido indica a espera e reabre o painel. O botão de copiar permite
cancelar a espera, sem diálogo nem progresso duplicado no rodapé. Ao salvar,
o painel reaparece com o novo projeto selecionado (2.0.2).

A prévia representa âncoras de móveis de chão por `relX`, `relY`, `z` e `rot`.
Não representa sprites, dimensões reais, paredes ou planta; não valida colisões,
espaço nem permissões do servidor. A câmera tem zoom/arraste/enquadrar. Selecionar
um item expõe os candidatos empilhados na mesma posição. Unidades disponíveis
são alocadas na ordem do projeto; inventário desatualizado é **Não conferido**.
Atualizar inventário mantém câmera/seleção. Minimizar suspende desenho e interação
do canvas, preservando captura e tarefas; encerrar destrói o stage e observadores.

`ctx.createPreview({container,onSelect})` devolve `setProject(project,key)`,
`setInventory(items,fresh)`, `highlightType(spriteId)`, `select(index)`, `fit()`,
`zoomBy(factor)`, `resize()`, `setVisible(bool)` e `destroy()`. A seleção informa
índice, item, disponibilidade e candidatos da mesma âncora. `previewAvailability`
é um helper puro; nenhum desses métodos envia pacotes ou altera o projeto.

As bibliotecas são compiladas de `.local/constructor-ui/src/libs.js` usando o
lockfile próprio. Nessa pasta: `npm ci --ignore-scripts`, `npm run build` e
`npm run check`. O build produz apenas `modules/constructor/libs.js` e as licenças;
o shell carrega `libs` e `preview` antes de `view`/`ui`, sem globais de bibliotecas
ou dependência do bundle de outro módulo. Os termos de terceiros acompanham o
bundle e `.local/constructor-ui/THIRD_PARTY_LICENSES.txt`.

Preview sem conexão: `http://127.0.0.1:8766/.local/constructor-ui/preview.html`.
Os parâmetros `sample=empty`, `sample=stacked`, `sample=large` e `inventory=stale`
oferecem casos de revisão. O shell é o real; o runtime da fixture usa memória,
inventário simulado e proíbe envios. Não substitui a validação no Hub do jogo.

Verificação desta entrega: boot com bibliotecas reais no navegador, projetos
vazio/pequeno/empilhado/5.000, cópia cancelada e salva com seleção automática,
confirmação antes da execução simulada, status de inventário, menu/Escape e
minimizar/reabrir. O pan usa Pointer Events com captura própria, sem depender
do mouseup global de Konva (interceptado pelo isolamento da janela); soltar,
cancelar, perder captura/foco, minimizar e encerrar liberam o ponteiro.
Mocks conferem câmera no resize, disponibilidade em ordem e ausência de loop
de desenho. Reconstrução, compra e captura de dados reais continuam pendentes
no jogo. As verificações isoladas não comprovam aceitação pelo servidor.

## Ponte de transporte — 3.1.0 (20/10/2026)

O Constructor consome `window._hubBridge.socket` versão 1 para entrada, saída confirmada e mudanças de conexão. Não instala listeners no socket nativo nem altera/restaura `send`. A identificação do jogo pertence ao Hub, independentemente da ordem em que as ferramentas forem abertas.

Envios usam `connectionId` e origem `constructor`. Os filtros OUT ativos do PacketLive também se aplicam à construção: `PACKET_BLOCKED` cancela imediatamente a operação e as esperas, sem aguardar timeout ou reenviar. Troca/queda de conexão invalida o inventário e cancela inclusive esperas iniciadas fora de `run()`. O aprendizado de pedidos de catálogo observa somente envios confirmados pela chamada nativa, nunca tentativas bloqueadas.

O codec, montagem de fragmentos, armazenamento, catálogo e regras de construção permanecem no Constructor. Recolher a janela mantém o serviço; encerrar remove somente suas assinaturas e recursos. Primeira migração requer recarregar a página. Contrato e manutenção futura: [Transporte WebSocket](../../docs/websocket-transport.md).

## Integração e dados

O runtime recebe fachadas da conexão identificada pelo Hub, incluindo uma conexão
já capturada antes de abrir o módulo. A observação de entrada e de envios é feita
por assinaturas da ponte, sem alterar métodos ou listeners do transporte nativo.
Não substitui `window.WebSocket`, `sendToGameWS`, `getGameWSStatus` ou `gameWS`.

Foram mantidos o banco `habblive-oficina` e as chaves `hl_module_rooms`,
`hl_module_shop_db`, `hl_oficina_preferences` e `mp_cs`, para reaproveitar dados
do script original. A migração de projetos e catálogo para IndexedDB foi mantida.
Não execute o userscript original ao mesmo tempo que este módulo.

`ready` sinaliza a carga e montagem. `show()`, `hide()` e `toggle()` controlam o
painel; recolher mantém tarefas em andamento. `kill()` aborta a carga, cancela
tarefas, retira observadores/listeners, fecha o banco e o áudio, limpa timers e
URLs temporárias e remove o painel. Projetos salvos permanecem disponíveis.

A montagem registra o disposer antes de inserir o painel no DOM, para limpar
inclusive falhas na renderização inicial. Uma nova tentativa remove somente um
elemento residual `sang-constructor` sem interface pertencente à instância atual.
Se a interface atual já existe, montar novamente apenas a exibe. Falhas de boot
também mostram o motivo no toast do Hub.

Correção 1.0.2: `renderView({demo})` recebe explicitamente o modo de demonstração
da UI. Antes, a view consultava `demo` fora do seu escopo e lançava
`ReferenceError: demo is not defined`, interrompendo a montagem após carregar
todas as dependências com HTTP 200. A rota `/load?p=modules/constructor/...`
permanece compatível com o Worker fornecido; não exige alteração do backend.

## Construção com pendências (2.1.0)

Por padrão, um estado inalcançável, recusa de configuração ou ausência de
confirmação de estado/cor gera uma pendência e a construção segue. O item sai
do inventário local assim que a colocação de chão é confirmada. Colocação sem
confirmação, desconexão e troca de quarto interrompem a tarefa.

A seção Resultado nesta sala mostra os móveis de chão confirmados, configurados,
estados/cores pendentes e colocações sem confirmação, além dos envios de parede.
O resumo é acumulado na sala, e a lista mostra até 30 pendências. Respostas
tardias podem resolver ajustes pendentes. As cores só contam como resolvidas
quando ambas são confirmadas pelo jogo.

Tentar pendências novamente envia somente ajustes de estado/cor para IDs de
móveis já confirmados. Não compra, recoloca móveis ou retoma as colocações
restantes de uma tarefa interrompida. Se um comando de alternância ficar sem
resposta, a nova tentativa espera uma atualização real antes de enviar outro;
o usuário pode interagir com esse móvel para fornecer seu estado atual.
Alterações têm limite de 35 passos, detecção de ciclos e intervalo crescente
após timeout, com espera passiva por respostas atrasadas.

O Modo estrito de configuração, em Preferências, interrompe a construção após
um ajuste pendente. A preferência é preservada, inclusive no ritmo Flash.
As pendências ficam em memória e são descartadas ao trocar conexão, receber
uma nova lista do quarto ou encerrar o módulo, impedindo reutilização de IDs
fora da sessão em que foram confirmados. Projetos salvos não são modificados.

Verificação original de 2.1.0: sintaxe e revisão estrutural dos contratos;
os cenários isolados de execução foram acrescentados em 3.0.0, conforme acima.
Validação em jogo pendente: conexão existente/reconexão, inventário, construção,
captura/montagem, catálogo/compras, importação/exportação e fechar/reabrir pelo Hub.
O Worker externo não foi alterado nem publicado; os caminhos de carga seguem o
contrato já usado pelos outros módulos.
