# App de Calculo de Ganhos para Motoristas de Aplicativo - Documento Inicial

## Visao Geral

A proposta e criar um aplicativo para motoristas de aplicativos como Uber, 99, inDrive, Lyft, Bolt, Cabify, DiDi e outras plataformas, com foco em calcular ganho real, custo por km, lucro por hora, lucro por corrida e desempenho por periodo.

O objetivo principal e responder uma pergunta simples:

> Esse periodo de trabalho realmente valeu a pena?

O app deve ajudar o motorista a entender nao apenas quanto faturou, mas quanto sobrou depois de combustivel, manutencao, taxas, despesas fixas e custos variaveis.

## Publico-Alvo

- Motoristas de aplicativo.
- Motoristas que trabalham em multiplas plataformas.
- Motoristas autonomos.
- Motoristas que alugam carro.
- Motoristas que financiam o proprio veiculo.
- Motoristas de frota.
- Entregadores e profissionais de mobilidade que tambem precisem controlar ganhos por hora e por distancia.

## Problemas Que o Produto Resolve

- O motorista sabe o faturamento bruto, mas nao sabe o lucro real.
- Dificuldade para calcular ganho por hora.
- Dificuldade para calcular ganho por km.
- Falta de controle sobre combustivel.
- Falta de controle sobre manutencao, aluguel, financiamento, seguro e outros custos.
- Dificuldade para comparar plataformas como Uber, 99, inDrive e outras.
- Falta de historico claro por dia, semana e mes.
- Dificuldade para saber se determinado horario, regiao ou app compensa.
- Falta de previsao de metas e resultados.

## Proposta de Valor

Frase principal:

> Controle seu lucro real por hora, por km e por aplicativo.

Outras possibilidades:

- Saiba quanto realmente sobra no fim do dia.
- Pare de olhar so o faturamento bruto.
- Descubra seu custo real por km.
- Compare Uber, 99 e outros apps com base em lucro, nao apenas em ganhos.
- Trabalhe com dados, nao no achismo.

## Funcionalidades Principais

### 1. Cadastro do Motorista

Dados basicos:

- Nome.
- Email.
- Telefone.
- Pais.
- Cidade.
- Moeda.
- Fuso horario.
- Unidade de distancia: km ou milhas.
- Unidade de volume: litros ou galoes.

### 2. Cadastro de Veiculo

Dados do veiculo:

- Marca.
- Modelo.
- Ano.
- Placa, opcional.
- Tipo de combustivel.
- Consumo medio.
- Tipo de uso: proprio, alugado, financiado.
- Custo mensal de aluguel ou financiamento.
- Seguro mensal.
- IPVA/licenciamento ou custos equivalentes por pais.
- Pneus, revisoes e manutencao estimada.

Tipos de energia/combustivel:

- Gasolina.
- Etanol.
- Diesel.
- GNV/CNG.
- Eletrico.
- Hibrido.

### 3. Registro de Turno

O turno e o principal registro operacional do app.

Campos:

- Data.
- Hora de inicio.
- Hora de fim.
- Km/odometro inicial.
- Km/odometro final.
- Plataforma principal ou multiplas plataformas.
- Cidade/regiao.
- Ganho bruto.
- Gorjetas.
- Bonus/promocoes.
- Pedagios.
- Estacionamento.
- Observacoes.

Calculos automaticos:

- Horas trabalhadas.
- Distancia rodada.
- Ganho bruto por hora.
- Ganho bruto por km.
- Custo estimado de combustivel.
- Outros custos proporcionais.
- Lucro liquido.
- Lucro liquido por hora.
- Lucro liquido por km.

### 4. Ganhos por Plataforma

O motorista pode registrar ganhos separados por aplicativo dentro do mesmo turno.

Exemplo:

```text
Turno: 25/06
Uber: R$ 180,00
99: R$ 95,00
inDrive: R$ 40,00
Total bruto: R$ 315,00
```

Plataformas sugeridas:

