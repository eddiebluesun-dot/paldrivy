# Comunidade (Community) — Design

## Contexto

O PalDrivy vai ganhar uma feature social ("Comunidade"), inspirada em capturas de tela de
um app concorrente (motoristas de app trocando resultados diários). A feature vira uma
aba de primeiro nível na navegação, junto com uma reestruturação da barra de abas.

## Objetivo da v1

Motoristas postam um snapshot automático dos números do turno do dia (receita por
plataforma, despesas por categoria, métricas de performance — os mesmos dados já
calculados em `src/services/dashboard.ts` / `shifts.ts`) com uma legenda de humor livre
e, opcionalmente, uma foto. Outros motoristas veem o feed, curtem, comentam, seguem,
bloqueiam ou denunciam. Chat 1:1 em tempo real entre usuários. Como o app é multi-idioma
(pt/en/es), a legenda do post é traduzida automaticamente pra quem lê em outro idioma,
e o país do autor (já presente em `profiles.country`) aparece no post/perfil.

### Fora de escopo (v1)

- Handles/@usuário únicos — perfis são identificados por nome + avatar + cidade/estado/país.
- Fila de moderação no admin-paldrivy — denunciar só oculta o conteúdo pra quem denunciou.
- Posts totalmente livres sem dados de turno (fica só o formato snapshot automático).
- Stories, vídeo, grupos/chats em grupo.
- Deep-linking de posts fora do app.

## Navegação

Barra de abas atual (`app/(tabs)/_layout.tsx`): Início, Turnos, Combustível, Despesas, Mais.

Nova barra: **Início · Turnos · (+) · Comunidade · Mais**

- O botão central `+` (maior, elevado, destaque gold) abre um bottom sheet modal com
  duas opções: **Combustível** e **Despesas** (Turnos continua como aba direta, não entra
  no sheet).
- `Combustível` e `Despesas` saem da barra de abas principal; suas telas (`fuel.tsx`,
  `expenses.tsx`) continuam existindo, só passam a ser abertas via `router.push` a partir
  do bottom sheet em vez de via `Tabs.Screen`.
- Nova aba/tela `Comunidade` (`app/(tabs)/community.tsx` ou grupo de rotas próprio —
  decidido na fase de implementação).
- Fora de escopo desta mudança de nav: aba "Relatórios" (avaliada e descartada pelo
  usuário — Turnos volta a ser aba direta em vez disso).

## Ícone "raio" removido (fix incluído neste mesmo ciclo)

O FAB de raio (`Ionicons name="flash"`) em `app/(tabs)/shifts.tsx:724` que abre o
`ShiftWizard` (lançamento manual de turno) some da tela de Turnos — não faz parte do
fluxo principal e confundia. Remoção tratada como item avulso, não parte do design da
Comunidade (sem impacto no modelo de dados abaixo).

## Modelo de dados

Segue o padrão relacional já usado no projeto (tabelas normalizadas + RLS por tabela,
como `shifts`/`expenses`/`subscriptions`), em vez de colunas jsonb genéricas — mantém
consistência com o resto do schema e permite índices/queries diretas por FK.

```
community_profiles
  user_id           uuid PK, FK -> profiles.id (cascade)
  bio               text null
  avatar_url        text null
  cover_url         text null
  followers_count   int default 0   -- denormalizado, mantido por trigger
  following_count   int default 0   -- denormalizado, mantido por trigger

user_follows
  follower_id  uuid FK -> profiles.id (cascade)
  followed_id  uuid FK -> profiles.id (cascade)
  created_at   timestamptz default now()
  PK (follower_id, followed_id)

user_blocks
  blocker_id  uuid FK -> profiles.id (cascade)
  blocked_id  uuid FK -> profiles.id (cascade)
  created_at  timestamptz default now()
  PK (blocker_id, blocked_id)

hidden_posts                      -- usado tanto por "bloquear" (oculta tudo do bloqueado)
  user_id     uuid FK -> profiles.id (cascade)   -- quanto por "denunciar" (oculta 1 post)
  post_id     uuid FK -> community_posts.id (cascade)
  reason      text null            -- null = ocultado via bloqueio; texto = denúncia
  created_at  timestamptz default now()
  PK (user_id, post_id)

community_posts
  id               uuid PK default gen_random_uuid()
  user_id          uuid FK -> profiles.id (cascade)
  shift_id         uuid FK -> shifts.id (set null) null
  caption          text null
  photo_url        text null
  stats_snapshot   jsonb not null   -- cópia congelada dos números no momento do post
  likes_count      int default 0   -- denormalizado
  comments_count   int default 0   -- denormalizado
  views_count      int default 0   -- denormalizado
  created_at       timestamptz default now()

post_likes
  post_id     uuid FK -> community_posts.id (cascade)
  user_id     uuid FK -> profiles.id (cascade)
  created_at  timestamptz default now()
  PK (post_id, user_id)

post_comments
  id          uuid PK default gen_random_uuid()
  post_id     uuid FK -> community_posts.id (cascade)
  user_id     uuid FK -> profiles.id (cascade)
  body        text not null
  created_at  timestamptz default now()

post_views
  post_id     uuid FK -> community_posts.id (cascade)
  user_id     uuid FK -> profiles.id (cascade)
  viewed_at   timestamptz default now()
  PK (post_id, user_id)     -- 1 view por usuário por post, não incrementa a cada abertura

post_translations                  -- cache — nunca traduz o mesmo post 2x pro mesmo idioma
  post_id           uuid FK -> community_posts.id (cascade)
  lang              text            -- 'en' | 'es' | 'pt'
  translated_text   text not null
  created_at        timestamptz default now()
  PK (post_id, lang)

dm_conversations
  id          uuid PK default gen_random_uuid()
  user_a      uuid FK -> profiles.id (cascade)   -- user_a < user_b (ordenado) evita duplicata
  user_b      uuid FK -> profiles.id (cascade)
  created_at  timestamptz default now()
  UNIQUE (user_a, user_b)

dm_messages
  id                uuid PK default gen_random_uuid()
  conversation_id   uuid FK -> dm_conversations.id (cascade)
  sender_id         uuid FK -> profiles.id (cascade)
  body              text null
  image_url         text null
  read_at           timestamptz null
  created_at        timestamptz default now()
```

