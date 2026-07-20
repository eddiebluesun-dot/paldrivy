-- ============================================================
-- PalDrivy Migration v2
-- Grace period, gratuidade, LGPD legal docs
-- ============================================================

-- 1. Make current_period_end nullable (lifetime grants)
ALTER TABLE subscriptions ALTER COLUMN current_period_end DROP NOT NULL;

-- 2. Soft-delete Pro plan
UPDATE plans SET is_active = false, sort_order = 99 WHERE name = 'Pro';

-- 3. Auto-create 7-day Premium trial on new profile
CREATE OR REPLACE FUNCTION fn_create_premium_trial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_plan_id UUID;
BEGIN
  SELECT id INTO v_plan_id FROM plans WHERE name = 'Premium' AND is_active = true LIMIT 1;
  IF v_plan_id IS NOT NULL THEN
    INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
    VALUES (NEW.id, v_plan_id, 'trial', now(), now() + INTERVAL '7 days')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_premium_trial ON profiles;
CREATE TRIGGER trg_premium_trial
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION fn_create_premium_trial();

-- 4. Apply trial retroactively to existing users without subscription
INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
SELECT p.id, pl.id, 'trial', now(), now() + INTERVAL '7 days'
FROM profiles p
CROSS JOIN (SELECT id FROM plans WHERE name = 'Premium' AND is_active = true LIMIT 1) pl
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = p.id)
ON CONFLICT (user_id) DO NOTHING;

-- 5. Legal documents table
CREATE TABLE IF NOT EXISTS legal_documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT        NOT NULL CHECK (type IN ('privacy_policy', 'terms_of_use')),
  version      TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  content      TEXT        NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID        REFERENCES auth.users(id)
);

-- Only one active doc per type
CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_one_active_per_type
  ON legal_documents (type) WHERE is_active = true;

-- 6. User consents table (LGPD Art. 7, I + Art. 7, §5º)
CREATE TABLE IF NOT EXISTS user_consents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id  UUID        NOT NULL REFERENCES legal_documents(id),
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address   TEXT,
  user_agent   TEXT,
  UNIQUE(user_id, document_id)
);

-- 7. RLS: legal_documents
ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "legal_docs_read" ON legal_documents;
DROP POLICY IF EXISTS "legal_docs_admin" ON legal_documents;
CREATE POLICY "legal_docs_read"  ON legal_documents FOR SELECT USING (is_active = true OR is_admin());
CREATE POLICY "legal_docs_admin" ON legal_documents FOR ALL    USING (is_admin());

-- 8. RLS: user_consents
ALTER TABLE user_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "consents_own"   ON user_consents;
DROP POLICY IF EXISTS "consents_admin" ON user_consents;
CREATE POLICY "consents_own"   ON user_consents FOR ALL    USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "consents_admin" ON user_consents FOR SELECT USING (is_admin());

-- 9. Seed: Privacy Policy v1.0
INSERT INTO legal_documents (type, version, title, content, is_active, published_at)
VALUES ('privacy_policy', '1.0', 'Política de Privacidade', $pp$
<h1>Política de Privacidade</h1>
<p><em>Versão 1.0 — Vigente a partir de 28 de junho de 2026</em></p>

<h2>1. Controlador de Dados</h2>
<p>O aplicativo <strong>PalDrivy</strong> é operado pela <strong>Bluesun</strong> ("Controladora"). Para contato com o Encarregado de Dados (DPO): <a href="mailto:privacy@paldrivy.app">privacy@paldrivy.app</a>.</p>

<h2>2. Dados Pessoais Coletados</h2>
<ul>
  <li><strong>Cadastro:</strong> nome e endereço de e-mail.</li>
  <li><strong>Atividade:</strong> turnos (horário, ganhos brutos/líquidos), despesas operacionais, abastecimentos e veículos cadastrados.</li>
  <li><strong>Preferências:</strong> idioma, moeda, fuso horário e unidades de medida.</li>
  <li><strong>Técnicos:</strong> endereço IP e user-agent no momento do aceite dos termos (LGPD Art. 7, §5º).</li>
</ul>

<h2>3. Finalidade e Base Legal</h2>
<table>
  <tr><th>Finalidade</th><th>Base Legal</th></tr>
  <tr><td>Prestação do serviço de gestão financeira</td><td>Art. 7, V — execução de contrato</td></tr>
  <tr><td>Comunicações transacionais (e-mails do serviço)</td><td>Art. 7, V — execução de contrato</td></tr>
  <tr><td>Melhoria do produto e análise de uso</td><td>Art. 7, IX — legítimo interesse</td></tr>
  <tr><td>Cumprimento de obrigações legais</td><td>Art. 7, II — obrigação legal</td></tr>
  <tr><td>Registro de consentimento</td><td>Art. 7, I — consentimento</td></tr>
</table>

<h2>4. Compartilhamento de Dados</h2>
<p>Seus dados são compartilhados exclusivamente com subprocessadores necessários à operação:</p>
<ul>
  <li><strong>Supabase Inc.</strong> — banco de dados e autenticação (EUA, cláusulas contratuais padrão).</li>
  <li><strong>Vercel Inc.</strong> — hospedagem web (EUA, cláusulas contratuais padrão).</li>
</ul>
<p>Não vendemos, alugamos nem compartilhamos seus dados com terceiros para fins publicitários.</p>

<h2>5. Transferência Internacional</h2>
<p>Conforme Art. 33 da LGPD, adotamos salvaguardas adequadas para transferências internacionais.</p>

<h2>6. Retenção</h2>
<p>Seus dados são mantidos enquanto a conta estiver ativa. Após encerramento, excluímos em até 90 dias, salvo obrigação legal de retenção mais longa.</p>

<h2>7. Seus Direitos (LGPD Art. 18)</h2>
<ul>
  <li>Confirmação da existência e acesso aos dados;</li>
  <li>Correção de dados incompletos ou desatualizados;</li>
  <li>Anonimização, bloqueio ou eliminação de dados desnecessários;</li>
  <li>Portabilidade a outro fornecedor;</li>
  <li>Eliminação de dados tratados com base em consentimento;</li>
  <li>Revogação do consentimento a qualquer momento;</li>
  <li>Oposição a tratamento em descumprimento da lei.</li>
</ul>
<p>Solicitações: <a href="mailto:privacy@paldrivy.app">privacy@paldrivy.app</a>. Prazo de resposta: 15 dias úteis.</p>

<h2>8. Segurança</h2>
<p>Utilizamos criptografia em trânsito (TLS 1.3), autenticação segura (Supabase Auth) e controle de acesso baseado em perfis (RBAC).</p>

<h2>9. Cookies e Armazenamento Local</h2>
<p>Usamos localStorage apenas para manter sua sessão ativa. Não utilizamos cookies de rastreamento ou publicidade.</p>

<h2>10. Alterações</h2>
<p>Alterações materiais serão comunicadas por e-mail com 15 dias de antecedência. O uso continuado após esse prazo implica aceite.</p>

<h2>11. Contato</h2>
<p>DPO: <a href="mailto:privacy@paldrivy.app">privacy@paldrivy.app</a><br>
ANPD: <a href="https://www.gov.br/anpd">www.gov.br/anpd</a></p>
$pp$, true, now())
ON CONFLICT DO NOTHING;