- Uber.
- 99.
- inDrive.
- Lyft.
- Bolt.
- Cabify.
- DiDi.
- Ola.
- Grab.
- Gojek.
- FreeNow.
- Outras.

### 5. Controle de Combustivel

Campos para abastecimento:

- Data.
- Veiculo.
- Km/odometro no abastecimento.
- Tipo de combustivel.
- Litros/galoes.
- Valor total.
- Preco por litro/galao.
- Posto/local.
- Tanque cheio: sim/nao.
- Observacoes.

Calculos:

- Preco medio do combustivel.
- Consumo medio real.
- Custo por km.
- Custo por milha.
- Comparativo entre combustiveis.
- Historico de abastecimentos.

### 6. Custos Fixos e Variaveis

Custos fixos:

- Aluguel do carro.
- Financiamento.
- Seguro.
- Internet/celular.
- Estacionamento mensal.
- Rastreador.
- Licenciamento.
- Impostos.

Custos variaveis:

- Combustivel.
- Lavagem.
- Manutencao.
- Pneus.
- Troca de oleo.
- Pedagios.
- Estacionamento.
- Multas, se o usuario quiser registrar.
- Comissoes ou taxas extras.

O app deve permitir ratear custos fixos por dia, hora ou km para estimar o lucro real.

### 7. Dashboard Principal

Tela inicial sugerida:

```text
Hoje
Ganho bruto: R$ 320,00
Custos estimados: R$ 92,00
Lucro liquido: R$ 228,00
Horas trabalhadas: 8h10
Km rodados: 176 km
Liquido/hora: R$ 27,91
Liquido/km: R$ 1,29
```

Indicadores:

- Ganho bruto do dia.
- Lucro liquido do dia.
- Horas trabalhadas.
- Km rodados.
- Custo por km.
- Lucro por hora.
- Lucro por km.
- Melhor plataforma.
- Meta do dia.
- Progresso da meta.

### 8. Relatorios

Relatorios essenciais:

- Diario.
- Semanal.
- Mensal.
- Por plataforma.
- Por veiculo.
- Por cidade/regiao.
- Por horario.
- Por dia da semana.
- Ganho bruto vs lucro liquido.
- Custo por km.
- Custo de combustivel.
- Evolucao do lucro.

Perguntas que os relatorios devem responder:

- Qual app esta pagando melhor?
- Qual horario gera mais lucro?
- Qual dia da semana compensa mais?
- Quanto custa rodar 1 km?
- Quanto sobra por hora depois dos custos?
- O carro alugado esta compensando?
- A meta mensal esta sendo atingida?

### 9. Metas

Tipos de metas:

- Meta diaria de lucro liquido.
- Meta semanal.
- Meta mensal.
- Meta por hora.
- Meta por km.
- Meta para pagar custos fixos.

Exemplo:

```text
Meta diaria: R$ 250,00 liquido
Atual: R$ 180,00
Faltam: R$ 70,00
Estimativa: mais 2h20 de trabalho
```

### 10. Exportacoes

Mesmo sem usar Google Sheets como base principal, o app pode oferecer exportacao.

Formatos:

- CSV.
- PDF.
- Excel.

Exportacoes uteis:

- Relatorio mensal.
- Relatorio para contador.
- Historico de turnos.
- Historico de abastecimentos.
- Custos e despesas.
- Resumo anual.

## Base de Dados com Supabase

Supabase pode ser usado como backend inicial:

- Auth para login.
- Postgres como banco principal.
- Row Level Security para separar dados por usuario.
- Storage para comprovantes e recibos, se necessario.
- Edge Functions para calculos, notificacoes ou rotinas.

Tabelas iniciais sugeridas:

```text
profiles
vehicles
platforms
shifts
shift_platform_earnings
fuel_entries
expenses
expense_categories
goals
reports_snapshots
subscriptions
```

### Tabela profiles

Campos sugeridos:

```text
id
name
email
phone
country
city
currency_code
distance_unit
volume_unit
timezone
locale
created_at
```

### Tabela vehicles

Campos sugeridos:

```text
id
user_id
name
brand
model
year
plate
fuel_type
avg_consumption
ownership_type
monthly_rent
monthly_financing
monthly_insurance
estimated_monthly_maintenance
created_at
```

### Tabela shifts

Campos sugeridos:

```text
id
user_id
vehicle_id
started_at
ended_at
start_odometer
end_odometer
gross_earnings
tips
bonuses
tolls
parking_cost
region
notes
created_at
```

Campos calculados:

```text
duration_hours
distance
gross_per_hour
gross_per_distance
estimated_fuel_cost
allocated_fixed_cost
net_earnings
net_per_hour
net_per_distance
```

### Tabela fuel_entries

Campos sugeridos:

```text
id
user_id
vehicle_id
filled_at
odometer
fuel_type
volume
total_amount
price_per_unit
station_name
is_full_tank
notes
created_at
```

### Tabela expenses

Campos sugeridos:

```text
id
user_id
vehicle_id
category_id
expense_date
amount
description
is_recurring
recurrence_period
created_at
```

## Produto Global

O app pode nascer preparado para uso mundial.

Requisitos globais:

- Multimoeda.
- Multi-idioma.
- Km e milhas.
- Litros e galoes.
- Diferentes combustiveis.
- Fuso horario por usuario.
- Plataformas diferentes por pais.

Idiomas iniciais:

- Portugues.
- Ingles.
- Espanhol.

Mercados iniciais sugeridos:

1. Brasil.
2. America Latina.
3. Estados Unidos.
4. Europa.

## Monetizacao

Modelo recomendado: freemium com assinatura.

Plano gratuito:

- 1 veiculo.
- Registro basico de turnos.
- Registro basico de abastecimentos.
- Resumo diario e semanal simples.
- Historico limitado, por exemplo 30 ou 60 dias.

Plano Pro:

- Historico completo.
- Relatorios mensais.
- Lucro liquido por hora e por km.
- Custos fixos e variaveis.
- Multiplos veiculos.
- Metas.
- Comparativo entre apps.
- Exportacao PDF/CSV/Excel.
- Lembretes de manutencao.
- Relatorio para contador.

Preco sugerido:

- Brasil: R$ 9,90/mes ou R$ 79,90/ano.
- EUA: US$ 4.99 a US$ 6.99/mes.
- Europa: EUR 4.99/mes.
- America Latina: preco adaptado por pais.

Outras fontes de receita:

- Plano para frotas.
- Parcerias com oficinas.
- Parcerias com postos.
- Seguros.
- Pneus.
- Clube de beneficios.
- Relatorios fiscais premium.

## MVP Recomendado

Primeira versao:

1. Login/cadastro.
2. Cadastro de veiculo.
3. Registro de turno.
4. Registro de abastecimento.
5. Registro de despesa.
6. Dashboard com lucro liquido, ganho por hora e ganho por km.
7. Relatorio semanal e mensal.
8. Configuracao de moeda, km/milhas e litros/galoes.

Segunda fase:

1. Metas.
2. Exportacao PDF/CSV.
3. Comparativo entre plataformas.
4. Lembretes de manutencao.
5. Relatorio para contador.
6. Plano Pro.

Terceira fase:

1. Multi-idioma.
2. Frotas.
3. OCR de prints dos apps.
4. Recomendacoes de horarios mais lucrativos.
5. Integracoes externas.

## Diferenciais

- Foco em lucro real, nao apenas faturamento bruto.
- Calculo por hora e por km/milha.
- Comparativo por aplicativo.
- Controle de combustivel integrado.
- Custos fixos rateados automaticamente.
- Produto preparado para varios paises.
- Relatorios simples para tomada de decisao.
- Linguagem acessivel para motorista.

## Proximos Passos

1. Definir nome do produto.
2. Definir stack frontend/mobile.
3. Criar modelo de banco no Supabase.
4. Criar wireframes das telas principais.
5. Criar MVP com registro de turno e abastecimento.
6. Validar com motoristas reais.
7. Ajustar calculos e relatorios com base no uso real.
