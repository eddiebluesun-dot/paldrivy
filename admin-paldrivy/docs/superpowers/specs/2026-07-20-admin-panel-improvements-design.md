# Melhorias no Painel Admin PalDrivy — Design

Data: 2026-07-20
Repos envolvidos: `admin-paldrivy` (painel admin, React+Vite+Supabase) e `app-motorista` (app do motorista, Expo/React Native). Ambos usam o **mesmo projeto Supabase** (`ucxkvxqpkknxotbfxgeu`).

## Contexto

O usuário pediu 6 melhorias no painel admin. Uma delas (bug da gratuidade) era uma correção pontual já com causa raiz identificada e foi corrigida durante o brainstorm, fora do ciclo de spec/plano. As outras 5 são desenhadas abaixo.

## Já corrigido (fora deste spec)

**Bug: gratuidade não era respeitada.** Causa: o admin grava `subscriptions.status = 'complimentary'`, mas `app-motorista/app/(tabs)/more.tsx` só reconhecia `status === 'active'` como premium — qualquer usuário `complimentary` ou `trial` caía no gate de "assine o Premium". Corrigido em `more.tsx:583-589`: agora considera `active`/`trial`/`complimentary` como premium, respeitando `current_period_end` (nulo = vitalício).

Essa mesma checagem (o que conta como "premium") vai ser extraída para um hook único (ver Item 2) para não duplicar a lógica e reintroduzir esse bug em outro lugar.

---

## Item 1 — Central de envio de push (admin-paldrivy)

### Estado atual
- `app-motorista/supabase/functions/send-push-notification/index.ts` já existe, é admin-only (verifica `profiles.role === 'admin'` via JWT), aceita `{ title, body, user_ids? }` e dispara para o Expo Push API em lotes de 100. **Nenhuma tela no admin chama essa função.**
- Motorista tem só 1 token por vez (`profiles.push_token`, coluna única) — sem suporte a múltiplos dispositivos. Fora de escopo mudar isso agora.

### Design
Nova página `Notifications.tsx` + item de menu em `Layout.tsx`.

**Formulário de envio:**
- Título (texto curto)
- Mensagem (textarea)
- Segmentação, reaproveitando os filtros que já existem em `Users.tsx`:
  - Todos os motoristas
  - Por plano (dropdown dos planos existentes)
  - Por status de assinatura (active/trial/complimentary/cancelled/expired)
  - Por país
  - Combináveis (ex.: Free + Brasil)
- Botão "Enviar" mostra preview de quantos destinatários batem no filtro antes de confirmar (para evitar broadcast acidental para toda a base).

**Backend:**
- `services/admin.ts`: nova função `getPushRecipientCount(filters)` e `sendPushBroadcast({title, body, filters})`.
- `sendPushBroadcast` resolve os `user_ids` que batem no filtro (query em `profiles`/`subscriptions`), depois chama `supabase.functions.invoke('send-push-notification', { body: { title, body, user_ids } })`.
- Nova tabela `push_broadcasts` (migration em `app-motorista/supabase/migrations`):
  ```sql
  create table push_broadcasts (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    body text not null,
    filters jsonb not null,
    recipient_count int not null,
    sent_by uuid references auth.users(id),
    created_at timestamptz not null default now()
  );
  ```
- Página lista as últimas 20 mensagens enviadas (título, filtro usado, quantos receberam, quando) abaixo do formulário — histórico simples, sem edição/reenvio.

### Erros
Se `send-push-notification` retornar falha parcial (alguns tokens inválidos), mostrar "Enviado para X de Y motoristas" sem travar a UI.

---

## Item 2 — Limites do Plano Free (app-motorista)

### Definição de "Free"
Free = usuário **sem** assinatura `active`/`trial`/`complimentary` com `current_period_end` não vencido — mesma regra corrigida no bug de gratuidade. Extraída para um hook único:

```ts
// src/hooks/usePremiumStatus.ts
function usePremiumStatus(userId: string | null): { isPremium: boolean; periodEnd: string | null }
```

Substituir o cálculo inline em `more.tsx` por esse hook, e reusá-lo em `shifts.tsx` e `index.tsx` (cockpit). Isso é o ponto central que evita o bug do Item B se repetir em outro lugar.

### Limites aplicados

1. **Até 5 turnos/mês.** `startShift()` em `src/services/shifts.ts` passa a receber `isPremium`; se `false`, conta turnos do usuário no mês corrente (`started_at` dentro do mês atual) antes do insert. Se count >= 5, lança um erro tipado (`FreeLimitError`) em vez de inserir. A tela que chama `startShift` (`shifts.tsx`) captura esse erro e abre o modal de upgrade em vez de seguir o fluxo normal.

