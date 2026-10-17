# PREVITA – Prevenção + Vida

**App gratuito para organizar remédios e consultas, com alarme na hora certa.**
Feito para pacientes, cuidadores e Agentes Comunitários de Saúde (ACS).

👉 **Acesse:** https://previta-app.github.io/previta
Funciona no celular e no computador e pode ser instalado na tela inicial. Não precisa de cadastro.

---

## O que o app faz

- 💊 **Remédios com alarme.** Vários horários por remédio, com a quantidade de cada horário. Toca som, vibra e mostra uma notificação. Avisa as doses atrasadas.
- 👨‍👩‍👧 **Família e pacientes.** O cuidador ou o ACS acompanha os remédios e as consultas de cada pessoa, e cada um tem o seu alarme.
- 📅 **Consultas e exames.** Lembrete 2 dias antes, 1 dia antes ou no próprio dia.
- 📷 **Leitura de receita.** Fotografe a receita e o app identifica os remédios. A IA só é usada com a sua permissão.
- 🤖 **Assistente PREV.** Tira dúvidas comuns sobre remédios.
- 📖 **Guia de saúde.** Hipertensão, diabetes, idoso, gestante, criança, saúde mental e outros temas.
- 📞 **Contatos.** SAMU 192, Bombeiros 193, Disque Saúde 136, CVV 188, além dos seus médicos e farmácias.
- 📲 **Funciona sem internet** e se atualiza sozinho.
- 💾 **Backup** para passar os dados para outro aparelho.

## Privacidade (LGPD)

Os dados ficam **somente no aparelho** do usuário. Não há login nem banco de dados central.
Só o texto da receita ou da pergunta ao PREV é enviado a um serviço de IA, e só quando o usuário autoriza.
A política completa está no próprio app, em **Usuário → Política de Privacidade**.

> O PREVITA ajuda a organizar o tratamento. Ele não substitui a orientação de médicos, enfermeiros ou farmacêuticos.

## Tecnologia

- PWA em arquivo único (`index.html`), hospedado no GitHub Pages
- `sw.js`: funcionamento offline, atualização automática e notificações
- IA: Cloudflare Workers + Groq (llama-3.3-70b); OCR com Tesseract.js no próprio aparelho

## Autor

**Wilson Foster**, Agente Comunitário de Saúde e Engenheiro Civil, Santana de Parnaíba – SP
Contato: previta@fosterconstrucoes.com.br
