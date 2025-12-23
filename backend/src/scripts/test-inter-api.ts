/**
 * Test script for Banco Inter API integration
 * 
 * Run with: npx ts-node src/scripts/test-inter-api.ts
 */

import { interApiService } from '../services/interApiService';
import { config } from '../config/env';

async function testInterApi() {
    console.log('='.repeat(60));
    console.log('TESTE DE INTEGRAÇÃO - BANCO INTER API');
    console.log('='.repeat(60));
    console.log();

    // Check configuration
    console.log('1. Verificando configuração...');
    console.log(`   Client ID configurado: ${config.interClientId ? 'SIM' : 'NÃO'}`);
    console.log(`   Client Secret configurado: ${config.interClientSecret ? 'SIM' : 'NÃO'}`);
    console.log(`   Caminho certificado: ${config.interCertPath}`);
    console.log(`   Caminho chave: ${config.interKeyPath}`);
    console.log(`   Ambiente: ${config.interSandbox ? 'SANDBOX' : 'PRODUÇÃO'}`);
    console.log();

    // Get status
    console.log('2. Verificando status do serviço...');
    const status = await interApiService.getStatus();
    console.log(`   Inicializado: ${status.initialized}`);
    console.log(`   Tem credenciais: ${status.hasCredentials}`);
    console.log(`   Tem certificados: ${status.hasCertificates}`);
    console.log(`   Token válido: ${status.tokenValid}`);
    console.log();

    if (!status.hasCredentials || !status.hasCertificates) {
        console.log('❌ ERRO: Credenciais ou certificados não configurados.');
        console.log('\nPara configurar:');
        console.log('1. Adicione INTER_CLIENT_ID e INTER_CLIENT_SECRET ao arquivo .env');
        console.log('2. Coloque os arquivos inter.crt e inter.key na pasta backend/certs/');
        console.log('3. Para ambiente sandbox, adicione INTER_SANDBOX=true ao .env');
        process.exit(1);
    }

    // Initialize service
    console.log('3. Inicializando serviço...');
    try {
        const initialized = await interApiService.initialize();
        if (!initialized) {
            console.log('❌ ERRO: Falha ao inicializar serviço.');
            process.exit(1);
        }
        console.log('   ✅ Serviço inicializado com sucesso!');
    } catch (error: any) {
        console.log(`   ❌ Erro: ${error.message}`);
        process.exit(1);
    }
    console.log();

    // Test OAuth token
    console.log('4. Testando autenticação OAuth2...');
    try {
        const token = await interApiService.getAccessToken();
        console.log(`   ✅ Token obtido: ${token.substring(0, 20)}...`);
    } catch (error: any) {
        console.log(`   ❌ Erro de autenticação: ${error.message}`);
        process.exit(1);
    }
    console.log();

    // Test get balance
    console.log('5. Testando consulta de saldo...');
    try {
        const saldo = await interApiService.getSaldo();
        console.log('   ✅ Saldo obtido:');
        console.log(`      Disponível: R$ ${saldo.disponivel?.toFixed(2) || '0.00'}`);
        console.log(`      Bloqueado Cheque: R$ ${saldo.bloqueadoCheque?.toFixed(2) || '0.00'}`);
        console.log(`      Bloqueado Judicial: R$ ${saldo.bloqueadoJudicial?.toFixed(2) || '0.00'}`);
        console.log(`      Limite: R$ ${saldo.limite?.toFixed(2) || '0.00'}`);
    } catch (error: any) {
        console.log(`   ❌ Erro ao consultar saldo: ${error.message}`);
        console.log('   (Este erro pode ser normal no ambiente sandbox)');
    }
    console.log();

    // Test get statement
    console.log('6. Testando consulta de extrato (últimos 7 dias)...');
    try {
        const dataFim = new Date();
        const dataInicio = new Date(dataFim.getTime() - 7 * 24 * 60 * 60 * 1000);

        const transacoes = await interApiService.getExtratoCompleto(
            interApiService.formatDate(dataInicio),
            interApiService.formatDate(dataFim)
        );

        console.log(`   ✅ Extrato obtido: ${transacoes.length} transações`);
        if (transacoes.length > 0) {
            console.log('   Últimas 3 transações:');
            transacoes.slice(0, 3).forEach((t, i) => {
                console.log(`      ${i + 1}. ${t.dataMovimento || t.dataEntrada} | ${t.tipoOperacao === 'C' ? '+' : '-'}R$ ${t.valor.toFixed(2)} | ${t.titulo || t.descricao}`);
            });
        }
    } catch (error: any) {
        console.log(`   ❌ Erro ao consultar extrato: ${error.message}`);
        console.log('   (Este erro pode ser normal no ambiente sandbox)');
    }
    console.log();

    // Test generate txid
    console.log('7. Testando geração de TxId para Pix...');
    const txid = interApiService.generateTxId();
    console.log(`   ✅ TxId gerado: ${txid}`);
    console.log();

    console.log('='.repeat(60));
    console.log('TESTES CONCLUÍDOS');
    console.log('='.repeat(60));
    console.log();
    console.log('Próximos passos:');
    console.log('1. Configure as credenciais no arquivo .env');
    console.log('2. Coloque os certificados na pasta backend/certs/');
    console.log('3. Reinicie o backend');
    console.log('4. Acesse o dashboard Inter no frontend');
}

testInterApi().catch(console.error);
