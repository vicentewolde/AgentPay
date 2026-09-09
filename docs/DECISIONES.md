# Decisiones del proyecto

> Registro de decisiones que afectan a **más de una fase** o a la estructura del
> proyecto completo. Una entrada por decisión, con su motivo y la alternativa
> que se descartó. **No se borran entradas**: si una decisión se revierte, se
> marca como `Superada` y se agrega la nueva.
>
> **Prefijo `P-`** (proyecto), para que nunca se confundan con las decisiones de
> una fase concreta. Las de la Fase 1 viven aparte, en
> [fase-1-agentpass/DECISIONES.md](fase-1-agentpass/DECISIONES.md), con sus
> prefijos `A-` (brief original) e `I-` (implementación).
>
> Plan maestro: [../ROADMAP.md](../ROADMAP.md)

Estados: `Vigente` · `Superada` · `Pendiente`

---

### P-1 · Monorepo único para las siete fases, AgentPass fusionado con su historia completa · `Vigente`
**Fecha:** 2026-09-02

Todo el proyecto AgentPay vive en un solo repositorio público. AgentPass, que
era un repositorio propio anidado, se fusionó en la raíz **preservando sus diez
commits como ancestros reales** de la historia (`git merge
--allow-unrelated-histories`), no copiando archivos. `packages/`, `contracts/`,
`deployments/`, `examples/` y `scripts/` quedan en la raíz: las fases siguientes
agregan hermanos ahí adentro, no carpetas paralelas.

**Motivo.** Tres razones concretas, no preferencia estética:

1. **Código compartido real.** El módulo de identidad DID/VC-JWT que ya existe
   en `packages/core` es exactamente lo que Mandato va a reutilizar. Con repos
   separados eso sería una dependencia publicada o un submódulo; aquí es un
   import.
2. **Estado compartido.** `deployments/testnet.json` es el único artefacto que
   cruza la frontera TypeScript↔Rust, y va a crecer con los contratos de
   PolicyRail y Mandato. Un solo archivo, un solo repo.
3. **La historia de commits es evidencia.** La postulación a Stellar Community
   Fund se apoya en historial de ejecución verificable. Fragmentado en cinco
   repos, ese historial pierde fuerza: nadie reconstruye la secuencia real de
   trabajo saltando entre repositorios.

**Alternativa descartada:** un repositorio por fase. Habría dado aislamiento
más limpio entre fases y despliegues independientes, pero a costa de las tres
razones de arriba — y ninguna fase es un producto separable, todas son capas de
la misma pila.

**Documentación separada por fase.** Se optó por `docs/fase-N-nombre/` en vez de
extender los mismos cuatro archivos a todo AgentPay. El `ROADMAP.md` original
recomendaba lo contrario (mantener un `DECISIONES.md` histórico único); se
decidió al revés porque un solo `BITACORA.md` cubriendo siete fases se vuelve
ilegible mucho antes de terminar, y porque el corte por fase deja obvio qué
documentación está cerrada y cuál está viva. Las decisiones que cruzan fases
—como esta— tienen este archivo.

**Supersede a `I-13`** (`Repo privado en GitHub`, en el registro de la Fase 1),
que queda desactualizada. Esa entrada no se edita: el registro de una fase
cerrada no se reescribe hacia atrás, se supersede desde aquí.

---

### P-2 · Devin (plan free) como segundo agente sobre la misma carpeta raíz · `Superada`
**Fecha:** 2026-09-02

Se suma Devin Desktop (plan free), apuntando a esta misma carpeta local, para
delegar tareas mecánicas y acotadas — boilerplate, tests, scaffolding,
documentación, refactors puntuales, scripts auxiliares — sin depender solo de
los tokens de Claude Code. Reglas:

1. **Git es la única fuente de verdad**, no la carpeta compartida en vivo.
   Ningún cambio se asume "sincronizado" solo porque comparte disco; se
   confirma con `git status` / `git log` antes de tocar algo que pudo haber
   cambiado del otro lado.