-- 10. Seed: Terms of Use v1.0
INSERT INTO legal_documents (type, version, title, content, is_active, published_at)
VALUES ('terms_of_use', '1.0', 'Termos de Uso', $tu$
<h1>Termos de Uso</h1>
<p><em>Versão 1.0 — Vigente a partir de 28 de junho de 2026</em></p>

<h2>1. Aceitação</h2>
<p>Ao criar uma conta ou utilizar o <strong>PalDrivy</strong>, você declara ter lido e concordado com estes Termos e com nossa Política de Privacidade. Caso não concorde, não utilize o serviço.</p>

<h2>2. Descrição do Serviço</h2>
<p>O PalDrivy é um aplicativo de gestão financeira voltado a motoristas de plataformas de transporte por aplicativo, que permite registrar turnos, despesas, abastecimentos e visualizar relatórios financeiros pessoais.</p>

<h2>3. Cadastro</h2>
<ul>
  <li>Você deve ter ao menos 18 anos para criar uma conta.</li>
  <li>É responsável por manter a confidencialidade da sua senha.</li>
  <li>Notifique-nos imediatamente em caso de acesso não autorizado: <a href="mailto:suporte@paldrivy.app">suporte@paldrivy.app</a>.</li>
</ul>

<h2>4. Planos e Pagamentos</h2>
<ul>
  <li>O plano <strong>Free</strong> é gratuito com recursos limitados.</li>
  <li>O plano <strong>Premium</strong> é pago, com valores exibidos no aplicativo.</li>
  <li>Novos usuários recebem <strong>7 dias gratuitos</strong> no Premium ao criar a conta.</li>
  <li>Cobranças são recorrentes; cancele a qualquer momento, sem multa.</li>
  <li>Solicitações de reembolso devem ser feitas em até 7 dias corridos após a cobrança.</li>
</ul>

<h2>5. Uso Permitido e Proibido</h2>
<p>É expressamente proibido:</p>
<ul>
  <li>Usar o serviço para finalidades ilegais ou fraudulentas;</li>
  <li>Acessar dados de outros usuários;</li>
  <li>Realizar engenharia reversa, descompilação ou cópia do aplicativo;</li>
  <li>Automatizar acessos sem autorização prévia por escrito.</li>
</ul>

<h2>6. Propriedade Intelectual</h2>
<p>Marca, design, código e textos do PalDrivy são propriedade exclusiva da Bluesun. Nenhuma licença de propriedade intelectual é concedida além do direito de uso pessoal e intransferível.</p>

<h2>7. Isenção de Responsabilidade</h2>
<p>O PalDrivy fornece dados para controle financeiro pessoal. Não somos responsáveis por decisões tomadas com base nos dados registrados. As informações não substituem orientação contábil profissional.</p>

<h2>8. Disponibilidade</h2>
<p>Empreendemos melhores esforços para manter o serviço disponível, mas não garantimos disponibilidade ininterrupta. Manutenções programadas serão comunicadas com antecedência.</p>

<h2>9. Rescisão</h2>
<p>Podemos suspender ou encerrar contas em caso de violação destes Termos. Você pode encerrar sua conta a qualquer momento via configurações ou por <a href="mailto:suporte@paldrivy.app">suporte@paldrivy.app</a>.</p>

<h2>10. Lei Aplicável e Foro</h2>
<p>Estes Termos são regidos pela legislação brasileira. Fica eleito o foro da Comarca de São Paulo/SP, com renúncia a qualquer outro.</p>

<h2>11. Contato</h2>
<p><a href="mailto:suporte@paldrivy.app">suporte@paldrivy.app</a></p>
$tu$, true, now())
ON CONFLICT DO NOTHING;
