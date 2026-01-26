---
description: Executa a validação sistêmica recursiva módulo a módulo, corrigindo bugs até a validação final.
---

Este comando inicia um protocolo de auditoria completa no Sistema V2. 

**Passos do Workflow:**

1. **Leitura de Contexto:** Ler o arquivo `C:\Users\Mars/.gemini/antigravity/brain/89beb6f6-1c5d-4108-9aab-deff587af54d/task.md` para identificar o próximo módulo pendente.
2. **Verificação Técnica:**
   - Abrir o módulo correspondente no editor.
   - Verificar erros de TypeScript/Build.
// turbo
3. **Verificação Funcional:**
   - Abrir o browser na URL do sistema.
   - Testar o "Caminho Feliz" (fluxo normal).
   - Testar o "Caminho Crítico" (entradas inválidas, perda de conexão).
4. **Resolução de Conflitos:**
   - Se houver falha de UI ou Logic, aplicar a correção imediatamente.
   - Refatorar para o Design System se o componente ainda for legado.
5. **Progressão:**
   - Marcar o item no `task.md` como concluído após sucesso no re-teste.
   - Notificar o usuário sobre o progresso e pedir confirmação para o próximo módulo.
6. **Encerramento:**
   - Finalizar com um build total de produção e um vídeo walkthrough de todo o sistema.