2. **Branches separadas por convención**: `cc/<feature>` para Claude Code,
   `devin/<task>` para Devin. **No es el default de Devin** — por su cuenta
   usa convención de conventional commits (`feature/`, `fix/`, `docs/`, etc.);
   se le indicó explícitamente usar el prefijo `devin/` para que la branch
   diga a simple vista qué agente la generó, que es lo que necesita la regla
   de no tocar la misma branch/archivo en simultáneo. Nunca los dos agentes
   trabajan sobre el mismo archivo o la misma branch en simultáneo.
3. **Todo lo que toca los contratos (AgentPass, PolicyRail, Mandato),
   MandateVault, la integración con el bazaar de Cabs, o cualquier decisión
   que afecte la narrativa de la postulación a SCF, se queda en Claude
   Code.** Devin no tiene el contexto de negocio de SCF ni de la Ley Fintech
   21.521 — el visto bueno de scope y toda decisión de arquitectura los da el
   usuario o Claude Code, nunca Devin solo. Cualquier PR o diff que venga de
   Devin se revisa antes de mergear.
4. **[docs/AGENT_LOG.md](AGENT_LOG.md)** es la bitácora corta compartida:
   qué se hizo, en qué branch, por qué, y qué queda pendiente, para que
   ninguna sesión nueva (de ningún agente) arranque sin contexto.

**Motivo.** El plan free de Devin tiene cupo diario/semanal limitado, así que
las tareas delegadas deben ser chicas y cerradas, no abiertas a mucha
iteración — y no deben tocar ninguna decisión que dependa del contexto
regulatorio o narrativo del proyecto, que Devin no tiene.

**Alternativa descartada:** dejar que ambos agentes trabajen libremente sobre
`main` y resolver conflictos según aparezcan. Se descartó porque el riesgo de
que Devin toque sin saberlo una zona con una decisión de arquitectura
pendiente (p. ej. el enforcement de `scope.limits` en Fase 3) es mayor que el
costo de la disciplina de branches.

### P-3 · La cohorte de alumnos, la demo grabable y el formulario de Build Award quedan sin prioridad; la Instaward se gestiona vía Tellus · `Vigente`
**Fecha:** 2026-09-05

Hasta este punto, `ROADMAP.md §4.5` definía el cierre de negocio de la Fase 5
como tres piezas propias: correr el piloto con una cohorte real de ~60
alumnos y la comunidad aliada, grabar una demo de punta a punta, y enviar el
formulario de interés de Build Award en `communityfund.stellar.org`. El
usuario informó un cambio de contexto: el encargado de Tellus —un referente
de Stellar en Chile— se ofreció a gestionar la Instaward directamente, y a
cambio pidió un mensaje de WhatsApp explicando el proyecto, con un link al
MVP (`apps/web`) y un link a la landing (`apps/web/public/landing.html`, ya
construida para este propósito exacto —
`docs/fase-0-fundamentos/prompt-landing-yc-style.md`).

**Motivo.** El camino a la Instaward ya no depende de que este proyecto arme
su propio expediente de negocio (cohorte + demo + formulario) — depende de
que el MVP y la landing sostengan la conversación que Tellus ya tiene
avanzada. Seguir invirtiendo esfuerzo en la cohorte de alumnos o en grabar
una demo ahora sería trabajo que no mueve la aguja del canal real por el que
se está gestionando el financiamiento.

**Qué cambia en la práctica.**

- La cohorte de alumnos, la demo grabable, y el formulario de interés de
  Build Award salen del camino crítico de la Fase 5 — anotados como
  pendientes para después, sin prioridad, no descartados.
- La definición de "listo" de la Fase 5 pasa a ser: el ciclo técnico
  completo en testnet (ya cerrado, T16–T31), el repo público (ya resuelto),
  el MVP funcionando bien, la landing funcionando bien, y el mensaje de
  WhatsApp a Tellus enviado con los dos links.
- Ningún candidato técnico nuevo se agrega — el trabajo que sigue es
  verificar que lo que ya existe (`apps/web`, `/landing`) funcione
  correctamente, no construir nada nuevo.

