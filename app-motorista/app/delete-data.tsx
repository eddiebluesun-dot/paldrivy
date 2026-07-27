import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Linking, Platform } from 'react-native';

export default function DeleteDataScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  function handleSubmit() {
    if (!email.trim()) return;
    const subject = encodeURIComponent('Solicitação de exclusão de dados — PalDrivy');
    const body = encodeURIComponent(
      `Olá,\n\nSolicito a exclusão de todos os meus dados pessoais do PalDrivy.\n\nE-mail da conta: ${email}\n\nAtenciosamente.`
    );
    Linking.openURL(`mailto:eddie.bluesun@gmail.com?subject=${subject}&body=${body}`);
    setSent(true);
  }

  return (
    <ScrollView contentContainerStyle={s.container}>
      <View style={s.card}>
        <Text style={s.logo}>PalDrivy</Text>
        <Text style={s.title}>Exclusão de dados pessoais</Text>
        <Text style={s.body}>
          Em conformidade com a LGPD (Lei Geral de Proteção de Dados) e o GDPR, você pode solicitar
          a exclusão de todos os seus dados pessoais armazenados pelo PalDrivy.
        </Text>

        <Text style={s.subtitle}>O que será excluído:</Text>
        <Text style={s.bullet}>• Conta e credenciais de acesso</Text>
        <Text style={s.bullet}>• Histórico de turnos e ganhos</Text>
        <Text style={s.bullet}>• Despesas e abastecimentos registrados</Text>
        <Text style={s.bullet}>• Dados de veículo e configurações</Text>
        <Text style={s.bullet}>• Dados de assinatura (cancelamento automático)</Text>

        <Text style={s.subtitle}>Prazo:</Text>
        <Text style={s.body}>Sua solicitação será processada em até 15 dias úteis.</Text>

        {!sent ? (
          <>
            <Text style={s.label}>Seu e-mail cadastrado no PalDrivy:</Text>
            <TextInput
              style={s.input}
              placeholder="seu@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor="#64748B"
            />
            <TouchableOpacity
              style={[s.btn, !email.trim() && s.btnDisabled]}
              onPress={handleSubmit}
              disabled={!email.trim()}
            >
              <Text style={s.btnText}>Solicitar exclusão</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={s.success}>
            <Text style={s.successText}>✓ Solicitação enviada</Text>
            <Text style={s.body}>
              Enviamos sua solicitação para nossa equipe. Você receberá uma confirmação em até 15 dias úteis.
            </Text>
          </View>
        )}

        <Text style={s.contact}>
          Dúvidas: {' '}
          <Text style={s.link} onPress={() => Linking.openURL('mailto:eddie.bluesun@gmail.com')}>
            eddie.bluesun@gmail.com
          </Text>
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#0B1221', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#162035', borderRadius: 16, padding: 28, maxWidth: 480, width: '100%' },
  logo: { color: '#F59E0B', fontSize: 22, fontWeight: '800', marginBottom: 4 },
  title: { color: '#E2E8F0', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  subtitle: { color: '#F59E0B', fontSize: 14, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  body: { color: '#94A3B8', fontSize: 14, lineHeight: 22, marginBottom: 8 },
  bullet: { color: '#94A3B8', fontSize: 14, lineHeight: 24, marginLeft: 8 },
  label: { color: '#E2E8F0', fontSize: 13, fontWeight: '600', marginTop: 20, marginBottom: 6 },
  input: {
    backgroundColor: '#0B1221', borderWidth: 1, borderColor: '#2A3F5F',
    borderRadius: 8, padding: 12, color: '#E2E8F0', fontSize: 15, marginBottom: 12,
  },
  btn: { backgroundColor: '#F59E0B', borderRadius: 8, padding: 14, alignItems: 'center' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#0B1221', fontWeight: '800', fontSize: 15 },
  success: { backgroundColor: '#10B98115', borderRadius: 8, padding: 16, marginTop: 12, marginBottom: 8 },
  successText: { color: '#10B981', fontWeight: '700', fontSize: 16, marginBottom: 6 },
  contact: { color: '#64748B', fontSize: 12, marginTop: 20, textAlign: 'center' },
  link: { color: '#F59E0B', textDecorationLine: 'underline' },
});