Todas as tabelas ganham RLS: leitura geralmente aberta a todos os autenticados (exceto
`dm_messages`/`dm_conversations`, restritas aos dois participantes), escrita restrita ao
próprio `user_id`/`sender_id`. Bloqueio (`user_blocks`) filtra o feed e impede novo
follow/DM/comentário entre as partes bloqueadas — aplicado via policy que faz `NOT
EXISTS` contra `user_blocks` nas duas direções.

`followers_count`/`following_count`/`likes_count`/`comments_count`/`views_count` são
mantidos por triggers `AFTER INSERT/DELETE` nas tabelas de detalhe (`user_follows`,
`post_likes`, `post_comments`, `post_views`) — mesmo padrão de "contador denormalizado +
trigger" que o projeto já usa em outros lugares (ex.: contadores do admin).

## Tradução automática

- Provedor: **MyMemory Translation API** (gratuita; sem cadastro para uso básico,
  ~5.000 palavras/dia por IP anônimo, até ~50.000/dia informando um e-mail de contato no
  request — suficiente pra escala atual do app).
- Chamada feita **só a partir de uma edge function** (`translate-post` ou embutida na
  leitura do post), nunca do client diretamente — mantém a lógica e eventual e-mail de
  contato no servidor.
- Tradução é **lazy + cacheada**: na primeira vez que alguém abre um post num idioma
  diferente do idioma original do autor (`profiles.locale`), a edge function traduz e
  grava em `post_translations`; leituras seguintes do mesmo post+idioma vêm do cache, sem
  nova chamada à API.
- UI sempre oferece "ver original" pra voltar ao texto tal como escrito.

## Chat em tempo real

Supabase Realtime (já habilitado em `config.toml`) com subscription na tabela
`dm_messages` filtrada por `conversation_id`. Sem polling — mensagem aparece via evento
`INSERT` do Realtime nos dois lados da conversa.

## Notificações push

Reaproveita o `push_token` já salvo em `profiles` e a infraestrutura de envio já usada
por `push_broadcasts`/`check-subscription-expiry`. Dispara push para: curtida, comentário,
novo seguidor, nova mensagem DM. Cada evento gera 1 push (sem agregação/batching na v1).

## Storage

Novo bucket `community` no Supabase Storage — avatar, foto de capa, foto de post.
Restrito a tipos de imagem (jpeg/png/webp) e limite de tamanho (a definir na
implementação, seguindo o padrão de `file_size_limit` já configurado em `config.toml`
pra outros buckets).

## i18n

Novas chaves em `locales/{pt,en,es}.json` sob um namespace `community.*` — labels de
tela (feed, perfil, seguir, bloquear, denunciar, chat, etc.). O **conteúdo gerado pelo
usuário** (legenda do post, mensagens de chat) não passa pelo i18n — é tratado pela
tradução automática descrita acima.

## Riscos / pontos em aberto pra fase de implementação

- Moderação client-side-only (sem fila no admin) significa que conteúdo abusivo só some
  pra quem denunciou — se isso virar problema real de uso, uma fila de revisão no
  admin-paldrivy fica como trabalho futuro natural (mencionar no relatório final, não
  bloqueia a v1).
- Limite diário da MyMemory pode ser insuficiente se o volume de posts crescer muito —
  trocar de provedor (ex. DeepL free tier) é uma troca isolada dentro da edge function,
  não afeta o resto do design.
- `stats_snapshot` congela os números no momento do post — se o motorista editar o turno
  depois, o post não atualiza (decisão implícita, consistente com "snapshot", não com
  "link ao vivo" pro turno).
