# Prompt de continuación — Fase 5, mejoras técnicas para mostrar a Stellar

> Generado el 2026-09-04, al cerrar T30, para pegar como primer mensaje en un
> chat nuevo de Claude Code dentro de esta misma carpeta (`AgentPay/`).

---

CONTEXTO

Este es AgentPay, un proyecto de pagos agénticos en siete fases sobre Stellar
testnet. Repo público: `github.com/vicentewolde/AgentPay`, rama `main`,
pusheado y al día (commit `8c1460b` al generar este prompt).

**Fases 1 a 4 cerradas. Fase 5 (MandateVault) sin candidatos técnicos
pendientes — T27 a T30 cerrados el 2026-09-04:**

- **T27** — `@agentpay/vault`: cada decisión de `PolicyRail.authorise()`
  (aprobada o rechazada) queda en una bitácora durable, encadenada por hash,
  que sobrevive un reinicio del proceso.
- **T28** — cada pago real queda vinculado criptográficamente a la decisión
  que lo autorizó: un hash anclado contra `agent_registry`, verificable por
  cualquiera sin confiar en el operador del vault.
- **T29** — una superficie de consulta en `apps/web` (sección "Bitácora"):
  un humano ve la cadena completa y el estado on-chain de cada anclaje, leído
  en vivo, no cacheado.
- **T30** — `AgentPass.getRecord()` (nuevo en `@agentpass/sdk`): la
  credencial y el Mandato mismos, con su estado on-chain en vivo, en la
  misma bitácora.

630 tests, 0 fallando (`pnpm test`). `pnpm typecheck`/`pnpm build` limpios.
Detalle técnico completo, con las alternativas descartadas de cada decisión,
en `docs/fase-5-mandatevault/` (`CONTEXTO.md`, `ARQUITECTURA.md`,
`BITACORA.md`, `DECISIONES.md` — prefijo `V-`, hasta `V-11`).

**Lo que le falta a la Fase 5 no es código:** la cohorte de alumnos, la
comunidad aliada, la demo grabable y el formulario de interés de Build Award
siguen sin arrancar (`ROADMAP.md §4.5`). El usuario lo dijo explícitamente:
esa parte no depende tanto de él ahora mismo, así que por el momento quiere
seguir invirtiendo el tiempo en **mejorar funcionalidades técnicas** —
evaluar qué vale la pena construir y hacerlo, pensando en gente de Stellar
que va a ver esto (el Embajador, la comunidad de meetups, eventualmente
revisores de SCF).

Antes de escribir una sola línea, leé en este orden:

1. `docs/AGENT_LOG.md` — las últimas seis entradas del 2026-09-04 cuentan
   toda la Fase 5 hito a hito, con el porqué de cada decisión.
2. `docs/fase-5-mandatevault/BITACORA.md` y `DECISIONES.md` — estado técnico
   completo de lo que esta fase construyó (T27–T30) y por qué se construyó
   así, no de otra forma.
3. `CLAUDE.md`, en la raíz — reglas de trabajo, protocolo de coordinación con
   Devin (§"Coordinación con Devin"), y los criterios transversales no
   negociables (errores tipados, zod en los bordes, sin credenciales
   hardcodeadas).
4. `ROADMAP.md` §4.5 y §5 — el estado completo de la fase y los riesgos
   transversales del proyecto.

---

LO PRIMERO QUE TENÉS QUE HACER: EVALUAR, NO ASUMIR

El pedido es deliberadamente abierto — "mejoras técnicas que veas
importantes" — y eso es una instrucción para investigar y proponer, no para
elegir algo y arrancar a construir. Antes de tocar código:

1. **Armá una lista corta de candidatos**, con una frase de qué prueba cada
   uno y por qué importaría mostrárselo a alguien de Stellar (técnico,
   verificable en cadena, o ambas cosas — el patrón que esta fase entera ya
   estableció). Usá como punto de partida los candidatos que **ya quedaron
   anotados en la documentación existente**, sin evaluar de cero — cada uno
   tiene su propia decisión con el motivo por el que no se hizo antes:

   - **`apps/web`'s `buy()` sigue llamando `executeBazaarPayment`
     directamente, no a través de `execute_payment`** (la quinta tool del
     agente, T26). Migrar esa integración quedó explícitamente fuera de T26
     por no ser parte de ese pedido — ver `docs/fase-4-mandategate/BITACORA.md`
     (cierre de T26) y `DECISIONES.md` → `G-12`.
   - **`policy_rail` (T22, `contracts/policy-rail/`) está construido, medido
     y probado en testnet real — pero nunca se usó como pagador real.**
     `executeBazaarPayment` firma con la cuenta clásica del agente, no con
     el contrato. Es la pieza más "Stellar-nativa" del proyecto (un smart
     account de Soroban con `perTx`/`perDay` en su propio `__check_auth`,
     con el margen de fee ya medido — `38 888 de 50 000 stroops`) y hoy
     nadie la ve en acción en la demo. Ver `docs/fase-4-mandategate/DECISIONES.md`
     → `G-1`, y `docs/fase-3-policyrail-mandato/DECISIONES.md` → `M-21`,
     `M-22` para el detalle de la medición.
   - **Solo un producto del catálogo (`swap-risk-quote`) tiene un pago real
     conectado.** El resto se muestra en el catálogo pero no se puede
     comprar de verdad — `apps/web/public/index.html` lo dice explícito
     ("Solo Swap Risk Quote tiene un pago real conectado en esta demo").
   - **La durabilidad del vault (T27) es solo dentro del proceso.** El
     archivo `data/mandate-vault.jsonl` sobrevive un reinicio del proceso,
     pero no necesariamente un redeploy de Render sin un disco persistente
     configurado — anotado en `docs/fase-5-mandatevault/ARQUITECTURA.md` §6
     como algo dicho en voz alta, no confirmado.
   - **`apps/web` es una sesión global en memoria, no multi-tenant** —
     dicho explícitamente en el docstring de `server.ts` desde T25 ("this is
     a conference-demo server, not a multi-tenant app"). Si la idea es que
     varias personas prueben el flujo a la vez (parte de lo que el piloto
     necesitará eventualmente), esto es una limitación real, no cosmética.

   Sumale tu propia evaluación fresca — capaz hay algo mejor que ninguna de
   estas cinco, o alguna de ellas no vale la pena tanto como parece a
   primera lectura.
2. **Investigá antes de comprometerte a un diseño**, con la misma disciplina
   que el resto del proyecto ya usó (T19, T22, T24, T28, T30): si algo
   depende de una librería de terceros o de un comportamiento real de la red,
   verificalo contra el código real o contra testnet antes de diseñar sobre
   un supuesto.
3. **Presentale al usuario la lista corta con tu recomendación**, igual que
   se hizo para elegir entre T27/T28/T29/T30 en esta misma fase — una
   pregunta clara, no una lista larga sin opinión. El usuario puede confirmar
   uno, pedir que hagas varios, o redirigirte a algo que no está en esta
   lista.
4. **Al construir, seguí el mismo ritmo que ya está establecido en esta
   sesión**: una rama `cc/<feature>` por hito, tests + `pnpm typecheck` +
   `pnpm build` limpios antes de cerrar, documentación actualizada
   (`BITACORA.md`, `DECISIONES.md`, `evidencia/T<n>.md` de la fase que
   corresponda — la numeración de hitos sigue corrida, el próximo después de
   T30 es T31), entrada en `docs/AGENT_LOG.md`, y confirmación explícita del
   usuario antes de mergear a `main` y pushear — nunca asumida de una
   aprobación anterior.

**No es necesario preguntar por el estado del piloto de nuevo** — ya se
preguntó al arrancar esta fase, la respuesta fue "nada arrancó todavía", y el
usuario ya dijo que por ahora no depende de él. Preguntar de nuevo sería
repetir una conversación que ya pasó.
