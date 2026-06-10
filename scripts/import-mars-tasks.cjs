/**
 * Importa o workflow operacional Mars (157 tarefas) para o Dolibarr.
 * Execução:  node scripts/import-mars-tasks.cjs
 * Opcional:  DRY_RUN=1 node scripts/import-mars-tasks.cjs
 */

const axios = require('axios');
const https = require('https');

const DOLIBARR_URL = 'https://sistema.coolgroove.com.br/api/index.php/';
const DOLIBARR_API_KEY = process.env.DOLIBARR_API_KEY || '26ecc09039bd0bfeb52b11003449a2deb4770482';
const PROJECT_REF = process.env.PROJECT_REF || 'MODELO-V3';
const PROJECT_TITLE = process.env.PROJECT_TITLE || 'Base Evento Modelo v3';
const DRY_RUN = process.env.DRY_RUN === '1';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const headers = {
    'DOLAPIKEY': DOLIBARR_API_KEY,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Cookie': 'humans_21909=1',
};

// Carga horária em MINUTOS (valor da planilha). O script converte para segundos (×60).
const TASKS = [
    { role: 'Direção', label: 'Aprovar condições comerciais fora do padrão.', mins: 600, fiscal: 'Produtor Executivo' },
    { role: 'Direção', label: 'Aprovar compras de equipamentos e orçamentos extras relevantes.', mins: 600, fiscal: 'Financeiro' },
    { role: 'Direção', label: 'Aprovar cancelamentos, remarcações, reembolsos e exceções comerciais.', mins: 600, fiscal: 'Comercial e Produtor Executivo' },
    { role: 'Direção', label: 'Controlar documentos legais da casa, como AVCB, alvarás, licenças, ART/RRT e autorizações.', mins: 300, fiscal: 'Comercial e Produtor Executivo' },
    { role: 'Direção', label: 'Aprovar alterações em documentos oficiais, Guia Mars, modelos de contrato, checklists e regras operacionais.', mins: 300, fiscal: 'Comercial e Produtor Executivo' },
    { role: 'Direção', label: 'Decidir conflitos entre áreas, responsáveis ou fiscalizadores.', mins: 300, fiscal: 'Autorregulação' },
    { role: 'Direção', label: 'Fiscalizar os fiscalizadores.', mins: 900, fiscal: 'Autorregulação' },
    { role: 'Direção', label: 'Fiscalizar Jurídico, TI, Marketing, Financeiro e Gerente do Espaço.', mins: 900, fiscal: 'Autorregulação' },
    { role: 'Direção', label: 'Decidir quem absorve custos gerados por falhas, danos, prejuízos ou retrabalho.', mins: 900, fiscal: 'Autorregulação' },
    { role: 'Comercial', label: 'Criar o Terceiro no sistema com dados completos do cliente.', mins: 600, fiscal: 'Produtor Executivo' },
    { role: 'Comercial', label: 'Criar o projeto do evento no sistema desde o prospecto.', mins: 600, fiscal: 'Produtor Executivo' },
    { role: 'Comercial', label: 'Inserir o evento na agenda do sistema e atualizar o status correto.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Comercial', label: 'Fazer atendimento inicial e levantar briefing comercial inicial.', mins: 3600, fiscal: 'Produtor Executivo' },
    { role: 'Comercial', label: 'Criar o orçamento no sistema.', mins: 900, fiscal: 'Produtor Executivo' },
    { role: 'Comercial', label: 'Solicitar validação do Produtor Executivo para itens técnicos, operacionais ou estruturais fora do padrão.', mins: 600, fiscal: 'Produtor Executivo' },
    { role: 'Comercial', label: 'Solicitar aprovação da Direção para condições comerciais fora do padrão.', mins: 900, fiscal: 'Direção' },
    { role: 'Comercial', label: 'Gerar contrato a partir do orçamento aprovado.', mins: 300, fiscal: 'Direção' },
    { role: 'Comercial', label: 'Reunião pré evento.', mins: 600, fiscal: 'Direção' },
    { role: 'Comercial', label: 'Informar ao Comprador, pelo sistema, o que foi vendido em relação a insumos, A&B, bar, camarim, coffee, backstage ou itens de apoio.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Comercial', label: 'Informar ao Recrutador, pelo sistema, o que foi vendido em termos de equipe/vagas.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Comercial', label: 'Participar da reunião de finalização da preparação do evento.', mins: 1800, fiscal: 'Produtor Executivo' },
    { role: 'Comercial', label: 'Apoiar consultas e pós-venda após o contrato assinado.', mins: 600, fiscal: 'Direção' },
    { role: 'Comercial', label: 'Fiscalizar documentos legais e alterações de documentos oficiais junto com Produtor Executivo, quando aplicável.', mins: 900, fiscal: 'Direção' },
    { role: 'Produtor Executivo', label: 'Entrar no projeto assim que o contrato for assinado.', mins: 300, fiscal: 'Comercial' },
    { role: 'Produtor Executivo', label: 'Analisar contrato, orçamento e escopo e conferir se o que foi vendido é executável.', mins: 900, fiscal: 'Comercial' },
    { role: 'Produtor Executivo', label: 'Transformar contrato e orçamento em lista de entregas no sistema.', mins: 300, fiscal: 'Produtor do Evento' },
    { role: 'Produtor Executivo', label: 'Criar e distribuir tarefas base do projeto com prazos e previsão de tempo.', mins: 1800, fiscal: 'Produtor do Evento' },
    { role: 'Produtor Executivo', label: 'Designar ou contratar o Produtor do Evento e liberar acesso ao projeto.', mins: 900, fiscal: 'Comercial' },
    { role: 'Produtor Executivo', label: 'Definir cachês/valores das vagas.', mins: 300, fiscal: 'Direção e Financeiro' },
    { role: 'Produtor Executivo', label: 'Aprovar cotações feitas pelo Comprador.', mins: 300, fiscal: 'Direção e Financeiro' },
    { role: 'Produtor Executivo', label: 'Aprovar compras, contratações, equipe, custos extras e alterações de escopo.', mins: 600, fiscal: 'Direção e Financeiro' },
    { role: 'Produtor Executivo', label: 'Validar se o evento está financeiramente viável dentro do que foi vendido.', mins: 600, fiscal: 'Financeiro' },
    { role: 'Produtor Executivo', label: 'Acompanhar projeto pelo sistema e cobrar atrasos ou inconsistências.', mins: 900, fiscal: 'Direção e Financeiro' },
    { role: 'Produtor Executivo', label: 'Participar da reunião de finalização e validar escopo, custos, pendências e aprovações.', mins: 1800, fiscal: 'Direção' },
    { role: 'Produtor Executivo', label: 'Fiscalizar lançamentos de horas de todos os envolvidos.', mins: 900, fiscal: 'Direção e Financeiro' },
    { role: 'Produtor Executivo', label: 'Lançar pagamentos dos produtores no sistema.', mins: 300, fiscal: 'Financeiro' },
    { role: 'Produtor Executivo', label: 'Dar a última aprovação de pagamento antes do Financeiro pagar.', mins: 600, fiscal: 'Financeiro' },
    { role: 'Financeiro', label: 'Fazer fechamento financeiro do evento.', mins: 300, fiscal: 'Financeiro' },
    { role: 'Produtor Executivo', label: 'Conferir valor do caixa e avisar o Financeiro.', mins: 300, fiscal: 'Financeiro' },
    { role: 'Produtor Executivo', label: 'Substituir o Produtor do Evento se ele não cumprir tarefas ou comprometer a operação.', mins: 43200, fiscal: 'Direção' },
    { role: 'Produtor do Evento', label: 'Analisar projeto, contrato, orçamento, lista de entregas e tarefas.', mins: 900, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Confirmar informações da lista de entregas com o cliente.', mins: 1800, fiscal: 'Produtor Executivo e Comercial' },
    { role: 'Produtor do Evento', label: 'Centralizar comunicação com o cliente na pré-produção e durante o evento.', mins: 1800, fiscal: 'Produtor Executivo e Comercial' },
    { role: 'Produtor do Evento', label: 'Criar tarefas específicas conforme surgirem demandas.', mins: 600, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Distribuir tarefas dentro do projeto do evento.', mins: 900, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Montar cronograma operacional do evento.', mins: 1800, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Estar obrigatoriamente presente na reunião de finalização da preparação.', mins: 1500, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Aprovar preparação final do evento.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Preencher ata da reunião no sistema.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Aprovar quantidades finais de insumos sugeridas pelo Comprador.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Acompanhar escolhas do Recrutador e aprovar ajustes finais de equipe/vagas.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Estar presente ou designar alguém para visitas técnicas.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Estar presente da montagem à desmontagem.', mins: 7200, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Fazer briefing obrigatório da equipe antes da abertura.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Coordenar operação do evento e chefes de setor.', mins: 25200, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Pegar dinheiro inicial do caixa com o Zelador e reportar o valor ao Financeiro.', mins: 300, fiscal: 'Produtor Executivo e Financeiro' },
    { role: 'Produtor do Evento', label: 'Fazer fechamento do caixa do evento.', mins: 300, fiscal: 'Produtor Executivo e Financeiro' },
    { role: 'Produtor do Evento', label: 'Fazer fechamento das máquinas de cartão.', mins: 300, fiscal: 'Produtor Executivo e Financeiro' },
    { role: 'Produtor do Evento', label: 'Passar informações de fechamento de caixa e máquinas ao Financeiro.', mins: 300, fiscal: 'Produtor Executivo e Financeiro' },
    { role: 'Produtor do Evento', label: 'Devolver todas as chaves ao Zelador pós-evento.', mins: 300, fiscal: 'Zelador' },
    { role: 'Produtor do Evento', label: 'Registrar ocorrências, mudanças, custos extras e decisões emergenciais no sistema.', mins: 300, fiscal: 'Produtor Executivo e Financeiro' },
    { role: 'Produtor do Evento', label: 'Entregar relatório pós-evento.', mins: 900, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Entregar relatório de produção com consumo real do evento.', mins: 1800, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Entregar relatório financeiro, danos, equipe, ocorrências e avaliação de fornecedores.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Produtor do Evento', label: 'Avaliar freelancers/equipe e lançar nota no sistema após o evento.', mins: 300, fiscal: 'Recrutador' },
    { role: 'Produtor do Evento', label: 'Encaminhar comprovantes de pagamento recebidos do Financeiro para freelancers/equipe do evento.', mins: 600, fiscal: 'Produtor Executivo' },
    { role: 'Comprador', label: 'Conferir pelo sistema as informações do Comercial sobre o que foi vendido em insumos e itens de apoio.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Comprador', label: 'Criar relatório de produção com quantidades e necessidades do evento.', mins: 900, fiscal: 'Produtor Executivo' },
    { role: 'Comprador', label: 'Fazer cotações e comparar fornecedores, preços, prazos e condições.', mins: 1800, fiscal: 'Produtor Executivo' },
    { role: 'Comprador', label: 'Submeter cotações para aprovação do Produtor Executivo.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Comprador', label: 'Encaminhar compras para aprovação do Produtor Executivo e Financeiro.', mins: 300, fiscal: 'Produtor Executivo e Financeiro' },
    { role: 'Comprador', label: 'Executar ou encaminhar compra aprovada conforme fluxo.', mins: 600, fiscal: 'Produtor Executivo e Financeiro' },
    { role: 'Comprador', label: 'Acompanhar entrega dos itens comprados.', mins: 300, fiscal: 'Produtor do Evento' },
    { role: 'Comprador', label: 'Avisar atrasos, erros, faltas ou divergências pelo sistema.', mins: 300, fiscal: 'Produtor do Evento e Produtor Executivo' },
    { role: 'Comprador', label: 'Atualizar estoque após entrega conferida pelo Zelador.', mins: 900, fiscal: 'Gerente do Espaço' },
    { role: 'Comprador', label: 'Participar da reunião de finalização da preparação.', mins: 1800, fiscal: 'Produtor Executivo' },
    { role: 'Comprador', label: 'Bater quantidades de insumos na reunião de finalização.', mins: 300, fiscal: 'Produtor do Evento e Produtor Executivo' },
    { role: 'Recrutador', label: 'Organizar vagas do evento no sistema.', mins: 900, fiscal: 'Produtor Executivo' },
    { role: 'Recrutador', label: 'Divulgar vagas no banco de freelancers.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Recrutador', label: 'Escolher freelancers para as vagas.', mins: 1800, fiscal: 'Produtor Executivo' },
    { role: 'Recrutador', label: 'Avisar o Produtor do Evento sobre os freelancers escolhidos.', mins: 300, fiscal: 'Produtor do Evento' },
    { role: 'Recrutador', label: 'Confirmar presença dos freelancers um dia antes do evento.', mins: 600, fiscal: 'Produtor do Evento' },
    { role: 'Recrutador', label: 'Substituir faltas ou desistências.', mins: 600, fiscal: 'Produtor do Evento' },
    { role: 'Recrutador', label: 'Garantir que contratos sejam gerados no sistema.', mins: 900, fiscal: 'Produtor Executivo' },
    { role: 'Recrutador', label: 'Participar da reunião de finalização da preparação.', mins: 1800, fiscal: 'Produtor Executivo' },
    { role: 'Recrutador', label: 'Bater vagas/equipe na reunião de finalização.', mins: 300, fiscal: 'Produtor do Evento e Produtor Executivo' },
    { role: 'Recrutador', label: 'Fiscalizar se o Produtor do Evento avaliou freelancers/equipe e lançou notas no sistema.', mins: 300, fiscal: 'Produtor Executivo' },
    { role: 'Produtor Técnico', label: 'Planejar som, luz, vídeo/LED, palco, energia, backstage e passagem de som.', mins: 1800, fiscal: 'Produtor do Evento e Produtor Executivo' },
    { role: 'Produtor Técnico', label: 'Criar mapa técnico do evento.', mins: 1800, fiscal: 'Produtor do Evento e Produtor Executivo' },
    { role: 'Produtor Técnico', label: 'Alinhar com técnicos e fornecedores técnicos.', mins: 1800, fiscal: 'Produtor do Evento' },
    { role: 'Produtor Técnico', label: 'Solicitar compras, locações ou contratações técnicas ao Produtor do Evento.', mins: 300, fiscal: 'Produtor do Evento' },
    { role: 'Produtor Técnico', label: 'Coordenar equipe técnica no evento.', mins: 5760, fiscal: 'Produtor do Evento' },
    { role: 'Produtor Técnico', label: 'Reportar riscos, inviabilidades, falhas e necessidades de manutenção.', mins: 600, fiscal: 'Produtor do Evento' },
    { role: 'Produtor de Montagem', label: 'Coordenar montagem e desmontagem.', mins: 28800, fiscal: 'Produtor do Evento e Produtor Executivo' },
    { role: 'Produtor de Montagem', label: 'Validar qualquer mudança de layout com o Produtor do Evento antes de executar.', mins: 300, fiscal: 'Produtor do Evento' },
    { role: 'Produtor de Montagem', label: 'Entregar relatório de montagem/desmontagem ao Produtor do Evento.', mins: 600, fiscal: 'Produtor do Evento' },
    { role: 'Técnico Operacional / Técnico da Casa', label: 'Testar som, mesa, microfones, cabos, luz, DMX, LED/vídeo, energia e equipamentos antes do evento.', mins: 7200, fiscal: 'Produtor do Evento' },
    { role: 'Técnico Operacional / Técnico da Casa', label: 'Acompanhar operação técnica durante o evento.', mins: 28800, fiscal: 'Produtor do Evento' },
    { role: 'Técnico Operacional / Técnico da Casa', label: 'Guardar equipamentos, cabos, microfones, extensões e materiais no local correto após o uso.', mins: 7200, fiscal: 'Produtor do Evento e Zelador' },
    { role: 'Técnico Operacional / Técnico da Casa', label: 'Reportar danos, falhas, mau funcionamento, itens faltando e necessidade de manutenção.', mins: 600, fiscal: 'Produtor do Evento e Zelador' },
    { role: 'Gerente do Espaço / Gerente da Casa', label: 'Garantir que a casa esteja pronta antes dos eventos.', mins: 900, fiscal: 'Produtor Executivo e Produtor do Evento' },
    { role: 'Gerente do Espaço / Gerente da Casa', label: 'Manter atualizada a montagem padrão da casa no Guia Mars/sistema.', mins: 300, fiscal: 'Direção, Comercial e Produtor Executivo' },
    { role: 'Gerente do Espaço / Gerente da Casa', label: 'Acompanhar relatórios pós-evento para cobrar manutenção, limpeza, danos e melhorias.', mins: 900, fiscal: 'Direção' },
    { role: 'Gerente do Espaço / Gerente da Casa', label: 'Fiscalizar retorno da montagem padrão, limpeza e reorganização da casa.', mins: 900, fiscal: 'Direção' },
    { role: 'Gerente do Espaço / Gerente da Casa', label: 'Intervir em evento quando chamado ou quando houver risco à casa, patrimônio, manutenção ou estrutura.', mins: 300, fiscal: 'Direção' },
    { role: 'Zelador / Manutenção', label: 'Abrir a casa quando for o responsável definido.', mins: 600, fiscal: 'Gerente do Espaço' },
    { role: 'Zelador / Manutenção', label: 'Conferir banheiros, insumos, vazamentos, entupimentos, iluminação e funcionamento geral.', mins: 600, fiscal: 'Gerente do Espaço' },
    { role: 'Zelador / Manutenção', label: 'Acompanhar montagem dos eventos do início ao fim quando designado no projeto do evento.', mins: 7200, fiscal: 'Produtor do Evento e Gerente do Espaço' },
    { role: 'Zelador / Manutenção', label: 'Conferir quantidades de compras na hora da entrega.', mins: 900, fiscal: 'Gerente do Espaço e Comprador' },
    { role: 'Zelador / Manutenção', label: 'Guardar compras recebidas para o evento.', mins: 900, fiscal: 'Gerente do Espaço e Comprador' },
    { role: 'Zelador / Manutenção', label: 'Entregar dinheiro inicial do caixa ao Produtor do Evento quando aplicável.', mins: 300, fiscal: 'Financeiro' },
    { role: 'Zelador / Manutenção', label: 'Guardar dinheiro do caixa após o evento e avisar o Financeiro sobre o valor guardado.', mins: 600, fiscal: 'Financeiro' },
    { role: 'Zelador / Manutenção', label: 'Garantir que o Produtor do Evento devolveu todas as chaves pós-evento.', mins: 300, fiscal: 'Gerente do Espaço' },
    { role: 'Zelador / Manutenção', label: 'Fazer vistoria final pós-evento de danos, sujeira, itens fora do lugar e pendências.', mins: 1800, fiscal: 'Gerente do Espaço' },
    { role: 'Zelador / Manutenção', label: 'Garantir retorno da montagem padrão da casa após o evento.', mins: 1800, fiscal: 'Gerente do Espaço' },
    { role: 'Zelador / Manutenção', label: 'Reportar pendências ao Gerente do Espaço pelo sistema.', mins: 300, fiscal: 'Gerente do Espaço' },
    { role: 'Limpeza', label: 'Limpar áreas antes do evento.', mins: 7200, fiscal: 'Produtor do Evento' },
    { role: 'Limpeza', label: 'Limpar áreas durante o evento.', mins: 28800, fiscal: 'Produtor do Evento' },
    { role: 'Limpeza Pós-Evento', label: 'Limpar áreas utilizadas após o evento.', mins: 21600, fiscal: 'Zelador e Gerente do Espaço' },
    { role: 'Limpeza Pós-Evento', label: 'Auxiliar Zelador na reorganização da casa e retorno da montagem padrão.', mins: 7200, fiscal: 'Gerente do Espaço' },
    { role: 'Segurança', label: 'Chegar no horário e seguir o briefing do evento.', mins: 28800, fiscal: 'Produtor do Evento' },
    { role: 'Segurança', label: 'Reportar ocorrências ao Produtor do Evento.', mins: 300, fiscal: 'Produtor do Evento' },
    { role: 'Segurança', label: 'Abrir e fechar a casa quando essa função for atribuída à segurança.', mins: 600, fiscal: 'Produtor do Evento' },
    { role: 'Controlador de Acesso / Portaria', label: 'Controlar entrada de público.', mins: 28800, fiscal: 'Produtor do Evento' },
    { role: 'Controlador de Acesso / Portaria', label: 'Controlar entrada de equipe e fornecedores.', mins: 7200, fiscal: 'Produtor do Evento' },
    { role: 'Controlador de Acesso / Portaria', label: 'Comunicar problemas de acesso ao Produtor do Evento.', mins: 300, fiscal: 'Produtor do Evento' },
    { role: 'Controlador de Acesso / Portaria', label: 'Apoiar abertura/fechamento da casa quando essa função for atribuída à portaria.', mins: 600, fiscal: 'Produtor do Evento' },
    { role: 'Bombeiro Civil', label: 'Conferir condições de prevenção e emergência antes da abertura.', mins: 1800, fiscal: 'Produtor do Evento' },
    { role: 'Bombeiro Civil', label: 'Orientar equipe e produtor sobre riscos, rotas de fuga, extintores e condutas de emergência.', mins: 300, fiscal: 'Produtor do Evento' },
    { role: 'Bombeiro Civil', label: 'Reportar ocorrências e riscos ao Produtor do Evento.', mins: 300, fiscal: 'Produtor do Evento' },
    { role: 'Chefe de Bar', label: 'Organizar a equipe de bar antes e durante o evento.', mins: 36000, fiscal: 'Produtor do Evento' },
    { role: 'Chefe de Bar', label: 'Conferir insumos antes do evento.', mins: 900, fiscal: 'Produtor do Evento' },
    { role: 'Chefe de Bar', label: 'Fazer contagem inicial e final de estoque/consumo.', mins: 3600, fiscal: 'Produtor do Evento' },
    { role: 'Chefe de Bar', label: 'Identificar perdas, quebras e sobras.', mins: 600, fiscal: 'Produtor do Evento' },
    { role: 'Chefe de Bar', label: 'Entregar informações finais de consumo, vendas, perdas, quebras e sobras ao Produtor do Evento.', mins: 300, fiscal: 'Produtor do Evento' },
    { role: 'Bar / Bartender / Atendente', label: 'Chegar no horário e seguir o briefing do Chefe de Bar.', mins: 43200, fiscal: 'Chefe de Bar' },
    { role: 'Cozinha / Copa / Catering', label: 'Operar cozinha/copa/catering conforme o que foi vendido ou autorizado.', mins: 43200, fiscal: 'Produtor do Evento' },
    { role: 'Financeiro / Administrativo', label: 'Conferir se compras estão aprovadas e dentro do orçamento do evento.', mins: 900, fiscal: 'Produtor do Evento e Produtor Executivo' },
    { role: 'Financeiro / Administrativo', label: 'Pagar compras, fornecedores, freelancers e contratações aprovadas.', mins: 3600, fiscal: 'Produtor do Evento e Produtor Executivo' },
    { role: 'Financeiro / Administrativo', label: 'Questionar compras sem aprovação antes de negar pagamento.', mins: 300, fiscal: 'Direção' },
    { role: 'Financeiro / Administrativo', label: 'Organizar notas fiscais, recibos, comprovantes e dados de pagamento.', mins: 600, fiscal: 'Direção' },
    { role: 'Financeiro / Administrativo', label: 'Controlar recebimentos do cliente, sinal, parcelas, caução e saldo final.', mins: 900, fiscal: 'Direção' },
    { role: 'Financeiro / Administrativo', label: 'Controlar reembolsos e inadimplência.', mins: 600, fiscal: 'Direção' },
    { role: 'Financeiro / Administrativo', label: 'Conferir fechamento de caixa e máquinas enviado pelo Produtor do Evento.', mins: 900, fiscal: 'Direção' },
    { role: 'Financeiro / Administrativo', label: 'Enviar comprovantes de freelancers ao Produtor do Evento.', mins: 900, fiscal: 'Direção' },
    { role: 'Financeiro / Administrativo', label: 'Enviar comprovantes de produtores diretamente aos produtores quando aplicável.', mins: 600, fiscal: 'Direção' },
    { role: 'Financeiro / Administrativo', label: 'Controlar vencimentos para evitar multas, juros e atrasos.', mins: 600, fiscal: 'Direção' },
    { role: 'Financeiro / Administrativo', label: 'Manter documentação financeira organizada no sistema.', mins: 900, fiscal: 'Direção' },
    { role: 'TI / Sistemas', label: 'Cadastrar usuários, permissões e acessos no sistema.', mins: 300, fiscal: 'Direção' },
    { role: 'TI / Sistemas', label: 'Garantir funcionamento de internet, Wi-Fi, rede, computadores, tablets, impressoras e check-in.', mins: 300, fiscal: 'Direção' },
    { role: 'TI / Sistemas', label: 'Dar suporte técnico sem alterar conteúdo operacional dos projetos/eventos.', mins: 300, fiscal: 'Direção' },
    { role: 'TI / Sistemas', label: 'Registrar ou comunicar correções emergenciais feitas durante evento.', mins: 600, fiscal: 'Direção' },
    { role: 'Marketing / Comunicação', label: 'Registrar ou organizar registro de conteúdo durante eventos quando houver interesse da casa.', mins: 28800, fiscal: 'Direção' },
    { role: 'Freelancer / Equipe de Apoio', label: 'Cumprir a função para a qual foi contratado.', mins: 28800, fiscal: 'Produtor do Evento' },
    { role: 'Todas as funções', label: 'Informar outras funções pelo sistema sempre que houver aviso, solicitação, pendência, aprovação, atualização, confirmação ou decisão.', mins: 300, fiscal: 'Superior direto / Direção' },
    { role: 'Todas as funções', label: 'Lançar horas trabalhadas dentro de cada tarefa correspondente.', mins: 600, fiscal: 'Superior direto / Fiscalizador da tarefa' },
    { role: 'Todas as funções', label: 'Atualizar andamento percentual das tarefas no sistema.', mins: 600, fiscal: 'Superior direto / Fiscalizador da tarefa' },
];

function formatDuration(seconds) {
    if (!seconds) return '0h';
    const h = seconds / 3600;
    if (h >= 1) return `${h % 1 === 0 ? h : h.toFixed(2)}h`;
    const m = seconds / 60;
    return `${m}min`;
}

async function dolibarrPost(path, body) {
    if (DRY_RUN) return { id: -1, dryRun: true };
    let res;
    try {
        res = await axios.post(DOLIBARR_URL + path, body, { headers, httpsAgent, validateStatus: () => true });
    } catch (err) {
        const detail = err?.response?.data ?? err.message;
        throw new Error(`POST ${path} falhou (rede): ${typeof detail === 'string' ? detail.slice(0, 300) : JSON.stringify(detail).slice(0, 300)}`);
    }
    if (res.status >= 200 && res.status < 300) return res.data;
    const detail = res.data == null ? '(sem corpo)' : typeof res.data === 'string' ? res.data.slice(0, 300) : JSON.stringify(res.data).slice(0, 300);
    throw new Error(`HTTP ${res.status} ${detail}`);
}

async function findProjectByRef(ref) {
    if (DRY_RUN) return null;
    try {
        const res = await axios.get(DOLIBARR_URL + 'projects', {
            headers,
            params: { sqlfilters: `(t.ref:like:'${ref}')`, limit: 5 },
            httpsAgent,
            validateStatus: () => true,
        });
        if (res.status === 200 && Array.isArray(res.data)) {
            const match = res.data.find(p => p.ref === ref) || res.data[0];
            if (match) return String(match.id);
        }
        return null;
    } catch {
        return null;
    }
}

function buildTaskPayload(t, idx, projectId) {
    const workloadSeconds = t.mins * 60;
    return {
        ref: `MV2-${String(idx + 1).padStart(3, '0')}`,
        label: `[${t.role}] ${t.label}`,
        description: `Sequência: ${idx + 1} de ${TASKS.length}\nÁrea responsável: ${t.role}\nFiscalizador: ${t.fiscal}\nCarga horária planejada: ${formatDuration(workloadSeconds)} (${t.mins} min)\n\nDescrição: ${t.label}`,
        fk_project: Number(projectId),
        planned_workload: workloadSeconds,
        progress: 0,
    };
}

async function main() {
    console.log('=== Importador Mars v2 → Dolibarr ===');
    console.log(`URL:       ${DOLIBARR_URL}`);
    console.log(`Ref:       ${PROJECT_REF}`);
    console.log(`Título:    ${PROJECT_TITLE}`);
    console.log(`Tarefas:   ${TASKS.length}`);
    console.log(`Modo:      ${DRY_RUN ? 'DRY-RUN' : 'PRODUÇÃO'}`);
    console.log('');

    let projectId = await findProjectByRef(PROJECT_REF);
    if (projectId) {
        console.log(`✔ Projeto já existe (id=${projectId}) — reutilizando.`);
    } else {
        console.log(`Criando projeto "${PROJECT_REF}"...`);
        const created = await dolibarrPost('projects', {
            ref: PROJECT_REF,
            title: PROJECT_TITLE,
            description: 'Template de projeto com 157 tarefas do workflow operacional Mars (v2). Carga horária em minutos convertida para segundos.',
            status: 1,
        });
        projectId = String(created);
        console.log(`✔ Projeto criado: id=${projectId}`);
    }

    console.log('');
    let ok = 0, fail = 0, skip = 0;
    for (let i = 0; i < TASKS.length; i++) {
        if (i >= 100) { skip++; continue; }
        const t = TASKS[i];
        const payload = buildTaskPayload(t, i, projectId);
        const ref = payload.ref;
        try {
            const created = await dolibarrPost('tasks', payload);
            ok++;
            console.log(`  [${String(i + 1).padStart(3, '0')}/${TASKS.length}] ✔ ${ref} (id=${created}) — ${t.label.slice(0, 55)}`);
        } catch (err) {
            fail++;
            console.error(`  [${String(i + 1).padStart(3, '0')}/${TASKS.length}] ✖ ${ref} — ${err.message.slice(0, 200)}`);
        }
    }

    console.log('');
    console.log(`=== Concluído ===`);
    console.log(`Projeto:   ${PROJECT_REF} (id=${projectId})`);
    console.log(`Tarefas:   ${ok} OK, ${fail} falhas, ${skip} puladas (já existem como MARS-101..157) de ${TASKS.length}`);
    if (fail > 0) process.exitCode = 1;
}

main().catch(err => {
    console.error('Erro fatal:', err.message);
    process.exit(1);
});