**Alternativa descartada:** seguir con el plan original (cohorte + demo +
formulario) en paralelo al canal de Tellus, por si la Instaward no se
concreta. Se descartó por ahora — el usuario prioriza no dispersar esfuerzo
en dos caminos de negocio a la vez; si el canal de Tellus no avanza, el plan
original sigue disponible para retomar (nada de lo hecho hasta acá se
pierde, ver `docs/fase-5-mandatevault/`).

---

### P-4 · Devin discontinuado; Codex (ChatGPT Plus) como segundo agente en su lugar · `Vigente`
**Fecha:** 2026-09-07

**Supersede a `P-2`.** El usuario discontinuó Devin (plan free): la calidad
del trabajo que producía no estaba al nivel de Claude Code para este
proyecto. No se rescata nada de lo que Devin generó — el usuario confirmó
que no había trabajo relevante pendiente de su lado, y en la práctica no
queda ningún artefacto vivo: no hay branches `devin/*` en el repo remoto (se
verificó con `git ls-remote`), y la única rama que llegó a mergearse
(`devin/guards-unit-tests`, PR #1) sigue siendo válida y no se revierte solo
por venir de Devin.

En su lugar, el usuario va a usar **Codex** (el agente de código de OpenAI,
incluido en ChatGPT Plus) con el mismo rol: tareas mecánicas y acotadas sobre
esta misma carpeta local, nunca decisiones de arquitectura ni nada que toque
contratos, MandateVault, la integración con el bazaar del embajador, o la
narrativa de SCF — ver `CLAUDE.md` § "Coordinación con Codex" para el
protocolo completo.

**Motivo, con evidencia — por qué el protocolo con Codex es más estricto que
el que tuvo Devin, no solo un reemplazo de nombre.** La experiencia con Devin
dejó dos incidentes documentados que informan el protocolo nuevo:

1. **Un bypass de seguridad real.** La rama `devin/agent-web-frontend` se
   borró por completo porque el adaptador que generó se saltaba
   `checkMandate` — ver
   [fase-2/DECISIONES.md § B-25](fase-2-agente-compra/DECISIONES.md). Es
   la razón concreta detrás de la regla nueva de prestarle atención particular,
   en toda revisión de un diff de Codex, a cualquier cambio a `checkMandate`,
   al enforcement de `scope.limits`/`perDay`, o a cualquier punto de
   autorización.
2. **Una colisión de branches.** Devin escribió sobre `cc/t20-anchor-mandate`
   — una rama reservada para Claude Code — causando confusión hasta que el
   usuario pausó esa sesión y revirtió el commit (`b6bcee0`); ver
   `docs/AGENT_LOG.md`, entradas de 2026-09-03, y
   [fase-3/BITACORA.md](fase-3-policyrail-mandato/BITACORA.md). Es la razón
   detrás de la regla nueva de parar y confirmar con `git log` quién escribió
   el último commit si el branch activo no coincide con lo esperado.

**Qué cambia en la práctica frente a `P-2`.**

- Prefijo de branch: `codex/<task>` en vez de `devin/<task>`.
- Nueva regla explícita de detección temprana de colisión de branches (punto
  3 del checklist en `CLAUDE.md`), que `P-2` no tenía.
- Nueva regla de atención reforzada, en la revisión de todo PR de Codex, a
  cambios que toquen puntos de autorización — `P-2` solo pedía "revisar antes
  de mergear", sin nombrar qué mirar con más cuidado.
- El resto del protocolo (git como fuente de verdad, `AGENT_LOG.md`
  obligatorio, alcance restringido, commitear antes de que el otro agente
  haga `checkout`) se mantiene igual — no falló, solo cambia de nombre.

**Qué NO cambia — la historia no se reescribe.** Todas las entradas de
`docs/AGENT_LOG.md`, `fase-2-agente-compra/DECISIONES.md` (`B-25`) y
`fase-3-policyrail-mandato/BITACORA.md` que narran el trabajo y los
incidentes con Devin se mantienen intactas, siguiendo la misma regla de este
archivo: no se borran entradas ni se reescribe hacia atrás el registro de
fases cerradas. Son evidencia real de disciplina de ingeniería —el bypass se
detectó y se corrigió— y otros documentos las referencian por fecha; borrarlas
rompería esas referencias sin ganar nada.

**Alternativa descartada:** borrar también el historial de Devin en
`AGENT_LOG.md` y en la documentación de fases cerradas, para que el proyecto
quede "sin rastro". Se descartó porque viola la convención que este mismo
archivo establece en su encabezado, huerfanaría las referencias cruzadas
existentes, y porque el incidente de seguridad detectado es, en sí mismo,
evidencia positiva para la narrativa de SCF — no algo que convenga esconder.

---

### P-5 · Codex trabaja en su propio worktree, no en la carpeta compartida · `Vigente`
**Fecha:** 2026-09-08

`P-2` y `P-4` asumían que el segundo agente opera sobre la misma carpeta
local que Claude Code y el usuario (`~/dev/AgentPay`), con reglas de
disciplina (commitear antes de delegar, parar si el branch activo no
coincide) para evitar que un `checkout` de un agente arrastre el estado de
otro. Esa disciplina falló dos veces en la práctica: primero con Devin
(`docs/AGENT_LOG.md`, 2026-09-03 — un `checkout` de Devin arrastró ediciones
sin commitear de Claude Code a la rama `devin/guards-unit-tests`) y después
con Codex (`docs/AGENT_LOG.md`, 2026-09-07 (6) y sesión siguiente — la
primera tarea de prueba dejó la carpeta compartida parada en
`codex/sdk-config-tests` en vez de `main`). Dos incidentes con la misma causa
raíz —carpeta física compartida— son un patrón, no mala suerte puntual.

**Qué cambia.** Codex pasa a operar en `~/dev/AgentPay-codex`, un **worktree
de git** separado (`git worktree add --detach ~/dev/AgentPay-codex main`):
carpeta de disco distinta, mismo `.git` y el mismo historial de commits. La
configuración del proyecto en Codex/ChatGPT apunta a esa carpeta, no a
`~/dev/AgentPay`. Codex arranca cada tarea con `git fetch origin` y
`git checkout -B codex/<task> origin/main`, así siempre parte del último
`main` pusheado, no de lo que haya quedado en su worktree de la tarea
anterior.

**Motivo.** Un worktree resuelve el problema de raíz en vez de depender de
que alguien recuerde aplicar una regla en el momento exacto: dos carpetas de
disco distintas no pueden pisarse mutuamente el `checkout`, sin importar qué
tan apurada esté la sesión. Es la misma técnica que ya se usaba para revisar
los PRs de Devin y Codex antes de mergear (worktree temporal, borrado al
terminar) — acá se vuelve permanente para el propio trabajo de Codex, no solo
para revisarlo.

**Qué NO cambia.** Git sigue siendo la única fuente de verdad; `AGENT_LOG.md`
sigue siendo obligatorio; todo PR de Codex se sigue revisando antes de
mergear, con la misma atención reforzada a puntos de autorización que dejó
`P-4`. Lo único que se elimina es la coordinación de checkouts en disco,
porque deja de ser necesaria.

**Alternativa descartada:** mantener la carpeta compartida y agregar más
disciplina (por ejemplo, un hook de git que bloquee el `checkout` si hay
cambios ajenos sin commitear). Se descartó porque agrega complejidad
mantenible a cambio de resolver un problema que un worktree elimina por
completo, sin hooks ni pasos adicionales que alguien pueda saltarse.

---

### P-6 · El piloto pasa a construirse como producto real, buscando partners en testnet, mientras se espera la resolución de SCF · `Vigente`
**Fecha:** 2026-09-09

El MVP y la landing (criterio de "listo" de `P-3`) ya se enviaron a Tellus.
Mientras se espera su revisión y la eventual gestión de la Instaward ante el
Stellar Community Fund (ventana estimada: revisión sep-oct 2026, fondos
posibles nov 2026), el usuario pidió explícitamente seguir construyendo
AgentPay como un producto real — no solo una demo para una postulación —
para empezar a conseguir reuniones con clientes o partners que prueben sus
funcionalidades, siempre en Stellar testnet.

**Esto no reabre `P-3` ni contradice ninguna decisión previa.**
`ROADMAP.md §4.6` (Fase 6 — "Después: AgentGuard + comercialización") ya
decía, desde antes de la Fase 2, que esa fase se diseña **recién cuando las
Fases 2-5 den evidencia real sobre la que apoyarse** — ese momento llegó: las
cinco fases técnicas están cerradas (T1-T31) y el mensaje a Tellus ya salió.
Este giro es la ejecución de ese punto del plan, no una decisión nueva sobre
la marcha.

**Investigación previa a cualquier código, con la misma disciplina que el
resto del proyecto.** Antes de tocar nada se corrieron cuatro investigaciones
paralelas con fuentes verificables: panorama competitivo (incluida la
pregunta explícita del usuario sobre si "Meta Muse" —lanzado el 8-sep-2026—
es competencia u oportunidad), mercado y cliente objetivo, requisitos
técnicos de productización, y evaluación financiera/funding. Resultado
consolidado y presentado al usuario como un plan de 60 días (artefacto
`AgentPay: De Piloto a Producto`, 2026-09-09):

- **Meta Muse no es competidor** — es un agente de consumo con aprobación
  humana en cada compra sensible, sin identidad de agente ni mandato ni
  enforcement on-chain. Es señal de demanda de mercado, no una amenaza.
- **El competidor real es `Vellar`**, un proyecto nativo de Stellar con casi
  la misma tesis que PolicyRail ("dale a tu agente un presupuesto, no tus
  llaves"), en la misma cadena, el mismo protocolo (x402) y el mismo estadio
  (testnet) — sin evidencia pública de una bitácora encadenada por hash
  anclada on-chain equivalente a MandateVault. Queda pendiente verificar con
  Tellus si compite por el mismo fondeo del embajador.
- **Segmento de cliente priorizado:** el ecosistema de developers y comercios
  que ya construyen sobre x402 dentro de Stellar (el bazaar del embajador,
  equipos de hackathons como Cards402/clevercon/TollPay) — no el mercado
  masivo de "agentic commerce" ni los frameworks genéricos de agentes, ya
  disputados por competidores financiados muy por encima de lo que un
  fundador solo puede igualar ($5-48M).
- **Hoja de ruta técnica priorizada**, sin tocar `checkMandate` ni el
  enforcement de `scope.limits`/`perDay`: multi-tenancy vía derivación
  determinística de llaves Stellar (SEP-0005/BIP-44) desde un único seed
  maestro, persistencia real del vault (hoy se borra en cada redeploy de
  Render), superficie de API para terceros, y un boceto de billing sin
  construir cobro real todavía. Costo de infraestructura estimado al final:
  ~$7-15 USD/mes.
- **Sin formalizar la SpA todavía** — mantenerla activa costaría ~$25-45
  USD/mes de contabilidad sin que hoy exista una razón legal que lo exija
  (actividad 100% testnet, sin custodia de fondos reales de terceros).

**Qué sigue igual.** Presupuesto techo de $200 USD/mes, todo en Stellar
testnet (nada de mainnet ni rieles fiat), el protocolo de coordinación con
Codex, y el criterio de cerrar cada hito con revisión antes de encadenar el
siguiente.

**Alternativa descartada:** seguir esperando la resolución de SCF antes de
invertir más trabajo, o mantener el alcance de `P-3` (solo MVP + landing)
como definición de "listo" indefinida. Se descartó porque el usuario evaluó
que el tiempo de espera (semanas, no días) es tiempo de construcción
desperdiciado, y porque el propio `ROADMAP.md` ya anticipaba este punto de
partida — no hacerlo ahora sería posponer sin motivo un trabajo que el plan
original siempre calificó como "el siguiente paso natural" una vez cerradas
las Fases 2-5.