2. **Histórico de 30 dias.** Navegação de semana/mês no cockpit (`index.tsx`, os controles que movem `cockpitDateStr`/período exibido) trava em D-30 para usuários Free: tentar navegar além disso não busca dado novo e abre o modal de upgrade.

3. **Dashboard básico.** Para Free, o cockpit mostra só: resumo do dia atual + total do mês em números (sem gráfico). Os componentes de gráfico interativo semana/mês, gauges e detalhamento de $/km (`CockpitCard` e afins) ficam renderizados com overlay de cadeado + CTA "Assine para desbloquear gráficos", em vez de escondidos — para o usuário Free ver o que está perdendo.

### Modal de upgrade
Componente único `UpgradeModal` reusado nos 3 pontos acima, recebendo o motivo (`'shifts_limit' | 'history_limit' | 'dashboard_locked'`) para variar o texto. Preço/plano sugerido formatado na moeda da região do usuário (`profile.currency_code` → `plans.prices[currency]`, via `utils/currency.ts` já existente). **A regra é única para todo mundo — só a oferta (preço, moeda) varia por região, não o limite em si.**

---

## Item 3 — Aba Assinaturas agrupada por tipo/categoria (admin-paldrivy)

### Estado atual
`Subscriptions.tsx` é uma tabela única com filtro de status em pill, sem agrupamento.

### Design
Adicionar, acima da tabela existente, uma faixa de cards de resumo:
- Por **status**: Ativo / Trial / Gratuidade / Cancelado / Expirado, com contagem de cada.
- Por **plano**: um card por plano cadastrado, com contagem de assinantes.

Os cards são cliques que aplicam filtro na tabela abaixo (estende o filtro de pill que já existe para aceitar também `plan_id`). Toda a agregação é client-side sobre o resultado que `getSubscriptions()` já retorna — sem mudança de schema ou de query.

---

## Item 4 — Histórico completo do motorista no UserDetail (admin-paldrivy)

### Estado atual
`getUserDetail()` (admin.ts:137-184) traz só os últimos 10 turnos, 10 despesas e 5 lançamentos de combustível (`.limit()` fixo) — resumo financeiro, não histórico completo.

### Design
- Remover os `.limit()` fixos de `getUserDetail()`.
- Cada seção (Turnos, Despesas, Combustível) na UserDetail vira paginada: busca inicial de 20 itens (mais recentes primeiro) + botão "Carregar mais" que busca os próximos 20 via `.range()`.
- Resumo financeiro (totais, mês atual) continua calculado como hoje — só a listagem detalhada abaixo dele passa a ser paginada em vez de truncada.

---

## Item 5 — Notificação de vencimento de assinatura (app-motorista)

### Estado atual
Nenhum cron/scheduled function existe no projeto relacionado a vencimento de assinatura. Também não há integração de email (Brevo) configurada neste repo — vai ser criada do zero.

### Design

**Novas colunas em `subscriptions`** (migration):
```sql
alter table subscriptions
  add column expiry_warning_sent_at timestamptz,
  add column expiry_followup_sent_at timestamptz;
```

**Nova edge function** `app-motorista/supabase/functions/check-subscription-expiry/index.ts`, rodando 1x/dia via `pg_cron`:
```sql
select cron.schedule(
  'check-subscription-expiry-daily',
  '0 12 * * *', -- meio-dia UTC
  $$ select net.http_post(url := '<project-url>/functions/v1/check-subscription-expiry', headers := ...); $$
);
```

Lógica da função:
1. Busca `subscriptions` com `status in ('active','trial')` e `current_period_end` não nulo.
2. Se `current_period_end` é daqui a exatamente 7 dias e `expiry_warning_sent_at` é nulo (ou de um período anterior): envia push (via `send-push-notification`, chamada server-to-server com service role) + email ("sua assinatura vence em 7 dias"), grava `expiry_warning_sent_at = now()`.
3. Se `current_period_end` foi há exatamente 1 dia, status ainda não virou `active` de novo (não renovou) e `expiry_followup_sent_at` é nulo: envia push + email ("sua assinatura expirou"), grava `expiry_followup_sent_at = now()`.
4. Assinaturas `complimentary` com `current_period_end = null` (vitalícias) são ignoradas; `complimentary` com data de fim entram na mesma checagem acima.

**Email:** integração nova com a API REST da Brevo (`api.brevo.com/v3/smtp/email`), API key nova como secret do Supabase (`BREVO_API_KEY`). Sem histórico de tentativa aqui, se falhar o envio de email a função loga o erro e segue (push já terá sido tentado independentemente).

---

## Fora de escopo (não pedido, não incluído)
- Suporte a múltiplos push tokens por usuário (multi-dispositivo).
- Reenvio/edição de broadcasts já enviados.
- Mudar o valor dos limites do Free por região (decisão do usuário: limite único, só a oferta de upgrade varia).
- Notificações de vencimento para métodos além de push+email (SMS, WhatsApp).
